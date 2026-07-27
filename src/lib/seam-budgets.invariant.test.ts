import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
// `SEAM_RETRIES` is deliberately NOT imported here. It survives as the value
// every `SEAM_BUDGETS` row is seeded from and as the subject of the module-level
// negative pin in `seam-constants.pin.test.ts`, but the SC-4b arithmetic below
// reads each ROW's own `retries` — see the header. Importing it here and
// asserting the two equal would redden on Phase 141's legitimate per-row flip,
// which is exactly the change the per-row shape exists to allow.
import {
  SEAM_BUDGETS,
  SEAM_ROUTE_BUDGETS,
  SEAM_EXCLUSIONS,
  BREAKER_STORE_TIMEOUT_MS,
  BREAKER_STORE_RETRIES,
  BREAKER_STORE_BACKOFF_MS,
} from "./resilient-fetch";

/**
 * SC-4 (SEAM-02) — the seam budget invariant.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A DATA ASSERTION
 * --------------------------------------------------
 * The invariant has two sides and they deliberately live in two different
 * places:
 *
 *   - the BUDGET side (`timeoutMs`, `calls`, and each row's own `retries`) comes
 *     from the exported tables in `resilient-fetch.ts`;
 *   - the CEILING side (`maxDuration`) is read from each route file ON DISK
 *     with `readFileSync`.
 *
 * Taking both sides from the table would produce an assertion that compares
 * the table to itself: green forever, catching nothing (140-RESEARCH.md
 * Pitfall 5). The disk read is what gives this file teeth — deleting or
 * editing `export const maxDuration` in any of the fifteen routes reddens CI,
 * which is the entire reason the pins were added in Waves 2-3.
 *
 * NO DEFAULT FOR AN ABSENT EXPORT. A route whose export is missing FAILS,
 * loudly, naming the route. Substituting the platform's own value for an
 * un-annotated route is the forbidden anti-pattern of Pitfall 8: it re-hides
 * the very dashboard-changeable assumption the pins exist to convert into a
 * checked in-repo fact.
 *
 * HONEST READING OF THE HEADROOM ASSERTION, RESTATED FOR THE STORE TERMS
 * (plan 140.2-07) AND THE BRANCH MODEL (plan 140.2-10).
 *
 * The arithmetic is no longer request time alone. The breaker's OWN store is
 * wall clock the route spends too, and leaving it out is what let a `Redis`
 * client with SIX unbounded attempts sit inside a "bounded" route without
 * appearing anywhere in this file. SC-4b computes, per route:
 *
 *   worstCaseMs(state) = MAX over the row's BRANCHES of (
 *                          Σ over that branch's budgets of
 *                            ( timeoutMs × calls × (1 + row.retries) )
 *                        + storeCommands(state) × STORE_COMMAND_WORST_CASE_MS
 *                            × (that branch's total seam calls)
 *                        )
 *
 * asserted separately in the CLOSED, OPEN and FAILING states, each against the
 * route's own on-disk `maxDuration`.
 *
 * ⚠️ WHY A MAX OVER BRANCHES AND NOT ONE SUM (plan 140.2-10 / A-29). A route
 * whose legs belong to MUTUALLY EXCLUSIVE branches spends one branch or the
 * other, never both, and summing them across branches over-states the worst
 * case badly enough to force a false breach. `finalize-wizard` is that route:
 * its composite branch re-probes every member key and returns through
 * `runLegacyFinalize` (whose enqueue is a Supabase RPC, NOT a seam call), while
 * its single-key branch probes once and then spends `process-key-enqueue`. The
 * legs are labelled with a `branch` and grouped; a row with NO labels is a
 * single implicit branch, i.e. the plain sum, which is what the other fourteen
 * rows are. Unlabelled legs on a LABELLED row are shared and charged to every
 * branch.
 *
 * Where that leaves the numbers today, with every row at `retries: 0` and one
 * store command costing 4 250 ms:
 *
 *   | state   | validate-and-encrypt (3 calls) | finalize-wizard (composite, 10) |
 *   |---------|--------------------------------|---------------------------------|
 *   | closed  | 120 000 + 12 750 = 132 750 ms  | 150 000 + 42 500 = 192 500 ms   |
 *   | open    |          0 + 12 750 = 12 750   |          0 + 42 500 =  42 500   |
 *   | failing | 120 000 + 38 250 = 158 250 ms  | 150 000 + 127 500 = 277 500 ms  |
 *
 * against a 300 000 ms ceiling. The tightest case in the whole table is now
 * `finalize-wizard` FAILING at 277 500 ms — **22 500 ms of headroom**, where
 * before this plan the same route declared 55 500 ms and was modelling a branch
 * it does not take when it fans out. Its single-key branch is unchanged
 * (38 500 / 8 500 / 55 500 ms) and is dominated. `create-with-key` remains the
 * two-call shape the old table described (38 500 / 8 500 / 55 500 ms).
 *
 * So this is no longer a comfortable guard for one route, and that is the point:
 * `MAX_COMPOSITE_MEMBERS` is 10 because 11 members would put the failing state
 * at 305 250 ms — a real breach, discovered here rather than in a killed lambda.
 * Its four real jobs are (a) to hold automatically when Phase 141 raises a row's
 * retries — at retries=1 finalize-wizard's composite branch is already at
 * 427 500 ms failing and BREACHES, which is a fact Phase 141 must plan around;
 * (b) to fail if a future budget is raised without the ceiling moving with it;
 * (c) to fail if the store's own bounding is loosened, which previously changed
 * a route's real worst case while changing nothing this file could see; and
 * (d) — new here — to fail if the composite fan-out cap is raised without the
 * declaration and the arithmetic being re-checked. The teeth for the other
 * fourteen routes still come mostly from the on-disk read in SC-4a.
 *
 * ⚠️ THE ARITHMETIC READS THE ROW, NOT THE MODULE CONSTANT (plan 140.2-06).
 * `SEAM_RETRIES` survives as the value every row is SEEDED from and as the
 * subject of the module-level negative pin, but Phase 141 flips rows one at a
 * time, so a sum built on the module constant would keep reporting 0 for every
 * route after the first flip — silently under-stating the exact worst case this
 * assertion exists to bound. Summing per row is also correct in principle: a
 * multi-leg route can mix a retried leg with a non-retried one.
 *
 * CEILING (honest): this file reads ONLY the fifteen route files enumerated in
 * `SEAM_ROUTE_BUDGETS`, plus the exclusion paths. It does NOT walk the import
 * graph, so it cannot notice a SIXTEENTH route that starts calling the seam
 * clients without being added to the table — that route would simply not be
 * scanned. The guard for that class is the `quantalyze/no-raw-analytics-fetch`
 * ESLint rule plus code review of a new `resilientFetch` call site, not this
 * test. A table-vs-import-graph reconciliation walker is the stronger (unbuilt)
 * version.
 */

const REPO = process.cwd();

/**
 * Matches the route-segment config STATEMENT only.
 *
 * `^` under the `m` flag anchors to the start of a line, so a line of prose
 * that mentions the export inside a comment cannot satisfy it (a comment line
 * begins with `//` or ` *`). That anchoring is deliberate grep-gate hygiene:
 * this phase hit prose-defeats-the-guard twice (140-03 deviation 1, 140-05
 * deviation 2), and an unanchored pattern here would let a route's explanatory
 * comment stand in for the pin it describes.
 */
const MAX_DURATION_EXPORT = /^export const maxDuration = (\d+)/m;

const ROUTE_ENTRIES = Object.entries(SEAM_ROUTE_BUDGETS);

/**
 * The worst-case wall clock ONE breaker-store command can consume.
 *
 * `(1 + retries)` attempts each bounded by the per-attempt deadline, plus
 * `retries` fixed backoffs between them. Derived from the store constants the
 * CORE exports, deliberately — pinning them to literals is
 * `seam-constants.pin.test.ts`'s job, and if this file hand-typed them too then
 * loosening the store's bounding would move the real worst case while leaving
 * this assertion computing the old one. The independence that keeps this file
 * honest is the CEILING side, read from disk.
 *
 * ⚠️ THIS OVER-STATES THE COST, ON PURPOSE. The SDK evaluates the signal factory
 * once per COMMAND, not once per attempt, so all of a command's attempts share
 * one deadline and the true worst case is nearer `TIMEOUT + one backoff`.
 * Charging `attempts × TIMEOUT` is the safe direction for a headroom assertion,
 * and it is stated rather than implied.
 */
const STORE_COMMAND_WORST_CASE_MS =
  (1 + BREAKER_STORE_RETRIES) * BREAKER_STORE_TIMEOUT_MS +
  BREAKER_STORE_RETRIES * BREAKER_STORE_BACKOFF_MS;

/**
 * Store commands ONE seam call issues, per breaker state. Hand-counted from
 * `resilient-fetch.ts`, and each number is a claim about a specific code path:
 *
 *   closed  — the pre-fetch `mget` in `isBreakerOpen`, and nothing else. ONE
 *             since plan 140.2-07 collapsed the `ttl` follow-up into the value.
 *   open    — the same single `mget`; the call then throws `CircuitOpenError`
 *             and never reaches `fetch`, so no REQUEST budget is spent at all.
 *   failing — that `mget`, plus the trip path's `get` (the A-25 guard reading
 *             when the last lock was armed) and its `set`.
 *
 * The FAILING figure is deliberately pessimistic in one respect: the trip path
 * runs once per `BREAKER_FAILURE_THRESHOLD` failures, not on every failure, and
 * the limiter's default in-memory `ephemeralCache` can short-circuit some
 * recordings without reaching Redis at all. Charging every seam call the full
 * three is the safe direction.
 */
const STORE_COMMANDS_PER_SEAM_CALL: Record<string, number> = {
  closed: 1,
  open: 1,
  failing: 3,
};

/** Does this state spend the REQUEST budget, or short-circuit before `fetch`? */
const STATE_SPENDS_REQUEST_BUDGET: Record<string, boolean> = {
  closed: true,
  // `CircuitOpenError` is thrown before the deadline is even constructed.
  open: false,
  failing: true,
};

const BREAKER_STATES = ["closed", "open", "failing"] as const;

/**
 * The 15 route rows, with their FULL `budgets` arrays, typed HERE as literals.
 *
 * Following `tests/lib/process-key-onboard-contract-parity.test.ts`'s
 * `EXPECTED_VERDICTS` convention: never derived from the table it guards, and
 * never derived from the module under test.
 *
 * WHY THE CONTENTS AND NOT JUST THE COUNT (D-10). Everything above reads the
 * `budgets` array back out of `SEAM_ROUTE_BUDGETS` and sums it, so DROPPING a
 * leg is invisible: `finalize-wizard` losing its `process-key-enqueue` entry
 * halves that route's declared worst case and every assertion in this file
 * still passes, more comfortably than before. The deep compare below is what
 * makes that mutation falsifiable.
 *
 * (The forward note that used to sit here — "plan 140.2-07 will add Upstash
 * store round trips to the SC-4b arithmetic" — has been DISCHARGED. It did; the
 * header's headroom table is the post-store reading, and this roster is
 * unchanged by it because the store cost is a function of the `calls` already
 * declared here.)
 */
const EXPECTED_ROUTE_BUDGETS: Record<
  string,
  {
    expectedMaxDurationS: number;
    budgets: Array<{ key: string; calls: number; branch?: string }>;
  }
> = {
  "src/app/api/keys/validate-and-encrypt/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1 },
      { key: "encrypt-key", calls: 1 },
      { key: "process-key-unified-dormant", calls: 1 },
    ],
  },
  "src/app/api/strategies/create-with-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1 },
      { key: "encrypt-key", calls: 1 },
    ],
  },
  "src/app/api/strategies/composite/add-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1 },
      { key: "encrypt-key", calls: 1 },
    ],
  },
  "src/app/api/bridge/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "bridge", calls: 1 }],
  },
  "src/app/api/simulator/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "simulator", calls: 1 }],
  },
  "src/app/api/portfolio-optimizer/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "portfolio-optimizer", calls: 1 }],
  },
  "src/app/api/scenario/optimize/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "optimize-weights", calls: 1 }],
  },
  "src/app/api/admin/match/eval/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "match-eval", calls: 1 }],
  },
  "src/app/api/admin/match/recompute/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "match-recompute", calls: 1 }],
  },
  "src/app/api/keys/sync/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-enqueue", calls: 1 }],
  },
  "src/app/api/strategies/finalize-wizard/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      // 10 is MAX_COMPOSITE_MEMBERS, hand-typed here and bound to the route's
      // own declaration by the cross-file assertion below.
      { key: "keys-permissions", calls: 10, branch: "composite" },
      { key: "keys-permissions", calls: 1, branch: "single-key" },
      { key: "process-key-enqueue", calls: 1, branch: "single-key" },
    ],
  },
  "src/app/api/verify-strategy/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-sync", calls: 1 }],
  },
  "src/app/api/strategies/csv-validate/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-sync", calls: 1 }],
  },
  "src/app/api/strategies/csv-finalize/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "process-key-sync", calls: 1 }],
  },
  "src/app/api/keys/[id]/permissions/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [{ key: "keys-permissions", calls: 1 }],
  },
};

/**
 * The three documented exclusion paths, typed here as literals.
 *
 * Complements — never replaces — the `>= 3` count assertion, the on-disk
 * existence check and the non-empty-reason check below. Those three catch a
 * table that is emptied, stale or lazily filled; this one catches a path being
 * SWAPPED, which leaves all three green.
 */
const EXPECTED_EXCLUSION_PATHS: string[] = [
  "src/app/api/debug-key-flow/route.ts",
  "src/app/api/cron/warm-analytics/route.ts",
  "src/lib/warmup-analytics.ts",
];

/**
 * The two `/health` warmers, typed here as a literal set that must be PRESENT.
 *
 * ⚠️ THIS IS NOT A DUPLICATE of `EXPECTED_EXCLUSION_PATHS` above, and collapsing
 * the two would delete a property. That one is a SET EQUALITY over the whole
 * table: it catches a path being swapped or added. This one is a MEMBERSHIP
 * pin over a named subset, and it is the half that survives the edit the set
 * equality cannot see — an author who deletes a warmer's exclusion row AND
 * updates the roster in the same commit leaves the set equality green while
 * silently removing that warmer from the guard below, because the guard
 * iterates the table. Membership is what keeps the guard's own reach pinned.
 *
 * A-12, which is why these two specifically may never enter the core: a cold
 * `/health` probe FAILING is the normal case, so a warmer routed through the
 * core would feed `recordSeamFailure` on every cold start, trip the breaker,
 * and the open breaker would then short-circuit the recovery probe — the
 * warmer's success being precisely the recovery signal. A self-sustaining
 * outage manufactured by the mitigation.
 */
const WARMER_EXCLUSION_PATHS: string[] = [
  "src/app/api/cron/warm-analytics/route.ts",
  "src/lib/warmup-analytics.ts",
];

/**
 * Whole-line and block comments go before matching, per this file's grep-gate
 * hygiene rule; a trailing comment stays, because leaving one in can only make
 * the guard fail when it should not, which is the safe direction.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * The composite fan-out cap, read from the ROUTE FILE on disk.
 *
 * Same idiom, and the same reason, as `readMaxDurationFromDisk` below: the
 * budget table and the constant that actually bounds the query live in two
 * different files, and an assertion that took both sides from the table would
 * be green forever. A Next.js route module cannot `export` an arbitrary
 * constant (its export surface is validated against the route-segment
 * contract), so a disk read is not a shortcut here — it is the only genuine
 * cross-file link available.
 *
 * `^` under `m` anchors to the start of a line, so a comment mentioning the
 * constant cannot satisfy the pattern; this phase hit prose-defeats-the-guard
 * twice.
 */
const MAX_COMPOSITE_MEMBERS_DECL = /^const MAX_COMPOSITE_MEMBERS = (\d+)/m;

const FINALIZE_WIZARD_ROUTE =
  "src/app/api/strategies/finalize-wizard/route.ts";

function readCompositeCapFromDisk(): number {
  const src = readFileSync(join(REPO, FINALIZE_WIZARD_ROUTE), "utf8");
  const m = MAX_COMPOSITE_MEMBERS_DECL.exec(src);
  if (!m) {
    throw new Error(
      `"${FINALIZE_WIZARD_ROUTE}" has no \`const MAX_COMPOSITE_MEMBERS = <n>\` ` +
        `declaration. The composite member fan-out is what this route's ` +
        `keys-permissions leg is DECLARED to cost; without the cap the ` +
        `declaration bounds nothing. Restore the constant — do NOT relax this ` +
        `test.`,
    );
  }
  return Number(m[1]);
}

/**
 * Group a row's legs into the mutually exclusive BRANCHES the route can take.
 *
 * A leg with no `branch` is SHARED: on an unlabelled row (fourteen of fifteen)
 * that collapses to one implicit branch, i.e. the plain sum this file computed
 * before plan 140.2-10; on a labelled row a shared leg is charged to every
 * branch, because "spent whichever way the request goes" is what no label
 * means.
 */
function branchesOf<T extends { calls: number; branch?: string }>(
  budgets: readonly T[],
): Array<{ label: string; legs: T[] }> {
  const shared = budgets.filter((b) => b.branch === undefined);
  const labels = [
    ...new Set(
      budgets
        .map((b) => b.branch)
        .filter((b): b is string => typeof b === "string"),
    ),
  ];
  if (labels.length === 0) {
    return [{ label: "(single path)", legs: [...shared] }];
  }
  return labels.map((label) => ({
    label,
    legs: [...shared, ...budgets.filter((b) => b.branch === label)],
  }));
}

/** The declared ceiling as the DEPLOYMENT ADAPTER would read it, from disk. */
function readMaxDurationFromDisk(routePath: string): number {
  const abs = join(REPO, routePath);
  if (!existsSync(abs)) {
    throw new Error(
      `SEAM_ROUTE_BUDGETS names "${routePath}", which does not exist on disk. ` +
        `Either the route moved (update the table) or the entry is stale.`,
    );
  }
  const src = readFileSync(abs, "utf8");
  const m = MAX_DURATION_EXPORT.exec(src);
  if (!m) {
    throw new Error(
      `"${routePath}" has NO \`export const maxDuration = <n>\` statement. ` +
        `Every seam route must pin its function ceiling in-repo so the budget ` +
        `headroom invariant has a source of truth. Add the export (300) — do ` +
        `NOT relax this test to assume a platform value.`,
    );
  }
  return Number(m[1]);
}

describe("SEAM-02 — seam budget invariant (SC-4)", () => {
  it("scans every route declared in SEAM_ROUTE_BUDGETS (15 routes)", () => {
    // Guards against the table being silently emptied, which would make every
    // it.each below vacuous — zero cases is a passing suite.
    expect(ROUTE_ENTRIES.length).toBe(15);
  });

  it("SC-4d / D-10 — every route row's CONTENTS match the hand-typed map", () => {
    // A deep equality against a roster typed in this file, not a re-read of the
    // table. This is the only assertion here that can see a leg being DROPPED
    // from a multi-leg row: `finalize-wizard` losing its `process-key-enqueue`
    // entry halves that route's declared worst case, and SC-4a, SC-4b and the
    // length fence above all stay green under it.
    expect(
      SEAM_ROUTE_BUDGETS,
      "SEAM_ROUTE_BUDGETS no longer matches the hand-typed roster in this " +
        "file. A route was added or removed, a ceiling changed, or — the case " +
        "that motivated this assertion — a LEG was dropped from a multi-leg " +
        "row, silently halving that route's declared worst case. Update the " +
        "roster deliberately in the same commit; never delete this assertion " +
        "to make a diff pass.",
    ).toEqual(EXPECTED_ROUTE_BUDGETS);
  });

  describe("SC-4a — maxDuration is pinned on disk and matches the declaration", () => {
    it.each(ROUTE_ENTRIES)(
      "%s exports maxDuration matching expectedMaxDurationS",
      (routePath, entry) => {
        const onDisk = readMaxDurationFromDisk(routePath);
        expect(
          onDisk,
          `"${routePath}" exports maxDuration = ${onDisk} but SEAM_ROUTE_BUDGETS ` +
            `declares expectedMaxDurationS = ${entry.expectedMaxDurationS}. ` +
            `The route file and the budget table disagree about this route's ` +
            `function ceiling; fix whichever is wrong — never widen this test.`,
        ).toBe(entry.expectedMaxDurationS);
      },
    );
  });

  describe("SC-4b — summed budget PLUS store round trips fits inside the on-disk ceiling", () => {
    it.each(
      ROUTE_ENTRIES.flatMap(([routePath, entry]) =>
        BREAKER_STATES.map(
          (state) => [routePath, state, entry] as const,
        ),
      ),
    )(
      "%s — %s state: request budget + store round trips < maxDuration x 1000",
      (routePath, state, entry) => {
        // The ceiling is re-read from DISK rather than taken from the table,
        // so this assertion never compares the table against itself even if
        // SC-4a were removed. It is also the ONLY independent side now that the
        // store terms are read from the core alongside the budgets.
        const ceilingMs = readMaxDurationFromDisk(routePath) * 1000;

        // SUMMED within a branch, MAXIMISED across branches.
        //
        // Summed, not per-call: several routes make two sequential seam calls
        // and validate-and-encrypt nominally reaches three, so a per-entry
        // assertion would pass while the route's real worst case is double or
        // triple (140-RESEARCH §6.3). Maximised across branches, not summed:
        // finalize-wizard's composite and single-key branches are mutually
        // exclusive, and charging one request for both describes a path no
        // request takes (plan 140.2-10 / A-29).
        const perBranch = branchesOf(entry.budgets).map((branch) => {
          const requestMs = STATE_SPENDS_REQUEST_BUDGET[state]
            ? branch.legs.reduce(
                (acc, b) =>
                  acc +
                  SEAM_BUDGETS[b.key].timeoutMs *
                    b.calls *
                    (1 + SEAM_BUDGETS[b.key].retries),
                0,
              )
            : 0;
          // The breaker is consulted once per SEAM CALL, so the store cost
          // scales with the number of calls THIS BRANCH makes and not with the
          // number of distinct budget rows the route declares.
          const seamCalls = branch.legs.reduce((acc, b) => acc + b.calls, 0);
          const storeMs =
            STORE_COMMANDS_PER_SEAM_CALL[state] *
            STORE_COMMAND_WORST_CASE_MS *
            seamCalls;
          const spent = branch.legs
            .map(
              (b) =>
                `${b.key}x${b.calls}@${SEAM_BUDGETS[b.key].timeoutMs}ms` +
                `x(1+${SEAM_BUDGETS[b.key].retries})`,
            )
            .join(" + ");
          return {
            label: branch.label,
            requestMs,
            seamCalls,
            storeMs,
            worstCaseMs: requestMs + storeMs,
            spent,
          };
        });

        const worst = perBranch.reduce((a, b) =>
          b.worstCaseMs > a.worstCaseMs ? b : a,
        );
        const worstCaseMs = worst.worstCaseMs;

        expect(
          worstCaseMs,
          `"${routePath}" can spend ${worstCaseMs}ms in the ${state} state on ` +
            `its worst branch [${worst.label}] ` +
            `(request: ${worst.requestMs}ms = ${worst.spent}; store: ` +
            `${worst.storeMs}ms = ${STORE_COMMANDS_PER_SEAM_CALL[state]} ` +
            `command(s) x ${STORE_COMMAND_WORST_CASE_MS}ms x ` +
            `${worst.seamCalls} seam call(s)) ` +
            `against a ${ceilingMs}ms function ceiling. The lambda would be killed ` +
            `mid-request with no typed envelope. Lower a budget in SEAM_BUDGETS, ` +
            `LOWER A FAN-OUT CAP, TIGHTEN THE BREAKER STORE CONSTANTS, or raise ` +
            `this route's maxDuration AND expectedMaxDurationS together.`,
        ).toBeLessThan(ceilingMs);
      },
    );

    it("charges the store SOMETHING in every state — a zeroed term would assert nothing", () => {
      // The anti-vacuity fence for the three numbers above. If
      // `STORE_COMMANDS_PER_SEAM_CALL` were ever emptied or zeroed, every
      // assertion in this block would silently collapse back to the pre-plan
      // request-only arithmetic and stay green — the store cost excluded again,
      // exactly as it was when a six-attempt unbounded client sat inside a
      // "bounded" route. Both sides hand-typed.
      expect(STORE_COMMAND_WORST_CASE_MS).toBe(4_250);
      for (const state of BREAKER_STATES) {
        expect(
          STORE_COMMANDS_PER_SEAM_CALL[state],
          `The ${state} state charges no store round trips, so SC-4b no longer ` +
            `accounts for the breaker's own store in that state.`,
        ).toBeGreaterThanOrEqual(1);
      }
      // …and the FAILING state must cost strictly more than the closed one: it
      // is the state that adds the trip path's read and write.
      expect(STORE_COMMANDS_PER_SEAM_CALL.failing).toBeGreaterThan(
        STORE_COMMANDS_PER_SEAM_CALL.closed,
      );
    });
  });

  describe("SC-4e / SEAMCORE-10 — the composite fan-out cap is bound to its declaration", () => {
    it("declares keys-permissions x MAX_COMPOSITE_MEMBERS on the composite branch", () => {
      // THE CROSS-FILE LINK. The left side is read from the ROUTE FILE on disk;
      // the right side is the exported table. Neither is derived from the
      // other, so raising the cap without raising the declaration (ledger row
      // M47) reddens HERE — which matters because every other assertion in this
      // file would stay green under it: the table would simply keep describing
      // a smaller fan-out than the route can now issue, and SC-4b would keep
      // certifying headroom the route no longer has.
      const capOnDisk = readCompositeCapFromDisk();
      const composite = SEAM_ROUTE_BUDGETS[FINALIZE_WIZARD_ROUTE].budgets.filter(
        (b) => b.branch === "composite",
      );

      expect(
        composite.map((b) => b.key),
        "The composite branch of finalize-wizard must declare exactly the " +
          "per-member permissions probe. It returns through runLegacyFinalize, " +
          "whose enqueue is a Supabase RPC and NOT a seam call — declaring an " +
          "enqueue leg here would model the single-key path (A-29).",
      ).toEqual(["keys-permissions"]);

      expect(
        composite[0].calls,
        `The route caps its composite member read at ${capOnDisk} ` +
          `(MAX_COMPOSITE_MEMBERS, read from ${FINALIZE_WIZARD_ROUTE}), but ` +
          `SEAM_ROUTE_BUDGETS declares ${composite[0].calls} keys-permissions ` +
          `call(s) on that branch. The cap and the declaration are the SAME ` +
          `number by construction: the declaration is what SC-4b uses to prove ` +
          `the fan-out fits inside the function ceiling. Change both together, ` +
          `and re-check the headroom in this file's header.`,
      ).toBe(capOnDisk);
    });

    it("models finalize-wizard's two branches as MUTUALLY EXCLUSIVE", () => {
      // The anti-vacuity fence for the branch model. Deleting the `branch`
      // labels turns the MAX back into a SUM silently — the direction that
      // over-states, so no headroom assertion would notice on its own. The
      // roster is hand-typed here.
      const labels = [
        ...new Set(
          SEAM_ROUTE_BUDGETS[FINALIZE_WIZARD_ROUTE].budgets.map(
            (b) => b.branch,
          ),
        ),
      ];
      expect(
        labels.sort(),
        "finalize-wizard no longer declares two exclusive branches. Its " +
          "composite path (per-member probes, then runLegacyFinalize) and its " +
          "single-key path (one probe, then the process-key enqueue) cannot " +
          "both be spent by one request; a row that sums them describes a path " +
          "no request takes.",
      ).toEqual(["composite", "single-key"]);
    });

    it("exercises the branch MAX on at least one row — a table of single-path rows would not", () => {
      // Without this, `branchesOf` could be deleted and replaced by the old sum
      // and only the numbers above would notice. Hand-typed 1: exactly one row
      // is multi-branch today.
      const multiBranch = Object.entries(SEAM_ROUTE_BUDGETS).filter(
        ([, entry]) => branchesOf(entry.budgets).length > 1,
      );
      expect(multiBranch.map(([path]) => path)).toEqual([
        FINALIZE_WIZARD_ROUTE,
      ]);
      expect(branchesOf(SEAM_ROUTE_BUDGETS[FINALIZE_WIZARD_ROUTE].budgets)
        .length).toBe(2);
    });
  });

  describe("structural completeness", () => {
    it("documents at least the three known non-core seam call sites", () => {
      // An unexplained absence from SEAM_ROUTE_BUDGETS is indistinguishable
      // from an oversight — the third seam survived for months on exactly that
      // silence. Emptying the exclusions table must not be a quiet way to make
      // this file's other assertions easier to satisfy.
      expect(Object.keys(SEAM_EXCLUSIONS).length).toBeGreaterThanOrEqual(3);
    });

    it("excludes exactly the three hand-typed paths (SET equality, not count)", () => {
      // The `>= 3` assertion above cannot see a path being SWAPPED for another,
      // and the on-disk existence check below is satisfied by ANY real file. A
      // sorted SET equality against a roster typed in this file is what pins
      // WHICH paths are exempt — the two /health warmers must stay excluded
      // (their failures are the normal case and would trip the breaker during
      // routine warmup) and nothing else may quietly join them.
      expect(
        Object.keys(SEAM_EXCLUSIONS).sort(),
        "The SEAM_EXCLUSIONS path set drifted. An exclusion is a decision that " +
          "a Railway call site deliberately does NOT get a budget or a breaker; " +
          "adding one silently is exactly how the third, unbudgeted seam " +
          "survived for months. Pin the new path here in the same commit, with " +
          "its reason in the table.",
      ).toEqual([...EXPECTED_EXCLUSION_PATHS].sort());
    });

    it.each(Object.keys(SEAM_EXCLUSIONS))(
      "excluded path %s still exists on disk",
      (excludedPath) => {
        expect(
          existsSync(join(REPO, excludedPath)),
          `SEAM_EXCLUSIONS documents "${excludedPath}", which no longer exists. ` +
            `An exclusion pointing at a deleted file is stale documentation that ` +
            `makes the table less trustworthy than no table at all.`,
        ).toBe(true);
      },
    );

    it("gives every exclusion a non-empty reason", () => {
      for (const [path, reason] of Object.entries(SEAM_EXCLUSIONS)) {
        expect(reason.trim().length, `"${path}" has an empty reason`).toBeGreaterThan(
          0,
        );
      }
    });

    it("keeps both /health warmers in the exclusion table (membership, not equality)", () => {
      // See WARMER_EXCLUSION_PATHS: the set equality above cannot see a warmer
      // being dropped from the table AND from the roster in one commit, which
      // would silently narrow the reach of the source scan below.
      const missing = WARMER_EXCLUSION_PATHS.filter(
        (p) => !(p in SEAM_EXCLUSIONS),
      );
      expect(
        missing,
        `A /health warmer left SEAM_EXCLUSIONS: ${missing.join(", ")}. The ` +
          `exclusion row is not paperwork — it is what puts this warmer under ` +
          `the source scan that stops it entering the resilience core. Removing ` +
          `the row removes the guard, quietly, and the A-12 self-sustaining ` +
          `outage becomes reachable again (a cold /health failing is NORMAL, so ` +
          `a warmer inside the core trips the breaker, and the open breaker then ` +
          `blocks the very probe that would prove recovery).`,
      ).toEqual([]);
    });

    it.each(Object.keys(SEAM_EXCLUSIONS))(
      "excluded path %s does not enter the resilience core",
      (excludedPath) => {
        // A-12, mechanically. Before this assertion, adding a resilientFetch()
        // call inside a warmer reddened ZERO tests and ZERO lint rules: the
        // ESLint allowlist sets `no-raw-analytics-fetch` to "off" on both warmer
        // paths — which permits a raw fetch, it does not forbid the core — and
        // the contradiction check below fires only if the author ALSO adds the
        // path to SEAM_ROUTE_BUDGETS. SC6's warmer clause had no guard to
        // extend; this is it.
        const code = stripComments(
          readFileSync(join(REPO, excludedPath), "utf8"),
        );

        const reason =
          `An excluded path must not consume the core. For the two /health ` +
          `warmers the consequence is A-12: a cold probe failing is the NORMAL ` +
          `case, so routing one through the core feeds recordSeamFailure on ` +
          `every cold start, trips breaker:railway, and the open breaker then ` +
          `short-circuits the recovery probe — the mitigation becomes the ` +
          `outage. For debug-key-flow it is the bespoke client-abort SSE design ` +
          `the core does not model. If an exclusion genuinely belongs in the ` +
          `core, delete its row and give it a budget; never keep the row and ` +
          `call the core anyway.`;

        expect(
          /^\s*import[^\n]*resilient-fetch/m.test(code) ||
            /\bfrom\s+["'][^"']*resilient-fetch["']/.test(code),
          `"${excludedPath}" now imports the resilience core. ${reason}`,
        ).toBe(false);

        expect(
          /\bresilientFetch\s*\(/.test(code),
          `"${excludedPath}" now calls the resilience core. ${reason}`,
        ).toBe(false);
      },
    );

    it("never lists the same path as both budgeted and excluded", () => {
      const budgeted = new Set(Object.keys(SEAM_ROUTE_BUDGETS));
      const contradictions = Object.keys(SEAM_EXCLUSIONS).filter((p) =>
        budgeted.has(p),
      );
      expect(
        contradictions,
        `A path cannot both route through the core and be excluded from it: ${contradictions.join(", ")}`,
      ).toEqual([]);
    });
  });
});
