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
      // CONTRIB-04 — ban a raw owner-OR `.or(...user_id.eq...)` outside
      // withPublishedOrOwner (src/lib/visibility.ts). Clean baseline, so this
      // fails CI by construction on a future admin-client swap that would
      // bypass the strategies_read RLS backstop.
      "quantalyze/no-owner-or-on-admin-client": "error",
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
      // SEAM-01 (Phase 140) — ban a raw fetch() of the analytics service base
      // URL outside src/lib/resilient-fetch.ts. The core owns the per-call-site
      // timeout budget and the shared breaker:railway circuit breaker; a raw
      // fetch has neither, so it can hold a function slot to the ceiling and
      // keep hammering a deployment the breaker has already judged down.
      //
      // Clean baseline, PROVEN rather than assumed: after waves 1-3 the
      // whole-repo scan for the env var returns comment-only hits plus the four
      // allowlisted files below, so "error" costs nothing today and fails CI by
      // construction on a tenth seam. This is the ONLY mechanism that keeps
      // SEAM-01 true after the merge — the third seam existed for months
      // because routing through the client was a convention, not a mechanism.
      "quantalyze/no-raw-analytics-fetch": "error",
    },
  },
  // SEAM-01 allowlist — the CLOSED set of files that may legitimately hold the
  // analytics base URL and fetch it directly. FOUR paths, and adding a fifth is
  // the wrong fix for a lint failure: a new violation means a new seam call
  // site, which belongs in the core (threat T-140-26). Every entry corresponds
  // to the core itself or to a documented SEAM_EXCLUSIONS row in
  // src/lib/resilient-fetch.ts, which carries the per-file reasoning.
  {
    files: [
      // The core itself — the only legal home for the base URL.
      "src/lib/resilient-fetch.ts",
      // Bespoke SSE/heartbeat route with client-abort propagation the core does
      // not model. Pins its own maxDuration.
      "src/app/api/debug-key-flow/**",
      // Health warmers. These must NOT consume breaker failure budget (a cold
      // /health probe failing IS the normal case) and must NOT be blocked by an
      // open breaker, because a successful /health is the recovery signal.
      "src/app/api/cron/warm-analytics/**",
      "src/lib/warmup-analytics.ts",
    ],
    rules: { "quantalyze/no-raw-analytics-fetch": "off" },
  },
  // DS-04 hard gate on the proven-clean new token/primitive surface. The
  // design-tokens dir has ZERO `text-[NNpx]` / `fontSize:'NNpx'` sites today
  // (recon), so escalating it to `error` locks the clean surface without
  // touching the dirty 53/54 the strangler migration owns.
  {
    files: ["src/lib/design-tokens/**"],
    rules: { "quantalyze/no-raw-font-px": "error" },
  },
  // SEAMRIM-11 (Phase 140.4) — ban an awaited PostgREST read destructured for
  // `data`/`count` without binding `error`. supabase-js resolves a failed read
  // AS A VALUE, so an unchecked destructure is indistinguishable from a
  // genuinely empty table; coerced through `?? 0` / `?? []` it becomes a
  // measurement the product never took (C-3).
  //
  // SCOPED, NOT big-bang — the same register as no-raw-font-px above, and for
  // the same reason. The repo-wide baseline is DIRTY, and the population is
  // DEFINITION-DEPENDENT: four honest measurements disagree because they
  // measured different things, so the number is meaningless without its
  // predicate.
  //   -  32 — the review/synthesis: object-destructure, `src/app/api/**` ONLY.
  //   -  73 — the pattern-mapper: object-destructure that never reads `.error`,
  //           repo-wide (minus 2 verified false positives).
  //   - 139 — the researcher: 372 total read sites − 233 checked
  //           (125 reads + 14 silent writes).
  //   - 155 sites / 75 files — THIS RULE's own predicate, measured at the
  //           140.4 tree over `src/**/*.{ts,tsx}`: an AWAITED PostgREST call
  //           (`.from()`/`.rpc()`, storage excluded) destructured for a `data`
  //           or `count` KEY with no `error` KEY, in EITHER the object form or
  //           the `Promise.all` ARRAY form, not terminated by `.throwOnError()`.
  //           Higher than the mapper's 73 chiefly because it also sees the
  //           array form and counts each unchecked member separately.
  // A repo-wide `error` would red-CI the whole tree on a class Phase 140.4 is
  // not scoped to close. So: `error` on the surface a plan has actually PROVEN
  // clean, RATCHETED outward as later phases convert files.
  //
  // The glob is ONE file today, and which file was decided by measurement, not
  // by assumption. Plans 140.4-01 and 140.4-02 each converted one file:
  //   - 140.4-01 → src/app/api/admin/strategy-review/route.ts — the rule
  //     reports 0 sites. Its six-member Promise.all binds `error` on every
  //     member, so the ratchet is real teeth on a real array-form surface.
  //   - 140.4-02 → SyncPreviewStep.tsx — ADMITTED (140.4-16 / WR-02). It was
  //     held out on a measurement that this phase's OWN later plan falsified,
  //     and the paragraph recording the hold-out outlived the reason for it.
  //     The text here used to read: "the rule reports 1 site (:521, `const {
  //     data: existing } = await supabase.from("strategy_analytics")…`) … it
  //     joins the glob when that read is converted." Plan 140.4-12 converted
  //     exactly that read, in this same phase (`SyncPreviewStep.tsx` now binds
  //     `error` there), and nobody came back to advance the ratchet — the same
  //     plan-12/plan-13 hand-off hole that left `SEAM_MISCONFIGURED`
  //     unreachable, occurring a second time. Re-measured at HEAD before
  //     widening:
  //
  //       $ npx eslint --rule '{"quantalyze/no-unchecked-supabase-read":"error"}' \
  //           "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"
  //       (no output — 0 violations, exit 0)
  //
  //     ⚠️ THE MEASUREMENT IS THE ENTRY CRITERION, NOT THE COMMENT. Re-run the
  //     command above before adding a file here; a paragraph asserting a count
  //     is exactly what went stale last time.
  {
    files: [
      "src/app/api/admin/strategy-review/route.ts",
      "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
    ],
    rules: { "quantalyze/no-unchecked-supabase-read": "error" },
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
      "quantalyze/no-owner-or-on-admin-client": "off",
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
