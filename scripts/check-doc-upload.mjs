// Verifies the Firestore-backed document upload path: base64-encodes a small
// image and writes it to a probe documents subdoc, exactly like the
// /api/cases/[caseId]/documents route now does. Then reads it back and deletes.
//
// Run from project root: node scripts/check-doc-upload.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// A 1x1 transparent PNG (smallest valid image), base64-encoded.
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const contentType = "image/png";
const dataUri = `data:${contentType};base64,${pngBase64}`;
const sizeBytes = Buffer.from(pngBase64, "base64").byteLength;

const path = `pcp_cases/_probe/documents/doc-check-${Date.now()}`;
const encodedPath = path.split("/").map(encodeURIComponent).join("/");

const fields = {
  fileName: { stringValue: "probe.png" },
  contentType: { stringValue: contentType },
  sizeBytes: { integerValue: String(sizeBytes) },
  storageBackend: { stringValue: "firestore" },
  downloadUrl: { stringValue: dataUri },
  kind: { stringValue: "other" },
  uploadedAt: { timestampValue: new Date().toISOString() },
};

console.log("→ Writing probe document doc with embedded base64 image");
const params = new URLSearchParams();
for (const k of Object.keys(fields)) params.append("updateMask.fieldPaths", k);
const put = await fetch(`${BASE}/${encodedPath}?${params.toString()}&key=${API_KEY}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fields }),
});
if (!put.ok) {
  console.error(`  ✗ write failed (${put.status}): ${await put.text()}`);
  process.exit(1);
}
console.log("  ✓ written");

console.log("→ Reading it back");
const get = await fetch(`${BASE}/${encodedPath}?key=${API_KEY}`);
if (!get.ok) {
  console.error(`  ✗ read failed (${get.status}): ${await get.text()}`);
  process.exit(1);
}
const body = await get.json();
const got = body.fields?.downloadUrl?.stringValue ?? "";
console.log(`  ✓ downloadUrl round-tripped (${got.length} chars, starts "${got.slice(0, 24)}…")`);

console.log("→ Deleting probe");
const del = await fetch(`${BASE}/${encodedPath}?key=${API_KEY}`, { method: "DELETE" });
if (!del.ok && del.status !== 404) {
  console.error(`  ✗ delete failed (${del.status}): ${await del.text()}`);
  process.exit(1);
}
console.log("  ✓ deleted");

console.log(
  "\nSUCCESS — images can be uploaded to Firestore (as base64 data-URIs)\n" +
    "with the credentials already in .env.local. No Storage bucket needed."
);
