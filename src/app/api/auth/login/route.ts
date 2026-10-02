import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import bcrypt from "bcryptjs";

import {
  generateOtp,
  isValidEmail,
  normalizeEmail,
  otpExpiresAt,
  setLoginPendingCookie,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";
import { emailKey } from "@/lib/pcp-uniqueness";
import {
  clearLoginFailures,
  clientIp,
  loginLockedFor,
  recordLoginFailure,
} from "@/lib/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

const GENERIC_INVALID = "Invalid email or password.";

export async function POST(request: Request) {
  console.log("[login] POST received");

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawEmail = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail);
  const userId = emailKey(email);
  const ip = clientIp(request);

  const retryAfter = await loginLockedFor(email, ip);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "Too many failed login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    const existing = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!existing || existing.data.verified !== true) {
      // No account, or signup never completed. Return generic message so we
      // don't leak account existence. Counted like a wrong password so the
      // throttle behaves the same either way.
      await recordLoginFailure(email, ip);
      return NextResponse.json({ error: GENERIC_INVALID }, { status: 401 });
    }

    const hash = typeof existing.data.passwordHash === "string" ? existing.data.passwordHash : "";
    if (!hash) {
      return NextResponse.json(
        { error: "Password not set for this account. Use 'Forgot password' to set one." },
        { status: 401 }
      );
    }

    const matches = await bcrypt.compare(password, hash);
    if (!matches) {
      await recordLoginFailure(email, ip);
      return NextResponse.json({ error: GENERIC_INVALID }, { status: 401 });
    }
    await clearLoginFailures(email);

    const code = generateOtp();
    const expiresAt = otpExpiresAt();
    const now = nowIso();

    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      otpCode: code,
      otpExpiresAt: expiresAt.toISOString(),
      otpAttempts: 0,
      updatedAt: now,
    });

    await setLoginPendingCookie(userId);

    const fullName = typeof existing.data.name === "string" ? existing.data.name : "";
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
      emailError: delivery.delivered ? undefined : "We couldn't send the email. Please try again.",
    });
  } catch (err) {
    console.error("[login] error:", err);
    return apiErrorResponse(err, "Login failed.");
  }
}
