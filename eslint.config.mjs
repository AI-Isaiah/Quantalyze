import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import quantalyze from "./tools/eslint-plugin-quantalyze/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Honor the underscore-prefix convention for intentionally unused
      // params/vars (Supabase mock signatures, Next.js route handlers
      // that don't read the request, etc.).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // B25 — local by-construction lint capstone (eslint-plugin-quantalyze).
  // Each rule is the edit-time backstop for a finding-class the cross-cutting
  // refactor program closed via a single source of truth; offenders are pointed
  // at the canonical helper. Set to "error" (not "warn") because the recon
  // proved a clean baseline, so these fail CI by construction on a future raw
  // offender — the literal goal of the capstone. A deliberate exception carries
  // a greppable `B<n> sanctioned-exception:` (or `B10 visibility:`) comment in
  // the file. See .planning/audit-2026-05-07/B25-PLAN.md.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { quantalyze },
    rules: {
      "quantalyze/no-raw-localstorage": "error",
      "quantalyze/no-raw-published-predicate": "error",
      "quantalyze/no-raw-retry-after-parse": "error",
      // B9 — ban Zod .passthrough()/.catchall() at boundary parsers. Enforced
      // repo-wide (not file-scoped) because passthrough only ever appears at a
      // boundary in this codebase, so a global ban with a greppable per-site
      // `// eslint-disable-line ... -- B9 sanctioned-exception:` escape is a
      // stronger lock than a file allowlist that could go stale when a new
      // boundary module is added.
      "quantalyze/no-passthrough-on-ipc": "error",
      // B14 — ban re-deriving sync staleness from a raw `last_sync_at` vs cutoff
      // comparison; route through deriveSyncFreshness() (@/lib/sync-freshness) so
      // the 24h cutoff lives in one place (two-sync-time max/sort is still fine).
      "quantalyze/no-raw-staleness-derivation": "error",
      // DS-04 (Phase 49) — fluid type spine guards. SCOPED, NOT big-bang: unlike
      // the B-series rules above (clean baselines → repo-wide error), the raw-px
      // baseline is DIRTY (recon: 558 `text-[NNpx]` + 355 hex sites across 54
      // files). A repo-wide `error` here would red-CI the whole tree and force
      // the deferred strangler migration (phases 52/53) into Phase 49. So:
      //   - no-rem-less-clamp → repo-wide ERROR: recon proved a CLEAN baseline
      //     (zero rem-less clamp STRINGS in TSX today; the numeric Math-style
      //     clamp() helpers are call expressions the rule deliberately ignores),
      //     so it fails CI by construction on a future zoom-unsafe clamp string.
      //   - no-raw-font-px → repo-wide WARN here (dirty baseline stays visible
      //     but non-blocking); hard ERROR only on the proven-clean
      //     `src/lib/design-tokens/**` surface plus the Phase-52 per-surface /
      //     per-file ratchet override block below. The 52/53 strangler ratchets
      //     the remaining dirty surfaces to error one at a time. Phase 52 is
      //     done: its grep-verified-clean allocator-journey surfaces (compare/,
      //     discovery/, strategy/[id]/ + the clean allocations/factsheet files)
      //     are now error; the orphan allocations/factsheet files (incl. the
      //     frozen EquityChart + chart-internal SVG) and the Phase-53 surfaces
      //     (portfolios/security/admin/wizard) remain at warn — see
      //     .planning/phases/52-…/deferred-items.md for the orphan-px debt list.
      //     Chart / designer-bundle ports are turned off by glob; a one-off
      //     carries a greppable `DS-04 sanctioned-exception:` comment.
      "quantalyze/no-rem-less-clamp": "error",
      "quantalyze/no-raw-font-px": "warn",
    },
  },
  // DS-04 hard gate on the proven-clean new token/primitive surface. The
  // design-tokens dir has ZERO `text-[NNpx]` / `fontSize:'NNpx'` sites today
  // (recon), so escalating it to `error` locks the clean surface without
  // touching the dirty 53/54 the strangler migration owns.
  {
    files: ["src/lib/design-tokens/**"],
    rules: { "quantalyze/no-raw-font-px": "error" },
  },
  // Phase 52 (v1.4) strangler ratchet — per-surface / per-file no-raw-font-px
  // ERROR for the allocator-journey surfaces 52-02..06 migrated to the fluid
  // `--text-*` spine. SCOPE-CORRECTED vs the original 52-07 plan (user decision
  // "per-file ratchet + log debt"): allocations/** and factsheet/[id]/v2/** are
  // NOT flipped whole — the planner under-scoped those migrations, so each tree
  // still carries ORPHAN raw-px files (allocations: 18 incl. the FROZEN
  // EquityChart that can never migrate; factsheet: 7 incl. the chart-internal
  // SVG TimeSeriesChart/HistogramChart/MasterBrush). Flipping the whole glob
  // would red CI. Instead we list ONLY the grep-proven-clean (zero raw
  // text-[Npx]) globs + files. The orphan files stay at the repo-wide `warn`
  // and are logged as Phase-53/54 debt in
  // .planning/phases/52-…/deferred-items.md. Phase-53 surfaces
  // (portfolios/security/admin/wizard) are untouched — the ratchet is
  // per-surface, not big-bang.
  {
    files: [
      // Fully-clean surface globs (grep-verified 0 raw text-[Npx]):
      "src/app/(dashboard)/compare/**",
      "src/app/(dashboard)/discovery/**",
      "src/app/strategy/[id]/**",
      // Clean component files:
      "src/components/strategy/CompareTable.tsx",
      "src/components/strategy/StrategyGrid.tsx",
      // Allocations — per-FILE (only the grep-proven-clean files; the orphan
      // widgets/components + the frozen EquityChart stay at warn):
      "src/app/(dashboard)/allocations/HoldingsTabPanel.tsx",
      "src/app/(dashboard)/allocations/RiskTabPanel.tsx",
      "src/app/(dashboard)/allocations/OutcomesTabPanel.tsx",
      "src/app/(dashboard)/allocations/ScenarioStub.tsx",
      "src/app/(dashboard)/allocations/EmptyState.tsx",
      "src/app/(dashboard)/allocations/AllocationContext.tsx",
      "src/app/(dashboard)/allocations/page.tsx",
      "src/app/(dashboard)/allocations/loading.tsx",
      "src/app/(dashboard)/allocations/error.tsx",
      "src/app/(dashboard)/allocations/components/KpiStrip.tsx",
      "src/app/(dashboard)/allocations/components/AlertBanner.tsx",
      "src/app/(dashboard)/allocations/components/HoldingsTable.tsx",
      "src/app/(dashboard)/allocations/components/StressVarSection.tsx",
      "src/app/(dashboard)/allocations/components/MonteCarloSection.tsx",
      "src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx",
      // Factsheet v2 — per-FILE (only grep-proven-clean; the chart-internal
      // TimeSeriesChart/HistogramChart/MasterBrush + MetricsColumn/MandatePanels/
      // StressWindowsPanel/page stay at warn as orphan debt):
      "src/app/factsheet/[id]/v2/FactsheetView.tsx",
      "src/app/factsheet/[id]/v2/AnalyticalPanels.tsx",
      "src/app/factsheet/[id]/v2/BatchDPanels.tsx",
      "src/app/factsheet/[id]/v2/ComparatorPicker.tsx",
      "src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx",
      "src/app/factsheet/[id]/v2/DistributionPanels.tsx",
      "src/app/factsheet/[id]/v2/HeatmapPanels.tsx",
      "src/app/factsheet/[id]/v2/SignaturePanels.tsx",
      "src/app/factsheet/[id]/v2/LazyMount.tsx",
      "src/app/factsheet/[id]/v2/factsheet-context.tsx",
      "src/app/factsheet/[id]/v2/loading.tsx",
      "src/app/factsheet/[id]/v2/error.tsx",
      "src/app/factsheet/[id]/v2/not-found.tsx",
      // Phase 53 (v1.4) — Plan 53-03 marketing/security body migration.
      // SCOPED to the PAGE BODIES only (per-file, mirroring the allocations/
      // factsheet per-file precedent above): the shared P51 (marketing) shell —
      // legal/layout.tsx, demo/layout.tsx — and the for-quants component files
      // (RequestCallModal.tsx, ForQuantsCtas.tsx) still carry raw-font debt and
      // stay at the repo-wide `warn` (deferred to a later 53/54 surface). The
      // /security tree is its own clean glob (page.tsx is the only file).
      "src/app/(marketing)/security/**",
      "src/app/(marketing)/page.tsx",
      "src/app/(marketing)/for-quants/page.tsx",
      "src/app/(marketing)/demo/page.tsx",
      "src/app/(marketing)/demo/founder-view/page.tsx",
      "src/app/(marketing)/legal/disclaimer/page.tsx",
      "src/app/(marketing)/legal/privacy/page.tsx",
      "src/app/(marketing)/legal/terms/page.tsx",
      // (auth)/** — 0 raw text-[Npx] today (PATTERNS A4: no migration needed);
      // flip to error to lock the clean surface against regression.
      "src/app/(auth)/**",
    ],
    rules: { "quantalyze/no-raw-font-px": "error" },
  },
  // Context allow-list: Recharts axis colors / designer-bundle chart ports pin
  // raw px sizes legitimately. Turn BOTH DS-04 rules off here (mirrors how
  // no-raw-localstorage is off for src/lib/storage/**).
  {
    files: ["src/components/charts/**"],
    rules: {
      "quantalyze/no-raw-font-px": "off",
      "quantalyze/no-rem-less-clamp": "off",
    },
  },
  // Directory exemptions: the canonical helpers' own homes legitimately contain
  // the raw pattern they encapsulate.
  {
    files: ["src/lib/storage/**"],
    rules: { "quantalyze/no-raw-localstorage": "off" },
  },
  {
    files: ["src/lib/retry/**"],
    rules: { "quantalyze/no-raw-retry-after-parse": "off" },
  },
  {
    files: ["src/lib/sync-freshness/**"],
    rules: { "quantalyze/no-raw-staleness-derivation": "off" },
  },
  // Test/spec files are exempt: they deliberately exercise the raw patterns to
  // set up fixtures and assert behaviour (e.g. SignOutButton.test.tsx seeds raw
  // localStorage keys to prove the purge removes them; a parser test feeds a
  // hostile Retry-After value). This mirrors the established by-construction
  // grep tests, which skip `*.test.*`/`*.spec.*` themselves (see
  // visibility.test.ts). The rules guard PRODUCTION state drift, not tests.
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "quantalyze/no-raw-localstorage": "off",
      "quantalyze/no-raw-published-predicate": "off",
      "quantalyze/no-raw-retry-after-parse": "off",
      "quantalyze/no-passthrough-on-ipc": "off",
      "quantalyze/no-raw-staleness-derivation": "off",
      // DS-04: test fixtures deliberately author raw px / vw-only clamps to
      // assert the rules fire — the rules guard PRODUCTION source, not tests.
      "quantalyze/no-raw-font-px": "off",
      "quantalyze/no-rem-less-clamp": "off",
    },
  },
]);

export default eslintConfig;
