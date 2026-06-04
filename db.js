const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const DB_PATH = path.join(__dirname, "data", "saydaliyati.db");

// Ensure data dir exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// Run schema (creates tables with CREATE IF NOT EXISTS — does NOT modify existing tables)
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// ============================================================
// AUTO-MIGRATIONS — additive only (new columns).
//   `CREATE TABLE IF NOT EXISTS` won't add columns to an existing table,
//   so every time we ship a new column we list it here. Each call is a no-op
//   if the column already exists, so it's safe to run on every boot.
//   For destructive changes (CHECK constraints, drops), run `npm run init`.
// ============================================================
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.length === 0) return; // table doesn't exist yet — schema.sql will create it
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`  + migrated: ${table}.${column}`);
  }
}

ensureColumn("users", "latitude", "REAL");
ensureColumn("users", "longitude", "REAL");
ensureColumn("users", "address", "TEXT");
ensureColumn("orders", "client_last_read_at", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("orders", "pharmacy_last_read_at", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("orders", "ai_status", "TEXT NOT NULL DEFAULT 'none'");
ensureColumn("orders", "ai_extraction", "TEXT");

// ============================================================
// Distance helper (Haversine, km)
// ============================================================
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { db, distanceKm };
