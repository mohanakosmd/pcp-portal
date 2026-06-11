import { NextResponse } from "next/server";

import {
  clearResetPendingCookie,
  readResetPendingUserId,
  setResetAuthorizedCookie,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  code?: unknown;
};

const MAX_ATTEMPTS = 5;

// Verifies the reset OTP for the account named by the reset-pending cookie.
// On success it does NOT log the user in — it authorizes a one-shot password
// reset via the reset-authorized cookie.
export async function POST(request: Request) {
  console.log("[forgot-password/verify] POST received");

  const userId = await readResetPendingUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Reset session expired. Start again from Forgot password." },
      { status: 401 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  try {
    const user = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!user || user.data.verified !== true) {
      await clearResetPendingCookie();
      return NextResponse.json(
        { error: "Account not found. Start again from Forgot password." },
        { status: 404 }
      );
    }

    const attempts = typeof user.data.otpAttempts === "number" ? user.data.otpAttempts : 0;
    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many attempts. Request a new code." },
        { status: 429 }
      );
    }

    const expiresAtRaw =
      typeof user.data.otpExpiresAt === "string" ? user.data.otpExpiresAt : null;
    if (!expiresAtRaw || Date.now() > new Date(expiresAtRaw).getTime()) {
      return NextResponse.json({ error: "Code expired. Request a new one." }, { status: 410 });
    }

    if (user.data.otpCode !== submittedCode) {
      await upsertDocument(PCP_USERS_COLLECTION, userId, {
        otpAttempts: attempts + 1,
        updatedAt: nowIso(),
      });
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    const now = nowIso();
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      updatedAt: now,
    });

    await clearResetPendingCookie();
    await setResetAuthorizedCookie(userId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[forgot-password/verify] error:", err);
    const message = err instanceof Error ? err.message : "Verification failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
