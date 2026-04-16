import { describe, it, expect } from "vitest";
import { config } from "./proxy";

/**
 * Unit tests for the proxy middleware matcher config.
 *
 * The matcher pattern controls which paths Next.js runs the middleware on.
 * Tests verify:
 *   - Static asset bypasses (should NOT be guarded)
 *   - Known public-doc bypasses: security.txt, robots.txt, .well-known/,
 *     *.pdf (should NOT be guarded)
 *   - Auth-required routes (should be GUARDED — i.e. pattern MATCHES them)
 *   - S1 fix: /unknown.txt is now GUARDED (not bypassed)
 *
 * Method: extract the regex string from config.matcher[0], build a RegExp,
 * then assert which paths match (guarded) vs. do not match (bypassed).
 *
 * Added for review finding I2.
 */

// config.matcher[0] is the raw string from the Next.js matcher array.
// Next.js compiles it internally; here we exercise the pattern directly
// to verify intent, not the compiled output.
const pattern = config.matcher[0];
// Strip surrounding /( and )/ to get the inner negative-lookahead pattern.
const regex = new RegExp(`^${pattern}$`);

function isGuarded(path: string): boolean {
  return regex.test(path);
}

describe("proxy matcher config", () => {
  // ---------------------------------------------------------------------------
  // Bypassed paths (middleware should NOT run — pattern does not match)
  // ---------------------------------------------------------------------------
  describe("bypasses (not guarded)", () => {
    it.each([
      "/security.txt",
      "/robots.txt",
      "/.well-known/security.txt",
      "/.well-known/anything",
      "/security-packet.pdf",
      "/some-document.pdf",
      "/_next/static/foo.js",
      "/_next/static/chunks/main.js",
      "/_next/image?url=foo",
      "/favicon.ico",
      "/logo.svg",
      "/og-image.png",
      "/bg.jpg",
      "/cover.jpeg",
      "/animation.gif",
      "/hero.webp",
    ])("bypasses %s", (path) => {
      expect(isGuarded(path)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Guarded paths (middleware SHOULD run — pattern matches)
  // ---------------------------------------------------------------------------
  describe("guards (middleware runs)", () => {
    it.each([
      // S1 fix: arbitrary .txt files are no longer bypassed
      "/unknown.txt",
      "/data/dump.txt",
      // Auth-required app routes
      "/security",
      "/security/",
      "/dashboard",
      "/dashboard/portfolio",
      "/api/foo",
      "/api/cron/sync-funding",
      "/login",
      "/signup",
      "/discovery/crypto-sma",
      "/admin",
    ])("guards %s", (path) => {
      expect(isGuarded(path)).toBe(true);
    });
  });
});
