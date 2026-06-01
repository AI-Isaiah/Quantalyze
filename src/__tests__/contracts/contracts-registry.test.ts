import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import quantalyzePlugin from "../../../tools/eslint-plugin-quantalyze/index.mjs";

/**
 * B25 — the contracts registry guard.
 *
 * The cross-cutting refactor program (B1–B24) closed many finding-CLASSES "by
 * construction" and left a guard behind for each: a grep sweep, a compile-time
 * `@ts-expect-error` pairing, a parity matrix, a registry-completeness check,
 * or — new in B25 — an eslint-plugin-quantalyze AST rule. Those guards already
 * run in the normal suite, but nothing pinned the *set* of them: a guard could
 * be deleted/renamed and CI would stay green (the silent-reintroduction gap the
 * capstone exists to close).
 *
 * This file is that pin. It is the discoverable registry + the fail-loud teeth:
 *   - every registered guard file must still exist (delete/rename → red CI);
 *   - the plugin must export exactly the expected rule set;
 *   - eslint.config.mjs must wire every rule at "error";
 *   - the contracts.yml CI surface must exist and run the contracts + lint.
 *
 * NOTE: this is a registry + wiring integrity check, NOT a re-run of each
 * guard (they execute in the normal vitest suite + contracts.yml). See
 * src/__tests__/contracts/REGISTRY.md for the human-readable table + the
 * honesty-gate inventory of classes that are already type-enforced and
 * deliberately have NO guard here.
 */

const ROOT = process.cwd();

const EXPECTED_RULES = [
  "no-raw-localstorage",
  "no-raw-published-predicate",
  "no-raw-retry-after-parse",
] as const;

interface Guard {
  path: string;
  batch: string;
  invariant: string;
}

// The canonical set of by-construction invariant guards. Keep in step with
// REGISTRY.md. A guard removed/renamed without updating this list fails the
// existence test below.
const CONTRACT_GUARDS: Guard[] = [
  { path: "src/lib/visibility.test.ts", batch: "B10", invariant: "no raw .eq('status','published') outside withPublishedOnly (grep sweep)" },
  { path: "src/lib/api/limiter-ordering.test.ts", batch: "B15", invariant: "rate-limit route ordering registry + completeness" },
  { path: "src/__tests__/audit-event-union-types.test.ts", batch: "B4c", invariant: "audit action↔entity_type pairing (compile-time @ts-expect-error)" },
  { path: "src/lib/closed-sets.test.ts", batch: "B8", invariant: "closed-set registry (exchanges/roles) pinned + satisfies guarantee" },
  { path: "src/__tests__/metrics-parity.test.ts", batch: "B9", invariant: "cross-runtime metrics schema parity (golden fixture)" },
  { path: "src/__tests__/metrics-parity-helper.test.ts", batch: "B9", invariant: "TS-side trade-mix bucket-mode parity" },
  { path: "src/app/api/allocator/scenario/commit/percent-allocated-parity.test.ts", batch: "B9", invariant: "percent_allocated parity: Zod ↔ DB CHECK ↔ RPC validator" },
  { path: "src/__tests__/strategy-sources-migration-parity.test.ts", batch: "B9", invariant: "STRATEGY_SOURCES TS registry ↔ SQL CHECK constraint parity" },
  { path: "src/__tests__/strategies-source-csv-constraint.test.ts", batch: "B9", invariant: "strategies.source CHECK admits 'csv'" },
  { path: "src/__tests__/critical-regressions.test.ts", batch: "B24", invariant: "VERSION/package.json sync + dynamic workflow-security policy" },
  { path: "src/__tests__/audit-coverage.test.ts", batch: "Audit", invariant: "every Supabase mutation emits an audit event (grep)" },
  { path: "src/__tests__/admin-csrf-ratelimit-grep.test.ts", batch: "Audit", invariant: "CSRF + admin rate-limit coverage on mutating handlers (grep)" },
  { path: "src/__tests__/redteam-b02-regressions.test.ts", batch: "B02", invariant: "red-team b02 fix regressions (grep)" },
  { path: "src/__tests__/audit-log-cold-archive.fail-loud.test.ts", batch: "C-0004", invariant: "no silent-skip in audit cold-archive integration test (static guard)" },
  { path: "src/__tests__/gdpr-export.test.ts", batch: "GDPR", invariant: "GDPR export manifest shape invariants (no dupes/ordering)" },
  { path: "src/__tests__/gdpr-export-coverage-hook.test.ts", batch: "B10/GDPR", invariant: "GDPR coverage-hook exit-code contract (class-guard)" },
  { path: "src/__tests__/mandate-columns-schema-sync.test.ts", batch: "Mandate", invariant: "ALLOCATOR_PREFERENCES_COLUMNS ↔ live-DB projection sync" },
  { path: "src/__tests__/check-banned-packages.test.ts", batch: "Supply-chain", invariant: "banned packages absent from direct + transitive deps" },
  { path: "src/__tests__/gitleaks-allowlist.test.ts", batch: "Secrets", invariant: ".gitleaks.toml allowlist shape + fixture-to-pattern match" },
  { path: "src/__tests__/security-packet-date-drift.test.ts", batch: "M-0943", invariant: "security-packet HTML date ↔ security page date parity" },
  { path: "src/__tests__/vercel-cron-limits.test.ts", batch: "Cron", invariant: "vercel.json ≤10 crons with sub-daily allowlist" },
  { path: "src/__tests__/widget-state-no-duplicate-empty.test.ts", batch: "UI", invariant: "EmptyState reuse (no duplicate copy) grep sweep" },
  { path: "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts", batch: "B7c", invariant: "factsheet view-state codec byte-compat + poison-strip" },
  { path: "src/app/(dashboard)/allocations/context/TweaksContext.codec.test.ts", batch: "B7", invariant: "tweaks codec byte-compat + poison-strip" },
  // Check scripts (run as CI gates, not vitest):
  { path: "scripts/check-admin-route-manifest.ts", batch: "C-0153", invariant: "ADMIN_ROUTE_MANIFEST ↔ admin route files completeness (lint gate)" },
  { path: "scripts/check-gdpr-export-coverage.ts", batch: "GDPR", invariant: "all user-owned tables declared in the export manifest (CI gate)" },
];

describe("[B25] contracts registry — by-construction invariant guards", () => {
  it("registers a non-trivial set (fail-loud on accidental truncation)", () => {
    expect(
      CONTRACT_GUARDS.length,
      "CONTRACT_GUARDS shrank unexpectedly — did a registry entry get dropped?",
    ).toBeGreaterThanOrEqual(20);
  });

  it.each(CONTRACT_GUARDS)("guard exists: $path [$batch]", ({ path }) => {
    expect(
      existsSync(join(ROOT, path)),
      `Registered contract guard missing: ${path}. If it was intentionally ` +
        `removed/renamed, update this registry + src/__tests__/contracts/REGISTRY.md ` +
        `(do NOT just delete the guard — that re-opens a closed finding-class silently).`,
    ).toBe(true);
  });
});

describe("[B25] eslint-plugin-quantalyze wiring integrity", () => {
  it("plugin exports exactly the expected rule set", () => {
    expect(Object.keys(quantalyzePlugin.rules ?? {}).sort()).toEqual(
      [...EXPECTED_RULES].sort(),
    );
  });

  it('resolves every quantalyze rule to "error" for a representative src file', async () => {
    // Assert the RESOLVED severity, not a config substring: a text match for
    // `"quantalyze/X": "error"` stays green even if a later over-broad
    // `{ files: ["src/**"], rules: { "quantalyze/X": "off" } }` override neuters
    // the rule (flat-config last-match-wins) — the exact silent-reintroduction
    // the capstone exists to close. calculateConfigForFile resolves the effective
    // level for a real, non-exempt src file (also robust to quote reformatting).
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: ROOT });
    const cfg = await eslint.calculateConfigForFile("src/lib/visibility.ts");
    for (const rule of EXPECTED_RULES) {
      const entry = (cfg.rules ?? {})[`quantalyze/${rule}`];
      const severity = Array.isArray(entry) ? entry[0] : entry;
      expect(
        severity === 2 || severity === "error",
        `quantalyze/${rule} must RESOLVE to "error" for src files (got ${JSON.stringify(entry)}). ` +
          `A missing wiring or an over-broad "off" override silently neuters the by-construction CI teeth.`,
      ).toBe(true);
    }
  });

  it("contracts.yml exists and runs the contracts + lint", () => {
    const wf = join(ROOT, ".github/workflows/contracts.yml");
    expect(existsSync(wf), ".github/workflows/contracts.yml missing").toBe(true);
    const src = readFileSync(wf, "utf8");
    expect(src.includes("src/__tests__/contracts/")).toBe(true);
    expect(src.includes("eslint")).toBe(true);
  });
});
