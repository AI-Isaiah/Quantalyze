import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVE_PORTFOLIO_ID as SEED_ACTIVE_PORTFOLIO_ID,
  ALLOCATOR_ACTIVE as SEED_ALLOCATOR_ACTIVE,
  ALLOCATOR_COLD as SEED_ALLOCATOR_COLD,
  ALLOCATOR_STALLED as SEED_ALLOCATOR_STALLED,
  COLD_PORTFOLIO_ID as SEED_COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID as SEED_STALLED_PORTFOLIO_ID,
  STRATEGY_PROFILES,
  STRATEGY_UUIDS,
  approximateMwr,
  formatSignedPct,
  generatePortfolioAnalyticsJSONB,
  type PortfolioAnalyticsHolding,
} from "../../scripts/seed-demo-data";
import {
  ACTIVE_PORTFOLIO_ID,
  ALLOCATOR_ACTIVE_ID,
  ALLOCATOR_COLD_ID,
  ALLOCATOR_STALLED_ID,
  COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID,
} from "@/lib/demo";
import { adaptPortfolioAnalytics } from "@/lib/portfolio-analytics-adapter";

/**
 * Seed-integrity tests.
 *
 * The canonical source of truth for demo allocator + portfolio UUIDs is
 * `src/lib/demo.ts` (read by the public /demo route). The seed script holds
 * its own parallel copy — this test asserts both copies stay in sync so drift
 * never silently breaks the demo lane.
 *
 * It also locks in the shape of `generatePortfolioAnalyticsJSONB()` so the
 * rows it writes round-trip cleanly through `adaptPortfolioAnalytics()` — the
 * same parser the /demo page uses to hydrate its hero cards.
 */

describe("seed strategy profiles", () => {
  it("exposes exactly 8 demo strategies", () => {
    expect(STRATEGY_PROFILES).toHaveLength(8);
    expect(STRATEGY_UUIDS).toHaveLength(8);
  });

  it("every strategy profile points at its matching STRATEGY_UUIDS slot", () => {
    for (let i = 0; i < STRATEGY_PROFILES.length; i++) {
      expect(STRATEGY_PROFILES[i].id).toBe(STRATEGY_UUIDS[i]);
    }
  });
});

describe("seed allocator UUIDs match src/lib/demo.ts", () => {
  it("ALLOCATOR_ACTIVE matches", () => {
    expect(SEED_ALLOCATOR_ACTIVE).toBe(ALLOCATOR_ACTIVE_ID);
  });

  it("ALLOCATOR_COLD matches", () => {
    expect(SEED_ALLOCATOR_COLD).toBe(ALLOCATOR_COLD_ID);
  });

  it("ALLOCATOR_STALLED matches", () => {
    expect(SEED_ALLOCATOR_STALLED).toBe(ALLOCATOR_STALLED_ID);
  });
});

describe("seed portfolio UUIDs match src/lib/demo.ts", () => {
  it("ACTIVE_PORTFOLIO_ID matches", () => {
    expect(SEED_ACTIVE_PORTFOLIO_ID).toBe(ACTIVE_PORTFOLIO_ID);
  });

  it("COLD_PORTFOLIO_ID matches", () => {
    expect(SEED_COLD_PORTFOLIO_ID).toBe(COLD_PORTFOLIO_ID);
  });

  it("STALLED_PORTFOLIO_ID matches", () => {
    expect(SEED_STALLED_PORTFOLIO_ID).toBe(STALLED_PORTFOLIO_ID);
  });
});

// ---------- generatePortfolioAnalyticsJSONB ----------

function holdingFor(index: number, weight: number): PortfolioAnalyticsHolding {
  const profile = STRATEGY_PROFILES[index];
  return {
    strategy_id: profile.id,
    strategy_name: profile.name,
    weight,
    profile,
  };
}

function buildActiveHoldings(): PortfolioAnalyticsHolding[] {
  return [holdingFor(0, 0.4), holdingFor(1, 0.35), holdingFor(2, 0.25)];
}

function buildStalledHoldings(): PortfolioAnalyticsHolding[] {
  return [holdingFor(6, 0.65), holdingFor(3, 0.35)];
}

describe("generatePortfolioAnalyticsJSONB", () => {
  it("is deterministic — the same seed produces byte-identical output", () => {
    const holdings = buildActiveHoldings();
    const a = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9001);
    const b = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9001);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces distinct output for different seeds", () => {
    const holdings = buildActiveHoldings();
    const a = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9001);
    const b = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9002);
    expect(a.total_return_twr).not.toBe(b.total_return_twr);
  });

  it("populates all demo-critical fields without nulls", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );

    // Scalars the /demo hero depends on directly.
    expect(payload.computation_status).toBe("complete");
    expect(payload.total_return_twr).not.toBeNull();
    expect(Number.isFinite(payload.total_return_twr)).toBe(true);
    expect(payload.portfolio_sharpe).not.toBeNull();
    expect(Number.isFinite(payload.portfolio_sharpe)).toBe(true);
    expect(payload.portfolio_max_drawdown).not.toBeNull();
    expect(Number.isFinite(payload.portfolio_max_drawdown)).toBe(true);
    expect(payload.portfolio_volatility).not.toBeNull();
    expect(Number.isFinite(payload.portfolio_volatility)).toBe(true);
    expect(payload.avg_pairwise_correlation).not.toBeNull();
    expect(Number.isFinite(payload.avg_pairwise_correlation)).toBe(true);
    expect(typeof payload.narrative_summary).toBe("string");
    expect(payload.narrative_summary.length).toBeGreaterThan(20);

    // Structured fields.
    expect(payload.attribution_breakdown).toHaveLength(3);
    expect(payload.attribution_breakdown[0].strategy_id).toBe(STRATEGY_UUIDS[0]);
    expect(payload.attribution_breakdown[0].strategy_name).toBe(
      STRATEGY_PROFILES[0].name,
    );
    expect(Number.isFinite(payload.attribution_breakdown[0].contribution)).toBe(
      true,
    );

    expect(payload.risk_decomposition).toHaveLength(3);
    expect(payload.correlation_matrix).not.toBeNull();
    expect(Object.keys(payload.correlation_matrix)).toHaveLength(3);
    expect(payload.correlation_matrix[STRATEGY_UUIDS[0]][STRATEGY_UUIDS[0]]).toBe(1);

    expect(payload.benchmark_comparison).not.toBeNull();
    expect(payload.benchmark_comparison.symbol).toBe("BTC");
    expect(payload.benchmark_comparison.stale).toBe(false);

    expect(payload.portfolio_equity_curve.length).toBeGreaterThan(300);
    expect(payload.portfolio_equity_curve[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(payload.portfolio_equity_curve[0].value)).toBe(true);

    expect(Object.keys(payload.rolling_correlation).length).toBe(1);
  });

  it("handles the 2-strategy STALLED persona without collapsing", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      STALLED_PORTFOLIO_ID,
      buildStalledHoldings(),
      9003,
    );
    expect(payload.attribution_breakdown).toHaveLength(2);
    expect(payload.risk_decomposition).toHaveLength(2);
    expect(Object.keys(payload.rolling_correlation).length).toBe(1);
  });

  it("output round-trips through adaptPortfolioAnalytics without returning null", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );

    // The adapter requires id + computed_at on the Supabase row. The seed
    // payload above omits them because Postgres generates them via DEFAULT;
    // stitch in deterministic values so the adapter has what it needs.
    const rowLike = {
      id: "00000000-0000-4000-8000-000000009001",
      computed_at: "2025-12-31T00:00:00Z",
      ...payload,
    };

    const adapted = adaptPortfolioAnalytics(rowLike);
    expect(adapted).not.toBeNull();
    if (!adapted) return;

    expect(adapted.portfolio_id).toBe(ACTIVE_PORTFOLIO_ID);
    expect(adapted.computation_status).toBe("complete");
    expect(adapted.total_return_twr).toBe(payload.total_return_twr);
    expect(adapted.portfolio_sharpe).toBe(payload.portfolio_sharpe);
    expect(adapted.attribution_breakdown).toHaveLength(3);
    expect(adapted.risk_decomposition).toHaveLength(3);
    expect(adapted.correlation_matrix).not.toBeNull();
    expect(adapted.benchmark_comparison).not.toBeNull();
    expect(adapted.portfolio_equity_curve).not.toBeNull();
    expect(adapted.rolling_correlation).not.toBeNull();
  });

  // ---- PR 11 review fixes ----

  it("rejects 1-strategy holdings (H1 review finding)", () => {
    const single: PortfolioAnalyticsHolding[] = [
      {
        strategy_id: STRATEGY_PROFILES[0].id,
        strategy_name: STRATEGY_PROFILES[0].name,
        weight: 1.0,
        profile: STRATEGY_PROFILES[0],
      },
    ];
    expect(() =>
      generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, single, 9001),
    ).toThrow(/at least 2 entries/);
  });

  it("rejects empty holdings", () => {
    expect(() =>
      generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, [], 9001),
    ).toThrow();
  });

  it("component_var is unit-correct (risk contribution, not variance-squared)", () => {
    // C1 review finding: the previous formula was `(w*vol)^2` which is
    // dimensionally wrong. Under the fixed diagonal+correlation approximation,
    // component_var should roughly sum to the portfolio vol (within ~5% for a
    // low-correlation 3-strategy book).
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );
    const sumComponentVar = payload.risk_decomposition.reduce(
      (s, r) => s + r.component_var,
      0,
    );
    const portVol = payload.portfolio_volatility;
    expect(portVol).toBeGreaterThan(0);
    // Accept a 15% approximation error — we're using a constant-correlation
    // approximation of the full covariance matrix.
    const rel = Math.abs(sumComponentVar - portVol) / portVol;
    expect(rel).toBeLessThan(0.15);
  });

  it("narrative never contains the '+-' double-sign artifact (H3 review finding)", () => {
    // Run the generator against many seeds to hit both positive- and
    // negative-topContributor branches.
    for (const seed of [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008]) {
      const payload = generatePortfolioAnalyticsJSONB(
        ACTIVE_PORTFOLIO_ID,
        buildActiveHoldings(),
        seed,
      );
      expect(payload.narrative_summary).not.toContain("+-");
      expect(payload.narrative_summary).not.toContain("+−");
    }
  });

  it("total_return_mwr equals total_return_twr under no-flows approximation (M2)", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );
    // Both are rounded to 5 decimals so compare rounded.
    const mwr = payload.total_return_mwr;
    const twr = payload.total_return_twr;
    expect(Math.abs(mwr - twr)).toBeLessThan(1e-4);
  });

  it("adapter round-trips the 2-strategy STALLED persona (M1)", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      STALLED_PORTFOLIO_ID,
      buildStalledHoldings(),
      9003,
    );
    const rowLike = {
      id: "00000000-0000-4000-8000-000000009003",
      computed_at: "2025-12-31T00:00:00Z",
      ...payload,
    };
    const adapted = adaptPortfolioAnalytics(rowLike);
    expect(adapted).not.toBeNull();
    if (!adapted) return;
    expect(adapted.attribution_breakdown).toHaveLength(2);
    expect(adapted.risk_decomposition).toHaveLength(2);
    expect(adapted.rolling_correlation).not.toBeNull();
    expect(Object.keys(adapted.rolling_correlation ?? {}).length).toBe(1);
  });
});

describe("formatSignedPct", () => {
  it("prefixes positive values with '+'", () => {
    expect(formatSignedPct(0.1234)).toBe("+12.34%");
  });

  it("renders negative values as '-' without an extra '+'", () => {
    expect(formatSignedPct(-0.0123)).toBe("-1.23%");
  });

  it("prefixes zero with '+'", () => {
    expect(formatSignedPct(0)).toBe("+0.00%");
  });

  it("respects the digits arg", () => {
    expect(formatSignedPct(0.1234, 1)).toBe("+12.3%");
  });
});

describe("approximateMwr", () => {
  it("returns TWR under no-flow approximation (M2 fix)", () => {
    expect(approximateMwr(0.18)).toBe(0.18);
    expect(approximateMwr(-0.04)).toBe(-0.04);
    expect(approximateMwr(0)).toBe(0);
  });
});

// ---------- PURGE-01 / PURGE-06 import-graph scan (Phase 07 Plan 06) ----------
//
// These blocks mechanically enforce that demo-seed constants stay confined to
// /demo routes + test fixtures. Any new authenticated code path that imports
// `@/lib/demo` or references `ALLOCATOR_ACTIVE_ID` / `isDemoPortfolioId` will
// fail CI here.
//
// Citation: `.planning/phases/07-demo-mode-purge/07-RESEARCH.md` §4 is the
// authoritative call-site table; the allowlist below MUST match that table.

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip node_modules, .next, and any dotfile directory defensively —
      // the test walks src/ only, so these should not appear, but guard.
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(full, acc);
    } else if (s.isFile() && /\.(ts|tsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

const PROJECT_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const MIGRATIONS_ROOT = resolve(PROJECT_ROOT, "supabase/migrations");

// Explicit allowlist — every file permitted to reference demo constants.
// Citation: RESEARCH.md §4 audit table + CONTEXT.md D-14.
const DEMO_REFERENCE_ALLOWLIST = [
  "src/lib/demo.ts",
  "src/lib/demo.test.ts",
  "src/__tests__/seed-integrity.test.ts",
  // admin-only tooling per RESEARCH.md §4 row — allowed even though current
  // grep shows no direct import. Entry kept so future admin-only references
  // don't need an allowlist edit.
  "src/lib/admin/match.ts",
];

const DEMO_ROUTE_PREFIXES = [
  "src/app/demo/",
  "src/app/api/demo/",
];

const DEMO_PATTERN =
  /ALLOCATOR_ACTIVE_ID|isDemoPortfolioId|from\s+['"]@\/lib\/demo['"]/;

function isAllowed(relPath: string): boolean {
  if (DEMO_REFERENCE_ALLOWLIST.includes(relPath)) return true;
  if (DEMO_ROUTE_PREFIXES.some((p) => relPath.startsWith(p))) return true;
  return false;
}

describe("PURGE-01 / PURGE-06: demo constants confined to /demo + test fixtures", () => {
  it("src/lib/queries.ts has no reference to demo constants", () => {
    const file = resolve(SRC_ROOT, "lib/queries.ts");
    const content = readFileSync(file, "utf-8");
    expect(content).not.toMatch(DEMO_PATTERN);
  });

  it("no file under src/app/(dashboard) references demo constants", () => {
    const files = walk(resolve(SRC_ROOT, "app/(dashboard)"));
    const offenders = files.filter((f) => {
      const rel = relative(PROJECT_ROOT, f);
      if (isAllowed(rel)) return false;
      return DEMO_PATTERN.test(readFileSync(f, "utf-8"));
    });
    expect(offenders).toEqual([]);
  });

  it("no file under src/app/api (excluding /api/demo) references demo constants", () => {
    const files = walk(resolve(SRC_ROOT, "app/api")).filter(
      (f) => !relative(PROJECT_ROOT, f).startsWith("src/app/api/demo/"),
    );
    const offenders = files.filter((f) =>
      DEMO_PATTERN.test(readFileSync(f, "utf-8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no file under src/lib (excluding demo.ts/demo.test.ts/admin/match.ts) references demo constants", () => {
    const files = walk(resolve(SRC_ROOT, "lib"));
    const offenders = files.filter((f) => {
      const rel = relative(PROJECT_ROOT, f);
      if (isAllowed(rel)) return false;
      return DEMO_PATTERN.test(readFileSync(f, "utf-8"));
    });
    expect(offenders).toEqual([]);
  });

  it("exact allowlist — set of all referencing files is known", () => {
    const allSrcFiles = walk(SRC_ROOT);
    const referencing = allSrcFiles
      .filter((f) => DEMO_PATTERN.test(readFileSync(f, "utf-8")))
      .map((f) => relative(PROJECT_ROOT, f))
      .sort();
    for (const f of referencing) {
      expect(
        isAllowed(f),
        `unexpected demo reference: ${f}`,
      ).toBe(true);
    }
  });
});

// ---------- PURGE-05 / VOICES-ACCEPTED f4 migration co-occurrence scan ------
//
// Previously the seed-integrity suite asserted "at most one `ON auth.users`
// substring globally" — that's too weak because a future migration could
// add a second benign trigger on a different table and accidentally include
// seed inserts. The co-occurrence check below is stricter: for every
// `supabase/migrations/*.sql` file, fail if it contains BOTH `ON auth.users`
// AND `INSERT INTO public.portfolios|allocator_holdings|allocator_equity_snapshots`.
//
// Current codebase expectation: exactly one file contains `ON auth.users`
// (migration 002, the benign `handle_new_user` trigger), and its handler
// inserts only into `public.profiles`. The positive-control test below
// locks that in as a regression guard.

describe("PURGE-05 / VOICES-ACCEPTED f4: no migration file co-occurs ON auth.users + seed-INSERT", () => {
  const SEED_INSERT_PATTERN =
    /INSERT\s+INTO\s+(public\.)?(portfolios|allocator_holdings|allocator_equity_snapshots)/i;
  const AUTH_USERS_TRIGGER_PATTERN = /ON\s+auth\.users/i;

  it("no migration has both `ON auth.users` and a seed-table INSERT (co-occurrence)", () => {
    const migrationFiles = readdirSync(MIGRATIONS_ROOT)
      .filter((n) => n.endsWith(".sql"))
      .map((n) => resolve(MIGRATIONS_ROOT, n));
    const offenders: string[] = [];
    for (const file of migrationFiles) {
      const content = readFileSync(file, "utf-8");
      if (
        AUTH_USERS_TRIGGER_PATTERN.test(content) &&
        SEED_INSERT_PATTERN.test(content)
      ) {
        offenders.push(relative(PROJECT_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("migration 002 has the benign handle_new_user trigger (positive control)", () => {
    const file = resolve(MIGRATIONS_ROOT, "002_rls_policies.sql");
    const content = readFileSync(file, "utf-8");
    // Benign trigger: on_auth_user_created → handle_new_user → INSERT INTO public.profiles
    expect(content).toMatch(/CREATE\s+TRIGGER\s+on_auth_user_created/);
    expect(content).toMatch(/handle_new_user/);
    expect(content).toMatch(/INSERT\s+INTO\s+public\.profiles/);
    // It should NOT reference portfolios/allocator_holdings/allocator_equity_snapshots:
    expect(content).not.toMatch(/INSERT\s+INTO\s+public\.portfolios/);
    expect(content).not.toMatch(/INSERT\s+INTO\s+allocator_holdings/);
    expect(content).not.toMatch(/INSERT\s+INTO\s+allocator_equity_snapshots/);
  });
});
