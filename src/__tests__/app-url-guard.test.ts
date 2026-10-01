import { describe, it, expect } from "vitest";
import { assertCanonicalAppUrl } from "../../next.config";

/**
 * `NEXT_PUBLIC_APP_URL` is the origin every absolute link the app mints is
 * built from (factsheet and scenario share links, emails, PDFs, alert acks).
 * A wrong Production value does not fail anywhere: it produces a link on the
 * wrong host that is copied, emailed or printed, and is already in someone
 * else's hands before anyone notices. Measured 2026-09-27: share links minted
 * from the canonical domain came back on the vercel.app alias.
 *
 * So a Production build must REFUSE a non-canonical value, while preview
 * builds (which live on vercel.app hosts by design) must stay unaffected.
 */
describe("assertCanonicalAppUrl — Production build guard for NEXT_PUBLIC_APP_URL", () => {
  it("refuses a Production build pointed at a vercel.app host (links would land on the alias, not the canonical domain)", () => {
    expect(() =>
      assertCanonicalAppUrl("https://example-preview.vercel.app", "production"),
    ).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("refuses a Production build with the variable unset (links would fall back to a request or localhost origin)", () => {
    expect(() => assertCanonicalAppUrl(undefined, "production")).toThrow(
      /NEXT_PUBLIC_APP_URL/,
    );
  });

  it("accepts a Production build on an https canonical host, so a correct deploy is never blocked", () => {
    expect(() =>
      assertCanonicalAppUrl("https://app.example.com", "production"),
    ).not.toThrow();
  });

  it("leaves preview builds alone, because preview deploys legitimately live on vercel.app hosts", () => {
    expect(() =>
      assertCanonicalAppUrl("https://example-preview.vercel.app", "preview"),
    ).not.toThrow();
  });
});
