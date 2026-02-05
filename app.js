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

  // ========= ADMIN UI (seguro aunque falten elementos) =========
  const adminPanel = document.getElementById("adminPanel");
  const adminClose = document.getElementById("adminClose");
  const adminLogout = document.getElementById("adminLogout"); // opcional

  const adminLoginForm = document.getElementById("adminLoginForm");
  const adminEmail = document.getElementById("adminEmail");
  const adminPassword = document.getElementById("adminPassword");
  const adminStatus = document.getElementById("adminStatus");

  const adminDay = document.getElementById("adminDay");
  const adminLoadDay = document.getElementById("adminLoadDay");
  const adminAppointments = document.getElementById("adminAppointments");

  const tabPending = document.getElementById("tabPending");
  const tabDone = document.getElementById("tabDone");

  let adminViewMode = "pending"; // "pending" | "done"
  let adminTimer = null;

  function isAdminRoute() {
    const url = new URL(window.location.href);
    return url.searchParams.get("admin") === "1";
  }

  function setAdminStatus(msg, isError=false){
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

  function timeToMinutes(t){
    const s = String(t || "").slice(0,5);
    if (!s.includes(":")) return 0;
    const [h,m] = s.split(":").map(Number);
    return h*60 + m;
  }
  function minutesToHHMM(min){
    const h = Math.floor(min/60);
    const m = min % 60;
    return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
  }
  function computeEndTime(startTime, durationMin){
    const start = timeToMinutes(startTime);
    return minutesToHHMM(start + (Number(durationMin)||0));
  }

  function renderAdminAppointments(rows, mode){
    if (!adminAppointments) return;
    adminAppointments.innerHTML = "";

    if (!rows || rows.length === 0) {
      adminAppointments.innerHTML = `<div class="admin-empty">No hay citas ${mode === "done" ? "terminadas" : "pendientes"}.</div>`;
      return;
    }

    rows.forEach(r => {
      const who = `${r.name || ""} ${r.last_name || ""}`.trim() || "(Sin nombre)";
      const start = String(r.appt_time || r.time || "").slice(0,5);
      const end = computeEndTime(start, r.duration);
      const when = `${start}–${end}`;

      const meta = [
        r.service || "",
        r.duration ? `${r.duration} min` : "",
        r.phone ? `📞 ${r.phone}` : "",
        r.email ? `✉️ ${r.email}` : ""
      ].filter(Boolean).join(" · ");

      const div = document.createElement("div");
      div.className = "admin-card";

      div.innerHTML = `
        <div class="admin-time">${when}</div>
        <div style="flex:1;">
          <div class="admin-name">${who}</div>
          <div class="admin-meta">${meta}</div>
          ${r.notes ? `<div class="admin-notes">📝 ${r.notes}</div>` : ""}
          ${mode === "done" && r.completed_at ? `<div class="admin-meta">✅ Terminada: ${new Date(r.completed_at).toLocaleString("es-ES")}</div>` : ""}
        </div>
        <div>
          ${
            mode === "pending"
              ? `<button class="smallBtn" data-action="done">Terminado</button>`
              : `<button class="smallBtn" data-action="undo">Revertir</button>`
          }
        </div>
      `;

      if (mode === "pending") {
        div.querySelector('[data-action="done"]').addEventListener("click", async () => {
          setAdminStatus("Marcando como terminada…");
          const res = await db.rpc("admin_complete_appointment", { p_id: r.id });
          if (res.error){
            setAdminStatus("Error: " + res.error.message, true);
            return;
          }
          if (!res.data?.[0]?.ok){
            setAdminStatus(res.data?.[0]?.message || "No se pudo completar", true);
            return;
          }
          await loadAdminDay(adminDay?.value);
        });
      } else {
        div.querySelector('[data-action="undo"]').addEventListener("click", async () => {
          setAdminStatus("Revirtiendo…");
          const res = await db.rpc("admin_uncomplete_appointment", { p_id: r.id });
          if (res.error){
            setAdminStatus("Error: " + res.error.message, true);
            return;
          }
          if (!res.data?.[0]?.ok){
            setAdminStatus(res.data?.[0]?.message || "No se pudo revertir", true);
            return;
          }
          await loadAdminDay(adminDay?.value);
        });
      }

      adminAppointments.appendChild(div);
    });
  }

  async function loadAdminDay(dateStr){
    if (!dateStr) {
      setAdminStatus("Elige una fecha.", true);
      return;
    }

    // Pendientes
    if (adminViewMode === "pending") {
      setAdminStatus("Cargando pendientes…");
      adminAppointments && (adminAppointments.innerHTML = "");

      const { data, error } = await db.rpc("admin_get_pending_for_day", { p_date: dateStr });
      if (error){
        setAdminStatus("Error: " + error.message, true);
        return;
      }

      // Auto-finalizar por tiempo SOLO HOY
      const todayISO = new Date().toISOString().slice(0,10);
      const shouldAutoFinish = (dateStr === todayISO);

      if (shouldAutoFinish && (data || []).length) {
        const now = new Date();
        const nowMin = now.getHours()*60 + now.getMinutes();
        const GRACE_MIN = 3;

        for (const r of data) {
          const start = String(r.appt_time || r.time || "").slice(0,5);
          const end = computeEndTime(start, r.duration);
          const endMin = timeToMinutes(end);

          if (endMin + GRACE_MIN <= nowMin) {
            await db.rpc("admin_complete_appointment", { p_id: r.id });
          }
        }

        const res2 = await db.rpc("admin_get_pending_for_day", { p_date: dateStr });
        if (res2.error){
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

    // Terminadas
    setAdminStatus("Cargando terminadas…");
    adminAppointments && (adminAppointments.innerHTML = "");

    const doneRes = await db.rpc("admin_get_done_for_day", { p_date: dateStr });
    if (doneRes.error){
      setAdminStatus("Error: " + doneRes.error.message, true);
      return;
    }

    setAdminStatus(`Terminadas para ${dateStr}`);
    renderAdminAppointments(doneRes.data, "done");
  }

  function startAdminTimer(){
    if (adminTimer) clearInterval(adminTimer);
    adminTimer = setInterval(() => {
      if (adminDay?.value) loadAdminDay(adminDay.value);
    }, 60_000);
  }
  function stopAdminTimer(){
    if (adminTimer) clearInterval(adminTimer);
    adminTimer = null;
  }

  tabPending?.addEventListener("click", async () => {
    adminViewMode = "pending";
    tabPending.classList.add("is-active");
    tabDone?.classList.remove("is-active");
    await loadAdminDay(adminDay?.value);
  });

  tabDone?.addEventListener("click", async () => {
    adminViewMode = "done";
    tabDone.classList.add("is-active");
    tabPending?.classList.remove("is-active");
    await loadAdminDay(adminDay?.value);
  });

  async function enterAdminModeUI() {
    if (!adminPanel) return;
    if (!isAdminRoute()) return;

    adminPanel.style.display = "block";

    // hoy por defecto
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
    if (adminDay) adminDay.value = todayStr;

    adminClose?.addEventListener("click", () => {
      adminPanel.style.display = "none";
    });

    adminLoadDay?.addEventListener("click", async () => {
      await loadAdminDay(adminDay.value);
    });

    adminLoginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setAdminStatus("");

      const email = (adminEmail?.value || "").trim();
      const password = adminPassword?.value || "";

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

      setAdminStatus("✅ Admin logueado");
      adminLoginForm.style.display = "none";
      adminLogout && (adminLogout.style.display = "inline-flex");
      startAdminTimer();
      await loadAdminDay(adminDay.value);
    });

    adminLogout?.addEventListener("click", async () => {
      await db.auth.signOut();
      stopAdminTimer();
      setAdminStatus("Sesión cerrada.");
      adminLoginForm && (adminLoginForm.style.display = "grid");
      adminLogout && (adminLogout.style.display = "none");
      adminAppointments && (adminAppointments.innerHTML = "");
    });

    // si ya hay sesión
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      const ok = await checkIsAdmin();
      if (ok) {
        setAdminStatus("✅ Admin logueado");
        adminLoginForm && (adminLoginForm.style.display = "none");
        adminLogout && (adminLogout.style.display = "inline-flex");
        startAdminTimer();
        await loadAdminDay(adminDay.value);
      } else {
        await db.auth.signOut();
        setAdminStatus("Tu usuario no es admin.", true);
      }
    } else {
      setAdminStatus("Inicia sesión para ver las citas.");
      adminLogout && (adminLogout.style.display = "none");
    }
  }

  // Inicia panel admin si toca
  enterAdminModeUI();

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
    if (!alertBox) return;
    alertBox.textContent = text || "";
    alertBox.classList.remove("alert--ok", "alert--bad");
    if (type === "ok") alertBox.classList.add("alert--ok");
    if (type === "bad") alertBox.classList.add("alert--bad");
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

  serviceSelect?.addEventListener("change", () => {
    if (selectedDate) populateTimes();
  });

  // =====================
  // Appointments UI (local)
  // =====================
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
    // tu render local (lo tenías antes). Si no existe en tu copia anterior, no falla.
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
  // Events calendario
  // =====================
  prevMonthBtn?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    renderCalendar();
  });
  nextMonthBtn?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    renderCalendar();
  });

  // =====================
  // RESEÑAS y resto...
  // (aquí tu código original sigue igual; no lo he tocado)
  // =====================

  // =====================
  // Init
  // =====================
  (async () => {
    await refreshRemoteBusyWide();
    renderCalendar();
    renderFreeSlots();
    populateTimes();

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
