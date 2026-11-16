import { describe, expect, it } from "vitest";
import { rejectedResponse, rejectsRequest } from "./request-guard";

const request = (method: string, headers: Record<string, string> = {}) =>
  new Request("https://50bar.app/?rest_route=%2Fbatch%2Fv1", { method, headers });

describe("rejectsRequest", () => {
  it("lets page reads and server actions through", () => {
    expect(rejectsRequest(request("GET"))).toBe(false);
    expect(rejectsRequest(request("HEAD"))).toBe(false);
    expect(rejectsRequest(request("POST", { "Next-Action": "abc123" }))).toBe(false);
    expect(rejectsRequest(request("POST", { "content-type": "multipart/form-data; boundary=x" }))).toBe(false);
  });

  it("turns away other posts and methods", () => {
    expect(rejectsRequest(request("POST", { "content-type": "application/json" }))).toBe(true);
    expect(rejectsRequest(request("POST"))).toBe(true);
    expect(rejectsRequest(request("PUT"))).toBe(true);
    expect(rejectedResponse().status).toBe(405);
  });
});

describe("rejectsRequest for the app's API", () => {
  const api = (path: string, headers: Record<string, string>) =>
    new Request(`https://50bar.app${path}`, { method: "POST", headers });

  it("lets posts to /api/v1/ through, so the route answers a wrong body with 415", () => {
    expect(rejectsRequest(api("/api/v1/sites/x/reports", { "content-type": "application/json" }))).toBe(false);
    expect(rejectsRequest(api("/api/v1/sign-in/code", { "content-type": "text/plain" }))).toBe(false);
  });

  it("turns away JSON posts elsewhere", () => {
    expect(rejectsRequest(api("/api/warm", { "content-type": "application/json" }))).toBe(true);
    expect(rejectsRequest(api("/", { "content-type": "application/json" }))).toBe(true);
    expect(rejectsRequest(api("/api/v1x", { "content-type": "application/json" }))).toBe(true);
  });
});
