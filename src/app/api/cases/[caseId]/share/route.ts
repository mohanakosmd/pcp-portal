import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { PCP_CASES_COLLECTION, readCaseOwnedBy } from "@/lib/cases";
import { nowIso, upsertDocument } from "@/lib/firestore-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as { giUser?: unknown };
    const giUser =
      typeof body.giUser === "string" && body.giUser.trim() ? body.giUser.trim() : "";
    if (!giUser) {
      return NextResponse.json(
        { error: "A GI specialist must be selected." },
        { status: 400 }
      );
    }

    const root = await readCaseOwnedBy(caseId, userId);
    if (root.status !== "submitted") {
      return NextResponse.json(
        { error: `Only submitted cases can be shared (current status: ${root.status}).` },
        { status: 409 }
      );
    }

    const now = nowIso();
    await upsertDocument(PCP_CASES_COLLECTION, caseId, {
      status: "under_review",
      sharedWithGiUser: giUser,
      sharedWithGiAt: now,
      statusUpdatedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      ok: true,
      status: "under_review",
      sharedWithGiUser: giUser,
      sharedWithGiAt: now,
    });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[cases share] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to share case." },
      { status }
    );
  }
}
