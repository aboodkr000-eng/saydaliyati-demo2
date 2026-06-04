const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");

const router = express.Router();

// ============================================================
// requireAdmin — gate every endpoint
// ============================================================
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not signed in" });
  const user = db
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(req.session.userId);
  if (!user || user.role !== "admin")
    return res.status(403).json({ error: "Admin only" });
  next();
}

router.use(requireAdmin);

// ============================================================
// GLOBAL STATS — for the admin dashboard
// ============================================================
router.get("/stats", (req, res) => {
  const userCounts = db
    .prepare(
      `SELECT role, COUNT(*) AS count FROM users GROUP BY role`
    )
    .all();
  const orderCounts = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM orders GROUP BY status`
    )
    .all();
  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users) AS users_total,
        (SELECT COUNT(*) FROM pharmacies) AS pharmacies_total,
        (SELECT COUNT(*) FROM pharmacies WHERE is_verified = 1) AS pharmacies_verified,
        (SELECT COUNT(*) FROM orders) AS orders_total,
        (SELECT COUNT(*) FROM messages) AS messages_total,
        (SELECT COUNT(*) FROM reviews) AS reviews_total,
        (SELECT COALESCE(SUM(total_jod), 0) FROM orders WHERE status = 'completed') AS revenue_total`
    )
    .get();
  res.json({ ...totals, by_role: userCounts, by_status: orderCounts });
});

// ============================================================
// USERS
// ============================================================
router.get("/users", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.full_name, u.phone, u.created_at,
              (SELECT COUNT(*) FROM orders WHERE client_id = u.id) AS orders_count,
              (SELECT COUNT(*) FROM pharmacies WHERE owner_id = u.id) AS pharmacies_count
       FROM users u
       ORDER BY u.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.patch("/users/:id", (req, res) => {
  const allowed = ["full_name", "phone", "role"];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (k in req.body) {
      if (k === "role" && !["client", "pharmacy", "admin"].includes(req.body[k]))
        return res.status(400).json({ error: "Invalid role" });
      sets.push(`${k} = ?`);
      values.push(req.body[k]);
    }
  }
  if (req.body.password) {
    if (typeof req.body.password !== "string" || req.body.password.length < 8)
      return res.status(400).json({ error: "Password must be at least 8 chars" });
    sets.push("password_hash = ?");
    values.push(bcrypt.hashSync(req.body.password, 10));
  }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id);
  const result = db
    .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  if (req.params.id === req.session.userId)
    return res.status(400).json({ error: "Can't delete yourself" });
  // Cascade is wired via FK ON DELETE CASCADE
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ============================================================
// PHARMACIES
// ============================================================
router.get("/pharmacies", (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, u.email AS owner_email, u.full_name AS owner_name,
              (SELECT COUNT(*) FROM orders WHERE pharmacy_id = p.id) AS orders_count
       FROM pharmacies p
       LEFT JOIN users u ON u.id = p.owner_id
       ORDER BY p.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.patch("/pharmacies/:id", (req, res) => {
  const allowed = [
    "name_en", "name_ar", "area", "address", "phone",
    "latitude", "longitude", "opens_at", "closes_at",
    "is_24_hours", "delivery_available", "delivery_fee_jod",
    "delivery_radius_km", "is_verified", "rating",
  ];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (k in req.body) {
      sets.push(`${k} = ?`);
      values.push(req.body[k]);
    }
  }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id);
  const result = db
    .prepare(`UPDATE pharmacies SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

router.delete("/pharmacies/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM pharmacies WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ============================================================
// ORDERS
// ============================================================
router.get("/orders", (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*,
              u.full_name AS client_name, u.email AS client_email,
              p.name_en AS pharmacy_name_en, p.name_ar AS pharmacy_name_ar
       FROM orders o
       LEFT JOIN users u ON u.id = o.client_id
       LEFT JOIN pharmacies p ON p.id = o.pharmacy_id
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.patch("/orders/:id", (req, res) => {
  const allowed = ["status", "total_jod", "delivery_fee_jod", "notes"];
  const sets = [];
  const values = [];
  for (const k of allowed) {
    if (k in req.body) {
      sets.push(`${k} = ?`);
      values.push(req.body[k]);
    }
  }
  if (sets.length === 0) return res.json({ ok: true });
  sets.push("updated_at = ?");
  values.push(Date.now());
  values.push(req.params.id);
  const result = db
    .prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

router.delete("/orders/:id", (req, res) => {
  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ============================================================
// REVIEWS
// ============================================================
router.get("/reviews", (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*,
              u.full_name AS client_name, u.email AS client_email,
              p.name_en AS pharmacy_name_en, p.name_ar AS pharmacy_name_ar
       FROM reviews r
       LEFT JOIN users u ON u.id = r.client_id
       LEFT JOIN pharmacies p ON p.id = r.pharmacy_id
       ORDER BY r.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.delete("/reviews/:id", (req, res) => {
  const result = db.prepare("DELETE FROM reviews WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

module.exports = router;
