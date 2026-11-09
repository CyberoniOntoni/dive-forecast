import { afterEach, describe, expect, it, vi } from "vitest";

// What the mocked cookies() and headers() do on the next call.
let cookiesBehaviour: () => unknown = () => ({ get: () => undefined });
let headersBehaviour: () => unknown = () => new Headers();

vi.mock("next/headers", () => ({
  cookies: async () => cookiesBehaviour(),
  headers: async () => headersBehaviour(),
}));

const { appUrl, currentSession, ipGroup } = await import("./auth");

afterEach(() => {
  cookiesBehaviour = () => ({ get: () => undefined });
  headersBehaviour = () => new Headers();
  vi.unstubAllEnvs();
});

describe("currentSession", () => {
  it("lets through the error Next throws to mark a page per-request, so it is never prerendered as static", async () => {
    // What cookies() throws while a page is being prerendered at build time.
    const dynamicUsage = Object.assign(new Error("Dynamic server usage: cookies"), { digest: "DYNAMIC_SERVER_USAGE" });
    cookiesBehaviour = () => {
      throw dynamicUsage;
    };
    await expect(currentSession()).rejects.toBe(dynamicUsage);
  });

  it("reads the cookie even when sign-in is not set up (the build has no AUTH_SECRET)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    let read = false;
    cookiesBehaviour = () => {
      read = true;
      return { get: () => undefined };
    };
    expect(await currentSession()).toBeNull();
    expect(read).toBe(true);
  });

  it("is null outside a request", async () => {
    cookiesBehaviour = () => {
      throw new Error("`cookies` was called outside a request scope.");
    };
    expect(await currentSession()).toBeNull();
  });
});

describe("appUrl outside production, with no APP_URL", () => {
  it("is the request's own host", async () => {
    vi.stubEnv("APP_URL", "");
    headersBehaviour = () => new Headers({ host: "localhost:3000" });
    expect(await appUrl()).toBe("http://localhost:3000");
  });

  it("lets through Next's own errors", async () => {
    vi.stubEnv("APP_URL", "");
    const dynamicUsage = Object.assign(new Error("Dynamic server usage: headers"), { digest: "DYNAMIC_SERVER_USAGE" });
    headersBehaviour = () => {
      throw dynamicUsage;
    };
    await expect(appUrl()).rejects.toBe(dynamicUsage);
  });

  it("is null outside a request", async () => {
    vi.stubEnv("APP_URL", "");
    headersBehaviour = () => {
      throw new Error("`headers` was called outside a request scope.");
    };
    expect(await appUrl()).toBeNull();
  });
});

describe("ipGroup", () => {
  it("keeps an IPv4 address and groups an IPv6 one by its /64, however it is written", () => {
    expect(ipGroup("203.0.113.5")).toBe("203.0.113.5");
    expect(ipGroup("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(ipGroup("2001:db8:aa:1::5")).toBe(ipGroup("2001:0db8:00aa:0001:ffff:1:2:3"));
    expect(ipGroup("2001:db8::1")).toBe(ipGroup("2001:db8:0:0:9::"));
    expect(ipGroup("2001:db8:aa:1::5")).not.toBe(ipGroup("2001:db8:aa:2::5"));
  });
});
