// List all cases owned by a PCP user, found by email. Read-only.
//
// Run from the project root:
//   node scripts/list-cases-for-user.mjs                  # default email
//   node scripts/list-cases-for-user.mjs other@x.com      # another user
//   node scripts/list-cases-for-user.mjs --json           # JSON output

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
const AS_JSON = args.includes("--json");
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
function num(v) {
  if (!v) return 0;
  if (typeof v.integerValue === "string") return Number(v.integerValue);
  if (typeof v.doubleValue === "number") return v.doubleValue;
  return 0;
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
      throw new Error(`List ${collectionPath} failed: ${res.status} ${JSON.stringify(json)}`);
    }
    for (const d of json.documents || []) {
      const id = d.name.split("/").pop();
      if (id.startsWith("_")) continue;
      out.push({ id, fields: d.fields || {} });
    }
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function main() {
  const users = await listDocs(PCP_USERS);
  const user = users.find((u) => str(u.fields.email).trim().toLowerCase() === EMAIL);
  if (!user) {
    console.error(`No pcp_users doc found with email "${EMAIL}".`);
    process.exit(1);
  }
  const userId = user.id;

  const cases = await listDocs(PCP_CASES);
  const owned = cases
    .filter((c) => str(c.fields.ownerUserId) === userId)
    .map((c) => ({
      shortCode: str(c.fields.shortCode) || c.id,
      caseId: c.id,
      title: str(c.fields.title),
      status: str(c.fields.status) || "draft",
      currentStep: num(c.fields.currentStep) || 1,
      documentsCount: num(c.fields.documentsCount),
      sharedWithGiUser: str(c.fields.sharedWithGiUser),
      createdAt: str(c.fields.createdAt),
      updatedAt: str(c.fields.updatedAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (AS_JSON) {
    console.log(JSON.stringify({ email: EMAIL, userId, count: owned.length, cases: owned }, null, 2));
    return;
  }

  console.log(`\nUser: ${userId} (${str(user.fields.email)})`);
  console.log(`Cases: ${owned.length}\n`);
  if (owned.length === 0) {
    console.log("No cases found for this user.");
    return;
  }
  owned.forEach((c, i) => {
    console.log(`${i + 1}. ${c.shortCode}  ·  ${c.status}  ·  step ${c.currentStep}`);
    console.log(`   caseId: ${c.caseId}`);
    if (c.title) console.log(`   title: ${c.title}`);
    console.log(`   documents: ${c.documentsCount}${c.sharedWithGiUser ? ` · shared with: ${c.sharedWithGiUser}` : ""}`);
    console.log(`   created: ${c.createdAt || "—"}  ·  updated: ${c.updatedAt || "—"}\n`);
  });
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
