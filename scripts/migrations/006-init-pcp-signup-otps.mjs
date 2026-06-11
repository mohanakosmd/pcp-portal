// Migration 006 — initialize pcp_signup_otps collection.
//
// PCP-only staging area for in-flight create-account attempts. When a visitor
// requests access, the submitted details + a 6-digit OTP are written here
// (keyed by emailKey) instead of straight into signup_requests. Only once the
// OTP is verified do we materialize the record into signup_requests (status
// "pending", emailVerified=true) and delete the staged doc. This keeps
// unverified attempts out of the shared admin review queue.
//
// Documents are short-lived: created on signup, deleted on successful verify.
// The external admin portal does NOT read this collection.
//
// Writes a `_schema` doc documenting the contract. Idempotent.
//
// Run from project root:
//   node scripts/migrations/006-init-pcp-signup-otps.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MIGRATION_ID = "006-init-pcp-signup-otps";
const PCP_SIGNUP_OTPS = "pcp_signup_otps";
const MIGRATIONS = "pcp_migrations";

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
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

async function main() {
  console.log(`Migration ${MIGRATION_ID} — project ${PROJECT_ID}`);

  await upsertDoc(PCP_SIGNUP_OTPS, "_schema", {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    description:
      "PCP-only staging area for in-flight create-account attempts. Doc id is " +
      "emailKey (email lowercased, non-alphanumerics → '_'). Holds the " +
      "submitted details and a pending OTP until the email is verified; on a " +
      "correct code the route writes a record into signup_requests and deletes " +
      "this doc. Short-lived; the external admin portal does not read it.",
    fields: {
      fullName: "string — display name as submitted",
      email: "string — normalized lowercase",
      phone: "string — phone number, free format",
      otpCode: "string — 6-digit pending code",
      otpExpiresAt: "ISO timestamp — when the code expires",
      otpAttempts: "integer — wrong-code attempts so far",
      createdAt: "ISO timestamp",
      updatedAt: "ISO timestamp",
    },
    appliedAt: new Date().toISOString(),
  });

  await upsertDoc(MIGRATIONS, MIGRATION_ID, {
    appliedAt: new Date().toISOString(),
  });

  console.log(`Done. Schema written to ${PCP_SIGNUP_OTPS}/_schema`);
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err?.message || err);
  process.exit(1);
});
