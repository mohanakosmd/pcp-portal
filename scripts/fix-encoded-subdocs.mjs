// One-off data repair: previous versions of src/lib/firestore-rest.ts used
// `encodeURIComponent(collection)` which turned slashes in subcollection
// paths into `%2F`. The result is that writes meant for
//   pcp_cases/{caseId}/about/data
// actually landed at the literal-named collection
//   pcp_cases%2F{caseId}%2Fabout/data
// (i.e. one top-level collection per case+group, with `%2F` in its name).
//
// This script:
//   1. Walks each case in pcp_cases.
//   2. For each (about, health) subgroup, probes the orphan path.
//   3. If found, writes the same data to the correct subcollection path and
//      deletes the orphan.
//
// Idempotent. Run from project root:
//   node scripts/fix-encoded-subdocs.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function listCol(col) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${col}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`LIST ${col} → ${r.status} ${await r.text()}`);
    const body = await r.json();
    for (const d of body.documents ?? []) {
      const parts = d.name.split("/");
      out.push({ id: parts[parts.length - 1], raw: d });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

async function getRaw(path) {
  // path is already URL-shaped (no extra encoding!).
  const r = await fetch(`${BASE}/${path}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function writeFields(collection, id, fields) {
  // collection/id are encoded segment-by-segment (slashes preserved).
  const colPath = collection.split("/").map(encodeURIComponent).join("/");
  const idPath = encodeURIComponent(id);
  const params = new URLSearchParams();
  for (const k of Object.keys(fields)) params.append("updateMask.fieldPaths", k);
  const r = await fetch(
    `${BASE}/${colPath}/${idPath}?${params.toString()}&key=${API_KEY}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    }
  );
  if (!r.ok) throw new Error(`PATCH ${collection}/${id} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function deleteRaw(path) {
  const r = await fetch(`${BASE}/${path}?key=${API_KEY}`, { method: "DELETE" });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status} ${await r.text()}`);
  return true;
}

const SUBGROUPS = ["about", "health"];

const cases = (await listCol("pcp_cases")).filter((c) => !c.id.startsWith("_"));
console.log(`Found ${cases.length} case(s) to inspect`);

let moved = 0;
let deleted = 0;
let alreadyOk = 0;

for (const c of cases) {
  for (const group of SUBGROUPS) {
    const orphanPath = `pcp_cases%2F${c.id}%2F${group}/data`;
    const correctCollection = `pcp_cases/${c.id}/${group}`;
    const correctPath = `pcp_cases/${c.id}/${group}/data`;

    const correctDoc = await getRaw(correctPath);
    if (correctDoc) {
      alreadyOk++;
      continue;
    }

    const orphan = await getRaw(orphanPath);
    if (!orphan) continue;

    console.log(`  → moving ${c.id}/${group}: ${orphanPath} → ${correctPath}`);
    await writeFields(correctCollection, "data", orphan.fields ?? {});
    moved++;

    await deleteRaw(orphanPath);
    deleted++;
  }
}

console.log("\n=== SUMMARY ===");
console.log(`Moved   : ${moved}`);
console.log(`Deleted : ${deleted} orphan(s)`);
console.log(`Already OK : ${alreadyOk}`);
