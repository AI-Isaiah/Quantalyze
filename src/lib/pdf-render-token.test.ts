/**
 * H-0465 — verifyPdfRenderToken is the HMAC IDOR gate for the
 * /portfolio-pdf/[id] render page (Puppeteer navigates without cookies,
 * so the page is in PUBLIC_ROUTES). CRITICAL-01 in critical-regressions.test.ts
 * only asserts the source string CONTAINS 'verifyPdfRenderToken' — it would
 * pass even if the function were `() => true`. These tests pin the actual
 * verification behavior:
 *   - round-trip sign/verify for a valid portfolio id
 *   - expired token (exp in the past) rejected
 *   - secret < 16 chars → false silently (no throw)
 *   - tampered / wrong-length / non-hex signature rejected
 *   - portfolioId in URL ≠ portfolioId baked into the HMAC payload (the
 *     core IDOR check) rejected
 *   - malformed token shapes (no dot, leading/trailing dot, malformed exp)
 *   - timingSafeEqual mismatched-length path returns false (no crash)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signPdfRenderToken, verifyPdfRenderToken } from "./pdf-render-token";

describe("verifyPdfRenderToken", () => {
  const originalSecret = process.env.DEMO_PDF_SECRET;

  beforeEach(() => {
    process.env.DEMO_PDF_SECRET = "render-secret-at-least-16-chars";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.DEMO_PDF_SECRET;
    } else {
      process.env.DEMO_PDF_SECRET = originalSecret;
    }
  });

  it("verifies a freshly-signed token for the matching portfolio id (round-trip)", () => {
    const token = signPdfRenderToken("portfolio-1");
    expect(verifyPdfRenderToken("portfolio-1", token)).toBe(true);
  });

  it("rejects a token signed for a DIFFERENT portfolio id (core IDOR gate)", () => {
    // The portfolio id is baked into the HMAC payload (`render:${id}.${exp}`),
    // so a token minted for portfolio-1 must NOT authorize portfolio-2.
    const token = signPdfRenderToken("portfolio-1");
    expect(verifyPdfRenderToken("portfolio-2", token)).toBe(false);
  });

  it("rejects null, undefined, and empty tokens", () => {
    expect(verifyPdfRenderToken("portfolio-1", null)).toBe(false);
    expect(verifyPdfRenderToken("portfolio-1", undefined)).toBe(false);
    expect(verifyPdfRenderToken("portfolio-1", "")).toBe(false);
  });

  it("rejects an expired token (exp in the past)", () => {
    // exp = 1 (1970) is well past now; the exp check fires before HMAC.
    expect(verifyPdfRenderToken("portfolio-1", `1.${"0".repeat(64)}`)).toBe(false);
  });

  it("returns false silently when DEMO_PDF_SECRET is shorter than 16 chars", () => {
    process.env.DEMO_PDF_SECRET = "short";
    // getSecret throws internally; verify swallows it and returns false
    // rather than 500-ing the render page.
    expect(() => verifyPdfRenderToken("portfolio-1", "1.abc")).not.toThrow();
    expect(verifyPdfRenderToken("portfolio-1", "1.abc")).toBe(false);
  });

  it("returns false silently when DEMO_PDF_SECRET is unset", () => {
    delete process.env.DEMO_PDF_SECRET;
    expect(verifyPdfRenderToken("portfolio-1", "1.abc")).toBe(false);
  });

  it("rejects a tampered signature (valid exp, wrong sig)", () => {
    const token = signPdfRenderToken("portfolio-1");
    const exp = token.slice(0, token.indexOf("."));
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.${"0".repeat(64)}`)).toBe(
      false,
    );
  });

  it("rejects signatures that are not 64-char lowercase hex", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    // contains a non-hex char
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.g${"0".repeat(63)}`)).toBe(
      false,
    );
    // 63 chars (too short — would otherwise hit a Buffer length mismatch)
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.${"0".repeat(63)}`)).toBe(
      false,
    );
    // 65 chars (too long)
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.${"0".repeat(65)}`)).toBe(
      false,
    );
    // uppercase hex — digest('hex') is lowercase, so this must be rejected
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.${"A".repeat(64)}`)).toBe(
      false,
    );
  });

  it("rejects malformed token shapes (no dot, leading dot, trailing dot, bare dot)", () => {
    expect(verifyPdfRenderToken("portfolio-1", "not-a-token")).toBe(false);
    expect(verifyPdfRenderToken("portfolio-1", ".")).toBe(false);
    expect(verifyPdfRenderToken("portfolio-1", `.${"0".repeat(64)}`)).toBe(false);
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.`)).toBe(false);
  });

  it("rejects a non-numeric / malformed exp segment", () => {
    expect(verifyPdfRenderToken("portfolio-1", `abc.${"0".repeat(64)}`)).toBe(
      false,
    );
    // negative exp must be rejected by the `exp <= 0` guard
    expect(verifyPdfRenderToken("portfolio-1", `-5.${"0".repeat(64)}`)).toBe(
      false,
    );
  });

  it("does not throw on a short-but-hex sig (timingSafeEqual length-mismatch path)", () => {
    // The HEX_64_CHAR guard rejects this before timingSafeEqual, but assert
    // the no-throw contract explicitly: a 2-char hex sig must never crash.
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect(() =>
      verifyPdfRenderToken("portfolio-1", `${exp}.ab`),
    ).not.toThrow();
    expect(verifyPdfRenderToken("portfolio-1", `${exp}.ab`)).toBe(false);
  });
});
