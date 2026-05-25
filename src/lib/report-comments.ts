// PCP comments on a GI-shared report. Stored as a subcollection under the
// report so they stay tightly associated and the GI portal can read them per
// report: gi_shared_reports/{reportId}/comments/{commentId}

import { randomBytes } from "crypto";

import { PCP_CASES_COLLECTION } from "@/lib/cases";
import { createDocument, getDocument, listDocuments, nowIso } from "@/lib/firestore-rest";
import { GI_SHARED_REPORTS_COLLECTION } from "@/lib/gi-reports";

export type ReportCommentRole = "pcp" | "gi";

export type ReportComment = {
  id: string;
  reportId: string;
  caseId: string;
  authorUserId: string;
  authorName: string;
  authorRole: ReportCommentRole;
  body: string;
  createdAt: string;
};

const MAX_BODY = 2000;

function commentsPath(reportId: string): string {
  return `${GI_SHARED_REPORTS_COLLECTION}/${reportId}/comments`;
}

function generateId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const ms = Date.now();
  let prefix = "";
  let n = ms;
  for (let i = 0; i < 8; i++) {
    prefix = alphabet[n & 63] + prefix;
    n = Math.floor(n / 64);
  }
  const suffix = randomBytes(9)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 12);
  return (prefix + suffix).slice(0, 20);
}

/**
 * Confirms the report exists and its case is owned by `userId`. Returns the
 * report's `case_id`. Throws an error carrying a `.status` for the API route.
 */
export async function assertReportAccessibleBy(
  reportId: string,
  userId: string
): Promise<{ caseId: string }> {
  const report = await getDocument(GI_SHARED_REPORTS_COLLECTION, reportId);
  if (!report) {
    const err = new Error("Report not found.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 404;
    throw err;
  }
  const caseId = typeof report.data.case_id === "string" ? report.data.case_id : "";
  if (!caseId) {
    const err = new Error("Report is not linked to a case.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 409;
    throw err;
  }
  const caseDoc = await getDocument(PCP_CASES_COLLECTION, caseId);
  if (!caseDoc || caseDoc.data.ownerUserId !== userId) {
    const err = new Error("You do not have access to this report.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 403;
    throw err;
  }
  return { caseId };
}

export async function listReportComments(reportId: string): Promise<ReportComment[]> {
  const page = await listDocuments(commentsPath(reportId), { pageSize: 200 });
  return page.docs
    .filter((d) => !d.id.startsWith("_"))
    .map((d) => ({
      id: d.id,
      reportId,
      caseId: typeof d.data.caseId === "string" ? d.data.caseId : "",
      authorUserId: typeof d.data.authorUserId === "string" ? d.data.authorUserId : "",
      authorName: typeof d.data.authorName === "string" ? d.data.authorName : "Unknown",
      authorRole: (d.data.authorRole === "gi" ? "gi" : "pcp") as ReportCommentRole,
      body: typeof d.data.body === "string" ? d.data.body : "",
      createdAt: typeof d.data.createdAt === "string" ? d.data.createdAt : "",
    }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function addReportComment(input: {
  reportId: string;
  caseId: string;
  authorUserId: string;
  authorName: string;
  body: string;
}): Promise<ReportComment> {
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) {
    const err = new Error("Comment cannot be empty.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 400;
    throw err;
  }
  const id = generateId();
  const createdAt = nowIso();
  const doc = {
    reportId: input.reportId,
    caseId: input.caseId,
    authorUserId: input.authorUserId,
    authorName: input.authorName,
    authorRole: "pcp" as const,
    body,
    createdAt,
  };
  await createDocument(commentsPath(input.reportId), id, doc);
  return { id, ...doc };
}
