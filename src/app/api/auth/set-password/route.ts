import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { readSessionUserId } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument, nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SetPasswordBody = {
  password?: unknown;
};

export async function POST(request: Request) {
  console.log("[set-password] POST received");

  const userId = await readSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated. Verify your code first." }, { status: 401 });
  }

  let body: SetPasswordBody;
  try {
    body = (await request.json()) as SetPasswordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";

  try {
    const existing = await getDocument(PCP_USERS_COLLECTION, userId);
    if (!existing || existing.data.verified !== true) {
      return NextResponse.json({ error: "Account not verified yet." }, { status: 403 });
    }

    if (!password) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = nowIso();
    await upsertDocument(PCP_USERS_COLLECTION, userId, {
      passwordHash,
      passwordSetAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[set-password] Firestore error:", err);
    const message = err instanceof Error ? err.message : "Failed to talk to Firestore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
