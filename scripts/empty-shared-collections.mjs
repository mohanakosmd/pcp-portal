// Empties a fixed set of SHARED collections — data only.
//
//   admin_logs        followup_requests   medical_reports     pcp_pharmacy
//   audit_logs        gi_admin_logs       pcp_notifications   users
//   chatbot           gi_notifications    insurance_data      medical_content
//
// None of these are read or written by this repo; they belong to the GI/admin
// portal that shares the same Firebase project. There are no migrations here
// that can reseed them — once deleted, the data is gone. Confirm with whoever
// owns that portal before running with --confirm.
//
// AUDIT TRAILS: `audit_logs`, `admin_logs` and `gi_admin_logs` look like access
// /activity logs. This project id is `aigicare-hipaa`; if these back a HIPAA
// audit trail, deleting them may breach the retention requirement in
// 45 CFR §164.316(b)(2) (records kept 6 years). Nothing here checks that — get
// sign-off, or exclude them with --only=... on a production project.
//
// PRESERVED:
//   - any document whose id starts with "_" (e.g. `_schema`, `_meta`), at every
//     level. NOTE: at the time of writing none of these six collections has one,
//     so a full purge empties each collection completely and it will disappear
//     from the Firestore console (collections are implicit — they exist only
//     while they hold documents). No schema/rules/indexes are affected.
//   - `pcp_migrations` and every collection not listed above.
//
// SUBCOLLECTIONS: discovered per document at runtime via the Firestore
// `:listCollectionIds` endpoint and purged bottom-up, so nothing is orphaned
// even if these collections grow a nested shape later. That costs one extra
// request per document; --flat skips discovery when you know the data is flat.
//
// SAFETY: dry run by default — it only PRINTS what it would delete. Pass
// --confirm to actually delete. It targets whatever Firebase project
// .env.local points at, so use --expect-project to pin that down.
//
// Run from project root:
//   node scripts/empty-shared-collections.mjs                           # dry run, all 12
//   node scripts/empty-shared-collections.mjs --confirm                 # delete all 12
//   node scripts/empty-shared-collections.mjs --only=chatbot,users      # subset (keep the logs)
//   node scripts/empty-shared-collections.mjs --only=users,pcp_pharmacy # subset
//   node scripts/empty-shared-collections.mjs --flat --confirm          # skip subcollection discovery
//   node scripts/empty-shared-collections.mjs --expect-project=my-dev-proj --confirm
//
// Idempotent — safe to re-run.

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const COLLECTIONS = [
  "admin_logs",
  "audit_logs",
  "chatbot",
  "followup_requests",
  "gi_admin_logs",
  "gi_notifications",
  "insurance_data",
  "medical_content",
  "medical_reports",
  "pcp_notifications",
  "pcp_pharmacy",
  "users",
];

// --- args ------------------------------------------------------------------

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const DRY = !CONFIRM;
const FLAT = args.includes("--flat");

const expectArg = args.find((a) => a.startsWith("--expect-project="));
if (expectArg) {
  const expected = expectArg.slice("--expect-project=".length).trim();
  if (expected !== PROJECT_ID) {
    console.error(
      `Project mismatch — .env.local points at "${PROJECT_ID}" but ` +
        `--expect-project=${expected} was given. Aborting.`
    );
    process.exit(1);
  }
}

const onlyArg = args.find((a) => a.startsWith("--only="));
const selected = onlyArg
  ? onlyArg
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : COLLECTIONS;

const unknown = selected.filter((c) => !COLLECTIONS.includes(c));
if (unknown.length) {
  console.error(
    `Refusing to touch collection(s) this script doesn't own: ${unknown.join(", ")}\n` +
      `Valid values: ${COLLECTIONS.join(", ")}`
  );
  process.exit(1);
}

// --- Firestore REST helpers ------------------------------------------------

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** True for schema/internal docs we must never delete. */
const isInternal = (id) => id.startsWith("_");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Global cap on in-flight HTTP requests. The purge recurses into subcollections,
// so a per-level limit would multiply; this gate bounds the whole run.
const MAX_IN_FLIGHT = 12;
let inFlight = 0;
const waiting = [];

async function acquire() {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((r) => waiting.push(r));
  inFlight++;
}

function release() {
  inFlight--;
  waiting.shift()?.();
}

/**
 * fetch with retries. Firestore drops connections ("terminated") and returns
 * 429/503 under sustained load, and a half-finished purge is worse than a slow
 * one — so transient failures back off and retry rather than aborting the run.
 */
async function request(url, init, attempts = 5) {
  await acquire();
  try {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(url, init);
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`HTTP ${r.status}`);
        } else {
          return r;
        }
      } catch (err) {
        lastErr = err; // network-level failure (socket terminated, reset, …)
      }
      await sleep(400 * 2 ** i);
    }
    throw lastErr;
  } finally {
    release();
  }
}

/**
 * List every document id in a collection path (handles pagination).
 *
 * `mask.fieldPaths` is set to a field that doesn't exist, so Firestore returns
 * each document's name with NO field data. That matters here: `medical_reports`
 * and friends can hold large payloads, and listing them unmasked pulls
 * megabytes per page and kills the connection.
 */
async function listAll(collectionPath) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${encodePath(collectionPath)}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "300");
    url.searchParams.set("mask.fieldPaths", "idOnlyNoSuchField");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await request(url);
    if (r.status === 404) return out; // collection doesn't exist — nothing to do
    if (!r.ok) {
      throw new Error(`LIST ${collectionPath} → ${r.status} ${await r.text()}`);
    }
    const body = await r.json();
    for (const d of body.documents ?? []) {
      out.push({ id: d.name.split("/").pop() });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/** Subcollection ids directly under a document. Best-effort — [] on error. */
async function listSubcollections(docPath) {
  if (FLAT) return [];
  try {
    const r = await request(
      `${BASE}/${encodePath(docPath)}:listCollectionIds?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
    if (!r.ok) return [];
    const body = await r.json();
    return body.collectionIds ?? [];
  } catch {
    return [];
  }
}

/** Delete a single document by full path. Idempotent (404 → false). */
async function deleteDoc(path) {
  const r = await request(`${BASE}/${encodePath(path)}?key=${API_KEY}`, {
    method: "DELETE",
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status} ${await r.text()}`);
  return true;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function eachLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  });
  await Promise.all(workers);
}

// --- purge -----------------------------------------------------------------

const deleted = new Map(); // label → count
const preserved = new Map(); // label → count of _-prefixed docs kept

const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

/**
 * Deletes every non-internal doc in `collectionPath`, recursing into each
 * doc's subcollections first so nothing is orphaned. `label` groups the counts
 * in the summary; `depth` controls how chatty the log is.
 */
async function purge(collectionPath, label, depth) {
  const docs = await listAll(collectionPath);

  const targets = [];
  for (const d of docs) {
    if (isInternal(d.id)) {
      bump(preserved, label);
      continue;
    }
    targets.push(d);
  }
  if (!targets.length) return;

  await eachLimit(targets, 8, async (d) => {
    const docPath = `${collectionPath}/${d.id}`;
    for (const sub of await listSubcollections(docPath)) {
      await purge(`${docPath}/${sub}`, `${label}/${sub}`, depth + 1);
    }
    if (!DRY) await deleteDoc(docPath);
    bump(deleted, label);
    // Only narrate top-level docs — nested volume would drown the log.
    if (depth === 0) {
      console.log(`   ${DRY ? "would delete" : "deleted"}: ${docPath}`);
    }
  });
}

async function main() {
  console.log(
    `\n${CONFIRM ? "DELETING" : "DRY RUN — no changes"} · project: ${PROJECT_ID}`
  );
  console.log(
    `Collections: ${selected.join(", ")}${FLAT ? "  (--flat: not scanning for subcollections)" : ""}\n`
  );

  for (const collection of selected) {
    console.log(`— ${collection} —`);
    await purge(collection, collection, 0);
  }

  const labels = [...new Set([...deleted.keys(), ...preserved.keys()])].sort();
  console.log("\n=== SUMMARY ===");
  if (!labels.length) console.log("Nothing found in the selected collections.");
  let total = 0;
  for (const l of labels) {
    const del = deleted.get(l) ?? 0;
    const kept = preserved.get(l) ?? 0;
    total += del;
    console.log(
      `${l.padEnd(28)} ${String(del).padStart(5)} ${DRY ? "to delete" : "deleted"}` +
        (kept ? `   (${kept} schema/internal preserved)` : "")
    );
  }
  console.log(`${"TOTAL".padEnd(28)} ${String(total).padStart(5)}`);
  console.log("\nOnly the listed collections were touched. Schema docs, rules,");
  console.log("indexes and pcp_migrations are unaffected.");

  console.log(
    DRY
      ? "\nDry run complete. Re-run with --confirm to delete."
      : "\nDone. These collections have no migration in this repo — nothing reseeds them."
  );
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message || err);
  process.exit(1);
});
