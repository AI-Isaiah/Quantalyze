import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHmac } from "crypto";
import { ACTIVE_PORTFOLIO_ID } from "../src/lib/demo";

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
 *   DEMO_PDF_SECRET=test-secret-at-least-16-chars \
 *     npx playwright test e2e/portfolio-pdf-demo.spec.ts
 *
 * The test is grep-tagged @nightly so the main CI runner can exclude
 * it with `--grep-invert @nightly`.
 */

const DEMO_PDF_SECRET =
  process.env.DEMO_PDF_SECRET ?? "test-secret-at-least-16-chars";

// Cold-start budget: Puppeteer's 10s Chromium launch timeout + 15s semaphore
// queue timeout + network + PDF render ≈ 30s worst case. 45s gives clear
// headroom so a spec timeout never masks a legitimate timeout response.
const PDF_REQUEST_TIMEOUT_MS = 45_000;

function signDemoPdfToken(portfolioId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = `${portfolioId}.${exp}`;
  const sig = createHmac("sha256", DEMO_PDF_SECRET).update(payload).digest("hex");
  return `${exp}.${sig}`;
}

function pdfUrl(portfolioId: string, token?: string): string {
  const base = `/api/demo/portfolio-pdf/${portfolioId}`;
  return token ? `${base}?token=${token}` : base;
}

function fetchPdf(request: APIRequestContext, url: string) {
  return request.get(url, { timeout: PDF_REQUEST_TIMEOUT_MS });
}

test.describe("demo PDF endpoint @nightly", () => {
  test("returns a PDF when given a valid signed token", async ({ request }) => {
    const token = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    const res = await fetchPdf(request, pdfUrl(ACTIVE_PORTFOLIO_ID, token));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const body = await res.body();
    expect(body.byteLength).toBeGreaterThan(1024);
  });

  test("returns 401 on missing token", async ({ request }) => {
    const res = await fetchPdf(request, pdfUrl(ACTIVE_PORTFOLIO_ID));
    expect(res.status()).toBe(401);
  });

  test("returns 401 on tampered token", async ({ request }) => {
    const valid = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    const tampered = `${valid.split(".")[0]}.${"0".repeat(64)}`;
    const res = await fetchPdf(request, pdfUrl(ACTIVE_PORTFOLIO_ID, tampered));
    expect(res.status()).toBe(401);
  });

  test("returns 404 on an allocator portfolio id that is not in the allowlist", async ({
    request,
  }) => {
    const rogueId = "00000000-0000-4000-8000-000000000000";
    const token = signDemoPdfToken(rogueId);
    const res = await fetchPdf(request, pdfUrl(rogueId, token));
    expect(res.status()).toBe(404);
  });

  test("does not cache the response (no-store)", async ({ request }) => {
    const token = signDemoPdfToken(ACTIVE_PORTFOLIO_ID);
    const res = await fetchPdf(request, pdfUrl(ACTIVE_PORTFOLIO_ID, token));
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toContain("no-store");
  });
});
