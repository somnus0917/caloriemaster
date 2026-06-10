// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { signedUrlCache } from "../src/services/signedUrlCache";

beforeEach(() => {
  signedUrlCache.clear();
});

describe("signedUrlCache", () => {
  it("returns null for unknown ids", () => {
    expect(signedUrlCache.get("missing")).toBeNull();
  });

  it("returns the URL while it's still fresh", () => {
    signedUrlCache.set("r1", "https://example.com/x", 600);
    expect(signedUrlCache.get("r1")).toBe("https://example.com/x");
  });

  it("invalidates entries that are within the refresh buffer of expiry", () => {
    signedUrlCache.set("r1", "https://example.com/x", 30);
    // 30 seconds TTL with a 60-second refresh buffer means the entry
    // is treated as expired immediately.
    expect(signedUrlCache.get("r1")).toBeNull();
  });

  it("invalidate() removes a single entry", () => {
    signedUrlCache.set("r1", "https://example.com/x", 600);
    signedUrlCache.invalidate("r1");
    expect(signedUrlCache.get("r1")).toBeNull();
  });

  it("clear() wipes everything", () => {
    signedUrlCache.set("r1", "https://example.com/1", 600);
    signedUrlCache.set("r2", "https://example.com/2", 600);
    signedUrlCache.clear();
    expect(signedUrlCache.size()).toBe(0);
    expect(signedUrlCache.get("r1")).toBeNull();
    expect(signedUrlCache.get("r2")).toBeNull();
  });
});