// Delete ALL cases (and their subcollections) owned by a PCP user, found by
// email. Firestore REST has no cascade delete, so we explicitly remove each
// case's `about/data`, `health/data`, and every `documents/*` doc, then the
// case doc itself.
//
// SAFETY: dry-run by default — it only PRINTS what it would delete. Pass
// `--confirm` to actually delete.
//
// Run from the project root:
//   node scripts/delete-cases-for-user.mjs                 # dry run
//   node scripts/delete-cases-for-user.mjs --confirm       # delete
//   node scripts/delete-cases-for-user.mjs other@x.com --confirm
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
const EMAIL = (
  args.find((a) => !a.startsWith("--")) || "gaurangni.goyal@akosmdtech.com"
)
  .trim()
  .toLowerCase();

const PCP_USERS = "pcp_users";
const PCP_CASES = "pcp_cases";

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

async function main() {
  console.log(
    `\n${CONFIRM ? "DELETING" : "DRY RUN — no changes"} · target email: ${EMAIL}\n`
  );

  // 1) Find the PCP user by email.
  const users = await listDocs(PCP_USERS);
  const user = users.find((u) => str(u.fields.email).trim().toLowerCase() === EMAIL);
  if (!user) {
    console.error(`No pcp_users doc found with email "${EMAIL}". Aborting.`);
    process.exit(1);
  }
  const userId = user.id;
  console.log(`Found user: ${userId} (${str(user.fields.email)})\n`);

  // 2) All cases owned by that user.
  const cases = await listDocs(PCP_CASES);
  const owned = cases.filter((c) => str(c.fields.ownerUserId) === userId);
  console.log(`Cases owned by this user: ${owned.length}`);
  if (owned.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  // 3) Delete each case + its subcollections.
  for (const c of owned) {
    const code = str(c.fields.shortCode) || c.id;
    console.log(`\nCase ${code} (${c.id}):`);

    // documents subcollection — list and delete each.
    let docs = [];
    try {
      docs = await listDocs(`${PCP_CASES}/${c.id}/documents`);
    } catch (err) {
      console.warn(`   (could not list documents: ${err.message})`);
    }
    for (const d of docs) {
      await deletePath(`${PCP_CASES}/${c.id}/documents/${d.id}`, !CONFIRM);
    }

    // single-doc subcollections.
    await deletePath(`${PCP_CASES}/${c.id}/about/data`, !CONFIRM);
    await deletePath(`${PCP_CASES}/${c.id}/health/data`, !CONFIRM);

    // the case root doc.
    await deletePath(`${PCP_CASES}/${c.id}`, !CONFIRM);
  }

  console.log(
    `\n${CONFIRM ? "Done." : "Dry run complete. Re-run with --confirm to delete."}`
  );
  if (!CONFIRM) return;
  console.log(
    "Note: any uploaded files in Cloud Storage were NOT deleted (Firestore only)."
  );
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
