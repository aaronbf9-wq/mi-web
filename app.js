// =====================
// CONFIG (edita esto)
// =====================
const BOOKSY_URL =
  "https://booksy.com/es-es/90583_el-coliseum_barberia_59555_plasencia";

// ⚠️ Pon aquí TU número (con prefijo). Ejemplo España: "346XXXXXXXX"
const WHATSAPP_NUMBER = ""; // <-- rellena esto

// Horarios (puedes cambiarlo)
const HOURS = {
  // 0 = domingo, 6 = sábado
  default: [
    { start: "10:00", end: "14:00" },
    { start: "16:00", end: "20:00" },
  ],
  saturday: [{ start: "10:00", end: "14:00" }],
  sunday: [], // cerrado
};

const SLOT_STEP_MIN = 30;

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
  // iso "YYYY-MM-DD"
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

function generateSlotsForDate(date) {
  const ranges = getRangesForDate(date);
  const slots = [];
  for (const r of ranges) {
    let start = parseTimeToMinutes(r.start);
    const end = parseTimeToMinutes(r.end);

    while (start + SLOT_STEP_MIN <= end) {
      slots.push(minutesToTime(start));
      start += SLOT_STEP_MIN;
    }
  }
  return slots;
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
btn.addEventListener("click", () => {
  msg.textContent = "🔥 Dale a “Agendar cita” y reserva en 20 segundos. ¡Nos vemos en EL COLISEUM! ⚔️";
  msg.classList.remove("glow");
  void msg.offsetWidth; // reflow
  msg.classList.add("glow");
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

const nameInput = document.getElementById("name");
const phoneInput = document.getElementById("phone");
const serviceSelect = document.getElementById("service");
const notesInput = document.getElementById("notes");

let view = new Date();
view.setDate(1);

let selectedDate = null;
let lastCreatedAppointment = null;

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
  if (day === 0) return true; // domingo
  return false;
}

function renderCalendar() {
  const monthName = view.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  monthLabel.textContent = monthName[0].toUpperCase() + monthName.slice(1);

  grid.innerHTML = "";

  const firstDayOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const lastDayOfMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0);

  // Queremos semanas empezando en lunes. JS: domingo=0.
  // Calculamos cuántos "huecos" antes del día 1.
  const jsDay = firstDayOfMonth.getDay(); // 0..6
  const mondayIndex = (jsDay + 6) % 7; // convierte para que lunes=0
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

  const slots = generateSlotsForDate(selectedDate);

  if (slots.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No hay horarios disponibles";
    opt.disabled = true;
    opt.selected = true;
    timeSelect.appendChild(opt);
    return;
  }

  const first = document.createElement("option");
  first.textContent = "Selecciona una hora";
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

function setAlert(text, type) {
  alertBox.textContent = text || "";
  alertBox.classList.remove("alert--ok", "alert--bad");
  if (type === "ok") alertBox.classList.add("alert--ok");
  if (type === "bad") alertBox.classList.add("alert--bad");
}

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

function renderAppointments() {
  const list = loadAppointments();

  // ordenar por fecha/hora
  list.sort((a, b) => {
    const da = new Date(`${a.date}T${a.time}:00`);
    const db = new Date(`${b.date}T${b.time}:00`);
    return da - db;
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

    const desc = `${niceSpanishDate(a.date)} · ${a.time} · ${a.service}`;
    const extra = a.notes ? ` · Nota: ${a.notes}` : "";

    li.innerHTML = `
      <div class="appt__left">
        <div class="appt__title">${a.name}</div>
        <div class="appt__meta">${desc}${extra}</div>
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
      setAlert("Cita eliminada.", "ok");
    });

    apptList.appendChild(li);
  });
}

function hasConflict(newAppt) {
  const list = loadAppointments();
  return list.some((a) => a.date === newAppt.date && a.time === newAppt.time);
}

// =====================
// ICS (calendar) download
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
  // local time -> format YYYYMMDDTHHMM00
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeHHMM.split(":").map(Number);

  const dt = new Date(y, m - 1, d, hh, mm, 0);
  const YYYY = dt.getFullYear();
  const MM = pad2(dt.getMonth() + 1);
  const DD = pad2(dt.getDate());
  const H = pad2(dt.getHours());
  const Min = pad2(dt.getMinutes());
  return `${YYYY}${MM}${DD}T${H}${Min}00`;
}

function downloadICS(appt) {
  const dtStart = toICSDateTime(appt.date, appt.time);
  // duración simple según servicio
  const durationMin =
    appt.service === "Corte + Barba" ? 60 :
    appt.service === "Arreglo + Detalles" ? 20 : 30;

  const [y, mo, d] = appt.date.split("-").map(Number);
  const [hh, mm] = appt.time.split(":").map(Number);
  const end = new Date(y, mo - 1, d, hh, mm, 0);
  end.setMinutes(end.getMinutes() + durationMin);

  const dtEnd = `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`;

  const uid = `${appt.id}@elcoliseum`;
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}T${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

  const summary = `Cita - EL COLISEUM (${appt.service})`;
  const description = `Cliente: ${appt.name}\\nTeléfono: ${appt.phone}${appt.notes ? `\\nNota: ${appt.notes}` : ""}\\nBooksy: ${BOOKSY_URL}`;

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

// =====================
// WhatsApp message
// =====================
function buildWhatsAppLink(appt) {
  const msg = `Hola! Quiero reservar en EL COLISEUM.%0A` +
    `Nombre: ${encodeURIComponent(appt.name)}%0A` +
    `Teléfono: ${encodeURIComponent(appt.phone)}%0A` +
    `Servicio: ${encodeURIComponent(appt.service)}%0A` +
    `Día: ${encodeURIComponent(niceSpanishDate(appt.date))}%0A` +
    `Hora: ${encodeURIComponent(appt.time)}%0A` +
    (appt.notes ? `Nota: ${encodeURIComponent(appt.notes)}%0A` : "") +
    `Gracias!`;

  const number = (WHATSAPP_NUMBER || "").replace(/\D/g, "");
  if (!number) return null;

  return `https://wa.me/${number}?text=${msg}`;
}

function enablePostCreateActions(appt) {
  lastCreatedAppointment = appt;

  const wa = buildWhatsAppLink(appt);
  whatsBtn.disabled = !wa;
  downloadIcsBtn.disabled = false;

  if (!wa && !WHATSAPP_NUMBER) {
    setAlert(
      "Cita guardada ✅. Para enviar por WhatsApp, edita WHATSAPP_NUMBER en app.js (arriba del todo).",
      "ok"
    );
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
  window.open(wa, "_blank", "noopener,noreferrer");
});

downloadIcsBtn.addEventListener("click", () => {
  if (!lastCreatedAppointment) return;
  downloadICS(lastCreatedAppointment);
});

form.addEventListener("submit", (e) => {
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

  const appt = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name,
    phone,
    service,
    notes,
    date,
    time,
    createdAt: new Date().toISOString(),
  };

  if (hasConflict(appt)) {
    setAlert("Esa hora ya está ocupada (en este dispositivo). Elige otra.", "bad");
    return;
  }

  const list = loadAppointments();
  list.push(appt);
  saveAppointments(list);

  renderAppointments();
  enablePostCreateActions(appt);

  setAlert("Cita guardada ✅ Ahora puedes enviarla por WhatsApp o descargar el recordatorio (.ics).", "ok");
});

// =====================
// Init
// =====================
renderCalendar();
populateTimes();
renderAppointments();

// Auto-select hoy si está abierto
(function autoSelectToday(){
  const t = new Date();
  if (!isPast(t) && !isClosed(t)) {
    selectedDate = t;
    dateValue.value = toISODate(t);
    selectedDateText.textContent = niceSpanishDate(dateValue.value);
    populateTimes();
    renderCalendar();
  }
})();
