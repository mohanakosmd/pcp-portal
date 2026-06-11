import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import {
  clearResetAuthorizedCookie,
  isStrongPassword,
  readResetAuthorizedUserId,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  password?: unknown;
};

// Sets a new password for the account authorized by a verified reset OTP
// (reset-authorized cookie). Consumes the authorization so the link can't be
// replayed.
export async function POST(request: Request) {
  console.log("[reset-password] POST received");

  const userId = await readResetAuthorizedUserId();
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

  const password = typeof body.password === "string" ? body.password : "";
  if (!isStrongPassword(password)) {
    return NextResponse.json(
      {
        error:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      },
      { status: 400 }
    );
  }

  try {
    const existing = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!existing || existing.data.verified !== true) {
      await clearResetAuthorizedCookie();
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = nowIso();
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      passwordHash,
      passwordSetAt: now,
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      updatedAt: now,
    });

    await clearResetAuthorizedCookie();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] error:", err);
    const message = err instanceof Error ? err.message : "Could not reset the password.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
