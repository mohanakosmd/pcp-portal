// One-off diagnostic: tries to read + write a probe doc in pcp_users using
// the exact same Firebase client SDK config as the API routes.
//
// Run with: node scripts/check-firestore.mjs

import { config } from "dotenv";
import { initializeApp } from "firebase/app";
import {
  collection,
  getDocs,
  initializeFirestore,
  serverTimestamp,
  setDoc,
  doc,
} from "firebase/firestore";

// Load .env.local explicitly (Next handles this automatically; we don't).
config({ path: ".env.local" });

const required = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  console.error("Hint: this script must be run from the project root so .env.local is found.");
  process.exit(1);
}

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});

const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const TIMEOUT_MS = 12000;
const withTimeout = (p, label) =>
  Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    ),
  ]);

async function main() {
  console.log("Project:", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  console.log("Step 1: reading pcp_users (existing documents)...");
  const usersCol = collection(db, "pcp_users");
  const snap = await withTimeout(getDocs(usersCol), "Read pcp_users");
  console.log(`  → found ${snap.size} document(s).`);
  snap.forEach((d) => console.log(`    - ${d.id}`));

  console.log("Step 2: writing probe doc pcp_users/_probe ...");
  const probeRef = doc(db, "pcp_users", "_probe");
  await withTimeout(
    setDoc(
      probeRef,
      {
        probe: true,
        wroteAt: serverTimestamp(),
        note: "Diagnostic write from scripts/check-firestore.mjs",
      },
      { merge: true }
    ),
    "Write pcp_users/_probe"
  );
  console.log("  → write OK");

  console.log("\nSUCCESS — Firestore is reachable and accepts writes to pcp_users.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFAILURE:", err?.message || err);
  if (err?.code) console.error("  code:", err.code);
  process.exit(1);
});
