import { describe, expect, it } from "vitest";
import { diffWords } from "./text-diff";

const join = (parts: { kind: string; text: string }[], keep: "added" | "removed") =>
  parts.filter((part) => part.kind === "same" || part.kind === keep).map((part) => part.text).join("");

describe("diffWords", () => {
  it("marks one changed word, and its parts read back as either text", () => {
    const before = "Enter on the north side at slack.\nDrift west.";
    const after = "Enter on the south side at slack.\nDrift west.";
    const parts = diffWords(before, after);
    expect(parts).toEqual([
      { kind: "same", text: "Enter on the " },
      { kind: "removed", text: "north " },
      { kind: "added", text: "south " },
      { kind: "same", text: "side at slack.\nDrift west." },
    ]);
    expect(join(parts, "removed")).toBe(before);
    expect(join(parts, "added")).toBe(after);
  });

  it("finds words kept in the middle of a longer rewrite", () => {
    const before = "a b c d e";
    const after = "x b y d z";
    const parts = diffWords(before, after);
    expect(join(parts, "removed")).toBe(before);
    expect(join(parts, "added")).toBe(after);
    expect(parts.filter((part) => part.kind === "same").map((part) => part.text.trim())).toEqual(["b", "d"]);
  });

  it("shows a new text as all added, and a cleared one as all removed", () => {
    expect(diffWords("", "New text")).toEqual([{ kind: "added", text: "New text" }]);
    expect(diffWords("Old text", "")).toEqual([{ kind: "removed", text: "Old text" }]);
    expect(diffWords("", "")).toEqual([]);
  });
});
