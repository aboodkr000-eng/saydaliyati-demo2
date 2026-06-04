PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client', 'pharmacy', 'admin')),
  full_name TEXT,
  phone TEXT,
  latitude REAL,
  longitude REAL,
  address TEXT,
  created_at INTEGER NOT NULL
);

-- ============================================================
-- PHARMACIES
-- ============================================================
CREATE TABLE IF NOT EXISTS pharmacies (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  license_number TEXT NOT NULL UNIQUE,
  area TEXT,
  address TEXT,
  phone TEXT,
  latitude REAL,
  longitude REAL,
  opens_at TEXT,
  closes_at TEXT,
  is_24_hours INTEGER DEFAULT 0,
  delivery_available INTEGER DEFAULT 1,
  delivery_fee_jod REAL DEFAULT 1.0,
  delivery_radius_km REAL DEFAULT 5.0,
  rating REAL DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pharmacies_owner ON pharmacies(owner_id);

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending','quoted','confirmed','preparing',
    'ready_for_pickup','out_for_delivery','completed','cancelled','rejected'
  )),
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('pickup','delivery')),
  prescription_path TEXT,
  notes TEXT,
  delivery_address TEXT,
  total_jod REAL,
  delivery_fee_jod REAL,
  client_last_read_at INTEGER NOT NULL DEFAULT 0,
  pharmacy_last_read_at INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'none',
  ai_extraction TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_pharmacy ON orders(pharmacy_id, created_at DESC);

-- ============================================================
-- MESSAGES (chat)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, created_at);

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at INTEGER NOT NULL
);
