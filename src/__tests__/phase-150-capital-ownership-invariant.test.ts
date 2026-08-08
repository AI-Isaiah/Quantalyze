import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// P2c reads the CI seed's ownership fixtures BY VALUE. `seed-demo-profiles` is
// the pure-data half of the seed (no supabase-js import, no side effects — the
// RT-J08 split that already lets Playwright specs import it), so pulling it into
// a vitest module graph costs nothing and cannot connect to anything.
import {
  ALLOCATOR_ACTIVE,
  ALLOCATOR_COLD,
  ALLOCATOR_STALLED,
  STRATEGY_PROFILES,
} from "../../scripts/seed-demo-profiles";

/**
 * Phase 150 (OWN-03 / OWN-05) — the capital-ownership hard-invariant structural
 * gate.
 *
 * WHY THIS EXISTS: D-03 says "no code path creates an allocation from a
 * team-review strategy". That is a claim about the WHOLE REPOSITORY, not about
 * any one function's return value — and the phase discharges it in five places
 * at once: one predicate (`isAllocatable`), one write route, two legacy
 * browser-direct write sites left standing behind a DB trigger, one atomic flip
 * RPC, and one render gate. Every one of those is individually correct today.
 * The failure mode this file exists for is the SIXTH one — the write site, the
 * predicate copy, the widened trigger, the `current_weight` payload field or the
 * un-gated tag that somebody adds next quarter, in a PR whose own tests are all
 * green because they only ever exercise the code the PR author was thinking
 * about.
 *
 * WHY A STRUCTURAL LAYER AT ALL (the load-bearing argument, measured not
 * assumed). This phase already ships ~200 behavioural assertions across the
 * allocation route, the adapter, the two dialogs, HoldingsTable and
 * StrategyTable. Every one of them pins a RETURN VALUE or a RENDER OUTCOME for
 * an input the spec itself constructs. None of them can see:
 *
 *   - a FOURTH `portfolio_strategies` write appearing in a component no spec in
 *     this phase mounts. MEASURED (ledger M2): adding one left 137 test files /
 *     1889 assertions across the whole allocations tree and
 *     `src/components/portfolio` GREEN. Only a repo walk sees it.
 *   - the migration's trigger widening from `BEFORE INSERT` to
 *     `BEFORE INSERT OR UPDATE`. MEASURED (ledger M3): no vitest file executes
 *     SQL at all, so the entire TypeScript suite is structurally incapable of
 *     observing it. The DB-tier control only runs against a live database.
 *
 * The converse is recorded with equal weight, because a gate that claims more
 * than it does is worse than no gate: for the predicate flip (M1) this file
 * stayed 15/15 GREEN and the behavioural suites were the sole control, and for
 * M4/M5/M6 both layers fired. Two of six mutations are caught here ALONE; that
 * asymmetry, not the count, is this file's justification.
 *
 * ⛔ SCOPE — WHAT THIS FILE DOES NOT COVER. These are SOURCE facts only. The
 * DB-tier behaviour of the three triggers, the CHECK constraint and the flip
 * RPC is owned by the SQL suite (`supabase/tests/test_capital_ownership_*.sql`
 * + `test_weight_snapshot_seed_secdef.sql`), which CI runs under
 * `psql -v ON_ERROR_STOP=1`. A pin here proves the migration SAYS the right
 * thing; only that suite proves the database DOES it. This division is
 * deliberate and follows MEMORY `reference_db_test_ci_wiring`: live-DB vitest
 * files never run in CI, so a "DB assertion" written here would be a claim with
 * no enforcement behind it.
 *
 * WHAT IS PINNED (one numbered pin per `it()`, so a failure names the offender):
 *
 *   P1. SINGLE-SOURCE PREDICATE. Repo walk: the literal `own_capital` appears in
 *       comment-stripped production `src/**` in EXACTLY ONE file,
 *       `src/lib/capital-ownership.ts`. Routes, queries, the adapter and every
 *       component import `OWN_CAPITAL` / `isAllocatable` instead of re-spelling
 *       it. (T-150-07 — predicate drift is how a fail-closed check quietly
 *       becomes fail-open.)
 *   P2. WRITE CENSUS. Repo walk: the production files that create a
 *       `portfolio_strategies` row are EXACTLY the sanctioned three. Two of them
 *       are shipped BROWSER-DIRECT writes that predate this phase and are gated
 *       by the DB trigger, not by review vigilance — which is precisely why the
 *       census is rot-guarded in BOTH directions: a new offender fails, and an
 *       allowlisted file that STOPS matching fails too (a silently-shrinking
 *       allowlist is how a census stops being a census).
 *   P3. MONEY NON-GOAL. The allocation route's comment-stripped source contains
 *       `allocated_amount` and the composite `onConflict` target verbatim, and
 *       contains NO `current_weight`. That column has no writer anywhere in the
 *       repo, and two analytics consumers substitute `1.0` for a NULL weight and
 *       renormalize — so a write here would silently distort
 *       `portfolio_returns_series` and match scoring (150-RESEARCH § Schema
 *       Findings 2). The Weight column is render-derived instead (D-12-B).
 *   P4. MIGRATION SHAPE (as-built, incl. the rev-2/rev-3 amendments). The
 *       migration exists; the CHECK carries both members; BOTH D-03-A predicate
 *       arms survive (the unconditional `team_review` comparison AND the
 *       owner-equality conjunct with its `portfolios` lookup — dropping the
 *       conjunct deletes the three shipped third-party allocation paths); and
 *       ALL THREE triggers are present with their exact event scopes:
 *       INSERT-only on the create side (no `OR UPDATE` — that would break the
 *       shipped alias write on every legacy row), `UPDATE OF strategy_id` on the
 *       repoint side, `UPDATE OF capital_ownership` on the mark-transition side.
 *       Plus the flip RPC's owner precheck (three `auth.uid()` occurrences) and
 *       its load-bearing DELETE-before-UPDATE order.
 *   P4c. THE CROSS-LAYER RAISE CONTRACT (151 review A5). The D-03-A RAISE format
 *       literal still contains `capital_ownership=%` fed the COALESCEd mark, and
 *       both browser-direct clients still read that token. Their 23514 arms are
 *       separated by a SUBSTRING OF A PL/pgSQL FORMAT STRING and by nothing
 *       else; a reword in this in-place-amended migration would send every
 *       third-party allocator down the owner-voiced branch — "mark it in My
 *       Strategies first" for a row they neither own nor can reach — with the
 *       whole suite green.
 *   P4b. THE SEED-TRIGGER REPAIR SURVIVES. `20260806130000` made the two
 *       `weight_snapshots` seed trigger functions `SECURITY DEFINER`, repairing a
 *       defect that had been live in PRODUCTION since 2026-04-16 (every
 *       `authenticated` INSERT into `portfolio_strategies` aborted with `42501`).
 *       Reverting it re-breaks the entire OWN-03 money path plus the two legacy
 *       components — from a file this phase's authors would not think to re-read.
 *   P5. AFFORDANCE GATING (D-12-A union rule). `toStrategyRows`' extracted body
 *       derives `capitalOwnership` through the IMPORTED vocabulary
 *       (`isAllocatable` / `OWN_CAPITAL`) with no ad-hoc literal, and the union
 *       row set is never FILTERED — an unmarked positioned row keeps its row and
 *       its money. Separately, HoldingsTable's action cell renders the
 *       Allocate/Edit control only inside an `isOwnCapital` guard window.
 *   P6. ATOMIC FLIP. The ownership route's comment-stripped source calls
 *       `flip_capital_ownership_to_team_review` and contains NO row-removal
 *       method call. Two sequential PostgREST statements can strand a position
 *       if the second fails; the RPC is one plpgsql body and therefore one
 *       transaction (T-150-16).
 *   P7. CACHE ISOLATION, EXTENDED. The v2 factsheet page still calls
 *       `unstable_cache` exactly once, and the cache CALLBACK carries no
 *       ownership token. The effective key is id-only, so anything the callback
 *       builds is shared with every subsequent reader of that id for the full
 *       TTL — an owner-derived mark inside it is a disclosure bug (this is the
 *       phase-148 property, re-asserted against THIS phase's new columns).
 *   P8. TAG GATE (UI-SPEC invariant 3). Every `<OwnershipTag` mount in
 *       `StrategyTable.tsx` sits inside a guard window containing
 *       `visibility === "owner-all-statuses"`, and the `"published-only"`
 *       destructuring default is still present. This is occurrence-counted: N
 *       mounts must yield N guarded windows. Load-bearing because public rows
 *       genuinely ARRIVE mark-populated — `shapeRankingRows` splats the whole
 *       strategy row — so this render gate is the ONLY barrier between an
 *       owner's capital declaration and an anonymous `/browse` reader
 *       (T-150-39).
 *   P9. OWN-05 DISCLOSURE CARVE-OUT. The position half's name chain prefers the
 *       OWNER's real name only via the MARKED-SET record (`owned?.name`), never
 *       via the raw joined strategy row. The marked set is `user_id`-filtered
 *       server-side, so the carve-out is structurally unreachable for
 *       third-party rows; a bare `s.name` there would pair a manager's real name
 *       with their codename on an exploratory-tier row and defeat pseudonymity.
 *  P10. ANTI-VACUITY. The walk really found production files, the strippers
 *       really stripped, the function extractor really found a body and really
 *       scoped it, and each repo-walk census is non-empty. An empty offender
 *       list must mean CLEAN, never BLIND.
 *
 *  A missing pinned source (rename/move) is a FAILURE, not a skip (Rule 12): the
 *  invariant must travel with the file, never silently stop being enforced.
 *
 * Comment hygiene: every scan strips comments BEFORE matching, and that is
 * load-bearing here rather than decorative — FOUR times over, and each one would
 * turn a healthy tree red or a broken tree green:
 *   - the allocation route's docblock names `current_weight` three times while
 *     explaining why it is never written, so P3's negative would self-invalidate
 *     unstripped;
 *   - the ownership route's docblock and `//` prose name `own_capital`, as do
 *     `finalize-wizard/route.ts` and `types.ts` — unstripped, P1's "exactly one
 *     file" walk would report four offenders on a perfectly healthy tree;
 *   - `StrategyTable.tsx`'s JSX comment beside the tag mount spells out both
 *     `visibility` and `"published-only"`, so P8 must not be able to pass on
 *     prose alone;
 *   - the flip RPC's `--` prose argues about `auth.uid()` at length (why the
 *     owner precheck exists, why the two statement predicates are kept as
 *     defence in depth), so P4's `toBe(3)` occurrence COUNT is meaningless
 *     without SQL stripping — the raw body carries far more.
 * Every regex used for a count SELF-PINS first (the phase-32 idiom).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Rule-9 NON-VACUITY — the mutation campaign (run 2026-08-06)
 *
 * SIX semantic mutations at SIX INDEPENDENT production sites, each RUN, each
 * failure OBSERVED and pasted below verbatim, each reverted by RE-EDITING the
 * mutated line (never a file-level `git checkout --`, never `git stash`, never
 * `git clean`). `git status --short` is empty afterwards. What stayed GREEN is
 * recorded too — that asymmetry is this file's entire justification. Nothing
 * here is a prediction: a mutation that was not run would be recorded SKIPPED,
 * never "caught".
 *
 *   M1 — src/lib/capital-ownership.ts:43, `return mark === OWN_CAPITAL;` →
 *        `return mark !== null;`. The fail-CLOSED predicate becomes fail-OPEN:
 *        a `team_review` mark now reports allocatable.
 *          × capital-ownership.test.ts › team_review is NOT allocatable (a
 *            team's key can never join the allocation)
 *            AssertionError: expected true to be false // Object.is equality
 *          × capital-ownership.test.ts › undefined (field absent from the row)
 *            is NOT allocatable
 *            AssertionError: expected true to be false // Object.is equality
 *          × capital-ownership.test.ts › accepts the exported constants at the
 *            type level and agrees with the literals
 *            AssertionError: expected true to be false // Object.is equality
 *          × capital-ownership.test.ts › does not fall open for an unknown value
 *            cast in from an untyped DB read
 *            AssertionError: expected true to be false // Object.is equality
 *          × strategies-row-adapter.test.ts › fails CLOSED: a marked-set row
 *            carrying a garbled mark is NOT treated as own-capital
 *            AssertionError: expected 'own_capital' to be null
 *          × strategies-row-adapter.test.ts › fails CLOSED on the POSITIONED arm
 *            too — membership alone is not the predicate
 *            AssertionError: expected 'own_capital' to be null
 *                                        (2 files, 6 failed | 51 passed)
 *        MEASURED: THIS GATE STAYED 15/15 GREEN — P1 pins WHERE the literal
 *        lives, not what the predicate returns. Recorded honestly rather than
 *        claimed as a catch: for M1 the behavioural suites are the sole
 *        control, which is exactly why the phase ships both layers. The
 *        complement is M2 and M3 below, where the behavioural suites are blind
 *        and this file is the sole control.
 *
 *   M2 (second member) — src/components/portfolio/RemoveStrategyButton.tsx, add
 *        a fourth `portfolio_strategies` write
 *        (`await supabase.from("portfolio_strategies").upsert({ portfolio_id: portfolioId, strategy_id: strategyId });`)
 *        to a component NO spec in this phase mounts. P2 RED, naming the file:
 *          × P2 — exactly three production files create a portfolio_strategies
 *            row, and they are the sanctioned three
 *            AssertionError: expected [ …(4) ] to deeply equal [ …(3) ]
 *              [
 *                "src/app/api/portfolio-strategies/allocation/route.ts",
 *                "src/components/portfolio/AddToPortfolio.tsx",
 *                "src/components/portfolio/MigrationWizard.tsx",
 *            +   "src/components/portfolio/RemoveStrategyButton.tsx",
 *              ]
 *                                                    (1 failed | 14 passed)
 *        MEASURED ASYMMETRY — the whole reason this pin is a repo WALK: under
 *        the same mutation `src/app/(dashboard)/allocations` +
 *        `src/components/portfolio` stayed fully GREEN, 137 files / 1889
 *        passed. No behavioural spec mounts that component's write path, so
 *        nothing behavioural can observe a new insert site appearing — while
 *        the blast radius is a `portfolio_strategies` row minted outside the
 *        invariant's review surface. For M2 this gate is the SOLE control.
 *
 *   M3 — supabase/migrations/20260806120000_strategies_capital_ownership.sql:346,
 *        `BEFORE INSERT ON public.portfolio_strategies` →
 *        `BEFORE INSERT OR UPDATE ON public.portfolio_strategies`, on the REAL
 *        file (a scratch-buffer copy would not be a mutation of production).
 *        P4 RED — the positive arm fires first, so the pasted failure is the
 *        `toContain` rather than the `not.toContain("OR UPDATE")` twin:
 *          × P4 — the D-03-A create-side trigger is INSERT-scoped, with no
 *            blanket UPDATE arm
 *            AssertionError: expected 'CREATE TRIGGER trg_portfolio_strategi…'
 *            to contain 'BEFORE INSERT ON public.portfolio_str…'
 *            - BEFORE INSERT ON public.portfolio_strategies
 *            + CREATE TRIGGER trg_portfolio_strategies_own_capital_only
 *            +   BEFORE INSERT OR UPDATE ON public.portfolio_strategies
 *            +   FOR EACH ROW
 *            +   EXECUTE FUNCTION public.guard_allocation_requires_own_capital();
 *                                                    (1 failed | 14 passed)
 *        MEASURED: the vitest suite is structurally incapable of seeing this —
 *        no TS test executes SQL. The DB-tier control is the SQL suite's
 *        legacy-alias case, which only runs against a live database. Between
 *        merges, this pin is the only thing standing between that edit and
 *        every pre-existing PROD position losing its alias write.
 *
 *   M4 — src/app/api/portfolio-strategies/allocation/route.ts:292, add
 *        `current_weight: 0.5,` to the upsert payload. P3 RED:
 *          × P3 — the allocation route writes the money column and never the
 *            derived weight column
 *            AssertionError: expected 'import { NextRequest, NextResponse } …'
 *            not to contain 'current_weight'
 *                                                    (1 failed | 14 passed)
 *        MEASURED, and recorded against my own expectation: `route.test.ts`
 *        ALSO reddens, 3 of 86 — its exact-payload `toEqual` case, the D-13
 *        second-allocate case, and its OWN route-local source pin ("contains
 *        zero non-comment occurrences of current_weight"). That third one is a
 *        deliberate duplicate of P3 living beside the code it guards; the two
 *        are kept because they fail for different readers (a route author sees
 *        the local one, a phase reviewer sees this one).
 *        `strategies-row-adapter.test.ts` stayed GREEN, 1 file passed — the
 *        adapter never reads the column, so a WRITE to it is invisible
 *        downstream, which is exactly what makes the silent-corruption story
 *        (analytics substituting 1.0 for a NULL weight and renormalizing)
 *        possible in the first place.
 *
 *   M5 — src/app/api/strategies/[id]/ownership/route.ts:239-247, replace the
 *        single `flip_capital_ownership_to_team_review` RPC call with two
 *        sequential PostgREST statements (`.update({ capital_ownership: mark })`
 *        on strategies, then `.delete()` on portfolio_strategies) — i.e. re-open
 *        the exact stranded-position hole the RPC exists to close. P6 RED:
 *          × P6 — the confirmed flip goes through the ONE transactional RPC and
 *            the route removes no row itself
 *            AssertionError: expected 'import { NextRequest, NextResponse } …'
 *            to contain 'flip_capital_ownership_to_team_review'
 *                                        (2 files, 8 failed | 47 passed)
 *        MEASURED: `ownership/route.test.ts` ALSO reddens, 7 cases — the
 *        call-shape assertion ("calls flip_… and never a two-statement
 *        removal"), the audit-metadata case, the 404/500/500 RPC-result arms,
 *        and both of its source pins. Recorded rather than hidden: both layers
 *        catch M5. They DIVERGE at M2 and M3, which is why all six were run.
 *
 *   M6 — src/components/strategy/StrategyTable.tsx:1018, delete the
 *        `{visibility === "owner-all-statuses" && (` guard from the
 *        `<OwnershipTag>` mount, rendering the tag unconditionally. P8 RED:
 *          × P8 — every OwnershipTag mount in the shared table sits behind the
 *            owner-visibility guard
 *            AssertionError: expected '        {s.status !== "published" && …'
 *            to contain 'visibility === "owner-all-statuses"'
 *                                        (2 files, 3 failed | 33 passed)
 *        MEASURED: `StrategyTable.visibility.test.tsx` ALSO reddens, 2 cases —
 *          × the DEFAULT (public-shape) mount of a published + own_capital row
 *            renders NO ownership tag
 *            AssertionError: expected <span …(1)></span> to be null
 *          × a team-review row shows the muted tag on the owner mount and
 *            nothing on the public one
 *            AssertionError: expected <span …(1)></span> to be null
 *        Both layers catch M6 BY DESIGN: the render half is Plan 06's
 *        behavioural pin and this is its structural twin. The guard is the ONLY
 *        barrier — public rows genuinely arrive mark-populated via the
 *        `shapeRankingRows` splat — and a single-layer defence on a disclosure
 *        boundary is not a defence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ROOT = join(__dirname, "..", "..");

/** The ONE module allowed to spell the mark literal. */
const CAPITAL_OWNERSHIP = "src/lib/capital-ownership.ts";
/** The phase's money write. */
const ALLOCATION_ROUTE = "src/app/api/portfolio-strategies/allocation/route.ts";
/** The retro-mark write, whose destructive arm must be one transaction. */
const OWNERSHIP_ROUTE = "src/app/api/strategies/[id]/ownership/route.ts";
/** The D-12-A union adapter. */
const ROW_ADAPTER =
  "src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts";
/** The money surface that renders the affordance. */
const HOLDINGS_TABLE =
  "src/app/(dashboard)/allocations/components/HoldingsTable.tsx";
/** The SHARED table mounted by both the owner surface and the public ones. */
const STRATEGY_TABLE = "src/components/strategy/StrategyTable.tsx";
/** The cached factsheet page (phase-148's property, re-asserted for 150). */
const FACTSHEET_V2_PAGE = "src/app/factsheet/[id]/v2/page.tsx";
/** The D-03-A migration. */
const MIGRATION =
  "supabase/migrations/20260806120000_strategies_capital_ownership.sql";
/** The SECURITY DEFINER seed-trigger repair the money path depends on. */
const SEED_SECDEF_MIGRATION =
  "supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql";

/**
 * The complete set of files that CREATE a `portfolio_strategies` row.
 *
 * Two of these predate Phase 150 and write straight from the browser under the
 * user's own JWT — they are gated by the D-03-A trigger at the table layer, NOT
 * by anything in TypeScript and not by review vigilance. That is the whole
 * design: the invariant holds against every path, including a raw PostgREST
 * call, so the census does not have to chase call sites forever. It does have to
 * stay a census, which is what P2's two-directional rot-guard enforces.
 *
 * ⚠️ `scripts/` IS PART OF THE CENSUS (added by the F1 review, 2026-08-08). The
 * original census walked `src/` only and named `seed-full-app-demo.ts` in the
 * migration header as "the demo seed". That was the wrong seed twice over:
 * `seed-full-app-demo.ts` is manual-only (CHANGELOG.md:2835; a knip.json orphan
 * entry) and has never run against a shared DB, while
 * `scripts/seed-demo-data.ts:1069` — a FOURTH position writer that appeared in
 * NO census — is what `.github/workflows/ci.yml:1600` runs on every seed-gated
 * e2e job. A seed writer is not "not production": it is the only writer whose
 * rows hit the D-03-A triggers on every CI run, so a seed edit that trips a
 * trigger arm reddens `e2e-seeded` with a bare Postgres 23514 and no obvious
 * cause. P2b + P2c pin the two fixture properties that keep it green.
 */
const SEED_DEMO_DATA = "scripts/seed-demo-data.ts";
const SEED_FULL_APP_DEMO = "scripts/seed-full-app-demo.ts";

const SANCTIONED_POSITION_WRITERS: readonly string[] = [
  ALLOCATION_ROUTE,
  "src/components/portfolio/AddToPortfolio.tsx",
  "src/components/portfolio/MigrationWizard.tsx",
  SEED_DEMO_DATA,
  SEED_FULL_APP_DEMO,
];

/** The pure-data seed fixture module — strategy owners live here. */
const SEED_DEMO_PROFILES = "scripts/seed-demo-profiles.ts";

/**
 * The seed scripts, as a set. Every one of these is walked for the mark literal
 * (P2b) — a seed that starts writing `capital_ownership` changes which trigger
 * arm its rows meet, and that is a decision, never a drive-by.
 */
const SEED_SCRIPTS: readonly string[] = [
  SEED_DEMO_DATA,
  SEED_FULL_APP_DEMO,
  SEED_DEMO_PROFILES,
];

/** The mark literal. Spelled here (a test) and in exactly one production file. */
const MARK_LITERAL = "own_capital";
/** The PostgREST chain root that identifies a write against the position table. */
const POSITION_TABLE_CHAIN = 'from("portfolio_strategies")';
/** Write methods on a PostgREST chain. Self-pinned in P10. */
const WRITE_METHOD = /\.(insert|upsert)\(/g;
/** The owner-visibility guard, as it appears in the shared table's JSX. */
const OWNER_VISIBILITY_GUARD = 'visibility === "owner-all-statuses"';

/** Read a pinned source fail-loud (missing file → explicit failure, never a skip). */
function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `OWN-03 pinned source is missing: ${relPath}. A rename or move must ` +
        `carry this guard with it — a missing pinned source is a FAILURE, not ` +
        `a skip: the "own capital is the only allocatable mark" invariant would ` +
        `otherwise silently stop being enforced on that file.`,
    );
  }
  return readFileSync(abs, "utf8");
}

/**
 * Strip block comments and `//` line comments so documentation prose can neither
 * redden nor green a scan. Load-bearing four times over — see the header's
 * comment-hygiene note. Line-oriented on purpose (a `//` inside a URL string
 * literal survives, which is harmless: nothing downstream treats a URL as code).
 */
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/**
 * SQL sibling: drop whole-line `--` comments. Deliberately NOT inline-aware —
 * an inline `--` inside a quoted string (the migration's `COMMENT ON` bodies are
 * full of prose) must not be treated as a comment, and every comment in the
 * pinned migration is whole-line.
 */
function stripSqlComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

/** Walk src/ for production sources (no tests, no __tests__, no .d.ts). */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      productionSources(abs, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.d\.ts$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(abs);
  }
  return acc;
}

/**
 * A walk ROOT, resolved fail-loud. `productionSources` would throw a bare
 * ENOENT if a root moved, which reads as infrastructure noise; this says what
 * actually broke. Load-bearing for the `scripts/` root specifically — a scan
 * that silently matches nothing is strictly worse than no scan, because the P2
 * census would then pass by finding neither the offender nor the allowlisted
 * seeds... except it would ALSO fail on the vanished allowlist entries, which
 * is the two-directional property doing its job. This guard just makes the
 * diagnosis one line instead of five.
 */
function walkRoot(relDir: string): string {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) {
    throw new Error(
      `OWN-03 census root is missing: ${relDir}/. The portfolio_strategies ` +
        `write census walks this directory; a root that moved must carry the ` +
        `census with it. A missing root is a FAILURE, not a skip.`,
    );
  }
  return abs;
}

/**
 * Every directory the position-write census walks. `scripts/` is here because
 * `seed-demo-data.ts` writes positions on every seed-gated CI run — see
 * SANCTIONED_POSITION_WRITERS.
 */
const CENSUS_ROOTS: readonly string[] = ["src", "scripts"];

/**
 * Index of the opening brace of a named function's BODY — the first `{` AFTER
 * the paren-balanced parameter list. Naively taking the first `{` after the name
 * is wrong: `toStrategyRows(inputs: StrategyRowAdapterInputs)` is fine but its
 * neighbours destructure, and the helper must stay correct if the signature is
 * ever destructured. Returns -1 when absent.
 */
function bodyBraceIndex(src: string, name: string): number {
  const start = src.indexOf(`function ${name}`);
  if (start === -1) return -1;
  const paren = src.indexOf("(", start);
  if (paren === -1) return -1;
  let i = paren + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.indexOf("{", i);
}

/** Brace-balanced body of a named function declaration. */
function functionBody(src: string, name: string): string {
  const open = bodyBraceIndex(src, name);
  if (open === -1) return "";
  let i = open + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") depth -= 1;
    i += 1;
  }
  return src.slice(open + 1, i - 1);
}

/**
 * Paren-balanced argument list of the FIRST `<token>(` occurrence, then its
 * first TOP-LEVEL argument. For `unstable_cache(...)` that first argument is the
 * cache CALLBACK — the thing whose body decides what gets written into the
 * shared entry. Borrowed verbatim from the phase-148 gate so both files agree on
 * what "inside the cache" means.
 */
function callArgs(src: string, token: string): string {
  const needle = `${token}(`;
  const start = src.indexOf(needle);
  if (start === -1) return "";
  let i = start + needle.length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.slice(start + needle.length, i - 1);
}

function firstArgument(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) return args.slice(0, i).trim();
  }
  return args.trim();
}

/** Occurrences of a literal token in a source. */
function countOccurrences(src: string, token: string): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const hit = src.indexOf(token, from);
    if (hit === -1) return n;
    n += 1;
    from = hit + token.length;
  }
}

/**
 * The single SQL statement that creates a named trigger: from `CREATE TRIGGER
 * <name>` to the terminating `;`. Scoping matters — the migration mentions
 * `BEFORE INSERT` inside a `COMMENT ON FUNCTION` string literal as well, so a
 * file-wide count would be pinning prose. Returns "" when absent.
 */
function triggerStatement(sql: string, triggerName: string): string {
  const start = sql.indexOf(`CREATE TRIGGER ${triggerName}`);
  if (start === -1) return "";
  const end = sql.indexOf(";", start);
  if (end === -1) return "";
  return sql.slice(start, end + 1);
}

/**
 * Body of a `CREATE OR REPLACE FUNCTION public.<name>` up to its `$$;`
 * terminator. Same scoping argument as `triggerStatement`.
 */
function sqlFunctionSource(sql: string, fnName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}`);
  if (start === -1) return "";
  const end = sql.indexOf("$$;", start);
  if (end === -1) return "";
  return sql.slice(start, end);
}

/** Comment-stripped sources, read once. */
const allocationSrc = stripComments(readSource(ALLOCATION_ROUTE));
const ownershipSrc = stripComments(readSource(OWNERSHIP_ROUTE));
const adapterSrc = stripComments(readSource(ROW_ADAPTER));
const holdingsTableSrc = stripComments(readSource(HOLDINGS_TABLE));
const strategyTableSrc = stripComments(readSource(STRATEGY_TABLE));
const factsheetPageSrc = stripComments(readSource(FACTSHEET_V2_PAGE));
const migrationSql = stripSqlComments(readSource(MIGRATION));

// ─────────────────────────────────────────────────────────────────────────
// Layer A — repo walks: one predicate, three writers
// ─────────────────────────────────────────────────────────────────────────

/** Production files whose STRIPPED source spells the mark literal. */
function markLiteralSpellers(): string[] {
  const found: string[] = [];
  for (const abs of productionSources(join(ROOT, "src"))) {
    const src = stripComments(readFileSync(abs, "utf8"));
    if (src.includes(MARK_LITERAL)) found.push(relative(ROOT, abs));
  }
  return found.sort();
}

/**
 * Production files that CREATE a `portfolio_strategies` row.
 *
 * Look-BACK rather than look-forward: in a PostgREST chain the table is named
 * before the method, and the two are frequently on different lines
 * (`allocation/route.ts` puts `.upsert(` on the line after `.from(...)`). A
 * forward window from `.from(` would also sweep up an unrelated `.insert(` on a
 * DIFFERENT chain a few statements later; looking back from the WRITE binds the
 * method to its own chain root.
 */
function positionWriters(): string[] {
  const found: string[] = [];
  const files = CENSUS_ROOTS.flatMap((r) => productionSources(walkRoot(r)));
  for (const abs of files) {
    const src = stripComments(readFileSync(abs, "utf8"));
    WRITE_METHOD.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WRITE_METHOD.exec(src)) !== null) {
      const chain = src.slice(Math.max(0, match.index - 300), match.index);
      if (chain.includes(POSITION_TABLE_CHAIN)) {
        found.push(relative(ROOT, abs));
        break;
      }
    }
  }
  return found.sort();
}

describe("OWN-03 — one predicate, one census", () => {
  it("P1 — the mark literal is spelled in EXACTLY ONE production file", () => {
    // The failure this forbids: a second `=== "own_capital"` comparison that
    // drifts from `isAllocatable` — which fails CLOSED for null/unknown values
    // coming off an untyped `text` column. An inline copy written by someone
    // reasoning about the two KNOWN values fails OPEN for the third case, and
    // the third case is the one an attacker or a schema change supplies.
    expect(markLiteralSpellers()).toEqual([CAPITAL_OWNERSHIP]);
  });

  it("P2 — exactly five files across src/ AND scripts/ create a portfolio_strategies row, and they are the sanctioned five", () => {
    // Two-directional rot-guard (the B10 SANCTIONED idiom): a NEW offender
    // fails, and an allowlisted file that stops matching fails too. The second
    // direction is the one that matters over time — a census that can quietly
    // shrink stops being a census, and the two legacy browser-direct writers
    // are exactly the entries a future refactor would drop without noticing.
    //
    // ⛔ The two browser-direct writers are NOT gated in TypeScript. They are
    // gated by `trg_portfolio_strategies_own_capital_only` at the table layer
    // (P4), which is what makes an enumerable census sufficient here rather than
    // a never-ending chase.
    //
    // ⛔ Neither are the two seeds — they write under the SERVICE ROLE, which is
    // BYPASSRLS but NOT bypass-trigger. `scripts/seed-demo-data.ts` is what CI
    // runs (`ci.yml:1600`), so its rows meet these triggers on every seed-gated
    // e2e job. Its survival is a fixture property, pinned by P2b + P2c below.
    expect(positionWriters()).toEqual([...SANCTIONED_POSITION_WRITERS].sort());
  });

  it("P2b — no seed script writes capital_ownership, which is why trigger ARM 1 never fires on seeded rows", () => {
    // ARM 1 (`v_mark = 'team_review'`) is UNCONDITIONAL — it blocks a position
    // for ANYONE, third party included. Every seeded strategy clears it only
    // because no seed sets the column at all, so `v_mark` is NULL. A seed that
    // starts marking strategies is free to do so, but it must then decide what
    // the personas' positions mean — and that decision belongs in a review, not
    // in a red `e2e-seeded` job whose failure reads as an unexplained 23514.
    //
    // Positive control FIRST, so the negative below cannot pass on a file this
    // gate failed to read.
    for (const rel of SEED_SCRIPTS) {
      expect(readSource(rel).length).toBeGreaterThan(0);
    }
    const marking = SEED_SCRIPTS.filter((rel) =>
      stripComments(readSource(rel)).includes("capital_ownership"),
    );
    expect(marking).toEqual([]);
  });

  it("P2c — every seeded strategy owner is disjoint from every seeded portfolio owner, which is why trigger ARM 2 never fires on seeded rows", () => {
    // ARM 2 is owner-scoped: it fires only when
    // `v_strategy_owner = v_portfolio_owner`. The CI seed clears it because its
    // two ownership sets are disjoint — all 8 STRATEGY_PROFILES are MANAGER_*,
    // all three persona portfolios are ALLOCATOR_*. Nothing in the seed asserts
    // that; it is an accident of how the fixtures were written, and accidents
    // rot. Give a persona a self-owned strategy and the D-03-A trigger raises
    // 23514 on the membership upsert.
    //
    // Asserted on the SET, not on the membership mapping: disjointness holds for
    // ANY strategy_idx→persona wiring, so re-pointing a membership stays free
    // while changing an OWNER is what fails.
    //
    // Two halves, because either alone is forgeable:
    //   (i) the DATA half — imported from the pure-data fixture module, so a
    //       changed uuid is caught by value, not by grep.
    //  (ii) the SOURCE half — the persona portfolios live inside a function body
    //       in seed-demo-data.ts and are not exported, so their owners are read
    //       structurally. A new persona owned by a MANAGER_* would pass (i) and
    //       fail (ii).
    const allocatorOwners = new Set([
      ALLOCATOR_ACTIVE,
      ALLOCATOR_COLD,
      ALLOCATOR_STALLED,
    ]);

    // (i) Fail loud on an emptied fixture: a zero-length profile list would make
    // the disjointness below vacuously true.
    expect(STRATEGY_PROFILES.length).toBeGreaterThan(0);
    const strategyOwners = new Set(STRATEGY_PROFILES.map((p) => p.user_id));
    expect([...strategyOwners].filter((o) => allocatorOwners.has(o))).toEqual([]);

    // (ii) The persona-portfolio block, read structurally. The anchor is the
    // `personaPortfolios` declaration; if it is renamed or moved the gate FAILS
    // rather than matching nothing.
    const seedSrc = stripComments(readSource(SEED_DEMO_DATA));
    const anchor = seedSrc.indexOf("const personaPortfolios");
    expect(
      anchor,
      "scripts/seed-demo-data.ts no longer declares `personaPortfolios` — the " +
        "portfolio-owner half of the ARM 2 disjointness pin has nothing to read. " +
        "Re-anchor it on whatever replaced the declaration; do not delete it.",
    ).toBeGreaterThan(-1);

    // Bound the scan to the declaration's own array literal, so a `user_id:` in
    // a later statement cannot green (or redden) this. The END marker is
    // asserted too: `indexOf` returning -1 would make `slice(anchor, -1)` run to
    // the end of the FILE, quietly turning a bounded scan into a whole-file one.
    const blockEnd = seedSrc.indexOf("\n  ];", anchor);
    expect(
      blockEnd,
      "could not find the end of the `personaPortfolios` array literal in " +
        "scripts/seed-demo-data.ts — re-anchor the P2c scan bounds rather than " +
        "letting it read the whole file.",
    ).toBeGreaterThan(anchor);
    const block = seedSrc.slice(anchor, blockEnd);
    const portfolioOwnerIdents = [...block.matchAll(/user_id:\s*([A-Za-z0-9_]+)/g)].map(
      (m) => m[1],
    );
    expect(portfolioOwnerIdents.length).toBeGreaterThan(0);
    expect(
      portfolioOwnerIdents.filter(
        (ident) => !/^ALLOCATOR_(ACTIVE|COLD|STALLED)$/.test(ident),
      ),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer B — the money write and the atomic flip
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-03 — the money write says exactly what it means", () => {
  it("P3 — the allocation route writes the money column and never the derived weight column", () => {
    // Positive half first, so the negative below cannot pass on an empty file.
    expect(allocationSrc).toContain("allocated_amount");
    // D-13 / SC-4 at the DB level: the composite PK makes a second row for the
    // same (portfolio, strategy) structurally impossible, but ONLY if the
    // conflict target names both columns. Narrowing it to "portfolio_id" turns
    // every allocation into an overwrite of the previous one.
    expect(allocationSrc).toContain('onConflict: "portfolio_id,strategy_id"');
    // The failure this forbids: `current_weight` has NO writer anywhere in the
    // repo, and two analytics consumers substitute 1.0 for a NULL weight and
    // then renormalize. A write here would silently distort
    // portfolio_returns_series and match scoring, with nothing on screen
    // changing (the Holdings Weight column is render-derived — D-12-B). A
    // negative is not the complement of the payload's positive assertions:
    // measured, ledger M4, the route's own 51 cases stayed green under it.
    expect(allocationSrc).not.toContain("current_weight");
  });

  it("P6 — the confirmed flip goes through the ONE transactional RPC and the route removes no row itself", () => {
    expect(ownershipSrc).toContain("flip_capital_ownership_to_team_review");
    // The failure this forbids (T-150-16): an `.update()` followed by a
    // `.delete()` is two PostgREST round trips. If the second fails, the mark
    // says team_review while the position is still live — the exact stranded
    // state D-03 exists to prevent, reached by the route that exists to prevent
    // it. One plpgsql body is one transaction; two statements are not.
    expect(ownershipSrc).not.toContain(".delete(");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer B — the migration: the tier that holds against EVERY path
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-03 — the D-03-A invariant at the table layer (SOURCE facts; the SQL suite owns runtime behaviour)", () => {
  it("P4 — the D-03-A create-side trigger is INSERT-scoped, with no blanket UPDATE arm", () => {
    const create = triggerStatement(
      migrationSql,
      "trg_portfolio_strategies_own_capital_only",
    );
    expect(create).not.toBe("");
    expect(create).toContain("BEFORE INSERT ON public.portfolio_strategies");
    // The failure this forbids (150-RESEARCH § Pitfall 2): a blanket UPDATE arm
    // fires on the SHIPPED alias write, which sets `alias` alone on rows whose
    // strategy is unmarked — i.e. every pre-existing PROD position and every
    // demo-seed row. The guard would then reject a write that has nothing to do
    // with allocation. Scoped to the CREATE statement, not the file: the
    // migration's COMMENT ON prose says "BEFORE INSERT" too, so a file-wide
    // count would be pinning documentation.
    expect(create).not.toContain("OR UPDATE");
  });

  it("P4 — the repoint and mark-transition triggers exist with their exact column targets", () => {
    // rev-3 finding F4: without the repoint trigger an owner could PATCH an
    // EXISTING position's strategy_id to a team_review strategy and land the
    // forbidden state with no INSERT and no mark change — invisible to both
    // other guards. The COLUMN TARGET is load-bearing in the opposite
    // direction: dropping `OF strategy_id` turns it into the blanket UPDATE arm
    // the pin above forbids.
    const repoint = triggerStatement(
      migrationSql,
      "trg_portfolio_strategies_own_capital_on_repoint",
    );
    expect(repoint).not.toBe("");
    expect(repoint).toContain(
      "BEFORE UPDATE OF strategy_id ON public.portfolio_strategies",
    );

    // rev-2 finding F2: `strategies_update USING (user_id = auth.uid())` lets
    // the owner PATCH capital_ownership straight through PostgREST, stranding
    // every live position — the precise hole the flip RPC exists to close,
    // reachable without ever calling it. A guard callers must volunteer to use
    // is a convention, not an invariant.
    const markGuard = triggerStatement(
      migrationSql,
      "trg_strategies_team_review_mark_guard",
    );
    expect(markGuard).not.toBe("");
    expect(markGuard).toContain(
      "BEFORE UPDATE OF capital_ownership ON public.strategies",
    );
  });

  it("P4 — the column's closed set and BOTH D-03-A predicate arms survive", () => {
    expect(migrationSql).toMatch(
      /CHECK\s*\(capital_ownership IN \('own_capital', 'team_review'\)\)/,
    );

    const guard = sqlFunctionSource(
      migrationSql,
      "guard_allocation_requires_own_capital",
    );
    expect(guard).not.toBe("");
    // ARM 1 — unconditional (SC 2b read literally): a team_review mark blocks a
    // position for ANYONE, owner or third party.
    expect(guard).toContain("v_mark = 'team_review'");
    // ARM 2 — owner-scoped, and its conjunct is what PRESERVES the three
    // shipped third-party allocation paths (AddToPortfolio, MigrationWizard,
    // the demo seed). The B-1 amendment: a blanket "not own_capital" predicate
    // reads stricter and is in fact a DELETION of working product — it would
    // refuse every allocation into a strategy the allocator does not own, which
    // is most of them (the PROD census: 29 positions, all third-party).
    expect(guard).toMatch(/v_strategy_owner\s*=\s*v_portfolio_owner/);
    // ...and the conjunct needs the portfolios lookup to have a value at all.
    expect(guard).toContain("FROM portfolios p");
  });

  it("P4 — the flip RPC keeps its owner precheck and its DELETE-before-UPDATE order", () => {
    const flip = sqlFunctionSource(
      migrationSql,
      "flip_capital_ownership_to_team_review",
    );
    expect(flip).not.toBe("");

    // rev-2 finding F1: the DELETE is scoped to the CALLER's portfolios, so
    // without a precheck a NON-owner call deletes the CALLER's own position and
    // returns (1, 0). An occurrence COUNT, not a presence check: the precheck
    // added the third `auth.uid()`, so at a presence bar either statement's
    // predicate could be deleted while the precheck alone kept the pin green.
    expect(countOccurrences(flip, "auth.uid()")).toBe(3);

    // ORDER IS SEMANTIC, not style. The mark-transition guard above refuses an
    // UPDATE into 'team_review' while an owner-scoped position is live; the
    // DELETE clears exactly the set that guard counts. Reversed, the sanctioned
    // flip raises 23514 against its own guard.
    const del = flip.indexOf("DELETE FROM public.portfolio_strategies");
    const upd = flip.indexOf("UPDATE public.strategies");
    expect(del).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(-1);
    expect(del).toBeLessThan(upd);
  });

  it("P4c — the RAISE still emits the `capital_ownership=<mark>` needle the two clients branch on", () => {
    // 151 review A5 — a CROSS-LAYER contract, and the only unpinned one in the
    // phase. `AddToPortfolio.tsx` and `MigrationWizard.tsx` split their 23514
    // arm on `error.message.includes("capital_ownership=" + TEAM_REVIEW)`, i.e.
    // on a SUBSTRING OF THIS FORMAT STRING. Nothing else connects the two
    // layers: no vitest file executes SQL, and the components' own specs seed
    // the message themselves.
    //
    // The failure this forbids is silent in the worst way. This migration is
    // amended IN PLACE across revisions (it carries rev-2 and rev-3 headers),
    // so a reword of the RAISE — dropping the `capital_ownership=` prefix,
    // renaming it, moving the mark out of the message — leaves BOTH components
    // taking the `else` branch for EVERY refusal. Every third-party allocator
    // hitting ARM 1 would then be told to "mark it in My Strategies first": a
    // dead end for a row they do not own, cannot see there, and have no route
    // to mark. Every test in the repo stays green through that change.
    const guard = sqlFunctionSource(
      migrationSql,
      "guard_allocation_requires_own_capital",
    );
    expect(guard).not.toBe("");
    expect(guard).toContain("RAISE EXCEPTION");
    // The needle itself, verbatim.
    expect(guard).toContain("capital_ownership=%");
    // ...and the `%` must still be FED the mark. A format placeholder with the
    // argument list reordered (or the COALESCE dropped, which is what makes a
    // NULL mark render as `unmarked` rather than blanking the token) would keep
    // the literal above intact while emitting a message the needle misses.
    expect(guard).toMatch(
      /capital_ownership=%[\s\S]{0,120}?COALESCE\(v_mark, 'unmarked'\)/,
    );
    // The code the clients switch on before they ever look at the message.
    expect(guard).toContain("ERRCODE = 'check_violation'");

    // Consumer half — non-vacuity in the direction that matters. If nothing
    // read the token any more, this pin would be guarding a string nobody
    // consumes.
    //
    // ⚠️ PIN RE-BASED (151 informational D3). The token used to be spelled in
    // BOTH components, verbatim, and this loop asserted it in each. That
    // duplication was the finding: the copy and the branch now live once, in
    // `capitalOwnershipRefusalMessage` beside the marks themselves, and the two
    // components CALL it. So the assertion is split rather than relaxed — the
    // token is pinned at its single home, and each component is pinned to still
    // route through that home. Both directions of the original guard survive: a
    // reworded RAISE still reddens here, and a component that stops consuming
    // the mapper (open-coding its own arm again) reddens too.
    expect(
      stripComments(readSource(CAPITAL_OWNERSHIP)),
      `${CAPITAL_OWNERSHIP} no longer reads the capital_ownership token out of ` +
        `the trigger message — the two 23514 arms cannot be separated without it`,
    ).toContain("capital_ownership=");

    for (const consumer of [
      "src/components/portfolio/AddToPortfolio.tsx",
      "src/components/portfolio/MigrationWizard.tsx",
    ]) {
      expect(
        stripComments(readSource(consumer)),
        `${consumer} no longer routes its 23514 arm through the shared ` +
          `capitalOwnershipRefusalMessage mapper — the two browser-direct ` +
          `writers of this table must answer identically`,
      ).toContain("capitalOwnershipRefusalMessage");
    }
  });

  it("P4b — the weight_snapshots seed-trigger SECURITY DEFINER repair survives", () => {
    // Not decoration, and not this phase's own object: these two AFTER INSERT
    // trigger functions wrote to a table whose RLS denies all client writes, so
    // between 2026-04-16 and this phase EVERY `authenticated` INSERT into
    // portfolio_strategies aborted with 42501 — silently killing AddToPortfolio
    // and MigrationWizard in PRODUCTION for four months. The whole OWN-03 money
    // path rides on the repair. Reverting it is a one-line edit in a file
    // nobody working on Phase 150 would think to re-read, and the symptom
    // surfaces as an unrelated table's RLS error.
    const seed = stripSqlComments(readSource(SEED_SECDEF_MIGRATION));
    expect(seed).toContain("seed_weight_snapshot_for_portfolio_strategy");
    expect(seed).toContain("seed_weight_snapshots_for_portfolio");
    expect(countOccurrences(seed, "SECURITY DEFINER")).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer B — the union row set and the affordance it gates
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-03 / D-12-A — the union row set keeps the money and gates only the affordance", () => {
  it("P5 — toStrategyRows derives ownership through the SHARED vocabulary and never filters a row out", () => {
    const body = functionBody(adapterSrc, "toStrategyRows");
    expect(body).not.toBe("");

    // Both halves of the union derive through the imported predicate. An
    // occurrence COUNT, because there are exactly TWO derivation sites (one per
    // union half) and a presence check is blind to one of them going ad-hoc —
    // measured in 150-05's own ledger as mutation A6, which left the entire
    // suite green until a second behavioural case was added.
    expect(countOccurrences(body, "isAllocatable(")).toBe(2);
    // ...and the value it yields is the shared constant, never a re-spelled
    // literal (P1's invariant, restated at the consumption site).
    expect(body).not.toContain(`"${MARK_LITERAL}"`);
    expect(countOccurrences(body, "OWN_CAPITAL")).toBeGreaterThanOrEqual(2);

    // D-12-A, the no-vanished-money rule: a position whose strategy is NOT
    // marked KEEPS its row, its money and its metrics — it merely renders
    // read-only. The failure this forbids is a `filter`/`continue` that drops
    // unmarked positioned rows from the row SET, which would make an
    // allocator's live allocation disappear off the money surface entirely.
    // The one sanctioned `continue` is the union DEDUPE.
    expect(body).not.toContain(".filter(");
    expect(countOccurrences(body, "continue")).toBe(1);
    expect(body).toContain("if (seen.has(s.id)) continue;");
    expect(countOccurrences(body, "rows.push(")).toBe(2);

    // D-12-B's other half: the adapter must not resurrect the writer-free
    // column as the display source (see P3).
    expect(adapterSrc).not.toContain("current_weight");
  });

  it("P5 — HoldingsTable renders the Allocate/Edit control only inside the own-capital guard", () => {
    // The affordance is derived from the ROW STATE, not from whether a host
    // wired a handler — so the guard is the only thing standing between a
    // read-only unmarked row and a money action the server will refuse with a
    // 23514 the user cannot act on (T-150-33).
    expect(holdingsTableSrc).toContain(
      "const isOwnCapital = row.capitalOwnership === OWN_CAPITAL;",
    );
    for (const label of ['"Allocate…"', '"Edit allocation…"']) {
      const at = holdingsTableSrc.indexOf(label);
      expect(at, `${label} is missing from ${HOLDINGS_TABLE}`).toBeGreaterThan(
        -1,
      );
      // ONE label each: a second mount elsewhere in the file could sit outside
      // the guard while this window stayed green.
      expect(countOccurrences(holdingsTableSrc, label)).toBe(1);
      const guardWindow = holdingsTableSrc.slice(Math.max(0, at - 500), at);
      expect(guardWindow).toContain("isOwnCapital ? (");
    }
    // D-13's UI half, structurally: WHICH label shows is derived from the
    // allocation's null-ness, so one row can never offer both.
    expect(holdingsTableSrc).toContain(
      "const isAllocated = row.allocation != null;",
    );
  });

  it("P9 — the OWN-05 owner-name carve-out is scoped to the MARKED set, never the joined row", () => {
    const body = functionBody(adapterSrc, "toStrategyRows");
    const collapsed = body.replace(/\s+/g, " ");
    // Self-pin both regexes before trusting either (phase-32 idiom).
    expect(/ps\.alias\?\.trim\(\) \|\| owned\?\.name \|\|/.test(
      "const x = ps.alias?.trim() || owned?.name || fallback;",
    )).toBe(true);
    expect(/ps\.alias\?\.trim\(\) \|\| s\.name/.test(
      "const x = ps.alias?.trim() || owned?.name || fallback;",
    )).toBe(false);

    // The marked set is `user_id`-filtered server-side, so preferring
    // `owned?.name` is reachable ONLY for the viewer's own strategies — it
    // "widens disclosure to nobody" (the browse/route.ts precedent).
    expect(collapsed).toMatch(/ps\.alias\?\.trim\(\) \|\| owned\?\.name \|\|/);
    // The failure this forbids: the plan's one-line formula read literally
    // (`|| s.name`) prefers the JOINED strategy row's real name on EVERY
    // position — surfacing a third-party manager's real name beside their
    // codename on an exploratory-tier row, which is exactly the
    // cross-correlation the disclosure tiers exist to prevent.
    expect(collapsed).not.toMatch(/ps\.alias\?\.trim\(\) \|\| s\.name/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer B — the two disclosure boundaries this phase touches
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-03 — the mark reaches neither the shared cache nor a public render", () => {
  it("P7 — the v2 factsheet's cache callback carries no ownership token", () => {
    // Phase-148's property, re-asserted against THIS phase's new column. The
    // effective unstable_cache key is id-ONLY, so whatever the callback builds
    // is served to every subsequent reader of that id for the full 3600s TTL —
    // including an anonymous one. An owner-derived mark inside it is a
    // disclosure bug with a one-hour blast radius. Phase 150 rides the owner
    // LANE instead: the mark is read on the owner probe and threaded as a
    // render prop.
    expect(countOccurrences(factsheetPageSrc, "unstable_cache(")).toBe(1);
    const callback = firstArgument(callArgs(factsheetPageSrc, "unstable_cache"));
    expect(callback).not.toBe("");
    expect(callback).not.toContain("capital_ownership");
    expect(callback).not.toContain("ownershipMark");
    expect(callback).not.toContain("renameTarget");
    // Non-vacuity for THIS pin: the page really does read the column somewhere
    // (on the owner probe), so the callback's silence means "kept out", never
    // "the feature was deleted".
    expect(factsheetPageSrc).toContain("capital_ownership");
  });

  it("P8 — every OwnershipTag mount in the shared table sits behind the owner-visibility guard", () => {
    // T-150-39, and the reason this is a HARD gate rather than a nicety: public
    // /browse and /discovery rows arrive here with `capital_ownership`
    // POPULATED, because `shapeRankingRows` splats the whole strategy row. The
    // component has no other barrier. Deleting this guard shows every owner's
    // capital declaration to anonymous readers with no server change and no
    // schema change — UI-SPEC invariant 3 says public surfaces render zero
    // pixels of this phase.
    const mounts = countOccurrences(strategyTableSrc, "<OwnershipTag");
    expect(mounts).toBeGreaterThan(0);
    let guarded = 0;
    let from = 0;
    for (;;) {
      const at = strategyTableSrc.indexOf("<OwnershipTag", from);
      if (at === -1) break;
      const guardWindow = strategyTableSrc.slice(Math.max(0, at - 200), at);
      // Asserted per-mount rather than once for the file: N mounts must yield N
      // guarded windows, so adding a SECOND un-gated mount cannot hide behind
      // the first one's guard.
      expect(guardWindow).toContain(OWNER_VISIBILITY_GUARD);
      guarded += 1;
      from = at + 1;
    }
    expect(guarded).toBe(mounts);
    // The public default is what makes the guard meaningful: /discovery and
    // /browse pass no `visibility` at all, so this expression is what anonymous
    // readers get. (Also pinned by the phase-149 gate — restated here because
    // P8's argument collapses without it.)
    expect(strategyTableSrc).toContain('visibility = "published-only"');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Anti-vacuity — an empty offender list must mean CLEAN, never BLIND
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-03 — the gate cannot pass vacuously", () => {
  it("P10 — the walk found production sources, the strippers really strip, and every extractor found a real body", () => {
    // 1. The walk is real. An extractor that silently returned [] would make
    //    every `toEqual([...])` above pass on any tree at all.
    const files = productionSources(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(100);
    expect(markLiteralSpellers().length).toBeGreaterThan(0);
    expect(positionWriters().length).toBeGreaterThan(0);

    // 2. The write-method regex really matches what it claims (self-pin), and
    //    is anchored to the method call rather than to the word.
    WRITE_METHOD.lastIndex = 0;
    expect(WRITE_METHOD.test('.upsert({ a: 1 })')).toBe(true);
    WRITE_METHOD.lastIndex = 0;
    expect(WRITE_METHOD.test(".insert(row)")).toBe(true);
    WRITE_METHOD.lastIndex = 0;
    expect(WRITE_METHOD.test("// insert a row here")).toBe(false);
    WRITE_METHOD.lastIndex = 0;

    // 3. stripComments is LOAD-BEARING, not decorative. The ownership route
    //    names the mark literal FOUR times in prose while documenting the
    //    closed set; un-stripped, P1's "exactly one file" walk would report
    //    offenders on a perfectly healthy tree.
    const ownershipRaw = readSource(OWNERSHIP_ROUTE);
    expect(ownershipRaw).toContain(MARK_LITERAL);
    expect(stripComments(ownershipRaw)).not.toContain(MARK_LITERAL);
    //    Same for P3's negative: the allocation route explains at length why
    //    `current_weight` is never written.
    const allocationRaw = readSource(ALLOCATION_ROUTE);
    expect(allocationRaw).toContain("current_weight");
    expect(stripComments(allocationRaw)).not.toContain("current_weight");
    //    ...and for P8: the JSX comment beside the tag mount spells the guard
    //    out in prose, so an unstripped P8 could pass on documentation alone.
    const strategyTableRaw = readSource(STRATEGY_TABLE);
    expect(
      strategyTableRaw.slice(
        0,
        strategyTableRaw.indexOf("<OwnershipTag"),
      ),
    ).toContain("UI-SPEC invariant");
    expect(strategyTableSrc).not.toContain("UI-SPEC invariant");

    // 4. stripSqlComments is load-bearing too, and this is the pin that proves
    //    it: the flip function's `--` prose argues about `auth.uid()` at length
    //    (why the precheck exists, why the two statement predicates are kept as
    //    defence in depth, what `strategies_read` says), so the RAW body
    //    carries far more than three occurrences. P4's `toBe(3)` count is a
    //    statement about CODE and would be pure noise unstripped.
    const migrationRaw = readSource(MIGRATION);
    const rawFlip = sqlFunctionSource(
      migrationRaw,
      "flip_capital_ownership_to_team_review",
    );
    expect(countOccurrences(rawFlip, "auth.uid()")).toBeGreaterThan(3);
    expect(
      countOccurrences(
        sqlFunctionSource(
          migrationSql,
          "flip_capital_ownership_to_team_review",
        ),
        "auth.uid()",
      ),
    ).toBe(3);
    //    ...and the stripper itself, self-pinned on synthetic input, drops a
    //    whole-line `--` while leaving a statement (and an inline `--` inside a
    //    quoted string, which is prose in a COMMENT ON body, not code).
    expect(stripSqlComments("-- drop everything\nSELECT 1;")).toBe("SELECT 1;");
    expect(stripSqlComments("SELECT 'a -- b';")).toBe("SELECT 'a -- b';");

    // 5. The SQL extractors really scoped. A runaway search that swallowed the
    //    whole 700-line migration would green P4's negatives into noise.
    const create = triggerStatement(
      migrationSql,
      "trg_portfolio_strategies_own_capital_only",
    );
    expect(create.length).toBeGreaterThan(60);
    expect(create.length).toBeLessThan(400);
    const flip = sqlFunctionSource(
      migrationSql,
      "flip_capital_ownership_to_team_review",
    );
    expect(flip.length).toBeGreaterThan(400);
    expect(flip.length).toBeLessThan(migrationSql.length / 2);

    // 6. The TS function extractor found a real, scoped body.
    const body = functionBody(adapterSrc, "toStrategyRows");
    expect(
      body.length,
      `functionBody(strategies-row-adapter.ts, "toStrategyRows") returned an ` +
        `empty/short body — every negative assertion scoped to it would pass ` +
        `vacuously`,
    ).toBeGreaterThan(500);
    expect(body.length).toBeLessThan(adapterSrc.length);

    // 7. The cache-callback extractor found the callback, not the whole file.
    const callback = firstArgument(callArgs(factsheetPageSrc, "unstable_cache"));
    expect(callback.length).toBeGreaterThan(10);
    expect(callback.length).toBeLessThan(400);
  });
});
