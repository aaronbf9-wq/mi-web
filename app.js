// =====================
// CONFIG (edita esto)
// =====================

// ⚠️ Pon aquí TU número (con prefijo). Ejemplo España: "346XXXXXXXX"
const WHATSAPP_NUMBER = ""; // <-- rellena esto

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

// Paso entre horas mostradas (15 min porque tienes servicios de 15/20/45)
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

// Genera slots teniendo en cuenta duración del servicio
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
  return day === 0;
}

// =====================
// Local storage
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

function apptToInterval(appt) {
  const start = parseTimeToMinutes(appt.time);
  const dur = appt.duration ?? getServiceDuration(appt.service);
  return { start, end: start + dur };
}

function hasOverlap(newAppt) {
  const list = loadAppointments();
  const n = apptToInterval(newAppt);

  return list.some((a) => {
    if (a.date !== newAppt.date) return false;
    const o = apptToInterval(a);
    return n.start < o.end && n.end > o.start;
  });
}

// =====================
// Calendar render
// =====================
function renderCalendar() {
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

  const dateISO = toISODate(selectedDate);
  const existing = loadAppointments().filter((a) => a.date === dateISO);

  slots = slots.filter((time) => {
    const probe = { date: dateISO, time, service, duration: durationMin };
    if (!service) return true;

    return !existing.some((a) => {
      const n = apptToInterval(probe);
      const o = apptToInterval(a);
      return n.start < o.end && n.end > o.start;
    });
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
// Alerts
// =====================
function setAlert(text, type) {
  alertBox.textContent = text || "";
  alertBox.classList.remove("alert--ok", "alert--bad");
  if (type === "ok") alertBox.classList.add("alert--ok");
  if (type === "bad") alertBox.classList.add("alert--bad");
}

// =====================
// Appointments UI
// =====================
function renderAppointments() {
  const list = loadAppointments();
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

    const priceTxt = a.price != null ? ` · ${formatEuro(a.price)}` : "";
    const durTxt = a.duration ? ` · ${a.duration} min` : "";
    const extra = a.notes ? ` · Nota: ${a.notes}` : "";

    li.innerHTML = `
      <div class="appt__left">
        <div class="appt__title">${a.name}</div>
        <div class="appt__meta">${niceSpanishDate(a.date)} · ${a.time} · ${a.service}${priceTxt}${durTxt}${extra}</div>
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
      populateTimes();
    });

    apptList.appendChild(li);
  });
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
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
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
    `Cliente: ${appt.name}\\n` +
    `Teléfono: ${appt.phone}\\n` +
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
    `Duración: ${encodeURIComponent(String(appt.duration || getServiceDuration(appt.service)) + " min")}%0A` +
    (appt.notes ? `Nota: ${encodeURIComponent(appt.notes)}%0A` : "") +
    `Gracias!`;

  return `https://wa.me/${number}?text=${text}`;
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

  const duration = getServiceDuration(service);
  const price = getServicePrice(service);

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

  if (hasOverlap(appt)) {
    setAlert("Ese horario se solapa con otra cita guardada. Elige otra hora.", "bad");
    return;
  }

  const list = loadAppointments();
  list.push(appt);
  saveAppointments(list);

  renderAppointments();
  enablePostCreateActions(appt);

  setAlert("Cita guardada ✅ Ahora puedes enviarla por WhatsApp o descargar el recordatorio (.ics).", "ok");

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
// Init
// =====================
renderCalendar();
renderAppointments();
populateTimes();

(function autoSelectToday() {
  const t = new Date();
  if (!isPast(t) && !isClosed(t)) {
    selectedDate = t;
    dateValue.value = toISODate(t);
    selectedDateText.textContent = niceSpanishDate(dateValue.value);
    populateTimes();
    renderCalendar();
  }
})();
