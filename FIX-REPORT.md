# PR #189 Retroactive Fix-Content Follow-up — FIX REPORT (2026-05-16)

Branch: `fix/pr189-retro-followup-2026-05-16`
Base: `origin/main` (`609b625b`)
Version: bumped to `v0.22.40.23` (VERSION + package.json).

Source threshold findings (from `.review/specialist-fix-content.*.jsonl` +
`red-team-fix-content.jsonl` on the `allocator-dashboard-retroactive`
worktree): CRITICAL + HIGH≥7 + MED≥8 + LOW≥9.

## Applied: 21 in scope (20 code fixes + 1 verified false positive)

### HIGH (7 of 8 applied — 1 false positive)

| ID | Severity / conf | File | Status |
|---|---|---|---|
| H1 | HIGH / 9 | `AllocationDashboardV2.tsx` | Recovery banner hoisted above EmptyState early-return + rendered in both branches |
| H2 | HIGH / 9 | `OutcomesWidget.tsx` | Curve-fetch error hoisted to panel level; rendered regardless of per-window pending state |
| H3 | HIGH / 8 | `EquityChart.tsx` | y-tick walker safety cap at 50 ticks with one-shot warn + 3-tick fallback |
| H4 | HIGH / 8 | `useDashboardConfig.ts` | Preserve user's empty-tiles layout instead of silently replacing with DEFAULT_LAYOUT |
| H5 | HIGH / 9 | `ScenarioComposer.tsx` | Client `ScenarioCommitDiff` aligned to Zod wire contract (holding_ref required on BridgeRecommendedDiff, percent_allocated added to VoluntaryModifyDiff, effective_date added to all members, rejection_reason narrowed to RejectionReason enum, note narrowed to string\|null\|undefined) |
| H6 | HIGH / 8 | `ScenarioComposer.tsx` | Export narrower `ComposerProducedDiff` (voluntary_remove + voluntary_add) for the composer→drawer seam; handleCommit retypes locally |
| H7 | HIGH / 8 | `AllocationDashboardV2.retro-audit.test.tsx` | Per-test override hook for consumeDashboardRecoveryFlag + 7 new tests covering banner copy / EmptyState branch / dismiss / null control |
| H8 | HIGH / 8 | `AllocationDashboardV2.tsx` | **False positive** — `warning` IS a registered Tailwind `@theme inline` token in `src/app/globals.css`; existing files (`src/app/security/page.tsx`, `WithdrawalWarningStrip.tsx`, `WizardIpAllowlistHint.tsx`) use `border-warning` + `bg-warning/N` successfully; verified by grep. No code change required. |

### MEDIUM ≥8 (13 in scope)

| ID | Severity / conf | File | Status |
|---|---|---|---|
| M1 | MED / 8 | `EquityChart.tsx` | Guard CUSTOM range startEpoch/endEpoch against NaN, fall back to ALL-period with breadcrumb |
| M2 | MED / 8 | `OutcomesWidget.tsx` | Reset `error` to null at the start of each effect run |
| M3 | MED / 8 | `AllocationDashboardV2.retro-audit.test.tsx` | New behavior test mounts empty→populated transition and asserts widget_viewed fires via mocked synchronous IntersectionObserver |
| M6 | MED / 8 | `AllocationDashboardV2.tsx` | Third widgetViewsFiredRef reset effect keyed on `[holdingsEmpty, hasSyncing]` so empty→populated transitions get a fresh dedup |
| M7 | MED / 9 | `ScenarioCommitDrawer.tsx` | buildSubmitDiffs replaced with exhaustive switch + assertNever default |
| M8 | MED / 8 | `EquityChart.tsx` | Malformed-date breadcrumb hoisted into parseISO itself with module-scoped dedup Set |
| M11 | MED / 8 | `ScenarioCommitDrawer.tsx` | Validate `recorded` is a finite number BEFORE lifting JSON into state; emit malformed-response failure otherwise |
| M12 | MED / 8 | `useDashboardConfig.ts` + `AllocationDashboardV2.tsx` | Export `DashboardRecoveryReason` named type, replace 3 hand-typed literal unions |
| M13 | MED / 8 | `ScenarioCommitDrawer.tsx` | PerRowState.rejection_reason narrowed from `string?` to `RejectionReason` enum |
| M14 | MED / 8 | `lib/types.ts` | WidgetProps.data:any JSDoc explaining the deferral rationale, blocking constraint, and pointer to follow-ups |
| M15 | MED / 8 | `AllocationDashboardV2.retro-audit.test.tsx` | BASE_PAYLOAD now `satisfies Partial<MyAllocationDashboardPayload>`; api_key_id added to holdingsSummary; all 4 `as any` render-site casts replaced with `as unknown as MyAllocationDashboardPayload` |
| M17 | MED / 8 | `OutcomesWidget.tsx` | Subsumed by H2 — error rendered ONCE at panel level (not 3× per column) |
| M18 | MED / 8 | `EquityChart.tsx` | EquityChartWidget.periodReturn guards `last` against NaN (chip can never render "NaN%") |

### DEFERRED (below threshold)

Per spec, only CRITICAL + HIGH≥7 + MED≥8 + LOW≥9 are in scope. Findings
explicitly listed in `.review/follow-up-pr-findings.md` as DEFERRED:

- M4 (perf MED/7 — console.warn flood in sliceByPeriod filter)
- M5 (perf MED/7 — two adjacent useEffect for prev-value tracking)
- M9 (silent-failure MED/7 — aria-hidden on stale dimmer)
- M10 (silent-failure MED/7 — module-level fallback for locked-storage setRecoveryFlag failure)
- M16 (type-design MED/7 — split SubmitState.failure invariant)
- All 9 LOW findings (none reach LOW≥9 threshold)
- 1 INFO finding (positive defense-in-depth, no action)

## Visual contract preservation

Per CLAUDE.md `feedback_dashboard_parity_visual_fidelity`: only
logic/data/wiring changes; no Tailwind translation or new visual surfaces
introduced beyond the H2 hoist (which REPLACES three identical per-column
alerts with one panel-level alert — net visual REDUCTION, not addition).

The H1 recovery banner was already present in PR #189; H1 only changes
its rendering position so it survives the EmptyState short-circuit. No
copy, color, or layout change.

## Test verification

- TypeScript: `npm run typecheck` → PASS, 0 errors
- Vitest (full suite): 3689 passed, 228 skipped, 0 failed
- Vitest (allocations dir, 68 files, 780 tests): all pass
- Vitest (retro-audit only): 13/13 pass (6 pre-existing + 7 new H7/M3)
- ESLint: 0 errors (23 pre-existing warnings unchanged)

## Commits (atomic, one per fix bundle)

1. `fix(allocator-retro): render recovery banner before EmptyState short-circuit` (H1)
2. `fix(allocator-retro): hoist OutcomesWidget curve-error to panel level + reset on refetch` (H2, M2, M17)
3. `fix(allocator-retro): EquityChart NaN guards + tick-count cap + parseISO breadcrumb` (H3, M1, M8, M18)
4. `fix(allocator-retro): preserve empty-tiles layout + export DashboardRecoveryReason` (H4, M12)
5. `fix(allocator-retro): ScenarioCommitDiff Zod alignment + exhaustive switch + RejectionReason narrowing + SubmitResponse validation` (H5, M7, M11, M13)
6. `fix(allocator-retro): split composer/drawer seam + recovery banner regression tests + behavior H-1197 test + WidgetProps.data JSDoc + widget views reset` (H6, H7, M3, M6, M14, M15)
7. (final) `chore: v0.22.40.23 + FIX-REPORT for PR #189 retro follow-up`
