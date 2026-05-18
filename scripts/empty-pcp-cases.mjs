// Empties the pcp_cases collection — every case and ALL of its nested data.
//
// Firestore deletes are NOT recursive: deleting a document leaves its
// subcollections orphaned. So for each case this walks the full tree and
// deletes bottom-up:
//
//   pcp_cases/{caseId}
//     ├─ about/data
//     ├─ health/data
//     └─ documents/{fileId}
//          └─ chunks/{i}        ← the actual file bytes (base64) live here
//
// "Related files" = the document metadata docs + their `chunks` subcollections
// (files are stored entirely in Firestore as base64 chunks — there's no
// Firebase Storage object to clean up).
//
// The `pcp_cases/_schema` doc (+ its schema subdocs) and the `pcp_migrations`
// record are preserved. Idempotent — safe to re-run.
//
// Run from project root: node scripts/empty-pcp-cases.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const USERS = "pcp_cases";

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** List every document in a collection path (handles pagination). */
async function listAll(collection) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${encodePath(collection)}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url);
    if (r.status === 404) return out;
    if (!r.ok) throw new Error(`LIST ${collection} -> ${r.status} ${await r.text()}`);
    const body = await r.json();
    for (const d of body.documents ?? []) {
      const parts = d.name.split("/");
      out.push({ id: parts[parts.length - 1] });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/** Delete a single document by full path. Idempotent (404 -> false). */
async function deleteDoc(path) {
  const r = await fetch(`${BASE}/${encodePath(path)}?key=${API_KEY}`, {
    method: "DELETE",
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`DELETE ${path} -> ${r.status} ${await r.text()}`);
  return true;
}

console.log(`Project: ${PROJECT_ID}`);
console.log("Step 1: listing pcp_cases");

const all = await listAll(USERS);
const caseDocs = all.filter((c) => !c.id.startsWith("_"));
const schemaDocs = all.filter((c) => c.id.startsWith("_"));
console.log(
  `  -> ${all.length} total (${caseDocs.length} case, ${schemaDocs.length} schema/internal)`
);

const stats = { cases: 0, about: 0, health: 0, documents: 0, chunks: 0 };

for (const c of caseDocs) {
  const caseId = c.id;

  // --- documents subcollection (+ each document's chunks) ---
  const docs = await listAll(`${USERS}/${caseId}/documents`);
  for (const doc of docs) {
    if (doc.id.startsWith("_")) continue;
    const chunkCol = `${USERS}/${caseId}/documents/${doc.id}/chunks`;
    const chunks = await listAll(chunkCol);
    if (chunks.length) {
      await Promise.all(chunks.map((ch) => deleteDoc(`${chunkCol}/${ch.id}`)));
      stats.chunks += chunks.length;
    }
    await deleteDoc(`${USERS}/${caseId}/documents/${doc.id}`);
    stats.documents++;
  }

  // --- about / health subcollections (one "data" doc each, but list to be safe) ---
  for (const group of ["about", "health"]) {
    const groupDocs = await listAll(`${USERS}/${caseId}/${group}`);
    for (const g of groupDocs) {
      await deleteDoc(`${USERS}/${caseId}/${group}/${g.id}`);
      if (group === "about") stats.about++;
      else stats.health++;
    }
  }

  // --- the root case doc ---
  await deleteDoc(`${USERS}/${caseId}`);
  stats.cases++;
  console.log(`  - cleared case ${caseId}`);
}

console.log("\n=== SUMMARY ===");
console.log(`Cases deleted          : ${stats.cases}`);
console.log(`About docs deleted     : ${stats.about}`);
console.log(`Health docs deleted    : ${stats.health}`);
console.log(`Document files deleted : ${stats.documents}`);
console.log(`File chunks deleted    : ${stats.chunks}`);
console.log(`Schema docs preserved  : ${schemaDocs.length}`);
