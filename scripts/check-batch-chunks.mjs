// Exercises the batched chunk path the way src/lib/case-files.ts now does:
//   - splits a 5 MB payload into 700 KB chunks
//   - writes them with size-capped Firestore :commit batches
//   - reads them all back with one :batchGet request
//   - verifies the bytes round-trip (sha256), then deletes via :commit
//
// Run from project root: node scripts/check-batch-chunks.mjs

import { createHash, randomBytes } from "crypto";

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const NAME_PREFIX = `projects/${PROJECT_ID}/databases/(default)/documents/`;
const CHUNK_CHARS = 700_000;
const MAX_COMMIT_CHARS = 3_500_000;

async function commit(writes) {
  const r = await fetch(`${DOCS}:commit?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!r.ok) throw new Error(`:commit → ${r.status} ${await r.text()}`);
}

async function batchGet(names) {
  const r = await fetch(`${DOCS}:batchGet?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents: names }),
  });
  if (!r.ok) throw new Error(`:batchGet → ${r.status} ${await r.text()}`);
  return r.json();
}

const original = randomBytes(5 * 1024 * 1024); // 5 MB
const base64 = original.toString("base64");
const originalHash = createHash("sha256").update(original).digest("hex");
console.log(`Payload: ${original.byteLength} bytes raw, ${base64.length} chars base64`);

const fileId = `batch-check-${Date.now()}`;
const col = `pcp_cases/_probe/documents/${fileId}/chunks`;

const chunks = [];
for (let i = 0; i < base64.length; i += CHUNK_CHARS) chunks.push(base64.slice(i, i + CHUNK_CHARS));
console.log(`Split into ${chunks.length} chunk(s)`);

// --- write via size-capped :commit batches ---
let batch = [];
let batchChars = 0;
let commitCount = 0;
for (let i = 0; i < chunks.length; i++) {
  const data = chunks[i];
  if (batch.length && batchChars + data.length > MAX_COMMIT_CHARS) {
    await commit(batch);
    commitCount++;
    batch = [];
    batchChars = 0;
  }
  batch.push({
    update: {
      name: `${NAME_PREFIX}${col}/${i}`,
      fields: { data: { stringValue: data } },
    },
  });
  batchChars += data.length;
}
if (batch.length) {
  await commit(batch);
  commitCount++;
}
console.log(`→ Wrote chunks in ${commitCount} :commit request(s)`);

// --- read back via one :batchGet ---
const names = chunks.map((_, i) => `${NAME_PREFIX}${col}/${i}`);
const resp = await batchGet(names);
const byPath = new Map();
for (const entry of resp) {
  if (!entry.found) continue;
  byPath.set(entry.found.name, entry.found.fields?.data?.stringValue ?? "");
}
let rebuiltBase64 = "";
for (let i = 0; i < chunks.length; i++) rebuiltBase64 += byPath.get(`${NAME_PREFIX}${col}/${i}`) ?? "";
const rebuilt = Buffer.from(rebuiltBase64, "base64");
const rebuiltHash = createHash("sha256").update(rebuilt).digest("hex");
console.log(`→ Read back via 1 :batchGet request`);

// --- cleanup via :commit deletes ---
await commit(chunks.map((_, i) => ({ delete: `${NAME_PREFIX}${col}/${i}` })));
console.log("→ Cleaned up");

if (rebuiltHash === originalHash && rebuilt.byteLength === original.byteLength) {
  console.log(
    `\nSUCCESS — 5 MB round-tripped intact (${chunks.length} chunks, ` +
      `${commitCount} commit req, 1 batchGet req; sha256 matches).`
  );
} else {
  console.error(
    `\n✗ MISMATCH — original ${originalHash} (${original.byteLength}B) ` +
      `vs rebuilt ${rebuiltHash} (${rebuilt.byteLength}B)`
  );
  process.exit(1);
}
