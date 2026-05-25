// List every case that has been shared with a GI specialist, grouped by
// the assigned GI user. Cases still in `draft` or `submitted` (i.e. not yet
// shared) are listed separately at the end as "unassigned".
//
// Run from project root: node scripts/list-cases-by-gi.mjs
//
// Optional: pass a GI user id to filter to that user only:
//   node scripts/list-cases-by-gi.mjs nisha-verma

import { config } from "dotenv";
config({ path: ".env.local" });

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!PROJECT_ID || !API_KEY) {
  console.error("Missing Firebase config in .env.local");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const CASES = "pcp_cases";
const GI_USERS = "gi_users";

const filterGiUserId = process.argv[2]?.trim() || null;

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

function decFields(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decVal(v);
  return out;
}

async function listAll(collection) {
  const docs = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${collection}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url);
    if (r.status === 404) return [];
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

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function giDisplay(giUser) {
  if (!giUser) return null;
  return (
    (typeof giUser.data.displayName === "string" && giUser.data.displayName.trim()) ||
    (typeof giUser.data.fullName === "string" && giUser.data.fullName.trim()) ||
    giUser.id
  );
}

async function main() {
  console.log(`Firestore project: ${PROJECT_ID}`);
  if (filterGiUserId) console.log(`Filter: giUserId = ${filterGiUserId}`);
  console.log("");

  const [cases, giUsers] = await Promise.all([listAll(CASES), listAll(GI_USERS)]);

  // Map gi user id → display name for nice output.
  const giById = new Map();
  for (const g of giUsers.filter((d) => !d.id.startsWith("_"))) {
    giById.set(g.id, g);
  }

  // Bucket cases by sharedWithGiUserId. Legacy cases (shared before the id
  // field existed) are detected via sharedWithGiAt + sharedWithGiUser and
  // grouped under a "legacy:<name>" key so they're not mis-reported as
  // unassigned.
  const buckets = new Map(); // bucketKey → array<row>
  const legacyDisplayByKey = new Map(); // legacy:* key → display name
  for (const c of cases.filter((d) => !d.id.startsWith("_"))) {
    const giId =
      typeof c.data.sharedWithGiUserId === "string" && c.data.sharedWithGiUserId
        ? c.data.sharedWithGiUserId
        : null;
    const giName =
      typeof c.data.sharedWithGiUser === "string" && c.data.sharedWithGiUser
        ? c.data.sharedWithGiUser
        : null;
    const sharedAt =
      typeof c.data.sharedWithGiAt === "string" && c.data.sharedWithGiAt
        ? c.data.sharedWithGiAt
        : null;

    let key;
    if (giId) {
      key = giId;
    } else if (sharedAt || giName) {
      const label = giName || "(unknown)";
      key = `legacy:${label}`;
      legacyDisplayByKey.set(key, label);
    } else {
      key = "__unassigned__";
    }

    if (filterGiUserId && key !== filterGiUserId) continue;

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }

  if (buckets.size === 0) {
    console.log(filterGiUserId ? "No cases shared with that GI user." : "No cases found.");
    return;
  }

  // Print each bucket. Sort: known GI users first (by display name), then
  // legacy (no sharedWithGiUserId) buckets, then unassigned last.
  const orderedKeys = [...buckets.keys()].sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    const aLegacy = a.startsWith("legacy:");
    const bLegacy = b.startsWith("legacy:");
    if (aLegacy && !bLegacy) return 1;
    if (!aLegacy && bLegacy) return -1;
    const an = aLegacy ? legacyDisplayByKey.get(a) ?? a : giDisplay(giById.get(a)) ?? a;
    const bn = bLegacy ? legacyDisplayByKey.get(b) ?? b : giDisplay(giById.get(b)) ?? b;
    return an.localeCompare(bn);
  });

  for (const key of orderedKeys) {
    const rows = buckets.get(key);
    let heading;
    if (key === "__unassigned__") {
      heading = `Unassigned (not yet shared) — ${rows.length} case(s)`;
    } else if (key.startsWith("legacy:")) {
      const name = legacyDisplayByKey.get(key) ?? "(unknown)";
      heading = `${name}  [legacy — no sharedWithGiUserId] — ${rows.length} case(s)`;
    } else {
      heading = `${giDisplay(giById.get(key)) ?? key}  [${key}] — ${rows.length} case(s)`;
    }
    console.log(heading);
    console.log("─".repeat(Math.max(heading.length, 60)));

    if (rows.length === 0) {
      console.log("  (none)");
    } else {
      const sorted = rows.slice().sort((a, b) =>
        String(b.data.sharedWithGiAt ?? b.data.createdAt ?? "").localeCompare(
          String(a.data.sharedWithGiAt ?? a.data.createdAt ?? "")
        )
      );
      // Column widths.
      const codeW = Math.max(
        ...sorted.map((c) => String(c.data.shortCode ?? c.id).length),
        "Code".length
      );
      const statusW = Math.max(
        ...sorted.map((c) => String(c.data.status ?? "").length),
        "Status".length
      );
      console.log(
        "  " +
          "Code".padEnd(codeW) +
          "   " +
          "Status".padEnd(statusW) +
          "   Shared at         Owner"
      );
      console.log(
        "  " +
          "-".repeat(codeW) +
          "   " +
          "-".repeat(statusW) +
          "   " +
          "-".repeat(16) +
          "   " +
          "-".repeat(20)
      );
      for (const c of sorted) {
        const code = String(c.data.shortCode ?? c.id).padEnd(codeW);
        const status = String(c.data.status ?? "—").padEnd(statusW);
        const sharedAt = formatDate(c.data.sharedWithGiAt).padEnd(16);
        const owner = c.data.ownerUserId ?? "—";
        console.log(`  ${code}   ${status}   ${sharedAt}   ${owner}`);
      }
    }
    console.log("");
  }

  const totalShared = [...buckets.entries()]
    .filter(([k]) => k !== "__unassigned__" && !k.startsWith("legacy:"))
    .reduce((sum, [, rows]) => sum + rows.length, 0);
  const totalLegacy = [...buckets.entries()]
    .filter(([k]) => k.startsWith("legacy:"))
    .reduce((sum, [, rows]) => sum + rows.length, 0);
  const totalUnassigned = buckets.get("__unassigned__")?.length ?? 0;
  console.log(`Total shared (with id)    : ${totalShared}`);
  if (totalLegacy) console.log(`Total shared (legacy)     : ${totalLegacy}`);
  console.log(`Total unassigned          : ${totalUnassigned}`);
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err);
  process.exit(1);
});
