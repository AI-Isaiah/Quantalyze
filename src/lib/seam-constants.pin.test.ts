import { describe, it, expect } from "vitest";
import {
  SEAM_BUDGETS,
  BREAKER_KEY,
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_WINDOW,
  BREAKER_COOLDOWN_S,
  DEFAULT_RETRY_AFTER_S,
  SEAM_RETRIES,
  breakerKeyFor,
} from "./resilient-fetch";
import { seamBreakerVerdict } from "./seam-discriminator";
import {
  FAKE_BREAKER_KEY,
  FAKE_THRESHOLD,
  FAKE_WINDOW_MS,
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
 * The 13 budgets, typed HERE as literals and never derived from `SEAM_BUDGETS`.
 *
 * `it.each` below iterates THIS map, not the table's own keys: a table row that
 * is DELETED then produces a failing lookup, whereas iterating the table would
 * silently produce a shorter — and still green — case list.
 */
const EXPECTED_TIMEOUT_MS: Record<string, number> = {
  "validate-key": 30_000,
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
 * Asserted as a sorted-array EQUALITY, never as a length. A `.length === 13`
 * check passes a RENAME (`bridge` → `bridg`) and passes a swap (one key removed,
 * another added) — both of which silently detach a call site from its budget.
 */
const EXPECTED_BUDGET_KEYS: string[] = [
  "validate-key",
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
 */
const EXPECTED_DEPENDENCIES: Record<string, string[]> = {
  "validate-key": ["mt5-gateway"],
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
  it("declares exactly the 13 pinned budget keys (SET equality, not length)", () => {
    // Sorted SET equality. A length assertion is green under a rename, which is
    // how a call site quietly loses the budget it was supposed to spend.
    expect(
      Object.keys(SEAM_BUDGETS).sort(),
      "The SeamBudgetKey set drifted from the pinned 13. A key was ADDED, " +
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

  it.each(Object.keys(EXPECTED_DEPENDENCIES))(
    "%s.retries is 0 — the per-row NEGATIVE pin",
    (key) => {
      // Phase 141 flips these one row at a time, and every route's worst-case
      // lambda hold scales with (1 + retries). Raising one here is out of fence.
      expect(
        BUDGET_TABLE[key]?.retries,
        `"${key}" now performs retries. Retry is Phase 141's, gated on the ` +
          `SEAM-05 idempotency audit — replaying a non-idempotent /process-key ` +
          `double-enqueues a sync — and raising it silently multiplies this ` +
          `route's SC-4b worst case.`,
      ).toBe(0);
    },
  );

  it("uses exactly three magnitudes — 15s, 30s and 60s — spelled out", () => {
    // A human-readable anchor for the three tiers, one representative each, so
    // a reader sees the actual numbers without decoding the it.each above.
    expect(BUDGET_TABLE.bridge?.timeoutMs).toBe(15_000);
    expect(BUDGET_TABLE["validate-key"]?.timeoutMs).toBe(30_000);
    expect(BUDGET_TABLE["process-key-sync"]?.timeoutMs).toBe(60_000);
  });
});

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
        "restart take the seam down.",
    ).toBe(5);
  });

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
