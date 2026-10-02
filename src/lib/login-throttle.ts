// Brute-force protection for password login. Failed attempts are counted per
// email AND per client IP in Firestore (`login_attempts`) so the limit holds
// across all App Hosting instances. Exceeding a limit locks that key out for
// LOCKOUT_MS; a successful login clears the email's counter.
//
// Best-effort by design: counters use read-then-write (no transaction), so a
// burst of parallel requests can slightly overshoot a limit, and a Firestore
// error never blocks a login.

import { createHash } from "node:crypto";

import { getDocument, upsertDocument, deleteDocument } from "@/lib/firestore-rest";

const COLLECTION = "login_attempts";

const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

type Key = { id: string; max: number };

function keyId(kind: "email" | "ip", value: string): string {
  // Hashed so raw emails/IPs aren't used as document ids.
  return `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

function keysFor(email: string, ip: string | null): Key[] {
  const keys: Key[] = [{ id: keyId("email", email), max: MAX_FAILURES_PER_EMAIL }];
  if (ip) keys.push({ id: keyId("ip", ip), max: MAX_FAILURES_PER_IP });
  return keys;
}

/**
 * Client IP as seen by Firebase Hosting (Fastly) → Cloud Run. Prefers the
 * CDN-set `fastly-client-ip`; falls back to the first `x-forwarded-for` hop.
 */
export function clientIp(request: Request): string | null {
  const fastly = request.headers.get("fastly-client-ip")?.trim();
  if (fastly) return fastly;
  const xff = request.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || null;
}

/** Returns seconds until the lockout ends if any key is locked, else null. */
export async function loginLockedFor(email: string, ip: string | null): Promise<number | null> {
  try {
    const now = Date.now();
    const docs = await Promise.all(keysFor(email, ip).map((k) => getDocument(COLLECTION, k.id)));
    let retryMs = 0;
    for (const doc of docs) {
      const lockedUntil = Date.parse(String(doc?.data.lockedUntil ?? ""));
      if (lockedUntil > now) retryMs = Math.max(retryMs, lockedUntil - now);
    }
    return retryMs > 0 ? Math.ceil(retryMs / 1000) : null;
  } catch (err) {
    console.error("[login-throttle] lock check failed:", err);
    return null;
  }
}

/** Counts a failed attempt against the email and IP, locking either if over its limit. */
export async function recordLoginFailure(email: string, ip: string | null): Promise<void> {
  try {
    const now = Date.now();
    await Promise.all(
      keysFor(email, ip).map(async (k) => {
        const doc = await getDocument(COLLECTION, k.id);
        const windowStart = Date.parse(String(doc?.data.windowStart ?? ""));
        const inWindow = windowStart > 0 && now - windowStart < WINDOW_MS;
        const failures = (inWindow ? Number(doc?.data.failures ?? 0) : 0) + 1;
        await upsertDocument(COLLECTION, k.id, {
          failures,
          windowStart: new Date(inWindow ? windowStart : now).toISOString(),
          lockedUntil: failures >= k.max ? new Date(now + LOCKOUT_MS).toISOString() : "",
          updatedAt: new Date(now).toISOString(),
        });
      })
    );
  } catch (err) {
    console.error("[login-throttle] record failure failed:", err);
  }
}

/** Clears the email's counter after a successful password check. The IP counter is kept. */
export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await deleteDocument(COLLECTION, keyId("email", email));
  } catch (err) {
    console.error("[login-throttle] clear failed:", err);
  }
}
