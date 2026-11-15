import { describe, expect, it } from "vitest";
import { escapeHtml } from "./leaflet-api";

describe("escapeHtml", () => {
  it("turns a site name into text, never markup", () => {
    expect(escapeHtml(`1. <img src=x onerror="alert('x')"> & co`)).toBe(
      "1. &lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; co",
    );
  });
});
