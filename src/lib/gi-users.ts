// GI specialists that PCP-portal cases can be shared with.
// See `gi_users` collection (migration 003-init-gi-users).

import { getDocument, listDocuments } from "@/lib/firestore-rest";

export const GI_USERS_COLLECTION = "gi_users";

export type GiUser = {
  id: string;
  displayName: string;
  specialty: string | null;
  email: string | null;
  active: boolean;
};

function parse(id: string, data: Record<string, unknown>): GiUser | null {
  // Accept either `displayName` (new schema) or `fullName` (admin_users
  // legacy schema) so users migrated from the old portal show up too.
  const fromDisplay =
    typeof data.displayName === "string" ? data.displayName.trim() : "";
  const fromFull = typeof data.fullName === "string" ? data.fullName.trim() : "";
  const displayName = fromDisplay || fromFull;
  if (!displayName) return null;
  return {
    id,
    displayName,
    specialty:
      typeof data.specialty === "string" && data.specialty.trim() ? data.specialty.trim() : null,
    email: typeof data.email === "string" && data.email.trim() ? data.email.trim() : null,
    active: data.active !== false,
  };
}

/** Returns every active GI user, sorted by displayName. */
export async function listGiUsers(): Promise<GiUser[]> {
  const page = await listDocuments(GI_USERS_COLLECTION, { pageSize: 200 });
  return page.docs
    .filter((d) => !d.id.startsWith("_"))
    .map((d) => parse(d.id, d.data))
    .filter((u): u is GiUser => !!u && u.active)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Returns the single GI user with the given id, or null if missing/inactive. */
export async function getGiUser(id: string): Promise<GiUser | null> {
  const doc = await getDocument(GI_USERS_COLLECTION, id);
  if (!doc) return null;
  const u = parse(doc.id, doc.data);
  return u && u.active ? u : null;
}
