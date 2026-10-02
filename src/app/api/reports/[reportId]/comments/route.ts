import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";

import { readSessionUserId } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument } from "@/lib/firestore-rest";
import { emitReportRemarkAdded } from "@/lib/notification-events";
import {
  addReportComment,
  assertReportAccessibleBy,
  listReportComments,
} from "@/lib/report-comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    await assertReportAccessibleBy(reportId, userId);
    const comments = await listReportComments(reportId);
    return NextResponse.json({ comments });
  } catch (err) {
    console.error("[report comments GET] error:", err);
    return apiErrorResponse(err, "Failed to load comments.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await params;
  const userId = await readSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as { body?: unknown };
    const text = typeof body.body === "string" ? body.body : "";

    const { caseId, caseShortCode, giUserId, reportName } =
      await assertReportAccessibleBy(reportId, userId);

    const userDoc = await getDocument(PCP_USERS_COLLECTION, userId);
    const authorName =
      (typeof userDoc?.data.name === "string" && userDoc.data.name.trim()) ||
      (typeof userDoc?.data.email === "string" && userDoc.data.email.split("@")[0]) ||
      "PCP user";

    const comment = await addReportComment({
      reportId,
      caseId,
      authorUserId: userId,
      authorName,
      body: text,
    });

    // Notify the GI specialist the report is shared with (in-app + email).
    // Best-effort: a notification failure must not fail the remark submission.
    try {
      await emitReportRemarkAdded({
        caseId,
        caseShortCode,
        reportName,
        giUserId,
        pcpName: authorName,
        remarkBody: comment.body,
      });
    } catch (err) {
      console.error("[report comments POST] GI notify failed:", err);
    }

    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    console.error("[report comments POST] error:", err);
    return apiErrorResponse(err, "Failed to post comment.");
  }
}
