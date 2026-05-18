import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { PCP_CASES_COLLECTION, readCaseOwnedBy } from "@/lib/cases";
import { nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const root = await readCaseOwnedBy(caseId, userId);
    if (root.status !== "draft") {
      return NextResponse.json(
        { error: `Case is already ${root.status}; cannot submit.` },
        { status: 409 }
      );
    }
    if (!root.aboutComplete) {
      return NextResponse.json(
        { error: "About details are incomplete." },
        { status: 400 }
      );
    }
    if (!root.healthComplete) {
      return NextResponse.json(
        { error: "Health details are incomplete." },
        { status: 400 }
      );
    }

    const now = nowIso();
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      status: "submitted",
      submittedAt: now,
      statusUpdatedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, status: "submitted", submittedAt: now });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[cases submit] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit case." },
      { status }
    );
  }
}
