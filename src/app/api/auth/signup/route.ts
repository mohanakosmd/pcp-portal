import { NextResponse } from "next/server";

import { generateOtp, isValidEmail, normalizeEmail, otpExpiresAt } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";
import { checkUniqueness, emailKey } from "@/lib/pcp-uniqueness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const userId = emailKey(email);

  try {
    console.log("[signup] looking up existing user", { userId });
    const existing = await getDocument(PCP_USERS_COLLECTION, userId);
    if (existing && existing.data.verified === true) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please log in instead." },
        { status: 409 }
      );
    }

    console.log("[signup] checking uniqueness of email/phone");
    const conflict = await checkUniqueness({ email, phone: mobile, selfUserId: userId });
    if (conflict) {
      const fieldLabel = conflict.field === "email" ? "email" : "phone number";
      return NextResponse.json(
        { error: `This ${fieldLabel} is already in use by another account.` },
        { status: 409 }
      );
    }

    const code = generateOtp();
    const expiresAt = otpExpiresAt();
    const now = nowIso();
    const createdAt =
      (existing?.data.createdAt as string | undefined) ?? now;

    console.log("[signup] writing user", { userId });
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      name,
      email,
      mobile,
      otpCode: code,
      otpExpiresAt: expiresAt.toISOString(),
      otpAttempts: 0,
      verified: false,
      createdAt,
      updatedAt: now,
    });

    const recipient = process.env.SIGNUP_OTP_RECIPIENT?.trim() || email;
    const delivery = await sendSignupOtpEmail({
      recipient,
      intendedFor: email,
      code,
      fullName: name,
    });

    return NextResponse.json({
      ok: true,
      userId,
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
