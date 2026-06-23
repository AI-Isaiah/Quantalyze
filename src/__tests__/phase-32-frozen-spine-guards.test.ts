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
 *   (6) PORTFOLIO ATTACH-BACK (FLOW-01). The 2 portfolio-context "+ Add Strategy"
 *       links (`portfolios/[id]/manage/page.tsx`, `portfolios/[id]/page.tsx`)
 *       carry `?portfolio=` on a `/discovery/crypto-sma` href, AND there is NO
 *       bare `href="/discovery/crypto-sma"` (without `?portfolio=`) ANYWHERE
 *       under the portfolios tree — so the added strategy attaches back to THAT
 *       portfolio. The ~28 intentional default-landing redirects elsewhere are
 *       out of scope and NOT asserted here.
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
 *     or composer self-link, or dropping `?portfolio=` from a portfolio link
 *     makes the corresponding assertion FAIL. Where a regex drives an assertion,
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

/**
 * Build the set of files added or changed in this phase vs `base`:
 *   - `git diff --name-only <base> HEAD` — committed adds/changes
 *   - `git ls-files --others --exclude-standard` — untracked, not-ignored files
 * `.planning/` is gitignored, so it never pollutes the set.
 */
function changedFiles(base: string): string[] {
  const committed = git(["diff", "--name-only", base, "HEAD"])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return [...new Set([...committed, ...untracked])];
}

const BASE = resolveBaselineRef();
const CHANGED = changedFiles(BASE);

const FROZEN_ENGINE = "src/lib/scenario.ts";

// --- live-source paths (read from disk, not snapshots) ---
const SCENARIOS_PAGE_PATH = join(CWD, "src/app/(dashboard)/scenarios/page.tsx");
const SCENARIOS_PAGE_SRC = readFileSync(SCENARIOS_PAGE_PATH, "utf8");

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
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
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

  it("exit gate (frozen engine SCENARIO-05): src/lib/scenario.ts is zero-diff vs baseline", () => {
    expect(
      CHANGED,
      `Phase 32 exit gate VIOLATED — ${FROZEN_ENGINE} changed in the phase ` +
        "delta. The projection engine is FROZEN (SCENARIO-05; the 252-day " +
        "annualization basis the whole product relies on). Phase 32 is " +
        "routing + nav + two deletions — it touches NO engine code. The " +
        `deleted ScenarioBuilder imported @/lib/scenario but did not modify ` +
        `it. Revert ${FROZEN_ENGINE} to the baseline.`,
    ).not.toContain(FROZEN_ENGINE);
  });

  it("FLOW-02: /scenarios/page.tsx is a redirect to the composer and reads NOTHING (no admin-client leak)", () => {
    // The redirect target must be the wired, tested deep-link. Assert the exact
    // call so a future edit to the wrong tab/path fails.
    expect(
      SCENARIOS_PAGE_SRC,
      "Phase 32 exit gate VIOLATED — scenarios/page.tsx must " +
        'redirect("/allocations?tab=scenario") (FLOW-02). The legacy ' +
        "Strategy-Sandbox surface is retired into the unified composer.",
    ).toContain('redirect("/allocations?tab=scenario")');

    // The C-0017 leak vector — the RLS-bypassing institutional-universe read —
    // must be GONE. The retired page renders/reads nothing.
    expect(
      SCENARIOS_PAGE_SRC,
      "Phase 32 exit gate VIOLATED — scenarios/page.tsx still references " +
        "createAdminClient. The retirement REMOVES the RLS-bypassing " +
        "institutional-universe read (C-0017). The page must only redirect.",
    ).not.toContain("createAdminClient");
    expect(
      SCENARIOS_PAGE_SRC,
      "Phase 32 exit gate VIOLATED — scenarios/page.tsx still references " +
        "ScenarioBuilder. The Sandbox component is retired; the page must " +
        "only redirect into the composer.",
    ).not.toContain("ScenarioBuilder");
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

  it("FLOW-01: the 2 portfolio-context add links carry ?portfolio= on the discovery href", () => {
    // Each link must route to discovery carrying the portfolio context so the
    // added strategy attaches back to THIS portfolio (AddToPortfolio reads the
    // `portfolio` param and pre-selects the owned portfolio).
    const ATTACH_BACK_RE = /\/discovery\/crypto-sma\?portfolio=/;

    // Non-vacuity self-pins: the regex matches the real attach-back form and
    // rejects the bare slug. If it ever stops discriminating, the gate is dead
    // weight.
    expect(
      ATTACH_BACK_RE.test("`/discovery/crypto-sma?portfolio=${id}`"),
    ).toBe(true);
    expect(ATTACH_BACK_RE.test('"/discovery/crypto-sma"')).toBe(false);

    expect(
      ATTACH_BACK_RE.test(MANAGE_PAGE_SRC),
      "Phase 32 exit gate VIOLATED — portfolios/[id]/manage/page.tsx's " +
        '"+ Add Strategy" link no longer carries ?portfolio= on its ' +
        "/discovery/crypto-sma href. Without it the added strategy is lost " +
        "from THIS portfolio's context (FLOW-01 attach-back).",
    ).toBe(true);
    expect(
      ATTACH_BACK_RE.test(ID_PAGE_SRC),
      "Phase 32 exit gate VIOLATED — portfolios/[id]/page.tsx's empty-state " +
        '"Add your first strategy" link no longer carries ?portfolio= on its ' +
        "/discovery/crypto-sma href. Without it the added strategy is lost " +
        "from THIS portfolio's context (FLOW-01 attach-back).",
    ).toBe(true);
  });

  it("FLOW-01: NO bare href=\"/discovery/crypto-sma\" (without ?portfolio=) anywhere under the portfolios tree", () => {
    // A bare discovery link in the portfolios tree is the precise dead-link
    // regression FLOW-01 closes — it would lose the portfolio you came from.
    // The ~28 intentional default-landing redirects live OUTSIDE this tree and
    // are not scanned. We forbid both the double-quoted and template-literal
    // bare forms (slug immediately followed by a closing quote/backtick — i.e.
    // NO `?portfolio=` query).
    const BARE_RE = /\/discovery\/crypto-sma["`]/;

    // Non-vacuity self-pins.
    expect(BARE_RE.test('href="/discovery/crypto-sma"')).toBe(true);
    expect(BARE_RE.test("href={`/discovery/crypto-sma`}")).toBe(true);
    expect(BARE_RE.test("`/discovery/crypto-sma?portfolio=${id}`")).toBe(false);

    const offenders = collectSourceFiles(PORTFOLIOS_DIR).filter((f) =>
      BARE_RE.test(readFileSync(f, "utf8")),
    );
    expect(
      offenders,
      "Phase 32 exit gate VIOLATED — a bare /discovery/crypto-sma link " +
        "(without ?portfolio=) reappeared under the portfolios tree: " +
        `${offenders.join(", ")}. Portfolio-context add links MUST carry ` +
        "?portfolio= so the strategy attaches back to THAT portfolio " +
        "(FLOW-01). Re-add the portfolio query.",
    ).toEqual([]);
  });
});
