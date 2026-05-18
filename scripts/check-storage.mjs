// Verifies that the Firebase Storage bucket accepts uploads/deletes via the
// REST API (same path the documents route uses). Uploads a tiny text file to
// a probe path, fetches it back, then deletes it.
//
// Run from project root: node scripts/check-storage.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!BUCKET) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET in .env.local");
  process.exit(1);
}
console.log("Bucket:", BUCKET);

const probePath = `pcp_cases/_probe/storage-check-${Date.now()}.txt`;
const encoded = encodeURIComponent(probePath);
const body = Buffer.from("storage check ok\n", "utf8");

console.log("→ Uploading probe:", probePath);
const up = await fetch(
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}`,
  { method: "POST", headers: { "Content-Type": "text/plain" }, body }
);
if (!up.ok) {
  console.error(`✗ Upload failed (${up.status}): ${await up.text()}`);
  console.error(
    "  If this is PERMISSION_DENIED, open Firebase Console → Storage → Rules\n" +
      "  and allow read/write to pcp_cases/** (test mode is fine for the demo)."
  );
  process.exit(1);
}
const meta = await up.json();
const token = (meta.downloadTokens || "").split(",")[0];
console.log("  ✓ uploaded — downloadToken:", token || "(none)");

const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}?alt=media${
  token ? `&token=${token}` : ""
}`;
console.log("→ Fetching back via download URL");
const dl = await fetch(downloadUrl);
if (!dl.ok) {
  console.error(`✗ Download failed (${dl.status}): ${await dl.text()}`);
  process.exit(1);
}
console.log("  ✓ content:", JSON.stringify(await dl.text()));

console.log("→ Deleting probe");
const del = await fetch(
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}`,
  { method: "DELETE" }
);
if (!del.ok && del.status !== 404) {
  console.error(`✗ Delete failed (${del.status}): ${await del.text()}`);
  process.exit(1);
}
console.log("  ✓ deleted");

console.log("\nSUCCESS — Storage REST upload/download/delete all work.");
