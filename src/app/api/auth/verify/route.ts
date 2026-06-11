import { NextResponse } from "next/server";

import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import {
  addDocument,
  deleteDocument,
  getDocument,
  nowIso,
  queryDocuments,
  upsertDocument,
} from "@/lib/firestore-rest";
import { emailKey } from "@/lib/pcp-uniqueness";
import {
  PCP_PORTAL,
  PCP_SIGNUP_OTP_COLLECTION,
  SIGNUP_REQUESTS_COLLECTION,
} from "@/lib/signup-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyBody = {
  userId?: unknown;
  code?: unknown;
};

const MAX_ATTEMPTS = 5;

const ACCOUNT_EXISTS_MESSAGE =
  "An account with this email already exists. Please log in instead.";

export async function POST(request: Request) {
  console.log("[verify] POST received");

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const stagedId = typeof body.userId === "string" ? body.userId.trim() : "";
  const submittedCode = typeof body.code === "string" ? body.code.trim() : "";

  if (!stagedId || !submittedCode) {
    return NextResponse.json({ error: "Missing request id or code." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  try {
    // The staged attempt holds the OTP and submitted details. It only exists
    // until the email is verified (or the attempt is abandoned).
    const staged = await getDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);
    if (!staged) {
      return NextResponse.json(
        { error: "Signup request not found. Please start again." },
        { status: 404 }
      );
    }

    const data = staged.data;

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
      await upsertDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId, {
        otpAttempts: attempts + 1,
        updatedAt: nowIso(),
      });
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    // OTP correct — materialize the request into the shared collection now.
    const email = typeof data.email === "string" ? data.email : "";
    const fullName = typeof data.fullName === "string" ? data.fullName : "";
    const phone = typeof data.phone === "string" ? data.phone : "";
    const userKey = emailKey(email);
    const now = nowIso();

    // Guard against an account being provisioned while the user was typing.
    const existingUser = await getDocument(PCP_USERS_COLLECTION, userKey);
    if (existingUser) {
      await deleteDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);
      return NextResponse.json({ error: ACCOUNT_EXISTS_MESSAGE }, { status: 409 });
    }

    // Reuse an existing PCP request for this email if one is present.
    const sameEmail = await queryDocuments(
      SIGNUP_REQUESTS_COLLECTION,
      [{ field: "email", value: email }],
      { limit: 10 }
    );
    const existingRequest = sameEmail.find((d) => d.data.portal === PCP_PORTAL) ?? null;

    if (existingRequest && existingRequest.data.status === "approved") {
      await deleteDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);
      return NextResponse.json({
        ok: true,
        status: "approved",
        message: "Your registration is already approved. Please log in.",
      });
    }

    if (existingRequest) {
      // Pending request already in the queue — refresh its details and confirm
      // the email is (still) verified. Preserves created_at and the doc id.
      await upsertDocument(SIGNUP_REQUESTS_COLLECTION, existingRequest.id, {
        fullName,
        phone,
        status: "pending",
        emailVerified: true,
        emailVerifiedAt: now,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        updatedAt: now,
      });
    } else {
      // First time this email reaches the queue — create the canonical record.
      // It enters already email-verified; the admin reviews and approves it.
      await addDocument(SIGNUP_REQUESTS_COLLECTION, {
        // Canonical fields shared with the GI portal:
        fullName,
        email,
        phone,
        portal: PCP_PORTAL,
        status: "pending",
        created_at: now,
        // PCP-specific machinery (no password is captured here):
        type: "pcp_user",
        emailVerified: true,
        emailVerifiedAt: now,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        updatedAt: now,
      });
    }

    // Drop the staged attempt now that the request is in the collection.
    await deleteDocument(PCP_SIGNUP_OTP_COLLECTION, stagedId);

    return NextResponse.json({ ok: true, status: "pending" });
  } catch (err) {
    console.error("[verify] Firestore error:", err);
    const message = err instanceof Error ? err.message : "Failed to talk to Firestore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
