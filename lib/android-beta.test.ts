import { describe, expect, it } from "vitest";
import { PLAY_OPT_IN_URL, PLAY_STORE_URL, TESTERS_GROUP_URL } from "@/lib/android-beta";

describe("Android beta links", () => {
  it("point at the app.fiftybar test and its testers group", () => {
    expect(PLAY_OPT_IN_URL).toBe("https://play.google.com/apps/testing/app.fiftybar");
    expect(PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=app.fiftybar");
    expect(TESTERS_GROUP_URL).toBe("https://groups.google.com/g/50bar");
  });
});
