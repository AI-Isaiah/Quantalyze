/** @vitest-environment jsdom */
/**
 * Phase 154 / plan 01 (STALE-01b) — RED PIN: a terminal red refusal must not be
 * rendered from a series that is being re-derived underneath the reader.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FINDING THIS FILE NAMES — read it before "simplifying" the file
 * ═══════════════════════════════════════════════════════════════════════════
 * Instance (b) of STALE-01. `run_derive_broker_dailies_job` does a WHOLESALE
 * delete→re-upsert of `csv_daily_returns` on the strategy-mode path
 * (`analytics-service/services/job_worker.py:2539-2560`, the "series
 * heal-delete"), and its failure arm DELIBERATELY OMITS `series_completeness`
 * so a prior verdict survives. A poll landing inside that window therefore sees:
 * a terminal `complete_with_warnings` status, ZERO series rows, and a null
 * completeness verdict — a momentary hole, not a fact about the strategy.
 *
 * The single-key arm answers that with a terminal, loop-stopping red envelope.
 *
 * ⭐ **The composite arm, 300 lines above in the same function, already guards
 * this exact window** (`SyncPreviewStep.tsx:1092-1103`):
 *
 *     // R2-5 (stale-complete race): … A poll landing inside that window can
 *     // read a 'complete' status with 0 series rows … Treat an empty series as
 *     // NOT-yet-terminal …
 *     if (series.length === 0) { return "repoll"; }
 *
 * TWIN-1. There is no counterpart in the single-key arm. That asymmetry — one
 * class, one arm — is the whole of instance (b), and it is why T3 and T3b are
 * two named cases in ONE file rather than a loop: the divergence is the subject.
 * A fix that reads only T3 would look complete while the pair went unrecorded.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW THIS RELATES TO INSTANCE (a) — one root idea, two sites
 * ═══════════════════════════════════════════════════════════════════════════
 * (a) and (b) are the SAME mistake pointing in opposite directions: a reading
 * the client cannot know is current is converted into a positive claim about
 * the world. In (a) "I read nothing" became *"still pending, forever"*; here
 * "I read an empty table" becomes *"this strategy has no track record"*. But
 * they are DISTINCT CODE SITES (`useStrategySyncPoller.ts:228` +
 * `SyncPreviewStep.tsx:2290` for (a); the missing single-key R2-5 guard at
 * ~`:1420` for (b)), so a single-site fix discharges NEITHER alone. See
 * `154-INVESTIGATION.md` § "Do (a) and (b) share one cause?".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FILE CONTAINS NO FIX
 * ═══════════════════════════════════════════════════════════════════════════
 * T3 is EXPECTED RED at the commit that introduces it. T3b is EXPECTED GREEN —
 * it is the arm that already behaves. `REFUSAL-CTRL` is the positive
 * counterpart and is also green. Nothing is `.fails` or `.skip`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEEDLE DISCIPLINE — the near-miss that produced this rule
 * ═══════════════════════════════════════════════════════════════════════════
 * `ErrorEnvelope` renders `code: <CODE>` verbatim in its diagnostics block and
 * that string is unique per state; the envelope TITLE is NOT — it is shared by
 * `SYNC_FAILED`, `GATE_INSUFFICIENT_TRADES` and `GATE_NO_DATA_SOURCE` alike,
 * and using it once reported a broken tree GREEN (Donor `:93-107`). So the
 * needles below are hand-typed CODES, never copy.
 *
 * ⚠️ AND THE CODE IS PINNED STRUCTURALLY AS WELL. `[data-error-code]` on the
 * envelope root catches ANY refusal, not just the two named ones. That matters
 * here: with `csvRowCount === 0` the gate does not reach
 * `SERIES_PROVENANCE_UNVERIFIED` (which requires `csvRowCount > 0`) — it falls
 * through to `INSUFFICIENT_TRADES`, so at HEAD the rendered code is
 * `GATE_INSUFFICIENT_TRADES`. A test that needled only on the provenance code
 * would have gone GREEN against the very tree it exists to indict. Both named
 * codes AND the structural probe are asserted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ORACLE INDEPENDENCE (154-VALIDATION.md, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *  · No threshold or constant is imported from the modules under test — not
 *    from `SyncPreviewStep.tsx` and not from `strategyGate.ts`. The row counts
 *    below are hand-typed literals.
 *  · Every absence assertion has a positive counterpart plus the vacuity fence.
 *  · `vi.spyOn` + `vi.restoreAllMocks()`, NEVER the global-stub helper
 *    (DEF-16-1, CI Node 22 vs local Node 25).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS RECEIPT DOES **NOT** PROVE
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. jsdom under fake timers, not a browser.
 *  2. It does not prove the heal-delete window was what the founder hit on
 *     2026-08-04 — the PROD evidence implicates instance (a) for THAT screen.
 *     (b) is a second live instance named by CONTEXT.md, reproduced here on its
 *     own merits.
 *  3. It says nothing about what the arm should render INSTEAD. That is the fix
 *     plan's call (the UI-SPEC amber in-flight state); this file only pins that
 *     a terminal red refusal is the wrong answer.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";

/**
 * The rendered diagnostics line. `ErrorEnvelope` renders `code: <CODE>`
 * verbatim and that string is unique per state — unlike the title. Hand-typed,
 * never read off `WIZARD_ERROR_COPY`.
 */
const RENDERED_CODE = (code: string) => `code: ${code}`;

/**
 * The two refusals reachable from an empty/unstamped series on the single-key
 * arm, hand-typed. Which one fires depends on the row count, which is exactly
 * why both are asserted (see the needle-discipline block in the header).
 */
const CODE_INSUFFICIENT_TRADES = "GATE_INSUFFICIENT_TRADES";
const CODE_SERIES_PROVENANCE_UNVERIFIED = "GATE_SERIES_PROVENANCE_UNVERIFIED";

/** The composite waiting heading — hand-typed from `SyncPreviewStep.tsx:2300`. */
const COMPOSITE_WAITING_HEADING = "Stitching your composite track record";

/**
 * Row counts, hand-typed literals.
 *
 * `HEAL_DELETE_ROWS = 0` is the window itself: the worker has deleted and not
 * yet re-upserted. `STAMPED_ROWS = 10` is a series that genuinely exists and
 * that nobody has stamped — a REAL refusal that must survive any fix, and the
 * positive counterpart that makes T3's absences mean something.
 */
const HEAL_DELETE_ROWS = 0;
const STAMPED_ROWS = 10;

/** Long enough for the kickoff plus several terminal ticks. */
const SETTLE_MS = 30_000;

const okRow = (data: unknown) => ({ data, error: null });
const okList = (data: unknown[]) => ({ data, count: null, error: null });
const okCount = (count: number) => ({ data: null, count, error: null });

interface ChainState {
  ascending: boolean | null;
}

/**
 * A chainable postgrest-builder double (Donor B —
 * `SyncPreviewStep.readfailure.runtime.test.tsx:146-199`). Lazy at await time;
 * supports `.maybeSingle()` and awaiting the builder directly (a thenable),
 * which are the two forms both heavy arms use.
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
    then: (onFulfilled: (value: unknown) => void) => onFulfilled(resolve(state)),
  };
  return self;
}

const DEFAULT_FACTORY = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve(okRow(null)) }),
    }),
  }),
});

let currentClientFactory: () => unknown = DEFAULT_FACTORY;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

/**
 * The heavy analytics row. ONE row serves both arms: the single-key and
 * composite column strings differ but the union of their fields is harmless,
 * and `series_completeness: null` is the state the heal-delete failure arm
 * leaves behind (it OMITS the column so a prior verdict survives — here there
 * is no prior verdict, which is the common case for a first sync).
 */
const HEAVY_ANALYTICS_ROW = {
  cagr: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  volatility: null,
  cumulative_return: null,
  sparkline_returns: null,
  metrics_json_by_basis: null,
  data_quality_flags: null,
  computed_at: "2026-08-04T11:39:35.342759+00:00",
  series_completeness: null,
};

/**
 * Install the client for a run.
 *
 * The mount freshness probe reports NO row → kickoff POST fires → the component
 * lands in `waiting_for_complete`. The status poll then answers
 * `complete_with_warnings` — TERMINAL — on every tick, which is what drives the
 * heavy arm this file observes.
 *
 * `seriesRowCount` is the ONLY thing that varies between the cases: it is both
 * the single-key `csv_daily_returns` head-count AND the length of the composite
 * arm's series read, so the two arms are driven through the IDENTICAL state and
 * the divergence in their answers is attributable to the arms alone.
 *
 * `trades` counts ZERO throughout: an MT5/ledger-backed strategy has no fills
 * by construction, its whole track record IS the daily series. That is the
 * shape of the founder's key.
 */
function installClient(seriesRowCount: number) {
  currentClientFactory = () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === "strategy_analytics") {
          // Mount freshness probe → no row → kickoff POST fires.
          if (cols === "computation_status, computed_at") {
            return chain(() => okRow(null));
          }
          // Status poll → terminal success, every tick.
          if (cols === "computation_status, computation_error") {
            return chain(() =>
              okRow({
                computation_status: "complete_with_warnings",
                computation_error: null,
              }),
            );
          }
          if (cols === "data_quality_flags") {
            return chain(() => okRow({ data_quality_flags: null }));
          }
          // The heavy analytics row (both arms).
          return chain(() => okRow(HEAVY_ANALYTICS_ROW));
        }

        if (table === "trades") {
          if (cols === "id") return chain(() => okCount(0));
          if (cols === "timestamp") return chain(() => okList([]));
          if (cols === "symbol") return chain(() => okList([]));
        }

        if (table === "csv_daily_returns") {
          // SINGLE-KEY arm: `head: true` exact count.
          if (cols === "strategy_id") return chain(() => okCount(seriesRowCount));
          // COMPOSITE arm: the full series.
          return chain(() =>
            okList(
              Array.from({ length: seriesRowCount }, (_unused, i) => ({
                date: `2026-08-${String(i + 1).padStart(2, "0")}`,
                daily_return: 0.001,
              })),
            ),
          );
        }

        if (table === "api_keys") {
          return chain(() => okRow({ exchange: "mt5" }));
        }

        // COMPOSITE arm: membership.
        if (table === "strategy_keys") {
          return chain(() =>
            okList([
              {
                api_key_id: "key-stale-refusal-1",
                window_start: "2026-01-01",
                window_end: null,
                seq: 1,
                api_keys: { exchange: "mt5", label: "MT5" },
              },
            ]),
          );
        }

        // COMPOSITE arm: denominator config.
        if (table === "strategies") {
          return chain(() => okRow({ returns_denominator_config: null }));
        }

        return chain(() => okRow(null));
      },
    }),
  });
}

/**
 * The kickoff POST succeeds and reports `composite`. The cosmetic sync-progress
 * piggyback (composite only) is answered with a real IDLE body so a parse fault
 * cannot masquerade as the behaviour under test.
 */
function installFetchMock(composite: boolean) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/sync-progress")) {
        return new Response(
          JSON.stringify({
            jobStatus: null,
            stalled: false,
            memberProgress: [],
            degraded: false,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, composite }), {
        status: 200,
      });
    });
}

const baseProps = {
  strategyId: "strat-stale-refusal-1",
  apiKeyId: "key-stale-refusal-1",
  wizardSessionId: "session-stale-refusal-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

/**
 * Render, settle the mount + kickoff, then walk the poll ladder.
 *
 * THE THREE-STAGE ADVANCE IS LOAD-BEARING (Donor B `:310-328`):
 *   advance(0)         → mount effect + kickoff POST
 *   advance(0)         → kickoff body parse
 *   advance(SETTLE_MS) → several terminal ticks
 */
async function renderAndSettle(seriesRowCount: number, composite: boolean) {
  installClient(seriesRowCount);
  installFetchMock(composite);
  const view = render(<SyncPreviewStep {...baseProps} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
  });
  return {
    text: view.container.textContent ?? "",
    container: view.container,
    unmount: view.unmount,
  };
}

/** Did the run emit the terminal `wizard_error` funnel event? */
function wizardErrorEvents(): string[] {
  return vi
    .mocked(trackForQuantsEventClient)
    .mock.calls.filter((call) => call[0] === "wizard_error")
    .map((call) => JSON.stringify(call[1]));
}

describe("[154-01 / STALE-01b] a series being re-derived is not a verdict about the strategy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.mocked(trackForQuantsEventClient).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = DEFAULT_FACTORY;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // POSITIVE COUNTERPART — FIRST, deliberately.
  //
  // T3 and T3b both assert that a refusal is ABSENT. A negative-only oracle is
  // satisfied by a component that renders NOTHING — a crashed mount, a mistyped
  // table dispatch, an arm never reached. This case proves the harness DOES
  // drive the single-key heavy arm all the way to a rendered gate verdict.
  //
  // It also states the property the fix must NOT break. A series that genuinely
  // EXISTS and that no producer has stamped is a real refusal: "nobody looked"
  // is a true and useful sentence, and the remedy it offers (re-sync to
  // re-derive) is the right one. The defect is refusing on a series that is
  // MID-RE-DERIVE, not refusing on an unstamped one. A fix that made this case
  // go green would be over-reach and this test would redden.
  // ═════════════════════════════════════════════════════════════════════════
  it("REFUSAL-CTRL: an unstamped series that genuinely EXISTS still earns its refusal (positive counterpart)", async () => {
    const { text } = await renderAndSettle(STAMPED_ROWS, false);

    expect(
      text,
      `A strategy with ${STAMPED_ROWS} days of daily returns and no completeness ` +
        `verdict no longer reaches a gate verdict at all. Either the harness ` +
        `never drove the single-key heavy arm — in which case every absence ` +
        `assertion in this file is vacuous — or a fix over-reached and the wizard ` +
        `now admits series whose provenance was never established, on a product ` +
        `whose entire value is a verified track record.`,
    ).toContain(RENDERED_CODE(CODE_SERIES_PROVENANCE_UNVERIFIED));

    expect(wizardErrorEvents().length).toBeGreaterThan(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // T3 — THE FINDING. EXPECTED RED AT HEAD.
  //
  // Zero series rows is the heal-delete window: the worker has deleted and not
  // yet re-upserted. The rows are coming back in milliseconds. The wizard reads
  // that hole and tells the user, terminally, that their strategy does not
  // qualify — then STOPS POLLING, so it never sees the rows land.
  // ═════════════════════════════════════════════════════════════════════════
  it("T3: the single-key arm does NOT render a terminal refusal from a mid-re-derive empty series", async () => {
    const { text, container } = await renderAndSettle(HEAL_DELETE_ROWS, false);

    // STRUCTURAL — catches ANY refusal code, not only the two named below. At
    // HEAD the code is GATE_INSUFFICIENT_TRADES (the gate never reaches the
    // provenance arm with a zero row count), so a name-only needle would have
    // reported this GREEN against the exact tree it exists to indict.
    expect(
      container.querySelector("[data-error-code]"),
      `The wizard rendered a TERMINAL red envelope during the series heal-delete ` +
        `window. run_derive_broker_dailies_job deletes and re-upserts ` +
        `csv_daily_returns wholesale (job_worker.py:2539-2560); a poll landing ` +
        `inside that window reads a 'complete' status with zero rows. We did not ` +
        `find a strategy without a track record — we looked while the table was ` +
        `empty. The composite arm 300 lines up already treats this as ` +
        `NOT-yet-terminal and repolls (:1092-1103); this arm answers, stops the ` +
        `loop, and never sees the rows land.`,
    ).toBeNull();

    // The two named codes, hand-typed. Both are asserted because which one
    // fires is a function of the row count, and a future gate reordering must
    // not be able to slip a refusal past this case.
    expect(text).not.toContain(RENDERED_CODE(CODE_INSUFFICIENT_TRADES));
    expect(text).not.toContain(
      RENDERED_CODE(CODE_SERIES_PROVENANCE_UNVERIFIED),
    );

    // No terminal funnel event: the render and the analytics event are two
    // separate claims, and a fix that suppressed the envelope while still
    // reporting the failure would leave the funnel lying.
    expect(
      wizardErrorEvents(),
      `A wizard_error event was reported for a strategy whose series was ` +
        `mid-re-derive. The funnel now carries a failure that never happened.`,
    ).toEqual([]);

    // Vacuity fence.
    expect(text.length).toBeGreaterThan(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // T3b — THE SYMMETRY. PASSES AT HEAD, AND THAT IS THE POINT.
  //
  // Its own `it()`, never a loop over the two arms (154-PATTERNS.md §11.3).
  // Driven through the IDENTICAL empty-series state as T3. The composite arm
  // repolls; the single-key arm refuses. One class, one arm — and the pair,
  // not either case alone, is what makes the divergence the subject and what
  // stops a later instance-fix from wearing a class-fix's clothes.
  //
  // If this case ever reddens, the composite arm's R2-5 guard has been removed
  // and the class has been closed in the wrong direction.
  // ═════════════════════════════════════════════════════════════════════════
  it("T3b: the composite arm in the IDENTICAL empty-series state repolls instead of refusing (passes today)", async () => {
    const { text, container } = await renderAndSettle(HEAL_DELETE_ROWS, true);

    expect(
      container.querySelector("[data-error-code]"),
      `The composite arm's R2-5 guard (SyncPreviewStep.tsx:1092-1103) is gone. ` +
        `It is the ONLY in-repo precedent for "an empty series is a moment, not ` +
        `a verdict", and T3 measures the single-key arm against it. Losing it ` +
        `closes TWIN-1 in the wrong direction: two arms agreeing on the WRONG ` +
        `answer is not symmetry.`,
    ).toBeNull();

    expect(wizardErrorEvents()).toEqual([]);

    // POSITIVE half — it did not merely avoid the envelope, it stayed in the
    // waiting state and kept polling. Without this, an arm that crashed on
    // mount would satisfy the assertions above.
    expect(
      text,
      `The composite arm avoided the refusal but is not in the waiting state ` +
        `either. "No red envelope" is satisfied by a component that rendered ` +
        `nothing at all; the property is that it REPOLLS.`,
    ).toContain(COMPOSITE_WAITING_HEADING);

    expect(text.length).toBeGreaterThan(0);
  });
});
