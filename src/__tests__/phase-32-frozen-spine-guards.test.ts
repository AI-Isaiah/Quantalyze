/**
 * Phase 32 (Dead-Link Fix & Route Retirement) — exit-gate guards.
 *
 * Phase 32 retires the standalone Strategy-Sandbox surface into the unified
 * composer and fixes the 2 portfolio-context dead links. It is routing + nav +
 * two file deletions: ZERO schema, ZERO new deps, and ZERO `src/lib/scenario.ts`
 * diff. Every invariant below ships GREEN unless a content-inspecting test
 * catches its regression, so this guard reads the LIVE source from disk and
 * fails CI the moment any retirement invariant is reverted:
 *
 *   (1) FROZEN ENGINE (SCENARIO-05). `src/lib/scenario.ts` has ZERO diff vs the
 *       phase baseline — the 252-day-annualization engine the whole product
 *       relies on. Phase 32 touches NO engine code; a one-line tweak would
 *       silently re-base that annualization. ScenarioBuilder (deleted this
 *       phase) imported `@/lib/scenario`, but the engine itself is untouched.
 *
 *   (2) /scenarios IS A REDIRECT (FLOW-02). `scenarios/page.tsx` is a thin
 *       server-component `redirect("/allocations?tab=scenario")` — the legacy
 *       `createAdminClient()` RLS-bypassing institutional-universe read (the
 *       C-0017 leak vector) is GONE. The page must contain the redirect AND
 *       must NOT contain `createAdminClient` or render `ScenarioBuilder`.
 *
 *   (3) ScenarioBuilder IS DELETED. `src/components/scenarios/ScenarioBuilder.tsx`
 *       must not exist — the example-universe Sandbox is retired; its honesty
 *       coverage is a verified subset of the composer's own guard.
 *
 *   (4) NO /scenarios NAV ITEM (FLOW-03). `Sidebar.tsx` must not contain
 *       `"/scenarios"` — the allocator has ONE discoverable entry (/allocations).
 *
 *   (5) NO COMPOSER SELF-LOOP (landmine #2). `ScenarioComposer.tsx` must not
 *       contain `href="/scenarios"` — that link would loop a new allocator from
 *       the composer's blank slate back into the composer (/scenarios →
 *       /allocations?tab=scenario).
 *
 *   (6) PORTFOLIO ADD LINKS (FLOW-01). The 2 portfolio-context "+ Add Strategy"
 *       links (`portfolios/[id]/manage/page.tsx`, `portfolios/[id]/page.tsx`)
 *       point at the valid `/discovery/crypto-sma` strategy-browse listing, AND
 *       `AddToPortfolio.tsx` does NOT read a `?portfolio=` search param. The
 *       research's ?portfolio= auto-attach was removed: the param cannot survive
 *       the discovery listing→detail hop (the listing's StrategyTable links to
 *       /factsheet, which never mounts AddToPortfolio), so it was dead code.
 *
 * HOW IT WORKS
 * ------------
 * Invariant (1) reads the REAL git delta for the phase: every file added or
 * changed between the phase baseline (the merge-base with origin/main) and HEAD,
 * PLUS untracked-but-not-ignored files. Pure git/file inspection — no network,
 * no Supabase round-trip — and runs in well under 2s.
 *
 * Invariants (2)-(6) read the live source with readFileSync / existsSync (NOT
 * hardcoded snapshots) and run grep-style content assertions.
 *
 * KNIP (exit gate, run in <verify>, NOT here)
 * -------------------------------------------
 * The ScenarioBuilder deletion must leave knip clean — RESEARCH.md verified that
 * `EquityCurveChart`/`MetricCard` were FILE-PRIVATE functions inside
 * ScenarioBuilder.tsx (never exported, never imported elsewhere), so deleting
 * the file orphans nothing. knip flags unused FILES/EXPORTS, not file-private
 * functions. That gate is asserted by running the project knip command —
 * `npx knip` — in the plan's <verify> step (it is too heavy / filesystem-broad
 * to embed as a fast unit assertion; CLAUDE.md keeps it out of the per-test
 * hot path). Command of record: `npx knip` (config: ./knip.json).
 *
 * Phase 32 ships ZERO migrations (routing/nav/test-only, no DB, no schema).
 * There is therefore no migration assertion here.
 *
 * NON-VACUITY
 * -----------
 * (1) The delta is computed from `git diff`/`git ls-files`, never a hardcoded
 *     list. Appending a no-op line to `src/lib/scenario.ts` makes the engine
 *     assertion FAIL (the file lands in the changed set); reverting restores
 *     green.
 * (2)-(6) Each content gate reads the live file. Reintroducing the redirect's
 *     admin read, restoring ScenarioBuilder.tsx, adding a `/scenarios` nav item
 *     or composer self-link, repointing a portfolio add link away from
 *     /discovery/crypto-sma, or re-adding the dead ?portfolio= reader to
 *     AddToPortfolio makes the corresponding assertion FAIL. Where a regex drives an assertion,
 *     a self-pin proves the regex still matches a synthetic positive sample (so
 *     a future loosening that makes the regex inert is caught).
 *
 * FAIL-LOUD (project CLAUDE.md Rule 12)
 * -------------------------------------
 * If the baseline ref cannot be resolved AT ALL (no origin/main merge-base AND
 * no fallback base sha reachable), the guard THROWS with an actionable message
 * — it never silently passes / skips. A guard that can't see the delta is worse
 * than no guard, so it must go red, not green.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CWD = process.cwd();

/**
 * The phase branch point — the merge-base with origin/main at planning/execution
 * time (b8a0337b, the same base Phase 31 used). Used ONLY as a fallback when
 * `git merge-base origin/main HEAD` cannot be computed (e.g. a shallow CI clone
 * with no origin/main ref). If even this sha is unreachable, the guard fails
 * loud rather than skipping.
 */
const FALLBACK_BASE_SHA = "b8a0337b";

/**
 * Run git with an argument array (no shell — execFileSync, not execSync), so no
 * value is ever interpolated into a shell string. Trimmed; throws on non-zero
 * exit.
 */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: CWD,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Does `ref` resolve to a commit in this repo? */
function refExists(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the phase baseline ref. Prefer the merge-base with origin/main
 * (correct in CI and locally); fall back to the documented branch-point sha if
 * origin/main is absent; FAIL LOUD if neither resolves (Rule 12 — never a
 * silent skip).
 */
function resolveBaselineRef(): string {
  if (refExists("origin/main")) {
    try {
      const base = git(["merge-base", "origin/main", "HEAD"]);
      if (base) return base;
    } catch {
      // fall through to the constant fallback
    }
  }
  if (refExists(FALLBACK_BASE_SHA)) {
    return FALLBACK_BASE_SHA;
  }
  throw new Error(
    "Phase 32 frozen-spine guard could not resolve a baseline ref: neither " +
      "`git merge-base origin/main HEAD` nor the fallback base sha " +
      `\`${FALLBACK_BASE_SHA}\` is reachable. The guard refuses to pass ` +
      "without a real diff base (CLAUDE.md Rule 12 — fail loud, never " +
      "silently skip an exit gate). Fetch origin/main (`git fetch origin " +
      "main`) or run against a non-shallow clone, then re-run.",
  );
}

const BASE = resolveBaselineRef();

// --- live-source paths (read from disk, not snapshots) ---
// FLOW-02 was originally an in-page `redirect()` stub at
// src/app/(dashboard)/scenarios/page.tsx. Phase 51-05 (NAV-01) FORMALIZED that
// move into a config-level 308 in next.config.ts `redirects()` and RETIRED the
// stub (the page file is deleted). The FLOW-02 invariant — "/scenarios
// redirects to the composer, and the C-0017 admin-client leak is gone" — is now
// proven by the next.config redirect (read below) PLUS the page-file's absence
// (no page ⇒ no createAdminClient read can exist). So the guard reads the
// redirect from its NEW home and asserts the old leak surface no longer exists.
const SCENARIOS_PAGE_PATH = join(CWD, "src/app/(dashboard)/scenarios/page.tsx");
const NEXT_CONFIG_PATH = join(CWD, "next.config.ts");
const NEXT_CONFIG_SRC = readFileSync(NEXT_CONFIG_PATH, "utf8");

const SCENARIO_BUILDER_PATH = join(
  CWD,
  "src/components/scenarios/ScenarioBuilder.tsx",
);

const SIDEBAR_PATH = join(CWD, "src/components/layout/Sidebar.tsx");
const SIDEBAR_SRC = readFileSync(SIDEBAR_PATH, "utf8");

const COMPOSER_PATH = join(
  CWD,
  "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
);
const COMPOSER_SRC = readFileSync(COMPOSER_PATH, "utf8");

const PORTFOLIOS_DIR = join(CWD, "src/app/(dashboard)/portfolios");
const MANAGE_PAGE_PATH = join(PORTFOLIOS_DIR, "[id]/manage/page.tsx");
const ID_PAGE_PATH = join(PORTFOLIOS_DIR, "[id]/page.tsx");
const MANAGE_PAGE_SRC = readFileSync(MANAGE_PAGE_PATH, "utf8");
const ID_PAGE_SRC = readFileSync(ID_PAGE_PATH, "utf8");

/** Recursively collect every .tsx/.ts source file under `dir`. */
function _collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(..._collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("Phase 32 frozen-spine + route-retirement exit-gate guards", () => {
  it("resolves a real phase baseline ref (fails loud if it cannot — Rule 12)", () => {
    // `resolveBaselineRef()` already threw at module load if unresolvable, so
    // reaching here proves a base was found. Pin the invariant explicitly so a
    // future refactor that swallows the error is caught.
    expect(
      BASE,
      "phase baseline ref must resolve to a non-empty sha",
    ).toBeTruthy();
    expect(typeof BASE).toBe("string");
  });

  // v1.5 coverage-window re-baseline (ADR-001): Phase 32 froze scenario.ts. v1.5
  // Phase 55 deliberately edits that engine ONCE (the coverage-window blend), so
  // the frozen-engine assertion is RETIRED here as a reviewed act — NOT inverted
  // to a `.toContain` delta pin, which would go red on every future phase branch
  // once this merges and the merge-base advances past the edit (scenario.ts
  // naturally leaves each later delta). scenario.ts is now protected by
  // scenario.test.ts's own pins + the BLEND-07 numpy gate. ALL FLOW-01/02/03
  // route / redirect / delete assertions BELOW are UNCHANGED (Phase 55 touches
  // no routes).
  it("FLOW-02: /scenarios redirects to the composer (now a next.config 308) and the in-page leak surface is GONE", () => {
    // Phase 51-05 (NAV-01): the FLOW-02 redirect was formalized from an in-page
    // stub into a config-level 308 in next.config.ts `redirects()`. The redirect
    // target must still be the wired, tested deep-link — assert the exact
    // source→destination tuple so a future edit to the wrong tab/path fails.
    expect(
      NEXT_CONFIG_SRC,
      "Phase 32 exit gate VIOLATED — next.config.ts redirects() must move " +
        '/scenarios → "/allocations?tab=scenario" (FLOW-02, formalized as a ' +
        "308 in Phase 51-05). The legacy Strategy-Sandbox surface is retired " +
        "into the unified composer.",
    ).toContain('source: "/scenarios"');
    expect(
      NEXT_CONFIG_SRC,
      "Phase 32 exit gate VIOLATED — the /scenarios redirect must target " +
        '"/allocations?tab=scenario" (FLOW-02).',
    ).toContain('destination: "/allocations?tab=scenario"');

    // The C-0017 leak vector — the RLS-bypassing institutional-universe read —
    // is now eliminated BY CONSTRUCTION: the in-page stub is deleted, so there
    // is no page to host a createAdminClient read. Assert the file is GONE.
    expect(
      existsSync(SCENARIOS_PAGE_PATH),
      "Phase 32 exit gate VIOLATED — src/app/(dashboard)/scenarios/page.tsx " +
        "still exists. Phase 51-05 retired the in-page stub in favor of a " +
        "next.config 308; the page file (and its C-0017 admin-client leak " +
        "surface) must not exist.",
    ).toBe(false);
  });

  it("FLOW-02: the ScenarioBuilder Sandbox component is DELETED", () => {
    expect(
      existsSync(SCENARIO_BUILDER_PATH),
      "Phase 32 exit gate VIOLATED — src/components/scenarios/" +
        "ScenarioBuilder.tsx still exists. The example-universe Sandbox is " +
        "retired (its honesty coverage is a verified subset of the composer's " +
        "own ScenarioComposer.test.tsx guard). The file must not exist.",
    ).toBe(false);
  });

  it("FLOW-03: Sidebar.tsx has NO /scenarios nav item (one allocator entry)", () => {
    expect(
      SIDEBAR_SRC,
      "Phase 32 exit gate VIOLATED — Sidebar.tsx still references " +
        '"/scenarios". The standalone Strategy-Sandbox nav item is retired; ' +
        "the allocator has ONE discoverable entry (/allocations). A nav item " +
        "here would loop the allocator back into the composer.",
    ).not.toContain("/scenarios");
  });

  it("landmine #2: ScenarioComposer.tsx has NO href=\"/scenarios\" self-loop", () => {
    expect(
      COMPOSER_SRC,
      "Phase 32 exit gate VIOLATED — ScenarioComposer.tsx contains an " +
        'href="/scenarios" self-link. From the composer\'s blank slate that ' +
        "loops the user from the composer back INTO the composer " +
        "(/scenarios → /allocations?tab=scenario) — a confusing no-op on the " +
        "exact front door FLOW-03 makes clean. Remove the self-link.",
    ).not.toContain('href="/scenarios"');
  });

  it("FLOW-01: both portfolio-context add links point at the valid /discovery/crypto-sma listing", () => {
    // The 2 portfolio-context "+ Add Strategy" / "Add your first strategy" links
    // route to the live strategy-browse listing. /discovery/crypto-sma is
    // DEFAULT_AUTHENTICATED_ROUTE (proxy.ts) — a real route, never a 404 — so the
    // links are valid; the user browses and attaches via AddToPortfolio's manual
    // dropdown on the strategy-detail page. (The ?portfolio= auto-attach the
    // phase-32 RESEARCH proposed was removed — see the next test for why.)
    const LISTING_RE = /\/discovery\/crypto-sma/;

    // Non-vacuity self-pins.
    expect(LISTING_RE.test('href="/discovery/crypto-sma"')).toBe(true);
    expect(LISTING_RE.test('href="/portfolios"')).toBe(false);

    expect(
      LISTING_RE.test(MANAGE_PAGE_SRC),
      "Phase 32 exit gate VIOLATED — portfolios/[id]/manage/page.tsx's " +
        '"+ Add Strategy" link no longer points at /discovery/crypto-sma (the ' +
        "live strategy-browse listing).",
    ).toBe(true);
    expect(
      LISTING_RE.test(ID_PAGE_SRC),
      "Phase 32 exit gate VIOLATED — portfolios/[id]/page.tsx's empty-state " +
        '"Add your first strategy" link no longer points at /discovery/crypto-sma.',
    ).toBe(true);
  });

  it("FLOW-01: the dead ?portfolio= auto-attach plumbing stays removed (it never worked end-to-end)", () => {
    // Red-team finding: a ?portfolio= param on the portfolio links could never
    // reach AddToPortfolio. The discovery LISTING renders StrategyTable, whose
    // strategy links go to /factsheet (which never mounts AddToPortfolio), so the
    // param is dropped before the strategy-detail page where AddToPortfolio lives.
    // The search-param reader was therefore dead code behind green unit tests.
    // Guard it stays gone: re-adding it ships a silently-broken "attach-back".
    const ADD_TO_PORTFOLIO_SRC = readFileSync(
      join(CWD, "src/components/portfolio/AddToPortfolio.tsx"),
      "utf8",
    );

    // Non-vacuity self-pins: the regex catches both the import and the param read.
    const DEAD_READER_RE = /useSearchParams|get\(["']portfolio["']\)/;
    expect(DEAD_READER_RE.test('const sp = useSearchParams();')).toBe(true);
    expect(DEAD_READER_RE.test('searchParams.get("portfolio")')).toBe(true);
    expect(DEAD_READER_RE.test('searchParams.get("tab")')).toBe(false);

    expect(
      ADD_TO_PORTFOLIO_SRC,
      "Phase 32 exit gate VIOLATED — AddToPortfolio.tsx reads a `portfolio` " +
        "search param again. That auto-attach is dead: the param cannot survive " +
        "the discovery listing→detail navigation, so it silently never fires. " +
        "Remove it, or first thread ?portfolio= through StrategyTable→detail.",
    ).not.toMatch(DEAD_READER_RE);
  });
});
