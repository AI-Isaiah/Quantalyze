import { describe, it, expect } from "vitest";
import {
  SEAM_BUDGETS,
  BREAKER_KEY,
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_WINDOW,
  BREAKER_COOLDOWN_S,
  DEFAULT_RETRY_AFTER_S,
  SEAM_RETRIES,
  SEAM_RETRY_BACKOFF_MS,
  SEAM_RETRY_JITTER_MAX_MS,
  BREAKER_STORE_TIMEOUT_MS,
  BREAKER_STORE_RETRIES,
  BREAKER_STORE_BACKOFF_MS,
  BREAKER_LOCK_TOMBSTONE_S,
  breakerKeyFor,
  encodeBreakerLock,
  decodeBreakerLock,
} from "./resilient-fetch";
import { seamBreakerVerdict } from "./seam-discriminator";
import {
  RETRY_SAFE_ANALYTICS,
  RETRY_SAFE_FLOW_TYPES,
  RETRY_AUDIT_NO_ANALYTICS,
  RETRY_AUDIT_NO_FLOW_TYPES,
} from "./seam-retry-registry";
import {
  FAKE_BREAKER_KEY,
  FAKE_THRESHOLD,
  FAKE_WINDOW_MS,
  FAKE_LOCK_TOMBSTONE_MS,
  encodeFakeBreakerLock,
} from "@/test/helpers/upstash-breaker";

/**
 * SC3 / SEAMCORE-07 — the literal-pinned oracle for the seam core's tuning values.
 *
 * ⚠️ THE ONE RULE THAT MAKES THIS FILE WORK
 * -----------------------------------------
 * **No expectation in this file may be read out of the module under test.**
 * Every `expect(...)` argument on the EXPECTED side is a literal typed HERE, by
 * hand. A subscript lookup into the budget table, a module-namespace member
 * reference, or an `Object.keys(<module export>)` on the expected side is the
 * exact defect this file exists to invert.
 *
 * Those three shapes are grep-asserted absent by the plan's acceptance
 * criteria, so their literal text is deliberately not written anywhere in this
 * file, comments included — a guard whose own explanatory prose satisfies the
 * grep that guards it is self-invalidating, and this phase hit that trap twice.
 *
 * WHY IT EXISTS
 * -------------
 * Phase 140 certified "5/5 success criteria mutation-tested". Ten simultaneous
 * SEMANTIC mutations to this core — threshold 5→30, cooldown 30→5, window
 * 30 s→3600 s, the public teaser's budget 60 s→5 s, and six more — then produced
 * `8859 passed | 287 skipped`, byte-identical to that certified run. The cause
 * was a two-layer self-referential oracle:
 *
 *   Layer 1 — the test DOUBLE harvested its threshold from production's own
 *   `Ratelimit.slidingWindow(BREAKER_FAILURE_THRESHOLD, …)` constructor
 *   argument, so it could not disagree with production, ever, by construction.
 *   (Cut in the same plan as this file: `src/test/helpers/upstash-breaker.ts`
 *   now hand-types `FAKE_THRESHOLD` / `FAKE_WINDOW_MS` and this file pins them
 *   literal-against-literal, below.)
 *
 *   Layer 2 — every assertion read its expected value out of the table under
 *   test: the budget row's own `timeoutMs`, the module's own threshold export.
 *   0 of 13 budgets and 5 of 6 breaker constants were pinned to anything.
 *   THIS FILE is that half of the fix.
 *
 * The hand-typed-roster convention is
 * `tests/lib/process-key-onboard-contract-parity.test.ts`'s `EXPECTED_VERDICTS`:
 * "typed HERE as a literal — never derived from the fixture it guards, and never
 * derived from the module under test."
 *
 * ZERO module mocking in this file, by rule — no hoisted factory, no double of
 * any kind. A pin file that mocks its own subject asserts that a second pair of
 * doubles agrees with itself, which is the defect recreated rather than closed.
 * That absence is grep-asserted too, hence the same no-literal-text discipline.
 *
 * WHAT THIS FILE DOES **NOT** DO. It pins VALUES. It does not prove any value
 * reaches a primitive — `resilient-fetch.test.ts` asserts the budget table's
 * entry reaches `AbortSignal.timeout`, and that is a correct PLUMBING test,
 * deliberately kept. The two are different tests and neither replaces the
 * other; relaxing the plumbing one because a value pin now exists would delete
 * coverage. Row CONTENTS of `SEAM_ROUTE_BUDGETS` are pinned next door in
 * `seam-budgets.invariant.test.ts`.
 */

/**
 * The 14 budgets, typed HERE as literals and never derived from `SEAM_BUDGETS`.
 *
 * `it.each` below iterates THIS map, not the table's own keys: a table row that
 * is DELETED then produces a failing lookup, whereas iterating the table would
 * silently produce a shorter — and still green — case list.
 *
 * ⚠️ `validate-key-serialized` at 120 000 ms is the FOURTH magnitude, added by
 * Phase 153.4 / D-26. It is the LONGEST row in the table, which makes it the
 * row the A-25 breaker coupling is sized against — see the DERIVED A-25
 * assertion far below. Retuning it is therefore never a one-line change: it
 * moves `BREAKER_LOCK_TOMBSTONE_S` with it. The number itself is PROVISIONAL
 * (D-27) — the founder's stated staleness tolerance, not a measurement — and
 * Phase 155 (MT5-VERIFY) owns tightening it from real instrumentation.
 */
const EXPECTED_TIMEOUT_MS: Record<string, number> = {
  "validate-key": 30_000,
  "validate-key-serialized": 120_000,
  "encrypt-key": 30_000,
  bridge: 15_000,
  simulator: 15_000,
  "portfolio-optimizer": 15_000,
  "optimize-weights": 30_000,
  "match-eval": 30_000,
  "match-recompute": 30_000,
  "portfolio-analytics": 30_000,
  "process-key-enqueue": 15_000,
  "process-key-sync": 60_000,
  "keys-permissions": 15_000,
  "process-key-unified-dormant": 60_000,
};

/**
 * The `SeamBudgetKey` SET, typed here as literals.
 *
 * Asserted as a sorted-array EQUALITY, never as a length. A `.length === 14`
 * check passes a RENAME (`bridge` → `bridg`) and passes a swap (one key removed,
 * another added) — both of which silently detach a call site from its budget.
 *
 * ⚠️ `validate-key` and `validate-key-serialized` are TWO keys for ONE endpoint,
 * chosen per venue by `budgetKeyFor(exchange)`. The set equality is what stops a
 * future edit from "simplifying" them back into one row and silently handing
 * every ccxt venue a 120 s ceiling — or every serialized venue a 30 s one.
 */
const EXPECTED_BUDGET_KEYS: string[] = [
  "validate-key",
  "validate-key-serialized",
  "encrypt-key",
  "bridge",
  "simulator",
  "portfolio-optimizer",
  "optimize-weights",
  "match-eval",
  "match-recompute",
  "portfolio-analytics",
  "process-key-enqueue",
  "process-key-sync",
  "keys-permissions",
  "process-key-unified-dormant",
];

/**
 * The per-row DEPENDENCY DECLARATIONS, typed HERE as literals (plan 140.2-06).
 *
 * This map is the only thing that makes a wrong or stale declaration
 * FALSIFIABLE. Option A — each row declaring the dependencies it can be blocked
 * by, and the open-check reading exactly those keys plus the global one — was
 * chosen over checking all four service keys always (which re-creates a partial
 * A-01: an `egress-proxy` trip would block `/api/simulator`, which cannot reach
 * it) and over a global check with per-dependency counters (option C, which
 * fails OB-8 outright). Its stated risk is that a wrong declaration silently
 * UNDER-protects, and silence is exactly what this literal map removes.
 *
 * The values are EVIDENCE. Only a `503` counts, so only a `503` can open a
 * per-dependency key, and at HEAD the whole reachable set is:
 * `exchange.py:314,324` (mt5-gateway, reached by POST /api/validate-key),
 * `portfolio.py:684` and `match.py:1657,1691` (supabase). `breaker:kek` and
 * `breaker:egress-proxy` cannot be opened by ANY site — every `kek` and
 * `egress-proxy` arm is a `500`, which never counts — so declaring them anywhere
 * would declare a key that can never be set. Ledger row M39 mutates one of these
 * rows; this map is its falsifier.
 *
 * ⚠️ `validate-key-serialized` declares the SAME single dependency as
 * `validate-key` and for the same reason — both are POST /api/validate-key, and
 * `_validate_mt5_key`'s MT5_GATEWAY_UNREACHABLE 503 is the only counting arm of
 * that endpoint. A longer budget earns no wider dependency set; over-declaring
 * here would be the A-01 direction.
 */
const EXPECTED_DEPENDENCIES: Record<string, string[]> = {
  "validate-key": ["mt5-gateway"],
  "validate-key-serialized": ["mt5-gateway"],
  "encrypt-key": [],
  bridge: [],
  simulator: [],
  "portfolio-optimizer": [],
  "optimize-weights": [],
  "match-eval": [],
  "match-recompute": ["supabase"],
  "portfolio-analytics": ["supabase"],
  "process-key-enqueue": [],
  "process-key-sync": [],
  "keys-permissions": [],
  "process-key-unified-dormant": [],
};

/**
 * Phase 141 / SEAM-05+06 — the per-row retry oracle, HAND-TYPED literals (never
 * read out of the module under test). Five rows carry `1` after the SEAM-05
 * idempotency audit allowlisted them; every other row stays `0`.
 *
 * The five 1s are the same set the retry-safety registry lists as YES: bridge,
 * simulator, portfolio-optimizer, optimize-weights (the four compute analytics
 * wrappers) plus process-key-enqueue (the onboard+resync budget). The registry↔
 * rows consistency pin below re-checks that these two hand-typed statements — the
 * registry's and this row table's — cannot drift apart. Raising any 0 here is out
 * of fence unless its audit verdict and its row flip land together.
 *
 * ⚠️ `validate-key-serialized`'s 0 IS A VERDICT, NOT AN OVERSIGHT, and it is
 * written down here so a future reader does not read the gap as one. Two
 * independent reasons, either sufficient: (a) it is the same live-credential
 * exchange probe as `validate-key`, non-idempotent by construction — a retry
 * re-probes the venue; (b) in the breaker's OPEN state `CircuitOpenError` is
 * thrown BEFORE any fetch, so a retry only re-runs `isBreakerOpen`, charges a
 * second store round and throws again — structurally wasteful, and a retried
 * 120 000 ms leg would double the wall-clock SC-4b charges against this route's
 * Vercel ceiling (RESEARCH Pitfall 5; D-07 is the standing prohibition).
 */
const EXPECTED_RETRIES: Record<string, number> = {
  "validate-key": 0,
  "validate-key-serialized": 0,
  "encrypt-key": 0,
  bridge: 1,
  simulator: 1,
  "portfolio-optimizer": 1,
  "optimize-weights": 1,
  "match-eval": 0,
  "match-recompute": 0,
  "portfolio-analytics": 0,
  "process-key-enqueue": 1,
  "process-key-sync": 0,
  "keys-permissions": 0,
  "process-key-unified-dormant": 0,
};

/**
 * The closed SERVICE-dependency vocabulary, typed HERE as literals
 * (`STATUS_CONTRACT.md` §4). The only values that may become a breaker key.
 *
 * A `424`'s `dependency` is the caller's VENUE and is deliberately absent.
 */
const EXPECTED_SERVICE_DEPENDENCIES: string[] = [
  "mt5-gateway",
  "kek",
  "supabase",
  "egress-proxy",
];

/** The four per-dependency breaker keys, spelled out rather than derived. */
const EXPECTED_BREAKER_KEYS: Record<string, string> = {
  "mt5-gateway": "breaker:mt5-gateway",
  kek: "breaker:kek",
  supabase: "breaker:supabase",
  "egress-proxy": "breaker:egress-proxy",
};

/**
 * Widened view of the table so the per-row lookup below can be driven by a
 * hand-typed string key. Declared once, so the string `SEAM_BUDGETS` followed by
 * a subscript never appears in this file — the acceptance grep for the
 * self-referential shape must stay clean, comments included.
 */
const BUDGET_TABLE: Record<
  string,
  | { timeoutMs: number; dependencies: readonly string[]; retries: number }
  | undefined
> = SEAM_BUDGETS;

/**
 * Parse an Upstash `Duration` string to milliseconds, IN THE TEST.
 *
 * Hand-written here rather than imported so the conversion is not the module
 * under test's own arithmetic. Catches a UNIT change ("30 s" → "30 m") as well
 * as a magnitude change; the exact-string pin below catches a re-spelling that
 * happens to preserve the millisecond value ("30 s" → "30000 ms").
 */
function durationToMs(duration: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(
      `BREAKER_WINDOW is "${duration}", which is not an Upstash Duration this ` +
        `test can parse. Either the constant is malformed (the limiter would ` +
        `throw at construction) or the format changed — update this parser ` +
        `deliberately rather than relaxing the assertion.`,
    );
  }
  const unitMs: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return Number(match[1]) * unitMs[match[2]];
}

describe("SEAM_BUDGETS — every timeout pinned to a hand-typed literal", () => {
  it("declares exactly the 14 pinned budget keys (SET equality, not length)", () => {
    // Sorted SET equality. A length assertion is green under a rename, which is
    // how a call site quietly loses the budget it was supposed to spend.
    expect(
      Object.keys(SEAM_BUDGETS).sort(),
      "The SeamBudgetKey set drifted from the pinned 14. A key was ADDED, " +
        "REMOVED or RENAMED. Adding one is fine — pin it here in the same " +
        "commit, together with its timeoutMs, so the new call site's budget is " +
        "reviewable as a value rather than inferred from a diff.",
    ).toEqual([...EXPECTED_BUDGET_KEYS].sort());
  });

  it.each(Object.entries(EXPECTED_TIMEOUT_MS))(
    "%s.timeoutMs is the pinned literal",
    (key, expectedMs) => {
      const row = BUDGET_TABLE[key];
      expect(
        row,
        `The budget table has NO row for "${key}", which this oracle pins at ` +
          `${expectedMs}ms. A deleted row must delete its pin in the same ` +
          `commit — silently dropping the case list is how a budget stops ` +
          `being checked at all.`,
      ).toBeDefined();
      expect(
        row?.timeoutMs,
        `"${key}" now budgets ${row?.timeoutMs}ms; this oracle pins ${expectedMs}ms. ` +
          `Retuning a budget is a legitimate change — make it HERE too, in the ` +
          `same commit, so the new number is reviewed rather than absorbed.`,
      ).toBe(expectedMs);
    },
  );

  it.each(Object.entries(EXPECTED_DEPENDENCIES))(
    "%s declares exactly the pinned dependency set",
    (key, expectedDependencies) => {
      const row = BUDGET_TABLE[key];
      expect(
        row,
        `The budget table has NO row for "${key}", which this oracle pins with ` +
          `the dependency set [${expectedDependencies.join(", ")}].`,
      ).toBeDefined();
      // Sorted SET equality, never a length: a length check passes a SWAP
      // (supabase → mt5-gateway), which silently re-points a call site at a
      // circuit it does not depend on and leaves the one it does unprotected.
      expect(
        [...(row?.dependencies ?? [])].sort(),
        `"${key}" now declares [${(row?.dependencies ?? []).join(", ")}]; this ` +
          `oracle pins [${expectedDependencies.join(", ")}]. A declaration that ` +
          `drifts silently UNDER-protects (a dependency whose circuit is open no ` +
          `longer gates this call) or OVER-protects (A-01: an unrelated ` +
          `dependency's trip suppresses this call). Change it HERE in the same ` +
          `commit, with the 503 raise site that justifies it named in the row.`,
      ).toEqual([...expectedDependencies].sort());
    },
  );

  it.each(Object.entries(EXPECTED_RETRIES))(
    "%s.retries is the pinned literal (5 rows at 1 post-audit, the rest 0)",
    (key, expectedRetries) => {
      // Phase 141 flipped exactly five rows to 1 after the SEAM-05 audit, and
      // every route's worst-case lambda hold scales with (1 + retries). Both
      // DIRECTIONS are pinned here: flipping a 0 to 1 without an audit verdict
      // reddens, AND flipping one of the five back to 0 reddens (the retry the
      // audit authorized would silently vanish). Change a value HERE, in the same
      // commit as the row and its registry verdict.
      expect(
        BUDGET_TABLE[key]?.retries,
        `"${key}" now performs ${BUDGET_TABLE[key]?.retries} retries; this oracle ` +
          `pins ${expectedRetries}. Retry is Phase 141's, gated on the SEAM-05 ` +
          `idempotency audit — replaying a non-idempotent /process-key ` +
          `double-enqueues a sync — and raising it silently multiplies this ` +
          `route's SC-4b worst case.`,
      ).toBe(expectedRetries);
    },
  );

  it("exactly 5 rows carry retries 1 — the count itself, hand-typed (D-07)", () => {
    // ⚠️ THIS PIN EXISTS TO CONTRADICT PROSE. Three comments in the module under
    // test claimed, long after it stopped being true, that "every row today"
    // carries `retries: 0`. Five do not. The per-key oracle above pins each row
    // individually, but it cannot fail on the CLAIM — a reader (or a reviewer,
    // or the next phase's planner) who believed the sentence would find nothing
    // red. This does: the sentence is now contradicted by a test, not only by a
    // reader who happens to count.
    //
    // The 5 is hand-typed and is NOT `Object.keys(...).length` of anything in
    // the module under test; it is the count the SEAM-05 audit authorised. If a
    // sixth row is legitimately flipped, change this literal in the same commit
    // as the row, its registry verdict, and any prose that states the number.
    //
    // ⚠️ 141.2 / D-03 CHECKED THIS AND LEFT IT AT 5 — deliberately, not by
    // omission. Withdrawing resync's retry verdict removes a registry ENTRY, not
    // a budget ROW: `SEAM_BUDGETS[*].retries` is pure ACCOUNTING post-D-08 (the
    // registry is the gate; `resilientFetch` no longer falls back to the row),
    // and `process-key-enqueue` is MANY-TO-ONE over {onboard, resync}. `onboard`
    // is still a YES flow and still lands on that row, so the row still funds a
    // real second attempt and SC-4b must still charge for it. The number would
    // move only if the LAST retrying member of a row lost its verdict.
    const rowsAtOne = Object.values(BUDGET_TABLE).filter(
      (row) => row?.retries === 1,
    ).length;

    expect(
      rowsAtOne,
      `${rowsAtOne} budget rows carry retries 1; the SEAM-05 audit authorised ` +
        `exactly 5 (bridge, simulator, portfolio-optimizer, optimize-weights, ` +
        `process-key-enqueue). A sixth means a row was flipped without a ` +
        `verdict; a fourth means an authorised retry was silently un-charged ` +
        `from SC-4b's arithmetic. Either way, do not adjust this number to make ` +
        `a diff pass — adjust it because the audit changed.`,
    ).toBe(5);
  });

  describe("registry ↔ rows consistency (SEAM-05 anti-drift)", () => {
    // ⚠️ WHAT EACH SIDE IS, AFTER D-08. These two hand-typed statements are NOT
    // peers any more. The registry (seam-retry-registry) is the GATE: its verdict
    // is what the two client chokepoints pass as the now-REQUIRED
    // `retriesOverride`, and it is the only thing that turns a retry on. The
    // SEAM_BUDGETS row is ACCOUNTING: `resilientFetch` no longer falls back to it,
    // and its readers are SC-4b's headroom arithmetic and the retries oracle
    // above.
    //
    // That asymmetry is exactly why they must still agree. A row that drifts BELOW
    // its verdict under-charges SC-4b — the route's worst-case lambda hold is
    // computed for one attempt while production performs two — and a row that
    // drifts ABOVE its verdict charges for a retry nobody performs. Neither is
    // visible in behaviour, which is what makes the pin the only detector. Before
    // D-08 a drifting row could also silently change BEHAVIOUR; that half of the
    // hazard is now closed by construction, and these pins are what stop the
    // remaining accounting half.

    it("the four registry maps have their hand-typed sizes (D-14a anti-vacuity)", () => {
      // ⚠️ THIS FENCE GUARDS THE `it.each` DIRECTLY BELOW, WHICH ITERATES THE MAP
      // UNDER TEST. That is the one shape this file's own :86-92 docblock warns
      // against — `EXPECTED_TIMEOUT_MS` exists precisely so `it.each` iterates a
      // HAND-TYPED map, because "iterating the table would silently produce a
      // shorter — and still green — case list". The registry `it.each` below was
      // written the other way and inherited exactly that hole.
      //
      // ⭐ MEASURED, not theorised. Plan 141.1-04 deleted the `bridge` entry from
      // RETRY_SAFE_ANALYTICS and recorded the result: the suite went from 78 to
      // 77 tests with the `it.each` NOT failing — it merely SHED a case. The one
      // failure came from the OQ-3 pin added in that same plan, which happens to
      // hand-type the same four keys. Take that pin away and deleting an audited
      // retry verdict is invisible here. A map emptied outright would yield ZERO
      // cases and a fully green file: BLIND, not satisfied.
      //
      // The four numbers are the counts the SEAM-05 idempotency audit produced,
      // hand-typed here and never `Object.keys(...).length` of anything else. If
      // a verdict is legitimately added or withdrawn, change the literal in the
      // same commit as the entry — never to make a diff pass.
      expect(
        Object.keys(RETRY_SAFE_ANALYTICS).length,
        "RETRY_SAFE_ANALYTICS no longer holds exactly 4 audited retry verdicts " +
          "(bridge, simulator, portfolio-optimizer, optimize-weights). A FIFTH " +
          "is a wrapper granted a replay without an idempotency audit; a THIRD " +
          "means an authorised retry was withdrawn while SC-4b still charges " +
          "for it — and the case list below would shrink to match, silently.",
      ).toBe(4);
      expect(
        Object.keys(RETRY_SAFE_FLOW_TYPES).length,
        "RETRY_SAFE_FLOW_TYPES no longer holds exactly 1 audited flow " +
          "(onboard). 141.2 / D-03 withdrew resync's grant — it was issued on a " +
          "sentence 141.1-02 deleted as false. Adding teaser or csv here is the " +
          "SC3 landmine: a replayed teaser double-mints its " +
          "verification/public_token/lead.",
      ).toBe(1);
      expect(
        Object.keys(RETRY_AUDIT_NO_FLOW_TYPES).length,
        "RETRY_AUDIT_NO_FLOW_TYPES no longer holds exactly 3 refusals " +
          "(teaser, csv, resync). A refusal that disappears is an audit verdict " +
          "lost, not a flow made safe.",
      ).toBe(3);
      expect(
        Object.keys(RETRY_AUDIT_NO_ANALYTICS).length,
        "RETRY_AUDIT_NO_ANALYTICS no longer holds exactly 6 refusals " +
          "(validate-key, validate-key-serialized, encrypt-key, " +
          "match-recompute, portfolio-analytics, match-eval). Together with the " +
          "4 above this is the whole 10-wrapper analytics surface: a wrapper in " +
          "NEITHER map has no audit verdict at all.",
      ).toBe(6);
    });

    it.each(Object.keys(RETRY_SAFE_ANALYTICS))(
      "every allowlisted analytics wrapper (%s) has its SEAM_BUDGETS row at retries 1",
      (key) => {
        expect(
          BUDGET_TABLE[key]?.retries,
          `"${key}" is retry-safe in the registry but its budget row is ` +
            `${BUDGET_TABLE[key]?.retries}. SC-4b reads the ROW, so a row still at 0 ` +
            `means the audited retry silently never happens. Flip the row in the ` +
            `same commit as the verdict.`,
        ).toBe(1);
      },
    );

    it("process-key-enqueue (the onboard+resync grain) is at retries 1", () => {
      // The process-key seam is audited at flow_type grain, but its ENQUEUE budget
      // row must carry the literal SC-4b reads for onboard/resync.
      expect(BUDGET_TABLE["process-key-enqueue"]?.retries).toBe(1);
    });

    it("all five flipped rows AGREE with the registry verdict that gates them (OQ-3)", () => {
      // ⚠️ THE ACCOUNTING CANNOT SILENTLY DIVERGE FROM THE GATE. Both sides are
      // hand-typed here — the five keys, and the 1 each is expected to carry —
      // so this is not "the module agrees with itself". The pair is asserted
      // TOGETHER, per key: a row at 1 whose registry entry has been deleted, or
      // a registry entry at 1 whose row was set back to 0, fails on the key that
      // moved rather than somewhere downstream in SC-4b's arithmetic.
      //
      // The four analytics keys carry their verdict at BUDGET-KEY grain
      // (RETRY_SAFE_ANALYTICS is 1:1 with the row). `process-key-enqueue` does
      // not: the process-key seam is audited at FLOW_TYPE grain, and this one row
      // serves both audited flows — so its counterpart is the pair
      // {onboard, resync}, checked below rather than through a lookup that would
      // hide the many-to-one.
      const FLIPPED_ANALYTICS_ROWS = [
        "bridge",
        "simulator",
        "portfolio-optimizer",
        "optimize-weights",
      ] as const;

      for (const key of FLIPPED_ANALYTICS_ROWS) {
        expect(
          RETRY_SAFE_ANALYTICS[key]?.retries,
          `"${key}" carries retries in its budget row but has NO retry-safe ` +
            `registry entry (or its entry no longer says 1). After D-08 the ` +
            `registry is the GATE: without the entry the wrapper stops retrying ` +
            `entirely while SC-4b keeps charging for the second attempt. Delete ` +
            `the verdict and the row flip together, or neither.`,
        ).toBe(1);
        expect(
          BUDGET_TABLE[key]?.retries,
          `"${key}" is retry-safe in the registry, so its budget row must ` +
            `declare 1 for SC-4b's headroom arithmetic to charge the retried ` +
            `leg. A row at ${BUDGET_TABLE[key]?.retries} under-charges a route ` +
            `that really does perform two attempts.`,
        ).toBe(1);
      }

      // The many-to-one row, AFTER 141.2 / D-03. `process-key-enqueue` serves
      // {onboard, resync}, and the pair is no longer symmetric: onboard keeps
      // its verdict, resync's was WITHDRAWN (its grant rested on a sentence
      // 141.1-02 deleted as false). The row stays at 1 because ONE of the two
      // flows it serves still retries — a many-to-one row is charged for the
      // maximum over its members, not for each. Both halves are asserted, in
      // opposite directions, so neither drift is silent: re-granting resync
      // without an audit reddens here, and dropping onboard's grant while the
      // row still declares a retry reddens here too.
      expect(
        RETRY_SAFE_FLOW_TYPES.onboard?.retries,
        "onboard lost its retry-safe verdict while process-key-enqueue's row " +
          "still declares a retry. After D-03 withdrew resync, onboard is the " +
          "ONLY member of this row still carrying a grant — so the row is now " +
          "accounting for a retry no flow performs.",
      ).toBe(1);
      expect(
        RETRY_SAFE_FLOW_TYPES.resync,
        "resync is back in RETRY_SAFE_FLOW_TYPES. 141.2 / D-03 withdrew that " +
          "grant: the strategy-scoped status='draft' pre-check does not make a " +
          "replay safe (the worker tick can advance the draft between attempts), " +
          "and re-granting requires a DURABLE idempotency key for resync, which " +
          "does not exist. Do not restore this to make a diff pass.",
      ).toBeUndefined();
      expect(
        RETRY_AUDIT_NO_FLOW_TYPES.resync,
        "resync's NO verdict left RETRY_AUDIT_NO_FLOW_TYPES. Absence from the " +
          "YES map already yields no-retry, so this would not change behaviour — " +
          "it would delete the AUDIT, leaving the next reader with no record of " +
          "why the retry was withdrawn.",
      ).toBeDefined();
      expect(
        BUDGET_TABLE["process-key-enqueue"]?.retries,
        "onboard is still retry-safe in the registry, so the enqueue row must " +
          "declare 1 for SC-4b's headroom arithmetic.",
      ).toBe(1);
    });

    it("the SC3 belt and the Pitfall-2 fence stay at retries 0 at the row grain", () => {
      // process-key-sync carries teaser+csv: it must NEVER retry (double-mints a
      // lead). keys-permissions is the fan-out route whose retry would breach the
      // finalize-wizard composite's lambda ceiling (T-141-09). Hand-typed 0s.
      expect(
        BUDGET_TABLE["process-key-sync"]?.retries,
        "process-key-sync retries flipped off 0 — the teaser shares this row and a " +
          "retry double-mints its verification/public_token/lead (SC3).",
      ).toBe(0);
      expect(
        BUDGET_TABLE["keys-permissions"]?.retries,
        "keys-permissions retries flipped off 0 — the finalize-wizard composite " +
          "would breach the 300k lambda ceiling mid-outage (T-141-09).",
      ).toBe(0);
    });
  });

  it("uses exactly four magnitudes — 15s, 30s, 60s and 120s — spelled out", () => {
    // A human-readable anchor for the four tiers, one representative each, so
    // a reader sees the actual numbers without decoding the it.each above.
    //
    // ⚠️ The FOURTH tier arrived with Phase 153.4 / D-26 and is not a free
    // addition: 120 s is the longest budget in the table, so it — and not
    // `process-key-sync` — is what the A-25 breaker coupling is now sized
    // against. The title above went false the instant the row landed while
    // every assertion in this block stayed green, which is exactly why the
    // prose moves in the same commit as the row.
    expect(BUDGET_TABLE.bridge?.timeoutMs).toBe(15_000);
    expect(BUDGET_TABLE["validate-key"]?.timeoutMs).toBe(30_000);
    expect(BUDGET_TABLE["process-key-sync"]?.timeoutMs).toBe(60_000);
    expect(BUDGET_TABLE["validate-key-serialized"]?.timeoutMs).toBe(120_000);
  });
});

/**
 * The ONE reducer both A-25 assertions below run — the real one over the live
 * table, and the SELF-TEST over a synthetic one.
 *
 * ⚠️ SHARED ON PURPOSE. A SELF-TEST that re-types the reducer proves that the
 * RE-TYPED code works and says nothing at all about the assertion it claims to
 * exercise. Sharing the code path is what makes the SELF-TEST evidence.
 *
 * ⚠️ Returns `-Infinity` for an empty or mis-shaped table, which would satisfy
 * any upper-bound ceiling forever. Every caller therefore carries an explicit
 * vacuity guard; do not "fix" that here by clamping — a clamp would hide the
 * mis-shape rather than redden it.
 */
function longestTimeoutMs(
  table: Readonly<Record<string, { readonly timeoutMs: number }>>,
): number {
  return Math.max(...Object.values(table).map((row) => row.timeoutMs));
}

describe("breaker constants — all six pinned to hand-typed literals", () => {
  it("BREAKER_KEY is the literal 'breaker:railway'", () => {
    // MODULE CONSTANT, never interpolated from user input (threat T-140-01):
    // a user-influenced key is a cross-tenant DoS, or shards the breaker so it
    // never trips at all.
    expect(BREAKER_KEY).toBe("breaker:railway");
  });

  it("BREAKER_FAILURE_THRESHOLD is the literal 5", () => {
    expect(
      BREAKER_FAILURE_THRESHOLD,
      "The breaker's trip threshold changed. Raising it delays protection " +
        "during a real Railway outage; lowering it lets one unlucky pod " +
        "restart take the seam down. Since Phase 141 the unit is an ATTEMPT, " +
        "not a request, so raising it delays containment for retried traffic " +
        "TWICE as much as the number suggests — see the ratified tradeoff on " +
        "the constant itself, and the per-attempt-latch case in " +
        "resilient-fetch.retry.test.ts, which is where that doubling is " +
        "pinned as BEHAVIOUR rather than as arithmetic.",
    ).toBe(5);
  });

  // ── THE TRIP-COUNT ASSERTION THAT USED TO STAND HERE IS DELETED ────────────
  // (141.2 / D-05, finding 13.) It read
  // `expect(Math.ceil(BREAKER_FAILURE_THRESHOLD / 2)).toBe(3)` — arithmetic
  // over a constant the test above already pins to a literal, so it was true by
  // construction and could not fail for ANY change to the behaviour its own
  // message described. That is this file's own stated law broken inside the
  // file that states it: never derive the oracle from the module under test.
  //
  // MEASURED, not asserted. With the per-attempt latch reset deleted from
  // `resilientFetch` — the exact behaviour the deleted message named — that
  // assertion stayed GREEN while the per-attempt-latch case in
  // `resilient-fetch.retry.test.ts` went RED (it drives the real loop through a
  // 503-503 double and counts the recordings). So the CLAIM has coverage and
  // the deleted pin was not it.
  //
  // DELETED, NOT REPLACED, deliberately: a replacement would be a second copy
  // of a test that already exists, and any replacement phrased as "N user
  // requests" would be WRONG after 141.2 / D-06 for the status class the
  // upstream contract makes mandatory — a 503 carrying a positive `Retry-After`
  // now fails fast and records ONE failure, not two. The trip-count CLAIM lives
  // in `docs/runbooks/seam-breaker.md`; the trip-count BEHAVIOUR is pinned by
  // that latch case. This file pins CONSTANTS, not arithmetic over its own pins.

  it("BREAKER_WINDOW is the literal '30 s'", () => {
    // The exact string, not just its millisecond value: "30000 ms" would parse
    // identically while changing what a reader of the constant sees.
    expect(BREAKER_WINDOW).toBe("30 s");
    expect(durationToMs(BREAKER_WINDOW)).toBe(30_000);
  });

  it("BREAKER_COOLDOWN_S is the literal 30", () => {
    expect(BREAKER_COOLDOWN_S).toBe(30);
  });

  it("DEFAULT_RETRY_AFTER_S is the literal 30", () => {
    expect(DEFAULT_RETRY_AFTER_S).toBe(30);
  });

  it("SEAM_RETRIES is 0 — a NEGATIVE pin, and out of this phase's fence", () => {
    // Phase 141 owns raising this, and only for calls the SEAM-05 idempotency
    // audit allowlists: replaying a non-idempotent /process-key double-enqueues
    // a sync. Raising it here also silently multiplies every route's SC-4b
    // worst case, which is why the pin is negative and explicit.
    expect(
      SEAM_RETRIES,
      "SEAM_RETRIES is no longer 0. Retry is Phase 141's, gated on the " +
        "idempotency audit — and every route's worst-case lambda hold scales " +
        "with (1 + SEAM_RETRIES).",
    ).toBe(0);
  });

  it("SEAM_RETRY_BACKOFF_MS is the literal 250 (D-14b)", () => {
    // Phase 141 shipped this constant with no pin at all, unlike every sibling
    // in this describe. It is the FIXED half of the wait between a failed
    // attempt and its one retry.
    expect(
      SEAM_RETRY_BACKOFF_MS,
      "SEAM_RETRY_BACKOFF_MS moved. RAISING it lengthens every retried route's " +
        "worst-case lambda hold, which SC-4b charges at the MAX of backoff + " +
        "jitter — the finalize-wizard composite has 22 500 ms of headroom, so " +
        "this is not free. LOWERING it retries into an upstream that has had " +
        "less time to recover and spends a second breaker failure learning " +
        "that. Change it deliberately and re-read SC-4b's arithmetic in " +
        "seam-budgets.invariant.test.ts in the same commit.",
    ).toBe(250);
  });

  it("SEAM_RETRY_JITTER_MAX_MS is the literal 250 (D-14b)", () => {
    // The RANDOM half. Added, never subtracted — see the constant's docblock —
    // so it only ever moves the interval upward, which is why the sum below is
    // the number SC-4b must charge.
    expect(
      SEAM_RETRY_JITTER_MAX_MS,
      "SEAM_RETRY_JITTER_MAX_MS moved. Jitter exists to decorrelate concurrent " +
        "callers that all failed at the same instant; dropping it to 0 makes " +
        "every retried caller re-hit a sick upstream in the same millisecond, " +
        "and raising it widens the worst case SC-4b charges.",
    ).toBe(250);
  });

  it("the worst-case retry interval is 500ms — the sum SC-4b charges (D-14b)", () => {
    // DERIVED on the left, hand-typed on the right — and unlike the ⌈threshold/2⌉
    // assertion 141.2 / D-05 deleted from this file, this one CAN fail. That one
    // was arithmetic over a SINGLE constant the file already pinned, so the two
    // sides could never disagree; this one composes TWO independently-pinned
    // constants, so a compensating edit (300 + 200) reddens it while leaving both
    // individual pins green. That difference is the whole test of whether a
    // derived left-hand side is legitimate here. This is also the number that
    // actually enters SC-4b's headroom arithmetic: the jitter is added and never
    // subtracted, so the MAX interval is the sum, not the mean, and it is the SUM,
    // not either part, that the budget arithmetic spends.
    expect(
      SEAM_RETRY_BACKOFF_MS + SEAM_RETRY_JITTER_MAX_MS,
      "The worst-case wait between a failed seam attempt and its retry is no " +
        "longer 500ms. SC-4b charges this MAX once per retried leg; if this " +
        "sum grows, every retried route's worst-case lambda hold grows with it " +
        "and the tightest route's headroom shrinks. Update the SC-4b arithmetic " +
        "and its hand-typed worst cases in the same commit — never widen the " +
        "ceiling to absorb it.",
    ).toBe(500);
  });

  it("BREAKER_LOCK_TOMBSTONE_S is the literal 90", () => {
    // How much longer the KEY lives than the LOCK it carries. The lock is open
    // until the expiry encoded in its VALUE; the key lingers past that so
    // `recordSeamFailure` can still read WHEN the last lock was armed, which is
    // the whole of the A-25 no-re-arm guard.
    //
    // 60 → 90 with Phase 153.4 / D-26, in the SAME commit as the 120 000 ms
    // `validate-key-serialized` budget: (30 + 90) × 1 000 = 120 000 ≥ 120 000.
    // The inequality now holds with EQUALITY, so there is no headroom left —
    // the next budget raise moves this literal again.
    expect(
      BREAKER_LOCK_TOMBSTONE_S,
      "The lock tombstone changed. Shortening it below (longest seam budget − " +
        "cooldown) re-opens A-25: a request admitted before a lock was armed " +
        "finds no trace of it and re-arms a fresh cooldown on stale evidence. " +
        "At the longest budget of 120 000 ms and a 30 s cooldown, 90 is the " +
        "MINIMUM that still spans it.",
    ).toBe(90);
  });

  it("A-25: the tombstone outlives the longest seam budget", () => {
    // Both sides literal. The worst case the guard must span is a request
    // admitted the instant before a lock is armed and failing at the end of the
    // longest budget in the table — since Phase 153.4 / D-26 that is
    // `validate-key-serialized`, at 120 000 ms, NOT `process-key-sync` at
    // 60 000 ms. The tombstone therefore has to cover (120 000 − cooldown).
    //
    // ⚠️ THIS ASSERTION IS KEPT BESIDE THE DERIVED ONE BELOW, NOT REPLACED BY IT
    // (D-19). This one restates the longest budget as a hand-typed literal, so
    // it catches the two BREAKER CONSTANTS moving; it is structurally unable to
    // catch a budget ROW outgrowing them, which is the derived one's job.
    // Neither implies the other.
    expect(
      BREAKER_LOCK_TOMBSTONE_S * 1_000,
      "The lock tombstone no longer spans the longest seam budget, so a " +
        "120s-budget request that failed after a full cooldown can no longer " +
        "see the lock it overlapped — and re-arms the circuit on evidence it " +
        "gathered before the previous trip.",
    ).toBeGreaterThanOrEqual(120_000 - 30_000);
  });

  it("A-25 (DERIVED): the LONGEST budget in the live table fits inside tombstone + cooldown", () => {
    // ── WHY THIS STANDS BESIDE THE ASSERTION ABOVE, NOT INSTEAD OF IT ─────────
    // The one above is LITERAL vs LITERAL: it catches the two breaker constants
    // moving. It cannot catch the COUPLING breaking, because the "60 000" it
    // compares against is a hand-typed restatement of a fact that lives in the
    // budget table — raise a budget row past the tombstone and that assertion
    // stays green while A-25 is actually violated. This one is DERIVATION vs
    // HAND-TYPED: the only derived side is the longest timeout in the table.
    // Neither implies the other, so both are kept (D-19).
    //
    // ⛔ The ceiling below is deliberately built from the bare literals 90 and
    // 30 (seconds). Reading it out of the module under test is the exact defect
    // this file's ONE RULE forbids, and it is precisely what makes the incumbent
    // A-25 pin unable to fail.
    const longest = longestTimeoutMs(SEAM_BUDGETS);

    // VACUITY GUARDS. `Math.max` over an empty or mis-shaped table is
    // -Infinity, which passes the ceiling forever while measuring nothing.
    expect(
      Object.keys(SEAM_BUDGETS).length,
      "The seam budget table parsed with fewer than the 14 rows it carries. " +
        "The derivation below is measuring an empty or renamed table, so its " +
        "ceiling check is vacuous — fix the derivation, never the floor.",
    ).toBeGreaterThanOrEqual(14);
    expect(
      longest,
      "The longest seam budget derived below 120 000 ms. Either a real budget " +
        "was cut (a separate question) or the rows no longer carry timeoutMs " +
        "and the reducer is reading undefined.",
    ).toBeGreaterThanOrEqual(120_000);

    expect(
      longest,
      "A-25 IS BROKEN: the longest seam budget no longer fits inside " +
        "(lock tombstone + breaker cooldown), so a request admitted just " +
        "before a lock was armed can fail after the tombstone has expired, " +
        "find no trace of that lock, and re-arm a fresh cooldown on stale " +
        "evidence. THE STANDING RULE, which Phase 153.4 / D-26 has now " +
        "exercised once: any budget raised above (lock tombstone + breaker " +
        "cooldown) × 1 000 must move the tombstone IN THE SAME COMMIT, and " +
        "the hand-typed seconds in this expression move with it. " +
        "Raising a budget alone is the break this assertion exists to catch — " +
        "it is the ONLY assertion in this file that can see it, because every " +
        "other one restates the longest budget as a literal. ⚠️ THE EQUALITY IS " +
        "TIGHT TODAY: the longest budget is validate-key-serialized at " +
        "120 000 ms and the ceiling is exactly (90 + 30) × 1 000 = 120 000, so " +
        "there is ZERO headroom — the next budget raise of any size moves the " +
        "tombstone. ⛔ The fix is NEVER to weaken, relax or delete this " +
        "assertion, and never to substitute the module's own constants for the " +
        "hand-typed seconds (that is this file's ONE RULE, and it is exactly " +
        "what made the incumbent literal-vs-literal A-25 pin blind). " +
        "⚠️ D-18's 90 000 ms is SUPERSEDED by D-26: D-18 picked 90 000 only " +
        "because it was the largest budget needing ONE constant changed, i.e. " +
        "it let a test invariant choose a production timeout, and that " +
        "reasoning was rejected — do not re-derive it from this arithmetic. " +
        "⚠️ D-28 (bounding the MT5 close() separately) is likewise SUPERSEDED " +
        "by D-30, which takes shutdown() off the request path entirely; it is " +
        "named only because the A-25 sizing conversation cites it. Neither " +
        "superseded decision is implemented and neither number belongs in this " +
        "expression.",
    ).toBeLessThanOrEqual((90 + 30) * 1_000);
  });

  it("SELF-TEST — the DERIVED A-25 assertion reddens for a budget that outgrows the ceiling", () => {
    // A relaxed or mis-shaped reducer that returns a small number would make
    // the assertion above green forever. This runs the SAME reducer over a
    // synthetic table and proves (a) it reports the MAXIMUM, not the first or
    // the last row, and (b) that maximum genuinely EXCEEDS the ceiling the
    // real assertion applies.
    const synthetic = { a: { timeoutMs: 15_000 }, b: { timeoutMs: 150_000 } };

    expect(
      longestTimeoutMs(synthetic),
      "The shared reducer no longer reports the maximum timeoutMs, so the " +
        "assertion above is not measuring the longest budget.",
    ).toBe(150_000);

    // ⚠️ THE SYNTHETIC IS HAND-TYPED 150_000 ON PURPOSE — do NOT rewrite it as
    // `ceiling + 1`. Deriving the synthetic from the module under test is the
    // self-referential oracle this whole file exists to forbid.
    // ⚠️ AND IT IS 150_000, NOT 120_000. 153.1-01 chose it ahead of D-26 for
    // exactly the reason D-26 has now made real: the ceiling was (30 + 60) ×
    // 1 000 = 90 000, which 120 000 cleared, but Phase 153.4 raised the
    // tombstone to 90 s and the ceiling is now exactly (30 + 90) × 1 000 =
    // 120 000 — and `120 000 > 120 000` is FALSE. 150 000 cleared both, so this
    // SELF-TEST survived that boundary un-red and needed no churn. If a
    // successor ever raises the ceiling past 150 000, this literal moves in
    // that same commit.
    // ⚠️ THE CEILING BELOW IS THE HAND-TYPED `(90 + 30) × 1 000` — THE SAME
    // EXPRESSION THE ASSERTION ABOVE APPLIES, not the module's own constants.
    // That is the whole point of a SELF-TEST: it must prove the synthetic
    // exceeds the ceiling THE ASSERTION UNDER TEST uses. Reading the live
    // constants instead leaves a real blind spot — raise the assertion's
    // hand-typed seconds past 150 000 without touching the module and this
    // SELF-TEST stays green while the assertion it validates has gone
    // decorative, which is precisely the failure it exists to rule out.
    expect(
      150_000,
      "A budget of 150 000 ms no longer exceeds the DERIVED A-25 assertion's " +
        "own ceiling, so that assertion can no longer redden for ANY table and " +
        "is decorative. Raise this synthetic above the new ceiling in the same " +
        "commit that raised it (see D-26).",
    ).toBeGreaterThan((90 + 30) * 1_000);
  });

  it("WIZFORM-05 / D-04: the serialized client budget exceeds the 105 s server worst case", () => {
    // ── THE INVARIANT WIZFORM-05 EXISTS TO CLOSE ──────────────────────────────
    // Nothing asserted this before Phase 153.4. A client ceiling BELOW the
    // server's honest worst case does not merely time out early — it abandons
    // the request before the verdict can land, so the user is told UNKNOWN
    // about a probe the server was about to answer correctly. That inversion is
    // the whole defect.
    //
    // 105_000 IS HAND-TYPED, and its derivation is written here rather than
    // imported. What Phase 153.3 ships on the serialized path, in sequence:
    //   · a 20 s BOUNDED lease acquisition   (services/mt5_concurrency.py)
    //   · a 75 s end-to-end probe deadline   (routers/exchange.py)
    //   · a 10 s release that runs OUTSIDE that deadline (routers/exchange.py)
    // = 105 s. ⛔ Do NOT import or parse a Python constant into a TS test to
    // "keep this in sync" — a cross-language read would make this assertion
    // unable to disagree with the thing it is checking.
    //
    // The Python side pins the same relationship independently from its own end
    // (plans 153.3-03 and 153.3-04 assert (lease + deadline + release) × 1000 <
    // 120 000). Two independent statements of one contract, not one restated
    // twice: either side can move without the other, and then exactly one of
    // the two reddens and names which end drifted.
    expect(
      BUDGET_TABLE["validate-key-serialized"]?.timeoutMs,
      "The serialized client budget no longer exceeds the 105 s server worst " +
        "case (20 s bounded lease wait + 75 s end-to-end probe deadline + 10 s " +
        "release outside the deadline). The client would abandon the request " +
        "before the server's honest verdict can land, and the user gets an " +
        "UNKNOWN for a probe that was about to answer — the exact inversion " +
        "WIZFORM-05 exists to close. The fix is to RAISE this budget (and " +
        "BREAKER_LOCK_TOMBSTONE_S with it, D-26) or to LOWER the server chain. " +
        "⛔ Never to lower this hand-typed 105 000.",
    ).toBeGreaterThan(105_000);
  });

  it("A-14: the cooldown is at least as long as the failure window", () => {
    // Both sides literal. If the cooldown were SHORTER than the window, the
    // failure counter would not yet have decayed when the open-lock expires, so
    // the very first failure after recovery re-trips immediately and the
    // breaker flaps forever instead of recovering.
    expect(
      BREAKER_COOLDOWN_S * 1_000,
      "BREAKER_COOLDOWN_S is now shorter than BREAKER_WINDOW. The counter has " +
        "not decayed when the lock expires, so ONE failure re-trips and the " +
        "breaker flaps permanently — an ordering fault, not a tuning choice.",
    ).toBeGreaterThanOrEqual(30_000);
  });
});

describe("[SEAMCORE-03] breaker STORE constants — all three pinned to hand-typed literals", () => {
  /**
   * These three bound the breaker's OWN store, and they are the terms
   * `seam-budgets.invariant.test.ts` adds to the SC-4b worst case. Pinning them
   * here is what makes a retune a reviewed value rather than a diff absorbed
   * into an arithmetic nobody reads.
   *
   * The pre-phase construction was a bare `Redis.fromEnv()`, i.e. the SDK
   * defaults: `retries: 5` (six attempts, `i <= attempts`), `Math.exp(i) * 50`
   * backoff summing to ≈4 290 ms, and `signal: undefined` — no deadline on any
   * attempt. A HANG is not a rejection, so fail-open did not cover it.
   */
  it("BREAKER_STORE_TIMEOUT_MS is the literal 2000", () => {
    expect(
      BREAKER_STORE_TIMEOUT_MS,
      "The per-attempt store deadline changed. Raising it multiplies every " +
        "seam route's worst-case lambda hold (it appears in SC-4b three times " +
        "over in the failing state); lowering it below Upstash's real REST " +
        "latency turns healthy round trips into aborts, which fail OPEN and " +
        "quietly disable the breaker.",
    ).toBe(2_000);
  });

  it("BREAKER_STORE_RETRIES is the literal 1", () => {
    expect(
      BREAKER_STORE_RETRIES,
      "The store retry count changed. The SDK default is 5 (six attempts); the " +
        "whole point of pinning it is that the attempt count is a term in the " +
        "budget arithmetic rather than an SDK default nobody declared.",
    ).toBe(1);
  });

  it("BREAKER_STORE_BACKOFF_MS is the literal 250", () => {
    // FIXED, not exponential. The SDK default `Math.exp(i) * 50` is 50 ms at
    // i=0 and 1 004 ms at i=3, so its contribution to a worst case depends on
    // the attempt index — a term that cannot be stated as one number in SC-4b.
    expect(BREAKER_STORE_BACKOFF_MS).toBe(250);
  });

  it("A-04: the store's whole worst case is a small fraction of the tightest route ceiling", () => {
    // Both sides literal. `(1 + retries)` attempts, each bounded by the
    // per-attempt deadline, plus `retries` fixed backoffs between them:
    //   (1 + 1) * 2000 + 1 * 250 = 4250 ms per store command.
    // The tightest ceiling any seam route declares is 300 s. This is an
    // ORDER-OF-MAGNITUDE fence, not the SC-4b assertion — that one lives next
    // door and compares against each route's maxDuration read from disk.
    const perCommandMs =
      (1 + BREAKER_STORE_RETRIES) * BREAKER_STORE_TIMEOUT_MS +
      BREAKER_STORE_RETRIES * BREAKER_STORE_BACKOFF_MS;
    expect(perCommandMs).toBe(4_250);
    expect(perCommandMs).toBeLessThan(300_000 / 10);
  });
});

describe("[SEAMCORE-01 / T-140-01] the breaker-key vocabulary, pinned three ways", () => {
  /**
   * THREE independent statements of the same vocabulary, asserted equal:
   *   1. `EXPECTED_BREAKER_KEYS` / `EXPECTED_SERVICE_DEPENDENCIES` — typed here;
   *   2. `breakerKeyFor` — the CORE's builder, over its own hand-typed union;
   *   3. `seamBreakerVerdict` — the LEAF's builder, over its own frozen set,
   *      which is the one that actually runs on a wire response.
   *
   * The duplication between (2) and (3) is deliberate — the leaf must import
   * nothing, so it cannot read the core's union, and a consumer that read its
   * vocabulary out of the emitter could never disagree with it. Asserting the
   * three equal is what makes the duplication safe: any one may change, but not
   * all three silently.
   */
  it.each(Object.entries(EXPECTED_BREAKER_KEYS))(
    "the core builds breaker:%s as the pinned literal",
    (dependency, expectedKey) => {
      expect(
        breakerKeyFor(dependency as Parameters<typeof breakerKeyFor>[0]),
      ).toBe(expectedKey);
    },
  );

  it.each(Object.entries(EXPECTED_BREAKER_KEYS))(
    "the LEAF's 503 verdict for %s names the same key the core builds",
    (dependency, expectedKey) => {
      const verdict = seamBreakerVerdict(503, {
        detail: {
          code: "X",
          dependency,
          retryable: true,
          detail: "a transient service fault",
        },
      });
      expect(verdict.counts).toBe(true);
      expect(
        verdict.breakerKey,
        `The discriminator and the core disagree about "${dependency}"'s breaker ` +
          `key. The core would CHECK one key while the wire path RECORDS against ` +
          `another, so that dependency's circuit could count to the threshold and ` +
          `still never gate anything — a breaker that can trip but cannot block.`,
      ).toBe(expectedKey);
      expect(verdict.breakerKey).toBe(
        breakerKeyFor(dependency as Parameters<typeof breakerKeyFor>[0]),
      );
    },
  );

  it("no value outside the closed set can ever become a key", () => {
    // The venue vocabulary and a hostile value, all hand-typed. STATUS_CONTRACT
    // §4: a 424's dependency is the CALLER'S VENUE, and error_contract._validate
    // refuses a 424 naming one of ours — so these two vocabularies are disjoint
    // by construction upstream, and this is the downstream half of that fence.
    const NOT_OURS = ["binance", "deribit", "bybit", "okx", "../../etc/passwd"];
    // The leaf logs loudly on an unrecognised dependency, which is correct and
    // is asserted in `seam-discriminator.test.ts`. Silenced here by swapping the
    // function directly rather than through vitest's spy API: this file takes no
    // doubles of any kind, and that absence is grep-asserted.
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      for (const value of NOT_OURS) {
        expect(EXPECTED_SERVICE_DEPENDENCIES).not.toContain(value);
        const verdict = seamBreakerVerdict(503, {
          detail: { code: "X", dependency: value, retryable: true, detail: "x" },
        });
        expect(
          verdict.breakerKey,
          `A 503 naming "${value}" produced a key built from it. A breaker key ` +
            `influenced by the wire is a trivial cross-tenant denial of service.`,
        ).toBe("breaker:railway");
      }
    } finally {
      console.warn = realWarn;
    }
  });

  it("the residual global key is the same literal on both sides", () => {
    // A transport failure names no dependency, and both sides must agree that
    // this is where it lands — otherwise the core would seed one key and check
    // another.
    expect(BREAKER_KEY).toBe("breaker:railway");
    expect(seamBreakerVerdict(null).breakerKey).toBe("breaker:railway");
    expect(seamBreakerVerdict(null).counts).toBe(true);
  });
});

describe("fake ↔ production — the breaker double's tuning cannot drift silently", () => {
  /**
   * The anti-drift fence for Layer 1.
   *
   * `src/test/helpers/upstash-breaker.ts` hand-types its own key, threshold and
   * window: it cannot import the core (that would run the core's module-load
   * side effects from inside a hoisted mock factory), and — the real reason — a
   * double that reads its tuning out of production cannot ever contradict
   * production. Two INDEPENDENTLY typed literals asserted equal is what makes
   * that duplication safe: either side may change, but not both silently.
   */
  const DRIFT = (what: string) =>
    `The breaker double's ${what} has drifted from production's. Every ` +
    `behavioural breaker test in this repo runs against that double, so they ` +
    `are now measuring the fake against itself and will stay green through a ` +
    `real change to the seam core. Fix whichever side is wrong — never make ` +
    `the fake read production's value to close the gap; that IS the defect.`;

  it("FAKE_BREAKER_KEY equals BREAKER_KEY", () => {
    expect(FAKE_BREAKER_KEY, DRIFT("breaker key")).toBe(BREAKER_KEY);
  });

  it("FAKE_THRESHOLD equals BREAKER_FAILURE_THRESHOLD", () => {
    expect(FAKE_THRESHOLD, DRIFT("failure threshold")).toBe(
      BREAKER_FAILURE_THRESHOLD,
    );
  });

  it("FAKE_LOCK_TOMBSTONE_MS equals the millisecond form of BREAKER_LOCK_TOMBSTONE_S", () => {
    // 60 000 → 90 000 with Phase 153.4 / D-26. TWO assertions, deliberately:
    // this one pins the double's own literal, the one below pins that it still
    // AGREES with production. Only the pair can tell "both moved together" from
    // "neither moved" — and moving production alone is what D-26 forbids.
    expect(FAKE_LOCK_TOMBSTONE_MS).toBe(90_000);
    expect(FAKE_LOCK_TOMBSTONE_MS, DRIFT("lock tombstone")).toBe(
      BREAKER_LOCK_TOMBSTONE_S * 1_000,
    );
  });

  it("the harness writes the lock VALUE format the core parses, and vice versa", () => {
    // ⚠️ THE FENCE FOR TRAP-9, AND THE REASON THE NINE `seedBreakerOpen` CALL
    // SITES DID NOT HAVE TO CHANGE IN PLAN 140.2-07. The stored value stopped
    // being the bare string "open" and became `open:<armedAt>:<expiresAt>`; the
    // helper absorbed that, so no test hand-builds the format. What that buys in
    // ergonomics it owes in risk: two encoders that silently disagree would make
    // every seeded-open case pass while opening nothing. This is where they are
    // made to agree.
    //
    // Both timestamps are hand-typed, and the expected STRING is written out in
    // full rather than composed — a template literal built from the same two
    // numbers would be the assertion restating the implementation.
    const ARMED_AT = 1_700_000_000_000;
    const EXPIRES_AT = 1_700_000_030_000;

    expect(encodeFakeBreakerLock(ARMED_AT, EXPIRES_AT)).toBe(
      "open:1700000000000:1700000030000",
    );
    expect(encodeBreakerLock(ARMED_AT, EXPIRES_AT)).toBe(
      "open:1700000000000:1700000030000",
    );

    // The core PARSES what the harness writes…
    expect(
      decodeBreakerLock(encodeFakeBreakerLock(ARMED_AT, EXPIRES_AT)),
      DRIFT("lock value encoding"),
    ).toEqual({ armedAtMs: ARMED_AT, expiresAtMs: EXPIRES_AT });

    // …and rejects the shapes it must, including the PRE-140.2-07 bare string,
    // which now reads CLOSED (the fail-forward direction of LOCKED DECISION 4).
    for (const bad of ["open", "open:1700000000000", "open:1:x", "", "yes", null]) {
      expect(decodeBreakerLock(bad)).toBeNull();
    }
  });

  it("FAKE_WINDOW_MS equals the millisecond form of BREAKER_WINDOW", () => {
    // Parsed in the test, with a hand-typed 30_000 on both sides, so this
    // catches a UNIT change ("30 s" → "30 m") as well as a magnitude change.
    expect(FAKE_WINDOW_MS).toBe(30_000);
    expect(durationToMs(BREAKER_WINDOW)).toBe(30_000);
    expect(FAKE_WINDOW_MS, DRIFT("failure window")).toBe(
      durationToMs(BREAKER_WINDOW),
    );
  });
});
