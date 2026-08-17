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
 *   RED-TEAM-L2: retry-enable predicate (CSV_DUPLICATE_SESSION never re-enables)
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
    async (): Promise<{ data: unknown[]; error: unknown }> => ({
      data: [],
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
      update: (_payload: Record<string, unknown>) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => updateMock(),
        }),
      }),
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
    // CSV_PERSIST_FAIL) so the wizard's retry predicate re-enables Submit
    // beside the "safe to try again" sentence (Plan 04 key decision;
    // RED-TEAM-L2 below pins the predicate side of that pairing).
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
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: { id: EXISTING_ID, name: "A Different Strategy", status: "pending_review" },
      error: null,
    });

    // The submission CARRIES metadata deliberately: if the ordering ever
    // regressed to metadata-before-checks (the pre-fold 409 lie, where hop 2
    // had already overwritten the resolved strategy's metadata before the
    // fence refused), this update WOULD land — the not-called assertion
    // below is what reds.
    const res = await POST(
      makeRequest(
        validBody({ metadata: { description: "must never be written on a refusal" } }),
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
    strategiesMaybeSingleMock.mockResolvedValueOnce({
      data: { id: EXISTING_ID, name: "Test Strategy", status: "private" },
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
    const res = await POST(makeRequest(validBody()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(EXISTING_ID);
    expect(body.status).toBe("private");

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

  it("leaves the legitimate metadata-less path (absent key / null raw) untouched", () => {
    // Absent category_id key → ok, no category_id in payload.
    const absent = parseCsvMetadata({ description: "x" });
    expect(absent.ok).toBe(true);
    if (!absent.ok) throw new Error("expected acceptance");
    expect(absent.payload?.category_id).toBeUndefined();
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
    const res = await POST(makeRequest(validBody({
      metadata: { description: desc5000 },
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

describe("RED-TEAM-L2: CSV_DUPLICATE_SESSION must not re-enable Submit (infinite retry guard)", () => {
  // The Submit-button enable/disable logic in CsvSubmitStep is:
  //   if (data.code !== "CSV_DUPLICATE_SESSION") {
  //     setSubmitting(false);  // re-enable
  //   }
  // We test this as a pure predicate to avoid heavy React rendering setup.
  // The invariant: CSV_DUPLICATE_SESSION must NOT re-enable Submit, because
  // re-clicking Submit triggers the same 23505 → lookup-fails → 409 loop.
  // Phase 145 ship-review fix: CSV_PERSIST_FAIL left the fence — its sole
  // post-fold emitter is the fail-closed resolve 503, which persists nothing
  // and instructs "Try again shortly."; fencing it stranded the user on a
  // dead button. RED observed: the pre-fix predicate fails the flipped
  // expectation below.

  function shouldReEnableSubmit(code: string | undefined): boolean {
    return code !== "CSV_DUPLICATE_SESSION";
  }

  it("does NOT re-enable Submit for CSV_DUPLICATE_SESSION (RED-TEAM-L2)", () => {
    // Pre-fix this was true (Submit re-enabled) → infinite retry loop
    expect(shouldReEnableSubmit("CSV_DUPLICATE_SESSION")).toBe(false);
  });

  it("re-enables Submit for CSV_PERSIST_FAIL (post-fold: fail-closed 503, nothing persisted, retry instructed)", () => {
    expect(shouldReEnableSubmit("CSV_PERSIST_FAIL")).toBe(true);
  });

  it("re-enables Submit for CSV_FINALIZE_FAIL (safe to retry)", () => {
    // Phase 145 pairing: the fold-failure 500 carries CSV_FINALIZE_FAIL
    // precisely so its honest "safe to try again" copy sits beside a LIVE
    // Submit button (145-05 A asserts the copy side).
    expect(shouldReEnableSubmit("CSV_FINALIZE_FAIL")).toBe(true);
  });

  it("re-enables Submit for CSV_INVALID_FORMAT (safe to retry after correcting input)", () => {
    expect(shouldReEnableSubmit("CSV_INVALID_FORMAT")).toBe(true);
  });

  it("re-enables Submit for undefined code (unknown error, safe to retry)", () => {
    expect(shouldReEnableSubmit(undefined)).toBe(true);
  });
});
