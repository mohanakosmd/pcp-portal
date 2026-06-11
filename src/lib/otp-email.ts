import { OTP_TTL_SECONDS } from "@/lib/auth";
import { isSendGridConfigured, sendEmail } from "@/lib/sendgrid";

// Human-readable OTP validity window, derived from the server TTL so the email
// copy always matches how long the code actually lasts.
function otpExpiryText(): string {
  if (OTP_TTL_SECONDS % 60 === 0) {
    const minutes = OTP_TTL_SECONDS / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${OTP_TTL_SECONDS} seconds`;
}

type OtpPurpose = "signup" | "login" | "reset";

type OtpEmailPayload = {
  recipient: string;
  intendedFor: string;
  code: string;
  fullName: string;
  purpose?: OtpPurpose;
};

export type SendOtpEmailResult =
  | { delivered: true; via: "sendgrid"; messageId?: string }
  | { delivered: false; reason: string };

/**
 * Sends the signup OTP to `recipient` (per env override) or `intendedFor`.
 * Always logs the code to the dev console so it's visible even when the
 * delivery service is disabled.
 */
export async function sendSignupOtpEmail(
  payload: OtpEmailPayload
): Promise<SendOtpEmailResult> {
  logOtp(payload);

  if (!isSendGridConfigured()) {
    return {
      delivered: false,
      reason: "SendGrid not configured (SENDGRID_API_KEY / SENDGRID_SENDER_EMAIL missing).",
    };
  }

  const result = await sendEmail({
    to: payload.recipient,
    subject:
      payload.purpose === "reset"
        ? "Reset your PCP Portal password"
        : "Your PCP Portal verification code",
    text: buildText(payload),
    html: buildHtml(payload),
  });

  if (result.success) {
    console.log(
      `[otp-email] sent via SendGrid → ${payload.recipient}` +
        (result.messageId ? ` (messageId=${result.messageId})` : "")
    );
    return { delivered: true, via: "sendgrid", messageId: result.messageId };
  }

  console.error("[otp-email] SendGrid failed:", result.error);
  return { delivered: false, reason: result.error };
}

function logOtp({ recipient, intendedFor, code, fullName }: OtpEmailPayload): void {
  const banner = "=".repeat(60);
  console.log(
    [
      banner,
      "[PCP Portal] Signup OTP generated",
      `  For:        ${fullName} <${intendedFor}>`,
      `  Routed to:  ${recipient}`,
      `  Code:       ${code}`,
      banner,
    ].join("\n")
  );
}

function actionLine(purpose?: OtpPurpose): string {
  switch (purpose) {
    case "reset":
      return "Use this code to reset your PCP Portal password.";
    case "login":
      return "Use this code to finish signing in to your account.";
    default:
      return "Use this code to finish creating your account.";
  }
}

function buildText({ fullName, code, intendedFor, purpose }: OtpEmailPayload): string {
  return [
    `Hi ${fullName || "there"},`,
    "",
    actionLine(purpose),
    `Your verification code is: ${code}`,
    "",
    `This code is valid for ${otpExpiryText()}. If you didn't request it, you can ignore this email.`,
    "",
    `Account: ${intendedFor}`,
    "",
    "— PCP Portal",
  ].join("\n");
}

function buildHtml({ fullName, code, intendedFor, purpose }: OtpEmailPayload): string {
  const safeName = escapeHtml(fullName || "there");
  const safeAccount = escapeHtml(intendedFor);
  const safeCode = escapeHtml(code);
  const safeAction = escapeHtml(actionLine(purpose));
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:32px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:32px;">
      <div style="font-size:20px;font-weight:700;color:#003672;margin-bottom:8px;">PCP Portal</div>
      <div style="color:#64748b;font-size:14px;margin-bottom:24px;">Primary Care Physician</div>
      <p style="margin:0 0 12px;color:#0f172a;font-size:16px;">Hi ${safeName},</p>
      <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.5;">
        ${safeAction} The code is valid for ${otpExpiryText()}.
      </p>
      <div style="font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:0.18em;color:#003672;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:18px 0;text-align:center;margin:0 0 18px;">
        ${safeCode}
      </div>
      <p style="margin:0 0 18px;color:#64748b;font-size:13px;line-height:1.5;">
        If you didn't try to sign up, you can safely ignore this email.
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="margin:0;color:#94a3b8;font-size:12px;">
        Account: ${safeAccount}<br/>
        This is an automated message from PCP Portal — please don't reply.
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Back-compat shim — older callers used logOtpDelivery() for the dev banner.
export function logOtpDelivery(payload: OtpEmailPayload): void {
  logOtp(payload);
}
