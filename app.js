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
// (OJO: esta función global NO se usa directamente en el calendario final;
// la lógica real está dentro del DOMContentLoaded)
function hasAnyAvailabilityForDay(date, durationMin) {
  // cerrado (domingo) => no
  if (isClosed(date)) return false;

  // pasado => no
  if (isPast(date)) return false;

  // si es hoy y ya es tarde => no
  const now = new Date();
  if (sameDay(date, now)) {
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const ranges = getRangesForDate(date);
    if (!ranges.length) return false;

    // Si ya terminó la última franja, no hay disponibilidad
    const lastRange = ranges[ranges.length - 1];
    const closeMin = parseTimeToMinutes(lastRange.end);
    const lastStartAllowed = closeMin - durationMin;

    if (nowMin > lastStartAllowed) return false;
  }

  // si no hay ningún slot libre en ese día => no
  const slots = getAvailableStartTimesForDay(date, durationMin);
  return slots.length > 0;
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

// =====================
// Main
// =====================
document.addEventListener("DOMContentLoaded", () => {
  if (!window.supabase) {
    console.error("Supabase no cargó. Revisa el orden de scripts en index.html.");
    return;
  }

  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ========= ADMIN UI (oculto salvo ?admin=1) =========
  const adminPanel = document.getElementById("adminPanel");
  const adminClose = document.getElementById("adminClose");
  const adminLogout = document.getElementById("adminLogout");

  const adminLoginForm = document.getElementById("adminLoginForm");
  const adminEmail = document.getElementById("adminEmail");
  const adminPassword = document.getElementById("adminPassword");
  const adminStatus = document.getElementById("adminStatus");

  const adminBox = document.getElementById("adminBox");
  const adminDay = document.getElementById("adminDay");
  const adminLoadDay = document.getElementById("adminLoadDay");
  const adminAppointments = document.getElementById("adminAppointments");

  const tabPending = document.getElementById("tabPending");
  const tabDone = document.getElementById("tabDone");

  let adminViewMode = "pending"; // "pending" | "done"

  function isAdminRoute() {
    const url = new URL(window.location.href);
    return url.searchParams.get("admin") === "1";
  }

  function setAdminStatus(msg, isError = false) {
    if (!adminStatus) return;
    adminStatus.style.display = "block";
    adminStatus.textContent = msg || "";
    adminStatus.classList.toggle("admin-error", !!isError);
  }

  async function checkIsAdmin() {
    const { data, error } = await db.rpc("is_admin");
    if (error) return false;
    return !!data;
  }

  function timeToMinutes(t) {
    const s = String(t).slice(0, 5);
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  }

  function minutesToHHMM(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function computeEndTime(startTime, durationMin) {
    const start = timeToMinutes(startTime);
    return minutesToHHMM(start + (Number(durationMin) || 0));
  }

  function renderAdminAppointments(rows, mode = "pending") {
    if (!adminAppointments) return;
    adminAppointments.innerHTML = "";

    if (!rows || rows.length === 0) {
      adminAppointments.innerHTML = `<div class="admin-empty">No hay citas ${
        mode === "done" ? "terminadas" : "pendientes"
      }.</div>`;
      return;
    }

    rows.forEach((r) => {
      const who = `${r.name || ""} ${r.last_name || ""}`.trim() || "(Sin nombre)";

      const start = String(r.appt_time).slice(0, 5);
      const end = computeEndTime(start, r.duration);
      const when = `${start}–${end}`;

      const meta = [
        r.service || "",
        r.duration ? `${r.duration} min` : "",
        r.phone ? `📞 ${r.phone}` : "",
        r.email ? `✉️ ${r.email}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      const div = document.createElement("div");
      div.className = "admin-item";

      div.innerHTML = `
        <div class="admin-time">${when}</div>
        <div style="flex:1;">
          <div class="admin-name">${who}</div>
          <div class="admin-meta">${meta}</div>
          ${r.notes ? `<div class="admin-notes">📝 ${r.notes}</div>` : ""}
          ${
            mode === "done" && r.completed_at
              ? `<div class="admin-meta">✅ Terminada: ${new Date(
                  r.completed_at
                ).toLocaleString("es-ES")}</div>`
              : ""
          }
        </div>
        ${
          mode === "pending"
            ? `<div><button class="smallBtn" data-action="done">Terminado</button></div>`
            : ""
        }
      `;

      if (mode === "pending") {
        div.querySelector('[data-action="done"]')?.addEventListener("click", async () => {
          const ok = confirm("¿Marcar como terminada?");
          if (!ok) return;

          const { data, error } = await db.rpc("admin_mark_done", { p_id: r.id });
          if (error) {
            setAdminStatus("Error: " + error.message, true);
            return;
          }
          if (!data?.[0]?.ok) {
            setAdminStatus(data?.[0]?.message || "No se pudo marcar.", true);
            return;
          }

          setAdminStatus("Marcada como terminada ✅");
          await loadAdminDay();
        });
      }

      adminAppointments.appendChild(div);
    });
  }

  async function loadAdminDay() {
    if (!adminDay?.value) return;
    setAdminStatus("Cargando...", false);

    const rpcName =
      adminViewMode === "done" ? "admin_get_done_for_day" : "admin_get_pending_for_day";

    const { data, error } = await db.rpc(rpcName, { p_day: adminDay.value });
    if (error) {
      setAdminStatus("Error: " + error.message, true);
      return;
    }

    setAdminStatus("OK", false);
    renderAdminAppointments(data || [], adminViewMode);
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    setAdminStatus("Entrando...", false);

    const email = adminEmail.value.trim();
    const password = adminPassword.value;

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      setAdminStatus("Error: " + error.message, true);
      return;
    }

    setAdminStatus("Sesión iniciada ✅");
    adminLoginForm.style.display = "none";
    adminLogout.style.display = "inline-flex";
    adminBox.style.display = "block";

    // por defecto: hoy
    const todayISO = new Date().toISOString().slice(0, 10);
    adminDay.value = todayISO;
    await loadAdminDay();
  }

  async function handleAdminLogout() {
    await db.auth.signOut();
    setAdminStatus("Sesión cerrada.", false);
    adminLoginForm.style.display = "grid";
    adminLogout.style.display = "none";
    adminBox.style.display = "none";
  }

  // Mostrar panel admin solo si ?admin=1
  (async () => {
    if (!adminPanel) return;

    if (!isAdminRoute()) return;

    adminPanel.style.display = "block";
    adminClose?.addEventListener("click", () => (adminPanel.style.display = "none"));

    tabPending?.addEventListener("click", async () => {
      adminViewMode = "pending";
      tabPending.classList.add("is-active");
      tabDone.classList.remove("is-active");
      await loadAdminDay();
    });

    tabDone?.addEventListener("click", async () => {
      adminViewMode = "done";
      tabDone.classList.add("is-active");
      tabPending.classList.remove("is-active");
      await loadAdminDay();
    });

    adminLoadDay?.addEventListener("click", loadAdminDay);
    adminLoginForm?.addEventListener("submit", handleAdminLogin);
    adminLogout?.addEventListener("click", handleAdminLogout);

    const isAdmin = await checkIsAdmin();
    if (isAdmin) {
      adminLoginForm.style.display = "none";
      adminLogout.style.display = "inline-flex";
      adminBox.style.display = "block";
      setAdminStatus("Acceso admin ✅");

      const todayISO = new Date().toISOString().slice(0, 10);
      adminDay.value = todayISO;
      await loadAdminDay();
    } else {
      adminLoginForm.style.display = "grid";
      adminLogout.style.display = "none";
      adminBox.style.display = "none";
      setAdminStatus("Inicia sesión para acceder.", false);
    }
  })();

  // =====================
  // Availability helpers
  // =====================
  let remoteBusyByISO = Object.create(null); // { "YYYY-MM-DD": [{start,end}, ...] }

  async function refreshRemoteBusyWide() {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 2);
    const to = new Date(now);
    to.setDate(to.getDate() + 60);

    const fromISO = toISODate(from);
    const toISO = toISODate(to);

    const { data, error } = await db.rpc("get_busy_slots", { date_from: fromISO, date_to: toISO });
    if (error) {
      if (DEBUG) console.warn("get_busy_slots error:", error);
      return;
    }

    const map = Object.create(null);
    (data || []).forEach((r) => {
      const iso = r.date;
      const start = parseTimeToMinutes(String(r.start).slice(0, 5));
      const end = parseTimeToMinutes(String(r.end).slice(0, 5));
      if (!map[iso]) map[iso] = [];
      map[iso].push({ start, end });
    });

    Object.keys(map).forEach((iso) => {
      map[iso] = mergeIntervals(map[iso]);
    });

    remoteBusyByISO = map;
    if (DEBUG) console.log("busy slots loaded:", (data || []).length);
  }

  function getBusyIntervalsForISO(iso) {
    const local = loadAppointments()
      .filter((a) => a.date === iso)
      .map(apptToInterval);

    const remote = remoteBusyByISO[iso] || [];
    return mergeIntervals([...remote, ...local]);
  }

  function getAvailableStartTimesForDay(date, durationMin) {
    const iso = toISODate(date);
    const busy = getBusyIntervalsForISO(iso);

    let slots = generateSlotsForDate(date, durationMin);

    // filtra ocupados
    slots = slots.filter((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busy.some((b) => start < b.end && end > b.start);
    });

    // filtra horas pasadas si es hoy
    slots = slots.filter((time) => !isPastStartTimeForToday(iso, time));

    return slots;
  }

  function getFreeRangesForDay(date) {
    const iso = toISODate(date);
    const busy = getBusyIntervalsForISO(iso);
    const ranges = getRangesForDate(date);

    let freeRanges = [];
    for (const r of ranges) {
      const openRange = { start: parseTimeToMinutes(r.start), end: parseTimeToMinutes(r.end) };
      freeRanges = freeRanges.concat(subtractIntervals(openRange, busy));
    }
    return freeRanges;
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
  const lastNameInput = document.getElementById("lastName");
  const phoneInput = document.getElementById("phone");
  const emailInput = document.getElementById("email");
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
    return date.getDay() === 0;
  }

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
  // Mis próximas citas (LOCAL)  ✅ (FALTABA)
  // =====================
  function renderAppointments() {
    if (!apptList) return;

    const list = loadAppointments();

    // ordena por fecha/hora
    list.sort((a, b) => {
      const aKey = `${a.date} ${a.time}`;
      const bKey = `${b.date} ${b.time}`;
      return aKey.localeCompare(bKey);
    });

    apptList.innerHTML = "";

    if (!list.length) {
      apptList.innerHTML = `<li class="apptItem muted">No tienes citas guardadas en este dispositivo.</li>`;
      return;
    }

    list.forEach((a) => {
      const li = document.createElement("li");
      li.className = "apptItem";

      const dur = a.duration ?? getServiceDuration(a.service);
      const endMin = parseTimeToMinutes(a.time) + dur;
      const end = minutesToTime(endMin);

      const priceTxt = a.price != null ? ` · ${formatEuro(a.price)}` : "";

      li.innerHTML = `
        <div class="apptMain">
          <div class="apptTitle">
            <span class="apptService">${a.service}</span>
            <span class="apptPrice">${priceTxt}</span>
          </div>
          <div class="apptMeta muted">
            ${a.date} · ${a.time}–${end} · ${dur} min
          </div>
        </div>
        <div class="apptActions">
          <button class="smallBtn" data-action="whats">WhatsApp</button>
          <button class="smallBtn smallBtn--ghost" data-action="ics">.ics</button>
          <button class="smallBtn smallBtn--danger" data-action="cancel">Anular</button>
        </div>
      `;

      li.querySelector('[data-action="whats"]')?.addEventListener("click", () => {
        const text =
          `Hola! Quiero confirmar mi cita en EL COLISEUM:\n\n` +
          `Nombre: ${a.name} ${a.last_name}\n` +
          `Servicio: ${a.service}\n` +
          `Día: ${a.date}\n` +
          `Hora: ${a.time}\n` +
          (a.notes ? `Notas: ${a.notes}\n` : "") +
          `\nGracias!`;

        const link = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
        if (link) window.location.href = link;
      });

      li.querySelector('[data-action="ics"]')?.addEventListener("click", () => {
        const ics = buildICS(a);
        downloadTextFile(`cita_${a.date}_${a.time}.ics`, ics, "text/calendar");
      });

      li.querySelector('[data-action="cancel"]')?.addEventListener("click", async () => {
        const ok = confirm("¿Seguro que quieres anular esta cita?");
        if (!ok) return;

        // intenta anular en BD si existe db_id
        const okDb = await cancelInDB(a);
        if (!okDb) return;

        // borra en local
        const after = loadAppointments().filter((x) => x.id !== a.id);
        saveAppointments(after);

        await refreshRemoteBusyWide();
        renderAppointments();
        renderFreeSlots();
        populateTimes();

        setAlert("Cita anulada ✅", "ok");
      });

      apptList.appendChild(li);
    });
  }

  async function cancelInDB(appt) {
    // si no tiene db_id, solo local
    if (!appt.db_id) return true;

    const ok = confirm("Esto también la anulará en la base de datos. ¿Continuar?");
    if (!ok) return false;

    const { data, error } = await db.rpc("cancel_appointment", { p_id: appt.db_id });
    if (error) {
      setAlert("Error al anular en BD: " + error.message, "bad");
      return false;
    }
    if (!data?.[0]?.ok) {
      setAlert(data?.[0]?.message || "No se pudo anular.", "bad");
      return false;
    }
    return true;
  }

  function isToday(date) {
    const now = new Date();
    return sameDay(date, now);
  }

  function latestStartMinuteForDay(date, durationMin) {
    const ranges = getRangesForDate(date);
    if (!ranges.length) return null;

    let latest = null;
    for (const r of ranges) {
      const start = parseTimeToMinutes(r.start);
      const end = parseTimeToMinutes(r.end);
      const lastStart = end - durationMin;
      if (lastStart >= start) {
        latest = latest === null ? lastStart : Math.max(latest, lastStart);
      }
    }
    return latest;
  }

  // ✅ FUNCIÓN BUENA: usa el date que le pasas
  function isTooLateToBookToday(date, durationMin) {
    if (!isToday(date)) return false;

    const latest = latestStartMinuteForDay(date, durationMin);
    if (latest === null) return true; // hoy no abre
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    return nowMin > latest;
  }

  // Devuelve true si existe AL MENOS un hueco disponible ese día
  function hasAnyAvailabilityForDay(date, durationMin) {
    if (isPast(date) || isClosed(date)) return false;
    if (isTooLateToBookToday(date, durationMin)) return false;

    const iso = toISODate(date);
    const busy = getBusyIntervalsForISO(iso);
    const slots = generateSlotsForDate(date, durationMin);

    return slots.some((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busy.some((b) => start < b.end && end > b.start);
    });
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

      // ✅ FIX: no bloqueamos click por falta de huecos
      const closedOrPast =
        isPast(date) ||
        isClosed(date) ||
        isTooLateToBookToday(date, baseDuration);

      const hasAvail = hasAnyAvailabilityForDay(date, baseDuration);

      if (closedOrPast) cell.classList.add("day--off");
      if (!closedOrPast && !hasAvail) cell.classList.add("day--full");

      if (sameDay(date, today)) cell.classList.add("day--today");
      if (selectedDate && sameDay(date, selectedDate)) cell.classList.add("day--selected");

      cell.addEventListener("click", () => {
        if (closedOrPast) return;

        selectedDate = date;
        dateValue.value = toISODate(date);
        selectedDateText.textContent = niceSpanishDate(dateValue.value);

        populateTimes();

        if (!hasAvail) setAlert("Ese día no tiene huecos. Prueba otro.", "bad");
        else setAlert("");

        renderCalendar();
      });

      grid.appendChild(cell);
    }
  }

  // =====================
  // Times
  // =====================
  function populateTimes() {
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

    const service = serviceSelect.value;
    const durationMin = getServiceDuration(service);

    let slots = generateSlotsForDate(selectedDate, durationMin);

    const iso = toISODate(selectedDate);
    const busy = getBusyIntervalsForISO(iso);

    slots = slots.filter((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busy.some((b) => start < b.end && end > b.start);
    });
    slots = slots.filter((time) => !isPastStartTimeForToday(iso, time));

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
    first.selected = true;
    timeSelect.appendChild(first);

    slots.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      timeSelect.appendChild(opt);
    });
  }

  // =====================
  // Free slots (grid)
  // =====================
  function renderFreeSlots() {
    if (!freeSlotsGrid) return;

    freeSlotsGrid.innerHTML = "";
    if (!selectedDate) return;

    const service = serviceSelect.value;
    const durationMin = getServiceDuration(service);

    const freeRanges = getFreeRangesForDay(selectedDate);
    if (!freeRanges.length) {
      freeSlotsGrid.innerHTML = `<div class="muted">Sin huecos disponibles.</div>`;
      return;
    }

    freeRanges.forEach((r) => {
      const div = document.createElement("div");
      div.className = "freeSlot";
      div.textContent = `${minutesToTime(r.start)}–${minutesToTime(r.end)}`;
      freeSlotsGrid.appendChild(div);
    });
  }

  // =====================
  // WhatsApp + ICS
  // =====================
  function buildWhatsText(appt) {
    const whenNice = `${niceSpanishDate(appt.date)} a las ${appt.time}`;
    return (
      `Hola! Quiero confirmar mi cita en EL COLISEUM ⚔️\n\n` +
      `Nombre: ${appt.name} ${appt.last_name}\n` +
      `Teléfono: ${appt.phone}\n` +
      (appt.email ? `Email: ${appt.email}\n` : "") +
      `Servicio: ${appt.service}\n` +
      `Día: ${whenNice}\n` +
      `Hora: ${appt.time}\n` +
      (appt.notes ? `Notas: ${appt.notes}\n` : "") +
      `\n¡Gracias!`
    );
  }

  function buildICS(appt) {
    const [y, mo, d] = appt.date.split("-").map(Number);
    const [hh, mm] = appt.time.split(":").map(Number);

    const start = new Date(y, mo - 1, d, hh, mm, 0);
    const dur = appt.duration ?? getServiceDuration(appt.service);
    const end = new Date(start.getTime() + dur * 60000);

    const dt = (x) =>
      `${x.getFullYear()}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}T${pad2(
        x.getHours()
      )}${pad2(x.getMinutes())}00`;

    const title = `Cita: ${appt.service}`;
    const desc =
      `Servicio: ${appt.service}\\n` +
      `Cliente: ${appt.name} ${appt.last_name}\\n` +
      `Tel: ${appt.phone}\\n` +
      (appt.notes ? `Notas: ${appt.notes}\\n` : "");

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//EL COLISEUM//Citas//ES",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${Date.now()}@coliseum`,
      `DTSTAMP:${dt(new Date())}`,
      `DTSTART:${dt(start)}`,
      `DTEND:${dt(end)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${desc}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  }

  function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function genLocalId() {
    return (crypto?.randomUUID?.() || String(Date.now())) + "_" + Math.random().toString(16).slice(2);
  }

  // =====================
  // Submit booking
  // =====================
  async function createInDB(appt) {
    const selectedTime = timeSelect.value;
    supabase.rpc("book_appointment", {
      p_name: name,
      p_last_name: lastName,
      p_email: email,
      p_phone: phone,
      p_date: selectedDate,  // IMPORTANTE: p_date, no p_day
      p_time: selectedTime,
      p_service: service,
      p_duration: duration,
      p_notes: notes
    });


    if (error) {
      setAlert("Error guardando en BD: " + error.message, "bad");
      return null;
    }
    if (!data?.[0]?.ok) {
      setAlert(data?.[0]?.message || "No se pudo guardar.", "bad");
      return null;
    }
    return data?.[0]?.id || null;
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAlert("", "");

    const name = nameInput.value.trim();
    const last_name = lastNameInput.value.trim();
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();
    const service = serviceSelect.value;
    const notes = notesInput.value.trim();

    if (!selectedDate) {
      setAlert("Selecciona un día.", "bad");
      return;
    }
    if (!service) {
      setAlert("Selecciona un servicio.", "bad");
      return;
    }
    const time = timeSelect.value;
    if (!time) {
      setAlert("Selecciona una hora.", "bad");
      return;
    }
    if (!name || !last_name || !phone) {
      setAlert("Completa nombre, apellidos y teléfono.", "bad");
      return;
    }

    const duration = getServiceDuration(service);
    const price = getServicePrice(service);

    const appt = {
      id: genLocalId(),
      db_id: null,
      date: toISODate(selectedDate),
      time,
      name,
      last_name,
      phone,
      email,
      service,
      duration,
      price,
      notes,
    };

    // guarda en BD
    const dbId = await createInDB(appt);
    if (!dbId) return;
    appt.db_id = dbId;

    // guarda en local
    const list = loadAppointments();
    list.push(appt);
    saveAppointments(list);
    lastCreatedAppointment = appt;

    await refreshRemoteBusyWide();
    renderAppointments();
    renderFreeSlots();
    populateTimes();
    renderCalendar();

    setAlert("Cita creada ✅ Ahora puedes enviar por WhatsApp o descargar .ics.", "ok");
  });

  whatsBtn?.addEventListener("click", () => {
    if (!lastCreatedAppointment) {
      setAlert("Primero confirma una cita.", "bad");
      return;
    }
    const text = buildWhatsText(lastCreatedAppointment);
    const link = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
    window.location.href = link;
  });

  downloadIcsBtn?.addEventListener("click", () => {
    if (!lastCreatedAppointment) {
      setAlert("Primero confirma una cita.", "bad");
      return;
    }
    const ics = buildICS(lastCreatedAppointment);
    downloadTextFile(
      `cita_${lastCreatedAppointment.date}_${lastCreatedAppointment.time}.ics`,
      ics,
      "text/calendar"
    );
  });

  serviceSelect?.addEventListener("change", () => {
    populateTimes();
    renderCalendar();
    renderFreeSlots();
  });

  prevMonthBtn?.addEventListener("click", async () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    await refreshRemoteBusyWide();
    renderCalendar();
  });

  nextMonthBtn?.addEventListener("click", async () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    await refreshRemoteBusyWide();
    renderCalendar();
  });

  // =====================
  // Reviews (tu lógica original)
  // =====================
  const reviewForm = document.getElementById("reviewForm");
  const reviewName = document.getElementById("reviewName");
  const reviewLastName = document.getElementById("reviewLastName");
  const reviewPhone = document.getElementById("reviewPhone");
  const reviewEmail = document.getElementById("reviewEmail");
  const reviewComment = document.getElementById("reviewComment");
  const reviewAlert = document.getElementById("reviewAlert");
  const starsWrap = document.getElementById("starPicker");
  let currentRating = 0;

  function setReviewAlert(msg, type) {
    if (!reviewAlert) return;
    reviewAlert.textContent = msg || "";
    reviewAlert.classList.remove("alert--ok", "alert--bad");
    if (type === "ok") reviewAlert.classList.add("alert--ok");
    if (type === "bad") reviewAlert.classList.add("alert--bad");
  }

  function paintStars(r) {
    if (!starsWrap) return;
    const stars = Array.from(starsWrap.querySelectorAll("button[data-star]"));
    stars.forEach((btn) => {
      const s = Number(btn.dataset.star);
      btn.classList.toggle("is-on", s <= r);
    });
  }

  starsWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-star]");
    if (!btn) return;
    currentRating = Number(btn.dataset.star);
    paintStars(currentRating);
  });

  function syncReviewFromBooking() {
    if (!reviewName || !reviewLastName || !reviewPhone || !reviewEmail) return;
    reviewName.value = nameInput?.value || "";
    reviewLastName.value = lastNameInput?.value || "";
    reviewPhone.value = phoneInput?.value || "";
    reviewEmail.value = emailInput?.value || "";
  }

  [nameInput, lastNameInput, phoneInput, emailInput].forEach((el) => {
    el?.addEventListener("input", syncReviewFromBooking);
  });
  syncReviewFromBooking();

  async function loadPublicReviews() {
    const list = document.getElementById("reviewsList");
    if (!list) return;

    const { data, error } = await db.rpc("get_public_reviews");
    if (error) {
      if (DEBUG) console.warn("get_public_reviews error:", error);
      return;
    }

    list.innerHTML = "";
    (data || []).forEach((r) => {
      const div = document.createElement("div");
      div.className = "reviewCard";
      const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
      div.innerHTML = `
        <div class="reviewHead">
          <div class="reviewWho">${(r.name || "").trim()} ${(r.last_name || "").trim()}</div>
          <div class="reviewStars">${stars}</div>
        </div>
        <div class="reviewBody">${r.comment || ""}</div>
        <div class="reviewFoot muted">${new Date(r.created_at).toLocaleDateString("es-ES")}</div>
      `;
      list.appendChild(div);
    });
  }

  reviewForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const n = reviewName.value.trim();
    const ln = reviewLastName.value.trim();
    const ph = reviewPhone.value.trim();
    const em = reviewEmail.value.trim();
    const cm = reviewComment.value.trim();

    if (!n || !ln || !ph || !em || !cm) {
      setReviewAlert("Completa todos los campos de la reseña.", "bad");
      return;
    }
    if (currentRating < 1 || currentRating > 5) {
      setReviewAlert("Selecciona una valoración de 1 a 5 estrellas.", "bad");
      return;
    }

    const { data, error } = await db.rpc("submit_review", {
      p_name: n,
      p_last_name: ln,
      p_email: em,
      p_phone: ph,
      p_rating: currentRating,
      p_comment: cm,
    });

    if (error) {
      setReviewAlert("Error: " + error.message, "bad");
      return;
    }
    if (!data?.[0]?.ok) {
      setReviewAlert(data?.[0]?.message || "No se pudo enviar la reseña.", "bad");
      return;
    }

    setReviewAlert("Reseña enviada ✅ ¡Gracias!", "ok");
    reviewComment.value = "";
    paintStars(0);
    await loadPublicReviews();
  });

  // =====================
  // ✅ Auto-saltar al siguiente día si hoy ya está "cerrado" por hora
  // FIX: renombrado para que NO pise a isTooLateToBookToday(date,duration)
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

  function findNextOpenDay(fromDate) {
    const d = new Date(fromDate);
    d.setHours(0, 0, 0, 0);

    for (let i = 0; i < 60; i++) {
      d.setDate(d.getDate() + 1);
      if (!isClosed(d)) return d;
    }
    return null;
  }

  function autoAdvanceIfTooLate() {
    const minDur = AVAILABILITY_SLOT_MIN;
    if (!selectedDate) return;

    if (isTooLateToAutoBookToday(minDur)) {
      const next = findNextOpenDay(selectedDate);
      if (!next) return;

      selectedDate = next;
      const iso = toISODate(selectedDate);
      dateValue.value = iso;
      selectedDateText.textContent = niceSpanishDate(iso);

      populateTimes();
      renderCalendar();
      renderFreeSlots();
    }
  }

  // =====================
  // Init
  // =====================
  (async () => {
    purgeExpiredLocalAppointments();
    await refreshRemoteBusyWide();

    // default: hoy si no está pasado y no es domingo
    const today = new Date();
    if (!isPast(today) && !isClosed(today)) {
      selectedDate = today;
    } else {
      selectedDate = findNextOpenDay(today) || today;
    }

    const iso = toISODate(selectedDate);
    dateValue.value = iso;
    selectedDateText.textContent = niceSpanishDate(iso);

    populateTimes();
    renderCalendar();
    renderAppointments();
    renderFreeSlots();
    await loadPublicReviews();
    autoAdvanceIfTooLate();
  })();
});
