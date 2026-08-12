/** @vitest-environment jsdom */
/**
 * Phase 154 / plan 01 (STALE-01a) — RED PIN: an absent `strategy_analytics` row
 * must not be reported as the domain value `"pending"`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FINDING THIS FILE NAMES
 * ═══════════════════════════════════════════════════════════════════════════
 * On 2026-08-04 the founder's MT5 wizard sat on "Fetching trades…" indefinitely.
 * `154-INVESTIGATION.md` settles the supplier from PROD evidence: mechanism
 * **M2(ii)** — `compute_jobs` shows the whole chain terminal (the
 * `compute_analytics_from_csv` job reached `done` at **11:39:35.342759**, the
 * exact timestamp in the requirement, `last_error` null on all 22 rows), so the
 * BACKEND WAS FINISHED while the screen still claimed work was in flight. The
 * client was reading nothing, and this hook's ladder arm converted that nothing
 * into a positive claim about the world:
 *
 *     // useStrategySyncPoller.ts:228-229
 *     const nextStatus = (statusRow?.computation_status ?? "pending")
 *
 * `{ data: null, error: null }` is PostgREST's answer for zero rows via
 * `.maybeSingle()` — an absent row OR an RLS-filtered one. Neither is "the
 * computation is queued". The coercion invents that, the loop reads its own
 * invention as non-terminal, and the ladder re-schedules forever.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FILE CONTAINS NO FIX AND MUST FAIL AT HEAD
 * ═══════════════════════════════════════════════════════════════════════════
 * `T2` is EXPECTED RED at the commit that introduces it. That is the deliverable
 * (ROADMAP Phase 154 criterion 2 / CONTEXT.md: "root cause established" closes
 * only on a failing repro, never on a written trace). Plan 154-04 greens it. It
 * is deliberately NOT marked `.fails` or `.skip` — a skipped repro is not a gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE INTERVAL ARM IS IN THIS FILE (TWIN-3)
 * ═══════════════════════════════════════════════════════════════════════════
 * The correct behaviour already exists SEVENTY LINES UP in the same module. The
 * interval arm (`:151-159`) meets the identical `{ data: null, error: null }`
 * read with `if (!data) { … return; }` and never calls `onStatus` at all. So the
 * subject of this file is not "the ladder arm is wrong in the abstract" — it is
 * that ONE MODULE ANSWERS THE SAME QUESTION TWO WAYS. `SYM-interval` is
 * therefore its own `it()` rather than a loop: a fix applied to the ladder arm
 * alone would look complete while the divergence — the thing actually worth
 * pinning — went unobserved.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ORACLE INDEPENDENCE (154-VALIDATION.md § Oracle Independence, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *  · No constant is imported from the module under test. `LADDER_SCHEDULE`,
 *    `INTERVAL_CADENCE_MS` and every advance are HAND-TYPED literals. Importing
 *    `POLL_BACKOFF_MS` would make the test pass for any schedule, including a
 *    regression that moved it.
 *  · `TERMINAL_STATUSES` is a hand-typed literal set, NOT `isComputedAnalytics()`
 *    from `closed-sets.ts` — that function is code under test. Its independent
 *    authority is the DB CHECK constraint (migration `20260602120000`).
 *  · The double reproduces PostgREST's REAL zero-rows shape. A hand-invented
 *    `{ data: undefined }` would make T2 meaningless: that is not the shape the
 *    bug rides on, and `DOUBLE:` below pins the shape so it cannot drift.
 *  · `vi.spyOn` + `vi.restoreAllMocks()`, NEVER the global-stub helper
 *    (DEF-16-1, this repo's known CI-only failure class — CI Node 22 vs local
 *    Node 25: 81 files reach for it and 38 never clean up, so with one
 *    `globalThis` per worker the suite's verdict depends on file order). Donor A
 *    (`useNoteAutoSave.test.ts:31`) reaches for it; that half of the donor is
 *    deliberately NOT copied (154-PATTERNS.md §10).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES **NOT** PROVE
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. It does not prove WHY the founder's read came back empty. `compute_jobs`
 *     proves the SERVER state; the two candidates inside M2(ii) — a PostgREST
 *     zero-rows answer under an RLS/session boundary vs a genuine absent-row
 *     race — are indistinguishable without a browser console that no longer
 *     exists. Both are discharged at this seam, which is why the pin lives here.
 *  2. jsdom under fake timers is not a browser. Real tick scheduling and real
 *     PostgREST payloads are outside it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStrategySyncPoller } from "./useStrategySyncPoller";

// ---------------------------------------------------------------------------
// Hand-typed schedules. ⛔ NOT `POLL_BACKOFF_MS` — see the Oracle Independence
// block above. Module-level `const` so the array identity is stable in the
// hook's effect deps (`:275-283`), exactly as the production module constant is.
// ---------------------------------------------------------------------------
const LADDER_SCHEDULE = [3000, 3000, 5000] as const;
const INTERVAL_CADENCE_MS = 3000;

/**
 * How far fake time is advanced in every case. A literal, deliberately: the
 * hook's behaviour under a zero-rows read is a per-tick property, so the only
 * requirement is "several ticks of the slowest step", and expressing that as
 * `LADDER_SCHEDULE[2] * n` would reintroduce the coupling the literal avoids.
 */
const ADVANCE_MS = 60_000;

/**
 * The DB's terminal `computation_status` values, HAND-TYPED.
 *
 * ⛔ Deliberately NOT `isComputedAnalytics()` from `@/lib/closed-sets`: that
 * predicate is called by the hook at `:235` and is therefore code under test —
 * asserting through it would compare the implementation to itself. The
 * independent authority for this set is the `strategy_analytics` CHECK
 * constraint in migration `20260602120000`; if the DB union changes, this array
 * is edited BY HAND and the change is visible in review, which is the point.
 */
const TERMINAL_STATUSES = [
  "failed",
  "complete",
  "complete_with_warnings",
] as const;

/**
 * PostgREST's zero-rows answer for `.maybeSingle()`, verbatim.
 *
 * ⚠️ THE EXACT SHAPE IS LOAD-BEARING. supabase-js resolves a zero-row
 * `.maybeSingle()` as `{ data: null, error: null }` — a SUCCESSFUL read that
 * found nothing, which is precisely why the hook's `if (statusError)` arm does
 * not fire and the `?? "pending"` coercion is reached. A double that answered
 * `{ data: undefined }`, or that put anything in `error`, would exercise a
 * different branch and T2 would testify about nothing.
 */
const ZERO_ROWS = { data: null, error: null } as const;

/** A healthy `.maybeSingle()` / `.single()`-shaped result. */
const okRow = (data: unknown) => ({ data, error: null });

interface ChainState {
  ascending: boolean | null;
}

/**
 * A chainable postgrest-builder double (154-PATTERNS.md §10, Donor B —
 * `SyncPreviewStep.readfailure.runtime.test.tsx:146-199`).
 *
 * The resolver is invoked LAZILY, at await time. BOTH terminal await forms this
 * module uses are supported, and both are needed in the same file: the ladder
 * arm ends in `.maybeSingle()` (`:203`) and the interval arm ends in `.single()`
 * (`:136`). Donor B only had `maybeSingle`; `single` is this file's addition,
 * and without it the interval arm would REJECT rather than read — which would
 * make `SYM-interval` pass for the wrong reason. `INTERVAL-CTRL:` below exists
 * to catch exactly that.
 */
function chain(resolve: (state: ChainState) => unknown) {
  const state: ChainState = { ascending: null };
  const self = {
    eq: () => self,
    neq: () => self,
    limit: () => self,
    order: (_column: string, opts?: { ascending?: boolean }) => {
      state.ascending = opts?.ascending ?? true;
      return self;
    },
    maybeSingle: () => Promise.resolve(resolve(state)),
    single: () => Promise.resolve(resolve(state)),
    then: (onFulfilled: (value: unknown) => void) => onFulfilled(resolve(state)),
  };
  return self;
}

const DEFAULT_FACTORY = () => ({
  from: () => ({ select: () => chain(() => ZERO_ROWS) }),
});

let currentClientFactory: () => unknown = DEFAULT_FACTORY;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

/** Every `strategy_analytics` read answers PostgREST's zero-rows shape. */
function installZeroRowsClient() {
  currentClientFactory = () => ({
    from: () => ({ select: () => chain(() => ZERO_ROWS) }),
  });
}

/** Every `strategy_analytics` read answers a real row with `status`. */
function installRowClient(status: string) {
  currentClientFactory = () => ({
    from: () => ({
      select: () =>
        chain(() =>
          okRow({
            computation_status: status,
            computation_error: null,
            computed_at: "2026-08-04T11:39:35.342759+00:00",
          }),
        ),
    }),
  });
}

const STRATEGY_ID = "8d382aaf-4e23-4fc1-85b9-78fafc5c8e54";

describe("[154-01 / STALE-01a] useStrategySyncPoller — an absent row is not a status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The interval arm logs non-PGRST116 errors; keep the console quiet without
    // losing the ability to restore it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The ladder arm warns ONCE per run on a clean-null read (154-04, Rule 12).
    // Spied rather than silenced-and-forgotten: GRACE-ladder below asserts on it.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = DEFAULT_FACTORY;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE DOUBLE IS PINNED AGAINST THE CONTRACT IT STANDS IN FOR.
  //
  // 154-VALIDATION.md § Oracle Independence, last bullet: "any fake/double
  // pinned against the real contract it stands in for … the poll fake must
  // reproduce PostgREST's real `{data: null, error: null}` zero-rows shape".
  // Without this case a later edit could quietly change `ZERO_ROWS` to a shape
  // the bug does not ride on and T2 would go green having proved nothing.
  // ═════════════════════════════════════════════════════════════════════════
  it("DOUBLE: the zero-rows double is PostgREST's real shape, not an invention", () => {
    expect(
      Object.keys(ZERO_ROWS).sort(),
      "The zero-rows double no longer has exactly the keys supabase-js resolves " +
        "for a zero-row .maybeSingle(). T2 rides on `error` being null (so the " +
        "hook's error arm does NOT fire) while `data` is null (so the coercion " +
        "IS reached). Any other shape exercises a different branch.",
    ).toEqual(["data", "error"]);
    expect(ZERO_ROWS.data).toBeNull();
    expect(ZERO_ROWS.error).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // POSITIVE COUNTERPART — FIRST, deliberately.
  //
  // Every assertion below is an ABSENCE ("onStatus was not called with …"). A
  // negative-only oracle is satisfied by a harness whose loop never runs at all
  // — a mistyped mock, a hook that threw on mount, a schedule never reached.
  // This case is what makes those absences mean something: it proves the ladder
  // arm DOES read, DOES report, and DOES reach `onTerminal` in this harness.
  // ═════════════════════════════════════════════════════════════════════════
  it("LADDER-CTRL: a real terminal row IS reported and reaches onTerminal (positive counterpart)", async () => {
    const onStatus = vi.fn();
    const onTerminal = vi.fn(() => "done" as const);
    const onError = vi.fn();
    installRowClient("complete_with_warnings");

    renderHook(() =>
      useStrategySyncPoller({
        enabled: true,
        strategyId: STRATEGY_ID,
        schedule: LADDER_SCHEDULE,
        maxConsecutiveErrors: 3,
        onStatus,
        onTerminal,
        onError,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_MS);
    });

    const reported = onStatus.mock.calls.map((call) => call[0] as string);
    expect(
      reported.length,
      "The ladder arm never reported a status for a healthy row. The harness is " +
        "not driving the loop, so every absence assertion in this file is vacuous.",
    ).toBeGreaterThan(0);
    // The hand-typed terminal set, not `isComputedAnalytics()`.
    expect(TERMINAL_STATUSES).toContain(reported[0]);
    expect(
      onTerminal,
      "A terminal status did not reach onTerminal. The loop is reading but not " +
        "classifying, which would let T2 pass for the wrong reason.",
    ).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // T2 — THE FINDING. EXPECTED RED AT HEAD.
  // ═════════════════════════════════════════════════════════════════════════
  it("T2: a zero-rows read is NEVER reported as the fabricated \"pending\" status", async () => {
    const onStatus = vi.fn();
    const onTerminal = vi.fn(() => "done" as const);
    const onError = vi.fn();
    installZeroRowsClient();

    renderHook(() =>
      useStrategySyncPoller({
        enabled: true,
        strategyId: STRATEGY_ID,
        schedule: LADDER_SCHEDULE,
        maxConsecutiveErrors: 3,
        onStatus,
        onTerminal,
        onError,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_MS);
    });

    const reported = onStatus.mock.calls.map((call) => call[0] as string);

    expect(
      reported,
      `The poll read NOTHING — PostgREST's { data: null, error: null } zero-rows ` +
        `answer — and the hook reported "pending", a value no writer ever wrote. ` +
        `That is STALE-01a's supplier, confirmed on PROD as mechanism M2(ii): on ` +
        `2026-08-04 the compute_analytics_from_csv job reached 'done' at ` +
        `11:39:35.342759 with every job row terminal, and the wizard was still ` +
        `rendering "Fetching trades…" — because this line answered a question it ` +
        `had no answer to. An absent row is not a queued computation; the ` +
        `interval arm 70 lines up already knows that (SYM-interval below).`,
    ).not.toContain("pending");

    // The consequence, stated separately from the fabrication. A status the
    // caller never learns about is a state the UI cannot leave: `pending` is
    // non-terminal, so the ladder re-schedules with no counter, no cap and no
    // clock (`:249`).
    expect(
      onTerminal,
      "A fabricated non-terminal status also means onTerminal is unreachable, " +
        "so the loop has no exit at all for this read.",
    ).not.toHaveBeenCalled();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // GRACE-ladder (154-04) — the EXIT the fix gives the absent-row read.
  //
  // T2 above only says what must NOT happen (no fabricated status). On its own,
  // "report nothing and keep polling" is still a loop with no exit — it just
  // stops lying while it hangs. This case pins the positive half: when the
  // caller supplies the grace window the option has always declared (`:61`,
  // consumed by the interval arm since 95-05 and by the ladder arm since this
  // plan), a persistently-absent row ESCALATES through the existing `onError`
  // sink rather than polling forever.
  //
  // ⛔ The grace value is a HAND-TYPED literal here and CALLER-SUPPLIED in
  // production: this plan introduces no new threshold. The ladder walks
  // 3000/3000/5000, so with a grace of 2 the escalation lands on the third poll,
  // well inside ADVANCE_MS.
  // ═════════════════════════════════════════════════════════════════════════
  it("GRACE-ladder: a persistently absent row escalates via onError at the grace boundary", async () => {
    const GRACE_POLLS = 2; // hand-typed; not imported, not derived
    const onStatus = vi.fn();
    const onTerminal = vi.fn(() => "done" as const);
    const onError = vi.fn();
    installZeroRowsClient();

    renderHook(() =>
      useStrategySyncPoller({
        enabled: true,
        strategyId: STRATEGY_ID,
        schedule: LADDER_SCHEDULE,
        maxConsecutiveErrors: 3,
        missingRowGracePolls: GRACE_POLLS,
        onStatus,
        onTerminal,
        onError,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_MS);
    });

    expect(
      onError,
      "A row that is absent poll after poll never escalated. The ladder arm is " +
        "back to an unbounded wait — silent this time instead of lying, but " +
        "still a state the user cannot leave.",
    ).toHaveBeenCalled();
    expect(
      onStatus,
      "The escalation path still reported a status for a read that found " +
        "nothing. Escalating is not licence to fabricate.",
    ).not.toHaveBeenCalled();

    // Rule 12 — the clean-null read is OBSERVABLE. Before this plan it logged
    // nothing at all, which is why the 2026-08-04 console (had it survived)
    // could not have distinguished M2(ii)'s two candidates. Once per run, not
    // once per poll: a 15-minute wait must not bury the console.
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(STRATEGY_ID);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // INTERVAL-CTRL — the symmetry case's own positive counterpart.
  //
  // `SYM-interval` asserts an ABSENCE on the interval arm. If `chain()` had no
  // `.single()` the interval read would REJECT, onStatus would never fire, and
  // SYM-interval would pass having proved nothing whatsoever. This case pins
  // that the interval arm is genuinely reading through this double.
  // ═════════════════════════════════════════════════════════════════════════
  it("INTERVAL-CTRL: the interval arm DOES report a real row through this double", async () => {
    const onStatus = vi.fn();
    const onError = vi.fn();
    installRowClient("computing");

    renderHook(() =>
      useStrategySyncPoller({
        enabled: true,
        strategyId: STRATEGY_ID,
        schedule: INTERVAL_CADENCE_MS,
        maxAttempts: 40,
        missingRowGracePolls: 10,
        onStatus,
        onError,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_MS);
    });

    expect(
      onStatus.mock.calls.map((call) => call[0] as string),
      "The interval arm reported nothing for a HEALTHY row. `.single()` is not " +
        "wired in the double, so SYM-interval below would pass vacuously.",
    ).toContain("computing");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SYM-interval — TWIN-3, THE DIVERGENCE. PASSES AT HEAD.
  //
  // Its own `it()`, never a loop over the two arms (154-PATTERNS.md §11.3): the
  // pair is what makes "one module, two answers to one question" the subject.
  // Without it, a fix to the ladder arm would look like a class-fix while the
  // asymmetry that produced the defect went unrecorded.
  // ═════════════════════════════════════════════════════════════════════════
  it("SYM-interval: the interval arm reports NOTHING for the identical zero-rows read (passes today)", async () => {
    const onStatus = vi.fn();
    const onError = vi.fn();
    installZeroRowsClient();

    renderHook(() =>
      useStrategySyncPoller({
        enabled: true,
        strategyId: STRATEGY_ID,
        schedule: INTERVAL_CADENCE_MS,
        maxAttempts: 40,
        missingRowGracePolls: 10,
        onStatus,
        onError,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_MS);
    });

    expect(
      onStatus,
      "The interval arm has started fabricating a status from an absent row too. " +
        "Its `if (!data) { … return; }` at :151-159 IS the oracle T2 measures the " +
        "ladder arm against — if this reddens, the module no longer contains its " +
        "own correct answer and TWIN-3 has been closed in the wrong direction.",
    ).not.toHaveBeenCalled();
  });
});
