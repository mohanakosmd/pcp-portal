// Second probe: can we get past the Storage 403 using an email/password
// Firebase Auth identity (the AIGI app uses email/password auth, so it's
// likely enabled on this project)?
//
//   1. Try to sign up a throwaway email/password user → get an ID token.
//      (If that account exists from a prior run, sign in instead.)
//   2. Retry the Storage upload WITH that token.
//
// Run from project root: node scripts/check-storage-auth2.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!API_KEY || !BUCKET) {
  console.error("Missing config in .env.local");
  process.exit(1);
}

const EMAIL = "pcp-portal-storage-bot@example.com";
const PASSWORD = "Pcp-Portal-Storage-Bot-9f3a2b1c";

async function idToolkit(method, payload) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return { ok: r.ok, status: r.status, body: await r.json() };
}

console.log("Step 1: get an email/password ID token");
let res = await idToolkit("signUp", {
  email: EMAIL,
  password: PASSWORD,
  returnSecureToken: true,
});
if (!res.ok && res.body?.error?.message === "EMAIL_EXISTS") {
  console.log("  (account exists — signing in instead)");
  res = await idToolkit("signInWithPassword", {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
  });
}
if (!res.ok) {
  console.error(`  ✗ auth failed (${res.status}):`, JSON.stringify(res.body));
  const msg = res.body?.error?.message || "";
  if (msg.includes("OPERATION_NOT_ALLOWED") || msg.includes("ADMIN_ONLY")) {
    console.error(
      "\n  → Email/password auth is also disabled. No code-only auth path\n" +
        "    is available — the Storage rules must be published from the\n" +
        "    Firebase Console (storage.rules)."
    );
  }
  process.exit(1);
}
const idToken = res.body.idToken;
console.log(`  ✓ got idToken (uid ${res.body.localId})`);

console.log("Step 2: upload probe WITH the token");
const probePath = `pcp_cases/_probe/auth2-check-${Date.now()}.txt`;
const encoded = encodeURIComponent(probePath);
const up = await fetch(
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Firebase ${idToken}`,
    },
    body: Buffer.from("authed storage check 2\n"),
  }
);

if (up.ok) {
  await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}`, {
    method: "DELETE",
    headers: { Authorization: `Firebase ${idToken}` },
  });
  console.log("  ✓ upload SUCCEEDED with email/password auth token");
  console.log(
    "\nSUCCESS — code-only fix is viable. I'll wire a server-side Firebase\n" +
      "Auth identity into storage-rest.ts so uploads carry a token."
  );
} else {
  console.error(`  ✗ upload still 403/failed (${up.status}): ${await up.text()}`);
  console.error(
    "\n  → Even an authenticated request is rejected, so the Storage rules\n" +
      "    are `if false` (or stricter). Only publishing storage.rules in\n" +
      "    the Firebase Console will fix this."
  );
  process.exit(1);
}
