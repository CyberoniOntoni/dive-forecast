import { describe, expect, it } from "vitest";
import { betaSignupMailto, parseAndroidBeta, PLAY_OPT_IN_URL } from "@/lib/android-beta";

describe("parseAndroidBeta", () => {
  it("is off when unset or blank", () => {
    expect(parseAndroidBeta(null)).toBeNull();
    expect(parseAndroidBeta(undefined)).toBeNull();
    expect(parseAndroidBeta("  ")).toBeNull();
  });

  it("reads the email-list setup", () => {
    expect(parseAndroidBeta("email")).toEqual({ join: "email" });
    expect(parseAndroidBeta(" Email ")).toEqual({ join: "email" });
  });

  it("reads a Google Group link", () => {
    expect(parseAndroidBeta("https://groups.google.com/g/50bar-testers")).toEqual({
      join: "group",
      groupUrl: "https://groups.google.com/g/50bar-testers",
    });
  });

  it("refuses anything that is not an https link", () => {
    expect(parseAndroidBeta("http://groups.google.com/g/x")).toBeNull();
    expect(parseAndroidBeta("javascript:alert(1)")).toBeNull();
    expect(parseAndroidBeta("yes")).toBeNull();
  });
});

describe("links", () => {
  it("opts in to the app.fiftybar test", () => {
    expect(PLAY_OPT_IN_URL).toBe("https://play.google.com/apps/testing/app.fiftybar");
  });

  it("mails support with a subject", () => {
    expect(betaSignupMailto()).toMatch(/^mailto:support@50bar\.app\?subject=50Bar%20Android%20beta&body=/);
  });
});
