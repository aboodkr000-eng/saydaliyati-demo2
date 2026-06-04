/* ============================================================
   صيدليتي · Shared utilities
   ============================================================ */

// ---------- Language ----------
const LANG_KEY = "saydaliyati_lang";
let currentLang = localStorage.getItem(LANG_KEY) || "ar";

function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  if (window.translations) {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      if (val) el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const val = t(key);
      if (val) el.placeholder = val;
    });
  }
  document.querySelectorAll(".lang-toggle").forEach((b) => (b.textContent = lang === "ar" ? "EN" : "ع"));
}

function toggleLang() {
  applyLang(currentLang === "ar" ? "en" : "ar");
}

function t(key) {
  if (!window.translations) return key;
  const dict = window.translations[currentLang] || window.translations.en;
  return key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), dict) || key;
}

document.documentElement.lang = currentLang;
document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";

// ---------- API ----------
async function api(path, options = {}) {
  const opts = {
    credentials: "include",
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
    ...options,
  };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Toast ----------
function toast(message, type = "") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = type ? `show ${type}` : "show";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

// ---------- Auth helpers ----------
async function getMe() {
  try { return await api("/api/auth/me"); } catch { return null; }
}
async function requireAuth(expectedRole = null) {
  const me = await getMe();
  if (!me) { location.href = "/sign-in"; return null; }
  if (expectedRole && me.role !== expectedRole) {
    location.href = me.role === "admin" ? "/admin/dashboard"
                  : me.role === "pharmacy" ? "/pharmacy/dashboard"
                  : "/client/home";
    return null;
  }
  return me;
}
async function signOut() {
  try { await api("/api/auth/sign-out", { method: "POST" }); } catch {}
  location.href = "/";
}

// ---------- Avatars (deterministic color from name) ----------
const AVATAR_COLORS = ["mint", "blue", "purple", "orange", "amber", "green"];
function avatarColor(seed = "") {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name = "") {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || "").join("").toUpperCase() || "•";
}
function avatarHtml(name, size = "md", online = false) {
  const color = avatarColor(name);
  return `<div class="avatar avatar-${size} avatar-${color}${online ? " avatar-online" : ""}">${initials(name)}</div>`;
}

// ---------- Status helpers ----------
const STATUS_COLORS = {
  pending: "amber",
  quoted: "blue",
  confirmed: "blue",
  preparing: "blue",
  ready_for_pickup: "purple",
  out_for_delivery: "purple",
  completed: "green",
  cancelled: "muted",
  rejected: "red",
};
function statusPill(status) {
  const color = STATUS_COLORS[status] || "muted";
  return `<span class="pill pill-${color}">${t(`status.${status}`)}</span>`;
}

// ---------- Nav rendering ----------
// Desktop topbar + mobile bottom nav (both in DOM, CSS picks)
function renderClientNav(active = "") {
  const items = [
    { href: "/client/home", key: "nav.home", icon: iconHome },
    { href: "/client/orders", key: "nav.orders", icon: iconPackage },
    { href: "/client/profile", key: "nav.profile", icon: iconUser },
  ];
  return navHtml(items, active, "/client/home");
}
function renderPharmacyNav(active = "") {
  const items = [
    { href: "/pharmacy/dashboard", key: "nav.dashboard", icon: iconDash },
    { href: "/pharmacy/orders", key: "nav.orders", icon: iconInbox },
    { href: "/pharmacy/profile", key: "nav.profile", icon: iconSettings },
  ];
  return navHtml(items, active, "/pharmacy/dashboard");
}
function renderAdminNav(active = "") {
  const items = [
    { href: "/admin/dashboard", key: "admin.dashboard", icon: iconDash },
    { href: "/admin/users", key: "admin.users", icon: iconUser },
    { href: "/admin/pharmacies", key: "admin.pharmacies", icon: iconBuilding },
    { href: "/admin/orders", key: "admin.orders", icon: iconPackage },
    { href: "/admin/reviews", key: "admin.reviews", icon: iconStar },
  ];
  return navHtml(items, active, "/admin/dashboard");
}

function navHtml(items, active, brandHref) {
  document.body.classList.add("has-bottomnav");
  const desktopLinks = items
    .map((i) => `<a href="${i.href}" class="${active === i.href ? "active" : ""}">${i.icon(18)}<span>${t(i.key)}</span></a>`)
    .join("");
  const mobileLinks = items
    .map((i) => `<a href="${i.href}" class="${active === i.href ? "active" : ""}">${i.icon(22)}<span>${t(i.key)}</span></a>`)
    .join("");
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a href="${brandHref}" class="topbar-brand">
          ${iconLogo()}
          <span>صيدليتي</span>
        </a>
        <nav class="topbar-nav">${desktopLinks}</nav>
        <div class="flex gap-2 items-center">
          <button class="lang-toggle" onclick="toggleLang()">${currentLang === "ar" ? "EN" : "ع"}</button>
        </div>
      </div>
    </header>
    <nav class="bottomnav">${mobileLinks}</nav>
  `;
}

// ---------- Inline icons ----------
function svg(d, opts = {}) {
  const size = opts.size || 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${opts.fill || "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}
function iconLogo() {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="20" height="20" rx="6" fill="#00E5A8"/>
    <path d="M12 7v10M7 12h10" stroke="#000" stroke-width="2.75" stroke-linecap="round"/>
  </svg>`;
}
const iconHome = (s) => svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>', { size: s });
const iconPackage = (s) => svg('<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>', { size: s });
const iconUser = (s) => svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', { size: s });
const iconDash = (s) => svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>', { size: s });
const iconInbox = (s) => svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>', { size: s });
const iconSettings = (s) => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>', { size: s });
const iconBack = (s) => svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', { size: s });
const iconChat = (s) => svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>', { size: s });
const iconStarFilled = (s = 14) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const iconMapPin = (s) => svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', { size: s });
const iconClock = (s) => svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', { size: s });
const iconBike = (s) => svg('<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h3l3 5"/><path d="M5.5 17.5 9 8h6l3 9.5"/>', { size: s });
const iconBuilding = (s) => svg('<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4"/>', { size: s });
const iconStar = (s) => svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', { size: s });
const iconTrash = (s) => svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>', { size: s });
const iconPencil = (s) => svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>', { size: s });

// ---------- Polling (real-time-ish) ----------
// Fires `fn` every `ms` ms. Pauses while tab is hidden. Returns a stop fn.
// Errors during polling are swallowed silently — only used to refresh views.
function startPolling(fn, ms = 5000) {
  let stopped = false;
  let timer = null;

  function schedule() {
    if (stopped) return;
    timer = setTimeout(tick, ms);
  }
  async function tick() {
    if (document.visibilityState !== "visible") return schedule();
    try { await fn(); } catch {}
    schedule();
  }
  function onVisible() {
    if (document.visibilityState === "visible" && !stopped) {
      clearTimeout(timer);
      tick();
    }
  }
  document.addEventListener("visibilitychange", onVisible);

  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// ---------- Phone formatting (Jordanian) ----------
function formatPhone(p) {
  if (!p) return "";
  // Strip everything except digits and a leading +
  let s = String(p).replace(/[^\d+]/g, "");
  // Normalize to "962XXXXXXXXX" form
  if (s.startsWith("+962")) s = s.slice(1);
  else if (s.startsWith("00962")) s = s.slice(2);
  else if (s.startsWith("0")) s = "962" + s.slice(1);
  else if (!s.startsWith("962")) s = "962" + s;
  // Need 12 digits total (962 + 9 digits) for a valid JO mobile
  if (s.length !== 12) return p; // give up gracefully, return raw
  // 962 7X XXX XXXX
  return `+${s.slice(0, 3)} ${s.slice(3, 5)} ${s.slice(5, 8)} ${s.slice(8)}`;
}

// ---------- Date formatting ----------
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(currentLang === "ar" ? "ar-JO" : "en-US", {
    hour: "2-digit", minute: "2-digit",
  });
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString(currentLang === "ar" ? "ar-JO" : "en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}
function formatRelative(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("time.justNow");
  if (m < 60) return `${m}${currentLang === "ar" ? " د" : "m"}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${currentLang === "ar" ? " س" : "h"}`;
  return formatDate(ts);
}

// ---------- Skeleton helpers ----------
function skeletonRows(count, height = "5rem") {
  return Array.from({ length: count })
    .map(() => `<div class="skeleton" style="height:${height}"></div>`)
    .join("");
}

// ---------- HTML escaping ----------
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- AI prescription extraction card ----------
// Renders the AI reading of a prescription based on order.ai_status / ai_extraction.
// `audience` is "client" or "pharmacy" — changes the intro line only.
function aiExtractionCard(order, audience = "client") {
  const status = order.ai_status;
  const aiEnabled = window.SAYDALIYATI_CONFIG && window.SAYDALIYATI_CONFIG.AI_ENABLED;
  const hasRx = !!order.prescription_path;

  // Nothing to show: no prescription, or AI disabled and never run
  if (!hasRx) return "";
  if ((!status || status === "none") && !aiEnabled) return "";

  // A re-scan / scan button (shown when AI is enabled and not currently running)
  const canScan = aiEnabled && status !== "pending";
  const scanLabel = status === "done" ? t("ai.rescan") : t("ai.scan");
  const scanBtn = canScan
    ? `<button class="btn btn-secondary btn-sm" onclick="triggerExtraction()" style="margin-top:0.875rem">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
         ${scanLabel}
       </button>`
    : "";

  let inner = "";
  if (status === "pending") {
    inner = `<div class="flex items-center gap-3"><div class="spinner"></div><span class="muted">${t("ai.reading")}</span></div>`;
  } else if (status === "failed") {
    inner = `<p class="muted text-sm" style="margin:0">${t("ai.failed")}</p>${scanBtn}`;
  } else if (!status || status === "none") {
    // Has a prescription + AI enabled, but not scanned yet
    inner = `<p class="muted text-sm" style="margin:0">${t("ai.notScanned")}</p>${scanBtn}`;
  } else if (status === "done") {
    let data = null;
    try { data = JSON.parse(order.ai_extraction); } catch {}
    if (!data || !data.legible || !data.medications || data.medications.length === 0) {
      inner = `<p class="muted text-sm" style="margin:0">${t("ai.illegible")}</p>${scanBtn}`;
    } else {
      const ar = currentLang === "ar";
      const pick = (m, base) => (ar ? (m[base + "_ar"] || m[base + "_en"]) : (m[base + "_en"] || m[base + "_ar"])) || m[base] || null;
      const intro = audience === "pharmacy" ? t("ai.introPharmacy") : t("ai.introClient");
      const meds = data.medications.map((m) => {
        const conf = m.confidence || "medium";
        const confColor = conf === "high" ? "green" : conf === "low" ? "red" : "amber";
        const qty = pick(m, "quantity");
        const sub = [m.strength, pick(m, "form"), qty ? `×${qty}` : null]
          .filter(Boolean).map(escapeHtml).join(" · ");
        const instructions = pick(m, "instructions");
        return `
          <div class="ai-med">
            <div class="flex items-center justify-between gap-2">
              <strong>${escapeHtml(pick(m, "name") || "—")}</strong>
              <span class="pill pill-${confColor} pill-no-dot" style="font-size:0.625rem;padding:0.125rem 0.5rem">${t("ai.conf_" + conf)}</span>
            </div>
            ${sub ? `<div class="muted text-sm">${sub}</div>` : ""}
            ${instructions ? `<div class="text-xs" style="color:var(--fg-subtle);margin-top:0.125rem">${escapeHtml(instructions)}</div>` : ""}
          </div>`;
      }).join("");
      const notes = (ar ? (data.notes_ar || data.notes_en) : (data.notes_en || data.notes_ar)) || data.notes || null;
      inner = `<p class="ai-intro">${intro}</p><div class="ai-meds">${meds}</div>${notes ? `<p class="muted text-xs mt-2">${escapeHtml(notes)}</p>` : ""}${scanBtn}`;
    }
  }

  return `
    <div class="ai-card mb-4">
      <div class="ai-card-head">
        <span class="ai-badge">✨ ${t("ai.title")}</span>
      </div>
      ${inner}
      ${status === "done" ? `<p class="ai-disclaimer">${t("ai.disclaimer")}</p>` : ""}
    </div>
  `;
}
