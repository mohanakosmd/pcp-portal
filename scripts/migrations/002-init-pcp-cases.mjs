// Migration 002 — initialize pcp_cases collection.
//
// What this does:
//   1. Writes a `_schema` document to `pcp_cases` describing the root fields,
//      status state machine, and enum list (mirrors docs/create-case-schema.md).
//   2. Writes schema markers at the subcollection paths so each group's
//      structure is discoverable from the Firebase Console:
//         pcp_cases/_schema/about/data
//         pcp_cases/_schema/health/data
//         pcp_cases/_schema/documents/_schema
//   3. Records the migration result in pcp_migrations/002-init-pcp-cases.
//
// No data backfill — there are no existing cases yet.
// Safe to re-run; existing schema docs are overwritten with the latest spec.
//
// Run from project root: node scripts/migrations/002-init-pcp-cases.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const MIGRATION_ID = "002-init-pcp-cases";

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

async function upsertDoc(path, data) {
  const params = new URLSearchParams();
  for (const k of Object.keys(data).filter((k) => data[k] !== undefined)) {
    params.append("updateMask.fieldPaths", k);
  }
  const url = `${BASE}/${path}?${params.toString()}&key=${API_KEY}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: buildFields(data) }),
  });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log(`Migration ${MIGRATION_ID} — project ${PROJECT_ID}`);
  const appliedAt = new Date().toISOString();

  console.log("Step 1: writing pcp_cases/_schema (root field dictionary)");
  await upsertDoc("pcp_cases/_schema", {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    description:
      "Cases created by PCP users via the 3-step create-case wizard. " +
      "Subcollections about/health/documents hold the step payloads.",
    rootFields: {
      ownerUserId: "string — FK to pcp_users/{userId}",
      status: "draft | submitted | under_review | completed | closed",
      currentStep: "int 1|2|3 — last wizard step the user reached",
      title: "string ≤120 — display title (computed from About+Health on save)",
      shortCode: "string REQ-##### — stable display id (unique per user)",
      aboutComplete: "bool — true when all 10 about fields populated",
      healthComplete: "bool — true when all 8 health fields populated",
      documentsCount: "int — mirror of documents/ subcollection size",
      submittedAt: "ISO timestamp|null",
      statusUpdatedAt: "ISO timestamp",
      createdAt: "ISO timestamp (immutable after create)",
      updatedAt: "ISO timestamp",
      aiSummary: "string|null ≤4000",
      aiSummaryGeneratedAt: "ISO timestamp|null",
      aiSuggestions:
        "map|null { diagnosis, files[], treatmentNotes, tests[], procedures[], medications[{name,dosage,frequency}], generatedAt } — submit-time GI decision support",
      aiSuggestionsGeneratedAt: "ISO timestamp|null",
    },
    statusStateMachine:
      "[create] → draft → submitted → under_review → completed → closed",
    enums: {
      caseStatus: ["draft", "submitted", "under_review", "completed", "closed"],
      gender: ["female", "male", "non_binary", "prefer_not_to_say", "other"],
      urgencyLevel: ["routine", "urgent", "emergency"],
      documentKind: [
        "lab",
        "imaging",
        "note",
        "insurance_card_front",
        "insurance_card_back",
        "other",
      ],
    },
    indexes: ["pcp_cases (ownerUserId ASC, createdAt DESC)"],
    storageBucketPath:
      "pcp_cases/{caseId}/documents/{fileId}/{original-filename}",
    appliedAt,
  });

  // The schema doc itself is at pcp_cases/_schema, and we want each subgroup
  // to be discoverable. Firestore requires document paths to alternate
  // collection/doc/collection/doc — so we put the schema markers UNDER the
  // _schema doc itself rather than as siblings of every real case.
  console.log("Step 2: writing about subschema → pcp_cases/_schema/about/data");
  await upsertDoc("pcp_cases/_schema/about/data", {
    schemaVersion: 1,
    description:
      "Step 1 — demographic + insurance details. 10 logical fields. " +
      "Doc id is always 'data' (one doc per case).",
    fields: {
      "1_fullLegalName": "string 1–120, required",
      "2_age": "int 0–120, required",
      "3_gender": "enum gender, required",
      "4_mobile": "string (digits ≥ 7), required",
      "5_email": "string (lowercased), required",
      "6_insuranceCarrier": "string ≤80, optional",
      "7_policyId": "string ≤60, optional",
      "8_groupName": "string ≤80, optional",
      "9_effectiveDate": "ISO date YYYY-MM-DD, optional",
      "10_insuranceCards":
        "map { front: {fileId, storagePath, uploadedAt}|null, back: {fileId, storagePath, uploadedAt}|null }, optional",
    },
    housekeeping: ["updatedAt", "updatedByUserId"],
    appliedAt,
  });

  console.log("Step 3: writing health subschema → pcp_cases/_schema/health/data");
  await upsertDoc("pcp_cases/_schema/health/data", {
    schemaVersion: 1,
    description:
      "Step 2 — health intake. 8 fields. Doc id is always 'data'.",
    fields: {
      "1_inboxMessage": "string 1–4000, required (speech-to-text target)",
      "2_allergies": "string ≤1000, optional",
      "3_currentMedications": "string ≤1000, optional",
      "4_existingConditions": "string ≤1000, optional",
      "5_recentTestsOrProcedures": "string ≤1000, optional",
      "6_familyHistory": "string ≤1000, optional",
      "7_lifestyleNotes": "string ≤1000, optional",
      "8_urgencyLevel": "enum urgencyLevel, required",
    },
    housekeeping: ["updatedAt", "updatedByUserId", "aiSymptomSummary (optional)"],
    appliedAt,
  });

  console.log(
    "Step 4: writing documents subschema → pcp_cases/_schema/documents/_schema"
  );
  await upsertDoc("pcp_cases/_schema/documents/_schema", {
    schemaVersion: 1,
    description:
      "Step 3 — uploaded files. One doc per file (id = push id). " +
      "Bytes live in Firebase Storage at storagePath.",
    fields: {
      fileName: "string 1–255, required",
      contentType: "string MIME, required",
      sizeBytes: "int ≤ 26214400 (25 MB), required",
      storagePath:
        "string 'pcp_cases/{caseId}/documents/{fileId}/{fileName}', required",
      downloadUrl: "string|null — cached signed URL",
      downloadUrlExpiresAt: "ISO timestamp|null",
      kind: "enum documentKind, required",
      uploadedAt: "ISO timestamp, required",
      uploadedByUserId: "string FK pcp_users, required",
      aiSummary: "string|null ≤2000",
      aiSummaryGeneratedAt: "ISO timestamp|null",
    },
    appliedAt,
  });

  console.log("Step 5: recording migration result → pcp_migrations/" + MIGRATION_ID);
  await upsertDoc(`pcp_migrations/${MIGRATION_ID}`, {
    appliedAt,
    description:
      "Initialize pcp_cases schema (root + about/health/documents subgroups). No data backfill.",
    schemaDocsWritten: [
      "pcp_cases/_schema",
      "pcp_cases/_schema/about/data",
      "pcp_cases/_schema/health/data",
      "pcp_cases/_schema/documents/_schema",
    ],
  });

  console.log("\nDone. Schema is now discoverable in the Firebase Console.");
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err?.message || err);
  process.exit(1);
});
