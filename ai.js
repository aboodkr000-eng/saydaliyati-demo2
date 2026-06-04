// ============================================================
// AI prescription reader (Google Gemini)
//   Reads an uploaded prescription image/PDF and extracts the
//   medications written on it as structured JSON.
//
//   Model is configurable via GEMINI_MODEL (default gemini-2.5-flash).
//   Requires GEMINI_API_KEY in .env. If absent, extraction is skipped.
// ============================================================

const fs = require("node:fs");
const path = require("node:path");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ------------------------------------------------------------
// The prompt. Deliberately strict:
//  - transcribe only what is visible (no hallucinated meds)
//  - no medical advice / diagnosis / dosage correction
//  - per-item confidence so the pharmacist knows what to double-check
//  - bilingual (Arabic + English), handles handwriting
//  - strict JSON output
// ------------------------------------------------------------
const PROMPT = `You are a meticulous pharmacy intake assistant. Your ONLY job is to transcribe the medications written on a prescription image into structured data. You are NOT a doctor and you do NOT give medical advice.

The image is a real prescription from Jordan. It may be:
- handwritten (often messy) or printed
- in Arabic, English, or a mix
- a phone photo that is blurry, rotated, or poorly lit

For EVERY medication line you can find, provide the translatable fields in BOTH English and Arabic so the app can display either language. Return for each medication:
- "name_en" and "name_ar": the drug name EXACTLY as written on the prescription, in its ORIGINAL spelling/script. Put the SAME original text in BOTH fields — do NOT translate or transliterate the drug name, whether it is a brand name (e.g. Famodar, Pregnawell) or a generic (e.g. Calcium, Paracetamol). If it is written in Latin letters keep it Latin in both; if it is written in Arabic keep it Arabic in both. Drug names are how a pharmacist finds the product, so they must never be altered.
- "strength": the strength/dose if written (e.g. "500 mg", "1 g/125 mg"), otherwise null. (Universal — one value, no translation.)
- "form_en" / "form_ar": the form if indicated (tablet/capsule/syrup/cream/drops/ointment/injection…) in English and Arabic, otherwise null for both.
- "quantity_en" / "quantity_ar": how many units/packs if written (e.g. "1 box" / "علبة واحدة"), otherwise null for both.
- "instructions_en" / "instructions_ar": the dosing instructions if written, in English and Arabic, otherwise null for both.
- "confidence": how sure you are that you READ THIS LINE correctly — one of "high", "medium", "low".

DOSING SHORTHAND (important): Jordanian prescriptions often write dosing as a shorthand like "1×1", "2×1", "3×1", "1×2", sometimes with a dash or "*" instead of "×". The common convention is (number of times per day) × (units per dose):
- "1×1" → once daily (one unit)
- "2×1" → twice daily (one unit each time)
- "3×1" → three times daily (one unit each time)
- a second number greater than 1, e.g. "1×2" → one time per day, two units per dose
Interpret this shorthand using that convention, BUT always keep the raw shorthand in the instructions text as well, e.g. instructions_en: "Once daily (1×1)", instructions_ar: "مرة واحدة يومياً (1×1)". If the shorthand is the ONLY dosing information and its meaning is ambiguous or hard to read, keep your best interpretation but set "confidence" to "medium" or lower. Never silently drop the original notation.

ABSOLUTE RULES:
1. Transcribe ONLY what is actually written. NEVER invent, guess, complete, or "correct" a medication that is not clearly on the page. A missing prescription must yield an empty list, not a made-up one. Translation between EN/AR is allowed and expected, but you must not add medications, strengths, or instructions that are not written.
2. If a line is hard to read, transcribe your best reading and set "confidence":"low". Do NOT drop it silently and do NOT fabricate a plausible-sounding drug.
3. Do NOT add any medical advice, diagnosis, warnings, interactions, or dosage suggestions. You only transcribe and translate.
4. If the image is not a prescription, or is too blurry/dark to read anything, set "legible": false and return an empty medications list.

Also return:
- "legible": true if you could read at least one medication, false otherwise
- "notes_en" / "notes_ar": ONE short neutral sentence (in English and Arabic) with any visible doctor/clinic name or date, OR a brief note about image quality if unreadable. No advice. Can be null for both.

Output STRICT JSON only — no markdown, no backticks, no commentary — in exactly this shape:
{
  "legible": true,
  "medications": [
    { "name_en": "string", "name_ar": "string", "strength": "string or null", "form_en": "string or null", "form_ar": "string or null", "quantity_en": "string or null", "quantity_ar": "string or null", "instructions_en": "string or null", "instructions_ar": "string or null", "confidence": "high" }
  ],
  "notes_en": "string or null",
  "notes_ar": "string or null"
}`;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
};

function mimeFromPath(p) {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || null;
}

function isConfigured() {
  const k = process.env.GEMINI_API_KEY;
  return !!k && k !== "YOUR_KEY_HERE";
}

/**
 * Extract medications from a prescription file.
 * @param {string} filePath absolute path to the image/PDF
 * @returns {Promise<object>} parsed extraction result
 * Throws Error('no-key') if not configured, Error('bad-type') for unsupported file.
 */
async function extractPrescription(filePath) {
  if (!isConfigured()) throw new Error("no-key");
  const mimeType = mimeFromPath(filePath);
  if (!mimeType) throw new Error("bad-type");

  const base64 = fs.readFileSync(filePath).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    process.env.GEMINI_API_KEY
  )}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
    },
  };

  // 30s timeout so a hung request doesn't leave the order stuck on "pending"
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const clean = text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  }

  // Normalize shape defensively
  const clip = (v, n) => (v ? String(v).slice(0, n) : null);
  return {
    legible: !!parsed.legible,
    medications: Array.isArray(parsed.medications)
      ? parsed.medications.slice(0, 30).map((m) => ({
          name_en: clip(m.name_en || m.name, 200) || "",
          name_ar: clip(m.name_ar || m.name_en || m.name, 200) || "",
          strength: clip(m.strength, 80),
          form_en: clip(m.form_en || m.form, 60),
          form_ar: clip(m.form_ar || m.form_en || m.form, 60),
          quantity_en: clip(m.quantity_en || m.quantity, 60),
          quantity_ar: clip(m.quantity_ar || m.quantity_en || m.quantity, 60),
          instructions_en: clip(m.instructions_en || m.instructions, 240),
          instructions_ar: clip(m.instructions_ar || m.instructions_en || m.instructions, 240),
          confidence: ["high", "medium", "low"].includes(m.confidence) ? m.confidence : "medium",
        }))
      : [],
    notes_en: clip(parsed.notes_en || parsed.notes, 300),
    notes_ar: clip(parsed.notes_ar || parsed.notes_en || parsed.notes, 300),
  };
}

module.exports = { extractPrescription, mimeFromPath, isConfigured, GEMINI_MODEL };
