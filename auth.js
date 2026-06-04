const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { db } = require("../db");

const router = express.Router();

// ============================================================
// POST /api/auth/sign-up
// ============================================================
router.post("/sign-up", (req, res) => {
  const {
    email,
    password,
    role,
    full_name,
    phone,
    // pharmacy-only:
    pharmacy_name_en,
    pharmacy_name_ar,
    area,
    latitude,
    longitude,
  } = req.body;

  if (!email || !password || !role || !full_name)
    return res.status(400).json({ error: "Missing required fields" });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!["client", "pharmacy"].includes(role))
    return res.status(400).json({ error: "Invalid role" });

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (existing)
    return res.status(409).json({ error: "Email already registered" });

  const userId = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, full_name, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, email.toLowerCase(), passwordHash, role, full_name, phone || null, now);

    if (role === "pharmacy") {
      if (!pharmacy_name_en || !pharmacy_name_ar || !area) {
        throw new Error("Pharmacy details are required");
      }
      const autoLicense = `JPA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      db.prepare(
        `INSERT INTO pharmacies (
          id, owner_id, name_en, name_ar, license_number, area, phone,
          latitude, longitude, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        userId,
        pharmacy_name_en,
        pharmacy_name_ar,
        autoLicense,
        area,
        phone || null,
        typeof latitude === "number" ? latitude : null,
        typeof longitude === "number" ? longitude : null,
        now
      );
    }
  });

  try {
    tx();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  req.session.userId = userId;
  req.session.role = role;
  res.json({ id: userId, role });
});

// ============================================================
// POST /api/auth/sign-in
// ============================================================
router.post("/sign-in", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const user = db
    .prepare("SELECT id, password_hash, role FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Invalid email or password" });

  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ id: user.id, role: user.role });
});

// ============================================================
// POST /api/auth/sign-out
// ============================================================
router.post("/sign-out", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ============================================================
// GET /api/auth/me — returns current user or 401
// ============================================================
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not signed in" });
  const user = db
    .prepare(
      "SELECT id, email, role, full_name, phone, latitude, longitude, address, created_at FROM users WHERE id = ?"
    )
    .get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Not signed in" });
  }
  res.json(user);
});

// PATCH /api/auth/me — update own profile (name, phone, location, address)
router.patch("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not signed in" });
  const allowed = ["full_name", "phone", "latitude", "longitude", "address"];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (k in req.body) {
      sets.push(`${k} = ?`);
      values.push(req.body[k]);
    }
  }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.session.userId);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// ============================================================
// Helpers exported for use in other route files
// ============================================================
function requireAuth(req, res, next) {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not signed in" });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.session.role !== role)
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
