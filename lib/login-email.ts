import { LOGIN_CODE_TTL_MS } from "./accounts";

const MINUTES = LOGIN_CODE_TTL_MS / 60_000;

/** The display name on the sign-in email's From line, whichever service sends it. */
export const SENDER_NAME = "Dive current";

/** The sign-in email, whichever service sends it (lib/email.ts). */
export type LoginEmail = { to: string; code: string; link: string | null };

/** The whole message: subject, plain-text body and HTML body. */
export function loginEmailMessage(email: LoginEmail): { subject: string; text: string; html: string } {
  const subject = `${email.code} is your Dive current sign-in code`;
  const linkLine = email.link ? `\n\nOr open this link on the device you are signing in on:\n${email.link}` : "";
  const text =
    `Your sign-in code is ${email.code}\n\nIt works for ${MINUTES} minutes. If you did not ask for it, ignore this email.` +
    linkLine;
  const linkHtml = email.link
    ? `<p><a href="${escapeHtml(email.link)}">Sign in to Dive current</a></p>`
    : "";
  const html =
    `<p>Your sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${escapeHtml(email.code)}</p>` +
    `${linkHtml}<p style="color:#666">It works for ${MINUTES} minutes. If you did not ask for it, ignore this email.</p>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
