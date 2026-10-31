import { mailgunConfig } from "./auth";
import { appSetting, workerEnv, type SendEmail } from "./cloudflare";
import { loginEmailText, type LoginEmail } from "./login-email";
import { sendMailgunEmail } from "./mailgun";

/**
 * Where the sign-in email goes out, in order: Cloudflare Email Sending (the worker's EMAIL binding, from EMAIL_FROM,
 * such as login@50bar.app, on a domain onboarded in Email Service), then Mailgun. A route that refuses or fails hands
 * the email to the next, so Mailgun covers Cloudflare's beta (small starting daily quota, outages). On Node there is no
 * binding, so Docker and next dev use Mailgun alone.
 */

export type MailRoute = { name: "cloudflare" | "mailgun"; send: (email: LoginEmail) => Promise<void> };

const SENDER_NAME = "Dive current";

export function mailRoutes(): MailRoute[] {
  const routes: MailRoute[] = [];
  const binding = workerEnv()?.EMAIL;
  const from = appSetting("EMAIL_FROM");
  if (binding && from) routes.push({ name: "cloudflare", send: (email) => sendCloudflareEmail(binding, from, email) });
  const mailgun = mailgunConfig();
  if (mailgun) routes.push({ name: "mailgun", send: (email) => sendMailgunEmail(mailgun, email) });
  return routes;
}

/** Tries each route in turn; throws the last failure when none sent it. */
export async function sendLoginEmail(routes: MailRoute[], email: LoginEmail): Promise<MailRoute["name"]> {
  let failure: unknown = new Error("No email route is set up");
  for (const route of routes) {
    try {
      await route.send(email);
      return route.name;
    } catch (error) {
      console.error(`Sign-in email via ${route.name} failed`, error);
      failure = error;
    }
  }
  throw failure;
}

async function sendCloudflareEmail(binding: SendEmail, from: string, email: LoginEmail): Promise<void> {
  const { subject, text, html } = loginEmailText(email);
  await binding.send({ from: { email: from, name: SENDER_NAME }, to: email.to, subject, text, html });
}
