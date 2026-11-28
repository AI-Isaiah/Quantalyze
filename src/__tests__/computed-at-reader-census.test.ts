/**
 * Phase 238 plan 08 (NEVERCOMPUTED, FACT-03, ROADMAP SC-1) - the census of every reader of
 * `strategy_analytics.computed_at`.
 *
 * THE PROPERTY. Since Phase 238 the column is nullable and NULL means "this strategy never
 * computed". A reader that treats the column as always a date (prints it, ages it, keys a cache
 * on it, binds a snapshot to it) now misreports a never-computed row. CONTEXT FACT-03: "a census
 * lists every reader of the column with a classification and fails when a new reader is added
 * unclassified". A new file that names the column, or a new mention in a file that already does,
 * cannot ship until someone reads it and classifies it on purpose; a reader class must also
 * name and pin the NULL arm the site carries.
 *
 * HALVES. This is the reader half. `analytics-service/tests/test_computed_at_stamp_census.py`
 * owns the WRITER half (the two success-only, DB-clock stamp sites) and is not duplicated here;
 * the `writer-stamp` class only labels a reader-corpus token that sits on a writer line.
 * `tsc --noEmit` on `computed_at: string | null` is the PROPERTY half for TypeScript: a reader that
 * does `s.analytics.computed_at.slice(...)` fails to compile, which no token scan can see.
 *
 * ORACLE INDEPENDENCE. The token lists, the patterns, the class set, the three CENSUS maps and the
 * floors are typed here. The only production imports are `stripCommentsPreserveLines` and the SQL
 * linter's `maskSql`. Files are read through `node:fs`, never shell grep.
 *
 * THREE CORPORA, one stripper each:
 *   TS      every non-test `.ts`/`.tsx` under `src/`, comment-stripped (`ts`). Tokens
 *           `computed_at`, `computedAt`, `analytics_computed_at`, `last_success_computed_at`.
 *   Python  every non-test `analytics-service/**\/*.py` (skips `tests`, `.venv`, `__pycache__`,
 *           `node_modules`), comment-stripped (`py`). The BARE word, not only a quoted literal:
 *           the quoted-only scan the research started from missed the strategy_analytics
 *           prestamp read `.select("data_quality_flags, computed_at")` in `job_worker.py`.
 *   SQL     `supabase/schema/functions/*.sql` and, from `supabase/schema/baseline.sql`, each
 *           `CREATE VIEW` body (key `view:NAME`), all through `maskSql`. A masked file that fails
 *           to lex is a problem, never a skipped file. Migrations are NOT walked: they are
 *           one-shot DDL, not runtime readers, and the schema snapshot already carries their
 *           effect. A `computed_at` named only inside a SQL string literal is invisible to
 *           `maskSql` by design.
 *
 * THE WILDCARDS. A token scan cannot see a reader that never names the column. Four patterns
 * look for the whole-row shapes: the PostgREST embed `strategy_analytics (*)` (optionally with a
 * `!hint`), the table-level `.from("strategy_analytics").select("*")` and its Python
 * `.table(...)` twin, and in SQL an alias or the table itself followed by `.*`. Every hit is a key
 * like any other. `getMyStrategies`' embed is the live one (its rows type as `StrategyAnalytics`,
 * so the compiler carries the `string | null` change to every consumer).
 *
 * THE KEY. `file::token` with an exact count, never a per-file allowance. A count change fails with
 * both counts; a classified pair the walk no longer finds fails as stale; an unclassified pair
 * fails naming the file, token, found count and the legal classes. A class is one of a closed set
 * and the census is satisfied by classifying the new reader, never by widening a class.
 *
 * ONE CLASS PER PAIR, with a precedence. Where one (file, token) pair carries several roles, the
 * class is the strictest role present: a reader-* class beats `plumbing` and `sort-name`, which
 * beat `other-table` and `synthetic`. The reason lists every site by role, so a reader can never
 * hide under `other-table`. Adding a site to such a pair moves its count and fails.
 *
 * THE NULL ARM. Every reader-* entry carries `arm`, a literal or pattern that must still be found
 * in the file's stripped source, and a reason that starts its account of it with `NULL arm:`.
 * `arm` is the line that makes NULL safe (render no date, stale or zero freshness, NULL as its own
 * key value, NULL never binds a snapshot). Removing it fails here.
 *
 * KNOWN LIMITS (said once). The token scan sees the column by NAME; a row passed whole to a helper
 * that reads `.computed_at` is seen only inside that helper, and a reader that gets the date through
 * a differently named alias is seen only at the select that creates the alias. The classified
 * counts include string contents (select lists, log text), so reworded log text that names the
 * column moves a count on purpose. A regenerated `database.types.ts` or a baseline re-dump moves
 * the pinned counts of the files it rewrites; update the rows in the same commit.
 *
 * ANTI-VACUITY. Each corpus has its own floor (files walked, classified pairs), the SQL scan must
 * find views, the class set the maps use is exactly the legal set, and planted self-tests over a
 * temp directory prove an unclassified reader fails in every corpus, a comment-only mention adds
 * no pair, a stale entry, a count change, an illegal class, an empty reason, a missing NULL arm
 * and a SQL file that fails to lex all fail, and a test file is not walked.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import { maskSql } from "../../scripts/lint-sql-gates.mjs";

const REPO_ROOT = process.cwd();

const LEGAL_CLASSES = [
  "reader-render",
  "reader-fresh",
  "reader-key",
  "reader-evidence",
  "plumbing",
  "sort-name",
  "writer-stamp",
  "synthetic",
  "excluded-generated",
  "other-table",
] as const;
type Klass = (typeof LEGAL_CLASSES)[number];

/** The classes that decide something from the date: each must name the NULL arm it carries. */
const READER_CLASSES: readonly Klass[] = ["reader-render", "reader-fresh", "reader-key", "reader-evidence"];

interface Entry {
  count: number;
  class: Klass;
  reason: string;
  /** reader-* only: a literal (or pattern) that must still appear in the file's stripped source. */
  arm?: string | RegExp;
}
type CensusMap = Record<string, Entry>;

// ---------------------------------------------------------------------------
// Scanners (typed here, never imported).
// ---------------------------------------------------------------------------
const TS_TOKEN_RE = /\b(computed_at|computedAt|analytics_computed_at|last_success_computed_at)\b/g;
const PY_TOKEN_RE = /\b(computed_at|analytics_computed_at|last_success_computed_at)\b/g;
const SQL_TOKEN_RE = /\bcomputed_at\b/g;

/** Whole-row readers a token scan cannot see: `[token name, pattern]`. */
const TS_WILDCARDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["strategy_analytics(*)", /strategy_analytics\s*(?:![\w]+\s*)?\(\s*\*\s*\)/g],
  ["from(strategy_analytics).select(*)", /\.from\(\s*["']strategy_analytics["']\s*\)\s*\.select\(\s*["'`]\s*\*/g],
];
const PY_WILDCARDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["strategy_analytics(*)", /strategy_analytics\s*(?:![\w]+\s*)?\(\s*\*\s*\)/g],
  ["table(strategy_analytics).select(*)", /\.table\(\s*["']strategy_analytics["']\s*\)\s*\.select\(\s*["']\s*\*/g],
];
/** SQL keywords that can follow a table name and are not an alias. */
const SQL_NOT_ALIAS = new Set([
  "on", "where", "join", "left", "right", "inner", "outer", "full", "cross", "using", "set", "group", "order",
  "limit", "for", "select", "values", "returning", "union", "except", "intersect", "having", "as", "natural",
]);

const TS_SKIP_DIRS = new Set(["__tests__", "__fixtures__", "fixtures", "tests"]);
const PY_SKIP_DIRS = new Set(["tests", ".venv", "__pycache__", "node_modules"]);

const SQL_FUNCTIONS_DIR = "supabase/schema/functions";
const SQL_BASELINE = "supabase/schema/baseline.sql";
const VIEW_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:"?public"?\.)?"?(\w+)"?[\s\S]*?;/g;

// ---------------------------------------------------------------------------
// THE CENSUS MAPS. One row per (file, token) the walk finds in its corpus.
//   reader-render      prints a date
//   reader-fresh       a freshness verdict or score
//   reader-key         a cache key, ETag or equality baseline
//   reader-evidence    snapshot binding, held re-run, resume or re-run freshness
//   plumbing           select list, type, prop, passthrough, no decision
//   sort-name          the column name as a sort option
//   writer-stamp       a token on a writer line (the writer census owns the writers)
//   synthetic          not a column read (a literal, a fixture)
//   excluded-generated generated types: `tsc` is their check
//   other-table        another table's computed_at (match batch, portfolio, equity curve, series)
// ---------------------------------------------------------------------------
const TS_CENSUS: CensusMap = {
  "src/app/(dashboard)/admin/page.tsx::computed_at": { count: 1, class: "plumbing", reason: "admin review select list; the date reaches AdminTabs, whose NULL arm is pinned on its own row" },
  "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx::computedAt": { count: 1, class: "other-table", reason: "portfolio_analytics date (`analytics?.computed_at ?? null`) handed to the allocator portfolio factsheet payload; not strategy_analytics" },
  "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx::computed_at": { count: 1, class: "other-table", reason: "portfolio_analytics date (`analytics?.computed_at ?? null`) handed to the allocator portfolio factsheet payload; not strategy_analytics" },
  "src/app/(dashboard)/allocations/HoldingsTabPanel.tsx::computedAt": { count: 1, class: "other-table", reason: "portfolio optimizer prefetch default (null); portfolio_analytics, not strategy_analytics" },
  "src/app/(dashboard)/allocations/components/OptimizerPanel.tsx::computedAt": { count: 4, class: "other-table", reason: "portfolio optimizer prop; portfolio_analytics, not strategy_analytics" },
  "src/app/(dashboard)/allocations/lib/watchlist-read.ts::computedAt": { count: 3, class: "other-table", reason: "portfolio_analytics select and order for the default portfolio's optimizer; not strategy_analytics" },
  "src/app/(dashboard)/allocations/lib/watchlist-read.ts::computed_at": { count: 3, class: "other-table", reason: "portfolio_analytics select and order for the default portfolio's optimizer; not strategy_analytics" },
  "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts::computedAt": { count: 1, class: "synthetic", reason: "the scenario factsheet payload's literal empty date; a scenario is not a strategy row and reads no column" },
  "src/app/(dashboard)/compare/page.tsx::last_success_computed_at": { count: 1, class: "plumbing", reason: "deletes the select alias from the fetched row after the snapshot is applied; no decision" },
  "src/app/(dashboard)/recommendations/page.tsx::analytics_computed_at": { count: 2, class: "reader-render", reason: "the recommendations RPC's strategy date. NULL arm: a row that is not computed passes null (`computed ? ... : null`), never a date", arm: "computed ? (row.analytics_computed_at ?? null) : null" },
  "src/app/(dashboard)/recommendations/page.tsx::computedAt": { count: 2, class: "plumbing", reason: "two props: FreshnessBadge computedAt (match batch, guarded by `batch?.computed_at ?`) and SyncBadge computedAt (strategy; its NULL arm is pinned on SyncBadge.tsx)" },
  "src/app/(dashboard)/recommendations/page.tsx::computed_at": { count: 10, class: "plumbing", reason: "MIXED: strategy side is the select list (:296), two row types and the SyncBadge prop (no decision; the gate is the analytics_computed_at row); the match batch header (two reads, batch?.computed_at guard, one type) is other-table" },
  "src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx::computedAt": { count: 2, class: "plumbing", reason: "passes the wizard snapshot's date to FactsheetPreview, whose NULL arm is pinned there" },
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx::computedAt": { count: 7, class: "reader-render", reason: "the preview snapshot's date. NULL arm: `typeof analyticsRow?.computed_at === \"string\" ? ... : null` keeps NULL as null, so FactsheetPreview prints no date", arm: "typeof analyticsRow?.computed_at === \"string\" ? analyticsRow.computed_at : null" },
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx::computed_at": { count: 9, class: "reader-evidence", reason: "MIXED: the existing-row freshness gate (reader-evidence), two select lists, a row type and `analytics?.computed_at ?? null` into the snapshot. NULL arm: an existing row with a NULL date is not parsed and is never fresh (computedAtMs stays null)", arm: /existing\?\.computed_at\s*\?\s*Date\.parse\(existing\.computed_at\)\s*:\s*null/ },
  "src/app/(marketing)/for-quants/page.tsx::computedAt": { count: 1, class: "synthetic", reason: "the marketing sample card passes the literal null; no column is read" },
  "src/app/api/admin/match/allocators/route.ts::computed_at": { count: 9, class: "other-table", reason: "match_batches select, order, map and the hoursSinceRecompute guard; not strategy_analytics" },
  "src/app/api/admin/strategy-review/route.ts::computed_at": { count: 2, class: "plumbing", reason: "two select lists that feed isComputedAnalytics and the snapshot rule, whose NULL arm (isSameInstant fails closed) is pinned on stored-analytics-result.ts" },
  "src/app/api/factsheet/[id]/pdf/route.ts::computed_at": { count: 2, class: "reader-key", reason: "MIXED: the select list and the ETag. NULL arm: the ETag key reads a NULL date as the empty string, a distinct value from any real date", arm: "${analytics.computed_at ?? \"\"}" },
  "src/app/api/factsheet/[id]/tearsheet.pdf/route.ts::computed_at": { count: 1, class: "plumbing", reason: "select list that feeds analyticsHold, whose NULL arm is the snapshot rule on stored-analytics-result.ts" },
  "src/app/api/og/factsheet/[id]/route.tsx::computed_at": { count: 2, class: "plumbing", reason: "one row-type member and one select list feeding analyticsHold and effectiveDataQualityFlags; the snapshot rule is pinned on stored-analytics-result.ts" },
  "src/app/api/strategies/[id]/returns/route.ts::computed_at": { count: 2, class: "plumbing", reason: "one select list and one row-type member feeding analyticsHold; the snapshot rule is pinned on stored-analytics-result.ts" },
  "src/app/factsheet/[id]/v2/FactsheetView.tsx::computedAt": { count: 10, class: "reader-render", reason: "MIXED: FreshnessChip prop and branches, SeriesRecencyLine date, footer stamp. NULL arm: the never-computed stamp returns early in the chip and prints the null dash in the footer (238-06)", arm: "isNeverComputedStamp(computedAt)" },
  "src/app/factsheet/[id]/v2/MandatePanels.tsx::computedAt": { count: 2, class: "reader-render", reason: "the Terms `Factsheet computed` cell. NULL arm: the never-computed stamp prints the null dash, never 1970 (238-06)", arm: "isNeverComputedStamp(payload.computedAt) ? null" },
  "src/app/factsheet/[id]/v2/page.tsx::computedAt": { count: 5, class: "reader-key", reason: "the factsheet payload cache key (v30). NULL arm: a NULL date keys as \"0\", a distinct value from any real date", arm: "signAnalytics?.computed_at ?? \"0\"" },
  "src/app/factsheet/[id]/v2/page.tsx::computed_at": { count: 3, class: "reader-key", reason: "MIXED: two select lists and the key read. NULL arm: a NULL date keys as \"0\", a distinct value from any real date", arm: "signAnalytics?.computed_at ?? \"0\"" },
  "src/app/factsheet/[id]/v2/test-fixtures/census-payloads.ts::computedAt": { count: 1, class: "synthetic", reason: "payload fixture literal date shared by the factsheet census tests" },
  "src/components/admin/AdminTabs.tsx::computed_at": { count: 3, class: "reader-render", reason: "MIXED: two row types and the admin recency cell. NULL arm: a row that never computed reads the dash (everComputed gate), 238-07 pins it", arm: "everComputed ? formatRecency(analytics.computed_at) : \"\u2014\"" },
  "src/components/admin/AllocatorMatchQueue.tsx::computed_at": { count: 4, class: "other-table", reason: "match batch row type, hoursAgo guard and computeFreshness over batch?.computed_at; match_batches, not strategy_analytics" },
  "src/components/admin/MatchQueueIndex.tsx::computed_at": { count: 1, class: "other-table", reason: "match batch row type; match_batches, not strategy_analytics" },
  "src/components/portfolio/PortfolioOptimizer.tsx::computedAt": { count: 3, class: "other-table", reason: "portfolio optimizer prop and state; portfolio_analytics, not strategy_analytics" },
  "src/components/strategy/ApiKeyManager.tsx::computedAt": { count: 1, class: "reader-evidence", reason: "the baseline's property name on the same read. NULL arm: a NULL date is carried as null (see the computed_at row)", arm: "outcome.data?.computed_at ?? null" },
  "src/components/strategy/ApiKeyManager.tsx::computed_at": { count: 2, class: "reader-evidence", reason: "the sync panel's evidence baseline: a select list and the read. NULL arm: a NULL date is carried as null, a value of its own that a later real date differs from", arm: "outcome.data?.computed_at ?? null" },
  "src/components/strategy/CustomizeDrawer.tsx::computed_at": { count: 1, class: "sort-name", reason: "the column name as a discovery sort option; the sort reads it in StrategyTable.tsx" },
  "src/components/strategy/FactsheetPreview.tsx::computedAt": { count: 6, class: "reader-render", reason: "the wizard preview badge. NULL arm: a falsy date yields no `Data from exchange API` line (238-07 pins draft, pending and verified)", arm: /const dateLabel = computedAt\s*\?/ },
  "src/components/strategy/FreshnessBadge.tsx::computedAt": { count: 11, class: "reader-fresh", reason: "generic freshness pill. NULL arm: a null date is NaN and computeFreshness answers stale", arm: "if (computedAt == null) return NaN;" },
  "src/components/strategy/StrategyFilters.tsx::computed_at": { count: 1, class: "sort-name", reason: "the column name as a discovery sort option; the sort reads it in StrategyTable.tsx" },
  "src/components/strategy/StrategyGrid.tsx::computedAt": { count: 1, class: "plumbing", reason: "`SyncBadge computedAt={s.analytics.computed_at}`; the card's NULL arm is pinned on SyncBadge.tsx and the HealthScore on health-score.ts" },
  "src/components/strategy/StrategyGrid.tsx::computed_at": { count: 1, class: "plumbing", reason: "`SyncBadge computedAt={s.analytics.computed_at}`; the card's NULL arm is pinned on SyncBadge.tsx and the HealthScore on health-score.ts" },
  "src/components/strategy/StrategyHeader.tsx::computedAt": { count: 5, class: "reader-render", reason: "MIXED: a prop, its type and the badge guard. NULL arm: `{computedAt && (` renders no badge for a falsy date", arm: "{computedAt && (" },
  "src/components/strategy/StrategyTable.tsx::computedAt": { count: 1, class: "plumbing", reason: "the SyncBadge prop; its NULL arm is pinned on SyncBadge.tsx" },
  "src/components/strategy/StrategyTable.tsx::computed_at": { count: 3, class: "reader-render", reason: "MIXED: the sort case label (sort-name), the sort key read and the SyncBadge prop. NULL arm: the sort key reads a NULL date as the empty string (the old end of the key, 238-07 pins it) and the badge renders no date", arm: "s.analytics.computed_at ?? \"\"" },
  "src/components/strategy/SyncBadge.tsx::computedAt": { count: 4, class: "reader-render", reason: "the sync badge title. NULL arm: a falsy date builds no date and the title carries no `Analytics last computed` suffix (238-07 pins six branches)", arm: "computedAt ? new Date(computedAt) : null" },
  "src/components/strategy/SyncProgress.tsx::computedAt": { count: 4, class: "reader-evidence", reason: "the sync panel's evidence comparison. NULL arm: NULL is compared as null, a distinct baseline value, never coerced to a date", arm: "(computedAt ?? null) !== evidenceBaseline.computedAt" },
  "src/hooks/useStrategySyncPoller.ts::computedAt": { count: 1, class: "plumbing", reason: "the onStatus callback's optional parameter type" },
  "src/hooks/useStrategySyncPoller.ts::computed_at": { count: 2, class: "reader-evidence", reason: "the poller hands the row's date to onStatus. NULL arm: a NULL date is passed as null, never a date", arm: "data.computed_at ?? null" },
  "src/lib/admin/match.ts::computed_at": { count: 2, class: "other-table", reason: "match_batches select and order; not strategy_analytics" },
  "src/lib/analytics-hold.ts::computed_at": { count: 1, class: "plumbing", reason: "row-type member (`unknown`) of the slice analyticsHold reads; the verdict itself runs isSameInstant, whose NULL arm is pinned on stored-analytics-result.ts" },
  "src/lib/analytics-hold.ts::last_success_computed_at": { count: 1, class: "plumbing", reason: "row-type member (`unknown`) of the slice analyticsHold reads; the verdict itself runs isSameInstant, whose NULL arm is pinned on stored-analytics-result.ts" },
  "src/lib/database.types.ts::analytics_computed_at": { count: 1, class: "excluded-generated", reason: "generated Supabase types; typecheck is their check (strategy_analytics Row is string | null since 238-06). A regeneration moves this count" },
  "src/lib/database.types.ts::computed_at": { count: 20, class: "excluded-generated", reason: "generated Supabase types; typecheck is their check (strategy_analytics Row is string | null since 238-06). A regeneration moves this count" },
  "src/lib/discovery-prefs.ts::computed_at": { count: 1, class: "sort-name", reason: "the column name as a discovery sort option; the sort reads it in StrategyTable.tsx" },
  "src/lib/discovery-types.ts::computed_at": { count: 1, class: "sort-name", reason: "the column name as a discovery sort option; the sort reads it in StrategyTable.tsx" },
  "src/lib/factsheet/allocator-portfolio-payload.ts::computedAt": { count: 3, class: "other-table", reason: "the allocator portfolio payload's date, from portfolio_analytics via AllocationDashboardV2 (its only caller). ADJACENT DEFECT, out of scope for the strategy column: `meta.computedAt ?? new Date().toISOString()` claims now for a missing portfolio date" },
  "src/lib/factsheet/build-payload.ts::computedAt": { count: 3, class: "plumbing", reason: "payload type member and the strategy passthrough (`computedAt: strategy.computedAt`); the value is decided in fetch-and-build-payload.ts" },
  "src/lib/factsheet/fetch-and-build-payload.ts::computedAt": { count: 2, class: "plumbing", reason: "the const holding the decided date and its payload shorthand; the NULL arm is on the computed_at row" },
  "src/lib/factsheet/fetch-and-build-payload.ts::computed_at": { count: 5, class: "reader-render", reason: "MIXED: the select list, the missing-date log and its text, the guard and the read. NULL arm: a NULL date becomes NEVER_COMPUTED_STAMP, which the render sites turn into the null dash (238-06)", arm: "analytics?.computed_at ?? NEVER_COMPUTED_STAMP" },
  "src/lib/factsheet/og-metrics.ts::computed_at": { count: 1, class: "plumbing", reason: "row-type member of the slice the card's stored-metrics read passes to the verdict; the snapshot rule is pinned on stored-analytics-result.ts" },
  "src/lib/factsheet/types.ts::computedAt": { count: 1, class: "plumbing", reason: "payload type member `computedAt: string`; the NULL stamp is decided in fetch-and-build-payload.ts" },
  "src/lib/finalize-rerun.ts::computedAt": { count: 3, class: "reader-evidence", reason: "the finalize re-run freshness test (select, row type, read, parse). NULL arm: `Date.parse(computedAt ?? \"\")` is NaN, so a NULL date enqueues with reason inputs_changed", arm: "Date.parse(computedAt ?? \"\")" },
  "src/lib/finalize-rerun.ts::computed_at": { count: 3, class: "reader-evidence", reason: "the finalize re-run freshness test (select, row type, read, parse). NULL arm: `Date.parse(computedAt ?? \"\")` is NaN, so a NULL date enqueues with reason inputs_changed", arm: "Date.parse(computedAt ?? \"\")" },
  "src/lib/freshness.ts::computedAt": { count: 9, class: "reader-fresh", reason: "computeFreshness and resolveEffectiveRecency. NULL arm: a null date is stale", arm: "if (computedAt == null) return \"stale\";" },
  "src/lib/health-score.ts::computedAt": { count: 3, class: "reader-fresh", reason: "freshnessScore. NULL arm: a falsy date scores 0 (238-07 pins the pill)", arm: "if (!computedAt) return 0;" },
  "src/lib/health-score.ts::computed_at": { count: 1, class: "reader-fresh", reason: "`freshnessScore(analytics.computed_at)`. NULL arm: a falsy date scores 0 (see the computedAt row)", arm: "if (!computedAt) return 0;" },
  "src/lib/intro/snapshot.ts::computed_at": { count: 1, class: "other-table", reason: "portfolio_analytics order for the intro snapshot; not strategy_analytics" },
  "src/lib/portfolio-analytics-adapter.ts::computed_at": { count: 4, class: "other-table", reason: "portfolio_analytics row adapter (a row without a date is rejected); not strategy_analytics" },
  "src/lib/queries.ts::computed_at": { count: 21, class: "plumbing", reason: "MIXED, no decision on the strategy side: the percentile, record and category select strings (6), PUBLIC_ANALYTICS_COLUMNS, the getFactsheetDetail and getPortfolioStrategies selects, two dashboard selects and the two `_ca` strips that drop the date after the snapshot rule has read it. other-table, 8 sites: portfolio_analytics orders (3), allocator_equity_derived row type, read, select and order (4), match_batches order (1)" },
  "src/lib/queries.ts::last_success_computed_at": { count: 4, class: "plumbing", reason: "the snapshot alias in three select strings and the delete that drops it from the payload; the rule that reads it is pinned on stored-analytics-result.ts" },
  "src/lib/queries.ts::strategy_analytics(*)": { count: 1, class: "plumbing", reason: "getMyStrategies' wildcard embed (owner-scoped). Its rows type as StrategyAnalytics with computed_at: string | null, so tsc carries the NULL arm to every consumer; the explicit readers are classified in their own files" },
  "src/lib/stored-analytics-result.ts::computed_at": { count: 5, class: "reader-evidence", reason: "the snapshot binding rule and its row types. NULL arm: isSameInstant answers false unless both values are strings, so a NULL date never binds a last_success_snapshot", arm: "if (typeof a !== \"string\" || typeof b !== \"string\") return false;" },
  "src/lib/stored-analytics-result.ts::last_success_computed_at": { count: 2, class: "reader-evidence", reason: "the held-row snapshot comparison. NULL arm: isSameInstant fails closed on a non-string, so a NULL date never binds a snapshot", arm: "if (typeof a !== \"string\" || typeof b !== \"string\") return false;" },
  "src/lib/types.ts::computed_at": { count: 7, class: "plumbing", reason: "MIXED: StrategyAnalytics.computed_at: string | null (the type is the check) is the strategy side. other-table, 6 sites: four strategy_analytics_series payload variants, PortfolioAnalytics and a position snapshot row" },
  "src/lib/types.ts::last_success_computed_at": { count: 1, class: "plumbing", reason: "optional snapshot-alias member of the flags row type; no decision" },
  "src/lib/utils.ts::computed_at": { count: 1, class: "synthetic", reason: "EMPTY_ANALYTICS' literal empty-string date, a placeholder row and not a column read; the empty string is falsy at every reader" },
};

const PY_CENSUS: CensusMap = {
  "analytics-service/routers/match.py::computed_at": { count: 7, class: "other-table", reason: "match_batches select, order, parse and a malformed-date log; not strategy_analytics" },
  "analytics-service/routers/portfolio.py::computed_at": { count: 2, class: "other-table", reason: "portfolio_analytics orders; not strategy_analytics" },
  "analytics-service/services/allocator_positions.py::computed_at": { count: 1, class: "other-table", reason: "allocator_equity_derived upsert stamp; not strategy_analytics" },
  "analytics-service/services/analytics_runner.py::computed_at": { count: 1, class: "writer-stamp", reason: "`\"computed_at\": \"now\"` on the runner's success write; the writer census (test_computed_at_stamp_census.py) owns it" },
  "analytics-service/services/feedback_engine.py::computed_at": { count: 1, class: "other-table", reason: "match_batches order; not strategy_analytics" },
  "analytics-service/services/job_worker.py::computed_at": { count: 17, class: "reader-evidence", reason: "MIXED: the last-success snapshot rule (`_last_success_snapshot`, 8 sites incl. the prestamp select list), plus writer-stamp (the composite success `\"now\"`, one site; the writer census owns it) and other-table (allocator_equity_derived upserts, 6; portfolio_analytics order, 1). NULL arm: a snapshot needs a non-empty string date, so NULL never binds", arm: "_non_empty_str(computed_at)" },
  "analytics-service/services/match_eval.py::computed_at": { count: 10, class: "other-table", reason: "match_batches filters, order and the batch-vs-intro comparison; not strategy_analytics" },
  "analytics-service/services/mt5_parity_capture.py::computed_at": { count: 8, class: "reader-evidence", reason: "MIXED: the capture column map (plumbing), the Capture field and the stamp read. NULL arm: only a string date is recorded (`isinstance(row.get(\"computed_at\"), str)`), so NULL records no stamp", arm: "isinstance(row.get(\"computed_at\"), str)" },
  "analytics-service/services/mt5_parity_findings.py::computed_at": { count: 4, class: "reader-render", reason: "ops report cells. NULL arm: `_minute(None)` prints n/a, never a date", arm: "return \"n/a\"" },
};

const SQL_CENSUS: CensusMap = {
  "supabase/schema/baseline.sql::view:ledger_refresh_staleness": { count: 2, class: "plumbing", reason: "MIXED: `sa.computed_at AS analytics_computed_at` is an informational passthrough (NULL passes through; is_stale keys on status and the series); `sas.computed_at` is strategy_analytics_series (other-table)" },
  "supabase/schema/functions/cutover_strategy_metrics_keys_atomic.sql::computed_at": { count: 3, class: "other-table", reason: "strategy_analytics_series payload upsert stamp; not strategy_analytics" },
  "supabase/schema/functions/get_allocator_latest_batch_meta.sql::computed_at": { count: 3, class: "other-table", reason: "match_batches column; not strategy_analytics" },
  "supabase/schema/functions/get_allocator_recommendations.sql::computed_at": { count: 2, class: "plumbing", reason: "MIXED: `sa.computed_at AS analytics_computed_at` is a passthrough (NULL passes through; recommendations/page.tsx gates it on computed); `mb.computed_at` (the batch order) is other-table" },
  "supabase/schema/functions/get_latest_portfolio_analytics_for_user.sql::computed_at": { count: 1, class: "other-table", reason: "portfolio_analytics order; not strategy_analytics" },
  "supabase/schema/functions/reset_stalled_portfolio_analytics.sql::computed_at": { count: 1, class: "other-table", reason: "portfolio_analytics staleness filter; not strategy_analytics" },
  "supabase/schema/functions/strategy_analytics_hold_computed_at_until_success.sql::computed_at": { count: 2, class: "writer-stamp", reason: "the hold trigger body `NEW.computed_at := OLD.computed_at`: it writes nothing new, and with OLD NULL it holds NULL, so a first-ever failed row stays never-computed (238-05 proved it on a throwaway cluster)" },
  "supabase/schema/functions/upsert_strategy_analytics_series_batch.sql::computed_at": { count: 3, class: "other-table", reason: "strategy_analytics_series upsert stamp; not strategy_analytics" },
};

// ---------------------------------------------------------------------------
// Floors, set a little under the values recorded in the SUMMARY.
// ---------------------------------------------------------------------------
const FLOORS = {
  tsWalked: 740,
  tsPairs: 70,
  pyWalked: 165,
  pyPairs: 8,
  sqlFiles: 135,
  sqlPairs: 7,
  sqlViews: 3,
} as const;

// ---------------------------------------------------------------------------
// The scanner.
// ---------------------------------------------------------------------------
interface Corpus {
  walked: string[];
  /** `file::token` -> occurrence count (only pairs with count > 0). */
  counts: Map<string, number>;
  /** The scanned (stripped or masked) text by file, so an `arm` reads what the walk read. */
  text: Map<string, string>;
}
interface SqlCorpus extends Corpus {
  /** Every view found in the baseline, with or without the token. */
  views: string[];
  /** Files `maskSql` refused to lex: a problem, never a skipped file. */
  maskErrors: string[];
}
interface Population {
  ts: Corpus;
  py: Corpus;
  sql: SqlCorpus;
}

function isTsTestPath(rel: string): boolean {
  const parts = rel.split("/");
  return /\.test\.[^/]+$/.test(rel) || /\.spec\.[^/]+$/.test(rel) || parts.some((p) => TS_SKIP_DIRS.has(p));
}

function walkFiles(repoRoot: string, root: string, accept: RegExp, skipDirs: ReadonlySet<string>, out: string[]): void {
  const abs = join(repoRoot, root);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        visit(p);
        continue;
      }
      if (!accept.test(entry)) continue;
      const rel = relative(repoRoot, p).split("\\").join("/");
      if (!isTsTestPath(rel)) out.push(rel);
    }
  };
  visit(abs);
}

function bump(counts: Map<string, number>, file: string, token: string, n: number): void {
  if (n > 0) counts.set(`${file}::${token}`, (counts.get(`${file}::${token}`) ?? 0) + n);
}

function scanCode(
  repoRoot: string,
  files: string[],
  lang: "ts" | "py",
  tokenRe: RegExp,
  wildcards: ReadonlyArray<readonly [string, RegExp]>,
): Corpus {
  const counts = new Map<string, number>();
  const text = new Map<string, string>();
  for (const rel of files) {
    const stripped = stripCommentsPreserveLines(readFileSync(resolve(repoRoot, rel), "utf8"), lang);
    text.set(rel, stripped);
    const perToken = new Map<string, number>();
    for (const m of stripped.matchAll(new RegExp(tokenRe.source, tokenRe.flags))) {
      perToken.set(m[1], (perToken.get(m[1]) ?? 0) + 1);
    }
    for (const [token, n] of perToken) bump(counts, rel, token, n);
    for (const [name, re] of wildcards) {
      bump(counts, rel, name, (stripped.match(new RegExp(re.source, re.flags)) ?? []).length);
    }
  }
  return { walked: files, counts, text };
}

/** `strategy_analytics.*` and `<alias>.*` over the masked SQL text. */
function sqlWildcardCount(masked: string): number {
  let n = (masked.match(/\bstrategy_analytics\s*\.\s*\*/g) ?? []).length;
  const aliases = new Set<string>();
  for (const m of masked.matchAll(/\bstrategy_analytics\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/gi)) {
    if (!SQL_NOT_ALIAS.has(m[1].toLowerCase())) aliases.add(m[1]);
  }
  for (const a of aliases) n += (masked.match(new RegExp(`\\b${a}\\s*\\.\\s*\\*`, "g")) ?? []).length;
  return n;
}

function scanSql(repoRoot: string): SqlCorpus {
  const counts = new Map<string, number>();
  const text = new Map<string, string>();
  const maskErrors: string[] = [];
  const walked: string[] = [];
  const views: string[] = [];

  const fnDir = join(repoRoot, SQL_FUNCTIONS_DIR);
  const fnFiles = existsSync(fnDir) ? readdirSync(fnDir).filter((f) => f.endsWith(".sql")).sort() : [];
  for (const f of fnFiles) {
    const rel = `${SQL_FUNCTIONS_DIR}/${f}`;
    walked.push(rel);
    const masked = maskSql(readFileSync(join(repoRoot, rel), "utf8"));
    if ("error" in masked) {
      maskErrors.push(`${rel}: ${masked.error} (line ${masked.line})`);
      continue;
    }
    text.set(rel, masked.code);
    bump(counts, rel, "computed_at", (masked.code.match(SQL_TOKEN_RE) ?? []).length);
    bump(counts, rel, "strategy_analytics.*", sqlWildcardCount(masked.code));
  }

  const baseline = join(repoRoot, SQL_BASELINE);
  if (existsSync(baseline)) {
    const masked = maskSql(readFileSync(baseline, "utf8"));
    if ("error" in masked) {
      maskErrors.push(`${SQL_BASELINE}: ${masked.error} (line ${masked.line})`);
    } else {
      for (const v of masked.code.matchAll(VIEW_RE)) {
        views.push(v[1]);
        bump(counts, SQL_BASELINE, `view:${v[1]}`, (v[0].match(SQL_TOKEN_RE) ?? []).length);
        bump(counts, SQL_BASELINE, `view:${v[1]}.*`, sqlWildcardCount(v[0]));
      }
    }
  }
  return { walked, counts, text, views, maskErrors };
}

function analyze(repoRoot: string): Population {
  const tsFiles: string[] = [];
  walkFiles(repoRoot, "src", /\.tsx?$/, new Set<string>(), tsFiles);
  const pyFiles: string[] = [];
  walkFiles(repoRoot, "analytics-service", /\.py$/, PY_SKIP_DIRS, pyFiles);
  return {
    ts: scanCode(repoRoot, tsFiles.sort(), "ts", TS_TOKEN_RE, TS_WILDCARDS),
    py: scanCode(repoRoot, pyFiles.sort(), "py", PY_TOKEN_RE, PY_WILDCARDS),
    sql: scanSql(repoRoot),
  };
}

/** Every problem with how `corpus` is covered by `census`. Empty means the census is satisfied. */
function judge(label: string, corpus: Corpus, census: CensusMap): string[] {
  const problems: string[] = [];
  const legal = LEGAL_CLASSES.join(", ");

  for (const [key, found] of [...corpus.counts.entries()].sort()) {
    const [file, token] = key.split("::");
    const entry = census[key];
    if (!entry) {
      problems.push(
        `unclassified: ${file} names computed_at through ${token} ${found}x and has no ${label} CENSUS row; classify it on purpose (legal classes: ${legal})`,
      );
    } else if (entry.count !== found) {
      problems.push(`count: ${file} ${token} is classified ${entry.class} at ${entry.count} but the walk found ${found}`);
    }
  }

  for (const [key, entry] of Object.entries(census)) {
    const [file, token] = key.split("::");
    if (!corpus.counts.has(key)) {
      problems.push(`stale: ${label} CENSUS row ${file} ${token} (${entry.class}, ${entry.count}) names a pair the walk no longer finds`);
    }
    if (!(LEGAL_CLASSES as readonly string[]).includes(entry.class)) {
      problems.push(`class: ${file} ${token} has "${entry.class}", outside the closed class set (${legal})`);
    }
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      problems.push(`count: ${file} ${token} has a non-positive count ${entry.count}`);
    }
    if (entry.reason.trim().length < 12) {
      problems.push(`reason: ${file} ${token} carries no reason`);
    }
    if ((READER_CLASSES as readonly string[]).includes(entry.class)) {
      if (!entry.reason.includes("NULL arm:")) {
        problems.push(`reason: ${file} ${token} is ${entry.class} and its reason does not name the NULL arm (start it with "NULL arm:")`);
      }
      const text = corpus.text.get(file);
      if (entry.arm === undefined) {
        problems.push(`arm: ${file} ${token} is ${entry.class} and carries no arm to pin`);
      } else if (text !== undefined && corpus.counts.has(key)) {
        const found = typeof entry.arm === "string" ? text.includes(entry.arm) : entry.arm.test(text);
        if (!found) problems.push(`arm: ${file} ${token} (${entry.class}) no longer contains its NULL arm ${String(entry.arm)}`);
      }
    }
  }
  return problems;
}

function judgeSql(sql: SqlCorpus, census: CensusMap = SQL_CENSUS): string[] {
  return [...sql.maskErrors.map((e) => `mask: ${e}; a SQL file that cannot be lexed cannot be censused`), ...judge("SQL", sql, census)];
}

function classCounts(census: CensusMap): string {
  const byClass = new Map<string, number>();
  for (const e of Object.values(census)) byClass.set(e.class, (byClass.get(e.class) ?? 0) + 1);
  return [...byClass.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ");
}

describe("computed_at reader census (Phase 238 plan 08, SC-1)", () => {
  const pop = analyze(REPO_ROOT);

  it("every TypeScript reader of the column is classified, with an exact count and a pinned NULL arm", () => {
    const problems = judge("TS", pop.ts, TS_CENSUS);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every Python reader of the column is classified, with an exact count and a pinned NULL arm", () => {
    const problems = judge("Python", pop.py, PY_CENSUS);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every SQL function and view that names the column is classified, and every SQL file lexes", () => {
    const problems = judgeSql(pop.sql);
    expect(problems, problems.join("\n")).toEqual([]);
    console.info(
      `computed-at-reader-census: ts walked=${pop.ts.walked.length} pairs=${pop.ts.counts.size} (${classCounts(TS_CENSUS)}) | ` +
        `py walked=${pop.py.walked.length} pairs=${pop.py.counts.size} (${classCounts(PY_CENSUS)}) | ` +
        `sql files=${pop.sql.walked.length} views=${pop.sql.views.length} pairs=${pop.sql.counts.size} (${classCounts(SQL_CENSUS)})`,
    );
  });

  it("anti-vacuity: each corpus is above its recorded floor", () => {
    expect(pop.ts.walked.length, "TS files walked").toBeGreaterThanOrEqual(FLOORS.tsWalked);
    expect(pop.ts.counts.size, "TS pairs found").toBeGreaterThanOrEqual(FLOORS.tsPairs);
    expect(Object.keys(TS_CENSUS).length, "TS pairs classified").toBeGreaterThanOrEqual(FLOORS.tsPairs);
    expect(pop.py.walked.length, "Python files walked").toBeGreaterThanOrEqual(FLOORS.pyWalked);
    expect(pop.py.counts.size, "Python pairs found").toBeGreaterThanOrEqual(FLOORS.pyPairs);
    expect(Object.keys(PY_CENSUS).length, "Python pairs classified").toBeGreaterThanOrEqual(FLOORS.pyPairs);
    expect(pop.sql.walked.length, "SQL function files walked").toBeGreaterThanOrEqual(FLOORS.sqlFiles);
    expect(pop.sql.counts.size, "SQL pairs found").toBeGreaterThanOrEqual(FLOORS.sqlPairs);
    expect(Object.keys(SQL_CENSUS).length, "SQL pairs classified").toBeGreaterThanOrEqual(FLOORS.sqlPairs);
    expect(pop.sql.views.length, "SQL views found in the baseline").toBeGreaterThanOrEqual(FLOORS.sqlViews);
  });

  it("anti-vacuity: the class set the maps use is exactly the legal set, and the live wildcard embed is seen", () => {
    const used = new Set([...Object.values(TS_CENSUS), ...Object.values(PY_CENSUS), ...Object.values(SQL_CENSUS)].map((e) => e.class));
    expect([...used].sort()).toEqual([...LEGAL_CLASSES].sort());
    // The embed is invisible to a token scan; the second pattern is the only thing that sees it.
    expect(pop.ts.counts.get("src/lib/queries.ts::strategy_analytics(*)")).toBe(1);
  });

  it("233's FRESH-02 prober arm reads allocator_equity_derived, not strategy_analytics (other-table, outside the corpora)", () => {
    const rel = "scripts/prod-prober/arms/freshness.mjs";
    const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
    expect(src).toContain("allocator_equity_derived");
    expect(src, `${rel} now names strategy_analytics: classify it in the census`).not.toMatch(/strategy_analytics/);
  });

  describe("self-test: the census can fire (planted files in a temp directory)", () => {
    function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
      const dir = mkdtempSync(join(tmpdir(), "computed-at-census-selftest-"));
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

    it("an unclassified TypeScript reader fails, naming the file, token, count and the legal classes", () => {
      withPlanted(
        { "src/lib/planted-reader.ts": "export const x = (r: { computed_at: string | null }) => r.computed_at.slice(0, 4) + r.computed_at;\n" },
        (dir) => {
          const problems = judge("TS", analyze(dir).ts, {}).join("\n");
          expect(problems).toContain("unclassified: src/lib/planted-reader.ts names computed_at through computed_at 3x");
          expect(problems).toContain(LEGAL_CLASSES.join(", "));
        },
      );
    });

    it("an unclassified Python reader fails, including one in a select list with no quoted key", () => {
      withPlanted(
        {
          "analytics-service/services/planted_reader.py":
            'def read(sb):\n    return sb.table("strategy_analytics").select("data_quality_flags, computed_at").execute()\n',
        },
        (dir) => {
          const problems = judge("Python", analyze(dir).py, {}).join("\n");
          expect(problems).toContain("unclassified: analytics-service/services/planted_reader.py names computed_at through computed_at 1x");
        },
      );
    });

    it("an unclassified SQL function and an unclassified view fail", () => {
      withPlanted(
        {
          "supabase/schema/functions/planted_fn.sql":
            "CREATE OR REPLACE FUNCTION public.planted_fn() RETURNS timestamptz LANGUAGE sql AS $$ SELECT sa.computed_at FROM strategy_analytics sa $$;\n",
          "supabase/schema/baseline.sql":
            'CREATE VIEW "public"."planted_view" AS SELECT "sa"."computed_at" AS "analytics_computed_at" FROM "public"."strategy_analytics" "sa";\n',
        },
        (dir) => {
          const planted = analyze(dir).sql;
          const problems = judge("SQL", planted, {}).join("\n");
          expect(problems).toContain("unclassified: supabase/schema/functions/planted_fn.sql names computed_at through computed_at 1x");
          expect(problems).toContain("unclassified: supabase/schema/baseline.sql names computed_at through view:planted_view 1x");
          expect(planted.views).toEqual(["planted_view"]);
        },
      );
    });

    it("a planted wildcard embed, table-level select, hinted embed and SQL alias wildcard each fail", () => {
      withPlanted(
        {
          "src/lib/wild-embed.ts": 'export const q = (sb: any) => sb.from("strategies").select(`*, strategy_analytics (*)`);\n',
          "src/lib/wild-hinted.ts": 'export const q = (sb: any) => sb.from("strategies").select(`id, strategy_analytics!inner (*)`);\n',
          "src/lib/wild-table.ts": 'export const q = (sb: any) => sb.from("strategy_analytics").select("*");\n',
          "analytics-service/services/wild.py": 'def q(sb):\n    return sb.table("strategy_analytics").select("*").execute()\n',
          "supabase/schema/functions/wild_fn.sql":
            "CREATE OR REPLACE FUNCTION public.wild_fn() RETURNS SETOF strategy_analytics LANGUAGE sql AS $$ SELECT sa.* FROM strategy_analytics sa $$;\n",
        },
        (dir) => {
          const planted = analyze(dir);
          const ts = judge("TS", planted.ts, {}).join("\n");
          expect(ts).toContain("src/lib/wild-embed.ts names computed_at through strategy_analytics(*) 1x");
          expect(ts).toContain("src/lib/wild-hinted.ts names computed_at through strategy_analytics(*) 1x");
          expect(ts).toContain("src/lib/wild-table.ts names computed_at through from(strategy_analytics).select(*) 1x");
          expect(judge("Python", planted.py, {}).join("\n")).toContain("wild.py names computed_at through table(strategy_analytics).select(*) 1x");
          expect(judge("SQL", planted.sql, {}).join("\n")).toContain("wild_fn.sql names computed_at through strategy_analytics.* 1x");
        },
      );
    });

    it("a mention only inside a comment adds no pair, in any of the three corpora", () => {
      withPlanted(
        {
          "src/lib/commented.ts": "/* computed_at is read here */\n// computedAt too, and strategy_analytics (*)\nexport const x = 1;\n",
          "analytics-service/services/commented.py": '# computed_at is read here\ndef f():\n    return 1  # "computed_at" again\n',
          "supabase/schema/functions/commented.sql":
            "-- sa.computed_at is read here\n/* and here: computed_at */\nSELECT 'computed_at' AS k;\n",
        },
        (dir) => {
          const planted = analyze(dir);
          expect(planted.ts.walked).toEqual(["src/lib/commented.ts"]);
          expect(planted.py.walked).toEqual(["analytics-service/services/commented.py"]);
          expect(planted.sql.walked).toEqual(["supabase/schema/functions/commented.sql"]);
          expect(planted.ts.counts.size + planted.py.counts.size + planted.sql.counts.size).toBe(0);
          expect([...judge("TS", planted.ts, {}), ...judge("Python", planted.py, {}), ...judgeSql(planted.sql, {})]).toEqual([]);
        },
      );
    });

    it("a test file is not walked, in either language", () => {
      withPlanted(
        {
          "src/lib/thing.test.ts": "export const x = (r: { computed_at: string }) => r.computed_at;\n",
          "src/lib/__tests__/helper.ts": "export const y = (r: { computed_at: string }) => r.computed_at;\n",
          "src/lib/fixtures/data.ts": "export const z = { computed_at: 'x' };\n",
          "analytics-service/tests/test_x.py": 'ROW = {"computed_at": "x"}\n',
          "analytics-service/.venv/lib/site.py": 'ROW = {"computed_at": "x"}\n',
        },
        (dir) => {
          const planted = analyze(dir);
          expect(planted.ts.walked).toEqual([]);
          expect(planted.py.walked).toEqual([]);
        },
      );
    });

    it("a stale entry (a classified pair the tree no longer has) fails", () => {
      withPlanted({ "src/lib/other.ts": "export const x = 1;\n" }, (dir) => {
        const problems = judge("TS", analyze(dir).ts, {
          "src/lib/gone.ts::computed_at": { count: 1, class: "plumbing", reason: "a reader that no longer exists in this tree" },
        }).join("\n");
        expect(problems).toContain("stale: TS CENSUS row src/lib/gone.ts computed_at");
      });
    });

    it("a count change fails with both counts", () => {
      withPlanted({ "src/lib/two.ts": "export const x = (r: { computed_at: string }) => [r.computed_at, r.computed_at];\n" }, (dir) => {
        const problems = judge("TS", analyze(dir).ts, {
          "src/lib/two.ts::computed_at": { count: 1, class: "plumbing", reason: "classified when there was one mention" },
        }).join("\n");
        expect(problems).toContain("src/lib/two.ts computed_at is classified plumbing at 1 but the walk found 3");
      });
    });

    it("an illegal class and an empty reason fail", () => {
      withPlanted({ "src/lib/odd.ts": "export const x = { computed_at: null };\n" }, (dir) => {
        const problems = judge("TS", analyze(dir).ts, {
          "src/lib/odd.ts::computed_at": { count: 1, class: "whatever" as unknown as Klass, reason: "" },
        }).join("\n");
        expect(problems).toContain('class: src/lib/odd.ts computed_at has "whatever"');
        expect(problems).toContain("reason: src/lib/odd.ts computed_at carries no reason");
      });
    });

    it("a reader class without a named NULL arm, without an arm, or whose arm is gone fails", () => {
      const body = "export const d = (r: { computed_at: string | null }) => (r.computed_at ? r.computed_at.slice(0, 10) : null);\n";
      withPlanted({ "src/lib/render.ts": body }, (dir) => {
        const ts = analyze(dir).ts;
        const reason = "NULL arm: a NULL date renders nothing";
        const noMarker = judge("TS", ts, {
          "src/lib/render.ts::computed_at": { count: 3, class: "reader-render", reason: "renders the date", arm: "r.computed_at ? " },
        }).join("\n");
        expect(noMarker).toContain('its reason does not name the NULL arm (start it with "NULL arm:")');
        const noArm = judge("TS", ts, {
          "src/lib/render.ts::computed_at": { count: 3, class: "reader-render", reason },
        }).join("\n");
        expect(noArm).toContain("is reader-render and carries no arm to pin");
        const goneArm = judge("TS", ts, {
          "src/lib/render.ts::computed_at": { count: 3, class: "reader-render", reason, arm: "r.computed_at ?? \"\"" },
        }).join("\n");
        expect(goneArm).toContain("no longer contains its NULL arm");
        expect(
          judge("TS", ts, { "src/lib/render.ts::computed_at": { count: 3, class: "reader-render", reason, arm: "r.computed_at ? " } }),
        ).toEqual([]);
      });
    });

    it("a SQL file that cannot be lexed is a problem, never a skipped file", () => {
      withPlanted({ "supabase/schema/functions/broken.sql": "SELECT 'unterminated, computed_at;\n" }, (dir) => {
        const problems = judgeSql(analyze(dir).sql, {}).join("\n");
        expect(problems).toContain("mask: supabase/schema/functions/broken.sql: unterminated ' string literal");
      });
    });
  });
});
