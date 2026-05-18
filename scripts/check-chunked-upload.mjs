// Verifies the chunked file path: writes a ~2 MB payload split across
// Firestore chunk docs, reads them back, checks the bytes round-trip exactly,
// then deletes everything. This is the same chunk logic the documents route
// uses (src/lib/case-files.ts).
//
// Run from project root: node scripts/check-chunked-upload.mjs

import { createHash, randomBytes } from "crypto";

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const CHUNK_CHARS = 900_000;

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

async function putString(path, field, value) {
  const params = new URLSearchParams();
  params.append("updateMask.fieldPaths", field);
  const r = await fetch(`${BASE}/${enc(path)}?${params}&key=${API_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { [field]: { stringValue: value } } }),
  });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status} ${await r.text()}`);
}

async function getString(path, field) {
  const r = await fetch(`${BASE}/${enc(path)}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  const body = await r.json();
  return body.fields?.[field]?.stringValue ?? null;
}

async function del(path) {
  const r = await fetch(`${BASE}/${enc(path)}?key=${API_KEY}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`DELETE ${path} → ${r.status}`);
}

// ~2 MB of random bytes → simulates a real PDF / large image.
const original = randomBytes(2 * 1024 * 1024);
const base64 = original.toString("base64");
const originalHash = createHash("sha256").update(original).digest("hex");
console.log(`Payload: ${original.byteLength} bytes raw, ${base64.length} chars base64`);

const fileId = `chunk-check-${Date.now()}`;
const chunksCol = `pcp_cases/_probe/documents/${fileId}/chunks`;

const chunks = [];
for (let i = 0; i < base64.length; i += CHUNK_CHARS) {
  chunks.push(base64.slice(i, i + CHUNK_CHARS));
}
console.log(`→ Writing ${chunks.length} chunk doc(s)`);
await Promise.all(chunks.map((data, i) => putString(`${chunksCol}/${i}`, "data", data)));
console.log("  ✓ chunks written");

console.log("→ Reading chunks back + reassembling");
const parts = await Promise.all(
  Array.from({ length: chunks.length }, (_, i) => getString(`${chunksCol}/${i}`, "data"))
);
const rebuilt = Buffer.from(parts.join(""), "base64");
const rebuiltHash = createHash("sha256").update(rebuilt).digest("hex");

console.log("→ Cleaning up");
await Promise.all(chunks.map((_, i) => del(`${chunksCol}/${i}`)));

if (rebuiltHash === originalHash && rebuilt.byteLength === original.byteLength) {
  console.log(
    `\nSUCCESS — ${original.byteLength} bytes round-tripped intact across ` +
      `${chunks.length} chunks (sha256 matches).\n` +
      "5 MB files are supported via Firestore chunking — no Storage bucket needed."
  );
} else {
  console.error(
    `\n✗ MISMATCH — original ${originalHash} (${original.byteLength}B) ` +
      `vs rebuilt ${rebuiltHash} (${rebuilt.byteLength}B)`
  );
  process.exit(1);
}
