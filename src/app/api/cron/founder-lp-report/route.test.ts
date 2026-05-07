import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 18 / LP-01 + LP-02 — Vitest test scaffold for the founder LP report cron.
 *
 * Coverage (10+ test cases per Adversarial revisions B1/B4/W1/W5/W7/Grok-W4/Grok-W5):
 *
 *   1.  401 on missing Authorization (W5: auth FIRST, before any side effect)
 *   2.  401 on wrong CRON_SECRET
 *   3.  Happy path — fetches PDF with x-internal-token + AbortSignal,
 *       sends Resend email with PDF attachment (B4 + Grok W4)
 *   4.  Grok W5 — Supabase publication precheck short-circuits when status='active'
 *   5.  PDF 4xx response triggers BOTH Sentry capture + Resend ALERT email
 *   6.  W1 — 503 retry-once with Retry-After honor, then dual-alert on 2nd 503
 *   7.  Pitfall 7 — Resend success-path throw still triggers Sentry + Resend alert
 *       (alert email fires after success-email throws; both via separate try/catch)
 *   8.  W7 — Sentry mockImplementation throw doesn't suppress Resend alert
 *       (SENTRY_DSN remains set so captureSentry doesn't early-return)
 *   9.  B4 — double-failure escalation: BOTH alerts throw → console.error
 *       prefixed with [CRON_DOUBLE_FAILURE]
 *   10. ConfigError — missing FOUNDER_LP_STRATEGY_ID returns 500 with dual-alert
 *
 * The route module also expects to handle:
 *   - Vercel cron does NOT pass x-correlation-id → fresh UUID per tick (W2)
 *   - Native fetch() only (no axios per CLAUDE.md banned-packages)
 */

// getCorrelationId reads request-scoped state via the async next/server header
// helper, which is unavailable when invoking a route handler directly in tests.
// Mock the helper to return a deterministic UUID per test run.
vi.mock("@/lib/correlation-id", () => ({
  CORRELATION_HEADER: "x-correlation-id",
  getCorrelationId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
}));

// Sentry — captureException is the mock target for W7 (mockImplementation throw)
// and B4 (double-failure escalation). Lazy-imported in the route, so we mock at
// the module surface.
const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

// Resend SDK — the route instantiates `new Resend(KEY)` and calls `.emails.send`.
// `sendMock` is shared across all instantiations so each test can configure
// per-call resolutions. Uses a real class so `new Resend(...)` resolves.
const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

// Supabase admin — Grok W5 publication precheck.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";

const ENV_BACKUP = { ...process.env };

function buildAuthorizedRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/founder-lp-report", {
    method: "GET",
    headers: { authorization: "Bearer test-secret" },
  });
}

function buildUnauthRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/founder-lp-report", {
    method: "GET",
    headers,
  });
}

/** Mock Supabase chain returning a strategy at status='published' + analytics complete. */
function mockSupabasePublishedHappy() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      status: "published",
      strategy_analytics: { computation_status: "complete" },
    },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { single, eq, select, from };
}

/** Mock Supabase chain returning a strategy still at status='active' (Grok W5). */
function mockSupabaseStillActive() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      strategy_analytics: { computation_status: "complete" },
    },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { single, eq, select, from };
}

/**
 * Helper: build a Response-like mock for the internal factsheet fetch.
 *
 * Phase 18 / R6 — body must clear the cron's MIN_PDF_BYTES (1024) guard
 * so the success-path tests don't trip the empty-PDF bailout.
 */
const HAPPY_PDF_BYTES = 4096;
function pdfResponseOk(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(HAPPY_PDF_BYTES)),
  } as unknown as Response;
}

/** Phase 18 / R6 — under-1KB body to exercise the empty-PDF guard. */
function pdfResponseTooSmall(bytes = 512): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
  } as unknown as Response;
}

/** Phase 18 / R7 — over-25MB body to exercise the max-PDF guard. */
function pdfResponseTooLarge(bytes = 26_000_000): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
  } as unknown as Response;
}

function pdfResponseStatus(status: number, statusText = "Error", headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(headers),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

describe("GET /api/cron/founder-lp-report", () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "msg_test" } });
    vi.mocked(createAdminClient).mockReset();

    process.env.CRON_SECRET = "test-secret";
    process.env.RESEND_API_KEY = "test-resend";
    process.env.FOUNDER_LP_STRATEGY_ID = "00000000-0000-0000-0000-000000000001";
    process.env.FOUNDER_LP_REPORT_TO = "founder@example.com";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.SENTRY_DSN = "test-dsn";
    process.env.PLATFORM_NAME = "Quantalyze";
    process.env.PLATFORM_EMAIL = "noreply@example.com";
    process.env.INTERNAL_API_TOKEN = "test-internal-token";

    // Default Supabase mock — happy path. Tests that need otherwise overwrite.
    mockSupabasePublishedHappy();

    // Default global fetch mock — replaced per-test as needed.
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    vi.unstubAllGlobals();
  });

  it("returns 401 on missing Authorization header (W5: auth FIRST)", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const res = await GET(buildUnauthRequest());
    expect(res.status).toBe(401);
    // Auth FIRST — no fetch, no Resend, no Supabase touched.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 401 on wrong CRON_SECRET", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/cron/founder-lp-report", {
      method: "GET",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("happy path: fetches PDF with x-internal-token + AbortSignal, sends Resend with PDF attachment (B4 + Grok W4)", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseOk());

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.correlation_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(json.strategy_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(json.pdf_bytes).toBe(HAPPY_PDF_BYTES);

    // fetch called with the correct URL + headers (B4: x-internal-token).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://localhost:3000/api/factsheet/00000000-0000-0000-0000-000000000001/pdf");
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers["x-correlation-id"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(headers["x-internal-token"]).toBe("test-internal-token");
    // Grok W4: AbortSignal present.
    expect(calledOptions.signal).toBeDefined();
    expect((calledOptions.signal as AbortSignal).constructor.name).toBe("AbortSignal");

    // Resend send: success email with attachment.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    const attachments = sendArgs.attachments as Array<{ content: unknown; contentType: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].contentType).toBe("application/pdf");
    expect(Buffer.isBuffer(attachments[0].content)).toBe(true);

    // No failure path triggered.
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("Grok W5: Supabase precheck short-circuits when status='active' (no fetch, dual-alert fires)", async () => {
    mockSupabaseStillActive();
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error_class).toBe("StrategyNotReady");
    expect(String(json.error_message)).toContain("status='active'");

    // Precheck short-circuits BEFORE the factsheet fetch.
    expect(fetchSpy).not.toHaveBeenCalled();

    // Both alerts fire (dual-alert pattern).
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const alertArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(String(alertArgs.subject)).toContain("[ALERT]");
  });

  it("PDF 4xx response triggers BOTH Sentry capture + Resend ALERT email", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseStatus(404, "Not Found"));

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(String(json.error_message)).toContain("404");

    // Sentry tag includes cron-failure + correlation_id.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const sentryArgs = captureExceptionMock.mock.calls[0][1] as { tags: Record<string, string> };
    expect(sentryArgs.tags["cron-failure"]).toBe("founder-lp-report");
    expect(sentryArgs.tags.correlation_id).toBe("11111111-1111-1111-1111-111111111111");

    // Resend ALERT email.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const alertArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(String(alertArgs.subject)).toContain("[ALERT]");
    expect(String(alertArgs.html)).toContain("404");
  });

  it("W1: 503 retry — cron retries once with Retry-After honor, then dual-alerts on 2nd 503", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseStatus(503, "Service Unavailable", { "retry-after": "1" }));
    fetchSpy.mockResolvedValueOnce(pdfResponseStatus(503, "Service Unavailable", { "retry-after": "1" }));

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    // W1: fetch called TWICE (initial + 1 retry).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const alertArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(String(alertArgs.subject)).toContain("[ALERT]");
  });

  it("Pitfall 7: Resend success-path throw still triggers Sentry capture + Resend alert", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseOk());

    sendMock.mockReset();
    // Success email throws (network down on first send).
    sendMock.mockRejectedValueOnce(new Error("network down"));
    // Alert email succeeds.
    sendMock.mockResolvedValueOnce({ data: { id: "msg_alert" } });

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    // Both Resend calls happened — success attempt then alert.
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("W7: Sentry mockImplementation throw doesn't suppress Resend alert (SENTRY_DSN remains set)", async () => {
    expect(process.env.SENTRY_DSN).toBe("test-dsn");
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseStatus(500, "Server Error"));

    captureExceptionMock.mockImplementation(() => {
      throw new Error("sentry down");
    });

    const res = await GET(buildAuthorizedRequest());
    expect(res.status).toBe(500);

    // Sentry threw, but Resend ALERT still fired (Pitfall 7).
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const alertArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(String(alertArgs.subject)).toContain("[ALERT]");
  });

  it("B4: double-failure escalation — BOTH alerts throw → console.error '[CRON_DOUBLE_FAILURE]'", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseStatus(500, "Server Error"));

    captureExceptionMock.mockImplementation(() => {
      throw new Error("sentry down");
    });
    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error("resend down"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await GET(buildAuthorizedRequest());
    expect(res.status).toBe(500);

    // [CRON_DOUBLE_FAILURE] surfaced in console.error.
    const calls = consoleErrorSpy.mock.calls.flat().map((c) => String(c));
    expect(calls.some((c) => c.includes("[CRON_DOUBLE_FAILURE]"))).toBe(true);

    consoleErrorSpy.mockRestore();
  });

  it("ConfigError: missing FOUNDER_LP_STRATEGY_ID returns 500 with Sentry+Resend alert", async () => {
    delete process.env.FOUNDER_LP_STRATEGY_ID;

    const { GET } = await import("./route");
    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error_class).toBe("ConfigError");

    // Both alerts fired.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------
  // Phase 18 / pre-landing review hardening (2026-05-07)
  // -------------------------------------------------------------------

  it("R6: under-1KB PDF body fails with PdfTooSmall — never emails empty PDF", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseTooSmall(512));

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error_class).toBe("PdfTooSmall");
    // Success-email path NEVER fires; only the alert path does.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const alertArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(String(alertArgs.subject)).toContain("[ALERT]");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("R7: over-25MB PDF body fails with PdfTooLarge — never emails outsize PDF", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(pdfResponseTooLarge(26_000_000));

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error_class).toBe("PdfTooLarge");
    // Success-email path NEVER fires; only the alert path does.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("R1: VERCEL_ENV='preview' short-circuits with 200 + skipped='non-production' (no fetch, no email)", async () => {
    process.env.VERCEL_ENV = "preview";
    vi.resetModules();
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.skipped).toBe("non-production");
    expect(json.vercel_env).toBe("preview");
    // No side effects on a non-production deploy.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("T3: Supabase select error branch (RLS denial / network) → StrategyNotReady + dual-alert", async () => {
    // Mock the SELECT to error rather than returning a wrong status. Covers
    // the `error || !data` branch in checkFounderStrategyReadiness — without
    // this test, a regression that swallowed the error would land silently.
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "PGRST116 row level security" } });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createAdminClient).mockReset();
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error_class).toBe("StrategyNotReady");
    expect(String(json.error_message)).toContain("PGRST116");
    // Network never touched — readiness short-circuit.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("R8 boundary: HTTP-date Retry-After header (parseInt → NaN) falls back to default cap, not infinite wait", async () => {
    vi.useFakeTimers();
    try {
      const { GET } = await import("./route");
      const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
      // Two 503s with HTTP-date Retry-After. parseInt of an HTTP-date is NaN —
      // the route's Number.isFinite gate must catch this and fall back to the
      // numeric default (10s), capped at MAX_RETRY_AFTER_S=20s.
      const httpDate = "Wed, 21 Oct 2026 07:28:00 GMT";
      fetchSpy.mockResolvedValueOnce(
        pdfResponseStatus(503, "Service Unavailable", { "retry-after": httpDate }),
      );
      fetchSpy.mockResolvedValueOnce(
        pdfResponseStatus(503, "Service Unavailable", { "retry-after": httpDate }),
      );

      const handlerPromise = GET(buildAuthorizedRequest());
      // Drive the retry's setTimeout(10s) virtually — no wall-clock wait.
      await vi.advanceTimersByTimeAsync(11_000);
      const res = await handlerPromise;
      const json = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(500);
      expect(json.ok).toBe(false);
      // Both fetches happened — the retry path engaged with sane fallback,
      // NOT a NaN-derived setTimeout that would have hung the lambda.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("R6 boundary: PDF exactly at MIN_PDF_BYTES-1 trips the empty guard; exactly at MIN_PDF_BYTES passes", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    // 1023 bytes — must trip the guard.
    fetchSpy.mockResolvedValueOnce(pdfResponseTooSmall(1023));
    const tooSmall = await GET(buildAuthorizedRequest());
    const tooSmallJson = (await tooSmall.json()) as Record<string, unknown>;
    expect(tooSmall.status).toBe(500);
    expect(tooSmallJson.error_class).toBe("PdfTooSmall");

    // Reset state for the second arm — fresh Resend mock since the alert path consumed one.
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "msg_test" } });
    captureExceptionMock.mockReset();

    // Exactly 1024 bytes — must pass the guard. Use the full 4096 fixture
    // since `pdfBuffer.length < MIN_PDF_BYTES` is the predicate; >=1024
    // passes. Pin the documented 1024 boundary explicitly so a regression
    // that bumped MIN_PDF_BYTES (or zeroed it) would trip this test.
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    } as unknown as Response);
    const ok = await GET(buildAuthorizedRequest());
    const okJson = (await ok.json()) as Record<string, unknown>;
    expect(ok.status).toBe(200);
    expect(okJson.pdf_bytes).toBe(1024);
  });

  it("ConfigError: NEXT_PUBLIC_APP_URL unset in production VERCEL_ENV is rejected early (silent-prod-misconfig)", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.resetModules();
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    const res = await GET(buildAuthorizedRequest());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error_class).toBe("ConfigError");
    expect(String(json.error_message)).toContain("NEXT_PUBLIC_APP_URL=false");
    // Never let a missing prod APP_URL silently fall through to localhost.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("S2: alert email HTML-escapes error_class and error_message (no XSS via upstream string)", async () => {
    const { GET } = await import("./route");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValueOnce(
      pdfResponseStatus(500, "<script>alert('xss')</script>"),
    );

    const res = await GET(buildAuthorizedRequest());
    expect(res.status).toBe(500);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const alertArgs = sendMock.mock.calls[0][0] as Record<string, unknown>;
    const html = String(alertArgs.html);
    // Raw `<script>` must not appear; the escaped form must.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
