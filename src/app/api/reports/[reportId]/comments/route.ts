import { NextResponse } from "next/server";

import { readSessionUserId } from "@/lib/auth";
import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument } from "@/lib/firestore-rest";
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[report comments GET] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load comments." },
      { status }
    );
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

    const { caseId } = await assertReportAccessibleBy(reportId, userId);

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
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status ?? 500;
    console.error("[report comments POST] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post comment." },
      { status }
    );
  }
}
