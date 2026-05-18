// Probes that GEMINI_API_KEY in .env.local can actually generate text via
// the same generateContent REST endpoint the AI-summary route uses.
//
// Run from project root: node scripts/check-gemini.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const KEY = process.env.GEMINI_API_KEY?.trim();
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
if (!KEY) {
  console.error("GEMINI_API_KEY is not set in .env.local");
  process.exit(1);
}
console.log("Model:", MODEL);

const prompt =
  "Reply with exactly the sentence: Gemini connection OK. Do not add anything else.";

const url =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=` +
  encodeURIComponent(KEY);

const body = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0, maxOutputTokens: 64 },
};

const r = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!r.ok) {
  console.error(`✗ ${r.status}: ${await r.text()}`);
  process.exit(1);
}
const data = await r.json();
const text =
  data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
console.log(`✓ Gemini replied (${text.length} chars):\n  ${text.trim()}`);
console.log("\nSUCCESS — Gemini is reachable with the .env.local key.");
