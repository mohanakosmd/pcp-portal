// Deletes APP DATA only — PCP users, GI users, cases and reports — while
// preserving every schema/internal doc and the migration history.
//
// PRESERVED, always:
//   - any document whose id starts with "_" (e.g. `_schema`, `_meta`), at every
//     level. That also protects the case sub-schemas, which live *under* the
//     `pcp_cases/_schema` doc (pcp_cases/_schema/about/data, .../health/data,
//     .../documents/_schema).
//   - the entire `pcp_migrations` collection — never touched.
//   - Firestore indexes and security rules — this script only deletes docs.
//
// DELETED, by group (Firestore has no cascade delete, so each tree is walked
// bottom-up):
//
//   users      pcp_users/{userId}
//              pcp_users_email_index/{emailKey}   ← uniqueness claims; they must
//              pcp_users_phone_index/{phoneKey}     go with the user or that
//                                                   email/phone can never sign
//                                                   up again
//   gi-users   gi_users/{giUserId}
//   cases      pcp_cases/{caseId}
//                ├─ about/data
//                ├─ health/data
//                └─ documents/{fileId}
//                     └─ chunks/{i}      ← the file bytes (base64) live here
//   reports    gi_shared_reports/{shareId}
//                └─ comments/{commentId} ← PCP + GI remarks
//              gi_medical_reports/{fileId}
//   notifications
//              notifications/{id}      — the in-app bell feed; its entries point
//                                        at cases/reports and would go stale
//   signup     signup_requests/{id}    — pending admin-review registrations
//              pcp_signup_otps/{key}   — in-flight OTP attempts
//
// All six groups run by default. Use --only to restrict to a subset.
//
// SAFETY: dry run by default — it only PRINTS what it would delete. Pass
// --confirm to actually delete. It deletes from whatever Firebase project
// .env.local points at, so use --expect-project to pin that down.
//
// Run from project root:
//   node scripts/empty-app-data.mjs                                  # dry run, all groups
//   node scripts/empty-app-data.mjs --confirm                        # delete all groups
//   node scripts/empty-app-data.mjs --only=cases,reports --confirm   # subset
//   node scripts/empty-app-data.mjs --expect-project=my-dev-proj --confirm
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

// --- args ------------------------------------------------------------------

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const DRY = !CONFIRM;

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

// A group is a list of collection trees. `children` are subcollections of each
// doc in that collection, deleted before the doc itself.
const GROUPS = {
  users: [
    { collection: "pcp_users" },
    { collection: "pcp_users_email_index" },
    { collection: "pcp_users_phone_index" },
  ],
  "gi-users": [{ collection: "gi_users" }],
  cases: [
    {
      collection: "pcp_cases",
      children: [
        { collection: "about" },
        { collection: "health" },
        { collection: "documents", children: [{ collection: "chunks" }] },
      ],
    },
  ],
  reports: [
    { collection: "gi_shared_reports", children: [{ collection: "comments" }] },
    { collection: "gi_medical_reports" },
  ],
  notifications: [{ collection: "notifications" }],
  signup: [{ collection: "signup_requests" }, { collection: "pcp_signup_otps" }],
};

const DEFAULT_GROUPS = Object.keys(GROUPS);

const onlyArg = args.find((a) => a.startsWith("--only="));
const selected = onlyArg
  ? onlyArg
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_GROUPS;

const unknown = selected.filter((g) => !GROUPS[g]);
if (unknown.length) {
  console.error(
    `Unknown group(s): ${unknown.join(", ")}\n` +
      `Valid groups: ${Object.keys(GROUPS).join(", ")}`
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

// Global cap on in-flight HTTP requests. The purge is nested (cases → documents
// → chunks), so a per-level limit would multiply; this gate bounds the whole run.
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
    return await requestInner(url, init, attempts);
  } finally {
    release();
  }
}

async function requestInner(url, init, attempts) {
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
}

/**
 * List every document id in a collection path (handles pagination).
 *
 * `mask.fieldPaths` is set to a field that doesn't exist, so Firestore returns
 * each document's name with NO field data. That matters: the `chunks`
 * subcollection under each document holds the base64 file bytes, and listing
 * those unmasked pulls megabytes per page and kills the connection.
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

const deleted = new Map(); // collection name → count
const preserved = new Map(); // collection name → count of _-prefixed docs kept

const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

/**
 * Deletes every non-internal doc in `node.collection` (relative to
 * `parentPath`), recursing into `node.children` first so nothing is orphaned.
 */
async function purge(parentPath, node, depth) {
  const colPath = parentPath ? `${parentPath}/${node.collection}` : node.collection;
  const docs = await listAll(colPath);

  const targets = [];
  for (const d of docs) {
    if (isInternal(d.id)) {
      bump(preserved, node.collection);
      continue;
    }
    targets.push(d);
  }
  if (!targets.length) return;

  await eachLimit(targets, 10, async (d) => {
    const docPath = `${colPath}/${d.id}`;
    for (const child of node.children ?? []) {
      await purge(docPath, child, depth + 1);
    }
    if (!DRY) await deleteDoc(docPath);
    bump(deleted, node.collection);
    // Only narrate top-level docs — chunk/comment volume would drown the log.
    if (depth === 0) {
      console.log(`   ${DRY ? "would delete" : "deleted"}: ${docPath}`);
    }
  });
}

async function main() {
  console.log(
    `\n${CONFIRM ? "DELETING" : "DRY RUN — no changes"} · project: ${PROJECT_ID}`
  );
  console.log(`Groups: ${selected.join(", ")}\n`);

  for (const group of selected) {
    console.log(`— ${group} —`);
    for (const node of GROUPS[group]) {
      await purge("", node, 0);
    }
  }

  const collections = [...new Set([...deleted.keys(), ...preserved.keys()])].sort();
  console.log("\n=== SUMMARY ===");
  if (!collections.length) {
    console.log("Nothing found in the selected groups.");
  }
  let total = 0;
  for (const c of collections) {
    const del = deleted.get(c) ?? 0;
    const kept = preserved.get(c) ?? 0;
    total += del;
    console.log(
      `${c.padEnd(24)} ${String(del).padStart(5)} ${DRY ? "to delete" : "deleted"}` +
        (kept ? `   (${kept} schema/internal preserved)` : "")
    );
  }
  console.log(`${"TOTAL".padEnd(24)} ${String(total).padStart(5)}`);
  console.log("\npcp_migrations and all _schema docs were not touched.");

  if (DRY) {
    console.log("\nDry run complete. Re-run with --confirm to delete.");
  } else {
    console.log("\nDone.");
    if (selected.includes("gi-users")) {
      console.log(
        "Note: the 6 seeded GI specialists are gone — re-run " +
          "`node scripts/migrations/003-init-gi-users.mjs` to restore them."
      );
    }
    const skipped = Object.keys(GROUPS).filter((g) => !selected.includes(g));
    if (skipped.length) {
      console.log(
        `Note: these groups were not selected and still hold data: ${skipped.join(", ")}.`
      );
    }
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message || err);
  process.exit(1);
});
