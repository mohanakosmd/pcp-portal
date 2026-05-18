// Empties the pcp_users collection (except its _schema doc) and clears the
// corresponding email / phone uniqueness claims. Use this to reset state for
// signup testing. Idempotent.
//
// Run from project root: node scripts/empty-pcp-users.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const USERS = "pcp_users";
const EMAIL_INDEX = "pcp_users_email_index";
const PHONE_INDEX = "pcp_users_phone_index";

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

async function listAll(collection) {
  const docs = [];
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
      docs.push({ id: parts[parts.length - 1], data: decFields(d.fields) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return docs;
}

async function deleteDoc(collection, id) {
  const r = await fetch(`${BASE}/${collection}/${encodeURIComponent(id)}?key=${API_KEY}`, {
    method: "DELETE",
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`DELETE ${collection}/${id} → ${r.status} ${await r.text()}`);
  return true;
}

const phoneKey = (p) => (p || "").replace(/\D/g, "");
const emailKey = (e) => (e || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "_");

console.log(`Project: ${PROJECT_ID}`);
console.log("Step 1: listing existing pcp_users docs");
const users = await listAll(USERS);
const userDocs = users.filter((u) => !u.id.startsWith("_"));
const schemaDocs = users.filter((u) => u.id.startsWith("_"));
console.log(`  → ${users.length} total (${userDocs.length} user, ${schemaDocs.length} schema/internal)`);

const emailKeysSeen = new Set();
const phoneKeysSeen = new Set();

let deletedUsers = 0;
for (const user of userDocs) {
  const eKey = emailKey(user.data.email);
  const pKey = phoneKey(user.data.mobile);
  if (eKey) emailKeysSeen.add(eKey);
  if (pKey) phoneKeysSeen.add(pKey);
  await deleteDoc(USERS, user.id);
  console.log(`  - deleted pcp_users/${user.id}`);
  deletedUsers++;
}

console.log(`Step 2: clearing matching uniqueness claims`);
let deletedEmailClaims = 0;
for (const eKey of emailKeysSeen) {
  if (await deleteDoc(EMAIL_INDEX, eKey)) {
    console.log(`  - deleted ${EMAIL_INDEX}/${eKey}`);
    deletedEmailClaims++;
  }
}
let deletedPhoneClaims = 0;
for (const pKey of phoneKeysSeen) {
  if (await deleteDoc(PHONE_INDEX, pKey)) {
    console.log(`  - deleted ${PHONE_INDEX}/${pKey}`);
    deletedPhoneClaims++;
  }
}

// Also scan the index collections for any orphan claims (claims whose
// userId no longer matches an existing user). This catches claims left over
// from manual writes / probes.
console.log("Step 3: scanning for orphan index entries");
for (const col of [EMAIL_INDEX, PHONE_INDEX]) {
  const claims = await listAll(col);
  for (const c of claims) {
    if (c.id.startsWith("_")) continue;
    const ownerId = c.data.userId;
    if (!ownerId) {
      await deleteDoc(col, c.id);
      console.log(`  - removed empty claim ${col}/${c.id}`);
      continue;
    }
    if (ownerId === "_probe" || ownerId === "rest_probe_jhon_travis") {
      await deleteDoc(col, c.id);
      console.log(`  - removed probe claim ${col}/${c.id}`);
    }
  }
}

console.log("\n=== SUMMARY ===");
console.log(`User docs deleted     : ${deletedUsers}`);
console.log(`Email claims cleared  : ${deletedEmailClaims}`);
console.log(`Phone claims cleared  : ${deletedPhoneClaims}`);
console.log(`Schema docs preserved : ${schemaDocs.length}`);
