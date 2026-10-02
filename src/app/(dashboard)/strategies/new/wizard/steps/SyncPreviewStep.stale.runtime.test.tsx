/** @vitest-environment jsdom */
/**
 * Phase 154 / plan 01 (STALE-01a) — RED PIN: the wizard must not claim work is
 * in flight after the work has finished, and must not sit in that claim forever.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FINDING THIS FILE NAMES — read it before "simplifying" the file
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-08-04, the founder's MT5 onboarding. The wizard rendered
 *
 *     "Fetching trades…"
 *
 * indefinitely. `154-INVESTIGATION.md` settles the supplier against PROD:
 * mechanism **M2(ii)**. `compute_jobs` shows Alpha Centauri's whole chain
 * terminal — `process_key_long` done 11:38:05, `derive_broker_dailies` done
 * 11:39:03, `compute_analytics_from_csv` done at **11:39:35.342759** (the exact
 * timestamp in the requirement), all 22 rows `status='done'`, `last_error` null
 * throughout. THE BACKEND HAD FINISHED. The founder then re-ran the chain three
 * more times (11:52, 12:24, 14:17) — the behavioural signature of a user
 * staring at a screen that never moved.
 *
 * Two distinct defects produced that, and both live in this component's
 * neighbourhood:
 *
 *  · **M2(ii) — the supplier.** `useStrategySyncPoller.ts:228-229` coerces a
 *    zero-rows read to the domain value `"pending"`. Pinned at the seam by
 *    `src/hooks/useStrategySyncPoller.test.ts` (T2); pinned here at the SURFACE
 *    by T1, because the seam fix and the render are separately falsifiable.
 *  · **M1 — why it was UNBOUNDED.** Every exit from the waiting state is gated
 *    behind `isComposite`. A single-key user has NONE. T1b pins that gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE NEEDLE IS "Fetching trades..." AND NOTHING ELSE
 * ═══════════════════════════════════════════════════════════════════════════
 * `SyncPreviewStep.tsx:2313-2323` emits that exact string if and only if
 * `phase === "waiting_for_complete"` AND `isComposite === false` AND
 * `computationStatus ∈ {null, "pending"}`. Terminal statuses cannot produce it
 * (`failed` has its own line; `complete`/`complete_with_warnings` leave the
 * waiting render entirely), and `"computing"` produces different copy. So the
 * string is a precise witness for the state, which is why RESEARCH A3's STRICT
 * reading of the founder's quote is the one the investigation confirmed.
 *
 * ⚠️ HAND-TYPED, DELIBERATELY (154-PATTERNS.md §11.2). Importing the copy — or
 * reading it off the component — would compare the render to itself. If the
 * sentence is reworded on purpose, the constant below is edited BY HAND and the
 * change is visible in review, which is the entire point.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FILE CONTAINS NO FIX AND MUST FAIL AT HEAD
 * ═══════════════════════════════════════════════════════════════════════════
 * T1, T1b and T2b are EXPECTED RED at the commit that introduces them; plans
 * 154-04 and 154-08 green them. `WAITING-CTRL` is the positive counterpart and
 * passes at HEAD. Nothing is marked `.fails` or `.skip` — a skipped repro is
 * not a gate (CONTEXT.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ORACLE INDEPENDENCE (154-VALIDATION.md, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *  · ⛔ `RETRY_THRESHOLD_MS` / `WARN_THRESHOLD_MS` / `SLOW_HINT_MS` /
 *    `POLL_BACKOFF_MS` are NOT imported. Fake time is advanced by the HAND-TYPED
 *    literal `PATIENCE_OVERRUN_MS` below. A test that advanced by the imported
 *    constant would pass for any threshold — including a regression that moved
 *    it, which is precisely the class of change that must redden.
 *  · Every absence assertion has a positive counterpart plus the vacuity fence
 *    (`text.length > 0`), because a component that renders NOTHING satisfies a
 *    negative-only oracle — the shape that measured mutation M-9 going vacuous.
 *  · `vi.spyOn` + `vi.restoreAllMocks()`, NEVER the global-stub helper
 *    (DEF-16-1, this repo's known CI-only failure class: CI Node 22, local
 *    Node 25).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS RECEIPT DOES **NOT** PROVE
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. jsdom under fake timers, not a browser. Real tick scheduling, real
 *     PostgREST payloads and real React concurrency are outside it.
 *  2. It does not prove WHICH of M2(ii)'s two candidates (a PostgREST zero-rows
 *     answer under an RLS/session boundary vs a genuine absent-row race)
 *     produced the founder's empty read — that browser console no longer
 *     exists. Both are discharged at the same seam, and T1 pins the SURFACE
 *     consequence of either.
 *  3. It says nothing about instance (b), the stale REFUSAL. That is a distinct
 *     code site with its own file (`SyncPreviewStep.stale-refusal.runtime.test.tsx`).
 *     One root idea, two sites: a single-site fix discharges neither alone.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";

// ---------------------------------------------------------------------------
// The sentence under test. Transcribed by hand from
// `SyncPreviewStep.tsx:2323`. See the header block for why it is not imported.
// ---------------------------------------------------------------------------
const IN_FLIGHT_CLAIM = "Fetching trades...";

/**
 * How far fake time is advanced for the "unbounded" cases: a HAND-TYPED literal,
 * ≈16.7 minutes.
 *
 * ⛔ NOT `RETRY_THRESHOLD_MS + n`. The number is chosen to be comfortably past
 * the component's existing 900 s patience window WITHOUT naming it, so this test
 * cannot be satisfied by a change that merely moves the window. No new timeout
 * or threshold is proposed by this plan; the existing ladder is referenced,
 * never moved.
 */
const PATIENCE_OVERRUN_MS = 1_000_000;

/**
 * The ordinary settle window — long enough for the kickoff plus several poll
 * ticks, short enough to be WELL INSIDE the patience budget. `WAITING-CTRL`
 * uses it to prove the in-flight claim is legitimate here, which is what stops
 * T1 from being satisfiable by a fix that simply deletes the sentence.
 */
const SETTLE_MS = 30_000;

/** A healthy `.maybeSingle()`-shaped result. */
const okRow = (data: unknown) => ({ data, error: null });

/**
 * PostgREST's zero-rows answer for `.maybeSingle()`, verbatim — a SUCCESSFUL
 * read that found nothing. The exact shape is load-bearing: `error: null` is why
 * the poller's error arm does not fire, and `data: null` is why the `?? "pending"`
 * coercion is reached. A hand-invented `{ data: undefined }` would exercise a
 * different branch entirely.
 */
const ZERO_ROWS = { data: null, error: null } as const;

/** What the status poll answers on every tick. */
type StatusMode = "pending" | "zeroRows";

interface ChainState {
  ascending: boolean | null;
}

/**
 * A chainable postgrest-builder double (Donor B —
 * `SyncPreviewStep.readfailure.runtime.test.tsx:146-199`). The resolver runs
 * LAZILY, at await time. Supports both await forms the component uses:
 * `.maybeSingle()` and awaiting the builder directly (a thenable).
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
 * Install the client for a run.
 *
 * The mount freshness probe reports NO row, so the component takes the kickoff
 * path and lands in `waiting_for_complete` — the state the founder was stuck in.
 * The status poll then answers `mode` on every tick, forever. The heavy
 * `Promise.all` is never reached: no tick is ever terminal, which is the whole
 * point.
 */
function installClient(mode: StatusMode) {
  currentClientFactory = () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === "strategy_analytics") {
          // Mount freshness probe → no row → kickoff POST fires.
          if (cols === "computation_status, computed_at") {
            return chain(() => okRow(null));
          }
          // THE STATUS POLL — the read this file is about.
          if (cols === "computation_status, computation_error") {
            return chain(() =>
              mode === "zeroRows"
                ? ZERO_ROWS
                : okRow({
                    computation_status: "pending",
                    computation_error: null,
                  }),
            );
          }
          if (cols === "data_quality_flags") {
            return chain(() => okRow({ data_quality_flags: null }));
          }
        }
        return chain(() => okRow(null));
      },
    }),
  });
}

/**
 * The kickoff POST succeeds and reports a single-key (non-composite) run.
 *
 * `queued` is threaded so T2b can drive M4 — a 200 whose body says nothing was
 * actually enqueued. Omitting the field entirely (the default) is the shape
 * every other case uses, matching the route's ordinary body.
 */
function installFetchMock(body: Record<string, unknown>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    );
}

const baseProps = {
  strategyId: "strat-stale-1",
  apiKeyId: "key-stale-1",
  wizardSessionId: "session-stale-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

/**
 * Render, settle the mount + kickoff, then advance `holdMs`.
 *
 * THE THREE-STAGE ADVANCE IS LOAD-BEARING (Donor B `:310-328`):
 *   advance(0)      → mount effect + kickoff POST
 *   advance(0)      → kickoff body parse
 *   advance(holdMs) → poll ticks + the 1 s elapsed timer
 */
async function renderAndSettle(holdMs: number) {
  const view = render(<SyncPreviewStep {...baseProps} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(holdMs);
  });
  return {
    text: view.container.textContent ?? "",
    container: view.container,
    unmount: view.unmount,
  };
}

describe("[154-01 / STALE-01a] the wizard must not claim work is in flight forever", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
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
  // T1 and T2b both assert that a sentence is ABSENT. A negative-only oracle is
  // satisfied by a component that renders NOTHING AT ALL — a crashed mount, a
  // mistyped mock, a harness that never reached the waiting state. This case is
  // what makes those absences mean something, and it also states the property
  // the fix must NOT break: while the wait is still legitimate, saying so is
  // correct. Deleting the sentence is not the fix.
  // ═════════════════════════════════════════════════════════════════════════
  it("WAITING-CTRL: inside the patience window the in-flight claim IS rendered (positive counterpart)", async () => {
    installClient("pending");
    installFetchMock({ ok: true, composite: false });

    const { text } = await renderAndSettle(SETTLE_MS);

    expect(
      text,
      `The wizard no longer says anything about fetching trades even while the ` +
        `poll is legitimately reading "pending" well inside the patience window. ` +
        `Either the harness never reached waiting_for_complete — in which case ` +
        `every absence assertion in this file is vacuous — or a fix removed the ` +
        `sentence instead of bounding the state. The defect is the UNBOUNDED ` +
        `claim, not the claim.`,
    ).toContain(IN_FLIGHT_CLAIM);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // T1 — THE SYMPTOM THE FOUNDER SAW. EXPECTED RED AT HEAD.
  //
  // A status frozen at `pending` past the patience budget is the founder's
  // screen. On PROD the true status was terminal at 11:39:35 and the client was
  // reading nothing; here the read is explicit and permanent, which is the
  // strictly harder case for the component to be right about.
  // ═════════════════════════════════════════════════════════════════════════
  it("T1: a status frozen at pending past the patience window stops claiming trades are being fetched", async () => {
    installClient("pending");
    installFetchMock({ ok: true, composite: false });

    const { text } = await renderAndSettle(PATIENCE_OVERRUN_MS);

    expect(
      text,
      `After ~16.7 minutes of a status that never advanced, the wizard is still ` +
        `telling a single-key user "Fetching trades…". On 2026-08-04 that claim ` +
        `was FALSE at the moment it was rendered: compute_jobs shows ` +
        `compute_analytics_from_csv reached 'done' at 11:39:35.342759 with every ` +
        `job row terminal and last_error null. The user's only recourse was to ` +
        `re-run a chain that had already succeeded — three times. A screen that ` +
        `cannot be left is not a slow screen, it is a dead end.`,
    ).not.toContain(IN_FLIGHT_CLAIM);

    // Vacuity fence — a component that crashed and rendered nothing would
    // satisfy the assertion above without the defect being fixed.
    expect(text.length).toBeGreaterThan(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // T1b — THE MECHANISM, NOT THE SYMPTOM. EXPECTED RED AT HEAD.
  //
  // TWIN-2. The SF-1 stall backstop exists, fires on elapsed patience, and is
  // then thrown away for single-key strategies by ONE conjunct:
  //
  //     const showInterruptedBanner =
  //       isComposite && (syncProgress?.stalled === true || stallBackstop);
  //                                                        ^^^^^^^^^^^^^ computed, ignored
  //
  // T1 could in principle be satisfied by any number of edits; this case names
  // the specific line, so a fix that makes the symptom go away by some other
  // route still leaves the recorded mechanism observable.
  // ═════════════════════════════════════════════════════════════════════════
  it("T1b: a single-key strategy gets the interrupted-sync affordance the composite arm already gets", async () => {
    installClient("pending");
    installFetchMock({ ok: true, composite: false });

    const { text, container } = await renderAndSettle(PATIENCE_OVERRUN_MS);

    expect(
      container.querySelector('[data-testid="wizard-sync-interrupted"]'),
      `The SF-1 stall backstop fired — the status has not advanced for the whole ` +
        `patience budget — and the amber recoverable banner (with its Retry ` +
        `affordance) was suppressed because isComposite is false. The banner ` +
        `markup, the retry handler and the backstop clock ALL already exist; one ` +
        `conjunct at SyncPreviewStep.tsx:2290-2291 withholds them from exactly ` +
        `the users who have no other exit. This is M1: the reason the 2026-08-04 ` +
        `stall was unbounded rather than merely wrong.`,
    ).not.toBeNull();

    expect(text.length).toBeGreaterThan(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // T2b — M4: A 200 THAT ENQUEUED NOTHING. EXPECTED RED AT HEAD.
  //
  // The kickoff arm (`:777-783`) parses the body for exactly one field —
  // `composite` — and then enters `waiting_for_complete` unconditionally. A 200
  // whose body says `queued: false` is read as "work is under way". Nothing is
  // coming, no analytics row is ever written, and the poll then meets the SAME
  // zero-rows read T2 pins at the seam.
  //
  // ⚠️ Scope, stated honestly: M4 is RULED OUT as the 2026-08-04 supplier —
  // `compute_jobs` shows the work WAS queued and DID complete. This case is
  // therefore not a replay of the incident; it pins the second way the same
  // surface can end up making the same false claim, because the honest-kickoff
  // property is worth having independently of which supplier fired once.
  // ═════════════════════════════════════════════════════════════════════════
  it("T2b: a kickoff 200 whose body says queued:false does not put the wizard in the in-flight claim", async () => {
    installClient("zeroRows");
    installFetchMock({ ok: true, composite: false, queued: false });

    const { text } = await renderAndSettle(SETTLE_MS);

    expect(
      text,
      `The kickoff answered 200 with "queued: false" — the route telling us ` +
        `plainly that nothing was enqueued — and the wizard entered the waiting ` +
        `state anyway and began telling the user their trades were being ` +
        `fetched. No job exists, so no analytics row will ever appear, so the ` +
        `poll reads { data: null, error: null } forever. The claim is not ` +
        `merely premature; it can never become true.`,
    ).not.toContain(IN_FLIGHT_CLAIM);

    expect(text.length).toBeGreaterThan(0);
  });
});
