import { NextResponse } from "next/server";

import {
  generateOtp,
  otpExpiresAt,
  readLoginPendingUserId,
  setLoginPendingCookie,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  console.log("[login/resend] POST received");

  const userId = await readLoginPendingUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Login session expired. Please sign in again." },
      { status: 401 }
    );
  }

  try {
    const user = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!user || user.data.verified !== true) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const code = generateOtp();
    const expiresAt = otpExpiresAt();
    const now = nowIso();

    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      otpCode: code,
      otpExpiresAt: expiresAt.toISOString(),
      otpAttempts: 0,
      updatedAt: now,
    });

    // Refresh the pending cookie so the user gets a fresh 5-minute window.
    await setLoginPendingCookie(userId);

    const email = typeof user.data.email === "string" ? user.data.email : "";
    const fullName = typeof user.data.name === "string" ? user.data.name : "";
    const recipient = email;
    const delivery = await sendSignupOtpEmail({
      recipient,
      intendedFor: email,
      code,
      fullName,
    });

    return NextResponse.json({
      ok: true,
      email,
      routedTo: recipient,
      expiresAt: expiresAt.toISOString(),
      emailDelivered: delivery.delivered,
      emailError: delivery.delivered ? undefined : delivery.reason,
    });
  } catch (err) {
    console.error("[login/resend] error:", err);
    const message = err instanceof Error ? err.message : "Resend failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
