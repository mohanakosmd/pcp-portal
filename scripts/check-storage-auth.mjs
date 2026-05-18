// Probes whether we can fix the Storage 403 from code alone:
//   1. Create an anonymous Firebase Auth user → get an ID token.
//   2. Retry the Storage upload WITH that token (Authorization: Firebase <t>).
//
// Outcomes:
//   - Upload succeeds  → Storage rules allow `request.auth != null`; we can
//                        wire anon-auth into storage-rest.ts (code-only fix).
//   - signUp 400       → Anonymous auth is DISABLED in the project; must be
//                        enabled in the Console (Auth → Sign-in method).
//   - Upload still 403 → Storage rules are stricter than `request.auth != null`
//                        (e.g. `if false`); only a Console rules change fixes it.
//
// Run from project root: node scripts/check-storage-auth.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!API_KEY || !BUCKET) {
  console.error("Missing NEXT_PUBLIC_FIREBASE_API_KEY / _STORAGE_BUCKET in .env.local");
  process.exit(1);
}

console.log("Step 1: anonymous sign-up via Identity Toolkit");
const signUp = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  }
);
const signUpBody = await signUp.json();
if (!signUp.ok) {
  console.error(`  ✗ signUp failed (${signUp.status}):`, JSON.stringify(signUpBody));
  const msg = signUpBody?.error?.message || "";
  if (msg.includes("ADMIN_ONLY_OPERATION") || msg.includes("OPERATION_NOT_ALLOWED")) {
    console.error(
      "\n  → Anonymous auth is DISABLED. Enable it: Firebase Console →\n" +
        "    Authentication → Sign-in method → Anonymous → Enable.\n" +
        "    (Or just publish the Storage rules from storage.rules instead.)"
    );
  }
  process.exit(1);
}
const idToken = signUpBody.idToken;
console.log(`  ✓ got idToken (uid ${signUpBody.localId})`);

console.log("Step 2: upload a probe file WITH the auth token");
const probePath = `pcp_cases/_probe/auth-check-${Date.now()}.txt`;
const encoded = encodeURIComponent(probePath);
const up = await fetch(
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Firebase ${idToken}`,
    },
    body: Buffer.from("authed storage check\n"),
  }
);

if (up.ok) {
  console.log("  ✓ upload SUCCEEDED with anon auth token");
  // clean up
  await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}`, {
    method: "DELETE",
    headers: { Authorization: `Firebase ${idToken}` },
  });
  console.log(
    "\nSUCCESS — code-only fix is viable. I can wire anonymous auth into\n" +
      "src/lib/storage-rest.ts so uploads carry a token."
  );
} else {
  const text = await up.text();
  console.error(`  ✗ upload still failed (${up.status}): ${text}`);
  console.error(
    "\n  → Storage rules are stricter than `request.auth != null`.\n" +
      "    The only fix is publishing storage.rules in the Firebase Console."
  );
  process.exit(1);
}
