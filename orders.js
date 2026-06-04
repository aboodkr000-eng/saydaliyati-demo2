const express = require("express");
const multer = require("multer");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { db } = require("../db");
const { requireAuth } = require("./auth");
const ai = require("../ai");

const router = express.Router();

// ============================================================
// MULTER — prescription upload
// ============================================================
const uploadsDir = path.join(__dirname, "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(uploadsDir, req.session.userId || "anon");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 6);
    cb(null, `${crypto.randomBytes(12).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpe?g|png|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : new Error("Only images and PDFs allowed"), ok);
  },
});

// ============================================================
// POST /api/orders — client creates order
// multipart/form-data: pharmacy_id, fulfillment, notes, delivery_address, prescription
// ============================================================
router.post("/", requireAuth, upload.single("prescription"), (req, res) => {
  if (req.session.role !== "client")
    return res.status(403).json({ error: "Only clients can place orders" });

  const { pharmacy_id, fulfillment, notes, delivery_address } = req.body;
  if (!pharmacy_id || !fulfillment)
    return res.status(400).json({ error: "Missing pharmacy_id or fulfillment" });
  if (!["pickup", "delivery"].includes(fulfillment))
    return res.status(400).json({ error: "Invalid fulfillment" });
  if (fulfillment === "delivery" && !delivery_address)
    return res.status(400).json({ error: "Delivery address required" });

  const pharmacy = db
    .prepare("SELECT id, delivery_available FROM pharmacies WHERE id = ?")
    .get(pharmacy_id);
  if (!pharmacy) return res.status(404).json({ error: "Pharmacy not found" });
  if (fulfillment === "delivery" && !pharmacy.delivery_available)
    return res.status(400).json({ error: "This pharmacy doesn't deliver" });

  const orderId = crypto.randomUUID();
  const now = Date.now();
  const prescriptionPath = req.file
    ? path.relative(uploadsDir, req.file.path).replace(/\\/g, "/")
    : null;

  db.prepare(
    `INSERT INTO orders (
       id, client_id, pharmacy_id, status, fulfillment,
       prescription_path, notes, delivery_address, created_at, updated_at
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    orderId,
    req.session.userId,
    pharmacy_id,
    fulfillment,
    prescriptionPath,
    notes || null,
    delivery_address || null,
    now,
    now
  );

  // Kick off AI prescription reading in the background (non-blocking).
  // The order detail pages poll, so the result appears automatically.
  if (prescriptionPath && ai.isConfigured() && ai.mimeFromPath(prescriptionPath)) {
    db.prepare("UPDATE orders SET ai_status = 'pending' WHERE id = ?").run(orderId);
    runExtraction(orderId, req.file.path);
  }

  res.json({ id: orderId });
});

// Background extraction — never throws, always resolves the order's ai_status.
async function runExtraction(orderId, absPath) {
  try {
    const result = await ai.extractPrescription(absPath);
    db.prepare("UPDATE orders SET ai_status = 'done', ai_extraction = ? WHERE id = ?")
      .run(JSON.stringify(result), orderId);
  } catch (err) {
    const status = err.message === "no-key" || err.message === "bad-type" ? "none" : "failed";
    db.prepare("UPDATE orders SET ai_status = ? WHERE id = ?").run(status, orderId);
    if (status === "failed") console.error("[ai] extraction failed:", err.message);
  }
}

// ============================================================
// POST /api/orders/:id/extract — manually (re)run AI on the prescription
// ============================================================
router.post("/:id/extract", requireAuth, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Not found" });

  // Only the client who owns it or the pharmacy owner may trigger it
  const pharmacy = db.prepare("SELECT owner_id FROM pharmacies WHERE id = ?").get(order.pharmacy_id);
  const involved = order.client_id === req.session.userId || pharmacy?.owner_id === req.session.userId;
  if (!involved) return res.status(403).json({ error: "Not your order" });

  if (!order.prescription_path) return res.status(400).json({ error: "No prescription on this order" });
  if (!ai.isConfigured()) return res.status(400).json({ error: "AI is not configured on the server" });
  if (!ai.mimeFromPath(order.prescription_path)) return res.status(400).json({ error: "Unsupported file type" });
  if (order.ai_status === "pending") return res.json({ ok: true }); // already running

  db.prepare("UPDATE orders SET ai_status = 'pending', ai_extraction = NULL WHERE id = ?").run(order.id);
  const absPath = path.join(uploadsDir, order.prescription_path);
  runExtraction(order.id, absPath);
  res.json({ ok: true });
});

// ============================================================
// GET /api/orders — list orders for the current user (client OR pharmacy owner)
// ============================================================
router.get("/", requireAuth, (req, res) => {
  let rows;
  if (req.session.role === "client") {
    rows = db
      .prepare(
        `SELECT o.*, p.name_en AS pharmacy_name_en, p.name_ar AS pharmacy_name_ar, p.area AS pharmacy_area,
                (SELECT COUNT(*) FROM messages m
                 WHERE m.order_id = o.id
                   AND m.sender_id != o.client_id
                   AND m.created_at > o.client_last_read_at) AS unread_count
         FROM orders o
         JOIN pharmacies p ON p.id = o.pharmacy_id
         WHERE o.client_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(req.session.userId);
  } else {
    rows = db
      .prepare(
        `SELECT o.*, u.full_name AS client_name, u.phone AS client_phone,
                (SELECT COUNT(*) FROM messages m
                 WHERE m.order_id = o.id
                   AND m.sender_id = o.client_id
                   AND m.created_at > o.pharmacy_last_read_at) AS unread_count
         FROM orders o
         JOIN pharmacies p ON p.id = o.pharmacy_id
         JOIN users u ON u.id = o.client_id
         WHERE p.owner_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(req.session.userId);
  }
  res.json(rows);
});

// ============================================================
// GET /api/orders/:id — detail (only if involved)
// ============================================================
router.get("/:id", requireAuth, (req, res) => {
  const order = db
    .prepare(
      `SELECT o.*,
              p.name_en AS pharmacy_name_en, p.name_ar AS pharmacy_name_ar,
              p.area AS pharmacy_area, p.address AS pharmacy_address,
              p.phone AS pharmacy_phone, p.owner_id AS pharmacy_owner_id,
              u.full_name AS client_name, u.phone AS client_phone
       FROM orders o
       JOIN pharmacies p ON p.id = o.pharmacy_id
       JOIN users u ON u.id = o.client_id
       WHERE o.id = ?`
    )
    .get(req.params.id);
  if (!order) return res.status(404).json({ error: "Not found" });

  const isInvolved =
    order.client_id === req.session.userId ||
    order.pharmacy_owner_id === req.session.userId;
  if (!isInvolved) return res.status(403).json({ error: "Not your order" });

  // unread_count from this user's perspective
  const isClient = order.client_id === req.session.userId;
  const cutoff = isClient ? order.client_last_read_at : order.pharmacy_last_read_at;
  const senderFilter = isClient ? "!=" : "=";
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE order_id = ? AND sender_id ${senderFilter} ? AND created_at > ?`
    )
    .get(order.id, order.client_id, cutoff || 0);
  order.unread_count = unread.n;

  res.json(order);
});

// ============================================================
// PATCH /api/orders/:id — update status (with role-aware rules)
// ============================================================
router.patch("/:id", requireAuth, (req, res) => {
  const order = db
    .prepare(
      `SELECT o.*, p.owner_id AS pharmacy_owner_id, p.delivery_fee_jod
       FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id
       WHERE o.id = ?`
    )
    .get(req.params.id);
  if (!order) return res.status(404).json({ error: "Not found" });

  const isClient = order.client_id === req.session.userId;
  const isPharmacy = order.pharmacy_owner_id === req.session.userId;
  if (!isClient && !isPharmacy)
    return res.status(403).json({ error: "Not your order" });

  const { status, total_jod } = req.body;

  // Permissions table
  const allowedTransitions = {
    pharmacy: {
      pending: ["quoted", "rejected"],
      confirmed: ["preparing"],
      preparing: ["ready_for_pickup", "out_for_delivery"],
      ready_for_pickup: ["completed"],
      out_for_delivery: ["completed"],
    },
    client: {
      quoted: ["confirmed", "cancelled"],
    },
  };

  const role = isPharmacy ? "pharmacy" : "client";
  const allowed = allowedTransitions[role][order.status] || [];
  if (!allowed.includes(status))
    return res.status(400).json({
      error: `Cannot transition from ${order.status} to ${status} as ${role}`,
    });

  // Quoting: pharmacy supplies total_jod
  let finalTotal = order.total_jod;
  let finalDeliveryFee = order.delivery_fee_jod;
  if (status === "quoted") {
    if (typeof total_jod !== "number" || total_jod <= 0)
      return res.status(400).json({ error: "Quote total must be > 0" });
    finalTotal = total_jod;
    finalDeliveryFee = order.fulfillment === "delivery" ? order.delivery_fee_jod : 0;
  }

  db.prepare(
    "UPDATE orders SET status = ?, total_jod = ?, delivery_fee_jod = ?, updated_at = ? WHERE id = ?"
  ).run(status, finalTotal, finalDeliveryFee, Date.now(), order.id);

  // Bump pharmacy total_orders on completion
  if (status === "completed") {
    db.prepare(
      "UPDATE pharmacies SET total_orders = total_orders + 1 WHERE id = ?"
    ).run(order.pharmacy_id);
  }

  res.json({ ok: true });
});

module.exports = router;
