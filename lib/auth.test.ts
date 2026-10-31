import { afterEach, describe, expect, it, vi } from "vitest";

// What the mocked cookies() does on the next call.
let cookiesBehaviour: () => unknown = () => ({ get: () => undefined });

vi.mock("next/headers", () => ({
  cookies: async () => cookiesBehaviour(),
  headers: async () => new Headers(),
}));

const { currentSession } = await import("./auth");

afterEach(() => {
  cookiesBehaviour = () => ({ get: () => undefined });
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
