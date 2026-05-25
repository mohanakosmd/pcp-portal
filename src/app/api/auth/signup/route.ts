import { NextResponse } from "next/server";

import { generateOtp, isValidEmail, normalizeEmail, otpExpiresAt } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import {
  addDocument,
  getDocument,
  nowIso,
  queryDocuments,
  upsertDocument,
} from "@/lib/firestore-rest";
import { sendSignupOtpEmail } from "@/lib/otp-email";
import { checkUniqueness, emailKey } from "@/lib/pcp-uniqueness";
import { PCP_PORTAL, SIGNUP_REQUESTS_COLLECTION } from "@/lib/signup-requests";

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
  // pcp_users is keyed by emailKey; signup_requests now uses auto-generated ids.
  const userKey = emailKey(email);

  try {
    // Already a real, verified account? Send them to login.
    const existingUser = await getDocument(PCP_USERS_COLLECTION, userKey);
    if (existingUser && existingUser.data.verified === true) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please log in instead." },
        { status: 409 }
      );
    }

    // Reuse an in-flight PCP signup request for this email if one exists, so
    // re-requesting a code refreshes the same record instead of piling up
    // duplicate auto-id docs. The collection is shared with the GI portal, so
    // filter by portal === "pcp" (querying on email keeps it to one filter and
    // avoids needing a composite index).
    const sameEmail = await queryDocuments(
      SIGNUP_REQUESTS_COLLECTION,
      [{ field: "email", value: email }],
      { limit: 10 }
    );
    const existingRequest = sameEmail.find((d) => d.data.portal === PCP_PORTAL) ?? null;

    // Already approved request whose user is being provisioned?
    if (existingRequest && existingRequest.data.status === "approved") {
      return NextResponse.json(
        { error: "This registration was already approved. Please log in." },
        { status: 409 }
      );
    }

    // Soft pre-check (the atomic claim happens when the admin creates the user).
    const conflict = await checkUniqueness({ email, phone: mobile, selfUserId: userKey });
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

    let requestId: string;
    if (existingRequest) {
      // Refresh the OTP on the existing record; preserve created_at, identity,
      // verification state and any password hash already captured.
      requestId = existingRequest.id;
      await upsertDocument(SIGNUP_REQUESTS_COLLECTION, requestId, {
        fullName: name,
        phone: mobile,
        otpCode: code,
        otpExpiresAt: expiresAt.toISOString(),
        otpAttempts: 0,
        updatedAt: now,
      });
    } else {
      // New request — let Firestore generate the document id (GI format).
      const created = await addDocument(SIGNUP_REQUESTS_COLLECTION, {
        // Canonical fields shared with the GI portal:
        fullName: name,
        email,
        phone: mobile,
        portal: PCP_PORTAL,
        status: "pending",
        created_at: now,
        // PCP-specific OTP machinery (no password is captured here):
        type: "pcp_user",
        emailVerified: false,
        emailVerifiedAt: null,
        otpCode: code,
        otpExpiresAt: expiresAt.toISOString(),
        otpAttempts: 0,
        updatedAt: now,
      });
      requestId = created.id;
    }

    const recipient = process.env.SIGNUP_OTP_RECIPIENT?.trim() || email;
    const delivery = await sendSignupOtpEmail({
      recipient,
      intendedFor: email,
      code,
      fullName: name,
    });

    return NextResponse.json({
      ok: true,
      userId: requestId,
      requestId,
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
