import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// `import "server-only"` throws in jsdom; the email module is mocked below but
// keep the same guard the sibling cron route tests carry.
vi.mock("server-only", () => ({}));

const notifyFounderGeneric = vi.fn();
const founderEmail = vi.fn();
vi.mock("@/lib/email", () => ({
  // The real escape, so the HTML-in-detail test proves real escaping rather
  // than a mock that passes everything through.
  escapeHtml: (input: string) =>
    input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"),
  founderEmail: () => founderEmail(),
  notifyFounderGeneric: (...args: unknown[]) => notifyFounderGeneric(...args),
}));

const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
}));

/**
 * /api/cron/ops-alert (Phase 164.6.8 OUTAGEALERT plan 01, D-01).
 *
 * WHY each property matters: the route is reachable by anyone and bypasses the
 * session proxy, so its own auth is the only gate (a forged alert could spam or
 * socially engineer the founder); and a 2xx that sent nothing is the one
 * failure an alert channel must never have.
 */

const KEY = "test-analytics-service-key-not-real";

function validBody(over: Record<string, unknown> = {}) {
  return {
    source: "prod_prober",
    event: "outage",
    cause: "cadence_gap",
    since: "2026-10-13T08:00:00+00:00",
    detected_at: "2026-10-13T12:00:00.123456+00:00",
    detail: "cron_name=prod_prober last contact 625 min ago",
    ...over,
  };
}

function makeReq(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/ops-alert", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const authed = { authorization: `Bearer ${KEY}` };

describe("POST /api/cron/ops-alert", () => {
  const originalKey = process.env.ANALYTICS_SERVICE_KEY;

  beforeEach(() => {
    process.env.ANALYTICS_SERVICE_KEY = KEY;
    founderEmail.mockReturnValue("founder@example.test");
    notifyFounderGeneric.mockResolvedValue(undefined);
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalKey) process.env.ANALYTICS_SERVICE_KEY = originalKey;
    else delete process.env.ANALYTICS_SERVICE_KEY;
  });

  async function post(req: NextRequest) {
    const mod = await import("./route");
    return mod.POST(req);
  }

  it("turns a valid authenticated body into exactly one founder email", async () => {
    const res = await post(makeReq(validBody(), authed));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(notifyFounderGeneric).toHaveBeenCalledTimes(1);
    const [subject, html, opts] = notifyFounderGeneric.mock.calls[0];
    expect(subject).toBe("[OUTAGE] prod_prober: cadence_gap");
    expect(html).toContain("prod_prober");
    // A skipped or failed send must surface as non-2xx, never as sent.
    expect(opts).toEqual({ throwOnSkip: true, throwOnFailure: true });
  });

  it("answers 401 for a wrong key and sends nothing", async () => {
    const res = await post(
      makeReq(validBody(), { authorization: "Bearer not-the-key" }),
    );

    expect(res.status).toBe(401);
    expect(notifyFounderGeneric).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(KEY);
  });

  it("fails closed (401) when ANALYTICS_SERVICE_KEY is unset, even for 'Bearer undefined'", async () => {
    delete process.env.ANALYTICS_SERVICE_KEY;

    const res = await post(makeReq(validBody(), { authorization: "Bearer undefined" }));

    expect(res.status).toBe(401);
    expect(notifyFounderGeneric).not.toHaveBeenCalled();
  });

  it("answers 401 when the Authorization header is missing", async () => {
    const res = await post(makeReq(validBody()));

    expect(res.status).toBe(401);
    expect(notifyFounderGeneric).not.toHaveBeenCalled();
  });

  it("answers 400 for a source outside the closed set and never echoes the body", async () => {
    const res = await post(
      makeReq(validBody({ source: "attacker_chosen_source_xyz" }), authed),
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("attacker_chosen");
    expect(notifyFounderGeneric).not.toHaveBeenCalled();
  });

  it.each([
    ["cause with a space", { cause: "has space" }],
    ["cause over 64 chars", { cause: "a".repeat(65) }],
    ["unknown event", { event: "exploded" }],
    ["detail over 2000 chars", { detail: "x".repeat(2001) }],
    ["detected_at not ISO", { detected_at: "yesterday" }],
  ])("answers 400 for %s", async (_name, over) => {
    const res = await post(makeReq(validBody(over), authed));

    expect(res.status).toBe(400);
    expect(notifyFounderGeneric).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    const res = await post(makeReq("not json {", authed));

    expect(res.status).toBe(400);
  });

  it("accepts a null since and a recovered event", async () => {
    const res = await post(
      makeReq(validBody({ since: null, event: "recovered" }), authed),
    );

    expect(res.status).toBe(200);
    expect(notifyFounderGeneric.mock.calls[0][0]).toBe(
      "[RECOVERED] prod_prober: cadence_gap",
    );
  });

  it("escapes HTML in the detail before it reaches the email", async () => {
    // The detail is derived from system state and may carry markup; an
    // unescaped tag in a founder email is an injection into the founder's inbox.
    const res = await post(
      makeReq(validBody({ detail: '<img src=x onerror="alert(1)">&' }), authed),
    );

    expect(res.status).toBe(200);
    const html = notifyFounderGeneric.mock.calls[0][1] as string;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
  });

  it("answers 503 and sends nothing when the founder recipient is not configured", async () => {
    // notifyFounderGeneric returns silently on an empty recipient, so without
    // this check the route would answer { sent: true } having sent nothing.
    founderEmail.mockReturnValue("");

    const res = await post(makeReq(validBody(), authed));

    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty("sent");
    expect(notifyFounderGeneric).not.toHaveBeenCalled();
  });

  it("answers 502 when the email send throws, without leaking the error", async () => {
    notifyFounderGeneric.mockRejectedValue(new Error("resend said: secret-detail-xyz"));

    const res = await post(makeReq(validBody(), authed));

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret-detail-xyz");
  });
});
