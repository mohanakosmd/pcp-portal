// Show every top-level collection in the Firestore database, with each
// collection's document count and a few sample IDs.
//
// Firestore's REST `:listCollectionIds` admin op typically requires an OAuth
// access token from a service account — the public API key alone usually
// isn't enough. We attempt it anyway, then fall back to probing a known
// (extendable) list of collection names plus any collections referenced in
// `pcp_migrations` records.
//
// Run from project root: node scripts/list-collections.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Add new collection names here as the app grows.
const KNOWN_COLLECTIONS = [
  "pcp_users",
  "pcp_users_email_index",
  "pcp_users_phone_index",
  "pcp_cases",
  "pcp_migrations",
];

function decFields(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decVal(v);
  return out;
}
function decVal(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decVal);
  if ("mapValue" in v) {
    const out = {};
    for (const [k, x] of Object.entries(v.mapValue.fields ?? {})) out[k] = decVal(x);
    return out;
  }
  return undefined;
}

async function tryListCollectionIds() {
  const r = await fetch(`${BASE}:listCollectionIds?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageSize: 1000 }),
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok: false, status: r.status, error: text };
  }
  const body = await r.json();
  return { ok: true, collectionIds: body.collectionIds ?? [] };
}

async function listAll(collection) {
  const docs = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${collection}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`LIST ${collection} → ${r.status} ${await r.text()}`);
    const body = await r.json();
    for (const d of body.documents ?? []) {
      const parts = d.name.split("/");
      docs.push({ id: parts[parts.length - 1], data: decFields(d.fields) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return docs;
}

async function main() {
  console.log(`Firestore project: ${PROJECT_ID}\n`);

  console.log("Trying :listCollectionIds (admin op) ...");
  const admin = await tryListCollectionIds();

  let collectionNames;
  if (admin.ok) {
    console.log(`  ✓ accepted by API key — returned ${admin.collectionIds.length} collections.\n`);
    collectionNames = admin.collectionIds.sort();
  } else {
    console.log(`  ✗ blocked (HTTP ${admin.status}) — falling back to probing known names.\n`);
    // Pull migration records to widen the probe set (each migration logs the
    // collections it touched).
    const probe = new Set(KNOWN_COLLECTIONS);
    const migrations = (await listAll("pcp_migrations")) ?? [];
    for (const m of migrations) {
      // The migration record stores its dependents/notes as JSON-like fields.
      // For robustness, only treat string values as candidate collection names
      // if they look like a Firestore id.
      for (const v of Object.values(m.data ?? {})) {
        if (typeof v === "string" && /^[A-Za-z][A-Za-z0-9_]+$/.test(v)) {
          probe.add(v);
        }
      }
    }
    collectionNames = [...probe].sort();
  }

  console.log(`Inspecting ${collectionNames.length} candidate collection(s):\n`);

  const results = [];
  for (const name of collectionNames) {
    const docs = await listAll(name);
    if (docs === null) {
      results.push({ name, status: "missing" });
      continue;
    }
    results.push({ name, status: "exists", count: docs.length, sample: docs.slice(0, 5).map((d) => d.id) });
  }

  const present = results.filter((r) => r.status === "exists");
  const missing = results.filter((r) => r.status === "missing");

  const nameCol = Math.max(...present.map((r) => r.name.length), "Collection".length);
  console.log("Collection".padEnd(nameCol) + "   " + "Docs".padStart(5) + "   Sample IDs");
  console.log("-".repeat(nameCol) + "   " + "-".repeat(5) + "   " + "-".repeat(40));
  for (const r of present) {
    const docs = String(r.count).padStart(5);
    const sample = r.sample.join(", ") + (r.count > r.sample.length ? `, …` : "");
    console.log(r.name.padEnd(nameCol) + "   " + docs + "   " + (sample || "(empty)"));
  }

  if (missing.length) {
    console.log(`\nProbed but not found (${missing.length}):`);
    for (const r of missing) console.log(`  - ${r.name}`);
  }

  console.log("\nTotal collections present: " + present.length);
  console.log(
    "Total documents:           " + present.reduce((sum, r) => sum + r.count, 0)
  );
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err);
  process.exit(1);
});
