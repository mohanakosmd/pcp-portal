// In-app notification feed. One Firestore doc per (recipient, event).
// See migration 004-init-notifications for the schema.

import { randomBytes } from "crypto";

import {
  createDocument,
  listDocuments,
  nowIso,
  upsertDocument,
} from "@/lib/firestore-rest";

export const NOTIFICATIONS_COLLECTION = "notifications";

export type NotificationType =
  | "case_created"
  | "case_submitted"
  | "case_shared";

export type RecipientType = "pcp" | "gi";

export type NotificationDoc = {
  recipientUserId: string;
  recipientType: RecipientType;
  type: NotificationType;
  caseId: string;
  caseShortCode: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  readAt: string | null;
};

export type NotificationItem = NotificationDoc & { id: string };

function generateNotificationId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const ms = Date.now();
  const buf = randomBytes(9);
  let prefix = "";
  let n = ms;
  for (let i = 0; i < 8; i++) {
    prefix = alphabet[n & 63] + prefix;
    n = Math.floor(n / 64);
  }
  const suffix = buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 12);
  return (prefix + suffix).slice(0, 20);
}

export async function createNotification(
  input: Omit<NotificationDoc, "read" | "createdAt" | "readAt">
): Promise<NotificationItem> {
  const id = generateNotificationId();
  const doc: NotificationDoc = {
    ...input,
    read: false,
    createdAt: nowIso(),
    readAt: null,
  };
  await createDocument(NOTIFICATIONS_COLLECTION, id, doc);
  return { id, ...doc };
}

export async function listNotificationsFor(
  recipientUserId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {}
): Promise<NotificationItem[]> {
  // No server-side filter in the REST list API — we pull recent docs and
  // filter in memory. Volume per user is small (3 events per case).
  const page = await listDocuments(NOTIFICATIONS_COLLECTION, { pageSize: 200 });
  const all = page.docs
    .filter((d) => !d.id.startsWith("_"))
    .filter((d) => d.data.recipientUserId === recipientUserId)
    .map((d) => ({ id: d.id, ...(d.data as unknown as NotificationDoc) }))
    .sort((a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
    );
  const filtered = opts.unreadOnly ? all.filter((n) => !n.read) : all;
  return filtered.slice(0, opts.limit ?? 50);
}

export async function countUnreadFor(recipientUserId: string): Promise<number> {
  const list = await listNotificationsFor(recipientUserId, { unreadOnly: true });
  return list.length;
}

export async function markRead(
  notificationId: string,
  recipientUserId: string
): Promise<void> {
  // Authorise via recipient match — we re-read to confirm ownership.
  const page = await listDocuments(NOTIFICATIONS_COLLECTION, { pageSize: 200 });
  const target = page.docs.find((d) => d.id === notificationId);
  if (!target) {
    const err = new Error("Notification not found.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 404;
    throw err;
  }
  if (target.data.recipientUserId !== recipientUserId) {
    const err = new Error("You do not have access to that notification.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 403;
    throw err;
  }
  if (target.data.read === true) return;
  await upsertDocument(NOTIFICATIONS_COLLECTION, notificationId, {
    read: true,
    readAt: nowIso(),
  });
}

export async function markAllReadFor(recipientUserId: string): Promise<number> {
  const unread = await listNotificationsFor(recipientUserId, { unreadOnly: true });
  const now = nowIso();
  await Promise.all(
    unread.map((n) =>
      upsertDocument(NOTIFICATIONS_COLLECTION, n.id, { read: true, readAt: now })
    )
  );
  return unread.length;
}
