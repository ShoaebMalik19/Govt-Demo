const express = require("express");
const db = require("../lib/db");

const router = express.Router();

function publicCitizen(c) {
  if (!c) return null;
  const { password, ...rest } = c;
  return rest;
}

function guessDistrict(address) {
  if (!address) return null;
  const parts = String(address).split(",").map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function requireAuth(req, res, next) {
  if (!req.session.citizenId) return res.status(401).json({ error: "Not logged in" });
  next();
}

// ---------- Auth ----------
router.post("/auth/login", (req, res) => {
  const { phone, password } = req.body;
  const cleanPhone = String(phone || "").replace(/\D/g, "").slice(-10);
  const citizen = db.findOne("citizens", c => c.phone === cleanPhone && c.password === password);
  if (!citizen) return res.status(401).json({ error: "Invalid mobile number or password" });
  req.session.citizenId = citizen.id;
  res.json({ ok: true, citizen: publicCitizen(citizen) });
});

router.post("/auth/register", (req, res) => {
  const b = req.body;
  const cleanPhone = String(b.phone || "").replace(/\D/g, "").slice(-10);
  if (db.findOne("citizens", c => c.phone === cleanPhone)) {
    return res.status(409).json({ error: "An account with this mobile number already exists" });
  }
  const id = db.nextId("ENSK-2026", "citizen");
  const district = b.district || guessDistrict(b.address) || "Gandhinagar";
  const citizen = {
    id,
    name: b.name, dob: b.dob, gender: b.gender, aadhaar: b.aadhaar,
    phone: cleanPhone, email: b.email, pan: b.pan || "",
    address: b.address, pincode: b.pincode, district,
    password: b.password, bankAcc: "", ifsc: "", upi: "",
    status: "Pending", createdAt: new Date().toISOString()
  };
  db.insert("citizens", citizen);
  ["Passport Size Photograph", "Aadhaar Card (front & back)", "PAN Card", "Income Certificate", "Bank Passbook (first page)"]
    .forEach(type => db.insert("documents", { citizenId: id, type, status: "Pending", filename: null }));
  req.session.citizenId = id;
  res.json({ ok: true, citizen: publicCitizen(citizen) });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Always 200: "am I logged in" is a routine check every page makes, not an error
// condition, so it shouldn't surface as a failed-request in the browser console.
// null means "not logged in" -- callers branch on that, not on HTTP status.
router.get("/me", (req, res) => {
  if (!req.session.citizenId) return res.json(null);
  const citizen = db.findOne("citizens", c => c.id === req.session.citizenId);
  if (!citizen) return res.json(null);
  res.json(publicCitizen(citizen));
});

router.put("/me", requireAuth, (req, res) => {
  const patch = { ...req.body };
  delete patch.id; delete patch.password; delete patch.status; delete patch.createdAt;
  const citizen = db.update("citizens", c => c.id === req.session.citizenId, patch);
  res.json(publicCitizen(citizen));
});

// ---------- Applications ----------
router.get("/applications", requireAuth, (req, res) => {
  res.json(db.getAll("applications").filter(a => a.citizenId === req.session.citizenId));
});

router.post("/applications", requireAuth, (req, res) => {
  const { service } = req.body;
  const id = db.nextId(service && service.toLowerCase().includes("certificate") ? "CRT" : "SCH", "app");
  const app = {
    id, citizenId: req.session.citizenId, service,
    submittedOn: new Date().toISOString().slice(0, 10),
    status: "Under Review", feePaid: false
  };
  db.insert("applications", app);
  db.insert("notifications", {
    citizenId: req.session.citizenId, channel: "System", from: "System",
    text: `Your application ${id} (${service}) has been submitted and is now Under Review.`,
    at: new Date().toISOString()
  });
  res.json(app);
});

// ---------- Documents ----------
router.get("/documents", requireAuth, (req, res) => {
  res.json(db.getAll("documents").filter(d => d.citizenId === req.session.citizenId));
});

router.post("/documents/upload", requireAuth, (req, res) => {
  const { type } = req.body;
  const slug = String(type).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24);
  const doc = db.update("documents", d => d.citizenId === req.session.citizenId && d.type === type, {
    status: "Uploaded",
    filename: `${slug}_${Date.now()}.jpg`
  });
  res.json(doc);
});

// ---------- Records (staff/internal search view) ----------
router.get("/records", requireAuth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const district = req.query.district;
  let rows = db.getAll("citizens").map(c => ({
    id: c.id, name: c.name, aadhaar: c.aadhaar, phone: c.phone, email: c.email,
    district: c.district, status: c.status
  }));
  if (q) rows = rows.filter(r =>
    r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.aadhaar || "").includes(q)
  );
  if (district && district !== "All Districts") rows = rows.filter(r => r.district === district);
  res.json(rows);
});

// ---------- Grievances ----------
router.get("/grievances", requireAuth, (req, res) => {
  res.json(db.getAll("grievances").filter(g => g.citizenId === req.session.citizenId));
});

router.post("/grievance", (req, res) => {
  const b = req.body;
  const id = db.nextId("GRV", "grv");
  const grievance = {
    id, citizenId: req.session.citizenId || null,
    name: b.name, phone: b.phone, email: b.email, aadhaar: b.aadhaar,
    category: b.category, details: b.details,
    filedOn: new Date().toISOString().slice(0, 10), status: "Open"
  };
  db.insert("grievances", grievance);
  res.json(grievance);
});

// ---------- Payments ----------
router.get("/payments", requireAuth, (req, res) => {
  res.json(db.getAll("payments").filter(p => p.citizenId === req.session.citizenId));
});

router.post("/payment", requireAuth, (req, res) => {
  const { applicationId, amount, method, for: forLabel } = req.body;
  const id = db.nextId("PAY", "pay");
  const payment = {
    id, citizenId: req.session.citizenId, for: forLabel || applicationId, amount: amount || 0,
    method: method || "Card", date: new Date().toISOString().slice(0, 10), status: "Paid"
  };
  db.insert("payments", payment);
  if (applicationId) db.update("applications", a => a.id === applicationId, { feePaid: true });
  db.insert("notifications", {
    citizenId: req.session.citizenId, channel: "System", from: "System",
    text: `Payment of Rs. ${amount} received for ${forLabel || applicationId}. Receipt ${id}.`,
    at: new Date().toISOString()
  });
  res.json(payment);
});

// ---------- Notifications ----------
router.get("/notifications", requireAuth, (req, res) => {
  const rows = db.getAll("notifications")
    .filter(n => n.citizenId === req.session.citizenId)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json(rows);
});

// ---------- Contact (public) ----------
router.post("/contact", (req, res) => {
  db.insert("messages", { ...req.body, at: new Date().toISOString() });
  res.json({ ok: true });
});

module.exports = router;
