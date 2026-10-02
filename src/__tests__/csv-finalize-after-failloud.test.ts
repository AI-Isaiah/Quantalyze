/**
 * D7 after()-fail-loud regression — csv-finalize/route.ts (Phase 106-04).
 *
 * WHY these tests exist: the four console.warn-only failure paths inside
 * csv-finalize's after() epilogue (placeholder upsert error/throw + enqueue
 * RPC error/throw) are fire-and-forget. A silent failure there leaves the
 * strategy stuck in `computing` (or with no terminal analytics row at all)
 * while the user's HTTP 200 already returned — zero trace beyond a Vercel log
 * line nobody watches. Pairing each warn with captureToSentry makes that
 * silent stuck-state ALERTABLE. Each test proves the capture fires (it does
 * NOT before the D7 change) AND that the console.warn is KEPT (Vercel log
 * parity — Sentry is ADDED alongside, never a replacement).
 *
 * Four paths (route anchors at plan time):
 *   1. placeholder upsert returned an error   → step "placeholder-upsert"
 *   2. placeholder upsert threw               → step "placeholder-upsert-throw"
 *   3. enqueue_compute_job RPC returned error → step "csv-analytics-enqueue"
 *   4. enqueue side-effect threw              → step "csv-analytics-enqueue-throw"
 *
 * ⚠️ RE-POINTED BY PHASE 145 (the fold): paths 1/2 used to reach the
 * placeholder writer through the persist-fail 500 arm; that arm DISSOLVED —
 * a failed `finalize_csv_strategy_with_returns` commits NOTHING, so there is
 * no strategy to placeholder and the wizard receives the 5xx directly. The
 * ONLY surviving caller of writeFailedStrategyAnalyticsPlaceholder is the
 * after() enqueue-error arm (window E — untouched by the fold), so paths 1/2
 * now drive the placeholder failure through it. The captures under test are
 * UNCHANGED.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── withAuth passthrough ──────────────────────────────────────────────────
vi.mock("@/lib/api/withAuth", () => ({
  withAuth: <H extends (req: unknown, user: unknown) => unknown>(handler: H) =>
    async (req: unknown) => handler(req, { id: "00000000-0000-0000-0000-000000000abc" }),
}));

const checkLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, retryAfter: 0 })),
);
vi.mock("@/lib/ratelimit", () => ({
  csvValidateLimiter: {},
  checkLimit: checkLimitMock,
}));

const NEW_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// server-client rpc: the Phase 145 fold (finalize_csv_strategy_with_returns).
// Default = succeeds with NEW_ID; the after()-arm failures are driven via the
// admin mocks below.
const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-user-jwt" } },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: Record<string, unknown>) => (rpcMock as any)(name, args),
    from: (_table: string) => ({
      update: (_payload: Record<string, unknown>) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({ error: null }),
        }),
      }),
      // CR-01: the route now probes `csv_daily_returns` for rows OUTSIDE the
      // incoming payload's date range before persisting (the cross-submission
      // merge fence). This double reports "nothing already stored", which is
      // the first-submit state every case in this file models.
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          or: (_filter: string) => ({
            limit: async (_n: number) => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }),
}));

// Admin client: `.rpc` is the enqueue_compute_job call; `.from` is the
// strategy_analytics placeholder select/upsert.
const adminRpcMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
);
const adminFromMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: adminRpcMock,
    from: (table: string) => adminFromMock(table),
  }),
}));

// Phase 145: the route no longer dispatches to /process-key (the fold is
// called directly on the SSR client). The mock is kept as a tripwire — if a
// regression re-introduced the dispatch, these tests would exercise it
// instead of the fold and their fold-call expectations would red.
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: vi.fn(async () => ({
    ok: true,
    status: 200,
    body: { ok: true, strategy_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  })),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// Capture after() callbacks so the enqueue epilogue can be driven explicitly.
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (cb: () => unknown) => {
      afterCallbacks.push(cb);
    },
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { captureToSentry } from "@/lib/sentry-capture";
import { POST } from "@/app/api/strategies/csv-finalize/route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
  });
}

const VALID_SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_SERIES = [{ date: "2024-01-01", daily_return: 0.01 }];

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wizard_session_id: VALID_SESSION,
    fmt: "daily_returns",
    strategy_name: "Test Strategy",
    daily_returns_series: VALID_SERIES,
    ...overrides,
  };
}

async function runAfters(): Promise<void> {
  const cbs = [...afterCallbacks];
  afterCallbacks.length = 0;
  for (const cb of cbs) await cb();
}

// strategy_analytics placeholder mock: select().eq().maybeSingle() +
// upsert(). Configurable to return an error, throw, or succeed.
function makeAnalyticsMock(opts: {
  selectResult?: { data: unknown; error: unknown };
  upsertResult?: { error: unknown };
  upsertThrows?: boolean;
}) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => opts.selectResult ?? { data: null, error: null },
      }),
    }),
    upsert: async () => {
      if (opts.upsertThrows) throw new Error("placeholder upsert boom");
      return opts.upsertResult ?? { error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function findCapture(step: string) {
  return vi
    .mocked(captureToSentry)
    .mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[1] as any)?.tags?.step === step,
    );
}

// ══════════════════════════════════════════════════════════════════════════

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  // Default server RPC: the fold succeeds.
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "finalize_csv_strategy_with_returns") {
      return { data: NEW_ID, error: null };
    }
    return { data: null, error: null };
  });
  adminRpcMock.mockResolvedValue({ error: null });
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("D7 fail-loud: placeholder upsert error is alertable (path 1)", () => {
  it("captures to Sentry (step placeholder-upsert) AND keeps the console.warn when the upsert returns an error", async () => {
    // Phase 145 re-point: drive the placeholder writer through its ONLY
    // surviving caller — the after() enqueue-error arm (the dissolved
    // persist-fail arm used to reach it in-request). enqueue fails → the
    // placeholder write runs; select finds no complete row, then the upsert
    // itself returns an error.
    adminRpcMock.mockResolvedValue({ error: { message: "enqueue failed" } });
    adminFromMock.mockReturnValue(
      makeAnalyticsMock({ upsertResult: { error: { message: "upsert failed" } } }),
    );

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200); // the enqueue arm is non-blocking (window E)
    await runAfters();

    // The warn is KEPT (Vercel log parity) — assert THIS arm's warn, not any warn.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("placeholder upsert failed (non-blocking)"),
    );
    // ...and the failure is alertable.
    const call = findCapture("placeholder-upsert");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.strategy_id).toBe(NEW_ID);
    expect(opts.extra.correlation_id).toBeTruthy();
  });
});

describe("D7 fail-loud: placeholder upsert throw is alertable (path 2)", () => {
  it("captures to Sentry (step placeholder-upsert-throw) AND keeps the console.warn when the upsert throws", async () => {
    // Phase 145 re-point — same driver change as path 1.
    adminRpcMock.mockResolvedValue({ error: { message: "enqueue failed" } });
    adminFromMock.mockReturnValue(makeAnalyticsMock({ upsertThrows: true }));

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    await runAfters();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("placeholder upsert threw (non-blocking)"),
    );
    const call = findCapture("placeholder-upsert-throw");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.strategy_id).toBe(NEW_ID);
    expect(opts.extra.correlation_id).toBeTruthy();
  });
});

describe("D7 fail-loud: enqueue RPC error is alertable (path 3)", () => {
  it("captures to Sentry (step csv-analytics-enqueue) AND keeps the console.warn when enqueue_compute_job returns an error", async () => {
    // persist succeeds → after() enqueue is scheduled; the enqueue RPC errors.
    adminRpcMock.mockResolvedValue({ error: { message: "enqueue failed" } });
    // Placeholder write after enqueue-error succeeds (isolate the enqueue capture).
    adminFromMock.mockReturnValue(makeAnalyticsMock({}));

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);

    await runAfters();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("enqueue_compute_analytics_from_csv failed (non-blocking)"),
    );
    const call = findCapture("csv-analytics-enqueue");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.strategy_id).toBe(NEW_ID);
    expect(opts.extra.correlation_id).toBeTruthy();
  });
});

describe("D7 fail-loud: enqueue side-effect throw is alertable (path 4)", () => {
  it("captures to Sentry (step csv-analytics-enqueue-throw) AND keeps the console.warn when the enqueue side-effect throws", async () => {
    adminRpcMock.mockRejectedValue(new Error("enqueue boom"));
    adminFromMock.mockReturnValue(makeAnalyticsMock({}));

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);

    await runAfters();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("enqueue side-effect threw (non-blocking)"),
    );
    const call = findCapture("csv-analytics-enqueue-throw");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.strategy_id).toBe(NEW_ID);
    expect(opts.extra.correlation_id).toBeTruthy();
  });
});
