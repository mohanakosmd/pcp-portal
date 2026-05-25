// Migration 005 — initialize signup_requests collection.
//
// Shared with the GI portal: both portals drop pending registrations here for
// admin review, distinguished by `portal`. PCP records use the same canonical
// shape the GI portal writes (auto-generated doc id; fields fullName, email,
// phone, portal, status, created_at) PLUS PCP-only OTP/password fields. A
// pcp_users doc is created only once the admin approves. Flow:
//   1. signup  → signup_requests/{autoId} (portal "pcp", status "pending") + OTP
//   2. verify  → emailVerified=true (status stays "pending")
//   3. admin   → (external admin portal) reviews + approves, creates the
//                pcp_users doc from this record, then sets status="approved".
//
// Writes a `_schema` doc documenting the contract for the external admin
// system. Idempotent.
//
// Run from project root:
//   node scripts/migrations/005-init-signup-requests.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MIGRATION_ID = "005-init-signup-requests";
const SIGNUP_REQUESTS = "signup_requests";
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

  await upsertDoc(SIGNUP_REQUESTS, "_schema", {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    description:
      "Pending registrations awaiting admin approval, shared by the PCP and " +
      "GI portals (see `portal`). Doc id is auto-generated. Canonical fields " +
      "(fullName, email, phone, portal, status, created_at) match the GI " +
      "format. PCP records (portal='pcp') additionally carry OTP fields. No " +
      "password is captured here. Once an admin approves a PCP record, the " +
      "external admin portal must create pcp_users/{emailKey} from it (copying " +
      "fullName, email, phone; setting verified=true; provisioning " +
      "credentials), claim the email/phone uniqueness index entries, then set " +
      "this record's status='approved'.",
    fields: {
      // Canonical fields shared with the GI portal:
      fullName: "string (required) — display name",
      email: "string (required) — normalized lowercase",
      phone: "string (required) — phone number, free format",
      portal: "string — 'pcp' | 'gi'; which portal created the request",
      status: "string — 'pending' | 'approved' | 'rejected' (initial: 'pending')",
      created_at: "ISO timestamp",
      // PCP-specific OTP machinery (absent on GI records):
      type: "string — request type; 'pcp_user' for PCP registrations",
      emailVerified: "boolean — true once the OTP step succeeds",
      emailVerifiedAt: "ISO timestamp | null",
      otpCode: "string|null — 6-digit pending code; null once verified",
      otpExpiresAt: "ISO timestamp | null",
      otpAttempts: "integer",
      updatedAt: "ISO timestamp",
      // Set by the external admin portal on approval/rejection:
      approvedAt: "ISO timestamp — set by admin on approval",
      approvedByAdminId: "string — admin user id",
      createdUserId: "string — id of the pcp_users doc created on approval",
      rejectedAt: "ISO timestamp — set by admin on rejection",
      rejectionReason: "string — optional admin note",
    },
    statuses: ["pending", "approved", "rejected"],
    portals: ["pcp", "gi"],
    types: ["pcp_user"],
    appliedAt: new Date().toISOString(),
  });

  await upsertDoc(MIGRATIONS, MIGRATION_ID, {
    appliedAt: new Date().toISOString(),
  });

  console.log(`Done. Schema written to ${SIGNUP_REQUESTS}/_schema`);
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err?.message || err);
  process.exit(1);
});
