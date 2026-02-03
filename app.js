// =====================
// CONFIG (edita esto)
// =====================

const DEBUG = true;

// 1) Supabase
const SUPABASE_URL = "https://nhoaoyfbibykonelewkr.supabase.co"; // <- Data API > Project URL
const SUPABASE_ANON_KEY ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ob2FveWZiaWJ5a29uZWxld2tyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMzI0NzksImV4cCI6MjA4NTcwODQ3OX0.mBGWd7vJmO-9l32_lqP676fyU0rYQB3ce8D433mxfQM"; // <- Settings > API Keys > anon/public (la larga)

// 2) WhatsApp (tu número con prefijo país, España: 34 + número)
const WHATSAPP_NUMBER = "34617494566";

// =====================
// Disponibilidad rápida (AJUSTA)
// =====================
// “Huecos” se calculan como slots disponibles de AVAILABILITY_SLOT_MIN
const FREE_DAYS_AHEAD = 10; // próximos X días a revisar
const AVAILABILITY_SLOT_MIN = 30; // “un hueco” = 30 min (pon 15 si quieres más fino)
const SCARCITY_CRITICAL = 5; // 🔥 cuando queden 5 o menos -> “poca disponibilidad”
const SCARCITY_WARNING = 10; // ⚠️ cuando queden 10 o menos -> “se está llenando”
const SHOW_SCARCITY_ONLY = true; // true = solo muestra días con poca disponibilidad
const SHOW_FREE_AS_RANGES = true; // true: rangos (10:00–12:00) / false: horas sueltas

// Horarios
const HOURS = {
  // 0 = domingo, 6 = sábado
  default: [
    { start: "10:00", end: "14:00" },
    { start: "16:00", end: "20:00" },
  ],
  saturday: [{ start: "10:00", end: "14:00" }],
  sunday: [], // cerrado
};

// Paso entre horas mostradas (para el selector de horas)
const SLOT_STEP_MIN = 15;

// Servicios (precio + duración)
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
  return (
    value.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "€"
  );
}

// =====================
// Helpers
// =====================
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function parseTimeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function niceSpanishDate(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
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
function todayStart() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}
function isPast(date) {
  const t = todayStart();
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return d < t;
}
function isClosed(date) {
  const day = date.getDay();
  return day === 0; // domingo cerrado
}

// =====================
// Local storage (solo para "Mis próximas citas en este dispositivo")
// =====================
function loadAppointments() {
  try {
    return JSON.parse(localStorage.getItem("coliseumAppointments") || "[]");
  } catch {
    return [];
  }
}
function saveAppointments(list) {
  localStorage.setItem("coliseumAppointments", JSON.stringify(list));
}

// =====================
// Supabase loader + client
// =====================
async function ensureSupabaseLoaded() {
  if (window.supabase?.createClient) return window.supabase;

  // Carga automática si no está (por si el orden de scripts está mal)
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar supabase-js"));
    document.head.appendChild(s);
  });

  if (!window.supabase?.createClient) {
    throw new Error("Supabase no está disponible tras cargar el script.");
  }
  return window.supabase;
}

let db = null;

// =====================
// Busy slots (desde Supabase) - cache
// =====================
const busyCache = new Map(); // key: "YYYY-MM-DD..YYYY-MM-DD" -> map(dateISO -> intervals[])

function rowToInterval(row) {
  // row.time puede venir como "11:00:00" o "11:00"
  const t = String(row.time).slice(0, 5);
  const start = parseTimeToMinutes(t);
  const dur = Number(row.duration) || 0;
  return { start, end: start + dur };
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a.start - b.start);
  const out = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const prev = out[out.length - 1];
    const cur = intervals[i];
    if (cur.start <= prev.end) prev.end = Math.max(prev.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

async function fetchBusyRange(dateFromISO, dateToISO) {
  if (!db) return new Map();

  const key = `${dateFromISO}..${dateToISO}`;
  if (busyCache.has(key)) return busyCache.get(key);

  const { data, error } = await db.rpc("get_busy_slots", {
    date_from: dateFromISO,
    date_to: dateToISO,
  });

  if (error) {
    if (DEBUG) console.warn("get_busy_slots error:", error);
    return new Map();
  }

  const map = new Map(); // dateISO -> intervals[]
  (data || []).forEach((row) => {
    const dateISO = String(row.date); // suele venir "YYYY-MM-DD"
    const arr = map.get(dateISO) || [];
    arr.push(rowToInterval(row));
    map.set(dateISO, arr);
  });

  // merge por día
  for (const [k, arr] of map.entries()) {
    map.set(k, mergeIntervals(arr));
  }

  busyCache.set(key, map);
  if (DEBUG) console.log("busy slots:", data, error);
  return map;
}

async function getBusyIntervalsForDay(dateISO) {
  const map = await fetchBusyRange(dateISO, dateISO);
  return map.get(dateISO) || [];
}

// =====================
// Intervals math (para rangos libres)
// =====================
function subtractIntervals(openRange, busyIntervals) {
  const res = [];
  let cursor = openRange.start;

  for (const b of busyIntervals) {
    if (b.end <= cursor) continue;
    if (b.start >= openRange.end) break;

    const s = Math.max(cursor, openRange.start);
    const e = Math.min(b.start, openRange.end);
    if (e > s) res.push({ start: s, end: e });

    cursor = Math.max(cursor, b.end);
    if (cursor >= openRange.end) break;
  }

  if (cursor < openRange.end) res.push({ start: cursor, end: openRange.end });
  return res;
}

function getFreeRangesForDay(date, busyIntervals) {
  const ranges = getRangesForDate(date);
  let freeRanges = [];

  for (const r of ranges) {
    const openRange = {
      start: parseTimeToMinutes(r.start),
      end: parseTimeToMinutes(r.end),
    };
    freeRanges = freeRanges.concat(subtractIntervals(openRange, busyIntervals));
  }
  return freeRanges;
}

// Cuenta cuántos inicios de “hueco” quedan (en pasos de AVAILABILITY_SLOT_MIN)
// pero respetando citas busyIntervals (de Supabase)
function countAvailableStarts(date, durationMin, busyIntervals) {
  // Generamos posibles inicios cada SLOT_STEP_MIN según horario
  let slots = generateSlotsForDate(date, durationMin);

  slots = slots.filter((time) => {
    const start = parseTimeToMinutes(time);
    const end = start + durationMin;
    return !busyIntervals.some((b) => start < b.end && end > b.start);
  });

  return slots;
}

// =====================
// WhatsApp
// =====================
function buildWhatsAppLink(appt) {
  const number = (WHATSAPP_NUMBER || "").replace(/\D/g, "");
  if (!number) return null;

  const priceTxt = appt.price != null ? ` (${formatEuro(appt.price)})` : "";

  const text =
    `Hola! Quiero reservar en EL COLISEUM.%0A` +
    `Nombre: ${encodeURIComponent(appt.name)}%0A` +
    `Teléfono: ${encodeURIComponent(appt.phone)}%0A` +
    `Servicio: ${encodeURIComponent(appt.service + priceTxt)}%0A` +
    `Día: ${encodeURIComponent(niceSpanishDate(appt.date))}%0A` +
    `Hora: ${encodeURIComponent(appt.time)}%0A` +
    `Duración: ${encodeURIComponent(
      String(appt.duration || getServiceDuration(appt.service)) + " min"
    )}%0A` +
    (appt.notes ? `Nota: ${encodeURIComponent(appt.notes)}%0A` : "") +
    `Gracias!`;

  return `https://wa.me/${number}?text=${text}`;
}

// =====================
// ICS download
// =====================
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
function toICSDateTime(dateISO, timeHHMM) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeHHMM.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(
    dt.getDate()
  )}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
}
function downloadICS(appt) {
  const dtStart = toICSDateTime(appt.date, appt.time);
  const durationMin = appt.duration ?? getServiceDuration(appt.service);

  const [y, mo, d] = appt.date.split("-").map(Number);
  const [hh, mm] = appt.time.split(":").map(Number);
  const end = new Date(y, mo - 1, d, hh, mm, 0);
  end.setMinutes(end.getMinutes() + durationMin);

  const dtEnd = `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(
    end.getDate()
  )}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`;

  const uid = `${appt.id}@elcoliseum`;
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(
    now.getDate()
  )}T${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(
    now.getSeconds()
  )}`;

  const priceTxt = appt.price != null ? ` (${formatEuro(appt.price)})` : "";
  const summary = `Cita - EL COLISEUM (${appt.service}${priceTxt})`;

  const description =
    `Cliente: ${appt.name}\\n` +
    `Teléfono: ${appt.phone}\\n` +
    `Servicio: ${appt.service}${priceTxt}\\n` +
    `Duración: ${durationMin} min\\n` +
    (appt.notes ? `Nota: ${appt.notes}\\n` : "");

  const ics = `BEGIN:VCALENDAR
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

  downloadTextFile(
    `cita-elcoliseum-${appt.date}-${appt.time}.ics`,
    ics,
    "text/calendar"
  );
}

// =====================
// MAIN APP
// =====================
document.addEventListener("DOMContentLoaded", async () => {
  // 1) Supabase ready
  try {
    const supa = await ensureSupabaseLoaded();
    db = supa.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    if (DEBUG) {
      // test suave: no imprime datos si no hay SELECT policy (es normal que salga [])
      const { data, error } = await db
        .from("appointments")
        .select("*")
        .limit(1);
      console.log("appointments select:", data, error);
    }
  } catch (e) {
    console.warn("Supabase no disponible:", e);
    db = null;
  }

  // =====================
  // Reveal animations
  // =====================
  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add("is-visible");
      });
    },
    { threshold: 0.12 }
  );
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
  const phoneInput = document.getElementById("phone");
  const serviceSelect = document.getElementById("service");
  const notesInput = document.getElementById("notes");

  let view = new Date();
  view.setDate(1);

  let selectedDate = null;
  let lastCreatedAppointment = null;

  // =====================
  // Alerts
  // =====================
  function setAlert(text, type) {
    if (!alertBox) return;
    alertBox.textContent = text || "";
    alertBox.classList.remove("alert--ok", "alert--bad");
    if (type === "ok") alertBox.classList.add("alert--ok");
    if (type === "bad") alertBox.classList.add("alert--bad");
  }

  // =====================
  // Appointments UI (local)
  // =====================
  function renderAppointments() {
    const list = loadAppointments();
    list.sort((a, b) => {
      const da = new Date(`${a.date}T${a.time}:00`);
      const dbb = new Date(`${b.date}T${b.time}:00`);
      return da - dbb;
    });

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
          <div class="appt__title">${a.name}</div>
          <div class="appt__meta">${niceSpanishDate(a.date)} · ${a.time} · ${
        a.service
      }${priceTxt}${durTxt}${extra}</div>
        </div>
        <div class="appt__actions">
          <button class="smallBtn" data-action="ics">.ics</button>
          <button class="smallBtn" data-action="delete">Eliminar</button>
        </div>
      `;

      li.querySelector('[data-action="ics"]').addEventListener("click", () => {
        downloadICS(a);
      });

      li.querySelector('[data-action="delete"]').addEventListener("click", () => {
        const next = loadAppointments().filter((x) => x.id !== a.id);
        saveAppointments(next);
        renderAppointments();
        renderFreeSlots(); // refresca disponibilidad
        setAlert("Cita eliminada.", "ok");
        populateTimes();
      });

      apptList.appendChild(li);
    });
  }

  // =====================
  // Post create actions
  // =====================
  function enablePostCreateActions(appt) {
    lastCreatedAppointment = appt;

    const wa = buildWhatsAppLink(appt);
    if (whatsBtn) whatsBtn.disabled = !wa;
    if (downloadIcsBtn) downloadIcsBtn.disabled = false;

    if (!wa && !WHATSAPP_NUMBER) {
      setAlert(
        "Cita guardada ✅. Para enviar por WhatsApp, edita WHATSAPP_NUMBER en app.js (arriba del todo).",
        "ok"
      );
    }
  }

  // =====================
  // Calendar render
  // =====================
  function renderCalendar() {
    if (!monthLabel || !grid) return;

    const monthName = view.toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric",
    });
    monthLabel.textContent = monthName[0].toUpperCase() + monthName.slice(1);

    grid.innerHTML = "";

    const firstDayOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
    const lastDayOfMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0);

    const jsDay = firstDayOfMonth.getDay();
    const mondayIndex = (jsDay + 6) % 7;
    const blanks = mondayIndex;

    for (let i = 0; i < blanks; i++) {
      const blank = document.createElement("div");
      blank.className = "day day--off";
      blank.textContent = "";
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
      if (selectedDate && sameDay(date, selectedDate))
        cell.classList.add("day--selected");

      cell.addEventListener("click", () => {
        if (off) return;

        selectedDate = date;
        dateValue.value = toISODate(date);
        if (selectedDateText)
          selectedDateText.textContent = niceSpanishDate(dateValue.value);

        populateTimes();
        setAlert("");
        renderCalendar();
      });

      grid.appendChild(cell);
    }
  }

  // =====================
  // Times (según servicio + busy slots de Supabase)
  // =====================
  async function populateTimes() {
    if (!timeSelect) return;

    timeSelect.innerHTML = "";

    if (!selectedDate) {
      const opt = document.createElement("option");
      opt.textContent = "Elige un día primero";
      opt.disabled = true;
      opt.selected = true;
      timeSelect.appendChild(opt);
      return;
    }

    const service = serviceSelect?.value || "";
    const durationMin = getServiceDuration(service);

    let slots = generateSlotsForDate(selectedDate, durationMin);

    const dateISO = toISODate(selectedDate);

    // Busy intervals reales desde Supabase
    let busyIntervals = [];
    if (db) {
      busyIntervals = await getBusyIntervalsForDay(dateISO);
    }

    slots = slots.filter((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busyIntervals.some((b) => start < b.end && end > b.start);
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
    first.textContent = service
      ? "Selecciona una hora"
      : "Selecciona un servicio primero";
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

  serviceSelect?.addEventListener("change", () => {
    if (selectedDate) populateTimes();
  });

  // =====================
  // Disponibilidad rápida (desde Supabase)
  // =====================
  async function renderFreeSlots() {
    if (!freeSlotsGrid) return;
    freeSlotsGrid.innerHTML = "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fromISO = toISODate(today);
    const to = new Date(today);
    to.setDate(today.getDate() + (FREE_DAYS_AHEAD - 1));
    const toISO = toISODate(to);

    // busy para todo el rango en una sola llamada
    let busyMap = new Map();
    if (db) {
      busyMap = await fetchBusyRange(fromISO, toISO);
    }

    for (let i = 0; i < FREE_DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      if (isClosed(d)) continue;

      const iso = toISODate(d);

      const totalSlots = generateSlotsForDate(d, AVAILABILITY_SLOT_MIN).length;
      const busyIntervals = busyMap.get(iso) || [];

      const availableStarts = countAvailableStarts(
        d,
        AVAILABILITY_SLOT_MIN,
        busyIntervals
      );
      const remaining = availableStarts.length;

      if (SHOW_SCARCITY_ONLY && remaining > SCARCITY_WARNING) continue;

      const severity =
        remaining <= SCARCITY_CRITICAL
          ? "critical"
          : remaining <= SCARCITY_WARNING
          ? "warning"
          : "ok";

      const freeRanges = getFreeRangesForDay(d, busyIntervals);
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
              severity === "critical"
                ? "🔥 Poca disponibilidad"
                : severity === "warning"
                ? "⚠️ Se está llenando"
                : "✅ Bastante disponible"
            }
          </div>
        </div>
        <button class="smallBtn" type="button">Elegir</button>
      `;

      top.querySelector("button").addEventListener("click", () => {
        selectedDate = d;
        dateValue.value = iso;
        if (selectedDateText)
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
        availableStarts.slice(0, 12).forEach((t) => {
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
      freeSlotsGrid.innerHTML = `<div class="dayCard">
        <div class="dayTitle">Sin alertas de disponibilidad</div>
        <div class="daySub">No hay días “justos” en los próximos ${FREE_DAYS_AHEAD} días.</div>
      </div>`;
    }
  }

  // =====================
  // Events
  // =====================
  prevMonthBtn?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    renderCalendar();
  });
  nextMonthBtn?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    renderCalendar();
  });

  whatsBtn?.addEventListener("click", () => {
    if (!lastCreatedAppointment) return;
    const wa = buildWhatsAppLink(lastCreatedAppointment);
    if (!wa) {
      setAlert("Falta configurar WHATSAPP_NUMBER en app.js.", "bad");
      return;
    }
    window.location.href = wa;
  });

  downloadIcsBtn?.addEventListener("click", () => {
    if (!lastCreatedAppointment) return;
    downloadICS(lastCreatedAppointment);
  });

  // =====================
  // SUBMIT: guarda en Supabase + también en localStorage (para la lista local)
  // =====================
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const service = serviceSelect.value;
    const notes = notesInput.value.trim();
    const date = dateValue.value;
    const time = timeSelect.value;

    if (!name || !phone || !service || !date || !time) {
      setAlert("Completa nombre, teléfono, servicio, día y hora.", "bad");
      return;
    }

    const duration = getServiceDuration(service);
    const price = getServicePrice(service);

    // 1) Guardar en BD (si está disponible)
    if (db) {
      const { data, error } = await db.rpc("book_appointment", {
        p_name: name,
        p_phone: phone,
        p_date: date,
        p_time: time,
        p_service: service,
        p_duration: duration,
        p_notes: notes || null,
      });

      if (error) {
        setAlert("Error guardando en la base de datos: " + error.message, "bad");
        return;
      }
      if (!data?.[0]?.ok) {
        setAlert(data?.[0]?.message || "No se pudo guardar la cita.", "bad");
        return;
      }

      // limpia cache busy para que se refresque al momento
      busyCache.clear();
    } else {
      // Si no hay BD, al menos avisamos
      setAlert(
        "No se pudo conectar con la base de datos. Guardando solo en este dispositivo.",
        "bad"
      );
    }

    // 2) Guardar también localmente (para “Mis próximas citas” de este dispositivo)
    const appt = {
      id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      phone,
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

    renderAppointments();
    await renderFreeSlots();
    await populateTimes();
    enablePostCreateActions(appt);

    setAlert(
      "Cita guardada ✅ Ahora puedes enviarla por WhatsApp o descargar el recordatorio (.ics).",
      "ok"
    );
  });

  // =====================
  // Botones "Reservar" de servicios
  // =====================
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
  // Init
  // =====================
  renderCalendar();
  renderAppointments();
  await renderFreeSlots();
  await populateTimes();

  (function autoSelectToday() {
    const t = new Date();
    if (!isPast(t) && !isClosed(t)) {
      selectedDate = t;
      dateValue.value = toISODate(t);
      if (selectedDateText)
        selectedDateText.textContent = niceSpanishDate(dateValue.value);
      populateTimes();
      renderCalendar();
    }
  })();
});
