/**
 * NEW-C14 regression tests — csv-finalize/route.ts + parseDailyReturnsSeries.
 *
 * These tests cover pure-function / route-unit aspects that do NOT require
 * a live DB. Each test verifies exactly the "fails without the fix" invariant
 * called out in the audit findings.
 *
 * Phase 145 / Plan 05 (D-11, D-12) — this file was REBUILT when the fold
 * landed. The old vacuous red-team "M1" block (its full name is retired with
 * it — the acceptance grep count-asserts its absence) drove the PRE-create
 * 400 (the RPC never ran) and then asserted captureToSentry was NOT called
 * with an orphan-capture message — searching for a phrase no code emits — so
 * the assertion was vacuously true forever, named for a post-RPC
 * orphan-capture guarantee nobody implemented. Per the founder rule (a test
 * that cannot fail is worse
 * than none) it was DELETED, and the guarantee it pretended to pin is
 * superseded by the real mechanism: 145-REPRODUCTION.md records the
 * CANNOT-REPRODUCE verdict on the historical 42501 orphan bug, and the fold
 * (`finalize_csv_strategy_with_returns`, migration 20260819120000) makes a
 * failed finalize commit NOTHING — there is no orphan left to capture. The
 * three 145-05 gates below drive the fold caller's ACTUAL post-RPC failure
 * arms and assert captures/copy that ARE made; each was observed RED under a
 * neuter of its target before restore (records in 145-05-SUMMARY.md).
 * (NEW-C14-07 was deleted outright, not unskipped: the upstream-body spread
 * it pinned dissolved with hop 0 — there is no /process-key body to strip —
 * and the surviving TS-13 discipline is pinned by route.test.ts's re-pointed
 * TS-13 describe.)
 *
 * Tests covered:
 *   FOLD-FAIL-CAPTURE (145-05 A): fold RPC error → 500 CSV_FINALIZE_FAIL,
 *     truthful nothing-was-saved copy, step='finalize-fold-fail' capture
 *   RESOLVE-REFUSED (145-05 B): 23505 + name mismatch → 409
 *     CSV_SESSION_REUSED, accurate copy, step='finalize-resolve-refused'
 *     capture, and NO metadata write (checks-before-metadata)
 *   RESOLVE-ECHO-READ-ONLY (145-05 C): 23505 + matching identity → 200
 *     echoing the existing row's id AND status; the resolve arm persists
 *     NOTHING (read-only contract)
 *   NEW-C14-03: present-but-invalid aum/max_capacity → 400 CSV_INVALID_FORMAT
 *   WR-04: explicit null category_id → 400 (handler + shared validator)
 *   NEW-C14-05: over-cap description → 400 CSV_INVALID_FORMAT
 *   NEW-C14-09: daily_return magnitude > 10 → 400 CSV_INVALID_FORMAT
 *   NEW-C14-10: impossible calendar date / future date → 400
 *   NEW-C14-12: trimmed name checked for length (trailing spaces not rejected)
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

// server-client rpc: the Phase 145 fold (finalize_csv_strategy_with_returns).
// Default succeeds with a fresh UUID so the pre-existing success-path cases
// keep exercising the create path.
const rpcMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      data: string | null;
      error: { code?: string; message?: string } | null;
    }> => ({ data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", error: null }),
  ),
);
// Metadata UPDATE (applyCsvMetadataUpdate → from("strategies").update().eq().eq()).
const updateMock = vi.hoisted(() =>
  vi.fn(async () => ({ error: null })),
);
// The 23505 resolve arm's two READS (145-05 B/C) — driven independently:
//   strategies re-fetch:  .select().eq().eq().eq().maybeSingle()
//   dailies range check:  .select().eq().or().limit(1)
const strategiesMaybeSingleMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ data: unknown; error: unknown }> => ({
      data: null,
      error: null,
    }),
  ),
);
const dailiesRangeLimitMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      data: unknown[];
      count?: number | null;
      error: unknown;
    }> => ({
      data: [],
      count: 0,
      error: null,
    }),
  ),
);
// Write-shaped calls that must NEVER fire from inside the resolve arm — the
// read-only contract 145-05 C pins.
const insertMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const upsertMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: Record<string, unknown>) => (rpcMock as any)(name, args),
    from: (_table: string) => ({
      // 159-06 / RANK-07 — the chain grew a compare-and-set tail:
      // `.is("category_id", null).select("id")`. SCAFFOLD ONLY. `updateMock`
      // still decides the outcome and is still called exactly once per UPDATE,
      // so every `toHaveBeenCalled` / `not.toHaveBeenCalled` assertion in this
      // file means what it always meant. Non-empty `data` says the CAS matched,
      // which is the state every case here models.
      update: (_payload: Record<string, unknown>) => {
        const tail = async () => {
          const res = await updateMock();
          return res.error
            ? { data: null, error: res.error }
            : { data: [{ id: "cas-matched" }], error: null };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {};
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.select = (_cols: string) => tail();
        return chain;
      },
      insert: (_rows: unknown) => insertMock(),
      upsert: (_rows: unknown) => upsertMock(),
      // One flexible chain serves both resolve-arm reads; the two terminal
      // calls route to their dedicated mocks so tests drive each read on its
      // own. eq/or return the chain itself, so filter-count changes in the
      // route do not silently break the scaffold.
      select: (_cols: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {};
        chain.eq = () => chain;
        chain.or = () => chain;
        chain.order = () => chain;
        chain.limit = () => dailiesRangeLimitMock();
        chain.maybeSingle = () => strategiesMaybeSingleMock();
        return chain;
      },
    }),
  }),
}));

// Admin client: reached only inside the after() enqueue epilogue, which this
// file's after() no-op (below) never runs. Kept defensively.
const adminFromMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: vi.fn(async () => ({ error: null })),
    from: (table: string) => adminFromMock(table),
  }),
}));

// Phase 145: the route no longer dispatches to /process-key (the fold is
// called directly on the SSR client — option i-b, 145-DECISION.md). The mock
// is kept as a tripwire: if a regression re-introduced the dispatch, these
// tests would exercise it instead of the fold and the fold-shaped
// expectations would red.
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

// 146.2-06 / T-146.2-12 — the finalize audit emission. Mocked so the emission
// is OBSERVABLE: `audit-coverage.test.ts` is a static grep over the source and
// proves only that a call is written near the mutation, never that the call is
// reached, reached ONCE, or reached with the right event.
const logAuditEventAsUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({
  logAuditEventAsUser: logAuditEventAsUserMock,
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: vi.fn() };
});

// ── Helpers ────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server";
import { captureToSentry } from "@/lib/sentry-capture";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
  });
}

const VALID_SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_SERIES = [{ date: "2024-01-01", daily_return: 0.01 }];
const EXISTING_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
// 146.2-06 — the committed row's classification, DECLARED in the resolve-arm
// fixtures rather than omitted. Since 146.2-01 the resolve select reads
// `category_id, asset_class` and decides a tri-state on them where `undefined`
// (absent), `null` (measured SQL NULL) and a string each mean something
// DIFFERENT. A fixture that leaves the field out silently selects the absent
// branch, so every case here declares what it means. It must be a real UUID:
// `parseCsvMetadata` accepts `category_id` only when `isUuid()` passes and
// silently drops anything else, so a placeholder string would make the request
// side absent and a comparison would pass for the wrong reason (146.2-01
// deviation 2).
const COMMITTED_CATEGORY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wizard_session_id: VALID_SESSION,
    fmt: "daily_returns",
    strategy_name: "Test Strategy",
    daily_returns_series: VALID_SERIES,
    ...overrides,
  };
}

function findCapture(step: string) {
  return vi
    .mocked(captureToSentry)
    .mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[1] as any)?.tags?.step === step,
    );
}

// ── Import after all mocks are set up ─────────────────────────────────────

import { POST } from "@/app/api/strategies/csv-finalize/route";
import { parseDailyReturnsSeries } from "@/app/api/strategies/csv-finalize/route";
import { parseCsvMetadata } from "@/app/api/strategies/csv-finalize/route";

// ══════════════════════════════════════════════════════════════════════════
// 145-05 (D-11, D-12) — the three replacement gates. Each drives a REAL
// post-RPC failure/resolve arm of the fold caller (the arms Plan 04 built,
// in `finalizeAtomicOrErrorResponse` / `resolveExistingStrategyOrRefuse`)
// and asserts a capture/copy that WAS made. Each was observed RED under a
// neuter of its target before restore — the after-failloud idiom: assert
// tags.step AND that the console line survives.

describe("FOLD-FAIL-CAPTURE (145-05 A): a failed fold answers the truthful nothing-was-saved 500 and captures step=finalize-fold-fail", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("non-23505 RPC error → 500 CSV_FINALIZE_FAIL, nothing-was-saved copy, Sentry capture, surviving console.error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "fold exploded" },
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    // The truthful copy: the fold has NO EXCEPTION block, so a failed
    // finalize commits nothing — and the code is CSV_FINALIZE_FAIL (not
    // CSV_PERSIST_FAIL) so the wizard re-enables Submit beside the "safe to
    // try again" sentence (Plan 04 key decision; the wizard's branch-1 arm
    // now re-enables unconditionally — v1.19 review 2026-08-18 removed the
    // dead CSV_DUPLICATE_SESSION fence).
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_FINALIZE_FAIL");
    expect(body.human_message).toContain(
      "Nothing was saved — the submission rolled back completely",
    );

    // The console line SURVIVES (Vercel log parity — Sentry is added
    // alongside, never as a replacement).
    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("finalize_csv_strategy_with_returns failed"),
      ),
    ).toBe(true);

    // ...and the failure is alertable (D-12 — the pre-fold windows B/C had
    // ZERO capture on the failure itself; this arm is their folded successor).
    const call = findCapture("finalize-fold-fail");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.correlation_id).toBeTruthy();
    expect(opts.extra.rpc_error_code).toBe("XX000");
  });
});

describe("RESOLVE-REFUSED (145-05 B): 23505 + name mismatch → 409 CSV_SESSION_REUSED, capture, and NO metadata write", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("refuses BEFORE anything of this submission is written (checks-before-metadata — the 409-lie fix)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });
    // The committed row holds a DIFFERENT name: a changed track record is a
    // NEW strategy, so the resolve arm must refuse (CR-01 check 1).
    //
    // 146.2-06 — `category_id` / `asset_class` DECLARED (see
    // COMMITTED_CATEGORY_ID). The classification tri-state sits BELOW the name
    // check and is never reached on this path, so the values cannot change the
    // outcome; they are declared anyway so that if the checks were ever
    // reordered, this case would exercise a defined state rather than an
    // accidental one.
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: EXISTING_ID,
        name: "A Different Strategy",
        status: "pending_review",
        category_id: COMMITTED_CATEGORY_ID,
        asset_class: "traditional",
      },
      error: null,
    });

    // The submission CARRIES metadata deliberately: if the ordering ever
    // regressed to metadata-before-checks (the pre-fold 409 lie, where hop 2
    // had already overwritten the resolved strategy's metadata before the
    // fence refused), this update WOULD land — the not-called assertion
    // below is what reds.
    const res = await POST(
      makeRequest(
        // 146.2-03 / G2 — the blob carries a `category_id` because a metadata
        // blob that would run an UPDATE without one is now a 400 at the
        // boundary, and a 400 would never reach the ordering this case tests.
        validBody({
          metadata: {
            category_id: COMMITTED_CATEGORY_ID,
            description: "must never be written on a refusal",
          },
        }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");
    // The ACCURATE copy — true by ORDERING: identity checks ran before any
    // metadata write, so "before writing anything of this submission" holds.
    expect(body.human_message).toContain(
      "already created a strategy with a different track record",
    );
    expect(body.human_message).toContain(
      "we refused before writing anything of this submission",
    );
    expect(body.debug_context?.strategy_id).toBe(EXISTING_ID);

    // The refusal is alertable (D-12) — a money-fence firing.
    const call = findCapture("finalize-resolve-refused");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.strategy_id).toBe(EXISTING_ID);
    expect(opts.extra.correlation_id).toBeTruthy();

    // NO write of THIS submission ran — the 409 copy is truthful.
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();

    // The console line survives.
    expect(
      warnSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("refused a cross-submission resolve (name mismatch)"),
      ),
    ).toBe(true);
  });
});

describe("RESOLVE-ECHO-READ-ONLY (145-05 C): 23505 + matching identity → 200 echoing the existing row; the resolve arm persists NOTHING", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("echoes the existing id + its OWN status after read-only checks; zero writes, exactly one RPC call", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });
    // Matching name; status 'private' — the echoed status must come from the
    // READ, never be fabricated: a CONTRIB-02 contribution row must not be
    // reported back as 'pending_review'.
    //
    // ⚠️ RE-POINTED BY 146.1-04 / A2 (2026-08-18) — READ THIS BEFORE RESTORING
    // THE OLD FIXTURE. This case used to send NO `entry_context`, i.e. the
    // MANAGER flow (terminal status 'pending_review'), against a committed
    // 'private' row. That combination is now REFUSED 409: `status` is not in
    // the partial unique index the 23505 fires on, and `wizard_session_id` is
    // restored from one shared localStorage key, so a manager-flow resubmit
    // could land on an owner-only contribution row and be told "saved" for a
    // strategy that never enters the admin review queue. The fixture now sends
    // the CONTRIBUTION flow, which is the caller this committed row actually
    // belongs to; every read-only assertion below is unchanged.
    //
    // ⭐ 146.2-06 (absorbed item 4) — WHAT THIS CASE PROVES ALONE, RESTORED
    // AND BOUNDED. Read this before weakening the `status` assertion below.
    //
    // The seeded status is 'private', chosen because it is NOT the constant
    // 'pending_review' that the echo's removed fallback (`existingRow.status
    // ?? "pending_review"`, deleted by 146.2-01) would have produced. With
    // that fallback gone, replacing the echoed value with ANY hardcoded
    // literal — the old fallback constant first among them — reds this case.
    // That is "echoed, not fabricated", and this case carries it on its own
    // again. Observed: hardcoding the echo to "pending_review" reds exactly
    // this case (146.2-06-SUMMARY.md, neuter N5).
    //
    // ⛔ WHAT IT STILL CANNOT PROVE, STATED RATHER THAN IMPLIED. A2 refuses
    // every echo whose committed status differs from the request's, so on any
    // surviving echo path the echoed status and the requested terminal status
    // are provably EQUAL — no test can separate `existingRow.status` from
    // `args.terminalStatus` here, because the code guarantees they are the
    // same value. That specific substitution is discriminated by the refusal
    // cases in `csv-finalize-cross-submission-merge.test.ts` ("manager
    // resubmit onto a committed 'private' contribution row is REFUSED", and
    // its mirror), which are the cases where the two CAN differ at all.
    //
    // 146.2-06 — `category_id` / `asset_class` are DECLARED, not omitted.
    // Post-146.2-01 the resolve select reads both and decides a tri-state on
    // them, so an omitted `category_id` would put this case on the ABSENT
    // (arm c) branch by accident. Declaring a real UUID puts it on the
    // CLASSIFIED (arm b) branch deliberately; this request sends no metadata,
    // so its own classification is absent and the arm no-ops — which is the
    // state the zero-writes assertions below are actually about.
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: EXISTING_ID,
        name: "Test Strategy",
        status: "private",
        category_id: COMMITTED_CATEGORY_ID,
        asset_class: "traditional",
      },
      error: null,
    });
    // Series-equality check (CR-01 check 2, as READS — red-team fix
    // 2026-08-18): committed count and boundaries EQUAL this payload's →
    // this IS the instructed retry of the same file. Two reads: asc
    // (min + count), desc (max).
    dailiesRangeLimitMock.mockResolvedValueOnce({
      data: [{ date: "2024-01-01" }],
      count: 1,
      error: null,
    });
    dailiesRangeLimitMock.mockResolvedValueOnce({
      data: [{ date: "2024-01-01" }],
      error: null,
    });

    // NO metadata in the body: any write observed below came from inside the
    // resolve path, which is exactly what the read-only contract forbids.
    // `entry_context: "contribution"` → terminal status 'private', matching the
    // committed row above (146.1-04 / A2).
    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(EXISTING_ID);
    expect(
      body.status,
      "the echoed status was not the one READ from the committed row — a value nobody observed was reported back as this strategy's state",
    ).toBe("private");

    // BOTH identity checks ran, as READS.
    expect(strategiesMaybeSingleMock).toHaveBeenCalledTimes(1);
    expect(dailiesRangeLimitMock).toHaveBeenCalledTimes(2);

    // The read-only contract: exactly ONE rpc call (the failed fold — no
    // second finalize, no persist RPC; the dailies are guaranteed present
    // because the fold committed all-or-nothing) and ZERO write-shaped calls
    // on the user client.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();

    // The console line survives (the resolve echo is logged for traceability).
    expect(
      warnSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("23505 resolved to the existing strategy"),
      ),
    ).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════

/**
 * AUDIT-FINALIZE (146.2-06, absorbed item 1 / T-146.2-12) — THE FORENSIC ROW.
 *
 * The `@audit-skip` pragma above the fold call is gone, so
 * `audit-coverage.test.ts` now REQUIRES an emission there. That law is a
 * static grep: it proves a call is WRITTEN within its 60-line window, and
 * nothing else. It would stay green if the call sat on an unreachable branch,
 * fired on every echo as well, or named the wrong entity. This describe drives
 * the behaviour.
 *
 * ⭐ THE SECOND CASE IS THE LOAD-BEARING ONE. A 23505 resolve echo means a
 * PRIOR request committed the strategy and THIS one rolled back entirely.
 * Emitting there would write a second creation record for one creation — on an
 * append-only log that is not a duplicate, it is a false fact, and it would
 * make the audit trail claim two track records were created where one was.
 */
describe("AUDIT-FINALIZE (146.2-06): the fold's commit emits strategy.csv_finalize — on the FRESH create only", () => {
  const FRESH_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("a fresh finalize emits exactly one strategy.csv_finalize event anchored on the NEW strategy id", async () => {
    rpcMock.mockResolvedValueOnce({ data: FRESH_ID, error: null });
    updateMock.mockResolvedValueOnce({ error: null });

    const res = await POST(
      makeRequest(
        validBody({
          daily_returns_series: [
            { date: "2024-01-01", daily_return: 0.01 },
            { date: "2024-01-02", daily_return: -0.02 },
          ],
        }),
      ),
    );
    expect(res.status).toBe(200);

    expect(
      logAuditEventAsUserMock,
      "the CSV finalize committed a strategy, its verification row and its whole track record with NO forensic row — the one user-visible creation in the product that nobody could attribute afterwards",
    ).toHaveBeenCalledTimes(1);

    const [, actingUserId, event] = logAuditEventAsUserMock.mock.calls[0] as [
      unknown,
      string,
      { action: string; entity_type: string; entity_id: string; metadata?: Record<string, unknown> },
    ];
    // Attribution comes from the withAuth-established user id, not from the
    // body — the mocked withAuth above supplies exactly this id.
    expect(actingUserId).toBe("00000000-0000-0000-0000-000000000abc");
    expect(event.action).toBe("strategy.csv_finalize");
    expect(event.entity_type).toBe("strategy");
    expect(
      event.entity_id,
      "the event was anchored on something other than the strategy the fold just committed — a forensic row that cannot be joined to the thing it describes",
    ).toBe(FRESH_ID);
    expect(event.metadata).toMatchObject({
      fmt: "daily_returns",
      row_count: 2,
      terminal_status: "pending_review",
    });
    expect(event.metadata?.correlation_id).toBeTruthy();
  });

  it("a 23505 resolve ECHO emits NOTHING — this request created no strategy", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: EXISTING_ID,
        name: "Test Strategy",
        status: "private",
        category_id: COMMITTED_CATEGORY_ID,
        asset_class: "traditional",
      },
      error: null,
    });
    dailiesRangeLimitMock.mockResolvedValueOnce({
      data: [{ date: "2024-01-01" }],
      count: 1,
      error: null,
    });
    dailiesRangeLimitMock.mockResolvedValueOnce({
      data: [{ date: "2024-01-01" }],
      error: null,
    });

    const res = await POST(
      makeRequest(validBody({ entry_context: "contribution" })),
    );
    expect(res.status).toBe(200);

    expect(
      logAuditEventAsUserMock,
      "an echo wrote a CREATION record for a strategy a PRIOR request created — on an append-only log that is a false fact, not a duplicate",
    ).not.toHaveBeenCalled();
  });

  it("a FAILED fold emits nothing — there is no strategy to attribute", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "fold refused the payload" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(500);
    expect(logAuditEventAsUserMock).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════

/**
 * RESOLVE-READ-FAIL (146.2-06, absorbed item 5) — THE TWO UNDRIVEN
 * FAIL-CLOSED ARMS.
 *
 * `resolveExistingStrategyOrRefuse` funnels every unusable read into ONE
 * `failClosed()` helper, which answers 503 CSV_PERSIST_FAIL and captures with
 * `tags.step = "finalize-resolve-read-fail"`. Two of its call sites had NO
 * test at all before this describe:
 *
 *   A. the strategies re-fetch RESOLVED with an error object — supabase-js
 *      resolves on a read failure rather than throwing, so an unchecked
 *      binding would read as "no row", i.e. a FAILED READ rendered as a
 *      MEASUREMENT (the C-3 lesson the arm's docblock names).
 *   B. the re-fetch resolved `data: null` with NO error — a 23505 with no
 *      committed row to resolve to (TOCTOU delete, RLS hide, or a non-session
 *      23505 that slipped every upstream gate).
 *
 * ⭐ EACH CASE ASSERTS THE STEP TAG, NOT JUST THE STATUS CODE. The 503 alone
 * is satisfied by any refusal; what makes these arms operable is that the
 * capture is findable under one grep-unique step string. Both cases were
 * observed RED under a retag of that string in `route.ts` (records in
 * 146.2-06-SUMMARY.md), which is what proves they pin the TAG.
 */
describe("RESOLVE-READ-FAIL (146.2-06): both fail-closed resolve arms answer 503 and capture step=finalize-resolve-read-fail", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function arm23505() {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });
  }

  it("A: the strategies re-fetch RESOLVES with an error → 503 CSV_PERSIST_FAIL, step-tagged capture, zero writes", async () => {
    arm23505();
    // Resolved-not-thrown, which is exactly the supabase-js shape that makes
    // an unchecked binding dangerous here.
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const res = await POST(
      makeRequest(
        // 146.2-03 / G2 — see the note on the refusal case above: a
        // category-less blob now 400s before the fail-closed arm is reached.
        validBody({
          metadata: {
            category_id: COMMITTED_CATEGORY_ID,
            description: "must never be written on a fail-closed refusal",
          },
        }),
      ),
    );
    const body = await res.json();

    expect(
      res.status,
      "a resolve read that FAILED was not distinguished from a resolve read that found nothing — the fence answered as though it had measured something",
    ).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(body.human_message).toContain(
      "could not confirm what is already saved",
    );

    const call = findCapture("finalize-resolve-read-fail");
    expect(
      call,
      "the fail-closed arm fired with no capture under its own step tag — the 503 is invisible to ops",
    ).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = call![1] as any;
    expect(opts.tags.surface).toBe("csv-finalize");
    expect(opts.extra.correlation_id).toBeTruthy();
    // ⭐ THE CAPTURED ERROR IS THE READ ERROR ITSELF, and this assertion is
    // what makes case A discriminate from case B at all. Both arms funnel into
    // the SAME `failClosed()` helper, so both answer 503 under the same step
    // tag: on status + tag alone, deleting `if (refetchErr) return
    // failClosed(...)` would let this payload fall through to the
    // no-committed-row arm (`data` IS null here) and the case would still
    // pass — pinning nothing. The forensic payload is where the two differ:
    // arm A carries the driver's error (its SQLSTATE is how ops tells a
    // statement timeout from an RLS hide), arm B carries a synthetic Error.
    expect(
      opts && call![0],
      "the capture did not carry the READ error — the fail-closed 503 arrived in Sentry with no SQLSTATE, so a statement timeout is indistinguishable from a vanished row",
    ).toMatchObject({ code: "57014" });

    // Nothing of THIS submission was written — the copy says so.
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();

    // The console line survives alongside Sentry (Vercel log parity).
    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("23505 resolve strategies read failed"),
      ),
    ).toBe(true);
  });

  it("B: the re-fetch resolves data null with NO error → same 503 and the SAME step tag", async () => {
    arm23505();
    strategiesMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(
      res.status,
      "a 23505 with no committed row to resolve to was not refused — the arm cannot establish what exists and must not echo",
    ).toBe(503);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(body.strategy_id).toBeUndefined();

    const call = findCapture("finalize-resolve-read-fail");
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((call![1] as any).tags.surface).toBe("csv-finalize");
    // The mirror of case A's assertion: THIS arm's capture carries the
    // synthetic Error naming the condition, because there was no driver error
    // to carry. The two arms are separable in Sentry, not just in the code.
    expect(String((call![0] as Error)?.message)).toContain(
      "re-fetch found no committed row",
    );

    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("B': a row that came back WITHOUT a usable id takes the same arm (isUuid is part of the predicate)", async () => {
    arm23505();
    // A row exists but its id is unusable — `!isUuid(existingRow.id)` is the
    // second half of the no-committed-row predicate, and a case driving only
    // `data: null` would leave it unpinned.
    //
    // 146.2-06 — `category_id` / `asset_class` are ABSENT here ON PURPOSE, and
    // so is any expectation about them: this predicate sits ABOVE the
    // classification tri-state, so an unusable id must refuse before anything
    // reads a classification at all. Declaring them would suggest this arm
    // consults them.
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: { id: "not-a-uuid", name: "Test Strategy", status: "pending_review" },
      error: null,
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(findCapture("finalize-resolve-read-fail")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("NEW-C14-03: present-but-invalid aum/max_capacity → 400", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("rejects negative aum with 400 CSV_INVALID_FORMAT", async () => {
    const res = await POST(makeRequest(validBody({
      metadata: { aum: "-5" },
    })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(body.debug_context?.field).toContain("aum");
  });

  it("rejects aum >= 1e12 with 400 CSV_INVALID_FORMAT", async () => {
    const res = await POST(makeRequest(validBody({
      metadata: { aum: "1e20" },
    })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(body.debug_context?.field).toContain("aum");
  });

  it("rejects NaN aum string with 400 CSV_INVALID_FORMAT", async () => {
    const res = await POST(makeRequest(validBody({
      metadata: { aum: "not-a-number" },
    })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
  });

  it("allows omitted aum (ok:true)", async () => {
    // Arrange: RPC succeeds
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    const res = await POST(makeRequest(validBody({ metadata: {} })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("WR-04 (Phase 53): explicit null category_id → 400 (defense-in-depth for ISSUE-010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("rejects metadata.category_id: null with 400 CSV_INVALID_FORMAT before the RPC", async () => {
    // ISSUE-010: the csv_metadata step exists to STOP persisting
    // category_id=null. The client disabled-gate is the first guard, but the
    // server must reject an explicit null so the strategy can never land
    // invisible to discovery even if the gate is loosened or the categories
    // fetch fails/returns empty. RPC must NOT be reached.
    const res = await POST(
      makeRequest(validBody({ metadata: { category_id: null } })),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(body.debug_context?.field).toContain("category_id");
    // The finalize RPC must not have fired (rejected at the parse boundary).
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts a valid UUID category_id (ok:true)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    const res = await POST(
      makeRequest(
        validBody({
          metadata: { category_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("still accepts metadata with the category_id key ABSENT (metadata-less path unchanged)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    const res = await POST(makeRequest(validBody({ metadata: {} })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("WR-02 (Phase 146.2 review): present-but-invalid category_id → 400, never a silent drop", () => {
  // WHY THIS MATTERS ECONOMICALLY, not just structurally.
  //
  // Phase 146.2 makes `category_id IS NULL` on the committed row the FILL
  // discriminator for the 23505 echo, because `strategies.asset_class` is
  // NOT NULL DEFAULT 'traditional' and therefore cannot distinguish "never
  // classified" from "the user chose traditional". The whole FILL/REFUSE split
  // rests on one claim: a committed NULL is observable proof the metadata
  // UPDATE never ran.
  //
  // A silently-dropped non-UUID category_id FALSIFIES that claim — it commits a
  // row with category_id NULL for which the UPDATE *did* run. A later
  // same-session resubmit then reads NULL, takes the FILL arm, and rewrites
  // description / aum / markets / strategy_types the user never resubmitted:
  // the A4 mutation-on-an-echo the split exists to forbid.
  //
  // The wizard cannot reach this (MetadataStep gates Submit on a non-null
  // categoryId sourced from discovery_categories). An authenticated API client
  // — a stale build, an integration, a script — can.
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("rejects a present-but-non-UUID category_id string with 400 CSV_INVALID_FORMAT, before the RPC", async () => {
    const res = await POST(
      makeRequest(
        validBody({ metadata: { category_id: "systematic-macro" } }),
      ),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(body.debug_context?.field).toContain("category_id");
    // Rejected at the parse boundary: nothing was committed, so no row exists
    // whose NULL category_id could later be misread as "never classified".
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string category_id (number) with 400 CSV_INVALID_FORMAT, before the RPC", async () => {
    const res = await POST(
      makeRequest(validBody({ metadata: { category_id: 42 } })),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(body.debug_context?.field).toContain("category_id");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a UUID-shaped-but-invalid category_id with 400 CSV_INVALID_FORMAT", async () => {
    // Right length and hyphenation, non-hex characters — isUuid must reject it
    // rather than the arm falling through to a silent drop.
    const res = await POST(
      makeRequest(
        validBody({
          metadata: { category_id: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz" },
        }),
      ),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("still accepts a valid UUID (the fix rejects only what was previously dropped)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    const res = await POST(
      makeRequest(
        validBody({
          metadata: { category_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("still accepts the category_id key ABSENT — the metadata-less path is untouched", async () => {
    // The ABSENT case is a legitimate path and must NOT be swept up by the new
    // `!== undefined` arm. If this ever reddens, the fix over-reached.
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    const res = await POST(makeRequest(validBody({ metadata: {} })));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("WR-04 (Phase 53): parseCsvMetadata shared validator (both guard paths)", () => {
  // The handler tests above prove the PRE-create call site rejects null. This
  // pins the SHARED validator directly so the contract holds regardless of which
  // call site invokes it — incl. the post-create `applyCsvMetadataUpdate` path
  // that the pre-create guard normally shadows. If a refactor ever drops the
  // pre-create guard, this still fails loudly on a null category_id.
  it("rejects an explicit category_id: null (ok:false, field metadata.category_id)", () => {
    const result = parseCsvMetadata({ category_id: null });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.field).toBe("metadata.category_id");
  });

  it("accepts a valid UUID category_id and carries it into the payload", () => {
    const uuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const result = parseCsvMetadata({ category_id: uuid });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.payload?.category_id).toBe(uuid);
  });

  it("leaves the legitimate metadata-less path (empty blob / null raw) untouched", () => {
    // ⚖️ 146.2-03 / G2 (2026-08-20) — WHAT "METADATA-LESS" MEANS NARROWED, and
    // this case narrowed with it. It used to assert that `{description:"x"}` —
    // an ABSENT category_id key alongside a real field — was accepted, which is
    // precisely the blob that ran a REAL metadata UPDATE and left `category_id`
    // NULL, falsifying the proof the 23505 resolve arm's FILL is built on.
    // That blob is now a 400 (pinned in csv-finalize-rpc.test.ts).
    //
    // The path that stays legal is the one that WRITES NOTHING: an empty blob,
    // or no metadata at all. It runs no UPDATE, so it cannot make a committed
    // NULL mean anything other than "the UPDATE never ran".
    const empty = parseCsvMetadata({});
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error("expected acceptance");
    expect(empty.payload?.category_id).toBeUndefined();
    // Entirely absent metadata object → ok, null payload.
    const none = parseCsvMetadata(null);
    expect(none.ok).toBe(true);
    if (!none.ok) throw new Error("expected acceptance");
    expect(none.payload).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("NEW-C14-05: over-cap description → 400 instead of silent truncation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("rejects description > 5000 chars with 400 CSV_INVALID_FORMAT", async () => {
    const longDesc = "x".repeat(5001);
    const res = await POST(makeRequest(validBody({
      metadata: { description: longDesc },
    })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
    expect(body.debug_context?.field).toContain("description");
  });

  it("accepts description exactly at the 5000-char cap", async () => {
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    const desc5000 = "y".repeat(5000);
    // 146.2-03 / G2 — the blob carries a category_id so the ONLY thing that
    // could 400 here is the description cap this case is about.
    const res = await POST(makeRequest(validBody({
      metadata: { category_id: COMMITTED_CATEGORY_ID, description: desc5000 },
    })));
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("NEW-C14-09: daily_return magnitude > 10 → 400", () => {
  it("rejects daily_return: 1e30 with CSV_INVALID_FORMAT", () => {
    const result = parseDailyReturnsSeries([{ date: "2024-01-01", daily_return: 1e30 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CSV_INVALID_FORMAT");
      expect(result.message).toContain("non-physical");
    }
  });

  it("rejects daily_return: -100 (total loss + more) with CSV_INVALID_FORMAT", () => {
    const result = parseDailyReturnsSeries([{ date: "2024-01-01", daily_return: -100 }]);
    expect(result.ok).toBe(false);
  });

  it("accepts daily_return: 0.01 (1% daily gain)", () => {
    const result = parseDailyReturnsSeries([{ date: "2024-01-01", daily_return: 0.01 }]);
    expect(result.ok).toBe(true);
  });

  it("accepts daily_return: 10 (boundary: +1000%/day)", () => {
    const result = parseDailyReturnsSeries([{ date: "2024-01-01", daily_return: 10 }]);
    expect(result.ok).toBe(true);
  });

  it("rejects daily_return: 10.0001 (just over boundary)", () => {
    const result = parseDailyReturnsSeries([{ date: "2024-01-01", daily_return: 10.0001 }]);
    expect(result.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("NEW-C14-10: date validation (round-trip + future)", () => {
  it("rejects impossible calendar date '2026-02-30'", () => {
    const result = parseDailyReturnsSeries([{ date: "2026-02-30", daily_return: 0.01 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CSV_INVALID_FORMAT");
      expect(result.message).toContain("not a valid calendar date");
    }
  });

  it("rejects impossible month '2026-13-01'", () => {
    const result = parseDailyReturnsSeries([{ date: "2026-13-01", daily_return: 0.01 }]);
    expect(result.ok).toBe(false);
  });

  it("rejects a future date strictly after today", () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const futureStr = future.toISOString().slice(0, 10);
    const result = parseDailyReturnsSeries([{ date: futureStr, daily_return: 0.01 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("in the future");
    }
  });

  it("accepts a past date '2020-06-15'", () => {
    const result = parseDailyReturnsSeries([{ date: "2020-06-15", daily_return: 0.01 }]);
    expect(result.ok).toBe(true);
  });

  it("accepts today's date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = parseDailyReturnsSeries([{ date: today, daily_return: 0.01 }]);
    expect(result.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════

/**
 * R7 (146.2-06) — THE DATE LOWER BOUND, AS A ROUTE-SIDE MIRROR OF THE FOLD.
 *
 * The fold refuses a pre-1900 row itself (GUARD 9,
 * `20260819151000_csv_finalize_fold_guard1_null_safe.sql:369`:
 * `OR (elem->>'date')::DATE < DATE '1900-01-01'`) with SQLSTATE 22023. On the
 * route, a fold 22023 is a CLASS 1 "rolled-back" failure → 500
 * CSV_FINALIZE_FAIL, whose copy tells the user the submission is **safe to try
 * again**. It is not: the same file fails identically forever. A permanent
 * input answered with retry copy is the defect; the fix is to classify it at
 * the boundary, where the route ALREADY mirrors the fold's other two fences
 * (the |daily_return| <= 10 magnitude bound mirrors GUARD 9's `BETWEEN -10 AND
 * 10`, and the future-date arm mirrors its `> now()::date` conjunct).
 *
 * ⛔ 1900-01-01 IS THE FOLD'S LITERAL, COPIED. Do not "round" it to 1970, to
 * the Unix epoch, or to whatever the next reviewer finds tidier: a route bound
 * TIGHTER than the fold's silently rejects payloads the database would accept,
 * and a bound LOOSER than the fold's re-opens exactly the retry-copy 500 this
 * closes. The two literals must be the same string.
 */
describe("R7 (146.2-06): date lower bound mirrors the fold's DATE '1900-01-01' fence", () => {
  it("rejects '1899-12-31' — the row the fold would 22023 — with a row-indexed 400", () => {
    const result = parseDailyReturnsSeries([
      { date: "2024-01-01", daily_return: 0.01 },
      { date: "1899-12-31", daily_return: 0.01 },
    ]);
    expect(
      result.ok,
      "a pre-1900 row still reaches the fold, which refuses it 22023 — surfaced to the user as a 500 that says the submission is safe to try again, about an input that will fail identically forever",
    ).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CSV_INVALID_FORMAT");
      // Row-indexed, same register as the future-date arm it mirrors.
      expect(result.message).toContain("daily_returns_series[1].date");
      expect(result.message).toContain("1900-01-01");
      expect(result.debug_context).toMatchObject({ row: 1, date: "1899-12-31" });
    }
  });

  it("accepts '1900-01-01' exactly — the fence is `< 1900-01-01`, not `<=`", () => {
    const result = parseDailyReturnsSeries([
      { date: "1900-01-01", daily_return: 0.01 },
    ]);
    expect(
      result.ok,
      "the boundary date itself was rejected — a route bound TIGHTER than the fold's refuses payloads the database would have accepted",
    ).toBe(true);
  });

  it("rejects '0001-01-01' (a spreadsheet zero-date export)", () => {
    const result = parseDailyReturnsSeries([
      { date: "0001-01-01", daily_return: 0.01 },
    ]);
    expect(result.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe("NEW-C14-12: trimmed strategy_name length check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("accepts a 79-visible-char name with trailing spaces (trimmed = 79 chars)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      error: null,
    });
    updateMock.mockResolvedValueOnce({ error: null });
    // 79 visible chars + 2 trailing spaces = 81 raw chars → pre-fix would 400
    const name = "A".repeat(79) + "  ";
    const res = await POST(makeRequest(validBody({ strategy_name: name })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects a trimmed name that is exactly 81 chars (over cap)", async () => {
    const name = "B".repeat(81);
    const res = await POST(makeRequest(validBody({ strategy_name: name })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("CSV_INVALID_FORMAT");
  });
});

// ══════════════════════════════════════════════════════════════════════════

/**
 * 161-03 / WIZERR-12 — THE A2 REFUSAL SAYS WHAT ACTUALLY HAPPENED.
 *
 * The A2 terminal-status arm went through `refuse()` with no `humanMessage`,
 * so it shipped the DEFAULT sentence — "already created a strategy with a
 * DIFFERENT TRACK RECORD". A2 fires ahead of the name check and ahead of the
 * series check, so at that point nothing is known about the track record at
 * all; the sibling suite's own case arms the committed row with name
 * "Renamed" precisely because the names may differ too. The default sentence
 * was therefore a claim the arm cannot make.
 *
 * ⚠️ ORACLE INDEPENDENCE. The expected sentence below is HAND-TYPED, never
 * imported from the route. An imported constant makes the assertion and the
 * implementation one oracle, and the case would pass on a route whose copy had
 * silently changed. `START_NEW_STRATEGY_LABEL` is spelled out here for the
 * same reason — the route interpolates the constant, this file types the
 * words, and the two are held equal by hand (IN-05).
 */
const ROUTE_A2_STATUS_MISMATCH =
  "This wizard session already committed a strategy that is not in the " +
  "state this submission asked for, so we refused before writing anything " +
  "of this submission. Start a new strategy to make a separate submission.";

/** The DEFAULT sentence, re-typed, so the discrimination is assertable. */
const ROUTE_DEFAULT_TRACK_RECORD_MISMATCH =
  "This wizard session already created a strategy with a different track " +
  "record, so we refused before writing anything of this submission. Start " +
  "a new strategy to upload a different file.";

describe("[161-03 / WIZERR-12] the A2 terminal-status refusal names its own case", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("🔴 a manager resubmit onto a committed 'private' row does NOT claim a different track record", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });
    // Same NAME on purpose: the track record is not what differs here, and the
    // default sentence would say it is. Only `status` differs — 'private' (a
    // CONTRIB-02 contribution) against this manager submission's
    // 'pending_review'.
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: EXISTING_ID,
        name: "Test Strategy",
        status: "private",
        category_id: COMMITTED_CATEGORY_ID,
        asset_class: "traditional",
      },
      error: null,
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(body.human_message).toBe(ROUTE_A2_STATUS_MISMATCH);
    // The needle is real, not blank — a blanked constant would make the
    // `not.toContain` below pass while checking nothing.
    expect(ROUTE_DEFAULT_TRACK_RECORD_MISMATCH.length).toBeGreaterThan(60);
    expect(
      body.human_message,
      "the refusal told the user their track record differs, on the one arm " +
        "that runs BEFORE anything about the track record has been read",
    ).not.toContain("a different track record");
    // Everything else about the arm is unchanged: still 409, still the shared
    // code, still no-store, still one alert, still zero writes.
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(body.debug_context?.strategy_id).toBe(EXISTING_ID);
    expect(findCapture("finalize-resolve-refused")).toBeDefined();
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("ANTI-CONTROL: the NAME-mismatch refusal keeps the default sentence byte-identical", async () => {
    // Without this, "give A2 its own sentence" is satisfiable by replacing the
    // default for every arm — and the default is TRUE where it was authored:
    // a changed name IS a different track record.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });
    // Status MATCHES this manager submission, so A2 passes and the name check
    // speaks.
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: EXISTING_ID,
        name: "A Different Strategy",
        status: "pending_review",
        category_id: COMMITTED_CATEGORY_ID,
        asset_class: "traditional",
      },
      error: null,
    });

    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.human_message).toBe(ROUTE_DEFAULT_TRACK_RECORD_MISMATCH);
  });
});
