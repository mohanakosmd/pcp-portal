import { NextResponse } from "next/server";

import { setSessionCookie } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";
import { claimUniqueness } from "@/lib/pcp-uniqueness";

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

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";

  if (!userId || !submittedCode) {
    return NextResponse.json({ error: "Missing userId or code." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  try {
    const existing = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!existing) {
      return NextResponse.json(
        { error: "Signup record not found. Please start again." },
        { status: 404 }
      );
    }

    const data = existing.data;
    if (data.verified === true) {
      await setSessionCookie(userId);
      return NextResponse.json({ ok: true, alreadyVerified: true });
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
      await upsertDocument(PCP_USERS_COLLECTION, userId, {
        otpAttempts: attempts + 1,
        updatedAt: nowIso(),
      });
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    // Atomically claim the email + phone uniqueness keys. A racing signup
    // could have claimed them between signup-time pre-check and now.
    const userEmail = typeof data.email === "string" ? data.email : "";
    const userPhone = typeof data.mobile === "string" ? data.mobile : "";
    const claim = await claimUniqueness({ userId, email: userEmail, phone: userPhone });
    if (!claim.ok) {
      const fieldLabel = claim.field === "email" ? "email" : "phone number";
      return NextResponse.json(
        { error: `This ${fieldLabel} was claimed by another account. Please use a different one.` },
        { status: 409 }
      );
    }

    const now = nowIso();
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      verified: true,
      verifiedAt: now,
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      updatedAt: now,
    });

    await setSessionCookie(userId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[verify] Firestore error:", err);
    const message = err instanceof Error ? err.message : "Failed to talk to Firestore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
