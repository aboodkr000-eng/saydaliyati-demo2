const express = require("express");
const { db, distanceKm } = require("../db");
const { requireAuth, requireRole } = require("./auth");

const router = express.Router();

// ============================================================
// GET /api/pharmacies?lat=&lng=&q=
// Returns all pharmacies with distance (if lat/lng provided), filtered by query.
// ============================================================
router.get("/", (req, res) => {
  const { lat, lng, q } = req.query;
  let pharmacies = db
    .prepare(
      `SELECT id, name_en, name_ar, area, address, phone,
              latitude, longitude, opens_at, closes_at, is_24_hours,
              delivery_available, delivery_fee_jod, delivery_radius_km,
              rating, total_orders, is_verified
       FROM pharmacies`
    )
    .all();

  if (lat && lng) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    pharmacies = pharmacies
      .map((p) => ({
        ...p,
        distance_km:
          p.latitude != null && p.longitude != null
            ? +distanceKm(userLat, userLng, p.latitude, p.longitude).toFixed(2)
            : null,
      }))
      .sort((a, b) => {
        if (a.distance_km == null) return 1;
        if (b.distance_km == null) return -1;
        return a.distance_km - b.distance_km;
      });
  }

  if (q) {
    const needle = q.toLowerCase();
    pharmacies = pharmacies.filter(
      (p) =>
        p.name_en.toLowerCase().includes(needle) ||
        p.name_ar.includes(q) ||
        (p.area && p.area.toLowerCase().includes(needle))
    );
  }

  res.json(pharmacies);
});

// ============================================================
// GET /api/pharmacies/:id
// ============================================================
router.get("/:id", (req, res) => {
  const pharmacy = db
    .prepare("SELECT * FROM pharmacies WHERE id = ?")
    .get(req.params.id);
  if (!pharmacy) return res.status(404).json({ error: "Pharmacy not found" });
  res.json(pharmacy);
});

// ============================================================
// GET /api/pharmacies/mine — pharmacy owner only
// Returns the FIRST pharmacy this owner has (for the demo seed flow,
// one user can own multiple — we just pick the earliest-created).
// ============================================================
router.get("/owner/mine", requireAuth, requireRole("pharmacy"), (req, res) => {
  const pharmacy = db
    .prepare(
      "SELECT * FROM pharmacies WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1"
    )
    .get(req.session.userId);
  if (!pharmacy)
    return res.status(404).json({ error: "No pharmacy linked to this account" });
  res.json(pharmacy);
});

// ============================================================
// PATCH /api/pharmacies/:id — owner only
// ============================================================
router.patch("/:id", requireAuth, requireRole("pharmacy"), (req, res) => {
  const pharmacy = db
    .prepare("SELECT owner_id FROM pharmacies WHERE id = ?")
    .get(req.params.id);
  if (!pharmacy) return res.status(404).json({ error: "Not found" });
  if (pharmacy.owner_id !== req.session.userId)
    return res.status(403).json({ error: "Not your pharmacy" });

  const allowed = [
    "name_en", "name_ar", "area", "address", "phone",
    "latitude", "longitude", "opens_at", "closes_at",
    "is_24_hours", "delivery_available", "delivery_fee_jod", "delivery_radius_km",
  ];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (key in req.body) {
      sets.push(`${key} = ?`);
      values.push(req.body[key]);
    }
  }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id);
  db.prepare(`UPDATE pharmacies SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// ============================================================
// GET /api/pharmacies/owner/stats — dashboard stats
// ============================================================
router.get("/owner/stats", requireAuth, requireRole("pharmacy"), (req, res) => {
  const stats = db
    .prepare(
      `SELECT
        COUNT(CASE WHEN status IN ('pending','quoted') THEN 1 END) AS pending_count,
        COUNT(CASE WHEN status IN ('confirmed','preparing','ready_for_pickup','out_for_delivery') THEN 1 END) AS active_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_jod END), 0) AS total_revenue_jod
       FROM orders o
       JOIN pharmacies p ON p.id = o.pharmacy_id
       WHERE p.owner_id = ?`
    )
    .get(req.session.userId);
  res.json(stats);
});

module.exports = router;
