/**
 * Sends the sign-in email through Mailgun's HTTP API (fetch, so it runs on Node and on a worker). Settings:
 * MAILGUN_API_KEY, MAILGUN_DOMAIN (the sending domain, such as mg.50bar.app), MAILGUN_FROM (optional, defaults to
 * "Dive current <login@MAILGUN_DOMAIN>") and MAILGUN_REGION ("eu" for an EU account; US otherwise).
 */

export type MailgunConfig = { apiKey: string; domain: string; from: string; region: "us" | "eu" };

export type LoginEmail = { to: string; code: string; link: string | null };

export function loginEmailText(email: LoginEmail): { subject: string; text: string; html: string } {
  const subject = `${email.code} is your Dive current sign-in code`;
  const linkLine = email.link ? `\n\nOr open this link on the device you are signing in on:\n${email.link}` : "";
  const text =
    `Your sign-in code is ${email.code}\n\nIt works for 15 minutes. If you did not ask for it, ignore this email.` +
    linkLine;
  const linkHtml = email.link
    ? `<p><a href="${escapeHtml(email.link)}">Sign in to Dive current</a></p>`
    : "";
  const html =
    `<p>Your sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${escapeHtml(email.code)}</p>` +
    `${linkHtml}<p style="color:#666">It works for 15 minutes. If you did not ask for it, ignore this email.</p>`;
  return { subject, text, html };
}

export async function sendLoginEmail(config: MailgunConfig, email: LoginEmail): Promise<void> {
  const host = config.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  const { subject, text, html } = loginEmailText(email);
  const body = new URLSearchParams({ from: config.from, to: email.to, subject, text, html });
  const response = await fetch(`${host}/v3/${encodeURIComponent(config.domain)}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${config.apiKey}`)}` },
    body,
  });
  if (!response.ok) throw new Error(`Mailgun answered ${response.status}`);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
