import { NextResponse } from "next/server";

import { generateOtp, isValidEmail, normalizeEmail, otpExpiresAt } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import {
  getDocument,
  nowIso,
  queryDocuments,
  upsertDocument,
} from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";
import { checkUniqueness, emailKey } from "@/lib/pcp-uniqueness";
import {
  PCP_PORTAL,
  PCP_SIGNUP_OTP_COLLECTION,
  SIGNUP_REQUESTS_COLLECTION,
} from "@/lib/signup-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCOUNT_EXISTS_MESSAGE =
  "An account with this email already exists. Please log in instead.";

type SignupBody = {
  name?: unknown;
  email?: unknown;
  mobile?: unknown;
};

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

  if (!name) return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!mobile) return NextResponse.json({ error: "Mobile number is required." }, { status: 400 });

  const email = normalizeEmail(rawEmail);
  // pcp_users and the staging collection are both keyed by emailKey.
  const userKey = emailKey(email);

  try {
    // 1. A real account already exists for this email? Send them to login.
    const existingUser = await getDocument(PCP_USERS_COLLECTION, userKey);
    if (existingUser) {
      return NextResponse.json({ error: ACCOUNT_EXISTS_MESSAGE }, { status: 409 });
    }

    // 2. An existing request in the shared collection? The collection is shared
    // with the GI portal, so filter by portal === "pcp" (querying on email
    // keeps it to a single filter and avoids a composite index).
    const sameEmail = await queryDocuments(
      SIGNUP_REQUESTS_COLLECTION,
      [{ field: "email", value: email }],
      { limit: 10 }
    );
    const existingRequest = sameEmail.find((d) => d.data.portal === PCP_PORTAL) ?? null;

    // An already-approved request means the account exists (or is being
    // provisioned) — treat as "already exists".
    if (existingRequest && existingRequest.data.status === "approved") {
      return NextResponse.json({ error: ACCOUNT_EXISTS_MESSAGE }, { status: 409 });
    }
    // A *pending* request is allowed to proceed: re-verifying the OTP will
    // refresh its details (handled in the verify route).

    // 3. Soft pre-check against the uniqueness indexes (the atomic claim happens
    // when the admin provisions the user). Catches an email/phone already owned
    // by another provisioned account.
    const conflict = await checkUniqueness({ email, phone: mobile, selfUserId: userKey });
    if (conflict) {
      const fieldLabel = conflict.field === "email" ? "email" : "phone number";
      return NextResponse.json(
        { error: `This ${fieldLabel} is already in use by another account.` },
        { status: 409 }
      );
    }

    // 4. Stage the attempt with a fresh OTP. Nothing is written to
    // signup_requests yet — that only happens once the code is verified, so
    // unverified attempts never reach the admin queue. Re-requesting a code for
    // the same email refreshes this single staged doc.
    const code = generateOtp();
    const expiresAt = otpExpiresAt();
    const now = nowIso();

    await upsertDocument(PCP_SIGNUP_OTP_COLLECTION, userKey, {
      fullName: name,
      email,
      phone: mobile,
      otpCode: code,
      otpExpiresAt: expiresAt.toISOString(),
      otpAttempts: 0,
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
