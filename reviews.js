const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

// ============================================================
// POST /api/reviews
// ============================================================
router.post("/", requireAuth, (req, res) => {
  const { order_id, rating, comment } = req.body;
  if (!order_id || !rating)
    return res.status(400).json({ error: "order_id and rating required" });
  if (rating < 1 || rating > 5)
    return res.status(400).json({ error: "Rating must be 1-5" });

  const order = db
    .prepare("SELECT client_id, pharmacy_id, status FROM orders WHERE id = ?")
    .get(order_id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.client_id !== req.session.userId)
    return res.status(403).json({ error: "Not your order" });
  if (order.status !== "completed")
    return res.status(400).json({ error: "Can only review completed orders" });

  const existing = db
    .prepare("SELECT id FROM reviews WHERE order_id = ?")
    .get(order_id);
  if (existing)
    return res.status(409).json({ error: "Already reviewed" });

  db.prepare(
    `INSERT INTO reviews (id, order_id, client_id, pharmacy_id, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    order_id,
    req.session.userId,
    order.pharmacy_id,
    rating,
    comment || null,
    Date.now()
  );

  // Recompute pharmacy avg rating
  const { avg } = db
    .prepare("SELECT AVG(rating) AS avg FROM reviews WHERE pharmacy_id = ?")
    .get(order.pharmacy_id);
  db.prepare("UPDATE pharmacies SET rating = ? WHERE id = ?").run(
    +avg.toFixed(2),
    order.pharmacy_id
  );

  res.json({ ok: true });
});

// ============================================================
// GET /api/reviews?pharmacy_id=X
// ============================================================
router.get("/", (req, res) => {
  const { pharmacy_id } = req.query;
  if (!pharmacy_id) return res.status(400).json({ error: "pharmacy_id required" });
  const rows = db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS client_name
       FROM reviews r JOIN users u ON u.id = r.client_id
       WHERE r.pharmacy_id = ? ORDER BY r.created_at DESC`
    )
    .all(pharmacy_id);
  res.json(rows);
});

module.exports = router;
