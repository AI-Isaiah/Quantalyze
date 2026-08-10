import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  // Phase 141 / SEAM-06 — the retry backoff constants. These ARE production
  // values (the sum a retried leg actually waits between attempts), so SC-4b
  // charges them rather than hand-typing the interval; the route CEILINGS stay
  // hand-typed / disk-read. Charge the MAX jitter (PATTERNS "No Analog": jitter
  // must remain stateable — bound it and charge the bound).
  SEAM_RETRY_BACKOFF_MS,
  SEAM_RETRY_JITTER_MAX_MS,
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
 *                        + Σ over that branch's budgets of
 *                            ( storeCommands(state) × (1 + row.retries)
 *                              × STORE_COMMAND_WORST_CASE_MS × calls )
 *                        )
 *
 * ⚠️ BOTH terms are summed PER LEG and both carry `(1 + row.retries)`. The store
 * term was flat until 141.1 / D-15 — see `STORE_COMMANDS_PER_SEAM_CALL`.
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
 * Where that leaves the numbers today, with one store command costing 4 250 ms.
 *
 * ⚠️ NOT every row is at `retries: 0` — that premise was true when this table
 * was written and stopped being true in Phase 141, which flipped FIVE rows to 1
 * (bridge, simulator, portfolio-optimizer, optimize-weights,
 * process-key-enqueue). The first two columns below are all-`retries: 0` routes;
 * `keys/sync` is the RETRIED case, so a reader sees a number that actually
 * exercises the (1 + retries) factors.
 *
 * ⭐ EVERY FIGURE BELOW WAS RE-DERIVED FROM A RUN of this file (plan 153.4-02),
 * not hand-computed and not copied from a research table. The `validate-and-
 * encrypt` column is now the MAX ACROSS ITS TWO VENUE BRANCHES, i.e. the
 * serialized one:
 *
 *   | state   | validate-and-encrypt (serialized-venue) | finalize-wizard (composite, 10) | keys/sync (1 call, retries 1) |
 *   |---------|-----------------------------------------|---------------------------------|-------------------------------|
 *   | closed  | 210 000 + 12 750 = 222 750 ms           | 150 000 +  42 500 = 192 500 ms  |  30 500 +  8 500 =  39 000 ms |
 *   | open    |           0 + 12 750 =  12 750 ms       |          0 +  42 500 =  42 500  |       0 +  4 250 =   4 250    |
 *   | failing | 210 000 + 38 250 = 248 250 ms           | 150 000 + 127 500 = 277 500 ms  |  30 500 + 25 500 =  56 000 ms |
 *
 * against a 300 000 ms ceiling.
 *
 * ⭐ THE VENUE BRANCHES IN FULL (plan 153.4-02 / WIZFORM-05 / D-01). Three
 * routes validate a key, and each declares two MUTUALLY EXCLUSIVE venue arms:
 * `default-venue` spends `validate-key` at 30 000 ms, `serialized-venue` spends
 * `validate-key-serialized` at 120 000 ms. One request carries one `exchange`
 * and `budgetKeyFor(exchange)` returns exactly one key for it, so a row that
 * SUMMED the arms would charge 90 000 ms of validation no request ever spends:
 *
 *   | route                             | branch           | closed  | open   | failing |
 *   |-----------------------------------|------------------|---------|--------|---------|
 *   | validate-and-encrypt              | serialized-venue | 222 750 | 12 750 | 248 250 |
 *   | validate-and-encrypt              | default-venue    | 132 750 | 12 750 | 158 250 |
 *   | create-with-key / composite/add-key | serialized-venue | 158 500 |  8 500 | 175 500 |
 *   | create-with-key / composite/add-key | default-venue    |  68 500 |  8 500 |  85 500 |
 *   | finalize-wizard                   | composite        | 192 500 | 42 500 | 277 500 |
 *   | finalize-wizard                   | single-key       |  58 250 |  8 500 |  83 750 |
 *
 * The retried column is where 141.1 / D-15's correction shows: `keys/sync`'s
 * FAILING store term is 3 commands × (1+1) rounds × 4 250 × 1 call = 25 500,
 * where this file used to charge a flat 12 750. Both ends of the correction are
 * pinned to hand-typed literals beside the anti-vacuity fence below — 56 000
 * for the retried worst case, and 277 500 for the composite, which the
 * correction must NOT move because every leg on that branch is `retries: 0`.
 * A THIRD literal oracle now pins the serialized venue arm at 248 250.
 *
 * ⭐ THE TIGHTEST CASE IN THE WHOLE TABLE IS STILL `finalize-wizard` FAILING at
 * 277 500 ms — **22 500 ms of headroom** — and the 120 000 ms serialized budget
 * did NOT take that title from it. The new worst case anywhere is
 * validate-and-encrypt's serialized branch at 248 250 ms, which leaves
 * **51 750 ms of headroom**: more than twice finalize-wizard's. Stated here
 * explicitly rather than left for the reader to recompute, because the previous
 * revision of this paragraph named the tightest row and a reader who trusts it
 * would otherwise have to re-derive six numbers to know it still holds.
 *
 * ⚠️ THE PARAGRAPH THIS ONE REPLACES CARRIED TWO FALSE CLAIMS, and BOTH were
 * already false before plan 153.4-02 — the correction is NOT a consequence of
 * this change, and must not be read as one. It made a single closed/open/failing
 * triple do duty for two different rows:
 *   - it attributed that triple to `create-with-key`, which never had those
 *     figures at all — they were finalize-wizard's SINGLE-KEY numbers restated
 *     under the wrong route name. create-with-key's default-venue arm is
 *     68 500 / 8 500 / 85 500.
 *   - and it called finalize-wizard's single-key branch "unchanged" at that same
 *     triple, which it stopped being when Phase 141 flipped
 *     `process-key-enqueue` to retries: 1. That leg alone now costs
 *     15 000 × (1+1) + 500 backoff, so the branch is 58 250 / 8 500 / 83 750.
 * Both are corrected in the branch table above, from the run. ⛔ The false triple
 * itself is deliberately NOT quoted here: this file's own doctrine (see the
 * marked-quotation note further down) is that a verbatim quotation of refuted
 * text is a historical record worth keeping — but nothing in this repo can tell
 * a quotation from a claim, so restating the numerals would leave the wrong
 * figures greppable in the very file that exists to stop wrong figures. Naming
 * the DEFECT instead of reprinting it keeps the record and empties the scanner.
 *
 * So this is no longer a comfortable guard for one route, and that is the point:
 * `MAX_COMPOSITE_MEMBERS` is 10 because 11 members would put the failing state
 * at 305 250 ms — a real breach, discovered here rather than in a killed lambda.
 * Its four real jobs are (a) to hold automatically when a row's retries is
 * raised — flipping `keys-permissions` to retries=1 would put finalize-wizard's
 * composite branch at 560 000 ms failing (305 000 request + 255 000 store) and
 * BREACH by a factor approaching two. That figure grew under 141.1 / D-15: the
 * old flat store term put the same hypothetical at 432 500 ms, so the
 * correction did not merely re-price today's table, it doubled the cost of the
 * row flip this clause exists to deter;
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
 * ⭐ THE CEILING PARAGRAPH THAT USED TO SIT HERE IS NOW FALSE, AND THE CHANGE
 * IS THE POINT OF PLAN 140.4-10. It read: "this file reads ONLY the fifteen
 * route files enumerated in `SEAM_ROUTE_BUDGETS` … It does NOT walk the import
 * graph, so it cannot notice a SIXTEENTH route that starts calling the seam
 * clients without being added to the table … A table-vs-import-graph
 * reconciliation walker is the stronger (unbuilt) version."
 *
 * IT IS BUILT. `SC-4f` at the bottom of this file walks `src/app/api` for the
 * IMPORT EDGE and compares the result to `Object.keys(SEAM_ROUTE_BUDGETS)` as a
 * sorted SET EQUALITY. It is the single highest-leverage line in the phase,
 * because the table is the population every other assertion here iterates: the
 * on-disk `maxDuration` parity, the SC-4b headroom arithmetic, the SC-4d row
 * contents and — since 140.4-10 — the membership of `SEAM_FILES` over in
 * `seam-log-coverage.test.ts` all read a route only if the table names it. A
 * route that consumed the seam WITHOUT being added to the table was previously
 * invisible to ALL of them at once.
 *
 * (140.5-04) That sentence used to name the next ORDINAL past the table's
 * length. ⚠️ It was REWORDED, not deleted-as-a-count — and the distinction is
 * the whole reason this note exists. The same token appears elsewhere in the
 * repo as a genuine COUNT of route tests, and the fix for those is to delete the
 * integer and name the predicate. This one never counted anything: it named a
 * HYPOTHETICAL route arriving beyond the roster. Deleting the integer as if it
 * were a count would have left a sentence that is simply FALSE — replacing one
 * false claim with another, inside the phase whose entire subject is not doing
 * that. It is now keyed to the PROPERTY (absence from the table), which is what
 * it always meant and which no roster edit can falsify.
 *
 * ⚠️ The token still appears ONCE above, inside the explicitly-quoted paragraph
 * marked "IS NOW FALSE" — 140.4's record of the reasoning it refuted. That is a
 * QUOTATION, not a claim, and editing it to satisfy a grep would falsify a
 * historical record to make a scanner happy. An absence check over this file
 * must therefore exclude marked quotations or be scoped to live claims; nothing
 * in this repo does that yet, and 140.5-04's SUMMARY names it as a residual.
 *
 * ⚠️ H-13's PREMISE WAS REFUTED INDEPENDENTLY BY TWO REVIEWERS, and the
 * correction is why this is one assertion rather than a work package. H-13
 * claimed "every guard derives its population from `/resilientFetch\s*\(/` or
 * the ESLint base-URL taint; a new route consuming an existing seam wrapper
 * matches neither." `SEAM_IMPORT_EDGE` matches ALL THREE wrapper modules, so a
 * route that only calls `computePortfolioAnalytics()` DOES match. The needle
 * existed and was already CI-wired in two files. What was missing was one set
 * comparison nobody had written.
 *
 * ⚠️ AND THE LENGTH FENCE ABOVE IT STAYS. `expect(ROUTE_ENTRIES.length).toBe(15)`
 * is NOT made redundant by the equality and deleting it "to avoid duplication"
 * would remove the thing that catches an emptied table — the state in which the
 * equality would compare two empties and agree. `resilient-fetch.wiring.test.ts`
 * keeps its floor beside its three equalities for exactly this reason.
 */

const REPO = process.cwd();

// ---------------------------------------------------------------------------
// 140.4-10 / SEAMRIM-06 — the seam route set, DERIVED FROM THE IMPORT EDGE.
//
// Duplicated (not imported) from `seam-poll-disjointness.pin.test.ts`, which
// states the reason at its own copy: "a test file must not import another test
// file, and two independent scanners that agree are worth more than one shared
// helper whose single bug blinds both tiers." This is the FOURTH copy in the
// repo and that is deliberate, not sloppy.
//
// The source is read RAW rather than comment-stripped, matching the owning
// file. `SEAM_IMPORT_EDGE` matches a quoted module specifier after `from`, a
// shape prose does not accidentally produce — and the two derivations were
// measured against each other at plan time: identical, 15 == 15, both
// difference directions empty.
// ---------------------------------------------------------------------------

/** The three modules through which every seam call in this repo is made. */
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;

/** Matches the IMPORT EDGE, never a bare mention — see the SSR pin for why. */
const SEAM_IMPORT_EDGE = new RegExp(
  `from\\s*["'](?:@/lib/|\\./|\\.\\./)?(?:lib/)?(?:${SEAM_MODULES.join("|")})["']`,
);

/**
 * Every `src/app/api/**​/route.ts` standing on the import edge, as a REPO-ROOT
 * RELATIVE PATH — the same key shape `SEAM_ROUTE_BUDGETS` uses, so the two sets
 * are directly comparable without either side being normalised into the other's
 * vocabulary.
 */
function deriveSeamRouteFiles(apiRoot: string): string[] {
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (entry.name !== "route.ts") continue;
      if (!SEAM_IMPORT_EDGE.test(readFileSync(join(REPO, rel), "utf8"))) continue;
      paths.push(rel);
    }
  };
  walk(apiRoot);
  return paths.sort();
}

/**
 * The two `SEAM_EXCLUSIONS` entries that are ROUTES (the third is a lib
 * module), hand-typed here.
 *
 * Asserted below as a POSITIVE FACT about why they are absent from the
 * derivation, NOT carried as an allow-list: neither imports the core, which is
 * the entire content of its exclusion row. `debug-key-flow` runs a bespoke
 * client-abort SSE design the core does not model; `cron/warm-analytics` is a
 * `/health` probe, and A-12 is why it may never enter the core — "a cold
 * `/health` probe failing IS the normal case", so routing one through the core
 * feeds `recordSeamFailure` on every cold start, trips the breaker, and the
 * open breaker then short-circuits the very probe whose success is the recovery
 * signal.
 *
 * If either one ever DID import the core, the equality below would already fail
 * by reporting it as an unbudgeted arrival. This assertion is what keeps that
 * reading unambiguous — the difference between "absent because it is exempt"
 * and "absent because it genuinely does not call the seam".
 */
const EXCLUDED_ROUTE_PATHS: string[] = [
  "src/app/api/debug-key-flow/route.ts",
  "src/app/api/cron/warm-analytics/route.ts",
];

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
 * Store commands ONE seam call issues PER ATTEMPT, per breaker state.
 * Hand-counted from `resilient-fetch.ts`, and each number is a claim about a
 * specific code path:
 *
 *   closed  — the pre-fetch `mget` in `isBreakerOpen`, and nothing else. ONE
 *             since plan 140.2-07 collapsed the `ttl` follow-up into the value.
 *   open    — the same single `mget`; the call then throws `CircuitOpenError`
 *             and never reaches `fetch`, so no REQUEST budget is spent at all.
 *   failing — that `mget`, plus the trip path's `get` (the A-25 guard reading
 *             when the last lock was armed) and its `set`.
 *
 * ⚠️ PER ATTEMPT, NOT PER CALL — 141.1 / D-15, AND THIS IS THE RETURN VISIT THE
 * WARNING BELOW ASKED FOR. The note further down says "a future edit that adds a
 * store round trip to the failing path has to come back here". PHASE 141 WAS
 * THAT EDIT: it gave five budget rows `retries: 1`, and a retried call issues the
 * whole store round a SECOND time — the pre-attempt-2 `isBreakerOpen` mget, plus
 * attempt 2's own trip `get`/`set` when it also fails. So a retried FAILING leg
 * really does cost six commands. 141 did not come back here, and SC-4b
 * under-charged every retried leg by 12 750 ms in the unsafe direction for a
 * whole phase.
 *
 * ⚠️ THE FIX IS THE `(1 + retries)` FACTOR IN THE PER-LEG STORE TERM, NOT A 6
 * HERE. Raising `failing` to 6 would double-charge every leg that does NOT
 * retry: finalize-wizard's composite branch (10 legs, all `retries: 0`) would
 * compute 405 000 ms against a 300 000 ms ceiling and RED on a route that never
 * performs a second attempt. Keep these three PER-ATTEMPT; the retry term
 * belongs on the leg, because `retries` is a property of a leg's budget row.
 * A hand-typed 277 500 ms pin fences exactly that mistake.
 *
 * ⚠️ THREE IS A CEILING THIS ARITHMETIC ENFORCES, NOT AN OBSERVATION. HI-01
 * closed the tombstone-branch race, and the FIRST shape of that fix — claim a
 * per-generation key with `SET NX`, then write — added a fourth command. Raising
 * this number to 4 made SC-4b RED: finalize-wizard's composite branch went to
 * 320 000 ms against a 300 000 ms function ceiling. That is what sent the fix to
 * `SET ... GET`, which is ONE command. So a future edit that adds a store round
 * trip to the failing path has to come back here, and will discover the same
 * wall rather than silently spending headroom this file certifies.
 *
 * The FAILING figure stays deliberately pessimistic in one respect: the trip
 * path runs once per `BREAKER_FAILURE_THRESHOLD` failures, not on every failure,
 * and the limiter's default in-memory `ephemeralCache` can short-circuit some
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
  // 153.4-02 / WIZFORM-05 — the three validate routes each declare TWO
  // mutually exclusive VENUE branches. `default-venue` is the incumbent
  // 30 000 ms row; `serialized-venue` is `validate-key-serialized` at
  // 120 000 ms, taken only when `venueIsSerialized(exchange)` is true. The
  // `encrypt-key` (and dormant) legs carry NO label: they are spent whichever
  // arm the request took, so they are charged to BOTH branches.
  "src/app/api/keys/validate-and-encrypt/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
      { key: "encrypt-key", calls: 1 },
      { key: "process-key-unified-dormant", calls: 1 },
    ],
  },
  "src/app/api/strategies/create-with-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
      { key: "encrypt-key", calls: 1 },
    ],
  },
  "src/app/api/strategies/composite/add-key/route.ts": {
    expectedMaxDurationS: 300,
    budgets: [
      { key: "validate-key", calls: 1, branch: "default-venue" },
      { key: "validate-key-serialized", calls: 1, branch: "serialized-venue" },
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

/**
 * SC-4b's arithmetic for one route, per mutually exclusive branch.
 *
 * Extracted from the `it.each` below so the hand-typed worst-case oracles can
 * exercise THE SAME code path the ceiling assertion does. The oracles compare
 * its output against literals typed by hand; nothing here derives an expected
 * value from anything, which is the distinction that keeps them honest
 * (a money-math oracle that recomputes the implementation's own formula pins
 * nothing — this repo has paid for that three times).
 */
function branchWorstCases(
  entry: (typeof SEAM_ROUTE_BUDGETS)[string],
  state: string,
) {
  return branchesOf(entry.budgets).map((branch) => {
    const requestMs = STATE_SPENDS_REQUEST_BUDGET[state]
      ? branch.legs.reduce(
          (acc, b) =>
            acc +
            // The attempts: each retry re-spends the whole per-attempt
            // deadline (Design A — timeoutMs x (1 + retries)).
            SEAM_BUDGETS[b.key].timeoutMs *
              b.calls *
              (1 + SEAM_BUDGETS[b.key].retries) +
            // Phase 141 / SEAM-06 — the backoff BETWEEN attempts, charged at
            // its MAX (fixed backoff + max jitter). Zero when retries=0, so
            // every non-flipped row's term vanishes exactly as before.
            SEAM_BUDGETS[b.key].retries *
              b.calls *
              (SEAM_RETRY_BACKOFF_MS + SEAM_RETRY_JITTER_MAX_MS),
          0,
        )
      : 0;
    // The breaker is consulted once per SEAM CALL, so the store cost
    // scales with the number of calls THIS BRANCH makes and not with the
    // number of distinct budget rows the route declares.
    const seamCalls = branch.legs.reduce((acc, b) => acc + b.calls, 0);
    // Phase 141.1 / D-15 — CHARGED PER LEG, inside the same reduce as the
    // request term, because `retries` is a property of a LEG's budget row and a
    // multi-leg branch has no single value a route-level multiplier could use.
    // A RETRIED leg issues the store round a SECOND time: the pre-attempt-2
    // `isBreakerOpen` mget, plus attempt 2's own trip get/set when it also
    // fails. Zero-extra when retries=0, so every non-flipped leg's term is
    // exactly what it was before — which is why finalize-wizard's composite
    // branch does not move.
    //
    // The STATE_SPENDS_REQUEST_BUDGET conjunct is load-bearing: in the `open`
    // state the call throws CircuitOpenError before `fetch`, so there is no
    // second attempt and no second store round to charge.
    const storeMs = branch.legs.reduce(
      (acc, b) =>
        acc +
        STORE_COMMANDS_PER_SEAM_CALL[state] *
          (1 +
            (STATE_SPENDS_REQUEST_BUDGET[state]
              ? SEAM_BUDGETS[b.key].retries
              : 0)) *
          STORE_COMMAND_WORST_CASE_MS *
          b.calls,
      0,
    );
    const spent = branch.legs
      .map(
        (b) =>
          `${b.key}x${b.calls}@${SEAM_BUDGETS[b.key].timeoutMs}ms` +
          `x(1+${SEAM_BUDGETS[b.key].retries})` +
          `+${SEAM_BUDGETS[b.key].retries}x${b.calls}x${SEAM_RETRY_BACKOFF_MS + SEAM_RETRY_JITTER_MAX_MS}ms backoff`,
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
}

/** The worst branch of a route in a given state — what SC-4b actually charges. */
function worstBranch(
  entry: (typeof SEAM_ROUTE_BUDGETS)[string],
  state: string,
) {
  return branchWorstCases(entry, state).reduce((a, b) =>
    b.worstCaseMs > a.worstCaseMs ? b : a,
  );
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
        const worst = worstBranch(entry, state);
        const worstCaseMs = worst.worstCaseMs;

        expect(
          worstCaseMs,
          `"${routePath}" can spend ${worstCaseMs}ms in the ${state} state on ` +
            `its worst branch [${worst.label}] ` +
            `(request: ${worst.requestMs}ms = ${worst.spent}; store: ` +
            `${worst.storeMs}ms = ${STORE_COMMANDS_PER_SEAM_CALL[state]} ` +
            `command(s)/attempt x ${STORE_COMMAND_WORST_CASE_MS}ms x ` +
            `${worst.seamCalls} seam call(s), charged per leg at (1+retries)) ` +
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

    it("D-15: the RETRIED worst case is 56 000ms — keys/sync, failing, hand-typed", () => {
      // ⭐ THE ORACLE IS A LITERAL, NOT THE FORMULA. 56 000 is hand-computed from
      // the tables and typed here: 15 000ms x 1 call x (1+1 retry) = 30 000, plus
      // one 500ms max backoff = 30 500 request, plus 3 commands x (1+1) rounds x
      // 4 250ms x 1 call = 25 500 store. Deriving it from the arithmetic under
      // test would pin nothing at all — this repo has shipped three money-math
      // bugs through six review passes on self-referential oracles.
      //
      // WHAT IT CATCHES. Before 141.1 the store term was NOT multiplied by
      // (1 + retries) though the request term was, so a retried leg's SECOND
      // breaker-store round — the pre-attempt-2 `isBreakerOpen` mget, plus
      // attempt 2's own trip get/set — was never charged. That is a 12 750ms
      // under-charge per retried leg in the UNSAFE direction, and this route is
      // where it is largest. Delete the (1 + retries) factor and this computes
      // 43 250.
      const worst = worstBranch(
        SEAM_ROUTE_BUDGETS["src/app/api/keys/sync/route.ts"],
        "failing",
      );
      expect(
        worst.worstCaseMs,
        `keys/sync's failing-state worst case is now ${worst.worstCaseMs}ms; ` +
          `the hand-computed figure is 56 000ms (30 500 request + 25 500 store). ` +
          `A LOWER number means the retried leg's second store round stopped ` +
          `being charged and SC-4b is certifying headroom the route does not ` +
          `have. A HIGHER one means a budget, a retry count or a store constant ` +
          `moved. Recompute by hand from SEAM_BUDGETS and the store constants, ` +
          `and change this literal only because the inputs changed — never to ` +
          `make a diff pass.`,
      ).toBe(56_000);
    });

    it("D-15: finalize-wizard's composite is UNCHANGED at 277 500ms — the anti-shortcut pin", () => {
      // ⚠️ THIS IS THE FENCE AROUND THE TWO WRONG FIXES, and it is the reason a
      // second oracle exists at all. Every leg on this branch is retries: 0, so
      // the correction must leave it exactly where it was:
      //
      //   15 000ms x 10 calls x (1+0) = 150 000 request
      //   3 commands x (1+0) rounds x 4 250ms x 10 calls = 127 500 store
      //
      //   WRONG FIX A — raise STORE_COMMANDS_PER_SEAM_CALL.failing from 3 to 6
      //   ("a retried failing call issues six commands"). True per RETRIED call,
      //   but it double-charges every NON-retried leg: this branch would compute
      //   405 000ms and RED against a 300 000ms ceiling — a phantom breach on a
      //   route that never retries. The (1 + retries) factor is where the retry
      //   term belongs; the 3 stays 3 and is documented PER-ATTEMPT.
      //
      //   WRONG FIX B — a flat route-level (1 + retries) multiplier. `retries` is
      //   a property of a LEG's budget row, so a multi-leg branch has no single
      //   value to use, and picking one manufactures a breach here too.
      //
      // The tightest route in the whole table is this one at 22 500ms of
      // headroom, so a phantom breach here is not a harmless over-estimate — it
      // is the assertion that would be "fixed" by raising a ceiling.
      const worst = branchWorstCases(
        SEAM_ROUTE_BUDGETS[FINALIZE_WIZARD_ROUTE],
        "failing",
      ).find((b) => b.label === "composite");
      expect(
        worst?.worstCaseMs,
        `finalize-wizard's COMPOSITE branch now costs ${worst?.worstCaseMs}ms ` +
          `in the failing state; it must stay 277 500ms. Every leg on this ` +
          `branch is retries: 0, so D-15's correction cannot move it. 405 000 ` +
          `means the store's per-attempt count was raised instead of the retry ` +
          `factor being applied per leg, which double-charges legs that never ` +
          `retry. This route has 22 500ms of headroom — do NOT raise its ` +
          `maxDuration to absorb an arithmetic error.`,
      ).toBe(277_500);
    });

    it("153.4-02: the SERIALIZED venue branch is 248 250ms — validate-and-encrypt, failing, hand-typed", () => {
      // ⭐ THE ORACLE IS A LITERAL, NOT THE FORMULA. 248 250 is hand-computed
      // from the tables and typed here, exactly as the two oracles above are:
      //
      //   request: 120 000 (validate-key-serialized) + 30 000 (encrypt-key)
      //            + 60 000 (process-key-unified-dormant) = 210 000
      //            — every leg on this branch is retries: 0, so there is no
      //              (1 + retries) multiplier and no backoff term
      //   store:   3 legs x 3 commands x (1+0) rounds x 4 250ms x 1 call
      //            = 38 250
      //   total:   248 250
      //
      // Deriving it from `SEAM_BUDGETS` inside this test would restate the
      // arithmetic under test and pin nothing — this repo has shipped three
      // money-math bugs through six review passes on self-referential oracles.
      //
      // WHAT A MOVEMENT MEANS. A LOWER number means a leg stopped being charged
      // on this branch: the likeliest cause is the `serialized-venue` label
      // being deleted or moved onto the shared `encrypt-key` leg, which would
      // drop a real cost SC-4b is supposed to bound. A HIGHER number means a
      // budget row or a store constant moved — most plausibly the 120 000ms
      // serialized budget, whose A-25 coupling to BREAKER_LOCK_TOMBSTONE_S is
      // already at TIGHT EQUALITY (plan 153.4-01), so raising it is never a
      // one-line change. This branch is the WORST case anywhere in the table
      // and it has 51 750ms of headroom against the 300 000ms ceiling.
      const worst = branchWorstCases(
        SEAM_ROUTE_BUDGETS["src/app/api/keys/validate-and-encrypt/route.ts"],
        "failing",
      ).find((b) => b.label === "serialized-venue");
      expect(
        worst?.worstCaseMs,
        `validate-and-encrypt's SERIALIZED-VENUE branch now costs ` +
          `${worst?.worstCaseMs}ms in the failing state; the hand-computed ` +
          `figure is 248 250ms (210 000 request + 38 250 store). Recompute by ` +
          `hand from SEAM_BUDGETS and the store constants, and change this ` +
          `literal only because the inputs changed — never to make a diff pass. ` +
          `An \`undefined\` here means the branch LABEL is gone, which turns ` +
          `SC-4b's MAX back into a SUM silently.`,
      ).toBe(248_250);
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
      // and only the numbers above would notice. Hand-typed 4: exactly four
      // rows are multi-branch today — the three validate routes, each with its
      // `default-venue` / `serialized-venue` pair (153.4-02), plus
      // finalize-wizard's `composite` / `single-key` pair (140.2-10).
      //
      // ⛔ NOT a `.length` check. A length is green under a SWAP — one route
      // losing its labels while another gains a spurious pair reads as four
      // either way, and the direction that matters (labels DELETED, so the MAX
      // silently becomes a SUM) over-states the worst case, which no headroom
      // assertion can notice. The expected array is compared with `toEqual`, so
      // ORDER is load-bearing and follows declaration order in
      // SEAM_ROUTE_BUDGETS.
      const multiBranch = Object.entries(SEAM_ROUTE_BUDGETS).filter(
        ([, entry]) => branchesOf(entry.budgets).length > 1,
      );
      expect(
        multiBranch.map(([path]) => path),
        "The multi-branch roster changed. A route DROPPING out of this list " +
          "means its `branch` labels were deleted and SC-4b silently went back " +
          "to summing legs from paths no single request takes; a route " +
          "APPEARING means a new exclusive fan-out was declared and its " +
          "headroom has not been re-derived. Update this roster deliberately " +
          "in the same commit, and re-run the header table's figures.",
      ).toEqual([
        "src/app/api/keys/validate-and-encrypt/route.ts",
        "src/app/api/strategies/create-with-key/route.ts",
        "src/app/api/strategies/composite/add-key/route.ts",
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

    it("SEAM_EXCLUSIONS holds exactly 3 rows — the fence for both it.each blocks (D-14a)", () => {
      // CLASS-γ CLOSURE. Both `it.each(Object.keys(SEAM_EXCLUSIONS))` blocks in
      // this describe iterate the map UNDER TEST, so shrinking the table shrinks
      // the case list instead of failing it, and emptying it yields zero cases
      // and a green file: BLIND, not satisfied. Plan 141.1-04 measured that exact
      // shape on the sibling registry `it.each` — deleting one entry took the
      // suite from 78 tests to 77 with no failure from the `it.each` itself.
      //
      // ⚠️ HONEST SCOPE, so nobody over-credits this line. Unlike that sibling,
      // these two blocks were NOT actually exposed: the set equality at
      // "excludes exactly the three hand-typed paths" already reds on a shrink,
      // a swap OR a growth, and is strictly stronger than any count. What this
      // adds is EXACTNESS where only a `>= 3` floor sat, and CO-LOCATION — the
      // guard beside the `it.each` no longer depends on a sibling `it` surviving
      // a future edit. It is the third member of the enumerated class, fenced
      // for the same reason the other two are: the class is closed by
      // enumeration, not by fixing the one instance someone happened to name.
      expect(
        Object.keys(SEAM_EXCLUSIONS).length,
        "SEAM_EXCLUSIONS no longer holds exactly 3 rows. An exclusion is a " +
          "decision that a Railway call site deliberately gets no budget and no " +
          "breaker — adding one silently is how the third, unbudgeted seam " +
          "survived for months, and REMOVING one silently drops that path out " +
          "of both source scans below, which is the A-12 guard's entire reach. " +
          "Change this literal in the same commit as the row and its roster " +
          "entry; never to make a diff pass.",
      ).toBe(3);
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

  describe("SC-4f / SEAMRIM-06 — the table describes exactly the routes on the import edge", () => {
    it("the WALK finds seam routes at all (fail-loud on a vacuous discovery)", () => {
      // ⚠️ THE FENCE GOES BESIDE THE EQUALITY, NEVER INSTEAD OF IT. A walk that
      // matched nothing and a table that had been emptied would agree with each
      // other perfectly — two empty sets are equal — and this file would report
      // that the seam is fully described while describing nothing. The `.toBe(15)`
      // fence above catches the emptied TABLE; this one catches the blind WALK.
      // Neither implies the other.
      //
      // The floor is 10 against a measured 15, so a deliberate route deletion
      // does not redden the wrong assertion.
      expect(
        deriveSeamRouteFiles("src/app/api").length,
        "the import-edge walk over src/app/api found (almost) no seam routes. " +
          "The directory moved, a seam module was renamed, or SEAM_IMPORT_EDGE " +
          "stopped matching — this assertion is now BLIND, NOT SATISFIED. Fix " +
          "the walk; never lower this floor.",
      ).toBeGreaterThanOrEqual(10);
    });

    it("the DERIVED seam route set EQUALS Object.keys(SEAM_ROUTE_BUDGETS)", () => {
      // ⭐ THE ONE ASSERTION THE MIDDLE TIER WAS MISSING. Everything else in
      // this file iterates ROUTE_ENTRIES, so a route that reaches the seam
      // without a row is invisible to all of it at once; and `.toBe(15)` pins a
      // COUNT against a literal with NO DISK TERM AT ALL, so a route added to
      // the table with the literal bumped from 15 to 16 passes.
      //
      // ZERO SLACK AND NO ALLOW-LIST, because the two sets are set-identical
      // today (measured 15 == 15, both difference directions empty). An
      // equality is what makes BOTH directions loud; a superset check or a
      // `toHaveLength` sees neither a stale row nor — the harder case — a route
      // that quietly LEAVES the edge.
      //
      // ⚠️ ORACLE INDEPENDENCE. This is a from-disk derivation compared to
      // `SEAM_ROUTE_BUDGETS`, which is NOT a second derivation: it is a
      // hand-maintained production table in `resilient-fetch.ts`. So this is
      // derivation-vs-hand-typed, the intended shape. (The `SEAM_FILES` half in
      // `seam-log-coverage.test.ts` answers the same hazard by keeping
      // `EXPECTED_SEAM_FILES` hand-typed BESIDE its derivation.) Between the
      // two files there are three independent statements — the disk, this
      // table, and that roster — which must all agree. NEVER resolve a
      // disagreement by deriving one of them from another.
      const derived = deriveSeamRouteFiles("src/app/api");
      const declared = Object.keys(SEAM_ROUTE_BUDGETS).sort();
      const missing = derived.filter((p) => !declared.includes(p));
      const stale = declared.filter((p) => !derived.includes(p));

      expect(
        derived,
        `SEAM_ROUTE_BUDGETS no longer describes exactly the routes that import ` +
          `the seam. MISSING ROW(S) — on the import edge, absent from the ` +
          `table: ${missing.join(", ") || "none"}. STALE ROW(S) — in the table, ` +
          `no longer on the edge: ${stale.join(", ") || "none"}. ` +
          `\n\nA MISSING row means a route calls the seam with NO timeout ` +
          `budget, NO breaker accounting and NO maxDuration headroom check, and ` +
          `every other assertion in this file stays green because they all ` +
          `iterate the table. Add the budget row DELIBERATELY, in the same ` +
          `commit — with its legs, its expectedMaxDurationS, and a re-check of ` +
          `the headroom table in this file's header. ` +
          `\n\nA STALE row means a route stopped calling the seam; delete the ` +
          `row and its EXPECTED_ROUTE_BUDGETS twin together. ` +
          `\n\nNever widen this assertion, and never add an allow-list to it: ` +
          `the two sets are identical today, so any slack introduced here is ` +
          `slack nobody measured.`,
      ).toEqual(declared);
    });

    it("the two EXCLUDED routes are absent from the derivation — because they do not import the core", () => {
      // A POSITIVE FACT, not an allow-list. The equality above passes today
      // WITHOUT either of these paths being special-cased anywhere, and this
      // assertion is what states WHY: they are raw-fetch by design. A-12 is the
      // reason for the warmer — a cold `/health` probe failing IS the normal
      // case, so a warmer inside the core would trip the breaker on every cold
      // start and the open breaker would then block the recovery probe.
      //
      // If one of them ever acquired a seam import, the equality above would
      // redden by reporting it as a MISSING row — and this assertion would
      // redden too, which is the signal that the correct fix is to reconsider
      // the exclusion rather than to add a budget row.
      const derived = deriveSeamRouteFiles("src/app/api");
      const leaked = EXCLUDED_ROUTE_PATHS.filter((p) => derived.includes(p));
      expect(
        leaked,
        `A documented SEAM_EXCLUSIONS route now stands on the seam import ` +
          `edge: ${leaked.join(", ")}. These two are excluded because they do ` +
          `NOT enter the core: debug-key-flow runs a bespoke client-abort SSE ` +
          `design the core does not model, and cron/warm-analytics is a ` +
          `/health probe whose FAILURE is the normal case (A-12 — routing it ` +
          `through the core trips breaker:railway on every cold start, and the ` +
          `open breaker then short-circuits the very probe that proves ` +
          `recovery). Do not resolve this by giving it a budget row; resolve it ` +
          `by removing the import.`,
      ).toEqual([]);
      // The positive counterpart: this assertion must be looking at real paths.
      // Two `existsSync` misses would also produce "not derived".
      for (const p of EXCLUDED_ROUTE_PATHS) {
        expect(existsSync(join(REPO, p)), `${p} no longer exists`).toBe(true);
      }
    });
  });
});
