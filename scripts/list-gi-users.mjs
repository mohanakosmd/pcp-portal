// Print every doc in the `gi_users` collection.
//
// Run from project root: node scripts/list-gi-users.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COLLECTION = "gi_users";

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

function decFields(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decVal(v);
  return out;
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
  console.log(`Firestore project: ${PROJECT_ID}`);
  console.log(`Collection:        ${COLLECTION}\n`);

  const docs = await listAll(COLLECTION);
  if (docs === null) {
    console.log("Collection does not exist. Run scripts/migrations/003-init-gi-users.mjs first.");
    return;
  }

  const real = docs.filter((d) => !d.id.startsWith("_"));
  const meta = docs.filter((d) => d.id.startsWith("_"));

  if (real.length === 0) {
    console.log("(no GI users)\n");
  } else {
    const sorted = real.slice().sort((a, b) =>
      String(a.data.displayName ?? a.id).localeCompare(
        String(b.data.displayName ?? b.id)
      )
    );
    for (const d of sorted) {
      console.log(`── ${d.id} ${"─".repeat(Math.max(0, 70 - d.id.length - 4))}`);
      const keys = Object.keys(d.data).sort();
      if (keys.length === 0) {
        console.log("  (no fields)");
      } else {
        const keyW = Math.max(...keys.map((k) => k.length));
        for (const k of keys) {
          const raw = d.data[k];
          const v =
            raw === null
              ? "null"
              : typeof raw === "object"
                ? JSON.stringify(raw)
                : String(raw);
          console.log(`  ${k.padEnd(keyW)} : ${v}`);
        }
      }
      console.log("");
    }
  }

  console.log(`\nTotal active : ${real.filter((d) => d.data.active !== false).length}`);
  console.log(`Total entries: ${real.length}`);
  if (meta.length) {
    console.log(`Schema docs  : ${meta.map((d) => d.id).join(", ")}`);
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err);
  process.exit(1);
});
