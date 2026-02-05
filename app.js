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
          const { data, error } = await db.rpc("admin_complete_appointment", { p_id: r.id });

          if (error) {
            setAdminStatus("Error: " + error.message, true);
            return;
          }
          if (!data?.[0]?.ok) {
            setAdminStatus(data?.[0]?.message || "No se pudo completar", true);
            return;
          }

          await loadAdminDay(adminDay.value);
        });
      }

      adminAppointments.appendChild(div);
    });
  }

  async function loadAdminDay(dateStr) {
    if (!dateStr) {
      setAdminStatus("Elige una fecha.", true);
      return;
    }

    if (adminViewMode === "pending") {
      setAdminStatus("Cargando pendientes…");
      adminAppointments.innerHTML = "";

      const { data, error } = await db.rpc("admin_get_pending_for_day", { p_date: dateStr });
      if (error) {
        setAdminStatus("Error: " + error.message, true);
        return;
      }

      const todayISO = new Date().toISOString().slice(0, 10);
      const shouldAutoFinish = dateStr === todayISO;

      if (shouldAutoFinish && (data || []).length) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const GRACE_MIN = 3;

        for (const r of data) {
          const start = String(r.appt_time).slice(0, 5);
          const end = computeEndTime(start, r.duration);
          const endMin = timeToMinutes(end);

          if (endMin + GRACE_MIN <= nowMin) {
            await db.rpc("admin_complete_appointment", { p_id: r.id });
          }
        }

        const res2 = await db.rpc("admin_get_pending_for_day", { p_date: dateStr });
        if (res2.error) {
          setAdminStatus("Error: " + res2.error.message, true);
          return;
        }

        setAdminStatus(`Pendientes para ${dateStr}`);
        renderAdminAppointments(res2.data, "pending");
        return;
      }

      setAdminStatus(`Pendientes para ${dateStr}`);
      renderAdminAppointments(data, "pending");
      return;
    }

    setAdminStatus("Cargando terminadas…");
    adminAppointments.innerHTML = "";

    const doneRes = await db.rpc("admin_get_done_for_day", { p_date: dateStr });
    if (doneRes.error) {
      setAdminStatus("Error: " + doneRes.error.message, true);
      return;
    }

    setAdminStatus(`Terminadas para ${dateStr}`);
    renderAdminAppointments(doneRes.data, "done");
  }

  tabPending?.addEventListener("click", async () => {
    adminViewMode = "pending";
    tabPending.classList.add("is-active");
    tabDone.classList.remove("is-active");
    await loadAdminDay(adminDay.value);
  });

  tabDone?.addEventListener("click", async () => {
    adminViewMode = "done";
    tabDone.classList.add("is-active");
    tabPending.classList.remove("is-active");
    await loadAdminDay(adminDay.value);
  });

  let adminTimer = null;
  function startAdminTimer() {
    if (adminTimer) clearInterval(adminTimer);
    adminTimer = setInterval(() => {
      if (adminDay?.value) loadAdminDay(adminDay.value);
    }, 60_000);
  }
  function stopAdminTimer() {
    if (adminTimer) clearInterval(adminTimer);
    adminTimer = null;
  }

  async function enterAdminModeUI() {
    if (!adminPanel) return;
    if (!isAdminRoute()) return;

    adminPanel.style.display = "block";

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    if (adminDay) adminDay.value = todayStr;

    const {
      data: { session },
    } = await db.auth.getSession();

    if (session) {
      const ok = await checkIsAdmin();
      if (ok) {
        adminLoginForm.style.display = "none";
        adminBox.style.display = "block";
        adminLogout.style.display = "inline-flex";
        setAdminStatus("✅ Admin logueado");
        await loadAdminDay(adminDay.value);
        startAdminTimer();
      } else {
        await db.auth.signOut();
      }
    } else {
      adminLoginForm.style.display = "grid";
      adminBox.style.display = "none";
      adminLogout.style.display = "none";
    }
  }

  adminClose?.addEventListener("click", () => {
    adminPanel.style.display = "none";
  });

  adminLogout?.addEventListener("click", async () => {
    await db.auth.signOut();
    setAdminStatus("Sesión cerrada.");
    adminLoginForm.style.display = "grid";
    adminBox.style.display = "none";
    adminLogout.style.display = "none";
    adminAppointments.innerHTML = "";
    stopAdminTimer();
  });

  adminLoginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAdminStatus("");

    const email = adminEmail.value.trim();
    const password = adminPassword.value;

    if (!email || !password) {
      setAdminStatus("Completa email y contraseña.", true);
      return;
    }

    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      setAdminStatus("Login inválido: " + error.message, true);
      return;
    }

    const ok = await checkIsAdmin();
    if (!ok) {
      await db.auth.signOut();
      setAdminStatus("Tu usuario no es admin.", true);
      return;
    }

    adminLoginForm.style.display = "none";
    adminBox.style.display = "block";
    adminLogout.style.display = "inline-flex";
    setAdminStatus("✅ Admin logueado");
    await loadAdminDay(adminDay.value);
    startAdminTimer();
  });

  adminLoadDay?.addEventListener("click", async () => {
    await loadAdminDay(adminDay.value);
  });

  // Inicia panel admin si toca
  enterAdminModeUI();

  // ========= Remote busy cache (BD) =========
  const remoteBusyByDate = new Map(); // iso -> [{start,end}]

  async function refreshRemoteBusyWide() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fromISO = toISODate(today);
    const to = new Date(today);
    to.setDate(to.getDate() + 120);
    const toISO = toISODate(to);

    const { data, error } = await db.rpc("get_busy_slots", { date_from: fromISO, date_to: toISO });
    if (error) {
      if (DEBUG) console.warn("get_busy_slots error:", error);
      return;
    }

    remoteBusyByDate.clear();

    (data || []).forEach((row) => {
      const iso = row.date;
      const start = parseTimeToMinutes(row.slot_time);
      const end = start + Number(row.duration || 0);

      if (!remoteBusyByDate.has(iso)) remoteBusyByDate.set(iso, []);
      remoteBusyByDate.get(iso).push({ start, end });
    });

    for (const [iso, arr] of remoteBusyByDate.entries()) {
      remoteBusyByDate.set(iso, mergeIntervals(arr));
    }

    if (DEBUG) console.log("busy slots loaded:", data?.length ?? 0);
  }

  function getBusyIntervalsForISO(iso) {
    const remote = remoteBusyByDate.get(iso) || [];
    const local = loadAppointments().filter((a) => a.date === iso).map(apptToInterval);
    return mergeIntervals([...remote, ...local]);
  }

  function getAvailableStartTimesForDay(date, durationMin) {
    const iso = toISODate(date);
    const busy = getBusyIntervalsForISO(iso);

    let slots = generateSlotsForDate(date, durationMin);
    slots = slots.filter((time) => {
      const start = parseTimeToMinutes(time);
      const end = start + durationMin;
      return !busy.some((b) => start < b.end && end > b.start);
    });

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
        <div class="apptTop">
          <div><strong>${niceSpanishDate(a.date)}</strong> · ${a.time}–${end}</div>
          <div class="muted">${a.service}${priceTxt}</div>
        </div>
        <div class="muted" style="margin-top:6px;">
          ${a.name} ${a.lastName} · 📞 ${a.phone} · ✉️ ${a.email}
          ${a.notes ? `<div style="margin-top:6px;">📝 ${a.notes}</div>` : ""}
        </div>
        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="smallBtn" type="button" data-action="ics">Descargar .ics</button>
          <button class="smallBtn" type="button" data-action="wa">WhatsApp</button>
          <button class="smallBtn" type="button" data-action="cancel">Anular</button>
        </div>
      `;

      li.querySelector('[data-action="ics"]')?.addEventListener("click", () => downloadICS(a));
      li.querySelector('[data-action="wa"]')?.addEventListener("click", () => {
        const link = buildWhatsAppLink(a);
        if (link) window.location.href = link;
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

  serviceSelect?.addEventListener("change", () => {
    if (selectedDate) populateTimes();
  });

  // =====================
  // Appointments UI (ICS/WA helpers)
  // =====================
  function toICSDateTime(dateISO, timeHHMM) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0);

    return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(
      dt.getHours()
    )}${pad2(dt.getMinutes())}00`;
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

    const dtEnd = `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}T${pad2(
      end.getHours()
    )}${pad2(end.getMinutes())}00`;

    const uid = `${appt.id}@elcoliseum`;

    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}T${pad2(
      now.getHours()
    )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

    const priceTxt = appt.price != null ? ` (${formatEuro(appt.price)})` : "";
    const summary = `Cita - EL COLISEUM (${appt.service}${priceTxt})`;

    const description =
      `Cliente: ${appt.name} ${appt.lastName}\\n` +
      `Teléfono: ${appt.phone}\\n` +
      `Email: ${appt.email}\\n` +
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
    if (whatsBtn) whatsBtn.disabled = !wa;
    if (downloadIcsBtn) downloadIcsBtn.disabled = false;
  }

  async function cancelInDB(appt) {
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
        remaining <= SCARCITY_CRITICAL
          ? "critical"
          : remaining <= SCARCITY_WARNING
          ? "warning"
          : "ok";

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

      top.querySelector("button")?.addEventListener("click", () => {
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
      freeSlotsGrid.innerHTML = `
        <div class="dayCard">
          <div class="dayTitle">Sin alertas de disponibilidad</div>
          <div class="daySub">No hay días “justos” en los próximos ${FREE_DAYS_AHEAD} días.</div>
        </div>
      `;
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
  // Guardar cita (BD + local)
  // =====================
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
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

      const busy = getBusyIntervalsForISO(date);
      const start = parseTimeToMinutes(time);
      const end = start + duration;
      if (busy.some((b) => start < b.end && end > b.start)) {
        setAlert("Ese horario ya está ocupado. Elige otra hora.", "bad");
        return;
      }

      // ✅ NUEVO: bloquear reserva si la hora ya pasó (por si alguien manipula el HTML)
      if (isPastStartTimeForToday(date, time)) {
        setAlert("No puedes reservar una hora que ya ha pasado.", "bad");
        return;
      } 


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

      await refreshRemoteBusyWide();
      renderAppointments();
      renderFreeSlots();
      enablePostCreateActions(appt);

      setAlert("Cita guardada ✅ (también en la base de datos).", "ok");
      populateTimes();

      // opcional: bajar a la lista
      document.getElementById("apptList")?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.error(err);
      setAlert("Se produjo un error en el script. Mira la consola.", "bad");
    }
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

  function setReviewAlert(text, type) {
    if (!reviewAlert) return;
    reviewAlert.textContent = text || "";
    reviewAlert.classList.remove("alert--ok", "alert--bad");
    if (type === "ok") reviewAlert.classList.add("alert--ok");
    if (type === "bad") reviewAlert.classList.add("alert--bad");
  }

  function paintStars(n) {
    currentRating = n;
    starRating?.querySelectorAll(".star").forEach((btn) => {
      const v = Number(btn.dataset.value || 0);
      btn.classList.toggle("is-on", v <= n);
    });
  }

  starRating?.querySelectorAll(".star").forEach((btn) => {
    btn.addEventListener("click", () => {
      paintStars(Number(btn.dataset.value || 0));
    });
  });

  function starsText(n) {
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }

  async function loadPublicReviews() {
    if (!reviewsList) return;

    const { data, error } = await db.rpc("get_public_reviews", { p_limit: 6 });
    if (error) {
      if (DEBUG) console.warn("get_public_reviews error:", error);
      return;
    }

    reviewsList.innerHTML = "";

    (data || []).forEach((r) => {
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

      div.querySelector('[data-action="deleteReview"]')?.addEventListener("click", async () => {
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

    if (!reviewsList.children.length) {
      reviewsList.innerHTML = `<div class="reviewItem">Aún no hay reseñas.</div>`;
    }
  }

  function syncReviewFromBooking() {
    reviewName.value = nameInput.value || reviewName.value;
    reviewLastName.value = lastNameInput.value || reviewLastName.value;
    reviewPhone.value = phoneInput.value || reviewPhone.value;
    reviewEmail.value = emailInput.value || reviewEmail.value;
  }

  [nameInput, lastNameInput, phoneInput, emailInput].forEach((el) => {
    el?.addEventListener("input", syncReviewFromBooking);
  });
  syncReviewFromBooking();

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
    // =====================

    // Devuelve true si HOY ya no tiene huecos reservables (por hora actual)
    function isTooLateToBookToday(minDuration = AVAILABILITY_SLOT_MIN) {
      if (!selectedDate) return false;

      const now = new Date();
      // solo aplica si selectedDate es hoy
      if (!sameDay(selectedDate, now)) return false;

      // si hoy es domingo o cerrado, ya "demasiado tarde"
      if (isClosed(selectedDate)) return true;

      const ranges = getRangesForDate(selectedDate);
      if (!ranges || !ranges.length) return true;

      // última hora de cierre real del día (último tramo)
      const lastRange = ranges[ranges.length - 1];
      const closeMin = parseTimeToMinutes(lastRange.end);

      // última hora a la que se puede EMPEZAR una cita
      const lastStartAllowed = closeMin - minDuration;

      const nowMin = now.getHours() * 60 + now.getMinutes();

      return nowMin > lastStartAllowed;
    }

    // Busca el siguiente día abierto a partir de "fromDate"
    function findNextOpenDay(fromDate) {
      const d = new Date(fromDate);
      d.setHours(0, 0, 0, 0);

      // prueba hasta 60 días por seguridad
      for (let i = 0; i < 60; i++) {
        d.setDate(d.getDate() + 1);
        if (!isClosed(d)) return d;
      }
      return null;
    }

    // Aplica el salto automático si hoy ya no deja reservar
    function autoAdvanceIfTooLate() {
      // duración mínima para decidir "queda hueco o no"
      const minDur = AVAILABILITY_SLOT_MIN;

      if (!selectedDate) return;

      // si hoy ya es tarde, saltamos al siguiente día abierto
      if (isTooLateToBookToday(minDur)) {
        const next = findNextOpenDay(selectedDate);
        if (!next) return;

        selectedDate = next;
        const iso = toISODate(selectedDate);
        dateValue.value = iso;
        selectedDateText.textContent = niceSpanishDate(iso);

        populateTimes();
        renderCalendar();
        setAlert("Hoy ya no quedan horas. Te he pasado al siguiente día disponible.", "ok");
      }
    }


  // =====================
  // Init
  // =====================
  (async () => {
    purgeExpiredLocalAppointments();
    await refreshRemoteBusyWide();
    renderCalendar();
    renderAppointments(); // ✅ ahora existe
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
    autoAdvanceIfTooLate();
  })();

  setInterval(() => {
  purgeExpiredLocalAppointments();
  renderAppointments(); // refresca "Mis próximas citas"
  autoAdvanceIfTooLate();
}, 60_000);

});
