// Exercises the Firestore REST API exactly the way the signup route does.
// Run from project root: node scripts/check-firestore-rest.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

if (!PROJECT_ID || !API_KEY) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_API_KEY in .env.local");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getDoc(collection, id) {
  const r = await fetch(`${BASE}/${collection}/${id}?key=${API_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${collection}/${id} failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function upsert(collection, id, fields) {
  const params = new URLSearchParams();
  for (const k of Object.keys(fields)) params.append("updateMask.fieldPaths", k);
  const url = `${BASE}/${collection}/${id}?${params.toString()}&key=${API_KEY}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${collection}/${id} failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

const id = "rest_probe_jhon_travis";
const now = new Date().toISOString();

console.log("→ Looking up", id);
const existing = await getDoc("pcp_users", id);
console.log("   existing:", existing ? "yes" : "no");

console.log("→ Upserting probe record");
await upsert("pcp_users", id, {
  name: { stringValue: "REST probe" },
  email: { stringValue: "rest.probe@example.com" },
  otpCode: { stringValue: "123456" },
  otpExpiresAt: { timestampValue: new Date(Date.now() + 10 * 60_000).toISOString() },
  otpAttempts: { integerValue: "0" },
  verified: { booleanValue: false },
  createdAt: { timestampValue: now },
  updatedAt: { timestampValue: now },
});

console.log("→ Reading back");
const after = await getDoc("pcp_users", id);
console.log("   updateTime:", after?.updateTime);
console.log("\nSUCCESS — REST client can read & write pcp_users.");
