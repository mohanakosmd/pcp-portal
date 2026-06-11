// Quick check that SendGrid credentials in .env.local can actually deliver
// an email. Sends a one-off test message to SENDGRID_FORCE_TO.
//
// Run from project root: node scripts/check-sendgrid.mjs

import { config } from "dotenv";
config({ path: ".env.local" });

const API_KEY = process.env.SENDGRID_API_KEY?.trim();
const SENDER = process.env.SENDGRID_SENDER_EMAIL?.trim();
const RECIPIENT = process.env.SENDGRID_FORCE_TO?.trim();

if (!API_KEY || !SENDER) {
  console.error("Missing SENDGRID_API_KEY or SENDGRID_SENDER_EMAIL in .env.local");
  process.exit(1);
}
if (!RECIPIENT) {
  console.error("No recipient — set SENDGRID_FORCE_TO in .env.local");
  process.exit(1);
}

console.log("Sender:    ", SENDER);
console.log("Recipient: ", RECIPIENT);

const body = {
  from: { email: SENDER },
  personalizations: [{ to: [{ email: RECIPIENT }] }],
  subject: "PCP Portal — SendGrid test",
  content: [
    {
      type: "text/plain",
      value:
        "This is a one-off test email from scripts/check-sendgrid.mjs.\n" +
        "If you see this, SendGrid is wired up correctly.",
    },
    {
      type: "text/html",
      value:
        '<div style="font-family:Arial,sans-serif;color:#0f172a;">' +
        '<h2 style="color:#003672;">PCP Portal — SendGrid test</h2>' +
        '<p>If you see this, SendGrid is wired up correctly.</p>' +
        "</div>",
    },
  ],
};

const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (r.status >= 200 && r.status < 300) {
  console.log("✅ Accepted by SendGrid — messageId:", r.headers.get("x-message-id") ?? "(none)");
} else {
  const text = await r.text();
  console.error(`❌ Status ${r.status}: ${text}`);
  process.exit(1);
}
