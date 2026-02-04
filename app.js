// =====================
// CONFIG (edita esto)
// =====================
const SUPABASE_URL = "https://nhoaoyfbibykonelewkr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ob2FveWZiaWJ5a29uZWxld2tyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMzI0NzksImV4cCI6MjA4NTcwODQ3OX0.mBGWd7vJmO-9l32_lqP676fyU0rYQB3ce8D433mxfQM";
const WHATSAPP_NUMBER = "34617494566"; // con prefijo país
const DEBUG = true;

// =====================
// Disponibilidad rápida (AJUSTA)
// =====================
const FREE_DAYS_AHEAD = 10;
const AVAILABILITY_SLOT_MIN = 30;
const SCARCITY_CRITICAL = 5;
const SCARCITY_WARNING  = 10;
const SHOW_SCARCITY_ONLY = true;
const SHOW_FREE_AS_RANGES = true;

const HOURS = {
  default: [
    { start: "10:00", end: "14:00" },
    { start: "16:00", end: "21:00" },
  ],
  tuesday: [
    { start: "16:00", end: "20:00" },
  ],
  saturday: [{ start: "10:00", end: "14:00" }],
  sunday: [],
};

const SLOT_STEP_MIN = 15;

const SERVICE_META = {
  "Corte degradado": { duration: 30, price: 12.5 },
  "Recorte de la barba": { duration: 15, price: 6.0 },
  Rapado: { duration: 15, price: 6.0 },
  "Corte clásico": { duration: 15, price: 10.0 },
  "Pelo y barba": { duration: 45, price: 16.0 },
  "Rapado y barba": { duration: 15, price: 10.0 },
  "Corte niño hasta 5 años": { duration: 20, price: 10.0 },
  "Degradado + diseño + cejas": { duration: 30, price: 15.0 },
  "Pelo y barba, cejas y diseño": { duration: 45, price: 20.0 },
};

function getServiceDuration(serviceName) {
  return SERVICE_META[serviceName]?.duration ?? 30;
}
function getServicePrice(serviceName) {
  return SERVICE_META[serviceName]?.price ?? null;
}
function formatEuro(value) {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "€";
}

// =====================
// Helpers
// =====================
function pad2(n) { return String(n).padStart(2, "0"); }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function sameDay(a, b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function parseTimeToMinutes(hhmm) { const [h,m]=hhmm.split(":").map(Number); return h*60+m; }
function minutesToTime(min) { const h=Math.floor(min/60); const m=min%60; return `${pad2(h)}:${pad2(m)}`; }
function niceSpanishDate(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString("es-ES", { weekday:"long", day:"2-digit", month:"long" });
}
function getRangesForDate(date) {
  const day = date.getDay();
  if (day === 0) return HOURS.sunday;
  if (day === 6) return HOURS.saturday;
  return HOURS.default;
}
function generateSlotsForDate(date, durationMin) {
  const ranges = getRangesForDate(date);
  const slots = [];
  for (const r of ranges) {
    let start = parseTimeToMinutes(r.start);
    const end = parseTimeToMinutes(r.end);
    while (start + durationMin <= end) {
      slots.push(minutesToTime(start));
      start += SLOT_STEP_MIN;
    }
  }
  return slots;
}
function mergeIntervals(intervals){
  if (!intervals.length) return [];
  intervals.sort((a,b)=>a.start-b.start);
  const out = [intervals[0]];
  for (let i=1;i<intervals.length;i++){
    const prev = out[out.length-1];
    const cur = intervals[i];
    if (cur.start <= prev.end) prev.end = Math.max(prev.end, cur.end);
    else out.push(cur);
  }
  return out;
}
function subtractIntervals(openRange, busyIntervals){
  const res = [];
  let cursor = openRange.start;
  for (const b of busyIntervals){
    if (b.end <= cursor) continue;
    if (b.start >= openRange.end) break;
    const s = Math.max(cursor, openRange.start);
    const e = Math.min(b.start, openRange.end);
    if (e > s) res.push({start:s, end:e});
    cursor = Math.max(cursor, b.end);
    if (cursor >= openRange.end) break;
  }
  if (cursor < openRange.end) res.push({start: cursor, end: openRange.end});
  return res;
}

// =====================
// Local storage
// =====================
function loadAppointments() {
  try { return JSON.parse(localStorage.getItem("coliseumAppointments") || "[]"); }
  catch { return []; }
}
function saveAppointments(list) {
  localStorage.setItem("coliseumAppointments", JSON.stringify(list));
}
function apptToInterval(appt) {
  const start = parseTimeToMinutes(appt.time);
  const dur = appt.duration ?? getServiceDuration(appt.service);
  return { start, end: start + dur };
}

// =====================
// Main
// =====================
document.addEventListener("DOMContentLoaded", () => {
  if (!window.supabase) {
    console.error("Supabase no cargó. Revisa el orden de scripts en index.html.");
    return;
  }

  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ========= Remote busy cache (BD) =========
  const remoteBusyByDate = new Map(); // iso -> [{start,end}]
  async function refreshRemoteBusyWide() {
    const today = new Date(); today.setHours(0,0,0,0);
    const fromISO = toISODate(today);
    const to = new Date(today); to.setDate(to.getDate() + 120);
    const toISO = toISODate(to);

    const { data, error } = await db.rpc("get_busy_slots", { date_from: fromISO, date_to: toISO });
    if (error) {
      if (DEBUG) console.warn("get_busy_slots error:", error);
      return;
    }
    remoteBusyByDate.clear();
    (data || []).forEach(row => {
      const iso = row.date;
      const start = parseTimeToMinutes(row.slot_time);
      const end = start + Number(row.duration || 0);
      if (!remoteBusyByDate.has(iso)) remoteBusyByDate.set(iso, []);
      remoteBusyByDate.get(iso).push({ start, end });
    });
    for (const [iso, arr] of remoteBusyByDate.entries()){
      remoteBusyByDate.set(iso, mergeIntervals(arr));
    }
    if (DEBUG) console.log("busy slots loaded:", data?.length ?? 0);
  }

  function getBusyIntervalsForISO(iso){
    const remote = remoteBusyByDate.get(iso) || [];
    const local = loadAppointments()
      .filter(a => a.date === iso)
      .map(apptToInterval);
    return mergeIntervals([...remote, ...local]);
  }

  function getAvailableStartTimesForDay(date, durationMin) {
    const iso = toISODate(date);
    const busy = getBusyIntervalsForISO(iso);
    let slots = generateSlotsForDate(date, durationMin);

    slots = slots.filter((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busy.some(b => start < b.end && end > b.start);
    });

    return slots;
  }

  function getFreeRangesForDay(date){
    const iso = toISODate(date);
    const busy = getBusyIntervalsForISO(iso);
    const ranges = getRangesForDate(date);
    let freeRanges = [];
    for (const r of ranges){
      const openRange = { start: parseTimeToMinutes(r.start), end: parseTimeToMinutes(r.end) };
      freeRanges = freeRanges.concat(subtractIntervals(openRange, busy));
    }
    return freeRanges;
  }

  // =====================
  // Reveal animations
  // =====================
  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("is-visible"); });
  }, { threshold: 0.12 });
  revealEls.forEach((el) => io.observe(el));

  // =====================
  // Surprise button
  // =====================
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");
  btn?.addEventListener("click", () => {
    msg.textContent =
      "🔥🔥 ¡AGENDA tu cita rápidamente! 🔥🔥 ¡Y por ser tu primera vez consigue un 10% de DESCUENTO en tu primer corte! 💥✂️🔥\n\n¡Nos vemos en EL COLISEUM! ⚔️";
  });

  // =====================
  // Booking elements
  // =====================
  const monthLabel = document.getElementById("monthLabel");
  const grid = document.getElementById("calendarGrid");
  const prevMonthBtn = document.getElementById("prevMonth");
  const nextMonthBtn = document.getElementById("nextMonth");

  const selectedDateText = document.getElementById("selectedDateText");
  const dateValue = document.getElementById("dateValue");
  const timeSelect = document.getElementById("time");

  const form = document.getElementById("bookingForm");
  const alertBox = document.getElementById("alert");
  const whatsBtn = document.getElementById("whatsBtn");
  const downloadIcsBtn = document.getElementById("downloadIcsBtn");
  const apptList = document.getElementById("apptList");
  const freeSlotsGrid = document.getElementById("freeSlotsGrid");

  const nameInput = document.getElementById("name");
  const lastNameInput = document.getElementById("lastName");
  const phoneInput = document.getElementById("phone");
  const emailInput = document.getElementById("email");
  const serviceSelect = document.getElementById("service");
  const notesInput = document.getElementById("notes");

  let view = new Date(); view.setDate(1);
  let selectedDate = null;
  let lastCreatedAppointment = null;

  function todayStart() { const t = new Date(); t.setHours(0,0,0,0); return t; }
  function isPast(date) {
    const t = todayStart();
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return d < t;
  }
  function isClosed(date) { return date.getDay() === 0; }

  // =====================
  // Alerts
  // =====================
  function setAlert(text, type) {
    alertBox.textContent = text || "";
    alertBox.classList.remove("alert--ok", "alert--bad");
    if (type === "ok") alertBox.classList.add("alert--ok");
    if (type === "bad") alertBox.classList.add("alert--bad");
  }

  // =====================
  // Calendar render
  // =====================
  function renderCalendar() {
    const monthName = view.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    monthLabel.textContent = monthName[0].toUpperCase() + monthName.slice(1);
    grid.innerHTML = "";

    const firstDayOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
    const lastDayOfMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0);

    const jsDay = firstDayOfMonth.getDay();
    const mondayIndex = (jsDay + 6) % 7;
    for (let i = 0; i < mondayIndex; i++) {
      const blank = document.createElement("div");
      blank.className = "day day--off";
      blank.style.visibility = "hidden";
      grid.appendChild(blank);
    }

    const today = new Date();

    for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
      const date = new Date(view.getFullYear(), view.getMonth(), d);
      const cell = document.createElement("div");
      cell.className = "day";
      cell.textContent = String(d);

      const off = isPast(date) || isClosed(date);
      if (off) cell.classList.add("day--off");
      if (sameDay(date, today)) cell.classList.add("day--today");
      if (selectedDate && sameDay(date, selectedDate)) cell.classList.add("day--selected");

      cell.addEventListener("click", () => {
        if (off) return;
        selectedDate = date;
        dateValue.value = toISODate(date);
        selectedDateText.textContent = niceSpanishDate(dateValue.value);
        populateTimes();
        setAlert("");
        renderCalendar();
      });

      grid.appendChild(cell);
    }
  }

  // =====================
  // Times
  // =====================
  function populateTimes() {
    timeSelect.innerHTML = "";

    if (!selectedDate) {
      const opt = document.createElement("option");
      opt.textContent = "Elige un día primero";
      opt.disabled = true;
      opt.selected = true;
      timeSelect.appendChild(opt);
      return;
    }

    const service = serviceSelect.value;
    const durationMin = getServiceDuration(service);

    let slots = generateSlotsForDate(selectedDate, durationMin);

    const iso = toISODate(selectedDate);
    const busy = getBusyIntervalsForISO(iso);

    slots = slots.filter((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busy.some(b => start < b.end && end > b.start);
    });

    if (slots.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No hay horarios disponibles";
      opt.disabled = true;
      opt.selected = true;
      timeSelect.appendChild(opt);
      return;
    }

    const first = document.createElement("option");
    first.textContent = service ? "Selecciona una hora" : "Selecciona un servicio primero";
    first.value = "";
    first.disabled = true;
    first.selected = true;
    timeSelect.appendChild(first);

    slots.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      timeSelect.appendChild(opt);
    });
  }

  serviceSelect.addEventListener("change", () => {
    if (selectedDate) populateTimes();
  });

  // =====================
  // Appointments UI
  // =====================
  function toICSDateTime(dateISO, timeHHMM) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0);
    return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
  }
  function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function downloadICS(appt) {
    const dtStart = toICSDateTime(appt.date, appt.time);
    const durationMin = appt.duration ?? getServiceDuration(appt.service);

    const [y, mo, d] = appt.date.split("-").map(Number);
    const [hh, mm] = appt.time.split(":").map(Number);
    const end = new Date(y, mo - 1, d, hh, mm, 0);
    end.setMinutes(end.getMinutes() + durationMin);

    const dtEnd = `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`;

    const uid = `${appt.id}@elcoliseum`;
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}T${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

    const priceTxt = appt.price != null ? ` (${formatEuro(appt.price)})` : "";
    const summary = `Cita - EL COLISEUM (${appt.service}${priceTxt})`;

    const description =
      `Cliente: ${appt.name} ${appt.lastName}\\n` +
      `Teléfono: ${appt.phone}\\n` +
      `Email: ${appt.email}\\n` +
      `Servicio: ${appt.service}${priceTxt}\\n` +
      `Duración: ${durationMin} min\\n` +
      (appt.notes ? `Nota: ${appt.notes}\\n` : "");

    const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//EL COLISEUM//Citas//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${stamp}
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:${summary}
DESCRIPTION:${description}
END:VEVENT
END:VCALENDAR`;

    downloadTextFile(`cita-elcoliseum-${appt.date}-${appt.time}.ics`, ics, "text/calendar");
  }

  function buildWhatsAppLink(appt) {
    const number = (WHATSAPP_NUMBER || "").replace(/\D/g, "");
    if (!number) return null;

    const priceTxt = appt.price != null ? ` (${formatEuro(appt.price)})` : "";
    const text =
      `Hola! Quiero reservar en EL COLISEUM.%0A` +
      `Nombre: ${encodeURIComponent(appt.name + " " + appt.lastName)}%0A` +
      `Teléfono: ${encodeURIComponent(appt.phone)}%0A` +
      `Email: ${encodeURIComponent(appt.email)}%0A` +
      `Servicio: ${encodeURIComponent(appt.service + priceTxt)}%0A` +
      `Día: ${encodeURIComponent(niceSpanishDate(appt.date))}%0A` +
      `Hora: ${encodeURIComponent(appt.time)}%0A` +
      (appt.notes ? `Nota: ${encodeURIComponent(appt.notes)}%0A` : "") +
      `Gracias!`;

    return `https://wa.me/${number}?text=${text}`;
  }

  function enablePostCreateActions(appt) {
    lastCreatedAppointment = appt;
    const wa = buildWhatsAppLink(appt);
    whatsBtn.disabled = !wa;
    downloadIcsBtn.disabled = false;
  }

  async function cancelInDB(appt){
    if (!appt.db_id) return true; // solo local
    const { data, error } = await db.rpc("cancel_appointment", {
      p_id: appt.db_id,
      p_phone: appt.phone,
      p_email: appt.email,
    });
    if (error) {
      setAlert("Error al anular en BD: " + error.message, "bad");
      return false;
    }
    if (!data?.[0]?.ok) {
      setAlert(data?.[0]?.message || "No se pudo anular en BD.", "bad");
      return false;
    }
    return true;
  }

  function renderAppointments() {
    const list = loadAppointments();
    list.sort((a, b) => new Date(`${a.date}T${a.time}:00`) - new Date(`${b.date}T${b.time}:00`));

    apptList.innerHTML = "";

    if (list.length === 0) {
      const li = document.createElement("li");
      li.className = "appt";
      li.innerHTML = `
        <div class="appt__left">
          <div class="appt__title">Aún no hay citas guardadas</div>
          <div class="appt__meta">Cuando reserves, aparecerán aquí.</div>
        </div>
      `;
      apptList.appendChild(li);
      return;
    }

    list.forEach((a) => {
      const li = document.createElement("li");
      li.className = "appt";

      const priceTxt = a.price != null ? ` · ${formatEuro(a.price)}` : "";
      const durTxt = a.duration ? ` · ${a.duration} min` : "";
      const extra = a.notes ? ` · Nota: ${a.notes}` : "";

      li.innerHTML = `
        <div class="appt__left">
          <div class="appt__title">${a.name} ${a.lastName}</div>
          <div class="appt__meta">${niceSpanishDate(a.date)} · ${a.time} · ${a.service}${priceTxt}${durTxt}${extra}</div>
        </div>
        <div class="appt__actions">
          <button class="smallBtn" data-action="ics">.ics</button>
          <button class="smallBtn" data-action="delete">Anular</button>
        </div>
      `;

      li.querySelector('[data-action="ics"]').addEventListener("click", () => downloadICS(a));

      li.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        const ok = await cancelInDB(a);
        if (!ok) return;

        const next = loadAppointments().filter((x) => x.id !== a.id);
        saveAppointments(next);

        await refreshRemoteBusyWide();
        renderAppointments();
        renderFreeSlots();
        populateTimes();
        setAlert("Cita anulada ✅ (y marcada como anulada en la base de datos).", "ok");
      });

      apptList.appendChild(li);
    });
  }

  // =====================
  // Disponibilidad rápida
  // =====================
  function renderFreeSlots() {
    if (!freeSlotsGrid) return;
    freeSlotsGrid.innerHTML = "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < FREE_DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      if (isClosed(d)) continue;
      const iso = toISODate(d);

      const totalSlots = generateSlotsForDate(d, AVAILABILITY_SLOT_MIN).length;
      const availableSlots = getAvailableStartTimesForDay(d, AVAILABILITY_SLOT_MIN);
      const remaining = availableSlots.length;

      if (SHOW_SCARCITY_ONLY && remaining > SCARCITY_WARNING) continue;

      const severity =
        remaining <= SCARCITY_CRITICAL ? "critical" :
        remaining <= SCARCITY_WARNING  ? "warning"  :
        "ok";

      const freeRanges = getFreeRangesForDay(d);
      const pct = totalSlots > 0 ? Math.round((remaining / totalSlots) * 100) : 0;

      const card = document.createElement("div");
      card.className = `dayCard dayCard--${severity}`;

      const top = document.createElement("div");
      top.className = "dayCard__top";
      top.innerHTML = `
        <div>
          <div class="dayTitle">${niceSpanishDate(iso)}</div>
          <div class="daySub">Quedan <strong>${remaining}</strong> huecos (${pct}%)</div>
          <div class="statusBadge statusBadge--${severity}">
            ${
              severity === "critical" ? "🔥 Poca disponibilidad" :
              severity === "warning"  ? "⚠️ Se está llenando" :
              "✅ Bastante disponible"
            }
          </div>
        </div>
        <button class="smallBtn" type="button">Elegir</button>
      `;

      top.querySelector("button").addEventListener("click", () => {
        selectedDate = d;
        dateValue.value = iso;
        selectedDateText.textContent = niceSpanishDate(iso);
        populateTimes();
        renderCalendar();
        document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth" });
      });

      const bar = document.createElement("div");
      bar.className = "progress";
      bar.innerHTML = `<span style="width:${Math.min(100, pct)}%"></span>`;

      const chips = document.createElement("div");
      chips.className = "chips";

      if (SHOW_FREE_AS_RANGES) {
        if (!freeRanges.length) {
          chips.innerHTML = `<span class="chip">Sin huecos</span>`;
        } else {
          freeRanges.forEach((r) => {
            const span = document.createElement("span");
            span.className = "chip";
            span.textContent = `${minutesToTime(r.start)}–${minutesToTime(r.end)}`;
            chips.appendChild(span);
          });
        }
      } else {
        availableSlots.slice(0, 12).forEach((t) => {
          const span = document.createElement("span");
          span.className = "chip";
          span.textContent = t;
          chips.appendChild(span);
        });
      }

      card.appendChild(top);
      card.appendChild(bar);
      card.appendChild(chips);
      freeSlotsGrid.appendChild(card);
    }

    if (!freeSlotsGrid.children.length) {
      freeSlotsGrid.innerHTML =
        `<div class="dayCard"><div class="dayTitle">Sin alertas de disponibilidad</div><div class="daySub">No hay días “justos” en los próximos ${FREE_DAYS_AHEAD} días.</div></div>`;
    }
  }

  // =====================
  // Events
  // =====================
  prevMonthBtn.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    renderCalendar();
  });
  nextMonthBtn.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    renderCalendar();
  });

  whatsBtn.addEventListener("click", () => {
    if (!lastCreatedAppointment) return;
    const wa = buildWhatsAppLink(lastCreatedAppointment);
    if (!wa) {
      setAlert("Falta configurar WHATSAPP_NUMBER en app.js.", "bad");
      return;
    }
    window.location.href = wa;
  });

  downloadIcsBtn.addEventListener("click", () => {
    if (!lastCreatedAppointment) return;
    downloadICS(lastCreatedAppointment);
  });

  // =====================
  // Guardar cita (BD + local)
  // =====================
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();
    const service = serviceSelect.value;
    const notes = notesInput.value.trim();
    const date = dateValue.value;
    const time = timeSelect.value;

    if (!name || !lastName || !phone || !email || !service || !date || !time) {
      setAlert("Completa nombre, apellidos, teléfono, email, servicio, día y hora.", "bad");
      return;
    }

    const duration = getServiceDuration(service);
    const price = getServicePrice(service);

    // bloquea solapes con lo que ya hay (BD + local)
    const busy = getBusyIntervalsForISO(date);
    const start = parseTimeToMinutes(time);
    const end = start + duration;
    if (busy.some(b => start < b.end && end > b.start)) {
      setAlert("Ese horario ya está ocupado. Elige otra hora.", "bad");
      return;
    }

    // 1) INSERT en BD (por RPC)
    const { data, error } = await db.rpc("book_appointment", {
      p_name: name,
      p_last_name: lastName,
      p_email: email,
      p_phone: phone,
      p_date: date,
      p_time: time,
      p_service: service,
      p_duration: duration,
      p_notes: notes || null,
    });

    if (error) {
      setAlert("Error al guardar en BD: " + error.message, "bad");
      return;
    }
    if (!data?.[0]?.ok) {
      setAlert(data?.[0]?.message || "No se pudo guardar la cita.", "bad");
      return;
    }

    const dbId = data?.[0]?.id || null;

    // 2) Guardar en local también (para UI del dispositivo)
    const appt = {
      id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
      db_id: dbId,
      name,
      lastName,
      phone,
      email,
      service,
      notes,
      date,
      time,
      duration,
      price,
      createdAt: new Date().toISOString(),
    };

    const list = loadAppointments();
    list.push(appt);
    saveAppointments(list);

    // refresca busy + UI
    await refreshRemoteBusyWide();
    renderAppointments();
    renderFreeSlots();
    enablePostCreateActions(appt);

    setAlert("Cita guardada ✅ (también en la base de datos).", "ok");
    populateTimes();
  });

  document.querySelectorAll(".serviceBtn").forEach((b) => {
    b.addEventListener("click", () => {
      const service = b.getAttribute("data-service");
      if (!service) return;
      serviceSelect.value = service;
      if (selectedDate) populateTimes();
      document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth" });
      setAlert(`Servicio seleccionado: ${service}. Ahora elige día y hora.`, "ok");
    });
  });

  // =====================
  // RESEÑAS (RPC)
  // =====================
  const reviewForm = document.getElementById("reviewForm");
  const reviewAlert = document.getElementById("reviewAlert");
  const reviewsList = document.getElementById("reviewsList");

  const reviewName = document.getElementById("reviewName");
  const reviewLastName = document.getElementById("reviewLastName");
  const reviewPhone = document.getElementById("reviewPhone");
  const reviewEmail = document.getElementById("reviewEmail");
  const reviewComment = document.getElementById("reviewComment");
  const starRating = document.getElementById("starRating");

  let currentRating = 0;

  function setReviewAlert(text, type){
    if (!reviewAlert) return;
    reviewAlert.textContent = text || "";
    reviewAlert.classList.remove("alert--ok","alert--bad");
    if (type === "ok") reviewAlert.classList.add("alert--ok");
    if (type === "bad") reviewAlert.classList.add("alert--bad");
  }
  function paintStars(n){
    currentRating = n;
    starRating?.querySelectorAll(".star").forEach(btn=>{
      const v = Number(btn.dataset.value || 0);
      btn.classList.toggle("is-on", v <= n);
    });
  }
  starRating?.querySelectorAll(".star").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      paintStars(Number(btn.dataset.value || 0));
    });
  });
  function starsText(n){
    return "★★★★★".slice(0,n) + "☆☆☆☆☆".slice(0,5-n);
  }

  async function loadPublicReviews(){
    if (!reviewsList) return;
    const { data, error } = await db.rpc("get_public_reviews", { p_limit: 6 });
    if (error){
      if (DEBUG) console.warn("get_public_reviews error:", error);
      return;
    }

    reviewsList.innerHTML = "";
    (data || []).forEach(r=>{
      const div = document.createElement("div");
      div.className = "reviewItem";
      const dt = new Date(r.created_at);
      div.innerHTML = `
      <div class="reviewTop">
          <div class="reviewName">${r.name}</div>
          <div class="reviewDate">${dt.toLocaleDateString("es-ES")}</div>
        </div>
        <div class="reviewStars">${starsText(r.rating)}</div>
        <div class="reviewText">${r.comment}</div>

        <div class="reviewActions" style="margin-top:10px;">
          <button class="smallBtn" data-action="deleteReview" data-id="${r.id}">
            Borrar
          </button>
        <div class="muted" style="font-size:12px; margin-top:6px;">
            (Se borrará si el email y teléfono del formulario coinciden con los usados al reseñar)
          </div>
    </div>
`;
      div.querySelector('[data-action="deleteReview"]').addEventListener("click", async () => {
  const reviewId = div.querySelector('[data-action="deleteReview"]').dataset.id;

  const em = (reviewEmail?.value || "").trim();
  const ph = (reviewPhone?.value || "").trim();

  if (!em || !ph) {
    setReviewAlert("Para borrar una reseña, escribe tu email y teléfono en el formulario.", "bad");
    return;
  }

  const { data, error } = await db.rpc("delete_review", {
    p_review_id: reviewId,
    p_email: em,
    p_phone: ph,
  });

  if (error) {
    setReviewAlert("Error al borrar: " + error.message, "bad");
    return;
  }
  if (!data?.[0]?.ok) {
    setReviewAlert(data?.[0]?.message || "No se pudo borrar.", "bad");
    return;
  }

  setReviewAlert("Reseña borrada ✅", "ok");
  await loadPublicReviews();
});


      reviewsList.appendChild(div);
    });

    if (!reviewsList.children.length){
      reviewsList.innerHTML = `<div class="reviewItem">Aún no hay reseñas.</div>`;
    }
  }

  function syncReviewFromBooking(){
    reviewName.value = nameInput.value || reviewName.value;
    reviewLastName.value = lastNameInput.value || reviewLastName.value;
    reviewPhone.value = phoneInput.value || reviewPhone.value;
    reviewEmail.value = emailInput.value || reviewEmail.value;
  }
  [nameInput, lastNameInput, phoneInput, emailInput].forEach(el=>{
    el?.addEventListener("input", syncReviewFromBooking);
  });
  syncReviewFromBooking();

  reviewForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();

    const n = reviewName.value.trim();
    const ln = reviewLastName.value.trim();
    const ph = reviewPhone.value.trim();
    const em = reviewEmail.value.trim();
    const cm = reviewComment.value.trim();

    if (!n || !ln || !ph || !em || !cm){
      setReviewAlert("Completa todos los campos de la reseña.", "bad");
      return;
    }
    if (currentRating < 1 || currentRating > 5){
      setReviewAlert("Selecciona una valoración de 1 a 5 estrellas.", "bad");
      return;
    }

    // ✅ BD valida: (cita existe) AND (NO anulada) AND (en el pasado)
    const { data, error } = await db.rpc("submit_review", {
      p_name: n,
      p_last_name: ln,
      p_email: em,
      p_phone: ph,
      p_rating: currentRating,
      p_comment: cm,
    });

    if (error){
      setReviewAlert("Error: " + error.message, "bad");
      return;
    }
    if (!data?.[0]?.ok){
      setReviewAlert(data?.[0]?.message || "No se pudo enviar la reseña.", "bad");
      return;
    }

    setReviewAlert("Reseña enviada ✅ ¡Gracias!", "ok");
    reviewComment.value = "";
    paintStars(0);
    await loadPublicReviews();
  });

  // =====================
  // Init
  // =====================
  (async () => {
    await refreshRemoteBusyWide();
    renderCalendar();
    renderAppointments();
    renderFreeSlots();
    populateTimes();
    await loadPublicReviews();

    // autoseleccionar hoy (si está abierto)
    const t = new Date();
    if (!isPast(t) && !isClosed(t)) {
      selectedDate = t;
      dateValue.value = toISODate(t);
      selectedDateText.textContent = niceSpanishDate(dateValue.value);
      populateTimes();
      renderCalendar();
    }
  })();
});
