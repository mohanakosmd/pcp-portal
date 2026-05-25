// Migration 004 — initialize notifications collection.
//
// Writes a `_schema` doc into `notifications` documenting the per-user
// notification feed used for in-app bell + dropdown. Idempotent.
//
// Run from project root:
//   node scripts/migrations/004-init-notifications.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MIGRATION_ID = "004-init-notifications";
const NOTIFICATIONS = "notifications";
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

  await upsertDoc(NOTIFICATIONS, "_schema", {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    description:
      "In-app notification feed. One doc per event per recipient. Queried " +
      "by recipientUserId + createdAt DESC for the bell dropdown.",
    fields: {
      recipientUserId: "string — pcp_users or gi_users doc id",
      recipientType: "string — 'pcp' | 'gi'",
      type: "string — 'case_created' | 'case_submitted' | 'case_shared'",
      caseId: "string — pcp_cases doc id",
      caseShortCode: "string — e.g. 'REQ-12345' (denormalized for display)",
      title: "string — short heading",
      body: "string — one-line summary",
      read: "boolean — false until user marks it read",
      createdAt: "ISO timestamp",
      readAt: "ISO timestamp | null",
    },
    appliedAt: new Date().toISOString(),
  });

  await upsertDoc(MIGRATIONS, MIGRATION_ID, {
    appliedAt: new Date().toISOString(),
  });

  console.log(`Done. Schema written to ${NOTIFICATIONS}/_schema`);
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err?.message || err);
  process.exit(1);
});
