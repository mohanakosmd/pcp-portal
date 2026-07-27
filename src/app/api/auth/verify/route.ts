import { NextResponse } from "next/server";

import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import {
  deleteDocument,
  getDocument,
  nowIso,
  upsertDocument,
} from "@/lib/firestore-rest";
import { claimUniqueness, emailKey } from "@/lib/pcp-uniqueness";
import { PCP_SIGNUP_OTP_COLLECTION } from "@/lib/signup-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyBody = {
  userId?: unknown;
  code?: unknown;
};

const MAX_ATTEMPTS = 5;

const ACCOUNT_EXISTS_MESSAGE =
  "An account with this email already exists. Please log in instead.";

export async function POST(request: Request) {
  console.log("[verify] POST received");

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const stagedId = typeof body.userId === "string" ? body.userId.trim() : "";
  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";

  if (!stagedId || !submittedCode) {
    return NextResponse.json({ error: "Missing request id or code." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  try {
    // The staged attempt holds the OTP and submitted details. It only exists
    // until the email is verified (or the attempt is abandoned).
    const staged = await getDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);
    if (!staged) {
      return NextResponse.json(
        { error: "Signup request not found. Please start again." },
        { status: 404 }
      );
    }

    const data = staged.data;

    const attempts = typeof data.otpAttempts === "number" ? data.otpAttempts : 0;
    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many attempts. Request a new code." },
        { status: 429 }
      );
    }

    const expiresAtRaw = typeof data.otpExpiresAt === "string" ? data.otpExpiresAt : null;
    if (!expiresAtRaw || Date.now() > new Date(expiresAtRaw).getTime()) {
      return NextResponse.json({ error: "Code expired. Request a new one." }, { status: 410 });
    }

    if (data.otpCode !== submittedCode) {
      await upsertDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId, {
        otpAttempts: attempts + 1,
        updatedAt: nowIso(),
      });
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    // OTP correct — create the pcp_users record directly. There is no admin
    // approval step: once the email is verified the provider becomes a real,
    // login-ready pcp_users account.
    const email = typeof data.email === "string" ? data.email : "";
    const fullName = typeof data.fullName === "string" ? data.fullName : "";
    const phone = typeof data.phone === "string" ? data.phone : "";
    const passwordHash = typeof data.passwordHash === "string" ? data.passwordHash : "";
    // NPI-registry details captured at sign-up (blank if none was selected).
    const asStagedStr = (v: unknown): string => (typeof v === "string" ? v : "");
    const npiNumber = asStagedStr(data.npiNumber);
    const npiCredential = asStagedStr(data.npiCredential);
    const specialty = asStagedStr(data.specialty);
    const practiceCity = asStagedStr(data.practiceCity);
    const practiceState = asStagedStr(data.practiceState);
    const practicePostalCode = asStagedStr(data.practicePostalCode);
    const userKey = emailKey(email);
    const now = nowIso();

    // Guard against a verified account already existing (e.g. a concurrent
    // verify of the same email).
    const existingUser = await getDocument(PCP_USERS_COLLECTION, userKey);
    if (existingUser && existingUser.data.verified === true) {
      await deleteDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);
      return NextResponse.json({ error: ACCOUNT_EXISTS_MESSAGE }, { status: 409 });
    }

    // Atomically claim the email + phone uniqueness before writing the user so a
    // racing signup can't end up owning the same email/phone.
    const claim = await claimUniqueness({ userId: userKey, email, phone });
    if (!claim.ok) {
      const fieldLabel = claim.field === "email" ? "email" : "phone number";
      return NextResponse.json(
        { error: `This ${fieldLabel} is already in use by another account.` },
        { status: 409 }
      );
    }

    // Write the pcp_users doc, keyed by emailKey to match the login/index
    // lookups. It enters verified with the password captured at signup, so the
    // provider can log in immediately.
    await upsertDocument(PCP_USERS_COLLECTION, userKey, {
      name: fullName,
      email,
      mobile: phone,
      verified: true,
      verifiedAt: now,
      passwordHash,
      passwordSetAt: now,
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      // Provider details from the NPI registry, surfaced on the profile page.
      npiNumber,
      npiCredential,
      specialty,
      practiceCity,
      practiceState,
      practicePostalCode,
      createdAt: now,
      updatedAt: now,
    });

    // Drop the staged attempt now that the account exists.
    await deleteDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);

    return NextResponse.json({ ok: true, status: "active" });
  } catch (err) {
    console.error("[verify] Firestore error:", err);
    const message = err instanceof Error ? err.message : "Failed to talk to Firestore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
