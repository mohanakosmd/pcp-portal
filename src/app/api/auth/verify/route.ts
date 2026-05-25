import { NextResponse } from "next/server";

import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { SIGNUP_REQUESTS_COLLECTION } from "@/lib/signup-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyBody = {
  userId?: unknown;
  code?: unknown;
};

const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  console.log("[verify] POST received");

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestId = typeof body.userId === "string" ? body.userId.trim() : "";
  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";

  if (!requestId || !submittedCode) {
    return NextResponse.json({ error: "Missing request id or code." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  try {
    const existing = await getDocument(SIGNUP_REQUESTS_COLLECTION, requestId);
    if (!existing) {
      return NextResponse.json(
        { error: "Signup request not found. Please start again." },
        { status: 404 }
      );
    }

    const data = existing.data;

    if (data.status === "approved") {
      return NextResponse.json({
        ok: true,
        status: "approved",
        message: "Your registration is already approved. Please log in.",
      });
    }

    // Already verified — report state. The registration is awaiting admin
    // approval; nothing further for the user to do.
    if (data.emailVerified === true) {
      return NextResponse.json({
        ok: true,
        status: "pending",
        alreadyVerified: true,
      });
    }

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
      await upsertDocument(SIGNUP_REQUESTS_COLLECTION, requestId, {
        otpAttempts: attempts + 1,
        updatedAt: nowIso(),
      });
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    // OTP correct — mark email verified. The request stays "pending" for the
    // admin to review. No pcp_users doc and no session are created here; the
    // external admin portal provisions the account on approval.
    const now = nowIso();
    await upsertDocument(SIGNUP_REQUESTS_COLLECTION, requestId, {
      emailVerified: true,
      emailVerifiedAt: now,
      status: "pending",
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, status: "pending" });
  } catch (err) {
    console.error("[verify] Firestore error:", err);
    const message = err instanceof Error ? err.message : "Failed to talk to Firestore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
