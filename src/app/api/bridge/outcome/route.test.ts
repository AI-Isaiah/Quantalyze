import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRIDGE_OUTCOME_CONFLICT_TARGET,
  BRIDGE_OUTCOME_CROSS_ALLOCATOR_HINT,
} from "@/lib/bridge/outcome-conflict";

/**
 * Tests for POST /api/bridge/outcome
 *
 * Coverage:
 *   TC1 — happy allocated: records outcome + emits bridge_outcome.record audit
 *   TC2 — happy rejected: records rejection + audit action is bridge_outcome.record
 *   TC3 — upsert-update: pre-existing row → created_at !== updated_at → audit action is bridge_outcome.update
 *   TC4 — 401 no user
 *   TC5 — 403 NOT_ELIGIBLE (no sent_as_intro in match_decisions)
 *   TC6 — 400 Zod: invalid uuid; kind=allocated missing percent_allocated
 *   TC7 — 429 rate-limit
 *   TC8 — the upsert's onConflict target names the one-outcome-per-decision key (D-09)
 *   TC9 — a failed eligibility lookup is a logged 500, never a silent 403 NOT_ELIGIBLE (review SFH)
 *   TC10 — the trigger's cross-allocator refusal (42501 + hint) is a fixed 403, not the generic 500
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. In tests we
// run the callback synchronously so the emission can be observed via
// STATE.rpcCalls.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  upsertCalls: [] as Array<{
    row: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }>,
  insertedRow: null as Record<string, unknown> | null,
  upsertError: null as { code?: string; hint?: string; message: string } | null,
  sentAsIntroDecision: { id: "00000000-0000-0000-0000-000000000010" } as { id: string } | null,
  sentAsIntroError: null as { message: string } | null,
  checkLimitResult: { success: true, retryAfter: 0 } as { success: boolean; retryAfter: number },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "bridge_outcomes") {
        return {
          upsert: (
            row: Record<string, unknown>,
            options?: Record<string, unknown>,
          ) => {
            STATE.upsertCalls.push({ row, options });
            return {
              select: () => ({
                single: async () =>
                  STATE.upsertError
                    ? { data: null, error: STATE.upsertError }
                    : {
                        data: STATE.insertedRow,
                        error: STATE.insertedRow ? null : { message: "no data" },
                      },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected from(${table}) on user-scoped client`);
    },
  }),
}));

// The match_decisions eligibility check uses the admin client because the
// table has no allocator-self-SELECT RLS policy. Mock it here.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "match_decisions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: STATE.sentAsIntroDecision,
                    error: STATE.sentAsIntroError,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) on admin client`);
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => STATE.checkLimitResult,
  // B15: route now uses withAuthLimited, which denies via rateLimitDenyJson.
  rateLimitDenyJson: (rl: { retryAfter: number; reason?: string }) =>
    NextResponse.json(
      {
        error:
          rl.reason === "ratelimit_misconfigured"
            ? "Rate limiter unavailable"
            : "Too many requests",
      },
      {
        status: rl.reason === "ratelimit_misconfigured" ? 503 : 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    ),
}));

// UUIDs with RFC 4122 v4 format for Zod strict uuid() validation
const STRAT_ID = "11111111-1111-4111-8111-111111111111";
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const NOW_ISO = "2026-04-18T12:00:00.000Z";
// allocated_at within last 365 days, not in future
const ALLOCATED_AT = "2026-04-10";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/bridge/outcome", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function drainAuditMicrotasks() {
  // logAuditEvent schedules via queueMicrotask; three ticks is enough.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.rpcCalls = [];
  STATE.upsertCalls = [];
  STATE.sentAsIntroDecision = { id: "00000000-0000-0000-0000-000000000010" };
  STATE.sentAsIntroError = null;
  STATE.upsertError = null;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.insertedRow = {
    id: OUTCOME_ID,
    kind: "allocated",
    percent_allocated: 12,
    allocated_at: ALLOCATED_AT,
    rejection_reason: null,
    note: null,
    delta_30d: null,
    delta_90d: null,
    delta_180d: null,
    estimated_delta_bps: null,
    estimated_days: null,
    needs_recompute: true,
    // Same instant = insert (bridge_outcome.record)
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bridge/outcome", () => {
  it("TC1 — happy allocated: 200 + correct shape + bridge_outcome.record audit", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 12,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toMatchObject({ id: OUTCOME_ID, kind: "allocated" });

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "bridge_outcome.record",
      p_entity_type: "bridge_outcome",
      p_entity_id: OUTCOME_ID,
    });
    expect(auditCall!.args.p_metadata).toMatchObject({
      strategy_id: STRAT_ID,
      kind: "allocated",
      percent_allocated: 12,
      rejection_reason: null,
    });
  });

  it("NEW-C18-02 — accepts 60% and 100% allocations (canonical [.,100]), rejects >100", async () => {
    // WHY: bridge_outcomes.percent_allocated is canonically [0,100] (the
    // stale [0.1,50] inline column CHECK was dropped by mig 20260528223200).
    // Pre-fix this route capped at 50 and 422-rejected legitimate 60%/75%/100%
    // allocations — the same range-drift class as the scenario-commit bug.
    const { POST } = await import("./route");
    for (const pct of [60, 100]) {
      const res = await POST(
        makeRequest({
          strategy_id: STRAT_ID,
          kind: "allocated",
          percent_allocated: pct,
          allocated_at: ALLOCATED_AT,
          note: null,
        }),
      );
      expect(res.status).toBe(200);
    }
    // > 100 is still rejected by Zod (canonical upper bound).
    const tooHigh = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 100.01,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );
    expect(tooHigh.status).toBe(400);
  });

  it("TC2 — happy rejected: 200 + rejection_reason persisted + bridge_outcome.record audit", async () => {
    STATE.insertedRow = {
      id: OUTCOME_ID,
      kind: "rejected",
      percent_allocated: null,
      allocated_at: null,
      rejection_reason: "mandate_conflict",
      note: null,
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: true,
      // First insert: timestamps equal
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    };

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "rejected",
        rejection_reason: "mandate_conflict",
        note: null,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome.rejection_reason).toBe("mandate_conflict");
    expect(body.outcome.percent_allocated).toBeNull();
    expect(body.outcome.allocated_at).toBeNull();

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_action).toBe("bridge_outcome.record");
    expect((auditCall!.args.p_metadata as Record<string, unknown>).rejection_reason).toBe("mandate_conflict");
  });

  it("TC3 — upsert-update: diverged timestamps → bridge_outcome.update audit", async () => {
    // Pre-existing row: created_at earlier than updated_at (has been updated before)
    STATE.insertedRow = {
      id: OUTCOME_ID,
      kind: "allocated",
      percent_allocated: 15,
      allocated_at: ALLOCATED_AT,
      rejection_reason: null,
      note: null,
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: true,
      // Different timestamps = upsert-update (bridge_outcome.update)
      created_at: "2026-04-01T10:00:00.000Z",
      updated_at: "2026-04-18T12:00:00.000Z",
    };

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 15,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );

    expect(res.status).toBe(200);

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_action).toBe("bridge_outcome.update");
  });

  it("TC4 — 401 no user: no DB calls, no audit", async () => {
    STATE.authUser = null;

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 10, allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC5 — 403 NOT_ELIGIBLE: no upsert, no audit", async () => {
    STATE.sentAsIntroDecision = null;

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 10, allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("NOT_ELIGIBLE");
    expect(body.reason).toBe("No sent_as_intro for this strategy");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC6a — 400 Zod: invalid uuid → issues array", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: "not-a-uuid", kind: "allocated" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC6b — 400 Zod: kind=allocated missing percent_allocated → superRefine error", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
    expect(Array.isArray(body.issues)).toBe(true);
    const issue = body.issues.find(
      (i: { path: string[] }) => i.path.includes("percent_allocated"),
    );
    expect(issue).toBeDefined();
  });

  it("TC7 — 429 rate-limit: Retry-After header, no upsert, no audit", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 10, allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC8 — upsert conflicts on (allocator_id, match_decision_id), the existing one-outcome-per-decision unique (164.9.3.1 D-09)", async () => {
    // Migration 081 replaced 072's per-strategy unique with
    // bridge_outcomes_allocator_match_decision_unique. An ON CONFLICT target that
    // matches no unique index raises 42P10 and the route answers 500 for every
    // request, so the target must be the key the route really writes.
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 12,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );
    expect(res.status).toBe(200);

    expect(STATE.upsertCalls).toHaveLength(1);
    const { row, options } = STATE.upsertCalls[0];
    // The route sends exactly the shared constant the live-DB arm exercises.
    expect(options).toEqual({ onConflict: BRIDGE_OUTCOME_CONFLICT_TARGET });
    // The target is the per-decision key and every column of it is written.
    const targetColumns = BRIDGE_OUTCOME_CONFLICT_TARGET.split(",");
    expect(targetColumns).toEqual(["allocator_id", "match_decision_id"]);
    for (const col of targetColumns) {
      expect(row).toHaveProperty(col);
    }
    expect(row.match_decision_id).toBe(STATE.sentAsIntroDecision!.id);
  });

  it("TC9 — a failed eligibility lookup is a logged 500, not a silent 403 NOT_ELIGIBLE (review SFH)", async () => {
    // WHY: the match_decisions lookup used to destructure only `data`, so a
    // transient DB failure (data null, error set) read as "no sent_as_intro" and
    // told an eligible allocator they were NOT_ELIGIBLE, with nothing in the log.
    // A real "no row" answer (TC5) stays a 403; an error is a 500 and is logged.
    STATE.sentAsIntroDecision = null;
    STATE.sentAsIntroError = { message: "connection reset by peer" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 12,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to record outcome");
    expect(body.error).not.toBe("NOT_ELIGIBLE");

    // Logged the same way the upsert branch logs: tagged, with the error object.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[api/bridge/outcome]"),
      STATE.sentAsIntroError,
    );

    // The failed lookup stops the request: no upsert, no audit.
    expect(STATE.upsertCalls).toHaveLength(0);
    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("TC10 — the trigger's cross-allocator refusal (42501 + hint) is a fixed 403, never the generic 500 (round-2 RLS audit)", async () => {
    // WHY: bridge_outcomes_sync_holding_ref is SECURITY DEFINER and copies the
    // attached decision's holding ref into the caller's row, so it refuses a
    // decision that belongs to another allocator with SQLSTATE 42501 and the hint
    // cross_allocator_decision. The route keys on BOTH (RLS raises a bare 42501
    // too, and that stays the generic 500).
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql",
      ),
      "utf8",
    );
    // The literal the route matches is the one the trigger raises.
    expect(migration).toContain(`HINT = '${BRIDGE_OUTCOME_CROSS_ALLOCATOR_HINT}'`);

    STATE.upsertError = {
      code: "42501",
      hint: BRIDGE_OUTCOME_CROSS_ALLOCATOR_HINT,
      message:
        "bridge_outcomes: match_decision_id names a decision that belongs to another allocator",
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 12,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: "NOT_ELIGIBLE",
      reason: "Decision does not belong to this allocator",
    });
    // The database message never reaches the client, and no audit event is written.
    expect(JSON.stringify(body)).not.toContain("match_decision_id");
    // The branch is unreachable while the decision lookup stays scoped to the
    // caller, so reaching it is a broken invariant and must leave exactly one
    // server-log line naming the route, the caller, the strategy and the decision.
    // The ids stay out of the response body.
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [logMessage, logContext] = errSpy.mock.calls[0];
    expect(logMessage).toContain("[api/bridge/outcome]");
    expect(logMessage).toContain("cross-allocator");
    expect(logContext).toEqual({
      userId: STATE.authUser!.id,
      strategyId: STRAT_ID,
      decisionId: STATE.sentAsIntroDecision!.id,
    });
    expect(JSON.stringify(body)).not.toContain(STATE.authUser!.id);
    expect(JSON.stringify(body)).not.toContain(STATE.sentAsIntroDecision!.id);
    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);

    // A bare 42501 (an RLS denial) is NOT this refusal: it stays the generic 500.
    STATE.upsertError = { code: "42501", message: "new row violates row-level security policy" };
    const res2 = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 12,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );
    expect(res2.status).toBe(500);
    expect((await res2.json()).error).toBe("Failed to record outcome");
    // The cross-allocator line above plus this generic upsert-error line.
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
