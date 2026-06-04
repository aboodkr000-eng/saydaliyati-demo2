const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

// ============================================================
// SSE — keep open connections per order
// ============================================================
const listeners = new Map(); // orderId -> Set<res>

function broadcast(orderId, message) {
  const set = listeners.get(orderId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

// ============================================================
// Authorization helper — only order participants can chat
// ============================================================
function getOrderIfAllowed(orderId, userId) {
  const order = db
    .prepare(
      `SELECT o.client_id, p.owner_id AS pharmacy_owner_id
       FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id
       WHERE o.id = ?`
    )
    .get(orderId);
  if (!order) return null;
  if (order.client_id !== userId && order.pharmacy_owner_id !== userId)
    return null;
  return order;
}

// ============================================================
// Helper — mark messages as read for the current user on this order
// ============================================================
function markRead(orderId, userId, order) {
  // `order` here may be the result of getOrderIfAllowed (has client_id, pharmacy_owner_id)
  const isClient = order.client_id === userId;
  const field = isClient ? "client_last_read_at" : "pharmacy_last_read_at";
  db.prepare(`UPDATE orders SET ${field} = ? WHERE id = ?`).run(Date.now(), orderId);
}

// ============================================================
// GET /api/messages?order_id=X — list past messages (and mark as read)
// ============================================================
router.get("/", requireAuth, (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) return res.status(400).json({ error: "order_id required" });
  const order = getOrderIfAllowed(orderId, req.session.userId);
  if (!order) return res.status(403).json({ error: "Not your order" });

  const rows = db
    .prepare(
      `SELECT m.id, m.order_id, m.sender_id, m.body, m.created_at,
              u.full_name AS sender_name, u.role AS sender_role
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.order_id = ? ORDER BY m.created_at ASC`
    )
    .all(orderId);
  markRead(orderId, req.session.userId, order);
  res.json(rows);
});

// ============================================================
// POST /api/messages/read?order_id=X — mark all messages read
// (called by chat page after receiving an SSE message)
// ============================================================
router.post("/read", requireAuth, (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) return res.status(400).json({ error: "order_id required" });
  const order = getOrderIfAllowed(orderId, req.session.userId);
  if (!order) return res.status(403).json({ error: "Not your order" });
  markRead(orderId, req.session.userId, order);
  res.json({ ok: true });
});

// ============================================================
// POST /api/messages — send a new message
// ============================================================
router.post("/", requireAuth, (req, res) => {
  const { order_id, body } = req.body;
  if (!order_id || !body || !body.trim())
    return res.status(400).json({ error: "order_id and body required" });
  if (!getOrderIfAllowed(order_id, req.session.userId))
    return res.status(403).json({ error: "Not your order" });

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO messages (id, order_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, order_id, req.session.userId, body.trim(), now);

  const sender = db
    .prepare("SELECT full_name, role FROM users WHERE id = ?")
    .get(req.session.userId);

  const message = {
    id,
    order_id,
    sender_id: req.session.userId,
    body: body.trim(),
    created_at: now,
    sender_name: sender.full_name,
    sender_role: sender.role,
  };

  broadcast(order_id, message);
  res.json(message);
});

// ============================================================
// GET /api/messages/stream?order_id=X — SSE live updates
// ============================================================
router.get("/stream", requireAuth, (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) return res.status(400).end();
  if (!getOrderIfAllowed(orderId, req.session.userId))
    return res.status(403).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`: connected\n\n`);

  if (!listeners.has(orderId)) listeners.set(orderId, new Set());
  listeners.get(orderId).add(res);

  // Heartbeat every 25s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const set = listeners.get(orderId);
    if (set) {
      set.delete(res);
      if (set.size === 0) listeners.delete(orderId);
    }
  });
});

module.exports = router;
