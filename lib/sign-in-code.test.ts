import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashLoginCode } from "./session-token";
import { checkSignInCode } from "./sign-in-code";
import { mutateStore, readStore, setStorePath } from "./store";

const DATA_DIR = path.join(process.cwd(), "data");
const SECRET = "dev-only-auth-secret-not-for-production";
let testFile = "";

beforeEach(() => {
  testFile = `.store-test-${crypto.randomUUID()}.json`;
  setStorePath(testFile);
});

afterEach(() => {
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name === testFile || (name.startsWith(`.store.${process.pid}.`) && name.endsWith(".tmp"))) {
      fs.rmSync(path.join(DATA_DIR, name), { force: true });
    }
  }
  setStorePath("store.json");
});

/** A live code for `email`, as startLogin would leave it. */
async function pending(email: string, code: string) {
  const codeHash = await hashLoginCode(email, code, SECRET);
  await mutateStore((store) => {
    store.logins.push({ email, codeHash, sentAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), attempts: 0 });
  });
}

describe("checkSignInCode", () => {
  it("wants six digits before it looks anything up", async () => {
    expect(await checkSignInCode({ email: "a@example.com", code: "12" })).toEqual({
      ok: false,
      error: "Enter the 6-digit code from the email.",
    });
  });

  it("asks a new address for a nickname, then signs it up", async () => {
    await pending("a@example.com", "123456");
    expect(await checkSignInCode({ email: "A@example.com ", code: "123 456" })).toMatchObject({ ok: false, needsNickname: true });
    const done = await checkSignInCode({ email: "a@example.com", code: "123456", nickname: "Ann", acceptTerms: true });
    expect(done).toMatchObject({ ok: true, user: { email: "a@example.com", nickname: "Ann" } });
    expect(readStore().users).toHaveLength(1);
  });

  it("refuses a wrong code and counts the try", async () => {
    await pending("a@example.com", "123456");
    expect(await checkSignInCode({ email: "a@example.com", code: "654321" })).toEqual({ ok: false, error: "That code is not right." });
    expect(readStore().logins[0].attempts).toBe(1);
  });

  it("throws the diver's words for a bad address", async () => {
    await expect(checkSignInCode({ email: "nope", code: "123456" })).rejects.toThrow("Enter a valid email address.");
  });
});
