import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";

import { readSessionUserId } from "@/lib/auth";
import { PCP_CASES_COLLECTION, readCaseOwnedBy } from "@/lib/cases";
import { nowIso, upsertDocument } from "@/lib/firestore-rest";
import { emitCaseSubmitted } from "@/lib/notification-events";

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

    void emitCaseSubmitted({
      caseId,
      caseShortCode: root.shortCode,
      ownerUserId: userId,
    }).catch((err) => console.error("[cases submit] emitCaseSubmitted failed:", err));

    // MA staff are notified on share, not on submit — submitting only unlocks
    // sharing. See api/cases/[caseId]/share-ma.

    return NextResponse.json({ ok: true, status: "submitted", submittedAt: now });
  } catch (err) {
    console.error("[cases submit] error:", err);
    return apiErrorResponse(err, "Failed to submit case.");
  }
}
