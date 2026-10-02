// Delete a single PCP user, found by email, plus their email / phone
// uniqueness claims. Pass `--with-cases` to also delete every case the user
// owns (and each case's `about/data`, `health/data`, `documents/*`).
//
// SAFETY: dry-run by default — it only PRINTS what it would delete. Pass
// `--confirm` to actually delete.
//
// Run from the project root:
//   node scripts/delete-pcp-user.mjs someone@x.com                         # dry run
//   node scripts/delete-pcp-user.mjs someone@x.com --confirm               # delete user
//   node scripts/delete-pcp-user.mjs someone@x.com --with-cases --confirm  # user + cases
//
// Note: this removes Firestore docs only. Uploaded files in Cloud Storage are
// not touched.

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local — aborting.");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const WITH_CASES = args.includes("--with-cases");
const EMAIL = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();
if (!EMAIL) {
  console.error("Usage: node scripts/delete-pcp-user.mjs <email> [--with-cases] [--confirm]");
  process.exit(1);
}

const PCP_USERS = "pcp_users";
const PCP_CASES = "pcp_cases";
const EMAIL_INDEX = "pcp_users_email_index";
const PHONE_INDEX = "pcp_users_phone_index";

const phoneKey = (p) => (p || "").replace(/\D/g, "");
const emailKey = (e) => (e || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "_");

function str(v) {
  return v && typeof v.stringValue === "string" ? v.stringValue : "";
}

async function listDocs(collectionPath) {
  const out = [];
  let pageToken = "";
  do {
    const url =
      `${BASE}/${collectionPath}?pageSize=300&key=${API_KEY}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `List ${collectionPath} failed: ${res.status} ${JSON.stringify(json)}`
      );
    }
    for (const d of json.documents || []) {
      const id = d.name.split("/").pop();
      if (id.startsWith("_")) continue; // skip _schema/_meta docs
      out.push({ id, fields: d.fields || {} });
    }
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function deletePath(path, dryRun) {
  if (dryRun) {
    console.log(`   would delete: ${path}`);
    return;
  }
  const res = await fetch(`${BASE}/${path}?key=${API_KEY}`, { method: "DELETE" });
  // Firestore returns 200 on delete; treat 404 (already gone) as success too.
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`Delete ${path} failed: ${res.status} ${body}`);
  }
  console.log(`   deleted: ${path}`);
}

async function deleteCase(c) {
  const code = str(c.fields.shortCode) || c.id;
  console.log(`\nCase ${code} (${c.id}):`);

  let docs = [];
  try {
    docs = await listDocs(`${PCP_CASES}/${c.id}/documents`);
  } catch (err) {
    console.warn(`   (could not list documents: ${err.message})`);
  }
  for (const d of docs) {
    await deletePath(`${PCP_CASES}/${c.id}/documents/${d.id}`, !CONFIRM);
  }
  await deletePath(`${PCP_CASES}/${c.id}/about/data`, !CONFIRM);
  await deletePath(`${PCP_CASES}/${c.id}/health/data`, !CONFIRM);
  await deletePath(`${PCP_CASES}/${c.id}`, !CONFIRM);
}

async function main() {
  console.log(
    `\n${CONFIRM ? "DELETING" : "DRY RUN — no changes"} · target email: ${EMAIL}` +
      `${WITH_CASES ? " · including cases" : ""}\n`
  );

  // 1) Find the PCP user by email.
  const users = await listDocs(PCP_USERS);
  const user = users.find((u) => str(u.fields.email).trim().toLowerCase() === EMAIL);
  if (!user) {
    console.error(`No pcp_users doc found with email "${EMAIL}". Aborting.`);
    process.exit(1);
  }
  const userId = user.id;
  console.log(`Found user: ${userId} (${str(user.fields.email)})`);

  // 2) Cases owned by the user — delete them, or warn that they'll be orphaned.
  const cases = await listDocs(PCP_CASES);
  const owned = cases.filter((c) => str(c.fields.ownerUserId) === userId);
  console.log(`Cases owned by this user: ${owned.length}`);
  if (owned.length > 0 && !WITH_CASES) {
    console.warn(
      "   (not deleting cases — they will be left without an owner; pass --with-cases to remove them)"
    );
  }
  if (WITH_CASES) {
    for (const c of owned) await deleteCase(c);
  }

  // 3) Uniqueness claims, then the user doc itself.
  console.log("\nUser records:");
  const eKey = emailKey(str(user.fields.email));
  const pKey = phoneKey(str(user.fields.mobile));
  if (eKey) await deletePath(`${EMAIL_INDEX}/${eKey}`, !CONFIRM);
  if (pKey) await deletePath(`${PHONE_INDEX}/${pKey}`, !CONFIRM);
  await deletePath(`${PCP_USERS}/${userId}`, !CONFIRM);

  console.log(
    `\n${CONFIRM ? "Done." : "Dry run complete. Re-run with --confirm to delete."}`
  );
  if (CONFIRM) {
    console.log("Note: any uploaded files in Cloud Storage were NOT deleted (Firestore only).");
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
