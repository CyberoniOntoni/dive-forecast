import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEmail, WorkerEnv } from "./cloudflare";
import { mailRoutes, sendLoginEmail } from "./email";

// The worker's EMAIL binding faked in OpenNext's request context; Mailgun faked through fetch.
let env: Partial<WorkerEnv> & Record<string, unknown> = {};
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env, ctx: { waitUntil: () => undefined } }),
}));

type Sent = Parameters<SendEmail["send"]>[0];
let viaCloudflare: Sent[] = [];
let viaMailgun: URLSearchParams[] = [];
let cloudflareFails: Error | null = null;
let mailgunStatus = 200;
const realFetch = globalThis.fetch;
const email = { to: "diver@example.com", code: "123456", link: "https://50bar.app/login?code=123456" };

beforeEach(() => {
  viaCloudflare = [];
  viaMailgun = [];
  cloudflareFails = null;
  mailgunStatus = 200;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const binding: SendEmail = {
    send: async (message) => {
      if (cloudflareFails) throw cloudflareFails;
      viaCloudflare.push(message);
      return { messageId: "m1" };
    },
  };
  env = { EMAIL: binding, EMAIL_FROM: "login@50bar.app", MAILGUN_API_KEY: "key-test", MAILGUN_DOMAIN: "mg.example.com" };
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    viaMailgun.push(init.body as URLSearchParams);
    return new Response("{}", { status: mailgunStatus });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("sign-in email routes", () => {
  it("sends through Cloudflare first, from the configured address, with the code and link", async () => {
    expect(mailRoutes().map((route) => route.name)).toEqual(["cloudflare", "mailgun"]);
    expect(await sendLoginEmail(mailRoutes(), email)).toBe("cloudflare");
    expect(viaMailgun).toHaveLength(0);
    expect(viaCloudflare[0]).toMatchObject({
      from: { email: "login@50bar.app", name: "Dive current" },
      to: "diver@example.com",
      subject: "123456 is your Dive current sign-in code",
    });
    expect(viaCloudflare[0].text).toContain(email.link);
  });

  it("falls back to Mailgun when Cloudflare refuses", async () => {
    cloudflareFails = Object.assign(new Error("Domain not onboarded"), { code: "E_SENDER_DOMAIN_NOT_AVAILABLE" });
    expect(await sendLoginEmail(mailRoutes(), email)).toBe("mailgun");
    expect(viaMailgun[0].get("to")).toBe("diver@example.com");
    expect(viaMailgun[0].get("text")).toContain("123456");
  });

  it("throws the last failure when every route fails", async () => {
    cloudflareFails = new Error("E_DAILY_LIMIT_EXCEEDED");
    mailgunStatus = 401;
    await expect(sendLoginEmail(mailRoutes(), email)).rejects.toThrow("Mailgun answered 401");
  });

  it("uses one route when only one is set up", async () => {
    delete env.EMAIL_FROM;
    expect(mailRoutes().map((route) => route.name)).toEqual(["mailgun"]);
    env.EMAIL_FROM = "login@50bar.app";
    delete env.MAILGUN_API_KEY;
    expect(mailRoutes().map((route) => route.name)).toEqual(["cloudflare"]);
    delete env.EMAIL;
    expect(mailRoutes()).toEqual([]);
  });
});
