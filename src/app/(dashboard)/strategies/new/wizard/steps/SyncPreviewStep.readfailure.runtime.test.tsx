/** @vitest-environment jsdom */
/**
 * Phase 140.4 / plan 02 (SEAMRIM-02) — RUNTIME RECEIPT: a FAILED READ and a
 * GENUINELY EMPTY ACCOUNT must not render the same DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FINDING THIS FILE NAMES — read it before "simplifying" the file
 * ═══════════════════════════════════════════════════════════════════════════
 * C-3, graded CRITICAL+ at the 140 end-of-milestone review and confirmed *by
 * rendering*: the single-key terminal arm of `SyncPreviewStep` array-destructured
 * SEVEN `Promise.all` members and read `.error` on ZERO of them. supabase-js
 * (2.110.1) resolves a PostgREST failure **as a value**, not as a rejection, so
 * an RLS denial or a statement timeout on `trades` arrived as
 * `{ data: null, count: null, error: {...} }`, the `?? 0` coercion turned it into
 * `tradeCount = 0`, and the gate answered `INSUFFICIENT_TRADES`. The user was
 * then told, in a sentence about their own money data:
 *
 *     "We found only 0 filled trade(s) on this key."
 *
 * We had not found zero. We had not found anything. **The two states produced
 * byte-identical DOM**, and `onTerminal` returned `"done"`, so the poll stopped
 * and there was no self-recovery.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A RUNTIME RECEIPT AND NOT A GREP (140.4-CONTEXT §3, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 * A grep proves a state; only a guard proves the state is HELD. In mutation run
 * 1 of this programme the single GREEN — the only mutation no suite caught —
 * landed on a finding whose receipt was a one-time `grep … → empty`. Every
 * finding whose receipt was a named test reddened. So the receipt for "the seven
 * reads now bind `error`" is not a count of `.error` occurrences; it is this
 * file, which drives the real component and reads the real DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A LOCAL HARNESS RATHER THAN EXTENDING `installSupabaseMock`
 * ═══════════════════════════════════════════════════════════════════════════
 * `SyncPreviewStep.render.test.tsx` owns a `installSupabaseMock` whose heavy
 * fan-out resolves one uniform outcome for every member. This file needs the
 * opposite: SIX healthy members and exactly ONE failing one, selected per case,
 * because a harness that fails all seven cannot tell a class-fix from an
 * instance-fix. Extending the shared mock would also have made two tiers share a
 * single point of failure — `seam-poll-disjointness.pin.test.ts:196-200` states
 * the house rule verbatim: *"a test file must not import another test file, and
 * two independent scanners that agree are worth more than one shared helper
 * whose single bug blinds both tiers."* The shared mock is therefore UNTOUCHED
 * by this plan.
 *
 * ⚠️ `vi.spyOn` + `vi.restoreAllMocks()`, NEVER `vi.stubGlobal` (DEF-16-1 — this
 * repo's known CI-only failure class, CI Node 22 vs local Node 25).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS RECEIPT DOES **NOT** PROVE — read this before trusting it
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. **jsdom under fake timers, not a browser.** It proves the code as executed
 *     in THIS harness. Real tick scheduling, real PostgREST payloads and real
 *     React concurrency are outside it.
 *  2. **ONE component.** `useStrategySyncPoller` is exercised only incidentally;
 *     `strategyGate.ts`'s own refusal (`StrategyGateUnevaluableError`, landed by
 *     plan 140.4-01) has its own unit coverage and is not re-proved here.
 *  3. **The injected member is one at a time, and the enumerated set is the
 *     SEVEN members of ONE `Promise.all`.** It says nothing about the repo-wide
 *     unchecked-read backlog, which is a per-site class this plan does not close
 *     and does not claim to. Plan `140.4-14`'s edit-time ESLint ratchet is the
 *     only row-1 mechanism available for that, and it lands separately.
 *  4. **It does not prove the resulting copy is GOOD** — only that it is not the
 *     fabricated measurement. Sentence quality is founder-owed (§7.1).
 *  5. **The DOM-inequality assertion compares `textContent`.** Two states that
 *     differed only by an attribute (say, `aria-live`) would still compare equal
 *     here. It is the right assertion for THIS finding, whose subject is a
 *     rendered sentence, and it is not a general-purpose distinguishability
 *     proof.
 *
 * A receipt that overclaims is worse than none, because the next reader stops
 * checking.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";

// ---------------------------------------------------------------------------
// The sentence under test.
//
// ⚠️ HAND-TYPED, DELIBERATELY. Importing `WIZARD_ERROR_COPY` or calling
// `formatKeyError` on the expected side of an `expect` would compare the render
// to itself through a re-export — Oracle Independence hazard 6 in
// `140.4-VALIDATION.md`. The literal below is transcribed from
// `src/lib/wizardErrors.ts:1200`; if the copy is deliberately reworded, this
// constant must be edited by hand and the change is then visible in review,
// which is the entire point.
// ---------------------------------------------------------------------------
const FABRICATED_MEASUREMENT = "filled trade(s) on this key";

/**
 * The rendered diagnostics line, which is the ONLY code-specific needle on this
 * surface.
 *
 * ⚠️ MEASURED THE HARD WAY, AND THE NEAR-MISS IS THE LESSON. This file first
 * used the envelope TITLE — "We could not verify this strategy" — as the
 * escalation needle. Run against the UNFIXED tree it reported the escalation
 * case GREEN, because `ErrorEnvelope` renders that same title for `SYNC_FAILED`,
 * `GATE_INSUFFICIENT_TRADES` **and** `GATE_NO_DATA_SOURCE` alike. A needle that
 * matches three different states cannot testify about any one of them, and it
 * would have certified an escalation that was not happening. `ErrorEnvelope`'s
 * diagnostics block renders `code: <CODE>` verbatim, and that string is unique
 * per state. Hand-typed, never read off `WIZARD_ERROR_COPY`.
 */
const RENDERED_CODE = (code: string) => `code: ${code}`;

// ---------------------------------------------------------------------------
// Local Supabase harness — per-member outcome selection.
// ---------------------------------------------------------------------------

/** A PostgREST error-as-value, in the shape supabase-js actually resolves. */
interface ReadFailure {
  code: string;
  message: string;
}

/**
 * Which ONE of the seven single-key `Promise.all` members fails on this run.
 * `null` = every member healthy (the genuinely-empty-account baseline).
 *
 * The member names mirror the production destructure so a reader can map a case
 * to a line without guessing.
 */
type HeavyMember =
  | "analytics"
  | "tradeCount"
  | "earliest"
  | "latest"
  | "sample"
  | "csvRowCount"
  | "keyRow";

/**
 * A statement timeout is used as the injected failure rather than an RLS denial
 * because it is the case nobody argues about: it is transient, it is nobody's
 * fault, it says nothing whatsoever about how many trades exist, and it is the
 * exact class the `?? 0` coercion converted into a measurement.
 */
const STATEMENT_TIMEOUT: ReadFailure = {
  code: "57014",
  message: "canceling statement due to statement timeout",
};

interface ChainState {
  /** Set by `.order(col, { ascending })` — the ONLY thing separating members 3 and 4. */
  ascending: boolean | null;
}

/**
 * A chainable postgrest-builder double.
 *
 * The resolver is invoked LAZILY, at await time, so `.order()` has already
 * recorded its direction by the time the earliest/latest split is decided. Both
 * await forms the production code uses are supported: `.maybeSingle()` (members
 * 1 and 7) and awaiting the builder directly (members 2-6), which works because
 * the object is a thenable — the same idiom the sibling render suite uses.
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

/** A healthy `.maybeSingle()`-shaped result. */
const okRow = (data: unknown) => ({ data, error: null });
/** A healthy list-shaped result (members 3-5). */
const okList = (data: unknown[]) => ({ data, count: null, error: null });
/** A healthy `head: true` exact-count result (members 2 and 6). */
const okCount = (count: number) => ({ data: null, count, error: null });
/**
 * The failure shape supabase-js RESOLVES (never rejects) on a PostgREST error.
 * `count` and `data` are both null — which is precisely why an unchecked
 * `count ?? 0` fabricated a zero.
 */
const failed = (error: ReadFailure) => ({ data: null, count: null, error });

let currentClientFactory: () => unknown = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve(okRow(null)) }),
    }),
  }),
});

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
 * Install the client for a run.
 *
 * The mount effect's freshness probe reports NO row, so the component takes the
 * kickoff-POST path and lands in `waiting_for_complete`. The status poll then
 * reports `complete`, which is terminal, which is what drives the single-key
 * heavy fan-out this file exists to observe.
 *
 * Every heavy member resolves HEALTHY (and, for the counts, a genuine ZERO)
 * unless it is the one named by `failing`. Six-healthy-one-failing is the whole
 * design: a harness that failed all seven could not distinguish a class-fix from
 * an instance-fix, which is the confusion this programme keeps rediscovering.
 */
function installClient(failing: HeavyMember | null) {
  const pick = (member: HeavyMember, healthy: unknown) =>
    failing === member ? failed(STATEMENT_TIMEOUT) : healthy;

  currentClientFactory = () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === "strategy_analytics") {
          // Mount-effect freshness probe → no row → kickoff POST fires.
          if (cols === "computation_status, computed_at") {
            return chain(() => okRow(null));
          }
          // Status poll → terminal success, every tick.
          if (cols === "computation_status, computation_error") {
            return chain(() =>
              okRow({
                computation_status: "complete",
                computation_error: null,
              }),
            );
          }
          if (cols === "data_quality_flags") {
            return chain(() => okRow({ data_quality_flags: null }));
          }
          // MEMBER 1 — the heavy analytics row.
          return chain(() => pick("analytics", okRow(null)));
        }

        if (table === "trades") {
          // MEMBER 2 — the exact head-count.
          if (cols === "id") return chain(() => pick("tradeCount", okCount(0)));
          // MEMBERS 3 and 4 — earliest vs latest, told apart ONLY by the
          // `ascending` flag `.order()` recorded. Getting this wrong would make
          // the M92 mutation target the wrong member.
          if (cols === "timestamp") {
            return chain((state) =>
              pick(state.ascending === false ? "latest" : "earliest", okList([])),
            );
          }
          // MEMBER 5 — the symbol sample for market detection.
          if (cols === "symbol") return chain(() => pick("sample", okList([])));
        }

        // MEMBER 6 — the daily-return row count (the Deribit/ledger branch).
        if (table === "csv_daily_returns") {
          return chain(() => pick("csvRowCount", okCount(0)));
        }

        // MEMBER 7 — the key's exchange. A non-ledger venue so the gate stays on
        // the trade branch and the genuinely-empty run reaches INSUFFICIENT_TRADES.
        if (table === "api_keys") {
          return chain(() => pick("keyRow", okRow({ exchange: "bybit" })));
        }

        return chain(() => okRow(null));
      },
    }),
  });
}

/** The kickoff POST succeeds and reports a single-key (non-composite) run. */
function installFetchMock() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, composite: false }), {
        status: 200,
      }),
    );
}

const baseProps = {
  strategyId: "strat-readfailure-1",
  apiKeyId: "key-readfailure-1",
  wizardSessionId: "session-readfailure-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

/**
 * Render, settle the mount + kickoff, then walk the poll ladder far enough for
 * THREE terminal ticks (`POLL_BACKOFF_MS` = 3000, 3000, 5000, … and
 * `MAX_CONSECUTIVE_POLL_ERRORS` = 3), so a run that escalates has room to.
 *
 * Returns the rendered text and an `unmount`, because the distinguishability
 * case renders two runs inside a single test and must tear the first one down
 * before the second mounts.
 */
async function renderAndSettle(failing: HeavyMember | null, apiKeyId?: string | null) {
  installClient(failing);
  const view = render(
    <SyncPreviewStep
      {...baseProps}
      apiKeyId={apiKeyId === undefined ? baseProps.apiKeyId : apiKeyId}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0); // mount effect + kickoff POST
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0); // kickoff body parse
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000); // ≥ 3 terminal ticks
  });
  return { text: view.container.textContent ?? "", unmount: view.unmount };
}

describe("[140.4-02 / SEAMRIM-02] a read failure is never rendered as a measurement", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    // The terminal arm logs the thrown read; silence it without losing the spy.
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetchMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(okRow(null)) }),
        }),
      }),
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // POSITIVE COUNTERPART — FIRST, deliberately.
  //
  // `critical-regressions.test.ts:131-144` is the template and its reasoning is
  // the reason this case leads: a negative-only oracle is satisfied by a
  // component that renders NOTHING AT ALL, which is exactly how mutation M-9
  // measured a guard going vacuous. Everything below asserts an ABSENCE; this
  // case is what makes those absences mean something.
  // ═════════════════════════════════════════════════════════════════════════
  it("a GENUINELY EMPTY account still renders the measured-zero sentence (positive counterpart)", async () => {
    const { text } = await renderAndSettle(null);

    expect(
      text,
      `A genuinely empty account no longer renders the measured-zero sentence. ` +
        `Every absence assertion in this file is now satisfiable by a component ` +
        `that renders nothing, so they prove nothing. Either the copy changed ` +
        `deliberately (edit FABRICATED_MEASUREMENT by hand and say why) or the ` +
        `fix over-reached and is now refusing to answer for accounts it CAN measure.`,
    ).toContain(FABRICATED_MEASUREMENT);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE FINDING ITSELF — the fabricated measurement must be gone.
  // ═════════════════════════════════════════════════════════════════════════
  it("a FAILED trades-count read does NOT render the measured-zero sentence", async () => {
    const { text } = await renderAndSettle("tradeCount");

    expect(
      text,
      `The trades COUNT read failed (57014, statement timeout) and the wizard ` +
        `told the user a number about their account anyway. We did not find ` +
        `zero trades — we found nothing, because the read never returned. ` +
        `An unchecked "count ?? 0" is how a failure becomes a measurement.`,
    ).not.toContain(FABRICATED_MEASUREMENT);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE SECOND MEMBER OF THE CLASS — the case ledger row M92 mutates against.
  //
  // Without this case a fix applied to the `trades` count alone would look
  // complete: the case above would be green and the class would still be open
  // at six members. That shape — an instance-fix wearing a class-fix's clothes
  // — is what this programme keeps rediscovering, so it gets its own case
  // rather than a loop over the seven.
  // ═════════════════════════════════════════════════════════════════════════
  it("a FAILED earliest-trade read does NOT render the measured-zero sentence (SECOND member)", async () => {
    const { text } = await renderAndSettle("earliest");

    expect(
      text,
      `The EARLIEST-trade read failed and the wizard rendered a verdict anyway. ` +
        `This is the second member of the class and it is the member ledger row ` +
        `M92 mutates: if this case is green while the trades-count case is green, ` +
        `the class is fixed; if only the count case is green, one instance is.`,
    ).not.toContain(FABRICATED_MEASUREMENT);
  });

  it("a FAILED latest-trade read does NOT render the measured-zero sentence", async () => {
    const { text } = await renderAndSettle("latest");
    expect(text).not.toContain(FABRICATED_MEASUREMENT);
  });

  it("a FAILED csv daily-returns count read does NOT render the measured-zero sentence", async () => {
    const { text } = await renderAndSettle("csvRowCount");
    expect(text).not.toContain(FABRICATED_MEASUREMENT);
  });

  it("a FAILED api_keys read does NOT render the measured-zero sentence", async () => {
    const { text } = await renderAndSettle("keyRow");
    expect(text).not.toContain(FABRICATED_MEASUREMENT);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE ESCALATION IS REACHED — not merely the absence of the sentence.
  //
  // "The bad sentence is gone" is satisfied by a wizard that spins forever.
  // The property worth having is that the failure routes into the escalation
  // the composite arm 200 lines above already uses: past
  // MAX_CONSECUTIVE_POLL_ERRORS the recoverable SYNC_FAILED envelope renders,
  // with an exit affordance.
  // ═════════════════════════════════════════════════════════════════════════
  it("three consecutive read failures escalate to the recoverable SYNC_FAILED surface", async () => {
    const { text } = await renderAndSettle("tradeCount");

    expect(
      text,
      `A persistently failing heavy read did not reach the recoverable ` +
        `SYNC_FAILED envelope. Removing the fabricated sentence is only half the ` +
        `fix — without the escalation the user gets a spinner with no exit, ` +
        `which is the H-0197 hang this component already has a sink for. ` +
        `NOTE the needle is the diagnostics CODE, not the title: the title is ` +
        `shared with GATE_INSUFFICIENT_TRADES and would report this green on a ` +
        `tree where no escalation happens at all.`,
    ).toContain(RENDERED_CODE("SYNC_FAILED"));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE ANTI-REGRESSION — a keyless draft must NOT throw.
  //
  // Member 7 is a ternary: when `apiKeyId` is falsy the else-branch resolves a
  // SYNTHETIC `{ data: null }` with NO `error` property at all. That is not a
  // read failure. A naive `if (keyRowResult.error) throw` reads `undefined`
  // (harmless) but a naive reshaping of the ternary would throw on EVERY
  // keyless draft — turning the fix into an outage for a whole class of users.
  // This case also proves the implementation is not simply throwing on every
  // tick, which would satisfy every absence assertion above.
  // ═════════════════════════════════════════════════════════════════════════
  it("a KEYLESS draft still reaches a gate verdict — the ternary member must not throw", async () => {
    const { text } = await renderAndSettle(null, null);

    // POSITIVE half — the flow ran all the way to `checkStrategyGate` and got a
    // real verdict. A keyless draft has no trade source, so GATE_NO_DATA_SOURCE
    // is the CORRECT answer and its presence proves the arm completed.
    expect(
      text,
      `A keyless draft (apiKeyId === null) no longer reaches a gate verdict at ` +
        `all. Member 7's synthetic { data: null } carries no 'error' property ` +
        `and is NOT a read failure; treating it as one turns the C-3 fix into an ` +
        `outage for every keyless draft.`,
    ).toContain(RENDERED_CODE("GATE_NO_DATA_SOURCE"));

    // NEGATIVE half — and it did NOT escalate. This is what stops every absence
    // assertion above from being satisfied by an implementation that simply
    // throws on every tick.
    expect(
      text,
      `A keyless draft escalated to SYNC_FAILED. The ternary member's synthetic ` +
        `result is being treated as a read failure.`,
    ).not.toContain(RENDERED_CODE("SYNC_FAILED"));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE PROPERTY, STATED AS THE FINDING STATED IT: *byte-identical DOM*.
  //
  // Each case above pins one instance. This one pins the property those
  // instances are instances OF, so a future change that reintroduced the
  // conflation by some other route still reddens.
  // ═════════════════════════════════════════════════════════════════════════
  it("read-failed and genuinely-empty render DIFFERENT DOM (the property, not an instance)", async () => {
    const failedRun = await renderAndSettle("tradeCount");
    failedRun.unmount();

    const emptyRun = await renderAndSettle(null);

    expect(
      failedRun.text,
      `A failed read and a genuinely empty account render byte-identical DOM. ` +
        `That is C-3 verbatim: the wizard is answering a question it never ` +
        `measured, on a product whose entire value is a trustworthy verified ` +
        `track record. The two states must be distinguishable to the user, not ` +
        `merely distinguishable in a log.`,
    ).not.toEqual(emptyRun.text);

    // Vacuity fence. Two EMPTY strings are also "different DOM" only in the
    // sense that they are not — and two renders that both produced nothing
    // would satisfy a naive inequality if either had crashed. Pin that both
    // runs actually rendered something.
    expect(failedRun.text.length).toBeGreaterThan(0);
    expect(emptyRun.text.length).toBeGreaterThan(0);
  });

  // The terminal arm is required to LOG the failure it swallowed into the
  // escalation counter. A fix that threw but logged nothing would leave a
  // production read failure with no diagnostic trail at all.
  it("the failed read is logged, so the escalation is diagnosable", async () => {
    await renderAndSettle("tradeCount");

    expect(
      (errSpy.mock.calls as unknown[][]).some((call) =>
        String(call[0]).includes("[wizard:SyncPreviewStep] terminal fetch error:"),
      ),
      `The heavy terminal arm escalated without logging. The user-facing ` +
        `envelope deliberately carries no PostgREST text, so the console is the ` +
        `only place the 57014 exists — losing it makes the failure unattributable.`,
    ).toBe(true);
  });
});
