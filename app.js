// =====================
// CONFIG (edita esto)
// =====================
const SUPABASE_URL = "https://nhoaoyfbibykonelewkr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ob2FveWZiaWJ5a29uZWxld2tyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMzI0NzksImV4cCI6MjA4NTcwODQ3OX0.mBGWd7vJmO-9l32_lqP676fyU0rYQB3ce8D433mxfQM";
const WHATSAPP_NUMBER = "34617494566"; // con prefijo país
const DEBUG = true;

// =====================
// Disponibilidad rápida (AJUSTA)
// =====================
const FREE_DAYS_AHEAD = 10;
const AVAILABILITY_SLOT_MIN = 30;
const SCARCITY_CRITICAL = 5;
const SCARCITY_WARNING = 10;
const SHOW_SCARCITY_ONLY = true;
const SHOW_FREE_AS_RANGES = true;

const HOURS = {
  default: [
    { start: "10:00", end: "14:00" },
    { start: "16:00", end: "21:00" },
  ],
  tuesday: [{ start: "16:00", end: "20:00" }],
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
  const day = date.getDay(); // 0=Dom, 1=Lun, 2=Mar, ... 6=Sab
  if (day === 0) return HOURS.sunday;
  if (day === 6) return HOURS.saturday;
  if (day === 2) return HOURS.tuesday; // martes
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
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a.start - b.start);

  const out = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const prev = out[out.length - 1];
    const cur = intervals[i];
    if (cur.start <= prev.end) prev.end = Math.max(prev.end, cur.end);
    else out.push(cur);
  }
  return out;
}
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

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isTodayISO(iso) {
  const todayISO = new Date().toISOString().slice(0, 10);
  return iso === todayISO;
}

// Devuelve true si esa hora (start) ya está en el pasado para HOY
function isPastStartTimeForToday(dateISO, startHHMM) {
  if (!isTodayISO(dateISO)) return false;
  const startMin = parseTimeToMinutes(startHHMM);
  return startMin <= getNowMinutes();
}

function purgeExpiredLocalAppointments() {
  const list = loadAppointments();
  if (!list.length) return;

  const now = new Date();
  const nowISO = now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const GRACE_MIN = 2; // margen

  const kept = list.filter((a) => {
    // si es de un día anterior => fuera
    if (a.date < nowISO) return false;

    // si es de un día posterior => se queda
    if (a.date > nowISO) return true;

    // si es de hoy => comprobamos si ya terminó
    const startMin = parseTimeToMinutes(a.time);
    const dur = a.duration ?? getServiceDuration(a.service);
    const endMin = startMin + dur;

    return endMin + GRACE_MIN > nowMin;
  });

  if (kept.length !== list.length) {
    saveAppointments(kept);
  }
}

// ¿Este día tiene AL MENOS 1 hueco reservable?
function hasAnyAvailabilityForDay(date, durationMin) {
  // cerrado (domingo) => no
  if (isClosed(date)) return false;

  const iso = toISODate(date);

  // si es pasado => no
  if (isPast(date)) return false;

  // genera slots y filtra ocupados
  const slots = generateSlotsForDate(date, durationMin);
  if (!slots.length) return false;

  const busySet = getBusySetForDateISO(iso, durationMin);
  for (const s of slots) {
    // si hoy y ya pasó esa hora => fuera
    if (isPastStartTimeForToday(iso, s)) continue;

    if (!busySet.has(s)) return true;
  }
  return false;
}

// =====================
// Persistencia local (localStorage)
// =====================
const STORAGE_KEY = "peluqueria_appointments_v1";

function loadAppointments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
function saveAppointments(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// =====================
// Supabase (cargar ocupados remotos)
// =====================

// Estructura:
// remoteBusyByDate[iso] = [{start:"10:00", end:"10:30"}, ...]
const remoteBusyByDate = Object.create(null);

// Helpers: rango de "slot" a intervalo
function slotInterval(startHHMM, durationMin) {
  const s = parseTimeToMinutes(startHHMM);
  return { start: s, end: s + durationMin };
}

// Convierte lista de ocupados (intervalos) a set de slots ocupados (para un durationMin)
function busyIntervalsToBusySet(date, durationMin, busyIntervals) {
  const set = new Set();
  const slots = generateSlotsForDate(date, durationMin);
  for (const s of slots) {
    const interval = slotInterval(s, durationMin);
    // si interval solapa con alguno busy => ocupado
    if (
      busyIntervals.some((b) => interval.start < b.end && interval.end > b.start)
    ) {
      set.add(s);
    }
  }
  return set;
}

// Para un día iso, devuelve Set de slots ocupados combinando local+remote
function getBusySetForDateISO(iso, durationMin) {
  const [y, mo, d] = iso.split("-").map(Number);
  const date = new Date(y, mo - 1, d);

  // remoto
  const remote = remoteBusyByDate[iso] ?? [];
  const remoteMerged = mergeIntervals(remote);

  // local
  const localApps = loadAppointments().filter((a) => a.date === iso);
  const localIntervals = localApps.map((a) => {
    const dur = a.duration ?? getServiceDuration(a.service);
    return slotInterval(a.time, dur);
  });
  const localMerged = mergeIntervals(localIntervals);

  const merged = mergeIntervals([...remoteMerged, ...localMerged]);

  return busyIntervalsToBusySet(date, durationMin, merged);
}

async function loadRemoteBusySlotsForMonth(year, monthIndex) {
  // monthIndex: 0..11
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  const startISO = toISODate(start);
  const endISO = toISODate(end);

  const url = `${SUPABASE_URL}/rest/v1/rpc/get_busy_slots`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start_date: startISO,
        end_date: endISO,
      }),
    });

    if (!res.ok) {
      if (DEBUG) console.warn("Error loading busy slots", res.status);
      return;
    }

    const rows = await res.json();

    // Limpia del mes actual (para evitar acumular)
    for (let d = 1; d <= end.getDate(); d++) {
      const iso = toISODate(new Date(year, monthIndex, d));
      remoteBusyByDate[iso] = [];
    }

    // Agrupa por fecha
    for (const r of rows) {
      const dateISO = r.date;
      const startHHMM = r.start;
      const endHHMM = r.end;

      const interval = {
        start: parseTimeToMinutes(startHHMM),
        end: parseTimeToMinutes(endHHMM),
      };

      if (!remoteBusyByDate[dateISO]) remoteBusyByDate[dateISO] = [];
      remoteBusyByDate[dateISO].push(interval);
    }

    // Merge por día
    Object.keys(remoteBusyByDate).forEach((k) => {
      remoteBusyByDate[k] = mergeIntervals(remoteBusyByDate[k] ?? []);
    });

    if (DEBUG) console.log("busy slots loaded:", rows.length);
  } catch (e) {
    if (DEBUG) console.warn("Error loading busy slots", e);
  }
}

// =====================
// DOM
// =====================
const monthLabel = document.getElementById("monthLabel");
const prevBtn = document.getElementById("prevMonth");
const nextBtn = document.getElementById("nextMonth");
const grid = document.getElementById("calendarGrid");

const nameInput = document.getElementById("name");
const surnameInput = document.getElementById("surname");
const phoneInput = document.getElementById("phone");
const emailInput = document.getElementById("email");
const serviceSelect = document.getElementById("service");
const timeSelect = document.getElementById("time");
const noteInput = document.getElementById("note");

const dateValue = document.getElementById("dateValue");
const selectedDateText = document.getElementById("selectedDateText");
const alertBox = document.getElementById("alertBox");

const confirmBtn = document.getElementById("confirmBtn");
const whatsappBtn = document.getElementById("whatsappBtn");

const icsLink = document.getElementById("icsLink");

// Quick availability
const quickContainer = document.getElementById("quickAvailability");
const quickText = document.getElementById("quickText");

function setAlert(msg, type = "") {
  if (!alertBox) return;
  alertBox.textContent = msg || "";
  alertBox.className = "alert " + (type ? `alert--${type}` : "");
}

// =====================
// Fecha/mes seleccionados
// =====================
let view = new Date();
view.setDate(1);

let selectedDate = null;

// =====================
// Cierres/pasado
// =====================
function isPast(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  return d < today;
}

function isClosed(date) {
  const ranges = getRangesForDate(date);
  return !ranges || ranges.length === 0;
}

// ✅ Esta es la FUNCIÓN BUENA (la que usa el date que le pasas)
function isTooLateToBookToday(date, durationMin = AVAILABILITY_SLOT_MIN) {
  const now = new Date();
  if (!sameDay(date, now)) return false;

  if (isClosed(date)) return true;

  const ranges = getRangesForDate(date);
  if (!ranges || !ranges.length) return true;

  const lastRange = ranges[ranges.length - 1];
  const closeMin = parseTimeToMinutes(lastRange.end);
  const lastStartAllowed = closeMin - durationMin;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin > lastStartAllowed;
}

// =====================
// Populate servicios y horas
// =====================
function populateServices() {
  if (!serviceSelect) return;

  serviceSelect.innerHTML = `<option value="">Selecciona un servicio</option>`;
  Object.keys(SERVICE_META).forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;

    const price = getServicePrice(name);
    opt.textContent = price ? `${name} — ${formatEuro(price)}` : name;

    serviceSelect.appendChild(opt);
  });
}

function populateTimes() {
  if (!timeSelect) return;

  timeSelect.innerHTML = `<option value="">Selecciona un servicio primero</option>`;

  if (!selectedDate) return;

  const serviceName = serviceSelect?.value;
  const durationMin = serviceName ? getServiceDuration(serviceName) : AVAILABILITY_SLOT_MIN;

  const iso = toISODate(selectedDate);

  const slots = generateSlotsForDate(selectedDate, durationMin);
  const busySet = getBusySetForDateISO(iso, durationMin);

  const available = slots.filter((s) => {
    if (isPastStartTimeForToday(iso, s)) return false;
    return !busySet.has(s);
  });

  timeSelect.innerHTML = `<option value="">Selecciona una hora</option>`;

  if (!available.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No hay horarios disponibles";
    opt.disabled = true;
    timeSelect.appendChild(opt);
    return;
  }

  for (const t of available) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    timeSelect.appendChild(opt);
  }
}

// =====================
// Calendar render
// =====================
function renderCalendar() {
  if (!monthLabel || !grid) return;

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

    const baseDuration = serviceSelect?.value
      ? getServiceDuration(serviceSelect.value)
      : AVAILABILITY_SLOT_MIN;

    const closedOrPast =
      isPast(date) ||
      isClosed(date) ||
      isTooLateToBookToday(date, baseDuration);

    const hasAvail = hasAnyAvailabilityForDay(date, baseDuration);

    // Solo deshabilitamos click por cerrado/pasado
    if (closedOrPast) cell.classList.add("day--off");

    // Si está lleno, lo marcamos pero SE PUEDE clicar
    if (!closedOrPast && !hasAvail) cell.classList.add("day--full");

    if (sameDay(date, today)) cell.classList.add("day--today");
    if (selectedDate && sameDay(date, selectedDate)) cell.classList.add("day--selected");

    cell.addEventListener("click", () => {
      if (closedOrPast) return;

      selectedDate = date;
      dateValue.value = toISODate(date);
      selectedDateText.textContent = niceSpanishDate(dateValue.value);

      populateTimes();

      if (!hasAvail) setAlert("Ese día está completo. Prueba otro día.", "bad");
      else setAlert("");

      renderCalendar();
    });

    grid.appendChild(cell);
  }
}

// =====================
// WhatsApp message + confirm
// =====================
function buildSummary() {
  const serviceName = serviceSelect?.value || "";
  const price = serviceName ? getServicePrice(serviceName) : null;

  return {
    name: nameInput?.value?.trim() || "",
    surname: surnameInput?.value?.trim() || "",
    phone: phoneInput?.value?.trim() || "",
    email: emailInput?.value?.trim() || "",
    service: serviceName,
    price,
    dateISO: dateValue?.value || "",
    dateNice: selectedDateText?.textContent || "",
    time: timeSelect?.value || "",
    note: noteInput?.value?.trim() || "",
    duration: serviceName ? getServiceDuration(serviceName) : AVAILABILITY_SLOT_MIN,
  };
}

function validateForm(s) {
  if (!s.dateISO) return "Selecciona un día.";
  if (!s.service) return "Selecciona un servicio.";
  if (!s.time) return "Selecciona una hora.";
  if (!s.name) return "Escribe tu nombre.";
  if (!s.phone) return "Escribe tu teléfono.";
  return "";
}

function makeWhatsappText(s) {
  const lines = [];
  lines.push("¡Hola! Quiero reservar cita ✂️");
  lines.push("");
  lines.push(`Nombre: ${s.name} ${s.surname}`.trim());
  lines.push(`Teléfono: ${s.phone}`);
  if (s.email) lines.push(`Email: ${s.email}`);
  lines.push(`Servicio: ${s.service}${s.price ? ` (${formatEuro(s.price)})` : ""}`);
  lines.push(`Día: ${s.dateNice}`);
  lines.push(`Hora: ${s.time}`);
  if (s.note) lines.push(`Nota: ${s.note}`);
  return lines.join("\n");
}

function openWhatsapp(s) {
  const text = encodeURIComponent(makeWhatsappText(s));
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
  window.open(url, "_blank");
}

function confirmAppointment(s) {
  const err = validateForm(s);
  if (err) {
    setAlert(err, "bad");
    return;
  }

  // guarda local
  const list = loadAppointments();
  list.push({
    id: crypto.randomUUID?.() || String(Date.now()),
    date: s.dateISO,
    time: s.time,
    name: s.name,
    surname: s.surname,
    phone: s.phone,
    email: s.email,
    service: s.service,
    duration: s.duration,
    note: s.note,
    createdAt: new Date().toISOString(),
  });
  saveAppointments(list);

  setAlert("Cita guardada en este dispositivo ✅", "good");

  populateTimes();
  renderCalendar();
  renderQuickAvailability();
}

// =====================
// ICS download
// =====================
function makeICS(s) {
  const [y, mo, d] = s.dateISO.split("-").map(Number);
  const [hh, mm] = s.time.split(":").map(Number);

  const start = new Date(y, mo - 1, d, hh, mm, 0);
  const end = new Date(start.getTime() + (s.duration || 30) * 60000);

  const dt = (x) =>
    `${x.getFullYear()}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}T${pad2(
      x.getHours()
    )}${pad2(x.getMinutes())}00`;

  const uid = `${Date.now()}@peluqueria`;
  const title = `Cita: ${s.service}`;
  const desc = `Servicio: ${s.service}\nCliente: ${s.name} ${s.surname}\nTel: ${s.phone}\nNota: ${
    s.note || ""
  }`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Peluqueria//Citas//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dt(new Date())}`,
    `DTSTART:${dt(start)}`,
    `DTEND:${dt(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${desc.replace(/\n/g, "\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(s) {
  const ics = makeICS(s);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  icsLink.href = url;
  icsLink.download = `cita_${s.dateISO}_${s.time}.ics`;
}

// =====================
// Quick availability panel
// =====================
function formatRange(minStart, minEnd) {
  return `${minutesToTime(minStart)}–${minutesToTime(minEnd)}`;
}

function getOpenMinutesRangesForDate(date) {
  const ranges = getRangesForDate(date);
  return (ranges || []).map((r) => ({
    start: parseTimeToMinutes(r.start),
    end: parseTimeToMinutes(r.end),
  }));
}

function buildFreeRangesForDate(date, durationMin) {
  const iso = toISODate(date);

  const openRanges = getOpenMinutesRangesForDate(date);
  if (!openRanges.length) return [];

  const busySet = getBusySetForDateISO(iso, durationMin);

  // Convert busySet (slots) -> busy intervals for this duration
  const busyIntervals = [];
  for (const startHHMM of busySet) {
    const interval = slotInterval(startHHMM, durationMin);
    busyIntervals.push(interval);
  }

  const mergedBusy = mergeIntervals(busyIntervals);

  // For each open range, subtract busy
  const free = [];
  for (const o of openRanges) {
    const sub = subtractIntervals(o, mergedBusy);

    for (const r of sub) {
      // para hoy, recorta lo que ya pasó
      if (sameDay(date, new Date())) {
        const nowMin = getNowMinutes();
        if (r.end <= nowMin) continue;
        r.start = Math.max(r.start, nowMin);
      }

      // solo rangos que admiten durationMin
      if (r.end - r.start >= durationMin) free.push(r);
    }
  }

  return mergeIntervals(free);
}

function countAvailableSlots(date, durationMin) {
  const slots = generateSlotsForDate(date, durationMin);
  if (!slots.length) return 0;

  const iso = toISODate(date);
  const busySet = getBusySetForDateISO(iso, durationMin);

  let count = 0;
  for (const s of slots) {
    if (isPastStartTimeForToday(iso, s)) continue;
    if (!busySet.has(s)) count++;
  }
  return count;
}

function renderQuickAvailability() {
  if (!quickContainer || !quickText) return;

  // borra
  quickContainer.innerHTML = "";

  const now = new Date();
  const days = [];

  // duración base (si no hay servicio, usamos slot min)
  const durationMin = serviceSelect?.value
    ? getServiceDuration(serviceSelect.value)
    : AVAILABILITY_SLOT_MIN;

  for (let i = 0; i < FREE_DAYS_AHEAD; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);

    // skip pasado/cerrado y si hoy ya es tarde
    if (isPast(d)) continue;
    if (isClosed(d)) continue;
    if (isTooLateToBookToday(d, durationMin)) continue;

    const freeCount = countAvailableSlots(d, durationMin);
    const freeRanges = buildFreeRangesForDate(d, durationMin);

    days.push({
      date: d,
      iso: toISODate(d),
      freeCount,
      freeRanges,
    });
  }

  // ordena por más cercano
  days.sort((a, b) => a.iso.localeCompare(b.iso));

  // filtra si quiere solo escasez
  const filtered = SHOW_SCARCITY_ONLY
    ? days.filter((x) => x.freeCount > 0 && x.freeCount <= SCARCITY_WARNING)
    : days;

  if (!filtered.length) {
    quickText.textContent = "Sin alertas de disponibilidad";
    return;
  }

  quickText.textContent = "";

  for (const item of filtered) {
    const row = document.createElement("div");
    row.className = "quick-row";

    const left = document.createElement("div");
    left.className = "quick-left";

    const title = document.createElement("div");
    title.className = "quick-title";
    title.textContent = item.date.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });

    const meta = document.createElement("div");
    meta.className = "quick-meta";

    const icon = document.createElement("span");
    icon.className = "quick-dot";

    let label = "";
    if (item.freeCount <= SCARCITY_CRITICAL) {
      row.classList.add("quick--critical");
      label = `🔥 pocos huecos (${item.freeCount})`;
    } else if (item.freeCount <= SCARCITY_WARNING) {
      row.classList.add("quick--warning");
      label = `⚠️ se está llenando (${item.freeCount})`;
    } else {
      label = `✅ ${item.freeCount} huecos`;
    }

    meta.textContent = label;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("button");
    right.className = "btn btn--small";
    right.textContent = "Reservar";
    right.addEventListener("click", () => {
      selectedDate = item.date;
      dateValue.value = item.iso;
      selectedDateText.textContent = niceSpanishDate(item.iso);
      populateTimes();
      setAlert("");
      renderCalendar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    row.appendChild(left);

    if (SHOW_FREE_AS_RANGES && item.freeRanges?.length) {
      const rangesEl = document.createElement("div");
      rangesEl.className = "quick-ranges";
      rangesEl.textContent = item.freeRanges
        .slice(0, 3)
        .map((r) => formatRange(r.start, r.end))
        .join(" · ");

      left.appendChild(rangesEl);
    }

    row.appendChild(right);
    quickContainer.appendChild(row);
  }
}

// =====================
// ✅ Auto-saltar al siguiente día si hoy ya está "cerrado" por hora
// (IMPORTANTE: renombrada para que NO pise a isTooLateToBookToday(date,...))
// =====================
function isTooLateToAutoBookToday(minDuration = AVAILABILITY_SLOT_MIN) {
  if (!selectedDate) return false;

  const now = new Date();
  if (!sameDay(selectedDate, now)) return false;

  if (isClosed(selectedDate)) return true;

  const ranges = getRangesForDate(selectedDate);
  if (!ranges || !ranges.length) return true;

  const lastRange = ranges[ranges.length - 1];
  const closeMin = parseTimeToMinutes(lastRange.end);

  const lastStartAllowed = closeMin - minDuration;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin > lastStartAllowed;
}

function autoAdvanceIfTooLate() {
  const minDur = AVAILABILITY_SLOT_MIN;
  if (!selectedDate) return;

  if (isTooLateToAutoBookToday(minDur)) {
    const next = new Date(selectedDate);
    next.setDate(selectedDate.getDate() + 1);

    // busca siguiente día no cerrado
    let guard = 0;
    while (isClosed(next) && guard < 31) {
      next.setDate(next.getDate() + 1);
      guard++;
    }

    selectedDate = next;
    dateValue.value = toISODate(next);
    selectedDateText.textContent = niceSpanishDate(dateValue.value);

    populateTimes();
    renderCalendar();
  }
}

// =====================
// Init
// =====================
async function init() {
  purgeExpiredLocalAppointments();

  populateServices();

  // set default selected date = today (si es reservable)
  const today = new Date();
  if (!isPast(today) && !isClosed(today) && !isTooLateToBookToday(today, AVAILABILITY_SLOT_MIN)) {
    selectedDate = today;
  } else {
    // busca próximo día abierto
    const next = new Date(today);
    let guard = 0;
    do {
      next.setDate(next.getDate() + 1);
      guard++;
    } while ((isClosed(next) || isPast(next)) && guard < 31);

    selectedDate = next;
  }

  dateValue.value = toISODate(selectedDate);
  selectedDateText.textContent = niceSpanishDate(dateValue.value);

  // cargar ocupados del mes actual
  await loadRemoteBusySlotsForMonth(view.getFullYear(), view.getMonth());

  populateTimes();
  renderCalendar();
  renderQuickAvailability();
  autoAdvanceIfTooLate();

  // listeners
  prevBtn?.addEventListener("click", async () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    await loadRemoteBusySlotsForMonth(view.getFullYear(), view.getMonth());
    renderCalendar();
  });

  nextBtn?.addEventListener("click", async () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    await loadRemoteBusySlotsForMonth(view.getFullYear(), view.getMonth());
    renderCalendar();
  });

  serviceSelect?.addEventListener("change", () => {
    populateTimes();
    renderCalendar();
    renderQuickAvailability();
  });

  timeSelect?.addEventListener("change", () => {
    setAlert("");
  });

  confirmBtn?.addEventListener("click", () => {
    const s = buildSummary();
    confirmAppointment(s);
    downloadICS(s);
  });

  whatsappBtn?.addEventListener("click", () => {
    const s = buildSummary();
    const err = validateForm(s);
    if (err) {
      setAlert(err, "bad");
      return;
    }
    openWhatsapp(s);
  });

  icsLink?.addEventListener("click", () => {
    const s = buildSummary();
    const err = validateForm(s);
    if (err) {
      setAlert(err, "bad");
      return;
    }
    downloadICS(s);
  });
}

document.addEventListener("DOMContentLoaded", init);
