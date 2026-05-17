import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  ACTIVE_PORTFOLIO_ID,
  COLD_PORTFOLIO_ID,
} from "../src/lib/demo";
import { signDemoPdfToken } from "../src/lib/demo-pdf-token";

/**
 * Demo-PDF endpoint probe. Runs in the nightly workflow against a
 * deployed staging instance (with real DEMO_PDF_SECRET + Supabase
 * credentials) so a Puppeteer cold-start regression shows up before
 * the friend meeting morning. The CI pipeline does NOT run this spec
 * — the placeholder-env build doesn't have the secret and no browser
 * is available in that environment.
 *
 * To run locally against a dev server:
 *
 *   DEMO_PDF_SECRET=<your-real-secret-at-least-16-chars> \
 *     npx playwright test e2e/portfolio-pdf-demo.spec.ts
 *
 * The test is grep-tagged @nightly so the main CI runner can exclude
 * it with `--grep-invert @nightly`.
 *
 * AUDIT-2026-05-07 (cluster C) hardening:
 *  - Imports `signDemoPdfToken` from `src/lib/demo-pdf-token` instead of
 *    re-implementing it, so a server-side signer rotation (algo change,
 *    base64url switch, payload-prefix add) is round-trip-validated by
 *    the same nightly canary.
 *  - Requires DEMO_PDF_SECRET; no fallback. If the env is missing the
 *    spec hard-skips so it cannot silently sign with a fake key. The
 *    fallback removed here (`"test-secret-at-least-16-chars"`) was a
 *    valid HMAC secret that, if ever copy-pasted as a real DEMO_PDF_SECRET
 *    in any env, would let anyone reading this public file mint tokens.
 *  - Adds expired-token, cross-portfolio HMAC-binding, and malformed-token
 *    coverage — the verifier's expiry / binding / hex-regex branches now
 *    have e2e proof, not just unit coverage.
 *  - PDF success path asserts `%PDF-` magic header AND `%%EOF` trailer
 *    so a Puppeteer error page rendered as a binary blob, an HTML
 *    "PDF generation failed" shell, or a partial body all FAIL the
 *    assertion — even if they happen to be >1 KiB.
 *  - Accepts 503 with `Retry-After` as a transient Puppeteer-queue
 *    timeout (the route's documented retry contract) and retries once
 *    before failing — prevents the nightly issue-creator from filing
 *    p0 noise on a single staging load spike.
 */

const DEMO_PDF_SECRET = process.env.DEMO_PDF_SECRET;

// Cold-start budget: Puppeteer's 10s Chromium launch timeout + 15s semaphore
// queue timeout + network + PDF render ≈ 30s worst case. 45s gives clear
// headroom so a spec timeout never masks a legitimate timeout response.
const PDF_REQUEST_TIMEOUT_MS = 45_000;

function pdfUrl(portfolioId: string, token?: string): string {
  const base = `/api/demo/portfolio-pdf/${portfolioId}`;
  return token ? `${base}?token=${token}` : base;
}

function fetchPdf(request: APIRequestContext, url: string) {
  return request.get(url, { timeout: PDF_REQUEST_TIMEOUT_MS });
}

/**
 * Fetch a PDF, tolerating a single 503 with `Retry-After` (the route's
 * documented transient response when Puppeteer's queue is saturated under
 * load). Returns the final non-503 response, or the second 503 if the
 * retry also lost the queue. Callers assert status on the returned
 * response — so a persistent 503 fails the test, but a one-off queue
 * spike (the audit-2026-05-07 red-team H-1053 chain) does not.
 */
async function fetchPdfTolerant(
  request: APIRequestContext,
  url: string,
): Promise<Awaited<ReturnType<typeof fetchPdf>>> {
  const first = await fetchPdf(request, url);
  if (first.status() !== 503) return first;
  const retryAfter = Number(first.headers()["retry-after"] ?? "10");
  // Clamp to a sane upper bound so a hostile/buggy server can't pin the
  // spec for hours.
  const waitMs = Math.min(Math.max(retryAfter, 1), 30) * 1000;
  await new Promise((r) => setTimeout(r, waitMs));
  return fetchPdf(request, url);
}

/**
 * Token-shape negative tests — these send fixed malformed/missing tokens
 * and assert the server rejects them at the verifier's hex-regex + indexOf
 * guard branches. They do NOT need DEMO_PDF_SECRET (the server holds the
 * secret; the spec only needs to send bytes that fail validation), so they
 * MUST run in main CI to keep verifier-branch coverage on every PR.
 *
 * audit-2026-05-07 SPECIALIST-testing e2e/portfolio-pdf-demo.spec.ts:107 —
 * the previous describe-level `test.skip(!DEMO_PDF_SECRET, ...)` hard-skipped
 * these in any env without the secret (i.e., every non-nightly run),
 * meaning a regression weakening HEX_64_CHAR or the indexOf guard would
 * only be caught nightly. Splitting the describe blocks restores per-PR
 * coverage on the verifier security boundary.
 */
test.describe("demo PDF endpoint @nightly — token shape", () => {
  test("returns 401 on missing token", async ({ request }) => {
    // audit-2026-05-07 SPECIALIST-red-team `503-tolerance-asymmetric` —
    // wire fetchPdfTolerant into the negative-path tests too. A 503
    // from Puppeteer queue saturation is orthogonal to whether the
    // verifier accepted or rejected the token; without the retry the
    // negative-path tests are MORE brittle than the success path they
    // were meant to harden.
    const res = await fetchPdfTolerant(request, pdfUrl(ACTIVE_PORTFOLIO_ID));
    expect(res.status()).toBe(401);
  });

  test("returns 401 on malformed token shapes", async ({ request }) => {
    // The verifier's HEX_64_CHAR regex (src/lib/demo-pdf-token.ts:62 +
    // :97) and indexOf('.') guard (:90-91) reject these shapes. Each
    // assertion covers a distinct rejection branch so a regression that
    // weakens any one branch fails fast.
    //
    // audit-2026-05-07 SPECIALIST-red-team `hmac-branch-uncovered` —
    // every token below exercises an EARLY rejection branch (hex
    // regex fail, empty sig, empty expStr, NaN exp). None reach
    // `timingSafeEqual`, so a regression replacing it with `===`
    // (timing-attack reintroduction) or breaking the HMAC payload
    // format would pass all of these. The HMAC-comparison branch
    // is the actual security boundary; the `valid-shape-wrong-sig`
    // token below carries a future exp + valid lowercase 64-char hex
    // signature that the verifier WILL try to compare via
    // timingSafeEqual. The all-zeros signature reliably mismatches
    // any real HMAC of `${portfolioId}.${exp}`, so the verifier
    // reaches and rejects on the comparison branch — proving that
    // branch is reachable in main CI without needing
    // DEMO_PDF_SECRET.
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const malformedTokens = [
      "no-dot-at-all", // no '.' separator
      ".sig-only", // empty expStr
      "1700000000.", // empty sig
      "1700000000.ZZZZ", // sig not hex
      `1700000000.${"a".repeat(63)}`, // sig wrong length (63 not 64)
      `1700000000.${"a".repeat(65)}`, // sig wrong length (65 not 64)
      `1700000000.${"A".repeat(64)}`, // sig uppercase hex (regex is lowercase-only)
      `not-a-number.${"a".repeat(64)}`, // exp non-numeric
      // valid-shape + future exp + wrong signature — exercises the
      // timingSafeEqual HMAC comparison branch (the actual security
      // boundary). All-zeros sig will not equal the real HMAC of
      // `${portfolioId}.${futureExp}` under any secret.
      `${futureExp}.${"0".repeat(64)}`,
    ];
    for (const token of malformedTokens) {
      // audit-2026-05-07 SPECIALIST-red-team `503-tolerance-asymmetric` —
      // use fetchPdfTolerant so a Puppeteer queue spike on the
      // negative-path doesn't cause a false-positive failure.
      const res = await fetchPdfTolerant(
        request,
        pdfUrl(ACTIVE_PORTFOLIO_ID, token),
      );
      expect(res.status(), `token=${token}`).toBe(401);
    }
  });
});

test.describe("demo PDF endpoint @nightly — signed tokens", () => {
  // Hard-skip if the secret isn't configured. Avoids the silent-fallback
  // anti-pattern where a missing env produced tokens the server rejected
  // and the "401 on tampered" tests passed for the wrong reason.
  // Token-SHAPE tests above do not need the secret and run unconditionally.
  test.skip(
    !DEMO_PDF_SECRET || DEMO_PDF_SECRET.length < 16,
    "DEMO_PDF_SECRET (>=16 chars) required to mint signed tokens — set it " +
      "before running portfolio-pdf-demo.spec.ts locally. The nightly " +
      "workflow guards on this env in .github/workflows/nightly.yml.",
  );

  test("returns a PDF when given a valid signed token", async ({ request }) => {
    const token = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    const res = await fetchPdfTolerant(
      request,
      pdfUrl(ACTIVE_PORTFOLIO_ID, token),
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    // A real PDF starts with the magic header `%PDF-` and ends with `%%EOF`.
    // Asserting both means a Puppeteer error page, an HTML shell, or a
    // truncated body all FAIL the assertion — even when >1 KiB.
    expect(body.byteLength).toBeGreaterThan(1024);
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-");
    // Trailing %%EOF may have a trailing newline; check the final 8 bytes.
    expect(body.slice(-8).toString("ascii")).toContain("%%EOF");
  });

  test("returns 401 on tampered token", async ({ request }) => {
    const valid = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    const tampered = `${valid.split(".")[0]}.${"0".repeat(64)}`;
    // audit-2026-05-07 SPECIALIST-red-team `503-tolerance-asymmetric`.
    const res = await fetchPdfTolerant(
      request,
      pdfUrl(ACTIVE_PORTFOLIO_ID, tampered),
    );
    expect(res.status()).toBe(401);
  });

  test("returns 401 on expired token", async ({ request }) => {
    // Mint a token whose exp is 60 seconds in the past via the canonical
    // signer (`signDemoPdfToken` accepts an optional `expSeconds` for
    // exactly this case). Reusing the production signer means an algorithm
    // rotation (separator change, payload versioning, base64url switch)
    // automatically propagates here — a shadow `signWithExp` would let the
    // verifier reject on signature-mismatch before checking expiry, making
    // this 401 assertion pass for the wrong reason.
    const past = Math.floor(Date.now() / 1000) - 60;
    const expired = signDemoPdfToken(ACTIVE_PORTFOLIO_ID, past);
    // audit-2026-05-07 SPECIALIST-red-team `503-tolerance-asymmetric`.
    const res = await fetchPdfTolerant(
      request,
      pdfUrl(ACTIVE_PORTFOLIO_ID, expired),
    );
    expect(res.status()).toBe(401);
  });

  test("returns 401 when a valid token for one portfolio is reused on another", async ({
    request,
  }) => {
    // HMAC-binding test: tokens are signed over `${portfolioId}.${exp}`,
    // so a token minted for ACTIVE_PORTFOLIO_ID must NOT validate when
    // presented for COLD_PORTFOLIO_ID. This is the canonical "wrong
    // portfolio, valid signature" attack — without binding, a single
    // leaked token would unlock every demo portfolio.
    const tokenForActive = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    // audit-2026-05-07 SPECIALIST-red-team `503-tolerance-asymmetric`.
    const res = await fetchPdfTolerant(
      request,
      pdfUrl(COLD_PORTFOLIO_ID, tokenForActive),
    );
    expect(res.status()).toBe(401);
  });

  test("returns 404 on an allocator portfolio id that is not in the allowlist", async ({
    request,
  }) => {
    const rogueId = "00000000-0000-4000-8000-000000000000";
    const token = signDemoPdfToken(rogueId);
    // audit-2026-05-07 SPECIALIST-red-team `503-tolerance-asymmetric`.
    const res = await fetchPdfTolerant(request, pdfUrl(rogueId, token));
    expect(res.status()).toBe(404);
  });

  test("does not cache the response (no-store)", async ({ request }) => {
    const token = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    const res = await fetchPdfTolerant(
      request,
      pdfUrl(ACTIVE_PORTFOLIO_ID, token),
    );
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toContain("no-store");
  });
});
