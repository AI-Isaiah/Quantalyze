import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signDemoPdfToken, verifyDemoPdfToken } from "./demo-pdf-token";

describe("demo-pdf-token", () => {
  const originalSecret = process.env.DEMO_PDF_SECRET;

  beforeEach(() => {
    process.env.DEMO_PDF_SECRET = "test-secret-at-least-16-chars";
  });

  afterEach(() => {
    if (originalSecret) {
      process.env.DEMO_PDF_SECRET = originalSecret;
    } else {
      delete process.env.DEMO_PDF_SECRET;
    }
  });

  it("verifies a freshly-signed token", () => {
    const token = signDemoPdfToken("portfolio-1");
    expect(verifyDemoPdfToken("portfolio-1", token)).toBe(true);
  });

  it("rejects the token for a different portfolio id", () => {
    const token = signDemoPdfToken("portfolio-1");
    expect(verifyDemoPdfToken("portfolio-2", token)).toBe(false);
  });

  it("rejects null and empty tokens", () => {
    expect(verifyDemoPdfToken("portfolio-1", null)).toBe(false);
    expect(verifyDemoPdfToken("portfolio-1", undefined)).toBe(false);
    expect(verifyDemoPdfToken("portfolio-1", "")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyDemoPdfToken("portfolio-1", "not-a-token")).toBe(false);
    expect(verifyDemoPdfToken("portfolio-1", "abc.")).toBe(false);
    expect(verifyDemoPdfToken("portfolio-1", ".abc")).toBe(false);
    expect(verifyDemoPdfToken("portfolio-1", ".")).toBe(false);
  });

  it("rejects an expired token", () => {
    // Build a token with exp = 1 (1970), then verify
    const past = "1.deadbeef";
    expect(verifyDemoPdfToken("portfolio-1", past)).toBe(false);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signDemoPdfToken("portfolio-1");
    const [exp] = token.split(".");
    const fakeSig = "0".repeat(64);
    expect(verifyDemoPdfToken("portfolio-1", `${exp}.${fakeSig}`)).toBe(false);
  });

  it("returns false silently when DEMO_PDF_SECRET is unset", () => {
    delete process.env.DEMO_PDF_SECRET;
    expect(verifyDemoPdfToken("portfolio-1", "1.abc")).toBe(false);
  });

  it("throws when signing without a secret", () => {
    delete process.env.DEMO_PDF_SECRET;
    expect(() => signDemoPdfToken("portfolio-1")).toThrow();
  });

  it("throws when secret is too short", () => {
    process.env.DEMO_PDF_SECRET = "short";
    expect(() => signDemoPdfToken("portfolio-1")).toThrow();
  });
});
