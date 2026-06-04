const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { db } = require("../db");

const router = express.Router();
const uploadsDir = path.join(__dirname, "..", "uploads");

// Path is /uploads/<userId>/<filename>
router.get("/:userId/:filename", (req, res) => {
  if (!req.session.userId) return res.status(401).end();

  const { userId, filename } = req.params;
  // Path traversal guard
  if (filename.includes("/") || filename.includes("..")) return res.status(400).end();

  // Authorization: must be the uploader OR a pharmacy owner whose pharmacy
  // received an order with this prescription path.
  const relPath = `${userId}/${filename}`;
  const isUploader = userId === req.session.userId;

  let allowed = isUploader;
  if (!allowed) {
    const order = db
      .prepare(
        `SELECT 1 FROM orders o
         JOIN pharmacies p ON p.id = o.pharmacy_id
         WHERE o.prescription_path = ? AND p.owner_id = ?`
      )
      .get(relPath, req.session.userId);
    allowed = !!order;
  }
  if (!allowed) return res.status(403).end();

  const fullPath = path.join(uploadsDir, userId, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).end();
  res.sendFile(fullPath);
});

module.exports = router;
