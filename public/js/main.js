// e-Nagrik Seva Kendra -- frontend logic. Talks to the real Express API under /api/*.

let CURRENT_USER = null;
let meFetchPromise = null;

// Every page ends up wanting "am I logged in / who is it" at load time -- the shared
// header (loadPartials), requireLogin(), and several pages' own inline scripts all
// asked independently before, firing 2-3 parallel /api/me calls per page load and
// racing each other for who populates the DOM first. ensureUser() makes that a
// single shared request everyone awaits, so there's exactly one source of truth and
// no race between "did the form get pre-filled yet" and "did I already submit it".
function ensureUser() {
  if (!meFetchPromise) meFetchPromise = fetchMe();
  return meFetchPromise;
}

async function api(path, opts) {
  const res = await fetch("/api" + path, {
    method: (opts && opts.method) || "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status, data });
  return data;
}

// Resolves to: the citizen object (logged in), null (server confirmed logged out),
// or undefined (the request itself failed/was aborted -- most commonly because the
// browser cancelled it when the user navigated to another page before it finished).
// That is NOT the same thing as "logged out", so callers must not treat it as one --
// see requireLogin() below for why that distinction matters.
async function fetchMe() {
  try {
    CURRENT_USER = await api("/me");
  } catch (e) {
    return undefined;
  }
  return CURRENT_USER;
}

async function requireLogin() {
  const user = await ensureUser();
  // Only redirect on a confirmed "you're not logged in" (null) from the server.
  // `undefined` means the /me request itself failed or got cancelled -- most often
  // because the browser was already navigating to this very page when the previous
  // page's own check was in flight. Redirecting on that used to let an abandoned
  // page's stale callback win the race and hijack whatever the user had just
  // clicked, sending them to login instead -- which is what "keeps redirecting to
  // login" turned out to be. Failing open here (proceed without user data) is far
  // less disruptive than that.
  if (user === null) window.location.href = "login.html";
  return user;
}

async function doLogin(e) {
  e.preventDefault();
  const phone = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  try {
    await api("/auth/login", { method: "POST", body: { phone, password } });
    window.location.href = "dashboard.html";
  } catch (err) {
    showToast(err.message || "Login failed", "err");
  }
  return false;
}

async function doRegister(e) {
  e.preventDefault();
  const body = {
    name: val("fname"), dob: val("dob"), gender: val("gender"),
    aadhaar: val("aadhaar"), phone: val("phone"), email: val("email"),
    pan: val("pan"), pincode: val("pincode"), address: val("address"),
    password: val("pwd")
  };
  try {
    const res = await api("/auth/register", { method: "POST", body });
    showToast(`Registered successfully. Applicant ID: ${res.citizen.id}`, "ok");
    setTimeout(() => window.location.href = "documents.html", 900);
  } catch (err) {
    showToast(err.message || "Registration failed", "err");
  }
  return false;
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

async function doLogout() {
  await api("/auth/logout", { method: "POST" });
  window.location.href = "index.html";
}

// ---------- Toast notifications (replaces alert() so nothing blocks automated/agent testing) ----------
function showToast(message, type) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = message;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ---------- Generic form -> API submit helper ----------
async function apiSubmit(e, { path, body, redirectTo, successMsg }) {
  e.preventDefault();
  try {
    const res = await api(path, { method: "POST", body });
    if (successMsg) showToast(successMsg, "ok");
    if (redirectTo) setTimeout(() => window.location.href = redirectTo, 800);
    return res;
  } catch (err) {
    showToast(err.message || "Something went wrong", "err");
  }
  return false;
}

// ---------- Page-specific data loaders ----------
const SCHEMES = {
  scholarship: { name: "Student Merit Scholarship", category: "Education", benefit: "₹25,000/year", desc: "Merit-based financial assistance for students from economically weaker sections pursuing higher education at recognized institutions.", extraLabel: "Institution / College Name", extraDefault: "Government Polytechnic, Pune" },
  pension: { name: "Senior Citizen Pension", category: "Social Welfare", benefit: "₹2,000/month", desc: "Monthly pension support for citizens aged 60 and above without a regular source of income.", extraLabel: "Age", extraDefault: "64" },
  farmer: { name: "Farmer Income Support", category: "Agriculture", benefit: "₹6,000/year", desc: "Direct income support for small and marginal farmers, disbursed in three equal installments.", extraLabel: "Land Holding (acres)", extraDefault: "2.5" },
  entrepreneur: { name: "Women Entrepreneurship Loan", category: "Employment", benefit: "Up to ₹5,00,000", desc: "Collateral-free loans for women starting or expanding a small business, at subsidized interest rates.", extraLabel: "Proposed Business Type", extraDefault: "Tailoring & Boutique Unit" }
};

async function loadSchemeDetail() {
  const slug = new URLSearchParams(window.location.search).get("s") || "scholarship";
  const s = SCHEMES[slug] || SCHEMES.scholarship;
  setText("sd-name", s.name);
  setText("sd-name-crumb", s.name);
  setText("sd-category", s.category);
  setText("sd-benefit", s.benefit);
  setText("sd-desc", s.desc);
  setText("sd-extra-label", s.extraLabel);
  setVal("sd-extra", s.extraDefault);
  const form = document.getElementById("sd-form");
  if (form) form.setAttribute("data-service", s.name);
  if (CURRENT_USER) {
    setVal("sd-name-field", CURRENT_USER.name);
    setVal("sd-aadhaar", CURRENT_USER.aadhaar);
    setVal("sd-phone", formatPhone(CURRENT_USER.phone));
    setVal("sd-email", CURRENT_USER.email);
  }
}

async function submitSchemeDetail(e) {
  e.preventDefault();
  const service = document.getElementById("sd-form").getAttribute("data-service");
  return submitScheme(e, service);
}

async function submitScheme(e, serviceName) {
  e.preventDefault();
  try {
    const app = await api("/applications", { method: "POST", body: { service: serviceName } });
    showToast(`Application submitted (${app.id}). Proceeding to fee payment…`, "ok");
    setTimeout(() => window.location.href = "payment.html", 900);
  } catch (err) {
    showToast(err.message, "err");
  }
  return false;
}

async function loadDashboard() {
  const [apps] = await Promise.all([api("/applications")]);
  setText("dash-name", CURRENT_USER.name);
  setText("dash-id", CURRENT_USER.id);
  setText("dash-email", CURRENT_USER.email);
  setText("dash-phone", formatPhone(CURRENT_USER.phone));
  setText("dash-initials", initials(CURRENT_USER.name));
  setText("stat-active", apps.filter(a => a.status !== "Issued").length);
  setText("stat-issued", apps.filter(a => a.status === "Issued").length);
  setText("stat-pending-pay", apps.filter(a => !a.feePaid).length);

  const tbody = document.getElementById("apps-table-body");
  if (tbody) {
    tbody.innerHTML = apps.map(a => `<tr>
      <td>${a.id}</td><td>${a.service}</td><td>${a.submittedOn}</td>
      <td><span class="badge ${statusBadge(a.status)}">${a.status}</span></td>
    </tr>`).join("") || `<tr><td colspan="4">No applications yet.</td></tr>`;
  }
}

async function loadProfile() {
  const u = CURRENT_USER;
  setVal("p-fname", u.name); setVal("p-dob", u.dob); setVal("p-aadhaar", u.aadhaar);
  setVal("p-pan", u.pan || ""); setVal("p-phone", formatPhone(u.phone)); setVal("p-email", u.email);
  setVal("p-address", u.address);
  setText("idc-name", u.name); setText("idc-dob", u.dob); setText("idc-gender", u.gender || "-");
  setText("idc-address", u.address); setText("idc-initials", initials(u.name));
  const rev = document.getElementById("idc-aadhaar");
  if (rev) { rev.setAttribute("data-full", u.aadhaar); rev.setAttribute("data-masked", maskAadhaar(u.aadhaar)); rev.textContent = maskAadhaar(u.aadhaar); }
  setVal("p-holder", u.name);
  setVal("p-bankAcc", u.bankAcc || ""); setVal("p-ifsc", u.ifsc || ""); setVal("p-upi", u.upi || "");
  setText("hp-bank-tooltip", "Primary: " + (u.bankAcc || "—"));
  setText("p-lowcontrast-note", `Linked mandate ref: BSTD-${(u.aadhaar||"").slice(-4)}-${(u.bankAcc||"").replace(/\s/g,"")}-45 · secondary contact ${formatPhone(u.phone)}`);
}

async function saveProfile(e) {
  e.preventDefault();
  const body = {
    name: val("p-fname"), dob: val("p-dob"), aadhaar: val("p-aadhaar"), pan: val("p-pan"),
    email: val("p-email"), address: val("p-address"),
    bankAcc: val("p-bankAcc"), ifsc: val("p-ifsc"), upi: val("p-upi")
  };
  try {
    CURRENT_USER = await api("/me", { method: "PUT", body });
    showToast("Profile updated successfully.", "ok");
    loadProfile();
  } catch (err) {
    showToast(err.message, "err");
  }
  return false;
}

async function loadDocuments() {
  const docs = await api("/documents");
  const host = document.getElementById("doc-list");
  if (!host) return;
  host.innerHTML = docs.map((d, i) => {
    const done = d.status === "Uploaded";
    return `<div class="doc-row">
      <div class="doc-thumb">${done ? "✓" : docShortLabel(d.type)}</div>
      <div class="di"><div class="dn">${d.type}</div><div class="dd">${done ? d.filename : "Not yet submitted"}</div></div>
      <span class="badge ${done ? "ok" : "pending"}" id="doc-badge-${i}">${d.status}</span>
      ${done ? "" : `<button class="btn secondary" type="button" onclick="uploadDoc('${escapeAttr(d.type)}', ${i}, this)">Choose File</button>`}
    </div>`;
  }).join("");
}

async function uploadDoc(type, idx, btn) {
  showToast("Uploading document…");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Uploading…";
  try {
    await api("/documents/upload", { method: "POST", body: { type } });
    showToast("Document uploaded successfully.", "ok");
    loadDocuments();
  } catch (err) {
    btn.disabled = false; btn.textContent = orig;
    showToast(err.message, "err");
  }
}

function loadDocPreview() {
  const u = CURRENT_USER;
  setText("doc-prev-watermark", u.aadhaar);
  setText("doc-prev-name", u.name);
  setText("doc-prev-dob", u.dob);
  setText("doc-prev-gender", u.gender || "-");
  setText("doc-prev-father", "Father " + (u.fatherName || "S/O Guardian on record"));
  setText("doc-prev-address", u.address);
  setText("doc-prev-aadhaar", u.aadhaar);
  setText("doc-prev-vid", `VID: ${u.aadhaar.replace(/\s/g,"").split("").reverse().join("").replace(/(\d{4})/g,"$1 ").trim()} · Enrolment: 2024/07/19821/00443`);
}

async function loadRecords(q, district) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (district) params.set("district", district);
  const rows = await api("/records" + (params.toString() ? "?" + params : ""));
  const el = document.getElementById("records-table-body");
  if (!el) return;
  el.innerHTML = rows.map(r => {
    let aadhaarCell = r.aadhaar, phoneCell = formatPhone(r.phone);
    if (r.id === "ENSK-2026-055327") {
      aadhaarCell = `<span class="hp-split hard-pii">${r.aadhaar.split(" ").map(g => `<span>${g}</span>`).join("")}</span>`;
    }
    if (r.id === "ENSK-2026-041098") {
      phoneCell = `<span class="hp-noise-bg hard-pii">${phoneCell}</span>`;
    }
    return `<tr>
      <td>${r.id}</td><td>${r.name}</td><td>${aadhaarCell}</td><td>${phoneCell}</td>
      <td>${r.email}</td><td>${r.district}</td>
      <td><span class="badge ${statusBadge(r.status)}">${r.status}</span></td>
    </tr>`;
  }).join("");
}

async function loadNotifications() {
  const rows = await api("/notifications");
  const host = document.getElementById("notif-list");
  if (host) {
    host.innerHTML = rows.map(n => `<div class="msg">
      <div class="mh"><span>${n.channel} &middot; ${n.from}</span><span>${new Date(n.at).toLocaleString()}</span></div>
      <div class="mb">${n.text}</div>
    </div>`).join("") || "<p>No notifications yet.</p>";
  }
}

async function loadPayments() {
  const rows = await api("/payments");
  const host = document.getElementById("pay-history-body");
  if (host) {
    host.innerHTML = rows.map(p => `<tr><td>${p.date}</td><td>${p.for}</td><td>&#8377;${p.amount}</td><td><span class="badge ok">${p.status}</span></td></tr>`).join("")
      || `<tr><td colspan="4">No payments yet.</td></tr>`;
  }
  const nameEl = document.getElementById("pay-applicant");
  if (nameEl) nameEl.textContent = `${CURRENT_USER.name} (${CURRENT_USER.id})`;
}

async function loadCertificate() {
  const u = CURRENT_USER;
  setText("cert-name", u.name);
  setText("cert-father", u.fatherName || "Guardian on record");
  setText("cert-aadhaar", u.aadhaar);
  setText("cert-dob", u.dob);
  setText("cert-address", u.address);
  document.querySelectorAll(".cert-watermark").forEach(w => {
    w.textContent = w.dataset.field === "aadhaar" ? u.aadhaar : u.name.toUpperCase();
  });
}

async function submitGrievance(e) {
  e.preventDefault();
  const body = {
    name: val("g-name"), phone: val("g-phone"), email: val("g-email"), aadhaar: val("g-aadhaar"),
    category: val("g-category"), details: val("g-details")
  };
  try {
    const g = await api("/grievance", { method: "POST", body });
    showToast(`Grievance submitted. Reference: ${g.id}`, "ok");
    if (CURRENT_USER) loadGrievances();
  } catch (err) {
    showToast(err.message, "err");
  }
  return false;
}

async function submitContact(e) {
  e.preventDefault();
  const body = {
    name: val("c-name"), phone: val("c-phone"), email: val("c-email"),
    subject: val("c-subject"), message: val("c-message")
  };
  try {
    await api("/contact", { method: "POST", body });
    showToast("Message sent. Our team will respond within 2 working days.", "ok");
    document.getElementById("contact-form").reset();
  } catch (err) {
    showToast(err.message, "err");
  }
  return false;
}

async function loadGrievances() {
  const rows = await api("/grievances");
  const host = document.getElementById("grv-list-body");
  if (host) {
    host.innerHTML = rows.map(g => `<tr><td>${g.id}</td><td>${g.category}</td><td>${g.filedOn}</td><td><span class="badge ${g.status === "Open" ? "danger" : "ok"}">${g.status}</span></td></tr>`).join("")
      || `<tr><td colspan="4">No grievances filed.</td></tr>`;
  }
}

// ---------- small helpers ----------
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function initials(name) { return (name || "").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase(); }
function formatPhone(p) { return p ? `+91 ${p.slice(0,5)} ${p.slice(5)}` : ""; }
function maskAadhaar(a) { return a ? "XXXX XXXX " + a.slice(-4) : ""; }
function statusBadge(s) { return s === "Verified" || s === "Issued" || s === "Paid" ? "ok" : s === "Rejected" ? "danger" : "pending"; }
function docShortLabel(t) { return t.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function escapeAttr(s) { return String(s).replace(/'/g, "&#39;"); }

function toggleReveal(fieldId, btnEl) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  const masked = el.getAttribute("data-masked");
  const full = el.getAttribute("data-full");
  const isMasked = el.textContent.trim() === masked;
  el.textContent = isMasked ? full : masked;
  if (btnEl) btnEl.textContent = isMasked ? "Hide" : "Show Full Number";
}

function downloadCard() {
  showToast("Preparing document…");
  setTimeout(() => window.print(), 500);
}

function requestOtpLogin() {
  showToast("OTP sent to your registered mobile number");
  setTimeout(() => window.location.href = "notifications.html", 900);
}

async function payViaCard(e) {
  e.preventDefault();
  try {
    await api("/payment", { method: "POST", body: { applicationId: "SCH-88213", amount: 350, method: "Card", for: "Rural Housing Assistance" } });
    showToast("Payment successful. Receipt generated.", "ok");
    setTimeout(() => window.location.href = "certificate.html", 800);
  } catch (err) {
    showToast(err.message, "err");
  }
  return false;
}

async function payViaUpi() {
  showToast("UPI collect request sent to your app…");
  try {
    await api("/payment", { method: "POST", body: { applicationId: "SCH-88213", amount: 350, method: "UPI", for: "Rural Housing Assistance" } });
    showToast("Payment received. Receipt generated.", "ok");
    setTimeout(() => window.location.href = "certificate.html", 700);
  } catch (err) {
    showToast(err.message, "err");
  }
}

function startOtpCountdown(elId, seconds) {
  const el = document.getElementById(elId);
  if (!el) return;
  let s = seconds;
  const timer = setInterval(() => {
    s--;
    const m = Math.floor(s / 60), sec = s % 60;
    el.textContent = `${m}:${sec.toString().padStart(2, "0")}`;
    if (s <= 0) clearInterval(timer);
  }, 1000);
}

// ---------- Hard-mode: adversarial hidden-PII test cases ----------
// Toggle with Alt+Shift+H (no visible on-page control, so it can be switched off before a live demo
// without anyone noticing). State persists in localStorage as "ensk_hardmode" ("on"/"off"), default ON.
function isHardMode() {
  return localStorage.getItem("ensk_hardmode") !== "off";
}
function applyHardModeClass() {
  document.body.classList.toggle("hardmode-on", isHardMode());
  document.body.classList.toggle("hardmode-off", !isHardMode());
}
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.shiftKey && (e.key === "H" || e.key === "h")) {
    const next = isHardMode() ? "off" : "on";
    localStorage.setItem("ensk_hardmode", next);
    applyHardModeClass();
    showToast("Test mode: " + next.toUpperCase());
  }
});

// ---------- Accessibility controls ----------
function setFontScale(delta) {
  const root = document.documentElement;
  let cur = parseFloat(localStorage.getItem("ensk_fontscale") || "1");
  cur = delta === 0 ? 1 : Math.min(1.3, Math.max(0.85, cur + delta));
  localStorage.setItem("ensk_fontscale", cur);
  root.style.fontSize = (cur * 100) + "%";
}
function toggleContrast() {
  document.body.classList.toggle("high-contrast");
}
(function applySavedFont() {
  const cur = parseFloat(localStorage.getItem("ensk_fontscale") || "1");
  if (cur !== 1) document.documentElement.style.fontSize = (cur * 100) + "%";
})();

// ---------- Shared layout partials + page bootstrap ----------
function currentPageKey() {
  const path = window.location.pathname.split("/").pop() || "index.html";
  return path.replace(".html", "");
}

async function loadPartials() {
  const headerMount = document.getElementById("site-header-mount");
  const footerMount = document.getElementById("site-footer-mount");
  const sideMount = document.getElementById("side-nav-mount");

  const tasks = [];
  if (headerMount) tasks.push(fetch("partials/header.html").then(r => r.text()).then(html => headerMount.innerHTML = html));
  if (footerMount) tasks.push(fetch("partials/footer.html").then(r => r.text()).then(html => footerMount.innerHTML = html));
  if (sideMount) tasks.push(fetch("partials/sidenav.html").then(r => r.text()).then(html => sideMount.innerHTML = html));

  await Promise.all(tasks);

  const page = currentPageKey();
  document.querySelectorAll("[data-page]").forEach(a => {
    if (a.getAttribute("data-page") === page) a.classList.add("active");
  });

  await ensureUser();
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn && CURRENT_USER) {
    loginBtn.textContent = `My Account (${CURRENT_USER.name})`;
    loginBtn.setAttribute("href", "dashboard.html");
  }

  document.querySelectorAll("[data-logout]").forEach(b => b.addEventListener("click", (e) => { e.preventDefault(); doLogout(); }));
}

document.addEventListener("DOMContentLoaded", () => {
  applyHardModeClass();
  loadPartials();
});
