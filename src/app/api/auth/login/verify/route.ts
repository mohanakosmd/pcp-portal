import { NextResponse } from "next/server";

import {
  clearLoginPendingCookie,
  readLoginPendingUserId,
  setSessionCookie,
} from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyBody = {
  code?: unknown;
};

const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  console.log("[login/verify] POST received");

  const userId = await readLoginPendingUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Login session expired. Please sign in again." },
      { status: 401 }
    );
  }

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
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
      await clearLoginPendingCookie();
      return NextResponse.json(
        { error: "Account not found. Please sign in again." },
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

    const expiresAtRaw = typeof user.data.otpExpiresAt === "string" ? user.data.otpExpiresAt : null;
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
      lastLoginAt: now,
      updatedAt: now,
    });

    await clearLoginPendingCookie();
    await setSessionCookie(userId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[login/verify] error:", err);
    const message = err instanceof Error ? err.message : "Verification failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
