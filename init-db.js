const fs = require("node:fs");
const path = require("node:path");
const { db } = require("./db");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

// Force a clean slate so schema changes always apply.
// (CREATE TABLE IF NOT EXISTS won't update an existing table's CHECK constraints.)
console.log("• Resetting schema (drops & recreates all tables)…");
db.exec(`
  PRAGMA foreign_keys = OFF;
  DROP TABLE IF EXISTS reviews;
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS pharmacies;
  DROP TABLE IF EXISTS users;
  PRAGMA foreign_keys = ON;
`);
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

const now = Date.now();

// Demo admin account (login: admin@demo.jo / admin123)
const adminEmail = "admin@demo.jo";
const adminPassword = "admin123";
let admin = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
if (!admin) {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, full_name, phone, created_at)
     VALUES (?, ?, ?, 'admin', ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    adminEmail,
    bcrypt.hashSync(adminPassword, 10),
    "Saydaliyati Admin",
    "790000000",
    now
  );
  console.log(`✓ Created admin account: ${adminEmail} / ${adminPassword}`);
} else {
  console.log(`• Admin account already exists: ${adminEmail}`);
}

// Demo pharmacy account (login: pharmacy@demo.jo / pharmacy123)
const ownerEmail = "pharmacy@demo.jo";
const ownerPassword = "pharmacy123";

let owner = db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail);
if (!owner) {
  const ownerId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, full_name, phone, created_at)
     VALUES (?, ?, ?, 'pharmacy', ?, ?, ?)`
  ).run(
    ownerId,
    ownerEmail,
    bcrypt.hashSync(ownerPassword, 10),
    "Demo Pharmacy Owner",
    "770000000",
    now
  );
  owner = { id: ownerId };
  console.log(`✓ Created demo pharmacy account: ${ownerEmail} / ${ownerPassword}`);
} else {
  console.log(`• Demo pharmacy account already exists: ${ownerEmail}`);
}

// Wipe existing demo pharmacies and reinsert
db.prepare("DELETE FROM pharmacies WHERE license_number LIKE 'JPA-DEMO-%'").run();

const pharmacies = [
  { en: "Al-Hayat Pharmacy", ar: "صيدلية الحياة", area: "Abdoun", address: "Abdoun Circle, Amman", lat: 31.9508, lng: 35.8736, hrs: ["08:00", "23:00"], fee: 1.5, rating: 4.7, total: 132 },
  { en: "Sweifieh Care", ar: "صيدلية الصويفية", area: "Sweifieh", address: "Wakalat Street, Sweifieh", lat: 31.9407, lng: 35.8572, hrs: ["09:00", "00:00"], fee: 2.0, rating: 4.5, total: 89 },
  { en: "Khalda Pharmacy 24/7", ar: "صيدلية خلدا 24/7", area: "Khalda", address: "Medina St, Khalda", lat: 31.9846, lng: 35.8403, hrs: null, fee: 1.75, rating: 4.8, total: 256 },
  { en: "Jabal Amman Apothecary", ar: "صيدلية جبل عمّان", area: "Jabal Amman", address: "Rainbow Street, Jabal Amman", lat: 31.9521, lng: 35.9239, hrs: ["08:30", "22:00"], fee: 2.5, rating: 4.6, total: 73 },
  { en: "Shmeisani Health", ar: "صيدلية الشميساني", area: "Shmeisani", address: "Issam Ajlouni St, Shmeisani", lat: 31.9683, lng: 35.8951, hrs: ["09:00", "23:00"], fee: 1.5, rating: 4.4, total: 41 },
  { en: "Dabouq Family Pharmacy", ar: "صيدلية دابوق", area: "Dabouq", address: "Dabouq Main St", lat: 31.9999, lng: 35.7977, hrs: ["08:00", "22:30"], fee: 0, rating: 4.2, total: 18, noDelivery: true },
  { en: "City Mall Pharmacy", ar: "صيدلية سيتي مول", area: "Tla' al-Ali", address: "City Mall, King Abdullah II St", lat: 31.9791, lng: 35.8228, hrs: ["10:00", "23:00"], fee: 2.0, rating: 4.5, total: 198 },
  { en: "Marj al-Hamam Pharmacy", ar: "صيدلية مرج الحمام", area: "Marj al-Hamam", address: "Airport Road, Marj al-Hamam", lat: 31.9191, lng: 35.8316, hrs: ["08:00", "00:00"], fee: 2.5, rating: 4.6, total: 67 },
  { en: "Mecca Mall Pharmacy", ar: "صيدلية مكة مول", area: "Um Uthaina", address: "Mecca St, Um Uthaina", lat: 31.9758, lng: 35.8489, hrs: ["10:00", "22:00"], fee: 1.75, rating: 4.3, total: 102 },
  { en: "Tla' al-Ali Pharmacy", ar: "صيدلية تلاع العلي", area: "Tla' al-Ali", address: "Wasfi al-Tal St", lat: 31.9897, lng: 35.8517, hrs: ["07:30", "23:30"], fee: 1.5, rating: 4.7, total: 154 },
];

const insert = db.prepare(`
  INSERT INTO pharmacies (
    id, owner_id, name_en, name_ar, license_number, area, address, phone,
    latitude, longitude, opens_at, closes_at, is_24_hours,
    delivery_available, delivery_fee_jod, delivery_radius_km,
    rating, total_orders, is_verified, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

pharmacies.forEach((p, i) => {
  insert.run(
    crypto.randomUUID(),
    owner.id,
    p.en, p.ar,
    `JPA-DEMO-${String(i + 1).padStart(2, "0")}`,
    p.area, p.address,
    `+96279000000${i + 1}`,
    p.lat, p.lng,
    p.hrs ? p.hrs[0] : null,
    p.hrs ? p.hrs[1] : null,
    p.hrs ? 0 : 1,
    p.noDelivery ? 0 : 1,
    p.fee,
    5,
    p.rating, p.total, 1,
    now
  );
});

console.log(`✓ Seeded ${pharmacies.length} demo pharmacies`);
console.log("\nNow run:  npm start");
