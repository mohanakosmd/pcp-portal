// Medical Assistant (MA) staff directory.
//
// MA staff don't have PCP-portal accounts — they live alongside admins and GI
// doctors in the shared `admin_users` collection, distinguished by role "ma".
// This module exists so case-lifecycle notifications can fan out to the whole
// MA team without every caller re-learning that layout.

import { queryDocuments } from "@/lib/firestore-rest";

export const ADMIN_USERS_COLLECTION = "admin_users";

export type MaUser = {
  id: string;
  name: string;
  email: string;
};

/** How many MA docs to pull. The team is small; this is a runaway guard. */
const MA_QUERY_LIMIT = 200;

function readString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Every active MA, deduped by email address. Docs with no e-mail on file are
 * skipped — they can't be notified, and passing a blank recipient to SendGrid
 * just produces a failed send.
 *
 * Best-effort by design: a Firestore error yields an empty list rather than
 * throwing, so a directory outage can never fail the case operation that
 * triggered the notification.
 */
export async function listMaUsers(): Promise<MaUser[]> {
  let docs;
  try {
    // Single equality filter — served by Firestore's automatic single-field
    // index, so this needs no composite index.
    docs = await queryDocuments(
      ADMIN_USERS_COLLECTION,
      [{ field: "role", value: "ma" }],
      { limit: MA_QUERY_LIMIT }
    );
  } catch (err) {
    console.error("[ma-users] failed to list MA staff:", err);
    return [];
  }

  const byEmail = new Map<string, MaUser>();
  for (const doc of docs) {
    if (doc.id.startsWith("_")) continue; // `_schema`-style placeholder docs
    const data = doc.data as Record<string, unknown>;
    const email = readString(data, "email");
    if (!email) continue;

    const key = email.toLowerCase();
    if (byEmail.has(key)) continue;

    // `fullName` is the field admin_users actually uses; the others are
    // tolerated in case the admin app's schema drifts.
    const name =
      readString(data, "fullName") ||
      readString(data, "displayName") ||
      readString(data, "name") ||
      email.split("@")[0];

    byEmail.set(key, { id: doc.id, name, email });
  }

  return [...byEmail.values()];
}
