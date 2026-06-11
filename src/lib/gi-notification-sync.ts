// Surfaces GI-portal events as in-app notifications for the PCP. The final
// report (gi_shared_reports) and GI remarks (its comments subcollection) are
// written by the external GI portal, so this PCP app has no trigger when they
// happen. Instead we reconcile on read: whenever the PCP's notification feed is
// fetched, scan their reports/remarks and create any missing notifications.
//
// Idempotency: each event maps to a deterministic notification id
// (gi-rpt-<reportId>, gi-rmk-<commentId>), created with createDocument so a
// repeat sync is a no-op (409). A recent-events window keeps the first sync
// from flooding the bell with the entire history.
//
// In-app only — no email is sent here.

import { PCP_CASES_COLLECTION } from "@/lib/cases";
import { createDocument, listDocuments } from "@/lib/firestore-rest";
import { GI_SHARED_REPORTS_COLLECTION } from "@/lib/gi-reports";
import {
  NOTIFICATIONS_COLLECTION,
  type NotificationDoc,
  type NotificationType,
} from "@/lib/notifications";

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // ~2 weeks

function withinWindow(iso: string, now: number): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return now - t <= RECENT_WINDOW_MS && t <= now + 60_000;
}

async function ensureNotification(
  id: string,
  type: NotificationType,
  opts: {
    userId: string;
    caseId: string;
    caseShortCode: string;
    title: string;
    body: string;
    createdAt: string;
  }
): Promise<void> {
  const doc: NotificationDoc = {
    recipientUserId: opts.userId,
    recipientType: "pcp",
    type,
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title: opts.title,
    body: opts.body,
    read: false,
    // Use the event time so the feed orders correctly and "x ago" is accurate.
    createdAt: opts.createdAt,
    readAt: null,
  };
  try {
    await createDocument(NOTIFICATIONS_COLLECTION, id, doc);
  } catch (err) {
    // 409 = a notification for this event already exists; nothing to do.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.status !== 409) {
      console.error(`[gi-notify-sync] ensure ${id} failed:`, err);
    }
  }
}

/**
 * Best-effort: create in-app notifications for recently shared reports and GI
 * remarks on the cases owned by `userId`. Safe to call on every notifications
 * fetch — it only writes the first time it sees each event.
 */
export async function syncGiNotificationsFor(userId: string): Promise<void> {
  const now = Date.now();

  const [casesPage, reportsPage] = await Promise.all([
    listDocuments(PCP_CASES_COLLECTION, { pageSize: 500 }),
    listDocuments(GI_SHARED_REPORTS_COLLECTION, { pageSize: 500 }),
  ]);

  // caseId → shortCode for cases this user owns.
  const owned = new Map<string, string>();
  for (const c of casesPage.docs) {
    if (c.id.startsWith("_")) continue;
    if (c.data.ownerUserId !== userId) continue;
    owned.set(c.id, typeof c.data.shortCode === "string" ? c.data.shortCode : c.id);
  }
  if (owned.size === 0) return;

  const myReports = reportsPage.docs.filter((r) => {
    if (r.id.startsWith("_")) return false;
    const cid = typeof r.data.case_id === "string" ? r.data.case_id : "";
    return cid && owned.has(cid);
  });

  // 1) Final report submitted by the GI specialist → notify the PCP.
  for (const r of myReports) {
    const caseId = String(r.data.case_id);
    const shortCode = owned.get(caseId)!;
    const sharedAt =
      (typeof r.data.shared_at === "string" && r.data.shared_at) ||
      (typeof r.data.created_at === "string" && r.data.created_at) ||
      "";
    if (!sharedAt || !withinWindow(sharedAt, now)) continue;
    const reportName =
      typeof r.data.report_name === "string" && r.data.report_name.trim()
        ? r.data.report_name.trim()
        : "A GI specialist report";
    await ensureNotification(`gi-rpt-${r.id}`, "report_shared", {
      userId,
      caseId,
      caseShortCode: shortCode,
      title: `Final report ready for case #${shortCode}`,
      body: `${reportName} has been shared back to your case.`,
      createdAt: sharedAt,
    });
  }

  // 2) GI remarks on those reports → notify the PCP (PCP-authored remarks are
  // skipped; the PCP doesn't need a notification for their own remark).
  await Promise.all(
    myReports.map(async (r) => {
      const caseId = String(r.data.case_id);
      const shortCode = owned.get(caseId)!;
      let comments;
      try {
        comments = await listDocuments(
          `${GI_SHARED_REPORTS_COLLECTION}/${r.id}/comments`,
          { pageSize: 200 }
        );
      } catch {
        return;
      }
      for (const c of comments.docs) {
        if (c.id.startsWith("_")) continue;
        if (c.data.authorRole !== "gi") continue;
        const createdAt = typeof c.data.createdAt === "string" ? c.data.createdAt : "";
        if (!createdAt || !withinWindow(createdAt, now)) continue;
        const author =
          typeof c.data.authorName === "string" && c.data.authorName.trim()
            ? c.data.authorName.trim()
            : "Your GI specialist";
        const text = typeof c.data.body === "string" ? c.data.body : "";
        const snippet = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        await ensureNotification(`gi-rmk-${c.id}`, "report_remark", {
          userId,
          caseId,
          caseShortCode: shortCode,
          title: `New remark on case #${shortCode}`,
          body: `${author} added a remark: "${snippet}"`,
          createdAt,
        });
      }
    })
  );
}
