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
      //   - no-raw-font-px → repo-wide ERROR as of Phase 54 / BP-03 (the final
      //     strangler flip; was `warn` through phases 49–53). Phases 54-01b/
      //     02a/02b cleaned every migratable non-frozen, non-test orphan to the
      //     `--text-fixed-*` / named `--text-*` tiers, and 54-01a added the
      //     frozen-chart off-glob, so the repo-wide flip now passes with 0
      //     errors. The Phase-52/53 per-surface `error` ratchet blocks below are
      //     redundant once repo-wide is error, but are harmless and left in
      //     place (future cleanup, not required by BP-03).
      //
      //     BP-03 AUDIT NOTE — "error repo-wide" is satisfied as "error
      //     everywhere EXCEPT the documented frozen-chart islands". The frozen
      //     EquityChart (src/app/(dashboard)/allocations/widgets/performance/
      //     EquityChart.tsx) and the three chart-internal factsheet SVGs
      //     (TimeSeriesChart/HistogramChart/MasterBrush) carry raw `text-[Npx]`
      //     sites that can NEVER migrate: they are in the FROZEN_ISLANDS
      //     git-diff-zero list at phase-52-frozen-spine-guards.test.ts:158, so
      //     any byte edit reds the frozen-spine guard. The CONTEXT-locked
      //     resolution of the BP-03-vs-FROZEN_ISLANDS conflict is to EXEMPT
      //     them via the `off` glob below (mirroring src/components/charts/**),
      //     NEVER to edit them. This is NOT an unmet BP-03 gap — it is the
      //     documented island carve-out. WorstDrawdowns.tsx rides the
      //     components/charts/** off-glob; test/spec fixtures ride the
      //     test-exempt block. No production source can author a new raw px
      //     without failing CI.
      "quantalyze/no-rem-less-clamp": "error",
      "quantalyze/no-raw-font-px": "error",
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
  // Phase-52/53 per-surface `error` ratchet — the strangler that PRECEDED the
  // BP-03 repo-wide flip. As of Phase 54 / BP-03 the repo-wide default is now
  // `error` (see the top-of-file block), so every entry below is REDUNDANT and
  // harmless — retained as the historical ratchet record, no longer load-bearing.
  // All formerly-orphan files were migrated to `text-fixed-N` in 54-01b/02a/02b
  // and ride the repo-wide `error` clean; the only surviving raw-px holdouts are
  // the off-globbed frozen chart islands (EquityChart + the 3 factsheet SVGs)
  // + components/charts/**.
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
      // Factsheet v2 — per-FILE (Phase-52 record; all factsheet files incl.
      // MetricsColumn/MandatePanels/StressWindowsPanel/page were migrated in
      // 54-01b and now ride the repo-wide `error` clean. The chart-internal SVGs
      // TimeSeriesChart/HistogramChart/MasterBrush remain off-globbed (frozen)):
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
      // Phase 53 (v1.4) — Plan 53-02 wizard surface migration. Every raw
      // text-[Npx] / text-sm/-xs / text-2xl/-3xl across the wizard
      // (strategies/new + wizard + steps, incl. the new ReviewStep) is now
      // on the named --text-* tiers (form category: page-title/h3/body/
      // caption + micro for badge/chip/counter text). Grep-verified clean.
      "src/app/(dashboard)/strategies/new/**",
      // Phase 53 (v1.4) — Plan 53-06 admin + portfolios DATA surfaces. Plans
      // 53-04 (components/portfolio + portfolios page tree) and 53-05 (admin
      // page tree + components/admin tables) migrated every raw text-[Npx] to
      // the named --text-* tiers; both surfaces grep clean (0 raw px). Flip the
      // four glob trees to error now. The shared EmptyStateCard primitive
      // (src/components/ui/EmptyStateCard.tsx — rendered into both surfaces via
      // CorrelationHeatmap / degenerate admin states) carried the last
      // text-[11px]; it was migrated to text-micro in 53-06 (option a — single
      // clean site), so the components/ui home stays clean too. This is the
      // per-surface ratchet ONLY — the repo-wide flip is Phase 54 BP-03.
      "src/app/(dashboard)/admin/**",
      "src/components/admin/**",
      "src/app/(dashboard)/portfolios/**",
      "src/components/portfolio/**",
    ],
    rules: { "quantalyze/no-raw-font-px": "error" },
  },
  // Phase 54 / BP-03 — FROZEN-island chart off-glob. These 4 files carry raw
  // `text-[Npx]` sites but can NEVER migrate: they are in the FROZEN_ISLANDS
  // git-diff-zero list (src/__tests__/phase-52-frozen-spine-guards.test.ts:158),
  // so any byte change reds the frozen-spine guard. The CONTEXT-locked BP-03/
  // FROZEN conflict resolution is to EXEMPT them via this `off` glob (mirroring
  // the src/components/charts/** block below) instead of editing them — so the
  // repo-wide `error` flip (Plan 54-05) passes while the render stays
  // byte-identical. EquityChart lives under allocations/widgets/performance/,
  // NOT under src/components/charts/**, so it needs an explicit entry; the three
  // factsheet SVG charts (TimeSeriesChart/HistogramChart/MasterBrush) are the
  // chart-internal frozen islands. NEVER add edits to these files.
  //
  // NOTE (Plan 54-05): the three factsheet paths live under the literal `[id]`
  // dynamic-route segment, so the brackets MUST be backslash-escaped. ESLint
  // flat config matches `files` with minimatch, which reads an unescaped `[id]`
  // as a character class (one of `i`/`d`) — NOT the literal directory `[id]` —
  // so the unescaped form silently fails to match and the files ride the
  // repo-wide rule. Before the warn→error flip that was harmless (they stayed
  // `warn`); at `error` it would red CI on these frozen files. Escaping `\[id\]`
  // makes the off-glob actually match the on-disk path. EquityChart has no
  // bracket segment, so it matches as written.
  {
    files: [
      "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx",
      "src/app/factsheet/\\[id\\]/v2/TimeSeriesChart.tsx",
      "src/app/factsheet/\\[id\\]/v2/HistogramChart.tsx",
      "src/app/factsheet/\\[id\\]/v2/MasterBrush.tsx",
    ],
    rules: { "quantalyze/no-raw-font-px": "off" },
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
