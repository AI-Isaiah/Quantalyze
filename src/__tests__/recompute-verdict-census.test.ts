/**
 * Phase 237 plan 11 (FACTSHEETHONEST, FACT-02, ROADMAP SC-2) - the census of every
 * reader of the recompute verdict.
 *
 * THE PROPERTY. CONTEXT FACT-02: "A census test lists every reader of the recompute verdict
 * with a classification, and fails when a new reader is added unclassified (SC-2)." The verdict
 * is the answer to "is this strategy's analytics row a terminal success, a re-run over a stored
 * success, or neither". Before this file, six surfaces each kept their own answer and the
 * drift between them was the defect. Now a new file that asks the question, or a new call in a
 * file that already does, cannot ship until someone classifies it on purpose.
 *
 * ORACLE INDEPENDENCE. The symbol list, the literal patterns, the class set, the CENSUS map, the
 * surface ledger and the retired list are typed here. The only production import is
 * `stripCommentsPreserveLines`. A drift in a production constant therefore fails here instead of
 * passing against itself.
 *
 * HOW A FILE IS READ. Every non-test `.ts` and `.tsx` file under `src/` is comment-stripped
 * before anything is counted, because the docblocks in `queries.ts` and elsewhere name the
 * deleted functions and the verdict predicates in prose. A count taken without stripping is not
 * a count. String contents survive the strip on purpose (the same contract the figure-gate
 * census uses).
 *
 * THE KEY. `file::symbol` with an exact count, never a per-file allowance: `queries.ts` alone
 * reads the verdict through five symbols, so a per-file entry would let a sixth reader through.
 * A count change fails with both counts; a classified pair the walk no longer finds fails as
 * stale; an unclassified pair fails naming the file, the symbol, the found count and the legal
 * classes. A class is one of a closed set, and the census is never satisfied by widening a
 * class: it is satisfied by classifying the new reader on purpose.
 *
 * ONE CLASS PER PAIR. Where one (file, symbol) pair carries two roles, the reason says so and
 * the exact count pins both (`queries.ts::isRankableAnalyticsRow` and
 * `strategy-review/route.ts::hasStoredAnalyticsResult` are the two such pairs). Adding a third
 * call to either changes the count and fails.
 *
 * THE LEDGER. The founder's FACT-02 surfaces are asserted mechanically against the stripped
 * source (SURFACES), the retired surfaces by zero word-bounded occurrences (RETIRED), and the
 * portfolio PDF page by the absence of four imports. `getFactsheetDetail` is census-only (phase
 * agent ruling 4: classification, no select widening) and the composite approval 409 is a
 * write-gate (the founder ruled FACT-02 (c) out).
 *
 * ANTI-VACUITY. The walk is above a recorded floor, so is the count of classified pairs, every
 * ledger anchor is walked, and planted self-tests over a temp directory prove an unclassified
 * reader fails, a comment-only mention does not count, a stale entry fails, a count change
 * fails and a planted retired symbol fails.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const ROOTS = ["src"] as const;

/** The verdict readers, scanned as `name(` (word-bounded, so `useAnalyticsHold(` is not one). */
const CALL_SYMBOLS = [
  "isComputedAnalytics",
  "isRankableAnalyticsRow",
  "isRecomputeOverStoredResult",
  "hasStoredAnalyticsResult",
  "hasUnboundDerivePrestamp",
  "isStoredResultReadable",
  "storedCashHeadlineGate",
  "usesLastSuccessSnapshot",
  "effectiveDataQualityFlags",
  "analyticsHold",
] as const;

/**
 * The two success literals, compared in both operators and both operand orders. SI-01
 * (`complete-status-scan.test.ts`) sees only the `===` form of the first; both PDF doors used
 * `!==` and were invisible to it.
 */
const LITERALS = ["complete", "complete_with_warnings"] as const;
const OPERATORS = ["===", "!=="] as const;

const LEGAL_CLASSES = [
  "owner",
  "holds",
  "progress-terminal",
  "percentile-cohort",
  "write-gate",
  "other-table",
  "definition",
] as const;
type Klass = (typeof LEGAL_CLASSES)[number];

interface Entry {
  count: number;
  class: Klass;
  reason: string;
}

/** The compiled scanners: one entry per symbol key, in a stable order. */
const SCANNERS: ReadonlyArray<{ symbol: string; re: RegExp }> = [
  ...CALL_SYMBOLS.map((s) => ({ symbol: s, re: new RegExp(`\\b${s}\\s*\\(`, "g") })),
  ...LITERALS.flatMap((lit) =>
    OPERATORS.map((op) => ({
      symbol: `${op} "${lit}"`,
      re: new RegExp(`${op}\\s*["']${lit}["']|["']${lit}["']\\s*${op}`, "g"),
    })),
  ),
];

// ---------------------------------------------------------------------------
// THE CENSUS. One row per (file, symbol) the walk finds. Classes:
//   owner             derives the verdict for a surface (the resolve stage, shapeRowAnalytics,
//                     the shared hold verdict)
//   holds             applies the verdict (a surface that follows the factsheet)
//   progress-terminal a "run ended" consumer that must keep reading terminal success
//   percentile-cohort a cohort filter: displayed rows are kept OUT of every percentile cohort
//   write-gate        gates a WRITE or a report, never a display
//   other-table       a different table or machine (portfolio_analytics, sync, verification)
//   definition        the function definition (plus its own internal calls)
// ---------------------------------------------------------------------------
const CENSUS: Record<string, Entry> = {
  // --- owner: the factsheet resolve stage, shapeRowAnalytics, headline-basis, the hold verdict
  "src/lib/factsheet/fetch-and-build-payload.ts::isComputedAnalytics": { count: 2, class: "owner", reason: "Phase 190 plan 03 resolve stage: refusal 1 (not terminal and not updating) and refusal 2 (D-04 unbound prestamp on a terminal row)" },
  "src/lib/factsheet/fetch-and-build-payload.ts::isRecomputeOverStoredResult": { count: 1, class: "owner", reason: "Phase 190 D-02 resolve stage: the held-re-run term" },
  "src/lib/factsheet/fetch-and-build-payload.ts::hasStoredAnalyticsResult": { count: 1, class: "owner", reason: "Phase 190 D-02 resolve stage: the stored-evidence rule that feeds the held-re-run term" },
  "src/lib/factsheet/fetch-and-build-payload.ts::hasUnboundDerivePrestamp": { count: 1, class: "owner", reason: "Phase 190 D-04 resolve stage: refusal 2, a terminal row whose derive prestamp bound no snapshot" },
  "src/lib/factsheet/fetch-and-build-payload.ts::effectiveDataQualityFlags": { count: 1, class: "owner", reason: "Phase 190 resolve stage: reads the effective flags (live, or the last-success snapshot) the verdict and the composite refusal rest on" },
  "src/lib/factsheet/headline-basis.ts::isComputedAnalytics": { count: 1, class: "owner", reason: "Phase 190 plan 03: the body of isStoredResultReadable, the one 'stored numbers may be read' composition for the basis headline" },
  "src/lib/factsheet/headline-basis.ts::isRecomputeOverStoredResult": { count: 1, class: "owner", reason: "Phase 190 plan 03: the held-re-run half of isStoredResultReadable" },
  "src/lib/factsheet/composite-read-path.ts::isComputedAnalytics": { count: 2, class: "owner", reason: "factsheet read path: shouldReadCashSettlementSeries and shouldReadSingleKeyCashSeries are terminal-success pre-gates for a stored cash series; measured 237-11: no non-test caller of either at HEAD (only their docblocks name a future 'first caller'), so no live surface reads them; not a FACT-02 surface" },
  "src/lib/queries.ts::isRecomputeOverStoredResult": { count: 1, class: "owner", reason: "Phase 190 D-02, D-05 shapeRowAnalytics: decided once for every list row, flags analytics_updating" },
  "src/lib/queries.ts::hasStoredAnalyticsResult": { count: 1, class: "owner", reason: "Phase 190 D-02 shapeRowAnalytics: the evidence rule paired with isRecomputeOverStoredResult" },
  "src/lib/queries.ts::usesLastSuccessSnapshot": { count: 1, class: "owner", reason: "Phase 190 shapeStoredAnalytics: a held row reads its figures from the last-success snapshot, with the effective flags" },
  "src/lib/queries.ts::effectiveDataQualityFlags": { count: 3, class: "owner", reason: "Phase 190 shapeStoredAnalytics: the snapshot's own flags when the live row is held; 237 WR-01 adds the book composer's unit probe and curve flags (the stored numbers' flags)" },
  "src/lib/analytics-hold.ts::isComputedAnalytics": { count: 1, class: "owner", reason: "Phase 237 plan 01: analyticsHold restates refusal 1 of the resolve stage for the surfaces that cannot call it" },
  "src/lib/analytics-hold.ts::isRecomputeOverStoredResult": { count: 1, class: "owner", reason: "Phase 237 plan 01: analyticsHold restates the held-re-run term of the resolve stage" },
  "src/lib/analytics-hold.ts::hasStoredAnalyticsResult": { count: 1, class: "owner", reason: "Phase 237 plan 01: analyticsHold restates the evidence rule of the resolve stage" },
  "src/lib/analytics-hold.ts::hasUnboundDerivePrestamp": { count: 1, class: "owner", reason: "Phase 237 plan 01: analyticsHold restates refusal 2 (D-04) of the resolve stage" },
  "src/lib/analytics-hold.ts::effectiveDataQualityFlags": { count: 1, class: "owner", reason: "Phase 237 plan 01: analyticsHold reads the effective flags for the composite refusal (refusal 3)" },

  // --- holds: a surface that applies the verdict
  "src/app/api/og/factsheet/[id]/route.tsx::analyticsHold": { count: 1, class: "holds", reason: "Phase 237 plan 05 (FACT-02, share card): admits on analyticsHold(analytics).admitted and prints the Updating line" },
  "src/app/api/og/factsheet/[id]/route.tsx::effectiveDataQualityFlags": { count: 1, class: "holds", reason: "Phase 237 plan 05: reads the effective flags for the card's figure notes, so a held card quotes the last success's basis" },
  "src/app/api/strategies/[id]/returns/route.ts::analyticsHold": { count: 1, class: "holds", reason: "Phase 237 plan 01 (FACT-02, returns API): decides the door and answers analytics_updating" },
  "src/app/api/strategies/[id]/returns/route.ts::effectiveDataQualityFlags": { count: 1, class: "holds", reason: "Phase 237 plan 01: unit, curve method and composite come from the effective flags" },
  "src/app/api/strategies/[id]/returns/route.ts::isComputedAnalytics": { count: 1, class: "holds", reason: "237 WR-02: a terminal row refused only for the D-04 window is labelled computing, not empty" },
  "src/app/api/strategies/[id]/returns/route.ts::hasUnboundDerivePrestamp": { count: 1, class: "holds", reason: "237 WR-02: the D-04 window that makes the withheld terminal row read computing" },
  "src/app/api/factsheet/[id]/pdf/route.ts::analyticsHold": { count: 1, class: "holds", reason: "Phase 237 plan 06 (FACT-02, factsheet PDF): the door is analyticsHold(analytics).admitted, the cache is the held cache" },
  "src/app/api/factsheet/[id]/tearsheet.pdf/route.ts::analyticsHold": { count: 1, class: "holds", reason: "Phase 237 plan 06 (FACT-02, tear sheet PDF): the door is analyticsHold(analytics).admitted, the cache is the held cache" },
  "src/app/(dashboard)/recommendations/page.tsx::analyticsHold": { count: 1, class: "holds", reason: "Phase 237 plan 07 (FACT-02, recommendations, ruling 2): admits through analyticsHold and prints the Updating line; no census exemption" },
  "src/lib/queries.ts::analyticsHold": { count: 1, class: "holds", reason: "Phase 237 plan 13 (FACT-02, composer book rows): getMyAllocationDashboard ships analytics_updating from analyticsHold(row).updating" },
  "src/lib/factsheet/og-metrics.ts::isStoredResultReadable": { count: 1, class: "holds", reason: "Phase 237 plan 05: the card's stored-metrics read applies the factsheet's own readable composition" },
  "src/lib/factsheet/og-metrics.ts::storedCashHeadlineGate": { count: 1, class: "holds", reason: "Phase 237 plan 05: the card's headline gate passes the held-re-run flag through" },
  "src/lib/factsheet/og-metrics.ts::effectiveDataQualityFlags": { count: 2, class: "holds", reason: "Phase 237 plan 05: the withheld verdict and the stored-basis read both use the effective flags" },
  "src/lib/factsheet/composite-read-path.ts::isStoredResultReadable": { count: 3, class: "holds", reason: "Phase 190 plan 03: composite read arms receive recomputeOverStoredResult from the resolve stage and apply headline-basis's composition" },
  "src/lib/factsheet/composite-read-path.ts::storedCashHeadlineGate": { count: 1, class: "holds", reason: "Phase 190 plan 03: the composite cash headline gate receives the held-re-run flag" },
  "src/lib/strategyGate.ts::isRecomputeOverStoredResult": { count: 1, class: "holds", reason: "Phase 190 D-02: the first-pass strategy gate admits a pending or computing row over a stored result (a gate input, evaluated with the evidence the caller passes)" },
  "src/app/(dashboard)/compare/page.tsx::usesLastSuccessSnapshot": { count: 1, class: "holds", reason: "Phase 190 plan 07 /compare: reads the last-success snapshot while a re-run is held; records that it does not apply the flags-blob rule" },
  "src/components/strategy/StrategyTable.tsx::isComputedAnalytics": { count: 1, class: "holds", reason: "Phase 190 OQ-2 default (per the in-file comment) discovery list: isDisplayedRow shows a computed row or a row flagged analytics_updating, so the row keeps its #n" },
  "src/lib/strategy-health.ts::isComputedAnalytics": { count: 1, class: "holds", reason: "list health (Phase 199 MANAGERHOME added analyticsUpdating): the updating state is tested first, so a held row reads updating and not stale_no_data" },
  "src/components/admin/AdminTabs.tsx::isComputedAnalytics": { count: 1, class: "holds", reason: "admin recency cell (Phase 166.5 computed_at stamp): a computed row or any row that still shows a figure keeps its recency, so a held row is not blanked" },

  // --- percentile-cohort
  "src/lib/queries.ts::isRankableAnalyticsRow": { count: 4, class: "percentile-cohort", reason: "Phase 190 OQ-2 default: getPercentiles and getOwnRowPercentiles stay on terminal success (three cohort filters). The fourth is shapeRowAnalytics' terminal-success branch (owner); the exact count pins both" },

  // --- progress-terminal: a "run ended" consumer
  "src/hooks/useStrategySyncPoller.ts::isComputedAnalytics": { count: 1, class: "progress-terminal", reason: "polling stops when the run ended in a terminal success or failed (closed-sets.ts: deliberately separate from the held-re-run verdict)" },
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx::isComputedAnalytics": { count: 2, class: "progress-terminal", reason: "wizard sync preview: an existing row is complete and fresh (skip the re-run), and a settled-without-complete backstop; both read 'the run ended'" },
  "src/app/api/keys/sync/route.ts::isComputedAnalytics": { count: 1, class: "progress-terminal", reason: "keys/sync never stamps 'failed' over a row that already holds a terminal success" },
  "src/app/api/strategies/csv-finalize/route.ts::isComputedAnalytics": { count: 1, class: "progress-terminal", reason: "csv-finalize skips the 'failed' placeholder when the worker already wrote any terminal success" },
  "src/lib/finalize-rerun.ts::isComputedAnalytics": { count: 1, class: "progress-terminal", reason: "finalize re-run: terminal success is current only if no input is newer than the result" },
  "src/components/strategy/ApiKeyManager.tsx::isComputedAnalytics": { count: 2, class: "progress-terminal", reason: "key manager sync state machine: a computed status resets to idle, and a computed status over an untrusted panel subject" },
  "src/components/strategy/ApiKeyManager.tsx::=== \"complete\"": { count: 1, class: "progress-terminal", reason: "key manager sync state machine (SI-01 allowlisted site): the run-ended transition" },
  "src/components/strategy/ApiKeyManager.tsx::=== \"complete_with_warnings\"": { count: 1, class: "progress-terminal", reason: "key manager sync state machine: the warned run-ended transition" },
  "src/components/strategy/SyncProgress.tsx::=== \"complete\"": { count: 2, class: "progress-terminal", reason: "sync progress panel (SI-01 allowlisted site): the run-ended transition and the finished banner" },
  "src/components/strategy/SyncProgress.tsx::=== \"complete_with_warnings\"": { count: 3, class: "progress-terminal", reason: "sync progress panel: the warned run-ended transition, the finished banner and the warnings block" },
  "src/components/admin/AdminTabs.tsx::!== \"complete\"": { count: 1, class: "progress-terminal", reason: "admin card status label: shows the run's status text whenever it is not a clean terminal success" },
  "src/app/(dashboard)/strategies/page.tsx::isComputedAnalytics": { count: 2, class: "holds", reason: "Phase 237 WR-03 (the Phase 167.2.1 D-08 share-link note, copy only): a computed row is probed, and a pending or computing row is probed too, so the builder's own resolve stage answers for a held re-run (buildable, no note) and a first compute (not_computed, the uncomputed note). Two reads: the embed test only decides which rows skip the probe (failed, none), and it scopes the not_computed race warning to rows the embed called computed" },

  // --- write-gate
  "src/app/api/admin/strategy-review/route.ts::isComputedAnalytics": { count: 1, class: "write-gate", reason: "Phase 190 D-02 composite approval 409 arm: the founder ruled FACT-02 (c) out as a write gate, not a display (CONTEXT, Measured at HEAD after the ruling)" },
  "src/app/api/admin/strategy-review/route.ts::isRecomputeOverStoredResult": { count: 1, class: "write-gate", reason: "Phase 190 D-02 approval re-check 409 arm: a re-run over a stored result passes, failed and missing rows 409; write gate per the founder's ruling on FACT-02 (c)" },
  "src/app/api/admin/strategy-review/route.ts::hasStoredAnalyticsResult": { count: 2, class: "write-gate", reason: "MIXED PAIR (237-11 deviation): site 1 feeds the first-pass gate (the plan lists it under holds), site 2 is the 409 re-check evidence rule (write-gate, founder's FACT-02 (c) ruling). One class per pair, write-gate chosen because the route is an approval write; count 2 pins both" },
  "src/lib/founder-lp/readiness.ts::!== \"complete\"": { count: 1, class: "write-gate", reason: "LP report readiness: strict on purpose, complete_with_warnings is withheld from LP-facing reports (withhold plus fail-loud alert); gates generating a report, never a display" },

  // --- other-table: a different table or machine
  "src/lib/queries.ts::=== \"complete\"": { count: 1, class: "other-table", reason: "getPortfolioAnalyticsWithFallback: a portfolio_analytics row, not strategy_analytics (SI-01 allowlisted site)" },
  "src/lib/types.ts::=== \"complete\"": { count: 1, class: "other-table", reason: "isCompletedAnalytics: the portfolio_analytics status type guard (SI-01 allowlisted site)" },
  "src/lib/latest-holdings-per-key.ts::!== \"complete\"": { count: 1, class: "other-table", reason: "holdings sync metadata final_status, not strategy_analytics" },
  "src/lib/latest-holdings-per-key.ts::!== \"complete_with_warnings\"": { count: 1, class: "other-table", reason: "holdings sync metadata final_status, not strategy_analytics" },
  "src/components/exchanges/AllocatorExchangeManager.tsx::!== \"complete\"": { count: 1, class: "other-table", reason: "allocator exchange sync status literal, not strategy_analytics" },
  "src/components/exchanges/AllocatorSyncStatus.tsx::=== \"complete_with_warnings\"": { count: 1, class: "other-table", reason: "allocator exchange sync status literal, not strategy_analytics" },
  "src/app/api/verify-strategy/[id]/status/route.ts::=== \"complete\"": { count: 1, class: "other-table", reason: "verification status (SI-01 allowlisted site), not strategy_analytics" },
  "src/components/landing/VerificationProgress.tsx::=== \"complete\"": { count: 2, class: "other-table", reason: "landing verification progress: verification status (SI-01 allowlisted site)" },
  "src/components/landing/VerificationProgress.tsx::!== \"complete\"": { count: 2, class: "other-table", reason: "landing verification progress: verification status" },
  "src/components/landing/VerificationSection.tsx::=== \"complete\"": { count: 1, class: "other-table", reason: "landing verification section: verification status (SI-01 allowlisted site)" },

  // --- definition: the function definitions and their own internal calls
  "src/lib/analytics-hold.ts::analyticsHold": { count: 1, class: "definition", reason: "Phase 237 plan 01: the one shared held-re-run verdict (its own definition is the single call-shaped match)" },
  "src/lib/closed-sets.ts::isComputedAnalytics": { count: 2, class: "definition", reason: "closed-sets.ts: isComputedAnalytics's definition and isRankableAnalyticsRow's own call to it" },
  "src/lib/closed-sets.ts::isRankableAnalyticsRow": { count: 1, class: "definition", reason: "closed-sets.ts: the definition" },
  "src/lib/closed-sets.ts::isRecomputeOverStoredResult": { count: 1, class: "definition", reason: "closed-sets.ts: the definition" },
  "src/lib/closed-sets.ts::=== \"complete\"": { count: 1, class: "definition", reason: "closed-sets.ts: the terminal-success predicate's own comparison (SI-01 allowlisted site)" },
  "src/lib/closed-sets.ts::=== \"complete_with_warnings\"": { count: 1, class: "definition", reason: "closed-sets.ts: the terminal-success predicate's own comparison" },
  "src/lib/stored-analytics-result.ts::hasStoredAnalyticsResult": { count: 1, class: "definition", reason: "stored-analytics-result.ts: the definition" },
  "src/lib/stored-analytics-result.ts::hasUnboundDerivePrestamp": { count: 1, class: "definition", reason: "stored-analytics-result.ts: the definition" },
  "src/lib/stored-analytics-result.ts::usesLastSuccessSnapshot": { count: 1, class: "definition", reason: "stored-analytics-result.ts: the definition" },
  "src/lib/stored-analytics-result.ts::effectiveDataQualityFlags": { count: 3, class: "definition", reason: "stored-analytics-result.ts: the definition plus its two internal callers (markerSource and hasUnboundDerivePrestamp)" },
  "src/lib/factsheet/headline-basis.ts::isStoredResultReadable": { count: 2, class: "definition", reason: "headline-basis.ts: the definition and storedCashHeadlineGate's own call" },
  "src/lib/factsheet/headline-basis.ts::storedCashHeadlineGate": { count: 1, class: "definition", reason: "headline-basis.ts: the definition" },
};

// ---------------------------------------------------------------------------
// THE SURFACE LEDGER (founder FACT-02 list). Each row asserts, against the comment-stripped
// source, what makes the surface what its class says.
// ---------------------------------------------------------------------------
const LEDGER_CLASSES = ["holds", "owner", "census-only", "write-gate"] as const;
type LedgerClass = (typeof LEDGER_CLASSES)[number];

interface Surface {
  name: string;
  class: LedgerClass;
  /** Every file the assertion reads; each must be walked. */
  anchors: readonly string[];
  /** Problems with the surface, given a stripped-source reader. Empty is satisfied. */
  check: (read: (rel: string) => string, pop: Population) => string[];
}

/** Occurrences of `needle` (word-bounded when it is an identifier) in comment-stripped text. */
function occurrences(text: string, needle: string): number {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = /^[A-Za-z_]\w*$/.test(needle) ? new RegExp(`\\b${esc}\\b`, "g") : new RegExp(esc, "g");
  return (text.match(re) ?? []).length;
}

function mustContain(read: (rel: string) => string, rel: string, needle: string): string[] {
  return occurrences(read(rel), needle) > 0 ? [] : [`${rel} no longer contains ${needle}`];
}

/** The slice of a stripped file from `startMarker` to the next top-level `export `. */
function sliceExport(text: string, startMarker: string): string {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const rest = text.slice(start + startMarker.length);
  const next = rest.search(/\nexport\s/);
  return next < 0 ? rest : rest.slice(0, next);
}

const OG = "src/app/api/og/factsheet/[id]/route.tsx";
const PDF = "src/app/api/factsheet/[id]/pdf/route.ts";
const TEAR_PDF = "src/app/api/factsheet/[id]/tearsheet.pdf/route.ts";
const TEAR_PAGE = "src/app/factsheet/[id]/tearsheet/page.tsx";
const RETURNS = "src/app/api/strategies/[id]/returns/route.ts";
const RECS = "src/app/(dashboard)/recommendations/page.tsx";
const COMPOSER = "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx";
const QUERIES = "src/lib/queries.ts";
const FACTSHEET_VIEW = "src/app/factsheet/[id]/v2/FactsheetView.tsx";
const FETCH_BUILD = "src/lib/factsheet/fetch-and-build-payload.ts";
const ADMIN_ROUTE = "src/app/api/admin/strategy-review/route.ts";
const STRATEGY_TABLE = "src/components/strategy/StrategyTable.tsx";

function pairCount(pop: Population, rel: string, symbol: string): number {
  return pop.counts.get(`${rel}::${symbol}`) ?? 0;
}

const SURFACES: readonly Surface[] = [
  {
    name: "share card (OG route)",
    class: "holds",
    anchors: [OG],
    check: (read, pop) => [
      ...(pairCount(pop, OG, "analyticsHold") >= 1 ? [] : [`${OG} makes no analyticsHold( call`]),
      ...mustContain(read, OG, "ANALYTICS_UPDATING_LINE"),
    ],
  },
  {
    name: "tear sheet (page + PDF route)",
    class: "holds",
    anchors: [TEAR_PDF, TEAR_PAGE, FACTSHEET_VIEW],
    check: (read, pop) => [
      ...(pairCount(pop, TEAR_PDF, "analyticsHold") >= 1 ? [] : [`${TEAR_PDF} makes no analyticsHold( call`]),
      ...mustContain(read, TEAR_PAGE, "fetchAndBuildPayloadWithReason"),
      ...mustContain(read, FACTSHEET_VIEW, "ANALYTICS_UPDATING_LINE"),
    ],
  },
  {
    name: "factsheet PDF route",
    class: "holds",
    anchors: [PDF, FACTSHEET_VIEW],
    check: (read, pop) => [
      ...(pairCount(pop, PDF, "analyticsHold") >= 1 ? [] : [`${PDF} makes no analyticsHold( call`]),
      ...mustContain(read, FACTSHEET_VIEW, "ANALYTICS_UPDATING_LINE"),
    ],
  },
  {
    name: "returns API",
    class: "holds",
    anchors: [RETURNS],
    check: (read, pop) => [
      ...(pairCount(pop, RETURNS, "analyticsHold") >= 1 ? [] : [`${RETURNS} makes no analyticsHold( call`]),
      ...mustContain(read, RETURNS, "analytics_updating"),
    ],
  },
  {
    name: "recommendations",
    class: "holds",
    anchors: [RECS],
    check: (read, pop) => [
      ...(pairCount(pop, RECS, "analyticsHold") >= 1 ? [] : [`${RECS} makes no analyticsHold( call`]),
      ...mustContain(read, RECS, "ANALYTICS_UPDATING_LINE"),
    ],
  },
  {
    name: "composer (strict parse, book rows via getMyAllocationDashboard)",
    class: "holds",
    anchors: [COMPOSER, QUERIES],
    check: (read, pop) => {
      const text = read(COMPOSER);
      const problems: string[] = [];
      // A strict boolean parse, never a truthy read (T-237-14), and the shared sentence.
      if (!/analytics_updating\s*===\s*true/.test(text)) problems.push(`${COMPOSER} has no strict analytics_updating === true parse`);
      problems.push(...mustContain(read, COMPOSER, "ANALYTICS_UPDATING_LINE"));
      // The composer reads a boolean only; it never runs the verdict itself.
      for (const sym of CALL_SYMBOLS) {
        if (pairCount(pop, COMPOSER, sym) > 0) problems.push(`${COMPOSER} calls ${sym}( but must read the parsed boolean only`);
      }
      // Book rows get their boolean from the server-side hold.
      if (pairCount(pop, QUERIES, "analyticsHold") < 1) problems.push(`${QUERIES} makes no analyticsHold( call for the book rows`);
      return problems;
    },
  },
  {
    name: "factsheet (resolve stage)",
    class: "owner",
    anchors: [FETCH_BUILD],
    check: (_read, pop) => [
      ...(pairCount(pop, FETCH_BUILD, "isRecomputeOverStoredResult") >= 1 ? [] : [`${FETCH_BUILD} no longer asks isRecomputeOverStoredResult(`]),
      ...(pairCount(pop, FETCH_BUILD, "hasUnboundDerivePrestamp") >= 1 ? [] : [`${FETCH_BUILD} no longer asks hasUnboundDerivePrestamp(`]),
    ],
  },
  {
    name: "Phase 190 lists (shapeRowAnalytics owner, StrategyTable holds)",
    class: "owner",
    anchors: [QUERIES, STRATEGY_TABLE],
    check: (_read, pop) => [
      ...(pairCount(pop, QUERIES, "isRecomputeOverStoredResult") >= 1 ? [] : [`${QUERIES} no longer decides the held list row`]),
      ...(pairCount(pop, STRATEGY_TABLE, "isComputedAnalytics") >= 1 ? [] : [`${STRATEGY_TABLE} no longer decides which rows are displayed`]),
    ],
  },
  {
    name: "getFactsheetDetail (census-only, phase agent ruling 4: no select widening)",
    class: "census-only",
    anchors: [QUERIES],
    check: (read) => {
      const body = sliceExport(read(QUERIES), "export async function getFactsheetDetail");
      const problems: string[] = [];
      if (body === "") problems.push(`${QUERIES} no longer defines getFactsheetDetail`);
      else {
        if (!body.includes("${PUBLIC_ANALYTICS_COLUMNS}")) problems.push("getFactsheetDetail's select no longer interpolates PUBLIC_ANALYTICS_COLUMNS");
        for (const sym of CALL_SYMBOLS) {
          if (new RegExp(`\\b${sym}\\s*\\(`).test(body)) problems.push(`getFactsheetDetail now calls ${sym}( (ruling 4 is classification only)`);
        }
      }
      return problems;
    },
  },
  {
    name: "composite approval 409 (write-gate; FACT-02 (c) ruled out by the founder)",
    class: "write-gate",
    anchors: [ADMIN_ROUTE],
    check: (_read, pop) => [
      ...(pairCount(pop, ADMIN_ROUTE, "isRecomputeOverStoredResult") === 1 ? [] : [`${ADMIN_ROUTE} must carry exactly one isRecomputeOverStoredResult( call (the 409 arm)`]),
      ...(pairCount(pop, ADMIN_ROUTE, "hasStoredAnalyticsResult") === 2 ? [] : [`${ADMIN_ROUTE} must carry both hasStoredAnalyticsResult( call sites (first-pass input and 409 arm)`]),
    ],
  },
];

/** Retired surfaces: zero word-bounded occurrences in non-test source after comment stripping. */
const RETIRED = [
  "StrategyBreakdownTable",
  "getStrategyDetailV2",
  "getPublicStrategyDetail",
  "getStrategyDetail",
] as const;

/** The portfolio PDF page imports none of these (CONTEXT, Measured at HEAD after the ruling). */
const PORTFOLIO_PDF_PAGE = "src/app/portfolio-pdf/[id]/page.tsx";
const PORTFOLIO_PDF_FORBIDDEN_IMPORTS = [
  "@/lib/closed-sets",
  "@/lib/analytics-hold",
  "@/lib/stored-analytics-result",
  "@/lib/display-sign",
] as const;

/** Vacuity floors, set a little under the measured values recorded in the SUMMARY. */
const WALKED_FLOOR = 700;
const PAIRS_FLOOR = 70;

// ---------------------------------------------------------------------------
// The scanner.
// ---------------------------------------------------------------------------
function isTestPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    /\.test\.[^/]+$/.test(rel) ||
    /\.spec\.[^/]+$/.test(rel) ||
    parts.includes("__tests__") ||
    parts.includes("__fixtures__")
  );
}

function walk(repoRoot: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(repoRoot, abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(repoRoot, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
}

function readStripped(repoRoot: string, rel: string): string {
  return stripCommentsPreserveLines(readFileSync(resolve(repoRoot, rel), "utf8"));
}

interface Population {
  walked: string[];
  /** `file::symbol` -> call-site or comparison count (only pairs with count > 0). */
  counts: Map<string, number>;
  /** Retired symbol -> files naming it (word-bounded, comment-stripped). */
  retiredHits: Map<string, string[]>;
  /** The comment-stripped text by file, so the ledger reads what the walk read. */
  text: Map<string, string>;
}

function analyze(repoRoot: string, roots: readonly string[] = ROOTS): Population {
  const walked: string[] = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(repoRoot, abs, walked);
  }
  walked.sort();
  const counts = new Map<string, number>();
  const retiredHits = new Map<string, string[]>(RETIRED.map((r) => [r, []]));
  const text = new Map<string, string>();
  for (const rel of walked) {
    const stripped = readStripped(repoRoot, rel);
    text.set(rel, stripped);
    for (const { symbol, re } of SCANNERS) {
      const n = (stripped.match(re) ?? []).length;
      if (n > 0) counts.set(`${rel}::${symbol}`, n);
    }
    for (const r of RETIRED) {
      if (new RegExp(`\\b${r}\\b`).test(stripped)) retiredHits.get(r)!.push(rel);
    }
  }
  return { walked, counts, retiredHits, text };
}

/** Every problem with how `pop` is covered by `census`. Empty means the census is satisfied. */
function judge(pop: Population, census: Record<string, Entry>): string[] {
  const problems: string[] = [];
  const legal = LEGAL_CLASSES.join(", ");

  for (const [key, found] of [...pop.counts.entries()].sort()) {
    const [file, symbol] = key.split("::");
    const entry = census[key];
    if (!entry) {
      problems.push(
        `unclassified: ${file} reads the recompute verdict through ${symbol} ${found}x and has no CENSUS row; classify it on purpose (legal classes: ${legal})`,
      );
    } else if (entry.count !== found) {
      problems.push(`count: ${file} ${symbol} is classified ${entry.class} at ${entry.count} but the walk found ${found}`);
    }
  }

  for (const [key, entry] of Object.entries(census)) {
    const [file, symbol] = key.split("::");
    if (!pop.counts.has(key)) {
      problems.push(`stale: CENSUS row ${file} ${symbol} (${entry.class}, ${entry.count}) names a pair the walk no longer finds`);
    }
    if (!(LEGAL_CLASSES as readonly string[]).includes(entry.class)) {
      problems.push(`class: ${file} ${symbol} has "${entry.class}", outside the closed class set (${legal})`);
    }
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      problems.push(`count: ${file} ${symbol} has a non-positive count ${entry.count}`);
    }
    if (entry.reason.trim().length < 12) {
      problems.push(`reason: ${file} ${symbol} carries no reason`);
    }
  }
  return problems;
}

/** Retired surfaces still named by non-test source, plus the portfolio PDF page's imports. */
function judgeRetired(pop: Population): string[] {
  const problems: string[] = [];
  for (const [symbol, files] of pop.retiredHits) {
    if (files.length > 0) problems.push(`retired: ${symbol} is named by ${files.join(", ")}`);
  }
  const page = pop.text.get(PORTFOLIO_PDF_PAGE);
  if (page === undefined) {
    problems.push(`retired: ${PORTFOLIO_PDF_PAGE} is not in the walk`);
  } else {
    for (const spec of PORTFOLIO_PDF_FORBIDDEN_IMPORTS) {
      if (new RegExp(`from\\s*["']${spec.replace(/[/@]/g, "\\$&")}["']|import\\s*\\(?\\s*["']${spec.replace(/[/@]/g, "\\$&")}["']`).test(page)) {
        problems.push(`retired: ${PORTFOLIO_PDF_PAGE} imports ${spec}`);
      }
    }
  }
  return problems;
}

function judgeSurfaces(pop: Population): string[] {
  const read = (rel: string): string => pop.text.get(rel) ?? "";
  const problems: string[] = [];
  for (const s of SURFACES) {
    if (!(LEDGER_CLASSES as readonly string[]).includes(s.class)) problems.push(`surface: ${s.name} has class ${s.class}`);
    for (const a of s.anchors) {
      if (!pop.text.has(a)) problems.push(`surface: ${s.name} anchor ${a} is not in the walk`);
    }
    for (const p of s.check(read, pop)) problems.push(`surface: ${s.name}: ${p}`);
  }
  return problems;
}

describe("recompute verdict census (Phase 237 plan 11, SC-2)", () => {
  const pop = analyze(REPO_ROOT);

  it("every reader of the recompute verdict is classified, with an exact count", () => {
    const problems = judge(pop, CENSUS);
    expect(problems, problems.join("\n")).toEqual([]);
    const byClass = new Map<string, number>();
    for (const e of Object.values(CENSUS)) byClass.set(e.class, (byClass.get(e.class) ?? 0) + 1);
    console.info(
      `recompute-verdict-census: walked=${pop.walked.length} pairs=${pop.counts.size} classified=${Object.keys(CENSUS).length} ` +
        [...byClass.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" "),
    );
  });

  it("the founder's FACT-02 surfaces each hold, or are classified census-only or write-gate", () => {
    const problems = judgeSurfaces(pop);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("retired surfaces are gone, and the portfolio PDF page imports no verdict or sign module", () => {
    const problems = judgeRetired(pop);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("anti-vacuity: the walk and the classified population are above their recorded floors", () => {
    expect(pop.walked.length).toBeGreaterThanOrEqual(WALKED_FLOOR);
    expect(pop.counts.size).toBeGreaterThanOrEqual(PAIRS_FLOOR);
    expect(Object.keys(CENSUS).length).toBeGreaterThanOrEqual(PAIRS_FLOOR);
  });

  it("anti-vacuity: every ledger anchor is walked, and every symbol the ledger names is scanned", () => {
    const anchors = new Set(SURFACES.flatMap((s) => s.anchors));
    const missing = [...anchors].filter((a) => !pop.walked.includes(a));
    expect(missing, "a ledger anchor is not in the walked population").toEqual([]);
    // "Walked and matched": the anchors that carry a scanned symbol have at least one pair.
    // The composer, the tear sheet page and FactsheetView are anchors by content only: the
    // composer reads a parsed boolean and must carry no pair (asserted in its ledger row).
    const MATCHED_ANCHORS = [OG, PDF, TEAR_PDF, RETURNS, RECS, QUERIES, STRATEGY_TABLE, FETCH_BUILD, ADMIN_ROUTE];
    const unmatched = MATCHED_ANCHORS.filter((a) => ![...pop.counts.keys()].some((k) => k.startsWith(`${a}::`)));
    expect(unmatched, "a ledger anchor that must carry a scanned symbol has no pair").toEqual([]);
    for (const sym of ["analyticsHold", "isRecomputeOverStoredResult", "hasStoredAnalyticsResult"]) {
      expect((CALL_SYMBOLS as readonly string[]).includes(sym), `${sym} must be a scanned symbol`).toBe(true);
    }
    // The class set the map uses is exactly the legal set (no class unused, none outside).
    const used = new Set(Object.values(CENSUS).map((e) => e.class));
    expect([...used].sort()).toEqual([...LEGAL_CLASSES].sort());
  });

  describe("self-test: the census can fire (planted files in a temp directory)", () => {
    function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
      const dir = mkdtempSync(join(tmpdir(), "verdict-census-selftest-"));
      try {
        for (const [rel, body] of Object.entries(files)) {
          const abs = join(dir, rel);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, body);
        }
        run(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("an unclassified reader fails, naming the file and the symbol", () => {
      withPlanted(
        { "src/lib/planted-reader.ts": 'export const x = (s: string | null) => isRecomputeOverStoredResult(s, true);\n' },
        (dir) => {
          const planted = analyze(dir);
          const problems = judge(planted, {}).join("\n");
          expect(problems).toContain("unclassified: src/lib/planted-reader.ts");
          expect(problems).toContain("isRecomputeOverStoredResult");
          expect(problems).toContain(LEGAL_CLASSES.join(", "));
        },
      );
    });

    it("a planted literal comparison in either operator and operand order is counted", () => {
      withPlanted(
        {
          "src/lib/planted-literals.ts":
            'export const a = (s: string) => s === "complete" || "complete_with_warnings" === s || s !== "complete" || s !== "complete_with_warnings";\n',
        },
        (dir) => {
          const planted = analyze(dir);
          expect(planted.counts.get('src/lib/planted-literals.ts::=== "complete"')).toBe(1);
          expect(planted.counts.get('src/lib/planted-literals.ts::=== "complete_with_warnings"')).toBe(1);
          expect(planted.counts.get('src/lib/planted-literals.ts::!== "complete"')).toBe(1);
          expect(planted.counts.get('src/lib/planted-literals.ts::!== "complete_with_warnings"')).toBe(1);
        },
      );
    });

    it("a mention only inside a comment produces no pair", () => {
      withPlanted(
        {
          "src/lib/commented.ts":
            "/* analyticsHold( row ) is the verdict */\n// isComputedAnalytics( s ) and s === \"complete\" are named here\nexport const x = 1;\n",
        },
        (dir) => {
          const planted = analyze(dir);
          expect(planted.walked).toEqual(["src/lib/commented.ts"]);
          expect(planted.counts.size).toBe(0);
          expect(judge(planted, {})).toEqual([]);
        },
      );
    });

    it("a test file is not walked", () => {
      withPlanted(
        {
          "src/lib/thing.test.ts": "export const x = analyticsHold(null);\n",
          "src/lib/__tests__/helper.ts": "export const y = analyticsHold(null);\n",
        },
        (dir) => {
          const planted = analyze(dir);
          expect(planted.walked).toEqual([]);
        },
      );
    });

    it("a stale entry (a classified pair the tree no longer has) fails", () => {
      withPlanted({ "src/lib/other.ts": "export const x = 1;\n" }, (dir) => {
        const planted = analyze(dir);
        const problems = judge(planted, {
          "src/lib/gone.ts::analyticsHold": { count: 1, class: "holds", reason: "a surface that no longer exists in this tree" },
        }).join("\n");
        expect(problems).toContain("stale: CENSUS row src/lib/gone.ts analyticsHold");
      });
    });

    it("a count change fails with both counts", () => {
      withPlanted({ "src/lib/two.ts": "export const x = () => analyticsHold(null) && analyticsHold(null);\n" }, (dir) => {
        const planted = analyze(dir);
        const problems = judge(planted, {
          "src/lib/two.ts::analyticsHold": { count: 1, class: "holds", reason: "the row was classified when there was one call" },
        }).join("\n");
        expect(problems).toContain("src/lib/two.ts analyticsHold is classified holds at 1 but the walk found 2");
      });
    });

    it("an illegal class and an empty reason fail", () => {
      withPlanted({ "src/lib/odd.ts": "export const x = analyticsHold(null);\n" }, (dir) => {
        const planted = analyze(dir);
        const problems = judge(planted, {
          "src/lib/odd.ts::analyticsHold": { count: 1, class: "whatever" as unknown as Klass, reason: "" },
        }).join("\n");
        expect(problems).toContain('class: src/lib/odd.ts analyticsHold has "whatever"');
        expect(problems).toContain("reason: src/lib/odd.ts analyticsHold carries no reason");
      });
    });

    it("a planted retired symbol fails, and a comment-only mention does not", () => {
      withPlanted(
        {
          "src/components/revived.tsx": "export const T = () => <StrategyBreakdownTable />;\n",
          "src/lib/docblock.ts": "// getStrategyDetailV2 was deleted\n/* getPublicStrategyDetail too */\nexport const x = 1;\n",
          "src/lib/word-bound.ts": "export const getStrategyDetailV2 = 1;\n",
        },
        (dir) => {
          const planted = analyze(dir);
          const problems = judgeRetired(planted).join("\n");
          expect(problems).toContain("retired: StrategyBreakdownTable is named by src/components/revived.tsx");
          expect(problems).toContain("retired: getStrategyDetailV2 is named by src/lib/word-bound.ts");
          // Word-bounded: getStrategyDetailV2 does not satisfy getStrategyDetail.
          expect(problems).not.toContain("retired: getStrategyDetail is named");
          expect(problems).not.toContain("src/lib/docblock.ts");
        },
      );
    });

    it("a portfolio PDF page that imports a verdict module fails", () => {
      withPlanted(
        { "src/app/portfolio-pdf/[id]/page.tsx": 'import { isComputedAnalytics } from "@/lib/closed-sets";\nexport default function P() { return null; }\n' },
        (dir) => {
          const planted = analyze(dir);
          expect(judgeRetired(planted).join("\n")).toContain(
            "retired: src/app/portfolio-pdf/[id]/page.tsx imports @/lib/closed-sets",
          );
        },
      );
    });
  });
});
