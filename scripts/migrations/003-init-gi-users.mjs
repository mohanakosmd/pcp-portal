// Migration 003 — initialize gi_users collection.
//
// What this does:
//   1. Writes a `_schema` document into `gi_users` describing the expected
//      fields. This also materializes the collection in Firestore.
//   2. Seeds the six default GI specialists if they don't already exist.
//      Existing docs are left untouched.
//   3. Records the migration result in `pcp_migrations/003-init-gi-users`.
//
// Safe to run multiple times.
//
// Run from project root:
//   node scripts/migrations/003-init-gi-users.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MIGRATION_ID = "003-init-gi-users";
const GI_USERS = "gi_users";
const MIGRATIONS = "pcp_migrations";

const SEED = [
  { id: "ayaan-gupta",  displayName: "Dr. Ayaan Gupta",  specialty: "Gastroenterology" },
  { id: "nisha-verma",  displayName: "Dr. Nisha Verma",  specialty: "Gastroenterology" },
  { id: "rohan-malik",  displayName: "Dr. Rohan Malik",  specialty: "Gastroenterology" },
  { id: "priya-nair",   displayName: "Dr. Priya Nair",   specialty: "Gastroenterology" },
  { id: "karan-iyer",   displayName: "Dr. Karan Iyer",   specialty: "Gastroenterology" },
  { id: "meera-singh",  displayName: "Dr. Meera Singh",  specialty: "Gastroenterology" },
];

// --- Firestore REST helpers (small, dependency-free) -----------------------

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = enc(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function buildFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    fields[k] = enc(v);
  }
  return fields;
}

async function upsertDoc(collection, id, data) {
  const params = new URLSearchParams();
  for (const k of Object.keys(data).filter((k) => data[k] !== undefined)) {
    params.append("updateMask.fieldPaths", k);
  }
  const r = await fetch(
    `${BASE}/${collection}/${encodeURIComponent(id)}?${params.toString()}&key=${API_KEY}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: buildFields(data) }),
    }
  );
  if (!r.ok) throw new Error(`PATCH ${collection}/${id} → ${r.status} ${await r.text()}`);
  return r.json();
}

/** Atomic create — fails (409) if doc exists. */
async function createDoc(collection, id, data) {
  const params = new URLSearchParams();
  for (const k of Object.keys(data).filter((k) => data[k] !== undefined)) {
    params.append("updateMask.fieldPaths", k);
  }
  params.append("currentDocument.exists", "false");
  const r = await fetch(
    `${BASE}/${collection}/${encodeURIComponent(id)}?${params.toString()}&key=${API_KEY}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: buildFields(data) }),
    }
  );
  if (r.status === 409) return { exists: true };
  if (!r.ok) throw new Error(`CREATE ${collection}/${id} → ${r.status} ${await r.text()}`);
  return { exists: false, doc: await r.json() };
}

async function main() {
  console.log(`Migration ${MIGRATION_ID} — project ${PROJECT_ID}`);

  console.log("Step 1: writing schema doc → gi_users/_schema");
  await upsertDoc(GI_USERS, "_schema", {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    description:
      "GI specialists that PCP-portal cases can be shared with. Doc id is a " +
      "stable kebab-case slug. PCP cases reference this collection via " +
      "sharedWithGiUserId.",
    fields: {
      displayName: "string (required) — e.g. 'Dr. Ayaan Gupta'",
      specialty: "string — e.g. 'Gastroenterology'",
      email: "string|null — contact email",
      active: "boolean — true if available to receive new shares",
      createdAt: "ISO timestamp",
    },
    appliedAt: new Date().toISOString(),
  });

  console.log("Step 2: seeding default GI specialists");
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const u of SEED) {
    const r = await createDoc(GI_USERS, u.id, {
      displayName: u.displayName,
      specialty: u.specialty,
      email: null,
      active: true,
      createdAt: now,
    });
    if (r.exists) {
      skipped++;
      console.log(`   - ${u.id}: already exists, leaving as-is`);
    } else {
      created++;
      console.log(`   ✓ ${u.id}: ${u.displayName}`);
    }
  }

  console.log("Step 3: recording migration result");
  await upsertDoc(MIGRATIONS, MIGRATION_ID, {
    appliedAt: new Date().toISOString(),
    seeded: SEED.length,
    created,
    skipped,
  });

  console.log("\n=== SUMMARY ===");
  console.log(`Seed entries     : ${SEED.length}`);
  console.log(`Created          : ${created}`);
  console.log(`Skipped (existed): ${skipped}`);
  console.log(`\nDone. Migration record: ${MIGRATIONS}/${MIGRATION_ID}`);
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err?.message || err);
  process.exit(1);
});
