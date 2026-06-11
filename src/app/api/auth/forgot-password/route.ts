import { NextResponse } from "next/server";

import {
  generateOtp,
  isValidEmail,
  normalizeEmail,
  otpExpiresAt,
  setResetPendingCookie,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";
import { emailKey } from "@/lib/pcp-uniqueness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  email?: unknown;
};

// Sends (or resends) a password-reset OTP to the address that owns the account.
// The code always goes to the user's own registered email — never a predefined
// address.
export async function POST(request: Request) {
  console.log("[forgot-password] POST received");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawEmail = typeof body.email === "string" ? body.email : "";
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail);
  const userId = emailKey(email);

  try {
    const existing = await getDocument(PCP_USERS_COLLECTION, userId);

    // Only send to a real, verified account. To avoid revealing whether an
    // account exists, we always respond ok — the verify step simply fails for
    // addresses that never received a pending reset.
    if (existing && existing.data.verified === true) {
      const code = generateOtp();
      const expiresAt = otpExpiresAt();
      const now = nowIso();

      await upsertDocument(PCP_USERS_COLLECTION, userId, {
        otpCode: code,
        otpExpiresAt: expiresAt.toISOString(),
        otpAttempts: 0,
        updatedAt: now,
      });

      await setResetPendingCookie(userId);

      const fullName = typeof existing.data.name === "string" ? existing.data.name : "";
      await sendSignupOtpEmail({
        recipient: email,
        intendedFor: email,
        code,
        fullName,
        purpose: "reset",
      });
    }

    return NextResponse.json({ ok: true, email });
  } catch (err) {
    console.error("[forgot-password] error:", err);
    const message = err instanceof Error ? err.message : "Could not send the reset code.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
