/** @vitest-environment node */
/**
 * Phase 16 / OBSERV-03 — /api/webhooks/resend signature + 3-path correlation_id
 * recovery contract. Tests use a Svix-format synthetic secret (NEVER reads the
 * real RESEND_WEBHOOK_SECRET from env) and exercise the actual svix verify
 * path so a regression in the verify call shape is caught immediately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Webhook } from "svix";

vi.mock("server-only", () => ({}));

const mockMaybeSingle = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}));

// Svix secrets are base64-encoded and prefixed with "whsec_". Synthetic value
// for tests only — vi.stubEnv overrides any production secret during test runs.
const SECRET = "whsec_dGVzdC1zZWNyZXQtcGhhc2UtMTYtb2JzZXJ2LTAz"; // base64("test-secret-phase-16-observ-03")

function signedHeaders(
  rawBody: string,
  opts?: { staleTimestamp?: boolean },
): Record<string, string> {
  const wh = new Webhook(SECRET);
  const svixId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const ts = opts?.staleTimestamp
    ? Math.floor(Date.now() / 1000) - 60 * 60 // 1 hour stale
    : Math.floor(Date.now() / 1000);
  // svix.Webhook.sign(messageId, timestamp: Date, payload) -> "v1,<base64>"
  const sig = wh.sign(svixId, new Date(ts * 1000), rawBody);
  return {
    "svix-id": svixId,
    "svix-timestamp": String(ts),
    "svix-signature": sig,
    "content-type": "application/json",
  };
}

function makeReq(body: string, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  });
}

describe("[OBSERV-03] /api/webhooks/resend correlation_id round-trip (Svix-verified)", () => {
  let POST: typeof import("./route").POST;

  beforeEach(async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
    mockMaybeSingle.mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    ({ POST } = await import("./route"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects missing svix-signature header with 401", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const res = await POST(
      makeReq(body, { "content-type": "application/json" }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid signature with 401", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const res = await POST(
      makeReq(body, {
        "svix-id": "msg_x",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,deadbeef",
        "content-type": "application/json",
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  // Regression: WR-04 — svix verify failure must log the verifier exception
  // for ops triage. The bare `catch {}` previously discarded the reason
  // entirely. The 401 response shape is unchanged (no information disclosure
  // in the body); only the server-side log gains the diagnostic signal.
  it("[WR-04] svix verify failure logs the verifier exception for triage", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const body = JSON.stringify({ type: "email.delivered" });
    const res = await POST(
      makeReq(body, {
        "svix-id": "msg_x",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,deadbeef",
        "content-type": "application/json",
      }) as never,
    );
    expect(res.status).toBe(401);
    // Response body must NOT echo the verifier reason (information disclosure).
    const resJson = await res.json();
    expect(resJson).toEqual({ error: "Invalid signature" });
    // Server log MUST carry the prefix + a verifier reason.
    const verifyWarn = warnSpy.mock.calls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("[resend-webhook] svix verify failed:"),
    );
    expect(verifyWarn).toBeDefined();
    // The second arg should be a non-empty error message string.
    expect(typeof verifyWarn?.[1]).toBe("string");
    expect((verifyWarn?.[1] as string).length).toBeGreaterThan(0);
  });

  it("rejects stale timestamp (>5 min old) with 401", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const res = await POST(
      makeReq(body, signedHeaders(body, { staleTimestamp: true })) as never,
    );
    expect(res.status).toBe(401);
  });

  it("Path A: extracts correlation_id from tags array", async () => {
    const body = JSON.stringify({
      type: "email.delivered",
      data: {
        email_id: "msg-1",
        tags: [{ name: "correlation_id", value: "cid-A" }],
      },
    });
    const infoSpy = vi.spyOn(console, "info");
    const res = await POST(makeReq(body, signedHeaders(body)) as never);
    expect(res.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      "[resend-webhook] correlation_id recovered",
      expect.objectContaining({ path: "tags-array", correlation_id: "cid-A" }),
    );
  });

  it("Path A': extracts correlation_id from tags dict (defensive fallback)", async () => {
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "msg-2", tags: { correlation_id: "cid-B" } },
    });
    const infoSpy = vi.spyOn(console, "info");
    const res = await POST(makeReq(body, signedHeaders(body)) as never);
    expect(res.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      "[resend-webhook] correlation_id recovered",
      expect.objectContaining({ path: "tags-dict", correlation_id: "cid-B" }),
    );
  });

  it("Path B: falls back to mapping-table lookup when tags absent", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { correlation_id: "cid-C" },
      error: null,
    });
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "msg-3", tags: [] },
    });
    const infoSpy = vi.spyOn(console, "info");
    const res = await POST(makeReq(body, signedHeaders(body)) as never);
    expect(res.status).toBe(200);
    expect(mockMaybeSingle).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      "[resend-webhook] correlation_id recovered",
      expect.objectContaining({
        path: "mapping-table",
        correlation_id: "cid-C",
      }),
    );
  });

  it("logs unrecoverable warning when no path delivers a cid (still 200)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "msg-4", tags: [] },
    });
    const warnSpy = vi.spyOn(console, "warn");
    const res = await POST(makeReq(body, signedHeaders(body)) as never);
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      "[resend-webhook] correlation_id unrecoverable",
      expect.objectContaining({ email_id: "msg-4" }),
    );
  });
});
