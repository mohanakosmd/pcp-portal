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

export type ReportAccess = {
  caseId: string;
  caseShortCode: string;
  /** GI specialist the report is shared with (gi_users doc id), if any. */
  giUserId: string;
  reportName: string;
};

/**
 * Confirms the report exists and its case is owned by `userId`. Returns the
 * report's `case_id` plus the case short code and the GI specialist it's shared
 * with (used to notify them). Throws an error carrying a `.status` for the API
 * route.
 */
export async function assertReportAccessibleBy(
  reportId: string,
  userId: string
): Promise<ReportAccess> {
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
  const caseShortCode =
    typeof caseDoc.data.shortCode === "string" ? caseDoc.data.shortCode : caseId;
  const giUserId =
    typeof report.data.gi_specialist_id === "string" ? report.data.gi_specialist_id : "";
  const reportName =
    typeof report.data.report_name === "string" ? report.data.report_name : "";
  return { caseId, caseShortCode, giUserId, reportName };
}

// Both writers — this PCP portal (addReportComment below) and the external GI
// portal — store comments in this subcollection with the same camelCase shape
// (authorName, authorRole "pcp"|"gi", body, createdAt), so a single reader
// surfaces the whole thread. The report view tags each by authorRole.
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
