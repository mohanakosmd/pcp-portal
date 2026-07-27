// High-level event emitters for case lifecycle. Each writes an in-app
// notification doc per recipient and fires a best-effort email. Email
// failures are logged but never propagated — they must not block the
// underlying case operation (create / submit / share).

import { PCP_USERS_COLLECTION } from "@/lib/firebase";
import { getDocument } from "@/lib/firestore-rest";
import { GI_USERS_COLLECTION } from "@/lib/gi-users";
import {
  createNotification,
  type NotificationType,
  type RecipientType,
} from "@/lib/notifications";
import { isSendGridConfigured, sendEmail } from "@/lib/sendgrid";

type EmitInput = {
  type: NotificationType;
  caseId: string;
  caseShortCode: string;
  title: string;
  body: string;
  recipientUserId: string;
  recipientType: RecipientType;
  recipientEmail?: string | null;
  emailSubject?: string;
  emailHtml?: string;
};

async function emitOne(input: EmitInput): Promise<void> {
  // In-app notification — must succeed (otherwise the user won't see it).
  try {
    await createNotification({
      recipientUserId: input.recipientUserId,
      recipientType: input.recipientType,
      type: input.type,
      caseId: input.caseId,
      caseShortCode: input.caseShortCode,
      title: input.title,
      body: input.body,
    });
  } catch (err) {
    console.error(
      `[notify ${input.type}] in-app write failed for ${input.recipientType}/${input.recipientUserId}:`,
      err
    );
  }

  // Email — best effort.
  if (input.recipientEmail && input.emailSubject && input.emailHtml) {
    if (!isSendGridConfigured()) {
      console.warn(`[notify ${input.type}] SendGrid not configured; skipping email`);
      return;
    }
    try {
      const result = await sendEmail({
        to: input.recipientEmail,
        subject: input.emailSubject,
        html: input.emailHtml,
      });
      if (!result.success) {
        console.error(`[notify ${input.type}] email failed: ${result.error}`);
      }
    } catch (err) {
      console.error(`[notify ${input.type}] email threw:`, err);
    }
  }
}

async function readPcp(userId: string): Promise<{ name: string; email: string } | null> {
  const doc = await getDocument(PCP_USERS_COLLECTION, userId);
  if (!doc) return null;
  const name = typeof doc.data.name === "string" ? doc.data.name : "";
  const email = typeof doc.data.email === "string" ? doc.data.email : "";
  return { name, email };
}

async function readGi(
  giUserId: string
): Promise<{ name: string; email: string | null } | null> {
  const doc = await getDocument(GI_USERS_COLLECTION, giUserId);
  if (!doc) return null;
  // Same fallback rule as src/lib/gi-users.ts — accept `fullName` legacy field.
  const fromDisplay =
    typeof doc.data.displayName === "string" ? doc.data.displayName.trim() : "";
  const fromFull =
    typeof doc.data.fullName === "string" ? doc.data.fullName.trim() : "";
  const name = fromDisplay || fromFull || giUserId;
  const email =
    typeof doc.data.email === "string" && doc.data.email.trim()
      ? doc.data.email.trim()
      : null;
  return { name, email };
}

function pcpEmailHtml(opts: {
  greetingName: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  return `
<!doctype html>
<html><body style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <p>Hi ${escapeHtml(opts.greetingName)},</p>
  <h2 style="margin: 16px 0 8px;">${escapeHtml(opts.heading)}</h2>
  <p>${escapeHtml(opts.body)}</p>
  <p style="margin-top: 20px;">
    <a href="${escapeHtml(opts.ctaUrl)}" style="background:#024d9c;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">${escapeHtml(opts.ctaLabel)}</a>
  </p>
  <p style="color:#64748b;font-size:12px;margin-top:24px;">PCP Portal · This is an automated notification.</p>
</body></html>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

// GI specialists are sent to the GI portal (they have no PCP-portal account).
const GI_PORTAL_URL =
  process.env.NEXT_PUBLIC_GI_PORTAL_URL?.trim() || "https://gi.aigicare.com";

function giUrl(path: string): string {
  return GI_PORTAL_URL.replace(/\/+$/, "") + path;
}

// ----- Event emitters --------------------------------------------------------

export async function emitCaseCreated(opts: {
  caseId: string;
  caseShortCode: string;
  ownerUserId: string;
}): Promise<void> {
  const pcp = await readPcp(opts.ownerUserId);
  const greeting = pcp?.name?.trim() || "there";
  const title = `Case #${opts.caseShortCode} created`;
  const body = "Your case has been started. Continue filling it out and submit when ready.";
  await emitOne({
    type: "case_created",
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title,
    body,
    recipientUserId: opts.ownerUserId,
    recipientType: "pcp",
    recipientEmail: pcp?.email || null,
    emailSubject: title,
    emailHtml: pcpEmailHtml({
      greetingName: greeting,
      heading: title,
      body,
      ctaLabel: "Open the case",
      ctaUrl: appUrl(`/create-case?caseId=${encodeURIComponent(opts.caseId)}`),
    }),
  });
}

export async function emitCaseSubmitted(opts: {
  caseId: string;
  caseShortCode: string;
  ownerUserId: string;
}): Promise<void> {
  const pcp = await readPcp(opts.ownerUserId);
  const greeting = pcp?.name?.trim() || "there";
  const title = `Case #${opts.caseShortCode} submitted`;
  const body =
    "Your case has been submitted and is ready to be shared with a GI specialist.";
  await emitOne({
    type: "case_submitted",
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title,
    body,
    recipientUserId: opts.ownerUserId,
    recipientType: "pcp",
    recipientEmail: pcp?.email || null,
    emailSubject: title,
    emailHtml: pcpEmailHtml({
      greetingName: greeting,
      heading: title,
      body,
      ctaLabel: "Review and share",
      ctaUrl: appUrl(`/cases`),
    }),
  });
}

export async function emitCaseShared(opts: {
  caseId: string;
  caseShortCode: string;
  ownerUserId: string;
  giUserId: string;
}): Promise<void> {
  const [pcp, gi] = await Promise.all([
    readPcp(opts.ownerUserId),
    readGi(opts.giUserId),
  ]);
  const giName = gi?.name ?? opts.giUserId;
  const pcpGreeting = pcp?.name?.trim() || "there";
  const pcpName = pcp?.name?.trim() || "the requesting PCP";

  // PCP confirmation.
  const pcpTitle = `Case #${opts.caseShortCode} shared with ${giName}`;
  const pcpBody = `${giName} will review your case and follow up.`;
  await emitOne({
    type: "case_shared",
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title: pcpTitle,
    body: pcpBody,
    recipientUserId: opts.ownerUserId,
    recipientType: "pcp",
    recipientEmail: pcp?.email || null,
    emailSubject: pcpTitle,
    emailHtml: pcpEmailHtml({
      greetingName: pcpGreeting,
      heading: pcpTitle,
      body: pcpBody,
      ctaLabel: "View case",
      ctaUrl: appUrl(`/cases`),
    }),
  });

  // GI inbound — only meaningful once a GI portal exists, but we persist
  // the notification doc anyway so it's ready then. Email is sent now.
  const giTitle = `New case shared with you: #${opts.caseShortCode}`;
  const giBody = `${pcpName} has shared a case with you for review.`;
  await emitOne({
    type: "case_shared",
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title: giTitle,
    body: giBody,
    recipientUserId: opts.giUserId,
    recipientType: "gi",
    recipientEmail: gi?.email || null,
    emailSubject: giTitle,
    emailHtml: pcpEmailHtml({
      greetingName: giName,
      heading: giTitle,
      body: giBody,
      ctaLabel: "Review case",
      ctaUrl: giUrl(`/case-review`),
    }),
  });
}

// Fired when a PCP shares a submitted case with the Medical Assistant (MA)
// team from the Cases page. Unlike the GI share this doesn't route to a named
// specialist — MA staff pick these up — so we only send the PCP a confirmation,
// worded for MA (not GI).
export async function emitCaseSharedWithMa(opts: {
  caseId: string;
  caseShortCode: string;
  ownerUserId: string;
}): Promise<void> {
  const pcp = await readPcp(opts.ownerUserId);
  const pcpGreeting = pcp?.name?.trim() || "there";

  const title = `Case #${opts.caseShortCode} shared with the Medical Assistant team`;
  const body = "A Medical Assistant will review your case and follow up.";
  await emitOne({
    type: "case_shared",
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title,
    body,
    recipientUserId: opts.ownerUserId,
    recipientType: "pcp",
    recipientEmail: pcp?.email || null,
    emailSubject: title,
    emailHtml: pcpEmailHtml({
      greetingName: pcpGreeting,
      heading: title,
      body,
      ctaLabel: "View case",
      ctaUrl: appUrl(`/cases`),
    }),
  });
}

// Fired when a PCP posts a remark on a GI-shared report. Notifies the GI
// specialist the report was shared with (in-app + best-effort email).
export async function emitReportRemarkAdded(opts: {
  caseId: string;
  caseShortCode: string;
  reportName: string;
  giUserId: string;
  pcpName: string;
  remarkBody: string;
}): Promise<void> {
  if (!opts.giUserId) {
    console.warn("[notify report_remark] report has no GI specialist; skipping");
    return;
  }
  const gi = await readGi(opts.giUserId);
  if (!gi) {
    console.warn(`[notify report_remark] GI user ${opts.giUserId} not found; skipping`);
    return;
  }
  const giName = gi.name;
  const pcpName = opts.pcpName.trim() || "A PCP";
  const reportLabel = opts.reportName.trim() || `Case #${opts.caseShortCode}`;
  const snippet =
    opts.remarkBody.length > 160 ? `${opts.remarkBody.slice(0, 160)}…` : opts.remarkBody;
  const title = `New remark on ${reportLabel}`;
  const body = `${pcpName} added a remark on case #${opts.caseShortCode}: "${snippet}"`;
  await emitOne({
    type: "report_remark",
    caseId: opts.caseId,
    caseShortCode: opts.caseShortCode,
    title,
    body,
    recipientUserId: opts.giUserId,
    recipientType: "gi",
    recipientEmail: gi.email,
    emailSubject: title,
    emailHtml: pcpEmailHtml({
      greetingName: giName,
      heading: title,
      body,
      ctaLabel: "View the report",
      ctaUrl: giUrl(`/case-review`),
    }),
  });
}
