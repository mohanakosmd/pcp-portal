import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import {
  generateOtp,
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
  otpExpiresAt,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";
import { checkUniqueness, emailKey } from "@/lib/pcp-uniqueness";
import { PCP_SIGNUP_OTP_COLLECTION } from "@/lib/signup-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_EXISTS_MESSAGE =
  "An account with this email already exists. Please log in instead.";

type SignupBody = {
  name?: unknown;
  email?: unknown;
  mobile?: unknown;
  password?: unknown;
  // Optional NPI-registry provider details selected in step 1 of sign-up.
  npiNumber?: unknown;
  npiCredential?: unknown;
  specialty?: unknown;
  practiceCity?: unknown;
  practiceState?: unknown;
  practicePostalCode?: unknown;
};

function asOptStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const WEAK_PASSWORD_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";

export async function POST(request: Request) {
  console.log("[signup] POST received");

  let body: SignupBody;
  try {
    body = (await request.json()) as SignupBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rawEmail = typeof body.email === "string" ? body.email : "";
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!mobile) return NextResponse.json({ error: "Mobile number is required." }, { status: 400 });
  if (!isStrongPassword(password)) {
    return NextResponse.json({ error: WEAK_PASSWORD_MESSAGE }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail);
  // pcp_users and the staging collection are both keyed by emailKey.
  const userKey = emailKey(email);

  try {
    // 1. A real account already exists for this email? Send them to login.
    const existingUser = await getDocument(PCP_USERS_COLLECTION, userKey);
    if (existingUser && existingUser.data.verified === true) {
      return NextResponse.json({ error: ACCOUNT_EXISTS_MESSAGE }, { status: 409 });
    }

    // 2. Soft pre-check against the uniqueness indexes. The atomic claim happens
    // in the verify route when the pcp_users doc is created; this just catches an
    // email/phone already owned by another account before we send a code.
    const conflict = await checkUniqueness({ email, phone: mobile, selfUserId: userKey });
    if (conflict) {
      const fieldLabel = conflict.field === "email" ? "email" : "phone number";
      return NextResponse.json(
        { error: `This ${fieldLabel} is already in use by another account.` },
        { status: 409 }
      );
    }

    // 3. Stage the attempt with a fresh OTP. Nothing is written to pcp_users
    // yet — that only happens once the code is verified, so unverified attempts
    // never create an account. The password is hashed here so the plaintext is
    // never stored, even in the short-lived staging doc. Re-requesting a code
    // for the same email refreshes this single staged doc.
    const code = generateOtp();
    const expiresAt = otpExpiresAt();
    const now = nowIso();
    const passwordHash = await bcrypt.hash(password, 10);

    await upsertDocument(PCP_SIGNUP_OTP_COLLECTION, userKey, {
      fullName: name,
      email,
      phone: mobile,
      passwordHash,
      otpCode: code,
      otpExpiresAt: expiresAt.toISOString(),
      otpAttempts: 0,
      // NPI-registry details (blank when the provider skipped registry lookup).
      npiNumber: asOptStr(body.npiNumber, 10),
      npiCredential: asOptStr(body.npiCredential, 40),
      specialty: asOptStr(body.specialty, 120),
      practiceCity: asOptStr(body.practiceCity, 80),
      practiceState: asOptStr(body.practiceState, 40),
      practicePostalCode: asOptStr(body.practicePostalCode, 20),
      createdAt: now,
      updatedAt: now,
    });

    const recipient = email;
    const delivery = await sendSignupOtpEmail({
      recipient,
      intendedFor: email,
      code,
      fullName: name,
    });

    return NextResponse.json({
      ok: true,
      userId: userKey,
      requestId: userKey,
      routedTo: recipient,
      expiresAt: expiresAt.toISOString(),
      emailDelivered: delivery.delivered,
      emailError: delivery.delivered ? undefined : delivery.reason,
    });
  } catch (err) {
    console.error("[signup] Firestore error:", err);
    const message = err instanceof Error ? err.message : "Failed to talk to Firestore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
