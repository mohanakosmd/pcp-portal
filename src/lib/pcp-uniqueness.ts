// Firestore doesn't have native unique constraints. We enforce them via two
// "index" collections — one doc per claimed email/phone, with the owning
// userId inside. Atomic claim is done via createDocument() with
// currentDocument.exists=false, which Firestore rejects with 409 if the
// document already exists.
//
//   pcp_users_email_index/{emailKey}  → { userId, claimedAt }
//   pcp_users_phone_index/{phoneKey}  → { userId, claimedAt }
//
// The keys are normalized: emails lowercased, phones reduced to digits.
//
// Lifecycle:
//   1. signup step           → only pre-checks (does the key exist and is it
//                              owned by someone else?). The user doc itself is
//                              keyed by emailKey so re-signups overwrite.
//   2. verify step (success) → atomically claims both keys via createDocument.
//                              If another verification raced and won the same
//                              email/phone, this returns 409 and we surface
//                              "already in use".

import {
  createDocument,
  getDocument,
  nowIso,
  type StoredDoc,
} from "@/lib/firestore-rest";

export const EMAIL_INDEX_COLLECTION = "pcp_users_email_index";
export const PHONE_INDEX_COLLECTION = "pcp_users_phone_index";

export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function phoneKey(phone: string): string {
  // Drop a leading US country code so "+1 (555) 123-4567" and "5551234567"
  // resolve to the same uniqueness key.
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export type IndexConflict = {
  field: "email" | "phone";
  ownerUserId: string;
};

/**
 * Returns a conflict if either the email or phone is already claimed by a
 * user other than `selfUserId`. If claimed by `selfUserId`, that's fine
 * (re-signup / resend).
 */
export async function checkUniqueness(opts: {
  email: string;
  phone: string;
  selfUserId: string;
}): Promise<IndexConflict | null> {
  const eKey = emailKey(opts.email);
  const pKey = phoneKey(opts.phone);

  const [emailClaim, phoneClaim] = await Promise.all([
    getDocument(EMAIL_INDEX_COLLECTION, eKey),
    pKey ? getDocument(PHONE_INDEX_COLLECTION, pKey) : Promise.resolve(null),
  ]);

  const emailOwner = (emailClaim?.data.userId as string | undefined) ?? null;
  if (emailOwner && emailOwner !== opts.selfUserId) {
    return { field: "email", ownerUserId: emailOwner };
  }

  const phoneOwner = (phoneClaim?.data.userId as string | undefined) ?? null;
  if (phoneOwner && phoneOwner !== opts.selfUserId) {
    return { field: "phone", ownerUserId: phoneOwner };
  }

  return null;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; field: "email" | "phone"; ownerUserId: string | null };

/**
 * Claim email and phone for the given user. Idempotent: if the key is already
 * claimed by *this* user, treat as success. Returns the first conflict found.
 */
export async function claimUniqueness(opts: {
  userId: string;
  email: string;
  phone: string;
}): Promise<ClaimResult> {
  const eKey = emailKey(opts.email);
  const pKey = phoneKey(opts.phone);

  const emailClaim = await claimOne(EMAIL_INDEX_COLLECTION, eKey, opts.userId);
  if (!emailClaim.ok) return { ok: false, field: "email", ownerUserId: emailClaim.ownerUserId };

  if (!pKey) return { ok: true };

  const phoneClaim = await claimOne(PHONE_INDEX_COLLECTION, pKey, opts.userId);
  if (!phoneClaim.ok) {
    // Roll the email claim back only if we just created it (don't clobber an
    // existing claim from a prior verify of the same user — that's why we
    // only release when the email claim was newly created in this call).
    if (emailClaim.created) {
      try {
        // best-effort cleanup; ignore errors
        const { deleteDocument } = await import("@/lib/firestore-rest");
        await deleteDocument(EMAIL_INDEX_COLLECTION, eKey);
      } catch {
        // swallow — leaves an orphan claim, but at worst that blocks the same
        // user from re-claiming the email, which is recoverable.
      }
    }
    return { ok: false, field: "phone", ownerUserId: phoneClaim.ownerUserId };
  }

  return { ok: true };
}

async function claimOne(
  collection: string,
  key: string,
  userId: string
): Promise<{ ok: true; created: boolean } | { ok: false; ownerUserId: string | null }> {
  try {
    await createDocument(collection, key, {
      userId,
      claimedAt: nowIso(),
    });
    return { ok: true, created: true };
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.status !== 409) throw err;
    // Already claimed — accept iff the owner is us.
    const existing: StoredDoc | null = await getDocument(collection, key);
    const owner = (existing?.data.userId as string | undefined) ?? null;
    if (owner === userId) return { ok: true, created: false };
    return { ok: false, ownerUserId: owner };
  }
}
