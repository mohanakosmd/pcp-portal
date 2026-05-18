// Thin SendGrid v3 Mail Send wrapper. Uses plain HTTPS so we don't need an
// SDK dependency on the server. Both transactional HTML emails and dynamic
// templates are supported; pass `templateId` + `dynamicTemplateData` to use a
// template, otherwise pass `html`/`text`.

export type SendEmailInput = {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
  from?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { success: true; messageId?: string }
  | { success: false; error: string; status?: number };

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

function readConfig(): {
  apiKey: string;
  sender: string;
  forceTo?: string;
} | null {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const sender = process.env.SENDGRID_SENDER_EMAIL?.trim();
  if (!apiKey || !sender) return null;
  const forceTo = process.env.SENDGRID_FORCE_TO?.trim();
  return { apiKey, sender, forceTo: forceTo || undefined };
}

export function isSendGridConfigured(): boolean {
  return readConfig() !== null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const cfg = readConfig();
  if (!cfg) {
    return {
      success: false,
      error: "SendGrid not configured (SENDGRID_API_KEY / SENDGRID_SENDER_EMAIL missing).",
    };
  }
  if (!input.to) return { success: false, error: "Recipient is required." };

  const effectiveTo = cfg.forceTo || input.to;
  const usingForceTo = Boolean(cfg.forceTo) && cfg.forceTo !== input.to;

  type Personalization = {
    to: { email: string }[];
    dynamic_template_data?: Record<string, unknown>;
  };
  const personalization: Personalization = { to: [{ email: effectiveTo }] };

  type SendGridBody = {
    from: { email: string };
    reply_to?: { email: string };
    personalizations: Personalization[];
    subject?: string;
    content?: { type: string; value: string }[];
    template_id?: string;
  };

  const body: SendGridBody = {
    from: { email: input.from || cfg.sender },
    personalizations: [personalization],
  };

  if (input.replyTo) body.reply_to = { email: input.replyTo };

  if (input.templateId) {
    body.template_id = input.templateId;
    personalization.dynamic_template_data = {
      ...(input.dynamicTemplateData ?? {}),
      ...(usingForceTo ? { originalRecipient: input.to } : {}),
    };
  } else {
    const subject = usingForceTo
      ? `[FORWARDED for testing] ${input.subject ?? ""}`
      : input.subject ?? "";
    if (!subject) return { success: false, error: "Subject is required when not using a template." };
    body.subject = subject;
    const content: { type: string; value: string }[] = [];
    if (input.text) content.push({ type: "text/plain", value: prefixForwardingNote(input.text, usingForceTo, input.to) });
    if (input.html) content.push({ type: "text/html", value: prefixForwardingNoteHtml(input.html, usingForceTo, input.to) });
    if (!content.length) {
      return { success: false, error: "html or text content is required." };
    }
    body.content = content;
  }

  let response: Response;
  try {
    response = await fetch(SENDGRID_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "SendGrid request failed.",
    };
  }

  if (response.status >= 200 && response.status < 300) {
    const messageId = response.headers.get("x-message-id") ?? undefined;
    return { success: true, messageId };
  }

  let errorMessage = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { errors?: { message?: string }[] };
      if (parsed.errors?.length) {
        errorMessage = parsed.errors.map((e) => e.message).filter(Boolean).join("; ") || errorMessage;
      } else if (text) {
        errorMessage = text;
      }
    } catch {
      if (text) errorMessage = text;
    }
  } catch {
    // ignore
  }
  return { success: false, error: errorMessage, status: response.status };
}

function prefixForwardingNote(text: string, forwarded: boolean, original: string): string {
  if (!forwarded) return text;
  return `Testing redirect enabled. Original recipient: ${original}\n\n${text}`;
}

function prefixForwardingNoteHtml(html: string, forwarded: boolean, original: string): string {
  if (!forwarded) return html;
  return (
    `<div style="font-family:Arial,sans-serif;color:#555;font-size:12px;margin-bottom:12px;">` +
    `<strong>Testing redirect enabled.</strong><br/>Original recipient: ${escapeHtml(original)}` +
    `</div>${html}`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
