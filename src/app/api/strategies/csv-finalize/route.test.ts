/**
 * CONTRIB-02 (Phase 110) — csv-finalize contribution branch.
 *
 * The allocator contribution overlay POSTs `entry_context: "contribution"` to
 * this route. The contribution must finalize to an owner-only status='private'
 * (never 'pending_review').
 *
 * ⚠️ RE-POINTED BY PHASE 145 (D-06 option i-b): BOTH flows now call the
 * folded `finalize_csv_strategy_with_returns` RPC directly on the SSR
 * user-scoped client — the contribution with p_terminal_status='private'
 * (the D-08 wire half this file is the gate for), the manager flow with
 * 'pending_review'. Neither flow dispatches to /process-key any more (the
 * Python csv-finalize branch was deleted; Phase 106 Stage B's ruling was
 * consciously reversed — 145-DECISION.md). The dailies ride the fold's
 * p_rows argument in the SAME transaction as the strategy row.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── withAuth passthrough ──────────────────────────────────────────────────
const TEST_USER_ID = "00000000-0000-0000-0000-000000000abc";
vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    <H extends (req: unknown, user: unknown) => unknown>(handler: H) =>
    async (req: unknown) =>
      handler(req, { id: TEST_USER_ID }),
}));

const checkLimitMock = vi.hoisted(() =>
  // 140.4-13 / SEAMRIM-05 — `reason` is the THIRD outcome: absent is a genuine
  // throttle (429), "ratelimit_misconfigured" is OUR store being unreachable
  // and must answer 503.
  vi.fn(
    async (): Promise<{
      success: boolean;
      retryAfter: number;
      reason?: "ratelimit_misconfigured";
    }> => ({ success: true, retryAfter: 0 }),
  ),
);
// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). The pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision —
// a hand-written double that always answered 429 would make this file green on
// the exact bug the plan closes.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    csvValidateLimiter: {},
    checkLimit: checkLimitMock,
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

// rpc mock records (name, args); default returns a valid strategy_id so the
// folded `finalize_csv_strategy_with_returns` call succeeds. (Was "so both the
// finalize_csv_strategy and persist_csv_daily_returns calls succeed" —
// migration 20260819120000:349-350 DROPped both of those; the fold is one RPC.)
const NEW_STRATEGY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
// OPS-06 (Phase 163): one interleaved log of admin-client constructions and
// fold dispatches. Ordering IS the defect, and an ordering claim needs an
// ordering oracle — two independent call counts cannot tell "constructed"
// from "constructed before the commit".
const callOrder = vi.hoisted(() => [] as string[]);
const rpcMock = vi.hoisted(() =>
  vi.fn(
    async (
      _name?: string,
      _args?: Record<string, unknown>,
    ): Promise<{
      data: string | null;
      error: { code?: string; message?: string } | null;
    }> => ({ data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", error: null }),
  ),
);
const updateMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-user-jwt" } },
      }),
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      callOrder.push(`rpc:${name}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (rpcMock as any)(name, args);
    },
    from: (_table: string) => ({
      update: (_payload: Record<string, unknown>) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => updateMock(),
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

const adminFromMock = vi.hoisted(() => vi.fn());
// WR-07 (Phase 163): promoted out of the inline `vi.fn(async () => …)` below
// for the same reason OPS-06 promoted the constructor — a double that can only
// SUCCEED cannot express the fault. The service-role `enqueue_compute_job`
// call is the one that raises 40001 when it loses the in-flight race, and a
// test has to be able to make it do that.
const adminRpcMock = vi.hoisted(() =>
  vi.fn(
    async (
      _name?: string,
      _args?: Record<string, unknown>,
    ): Promise<{ error: { code?: string; message?: string } | null }> => ({
      error: null,
    }),
  ),
);
// OPS-06 (Phase 163): promoted from an inline arrow to a hoisted vi.fn so a
// test can make the CONSTRUCTOR throw the way the real one does on a missing
// SUPABASE_SERVICE_ROLE_KEY, and so its invocation ORDER relative to the fold
// RPC is observable. A double that can only succeed cannot express the fault
// this route was fixed for.
const createAdminClientMock = vi.hoisted(() =>
  vi.fn(() => {
    callOrder.push("createAdminClient");
    return {
      rpc: adminRpcMock,
      from: (table: string) => adminFromMock(table),
    };
  }),
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

// 140.3-02 / TS-13 — the upstream body carries `ok: true`, because the real
// Python builder does (`process_key.py`, the csv-finalize return:
// `{ok, strategy_id, status, correlation_id, step}`). This double previously
// omitted it, which made it a fake that disagreed with the contract it stands
// in for; the route now reads the discriminator, so the fixture is corrected
// rather than the guard weakened.
// The `body` is typed as an open record rather than left to inference: the
// upstream envelope is a WIRE shape with many optional keys, and inferring it
// from this one default would make every other fixture in the file a type error
// for carrying a key the default happens not to use.
const postProcessKeyMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      ok: boolean;
      status: number;
      body: Record<string, unknown>;
    }> => ({
      ok: true,
      status: 200,
      body: {
        ok: true,
        strategy_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        status: "pending_review",
      },
    }),
  ),
);
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: postProcessKeyMock,
}));

process.env.INTERNAL_API_TOKEN = "test-internal-token";

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// 146.2-06 / T-146.2-12 — the finalize audit emission, mocked out HERE for a
// specific reason: `logAuditEventAsUser` also schedules through `after()`, so
// leaving it real would make `afterMock`'s call COUNT below mean "enqueue plus
// audit" instead of "enqueue". Mocking it keeps that count a statement about
// the analytics enqueue, which is what the assertion is named for — and gives
// this file its own handle on the emission (asserted directly below).
const logAuditEventAsUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({
  logAuditEventAsUser: logAuditEventAsUserMock,
}));

// Capture after() scheduling so we can assert the analytics enqueue is queued.
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: afterMock };
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/strategies/csv-finalize/route";
import { captureToSentry } from "@/lib/sentry-capture";

const VALID_SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_SERIES = [{ date: "2024-01-01", daily_return: 0.01 }];

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wizard_session_id: VALID_SESSION,
    fmt: "daily_returns",
    strategy_name: "Test Strategy",
    daily_returns_series: VALID_SERIES,
    ...overrides,
  };
}

function rpcCall(name: string) {
  return rpcMock.mock.calls.find((c) => c[0] === name) as
    | [string, Record<string, unknown>]
    | undefined;
}

describe("POST /api/strategies/csv-finalize — CONTRIB-02 private-by-default contribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
    // 140.3-02 / TS-13 — `ok: true` added to match the real Python builder; see
    // the note on postProcessKeyMock's hoisted default.
    postProcessKeyMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, strategy_id: NEW_STRATEGY_ID, status: "pending_review" },
    });
  });

  /**
   * 140.4-13 / SEAMRIM-05 — the limiter deny arm, all three outcomes.
   *
   * This is the CSV submit step. A 429 here reads as "you are submitting too
   * fast"; during an Upstash outage it was emitted on the FIRST submit, and the
   * user's next move — retry — could not succeed either.
   */
  describe("[140.4-13 / SEAMRIM-05] the limiter deny arm", () => {
    it("ratelimit_misconfigured → 503 in the SAME v0 envelope, code SEAM_MISCONFIGURED", async () => {
      checkLimitMock.mockResolvedValue({
        success: false,
        retryAfter: 60,
        reason: "ratelimit_misconfigured",
      });

      const res = await POST(makeRequest(validBody()));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe("SEAM_MISCONFIGURED");
      expect(body.code).not.toBe("CSV_RATE_LIMIT");
      expect(body.human_message).toContain("fault on our side");
      // The correlation_id is the REAL per-request one, not the `null` the
      // csv-validate envelope carries — that difference is pre-existing and
      // must survive the adoption.
      expect(typeof body.correlation_id).toBe("string");
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(postProcessKeyMock).not.toHaveBeenCalled();
      expect(rpcCall("finalize_csv_strategy_with_returns")).toBeUndefined();
    });

    it("a genuine throttle → 429 with the BYTE-IDENTICAL v0 envelope", async () => {
      checkLimitMock.mockResolvedValue({ success: false, retryAfter: 25 });

      const res = await POST(makeRequest(validBody()));

      expect(res.status).toBe(429);
      const body = await res.json();
      // Hand-typed from the pre-adoption source — all five fields, same order.
      expect(body.ok).toBe(false);
      expect(body.code).toBe("CSV_RATE_LIMIT");
      expect(body.human_message).toBe(
        "Too many requests. Wait a minute and try again.",
      );
      expect(body.debug_context).toEqual({});
      expect(typeof body.correlation_id).toBe("string");
      expect(res.headers.get("Retry-After")).toBe("25");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(postProcessKeyMock).not.toHaveBeenCalled();
    });

    it("success → the deny arm does not fire", async () => {
      checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });

      const res = await POST(makeRequest(validBody()));

      expect(res.status).not.toBe(429);
      expect(res.status).not.toBe(503);
      // Phase 145: the side-effecting work the limiter fences is the fold.
      expect(rpcCall("finalize_csv_strategy_with_returns")).toBeDefined();
    });
  });

  it("default body (no entry_context) → the fold DIRECTLY with p_terminal_status='pending_review', no /process-key dispatch", async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);
    expect(body.status).toBe("pending_review");
    // Phase 145 (D-06 i-b): the manager flow no longer rides the unified
    // backbone — a postProcessKey dispatch here would be the second-writer
    // regression the decision file names.
    expect(postProcessKeyMock).not.toHaveBeenCalled();
    const finalize = rpcCall("finalize_csv_strategy_with_returns");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_terminal_status).toBe("pending_review");
    // The dailies ride the SAME call (one transaction — D-07).
    expect(finalize![1].p_rows).toEqual(VALID_SERIES);
  });

  it("entry_context='contribution' → calls the fold directly with p_terminal_status='private' and returns status='private'", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("private");
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);

    // The contribution never rides /process-key.
    expect(postProcessKeyMock).not.toHaveBeenCalled();
    // SC#3 wire half (D-08): 'private' passes VERBATIM to the fold.
    const finalize = rpcCall("finalize_csv_strategy_with_returns");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_terminal_status).toBe("private");
    expect(finalize![1].p_user_id).toBe(TEST_USER_ID);
    expect(finalize![1].p_wizard_session_id).toBe(VALID_SESSION);
  });

  it("contribution KEEPS the daily-series + analytics enqueue (dailies are canonical → the allocator needs KPIs)", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);
    // The series persists INSIDE the fold call (p_rows — Phase 145 D-07).
    const finalize = rpcCall("finalize_csv_strategy_with_returns");
    expect(finalize).toBeDefined();
    expect(finalize![1].p_rows).toEqual(VALID_SERIES);
    // The compute_analytics enqueue is scheduled via after(). The audit
    // emission is mocked out above, so this count is still a statement about
    // the ENQUEUE and nothing else — that is why the mock exists.
    expect(afterMock).toHaveBeenCalledTimes(1);
    // 146.2-06 — and the commit is attributable. The contribution flow is a
    // FRESH create, so it carries the same forensic obligation as the manager
    // flow; a per-flow gap here would mean owner-only contributions were the
    // one strategy creation nobody could audit.
    expect(
      logAuditEventAsUserMock,
      "a contribution finalize committed a track record with no forensic row — the audit obligation is per-CREATE, not per-flow",
    ).toHaveBeenCalledTimes(1);
    expect(
      (logAuditEventAsUserMock.mock.calls[0] as unknown[])[2],
    ).toMatchObject({
      action: "strategy.csv_finalize",
      entity_type: "strategy",
      entity_id: NEW_STRATEGY_ID,
    });
  });

  it("contribution fold RPC error → 500 CSV_FINALIZE_FAIL (nothing saved — the fold rolled back), no orphaned success", async () => {
    // The fold raises (e.g. its 22023 guard) — the shared fold-failure arm
    // answers the single 5xx (Phase 145: the pre-fold 422 arm collapsed into
    // it; both handlers share ONE failure shape now).
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "boom" },
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    // D-11: the copy states the TRUE transaction outcome — nothing survived.
    expect(String(body.human_message)).toContain("Nothing was saved");
    // D-12: the fold failure is captured with the folded step tag.
    //
    // 146.1-05 / A3 — this case KEEPS `finalize-fold-fail`, and that is the
    // discrimination: a 5-character SQLSTATE means PostgREST returned a body,
    // so the fold ran and RAISEd, and with no handler clause the whole
    // transaction rolled back. Paired with the F-OBS case below (which moved
    // to `finalize-fold-outcome-unknown`), the two prove the split is real
    // rather than a blanket rename.
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "22023" }),
      expect.objectContaining({
        extra: expect.objectContaining({ outcome_class: "rolled-back" }),
        tags: expect.objectContaining({
          surface: "csv-finalize",
          step: "finalize-fold-fail",
        }),
      }),
    );
    consoleErr.mockRestore();
  });

  it("F-OBS — fold returns a NON-UUID (contract violation) → 500 + Sentry capture, no downstream write", async () => {
    // The RPC returns 200 + a non-uuid strategy id — a return-shape contract
    // violation. The handler must still fail closed AND alert: a silently
    // drifted SQL return shape is worth a Sentry signal.
    rpcMock.mockResolvedValueOnce({ data: "not-a-uuid", error: null });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    // No orphaned downstream write on the contract-violation path: the
    // metadata UPDATE runs only after a successful outcome (Pitfall 6).
    expect(updateMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
    // Captured with a synthesized Error (no rpc error object).
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
    // ⚠️ 146.1-05 / A3 — THE STEP TAG MOVED, DELIBERATELY, AND THIS IS THE
    // CLASS THAT MOVED IT. `!error` plus a non-UUID return is a 2xx from
    // PostgREST: the transaction COMMITTED and only the strategy id failed to
    // reach us. Bucketing that under `finalize-fold-fail` — beside the
    // SQLSTATE raises, which really did roll back — merged an outcome that
    // may have left a live strategy row with outcomes that provably did not.
    // The commit-agnostic classes now carry their own tag so the honest arm's
    // firing rate is measurable, and `outcome_class` names which one fired.
    expect(vi.mocked(captureToSentry)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        // ONE `extra` key. The first draft of this edit added a second one
        // beside the existing `rpc_error_code` assertion; vitest took the
        // LAST literal and silently dropped the `outcome_class` check, so the
        // test passed while asserting nothing new. `tsc` (TS1117) caught it.
        extra: expect.objectContaining({
          rpc_error_code: null,
          outcome_class: "committed-lost-id",
        }),
        tags: expect.objectContaining({
          step: "finalize-fold-outcome-unknown",
        }),
      }),
    );
    consoleErr.mockRestore();
  });

  it("invalid entry_context → 400 CSV_INVALID_FORMAT before any finalize RPC", async () => {
    const res = await POST(
      makeRequest(validBody({ entry_context: "garbage" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(String(body.human_message)).toContain("entry_context");
    expect(rpcCall("finalize_csv_strategy_with_returns")).toBeUndefined();
    expect(postProcessKeyMock).not.toHaveBeenCalled();
  });
});

/**
 * Phase 140.3-02 / TS-13 + TS-14, re-pointed by Phase 145 — the finalize
 * handler validates the PAYLOAD of the fold call, never just error-null.
 *
 * The pre-145 version of this describe drove the upstream /process-key
 * envelope's `ok` discriminator; that seam dissolved with the fold (the route
 * calls the RPC directly), and TS-13's surviving discipline is the success
 * check `(error || !isUuid(id))` on the RPC result:
 *   · an RPC-level error must never be re-stamped as success, even when a
 *     well-formed id rides beside it;
 *   · `isUuid` is DEFENCE IN DEPTH against drift — a 2xx whose data lost or
 *     mistyped the id. Emitting `ok: true` for a body with no usable
 *     strategy_id leaves the wizard's SyncProgress poller hitting
 *     `if (!data) return` forever (API H-1).
 */
describe("[140.3-02 / TS-13, re-pointed by 145] POST /api/strategies/csv-finalize — fold success check validates the payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
  });

  it("an RPC error is NEVER re-stamped `ok: true`, even with a well-formed strategy_id beside it", async () => {
    rpcMock.mockResolvedValueOnce({
      // A VALID uuid — so the isUuid guard alone cannot catch this.
      data: NEW_STRATEGY_ID,
      error: { code: "XX000", message: "fold failed after returning" },
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(
      body.ok,
      "Deciding the success path by `isUuid(strategy_id)` alone turns an RPC " +
        "FAILURE that happens to carry an id into a reported success — TS-13.",
    ).toBe(false);
    expect(res.status).toBe(500);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    consoleErr.mockRestore();
  });

  it("PIN — isUuid still refuses a 2xx whose strategy_id is not a UUID (defence in depth, kept)", async () => {
    rpcMock.mockResolvedValueOnce({ data: "not-a-uuid", error: null });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    consoleErr.mockRestore();
  });

  it("the real finalize success (no error + a UUID) still returns 200 with the route's own ok:true", async () => {
    rpcMock.mockResolvedValueOnce({ data: NEW_STRATEGY_ID, error: null });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(NEW_STRATEGY_ID);
    expect(body.status).toBe("pending_review");
  });
});

/**
 * OPS-06 (Phase 163) — THE ADMIN CLIENT IS CONSTRUCTED BEFORE THE FOLD.
 *
 * This is the WR-01 headline site. `createAdminClient()` throws synchronously
 * when SUPABASE_SERVICE_ROLE_KEY is absent, and a call argument is evaluated
 * BEFORE the call — so building it inside `logAuditEventAsUser(...)` put the
 * throw AFTER `finalize_csv_strategy_with_returns` had committed a strategy,
 * its verification row and its whole daily-returns series in one transaction.
 * The user was told their upload failed while the track record existed: the
 * exact inverse of the emit docblock's own promise that "a failed emission …
 * must NOT change this response".
 *
 * ⭐ RED DEMO (run 2026-08-26, restored after):
 *   Neuter: in route.ts, delete `const admin = createAdminClient()` from above
 *   the `supabase.rpc("finalize_csv_strategy_with_returns", ...)` call and pass
 *   `createAdminClient()` inline at the `logAuditEventAsUser(...)` emit site
 *   again — i.e. move construction back below the commit.
 *   Observed: "constructs the admin client BEFORE the fold RPC" FAILED —
 *   callOrder came back ["rpc:finalize_csv_strategy_with_returns",
 *   "createAdminClient"]; "a missing service-role key never reaches the fold"
 *   FAILED with the fold recorded as dispatched. Restored: both green.
 *
 *   SECOND MUTATION — THE HALF-FIX (run 2026-08-26, restored after):
 *   Keep the hoist but ALSO write `createAdminClient()` inline at the emit
 *   site. Every ordering assertion above still passes (a client WAS built
 *   before the fold) while the original post-commit throw is untouched.
 *   Observed: "the emit receives the SAME instance that was built pre-commit"
 *   FAILED — "expected vi.fn() to be called 1 times, but got 2 times".
 *   That case exists solely to kill this shape.
 */
describe("[OPS-06] csv-finalize: a missing service-role key fails LOUD and PRE-COMMIT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
  });

  it("constructs the admin client BEFORE the fold RPC (order, not count)", async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);

    const built = callOrder.indexOf("createAdminClient");
    const committed = callOrder.indexOf("rpc:finalize_csv_strategy_with_returns");
    expect(built, "admin client was never constructed").toBeGreaterThanOrEqual(0);
    expect(committed, "fold RPC was never dispatched").toBeGreaterThanOrEqual(0);
    expect(
      built,
      `expected construction before the commit; got ${JSON.stringify(callOrder)}`,
    ).toBeLessThan(committed);
  });

  it("a missing service-role key never reaches the fold — no strategy, no verification row, no dailies", async () => {
    createAdminClientMock.mockImplementationOnce(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
    });

    // The route deliberately has no try/catch around the constructor, and
    // `withAuth` has none either: an uncaught throw in a route handler IS the
    // Next.js 500. The fix changes WHEN it fires, not how loud it is.
    await expect(POST(makeRequest(validBody()))).rejects.toThrow(
      /Missing SUPABASE_SERVICE_ROLE_KEY/,
    );

    // The load-bearing assertion. Pre-fix the fold had already committed when
    // the constructor threw — a 500 handed to a user whose track record is live.
    expect(
      rpcMock.mock.calls.find((c) => c[0] === "finalize_csv_strategy_with_returns"),
      "the fold committed before the throw — the pre-fix behaviour",
    ).toBeUndefined();
    expect(logAuditEventAsUserMock).not.toHaveBeenCalled();
  });

  it("the emit receives the SAME instance that was built pre-commit — exactly one construction per request", async () => {
    // Closes the near-miss fix. Hoisting a client and THEN still writing
    // `createAdminClient()` at the emit site would satisfy every ordering
    // assertion above while leaving the original throw exactly where it was:
    // after the fold. Pinning identity plus a call count of one makes that
    // half-fix impossible to pass.
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);

    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
    const built = createAdminClientMock.mock.results[0].value;
    expect(logAuditEventAsUserMock).toHaveBeenCalledTimes(1);
    expect(
      (logAuditEventAsUserMock.mock.calls[0] as unknown[])[0],
      "the emit built its own client instead of using the pre-commit one",
    ).toBe(built);
  });

  // ⚠️ THE "EMISSION FAILURE DOES NOT CHANGE THE RESPONSE" HALF IS NOT TESTED
  // HERE, AND THAT IS DELIBERATE. This file mocks `@/lib/audit` wholesale (see
  // the note on logAuditEventAsUserMock — it has to, or afterMock's call count
  // stops meaning "the enqueue"). A double made to throw would therefore be
  // asserting against a fault the real function cannot produce:
  // `logAuditEventAsUser` wraps its `after()` scheduling in try/catch and falls
  // back to queueMicrotask, and `emitAsUser`'s rejection is swallowed by
  // `.catch(() => {})` — it is total by construction. Measured while writing
  // this: a synchronously-throwing double DOES escape the handler, but no
  // production input can produce one, so pinning it would manufacture a
  // failure rather than guard a real one. That half is covered where the REAL
  // audit module runs: preferences route.test.ts TC13, and the deletion-request
  // OPS-06 case that drives the service-role RPC to throw.
});

/**
 * WR-07 (Phase 163) — THE ENQUEUE'S ERROR TEXT IS SOMETHING A USER READS.
 *
 * `strategy_analytics.computation_error` is a USER-VISIBLE column — the wizard
 * failure envelope renders it VERBATIM to the strategy's owner. The enqueue
 * failure path built `compute job enqueue failed: ${message}` for EVERY
 * failure shape, unconditionally. So when mig 20260826150000 began
 * classifying a lost in-flight race as SQLSTATE 40001 carrying an operator
 * sentence, that sentence reached the owner with operator jargon bolted to the
 * front of it. Because the prefix was unconditional, NO wording chosen inside
 * SQL could reach the user unprefixed — which is why that migration recorded
 * WR-07 as owed HERE rather than rewording its own RAISE.
 *
 * ⚠️ WHAT IS ASSERTED, AND WHY IT IS NOT THE IMPLEMENTATION. These cases read
 * the STRING THAT REACHES THE COLUMN and check it is free of operator jargon
 * and free of a retry promise. They deliberately do NOT assert "the 40001
 * branch was taken" or "the constant was read" — an assertion shaped like the
 * fix survives the defect it is meant to catch. The exact-equality oracle is
 * INDEPENDENT of route.ts: it is parsed out of
 * supabase/schema/functions/computation_error_copy.sql, so a route that
 * invented its own sentence fails here even if that sentence were jargon-free.
 *
 * ⛔ AND THE COPY MUST NOT PROMISE AN AUTOMATIC RETRY. The review that raised
 * WR-07 proposed "…and will retry automatically". Nothing in this repo retries
 * a 40001 — the one classifier that recognises the code
 * (analytics-service/main_worker.py:392) has a single call site, wrapping the
 * MARK RPCs, never an enqueue. That wording would trade operator jargon for a
 * FALSE PROMISE, which is the same honesty defect one layer along rather than
 * a fix for it. The /automatic/i assertion exists to keep it out.
 *
 * ⭐ RED DEMO — see the per-case notes at the end of this describe.
 */

/**
 * The oracle. Parsed from the @generated canonical dump of
 * `computation_error_copy(TEXT)` (mig 20260826120000, Phase 162 HONEST-01),
 * whose ELSE arm is the project's cautious default: it claims nothing about
 * automatic retries, which is exactly what makes it true of a lost enqueue
 * race. Read at module scope so a parse failure is LOUD (the whole file fails
 * to load) rather than silently yielding "" and making `toBe("")` vacuous.
 */
const CURATED_DEFAULT_COPY: string = (() => {
  const path = resolve(
    process.cwd(),
    "supabase/schema/functions/computation_error_copy.sql",
  );
  const sql = readFileSync(path, "utf8");
  // The arms are `WHEN '<kind>' THEN\n  '<sentence>'`; the last is a bare
  // `ELSE`. `ELSE` is upper-case in code and the only prose occurrence is
  // lower-case ("Anything else:"), so this cannot match a comment.
  const arm = sql.match(/\bELSE\s*\n\s*'([^']+)'/);
  if (!arm) {
    throw new Error(
      `WR-07 oracle: could not parse the ELSE arm out of ${path}. If the dump ` +
        `format changed, re-point this parse — do NOT delete it, or the route's ` +
        `literal loses its only tie to the SQL it is a copy of.`,
    );
  }
  return arm[1];
})();

describe("[WR-07] csv-finalize: a lost enqueue race tells the OWNER something true", () => {
  const placeholderUpserts: Array<Record<string, unknown>> = [];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  /** The admin double for the W-2 placeholder write: SELECT-then-UPSERT. */
  function installStrategyAnalyticsDouble(
    existing: { computation_status?: string } | null = null,
  ): void {
    adminFromMock.mockImplementation((table: string) => {
      if (table !== "strategy_analytics") {
        throw new Error(
          `WR-07 double: unexpected admin table on the enqueue path: ${table}`,
        );
      }
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            maybeSingle: async () => ({ data: existing, error: null }),
          }),
        }),
        upsert: async (
          payload: Record<string, unknown>,
          _opts: Record<string, unknown>,
        ) => {
          placeholderUpserts.push(payload);
          return { error: null };
        },
      };
    });
  }

  /**
   * The enqueue runs in `after()`, which this file mocks — so the scheduled
   * work only happens if a test RUNS it. Driving the real callback (rather
   * than calling the helper directly) keeps the enqueue → classify →
   * placeholder chain intact, which is where the defect lived.
   */
  async function runScheduledEnqueue(): Promise<void> {
    expect(afterMock, "the analytics enqueue was never scheduled").toHaveBeenCalledTimes(1);
    const scheduled = (afterMock.mock.calls[0] as unknown[])[0] as () => Promise<void>;
    await scheduled();
  }

  /** The single string the strategy's owner ends up reading. */
  function copyWrittenToUser(): string {
    expect(
      placeholderUpserts,
      "no strategy_analytics placeholder was written — the wizard poller would spin forever (API W-2)",
    ).toHaveLength(1);
    const row = placeholderUpserts[0];
    expect(row.computation_status).toBe("failed");
    return String(row.computation_error);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    placeholderUpserts.length = 0;
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    rpcMock.mockResolvedValue({ data: NEW_STRATEGY_ID, error: null });
    updateMock.mockResolvedValue({ error: null });
    adminRpcMock.mockResolvedValue({ error: null });
    installStrategyAnalyticsDouble();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("the oracle is a real sentence, not an empty match", () => {
    // Anti-vacuity: every exact-equality assertion below is against
    // CURATED_DEFAULT_COPY, so a regex that matched nothing useful would make
    // them all trivially agreeable. Pin the shape of the parsed arm itself.
    expect(CURATED_DEFAULT_COPY.length).toBeGreaterThan(40);
    expect(CURATED_DEFAULT_COPY).toContain("Retry the sync");
    expect(CURATED_DEFAULT_COPY).not.toMatch(/automatic/i);
  });

  it("a 40001 lost race → the owner reads curated copy: no operator jargon, no SQL text, no promise of an automatic retry", async () => {
    adminRpcMock.mockResolvedValueOnce({
      error: {
        code: "40001",
        // Shaped like the real RAISE in mig 20260826150000: operator text,
        // deliberately carrying no ids.
        message: "enqueue lost the in-flight race; the winner already advanced",
      },
    });

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    await runScheduledEnqueue();

    const copy = copyWrittenToUser();

    // ── the load-bearing assertions: a property of what the USER READS ──
    expect(
      copy,
      "the operator prefix reached a user-visible column — this is WR-07 itself",
    ).not.toMatch(/compute job enqueue failed/i);
    expect(copy, "'enqueue' is a queue-implementation word, not user copy").not.toMatch(
      /enqueue/i,
    );
    expect(
      copy,
      "the raw SQL diagnostic (SQLSTATE / MVCC vocabulary) reached the user",
    ).not.toMatch(/40001|sqlstate|serialization|mvcc|in-flight|rpc|postgres/i);
    expect(
      copy,
      "NOTHING in this repo retries a 40001 — promising one is a FALSE PROMISE, " +
        "which is the same defect as the jargon, not a fix for it",
    ).not.toMatch(/automatic/i);

    // ── and it is the project's sentence, not one this route invented ──
    expect(copy).toBe(CURATED_DEFAULT_COPY);
  });

  it("CONTROL — a NON-40001 enqueue failure still carries the operator-prefixed diagnostic", async () => {
    // The discrimination. Without this case, "every message changed" and "the
    // 40001 message changed" are the same observation — and a blanket swap
    // would delete the only diagnostic this column carries for failure shapes
    // that have no curated sentence.
    adminRpcMock.mockResolvedValueOnce({
      error: { code: "PGRST301", message: "JWT expired" },
    });

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    await runScheduledEnqueue();

    expect(
      copyWrittenToUser(),
      "the non-40001 arm lost its operator diagnostic — a blanket rewrite, not a branch",
    ).toBe("compute job enqueue failed: JWT expired");
  });

  it("CONTROL — a successful enqueue writes no failure placeholder at all", async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    await runScheduledEnqueue();

    expect(
      placeholderUpserts,
      "a `failed` placeholder was written over a SUCCESSFUL enqueue",
    ).toHaveLength(0);
  });

  /**
   * ⭐ RED DEMO (run 2026-08-26, restored from a byte backup after; the byte
   * backup, not `git checkout --`, which would have destroyed the uncommitted
   * fix).
   *
   * NEUTER 1 — restore the unconditional prefix. In route.ts, replace the
   *   ternary at the `writeFailedStrategyAnalyticsPlaceholder` call with the
   *   pre-fix `` `compute job enqueue failed: ${enqueueErrMessage}` ``.
   *   Observed — 1 failed | 18 passed, the 40001 case failing on the FIRST
   *   load-bearing assertion:
   *     AssertionError: the operator prefix reached a user-visible column —
   *     this is WR-07 itself: expected 'compute job enqueue failed: enqueue
   *     l…' not to match /compute job enqueue failed/i
   *     + Received: "compute job enqueue failed: enqueue lost the in-flight
   *       race; the winner already advanced"
   *   Both CONTROL cases stayed GREEN, which is what makes this pair a
   *   discrimination rather than a blanket claim. Restored: 19 passed.
   *
   * NEUTER 2 — the plausible half-fix: keep the branch, but write copy this
   *   route invented — `"Analytics could not be started. Please try again."`
   *   That is jargon-free and promises nothing, so EVERY `not.toMatch`
   *   assertion above still passes.
   *   Observed — 1 failed | 18 passed, failing only on the independent oracle:
   *     AssertionError: expected 'Analytics could not be started. Pleas…' to
   *     be 'Analytics could not complete for this…' // Object.is equality
   *     Expected: "Analytics could not complete for this strategy. Retry the
   *       sync, or contact support if this persists."
   *     Received: "Analytics could not be started. Please try again."
   *   That is the exact-equality assertion's whole reason to exist: the
   *   sentence has to be the PROJECT's, parsed from the SQL, not one this file
   *   agrees with itself about. Restored: 19 passed.
   */
});
