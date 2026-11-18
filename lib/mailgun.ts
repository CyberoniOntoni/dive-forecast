import { loginEmailMessage, type LoginEmail } from "./login-email";

/**
 * Sends the sign-in email through Mailgun's HTTP API (fetch, so it runs on Node and on a worker). On the worker it is
 * the fallback when Cloudflare's own sending refuses (lib/email.ts). Settings: MAILGUN_API_KEY, MAILGUN_DOMAIN (the
 * sending domain, such as mailgun.50bar.app), MAILGUN_FROM (optional, defaults to "50Bar
 * <login@MAILGUN_DOMAIN>") and MAILGUN_REGION ("eu" for an EU account; US otherwise).
 */

export type MailgunConfig = { apiKey: string; domain: string; from: string; region: "us" | "eu" };

export async function sendMailgunEmail(config: MailgunConfig, email: LoginEmail): Promise<void> {
  await sendMailgunMessage(config, { to: email.to, ...loginEmailMessage(email) });
}

/** Any email through Mailgun; html is optional. */
export async function sendMailgunMessage(
  config: MailgunConfig,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const host = config.region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  const { to, subject, text, html } = message;
  const body = new URLSearchParams({ from: config.from, to, subject, text, ...(html ? { html } : {}) });
  const response = await fetch(`${host}/v3/${encodeURIComponent(config.domain)}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${config.apiKey}`)}` },
    body,
  });
  if (!response.ok) throw new Error(`Mailgun answered ${response.status}`);
}
