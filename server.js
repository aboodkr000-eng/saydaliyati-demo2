require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: "lax",
    },
  })
);

// ============================================================
// /config.js — dynamically injects env vars into the browser
// (must be registered BEFORE the static middleware below)
// ============================================================
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.set("Cache-Control", "no-store");
  res.send(
    `window.SAYDALIYATI_CONFIG = ${JSON.stringify({
      GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || "",
      AI_ENABLED: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "YOUR_KEY_HERE",
    })};`
  );
});

// Static frontend
app.use(express.static(path.join(__dirname, "public")));

// Serve prescription uploads — only to authenticated owners/recipients
app.use("/uploads", require("./routes/uploads"));

// ============================================================
// API ROUTES
// ============================================================
app.use("/api/auth", require("./routes/auth"));
app.use("/api/pharmacies", require("./routes/pharmacies"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/admin", require("./routes/admin"));

// ============================================================
// FALLBACK — clean URLs (e.g. /sign-in → /sign-in.html)
// ============================================================
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.includes(".")) return next(); // already has extension
  const tryPath = path.join(__dirname, "public", req.path + ".html");
  if (fs.existsSync(tryPath)) return res.sendFile(tryPath);
  next();
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res
    .status(err.status || 500)
    .json({ error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`\n  ▲ Saydaliyati running at http://localhost:${PORT}\n`);
});
