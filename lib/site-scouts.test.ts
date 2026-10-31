import { describe, expect, it } from "vitest";
import { siteScouts } from "./site-scouts";
import type { User } from "./types";

const users: User[] = [
  { id: "a", email: "a@x.co", nickname: "Ann", createdAt: "" },
  { id: "b", email: "b@x.co", nickname: "Bob", createdAt: "" },
];

describe("siteScouts", () => {
  it("ranks divers by sites added, then by how many of them others reported at, ties sharing a rank", () => {
    const sites = [
      { id: "s1", addedBy: "a" },
      { id: "s2", addedBy: "a" },
      { id: "s3", addedBy: "b" },
      { id: "s4", addedBy: "b" },
      { id: "s5" },
      { id: "s6", addedBy: "gone" },
    ];
    const reports = [
      { siteId: "s1", userId: "a" },
      { siteId: "s3", userId: "a" },
      { siteId: "s5", userId: "b" },
    ];
    expect(siteScouts(sites, users, reports)).toEqual([
      { userId: "b", nickname: "Bob", rank: 1, sites: 2, reportedByOthers: 1 },
      { userId: "a", nickname: "Ann", rank: 2, sites: 2, reportedByOthers: 0 },
    ]);
    const tied = siteScouts([{ id: "s1", addedBy: "a" }, { id: "s2", addedBy: "b" }], users, []);
    expect(tied.map((row) => [row.nickname, row.rank])).toEqual([
      ["Ann", 1],
      ["Bob", 1],
    ]);
  });
});
