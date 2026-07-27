import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { PCP_CASES_COLLECTION, readCaseOwnedBy } from "@/lib/cases";
import { nowIso, upsertDocument } from "@/lib/firestore-rest";
import { emitCaseSharedWithMa } from "@/lib/notification-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shares a submitted case with a Medical Assistant (MA). Unlike the GI share,
// this doesn't route to a specific person — MA staff (admin_users with role
// "ma") pick these up. Sharing sets a flag that locks the case from editing.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const root = await readCaseOwnedBy(caseId, userId);

    if (root.sharedWithMa === true) {
      return NextResponse.json(
        { error: "This case has already been shared with MA." },
        { status: 409 }
      );
    }

    if (root.status !== "submitted") {
      return NextResponse.json(
        {
          error:
            root.status === "draft"
              ? "Submit the case before sharing with MA."
              : `Only submitted cases can be shared (current status: ${root.status}).`,
        },
        { status: 409 }
      );
    }

    const now = nowIso();
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      sharedWithMa: true,
      sharedWithMaAt: now,
      statusUpdatedAt: now,
      updatedAt: now,
    });

    void emitCaseSharedWithMa({
      caseId,
      caseShortCode: root.shortCode || caseId,
      ownerUserId: userId,
    }).catch((err) => console.error("[cases share-ma] emitCaseSharedWithMa failed:", err));

    return NextResponse.json({ ok: true, sharedWithMa: true, sharedWithMaAt: now });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[cases share-ma] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to share case with MA." },
      { status }
    );
  }
}
