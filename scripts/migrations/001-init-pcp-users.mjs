// Migration 001 — initialize pcp_users collection with unique email + phone.
//
// What this does:
//   1. Writes a `_schema` document into `pcp_users` describing the expected
//      fields. This also materializes the collection in Firestore.
//   2. Backfills the uniqueness index collections:
//        - pcp_users_email_index/{emailKey}   → { userId, claimedAt }
//        - pcp_users_phone_index/{phoneKey}   → { userId, claimedAt }
//      Only verified users are indexed. The first verified user wins any
//      duplicate — others are reported (NOT silently corrupted).
//   3. Records the migration result in `pcp_migrations/001-init-pcp-users`.
//
// Safe to run multiple times. Existing index entries are left in place;
// the script only fills in what's missing.
//
// Run from project root:
//   node scripts/migrations/001-init-pcp-users.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MIGRATION_ID = "001-init-pcp-users";
const PCP_USERS = "pcp_users";
const EMAIL_INDEX = "pcp_users_email_index";
const PHONE_INDEX = "pcp_users_phone_index";
const MIGRATIONS = "pcp_migrations";

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

function buildFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    fields[k] = enc(v);
  }
  return fields;
}

async function getDoc(collection, id) {
  const r = await fetch(`${BASE}/${collection}/${encodeURIComponent(id)}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${collection}/${id} → ${r.status} ${await r.text()}`);
  const body = await r.json();
  return { id, data: decFields(body.fields) };
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

async function listAll(collection) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${collection}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`LIST ${collection} → ${r.status} ${await r.text()}`);
    const body = await r.json();
    for (const d of body.documents ?? []) {
      const parts = d.name.split("/");
      out.push({ id: parts[parts.length - 1], data: decFields(d.fields) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

function emailKey(email) {
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function phoneKey(phone) {
  return (phone || "").replace(/\D/g, "");
}

// --- Migration body --------------------------------------------------------

async function main() {
  console.log(`Migration ${MIGRATION_ID} — project ${PROJECT_ID}`);

  console.log("Step 1: writing schema doc → pcp_users/_schema");
  await upsertDoc(PCP_USERS, "_schema", {
    schemaVersion: 1,
    migration: MIGRATION_ID,
    description:
      "PCP portal end-users. Identified by emailKey (email lowercased, " +
      "non-alphanum → _). Email and phone are uniquely owned via " +
      "pcp_users_email_index and pcp_users_phone_index respectively.",
    fields: {
      name: "string (required) — display name",
      email: "string (required, unique) — normalized lowercase",
      mobile: "string (required, unique) — phone number, free format",
      verified: "boolean — true after OTP step",
      verifiedAt: "ISO timestamp",
      otpCode: "string|null — 6-digit pending code; null when verified",
      otpExpiresAt: "ISO timestamp|null",
      otpAttempts: "integer",
      passwordHash: "string — bcrypt hash, optional",
      passwordSetAt: "ISO timestamp",
      createdAt: "ISO timestamp",
      updatedAt: "ISO timestamp",
    },
    indexes: [
      `${EMAIL_INDEX}/{emailKey} → { userId, claimedAt }`,
      `${PHONE_INDEX}/{phoneKey} → { userId, claimedAt }`,
    ],
    appliedAt: new Date().toISOString(),
  });

  console.log("Step 2: writing schema doc for index collections");
  await upsertDoc(EMAIL_INDEX, "_schema", {
    schemaVersion: 1,
    description:
      "One doc per unique normalized email. Key = email lowercased with " +
      "non-alphanum chars replaced by underscore.",
    fields: {
      userId: "string — owning pcp_users doc id",
      claimedAt: "ISO timestamp — when uniqueness was claimed",
    },
    appliedAt: new Date().toISOString(),
  });
  await upsertDoc(PHONE_INDEX, "_schema", {
    schemaVersion: 1,
    description:
      "One doc per unique phone (digits-only). Key = mobile field stripped to digits.",
    fields: {
      userId: "string — owning pcp_users doc id",
      claimedAt: "ISO timestamp — when uniqueness was claimed",
    },
    appliedAt: new Date().toISOString(),
  });

  console.log("Step 3: scanning existing pcp_users docs");
  const allUsers = (await listAll(PCP_USERS)).filter((u) => !u.id.startsWith("_"));
  const verifiedUsers = allUsers.filter((u) => u.data.verified === true);
  console.log(
    `   → ${allUsers.length} doc(s) found, ${verifiedUsers.length} verified, ${allUsers.length - verifiedUsers.length} unverified`
  );

  const reservedEmails = new Map(); // emailKey → userId
  const reservedPhones = new Map();
  const emailConflicts = [];
  const phoneConflicts = [];
  const indexed = { email: 0, phone: 0 };
  const skipped = { email: 0, phone: 0 };

  console.log("Step 4: backfilling uniqueness claims for verified users");
  for (const user of verifiedUsers) {
    const eKey = emailKey(user.data.email);
    const pKey = phoneKey(user.data.mobile);

    // Email
    if (!eKey) {
      console.log(`   - ${user.id}: skipped (empty email)`);
    } else if (reservedEmails.has(eKey)) {
      emailConflicts.push({ key: eKey, winner: reservedEmails.get(eKey), loser: user.id });
    } else {
      const result = await createDoc(EMAIL_INDEX, eKey, {
        userId: user.id,
        claimedAt: new Date().toISOString(),
      });
      reservedEmails.set(eKey, user.id);
      if (result.exists) {
        skipped.email++;
        const existing = await getDoc(EMAIL_INDEX, eKey);
        const owner = existing?.data.userId;
        if (owner && owner !== user.id) {
          emailConflicts.push({ key: eKey, winner: owner, loser: user.id });
        }
      } else {
        indexed.email++;
      }
    }

    // Phone
    if (!pKey) {
      console.log(`   - ${user.id}: skipped phone (empty mobile)`);
    } else if (reservedPhones.has(pKey)) {
      phoneConflicts.push({ key: pKey, winner: reservedPhones.get(pKey), loser: user.id });
    } else {
      const result = await createDoc(PHONE_INDEX, pKey, {
        userId: user.id,
        claimedAt: new Date().toISOString(),
      });
      reservedPhones.set(pKey, user.id);
      if (result.exists) {
        skipped.phone++;
        const existing = await getDoc(PHONE_INDEX, pKey);
        const owner = existing?.data.userId;
        if (owner && owner !== user.id) {
          phoneConflicts.push({ key: pKey, winner: owner, loser: user.id });
        }
      } else {
        indexed.phone++;
      }
    }
  }

  console.log("Step 5: recording migration result");
  await upsertDoc(MIGRATIONS, MIGRATION_ID, {
    appliedAt: new Date().toISOString(),
    totalUsers: allUsers.length,
    verifiedUsers: verifiedUsers.length,
    emailIndexed: indexed.email,
    emailAlreadyClaimed: skipped.email,
    phoneIndexed: indexed.phone,
    phoneAlreadyClaimed: skipped.phone,
    emailConflicts: emailConflicts.map((c) => `${c.key}: kept ${c.winner}, ignored ${c.loser}`),
    phoneConflicts: phoneConflicts.map((c) => `${c.key}: kept ${c.winner}, ignored ${c.loser}`),
  });

  console.log("\n=== SUMMARY ===");
  console.log(`Users total / verified : ${allUsers.length} / ${verifiedUsers.length}`);
  console.log(`Email claims created   : ${indexed.email} (already claimed: ${skipped.email})`);
  console.log(`Phone claims created   : ${indexed.phone} (already claimed: ${skipped.phone})`);
  if (emailConflicts.length) {
    console.log(`\n⚠ Email conflicts (${emailConflicts.length}):`);
    for (const c of emailConflicts) {
      console.log(`   ${c.key}: kept ${c.winner}, NOT indexed ${c.loser}`);
    }
  }
  if (phoneConflicts.length) {
    console.log(`\n⚠ Phone conflicts (${phoneConflicts.length}):`);
    for (const c of phoneConflicts) {
      console.log(`   ${c.key}: kept ${c.winner}, NOT indexed ${c.loser}`);
    }
  }
  if (!emailConflicts.length && !phoneConflicts.length) {
    console.log("\nAll verified users were uniquely indexed.");
  }
  console.log(`\nDone. Migration record: ${MIGRATIONS}/${MIGRATION_ID}`);
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err?.message || err);
  process.exit(1);
});
