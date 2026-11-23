import { describe, expect, it } from "vitest";
import { GET } from "../app/.well-known/assetlinks.json/route";

describe("GET /.well-known/assetlinks.json", () => {
  it("serves the Play app links statement as application/json", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(body[0].target.namespace).toBe("android_app");
    expect(body[0].target.package_name).toBe("app.fiftybar");
    expect(body[0].target.sha256_cert_fingerprints).toHaveLength(3);
    for (const fp of body[0].target.sha256_cert_fingerprints) expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
