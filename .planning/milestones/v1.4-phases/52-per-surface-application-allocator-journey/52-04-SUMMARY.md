---
phase: 52-per-surface-application-allocator-journey
plan: 04
subsystem: frontend
tags: [discovery, fluid-fill, truncation, title-recovery, font-px-migration, text-tokens, frozen-spine]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "the named fluid --text-* tiers (text-micro/small/page-title) this plan migrates the discovery raw px onto"
  - phase: 50-primitive-refresh
    provides: "StrategyTable @container precedent (50-06) that reads deliberate at the wider ~1920 measure — VERIFIED, not re-migrated here"
  - phase: 52-per-surface-application-allocator-journey (52-01)
    provides: "the frozen-spine git-delta guard (BP-01) + the 2560 ultra-wide reflow row this restyle keeps green"
provides:
  - "discovery surface page-shell fluid-fill (mx-auto max-w-[1920px]) — data surface fills then centers (APPLY-01/TYPE-03)"
  - "StrategyGrid marketplace/discovery tile-name clip recovery via title={s.name} (TYPE-02), honest {s.name} preserved (STATE-02)"
  - "discovery + StrategyGrid zero raw text-[Npx] — clean for the Wave-3 no-raw-font-px=error ratchet (52-07 owns eslint.config.mjs)"
affects: [52-07, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "page-shell data-surface fluid-fill cap (mx-auto max-w-[1920px]) placed at the page because (dashboard)/layout.tsx does not cap width"
    - "tile-name single-line + title= recovery (truncate min-w-0 kept for the min-h-[44px] header-row alignment with badges + star overlay)"
    - "raw text-[Npx] -> named --text-* tier migration per the DESIGN.md §Typography 1:1 px map (text-[10px]->text-micro, text-[13px]->text-small, text-[28px] sm:text-[36px]->text-page-title)"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/discovery/[slug]/page.tsx"
    - "src/components/strategy/StrategyGrid.tsx"
    - "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx"

key-decisions:
  - "Fluid-fill cap goes at the page shell (mx-auto max-w-[1920px] wrapping the success fragment) because (dashboard)/layout.tsx intentionally does not cap width; the attestation gate stays in discovery/layout.tsx, byte-untouched."
  - "StrategyGrid:63 tile name uses title={s.name} (cheapest tile-context recovery) and KEEPS truncate min-w-0 rather than a 2-line clamp — the tile's min-h-[44px] header row aligns the name with the HealthScore/VerifiedBadge/Example/star overlay; a clamp would desync that fixed-height row. Honest {s.name} preserved, no fabricated placeholder (STATE-02)."
  - "The font-px migration legitimately includes discovery/[slug]/[strategyId]/page.tsx (the 'still computing' prose article) because Task 2's action scopes 'src/app/(dashboard)/discovery/**' + StrategyGrid; plan frontmatter files_modified listed only the 2 main files, but the glob is the binding scope. The H1 maps to text-page-title (the spec's prose subset H1 tier) and drops the sm: viewport bump since the clamp is fluid."
  - "StrategyTable.tsx left UNTOUCHED — it already ships @container + @max-3xl:hidden collapse + tabular-nums from Phase 50-06 and reads deliberate at the wider measure; no column-tuning @min-* tweak was needed, so the collision-free option to leave it untouched was taken."

patterns-established:
  - "A data surface with no existing page-level cap gets the fluid-fill at the page shell, not the shared (dashboard) layout (which is uncapped by design); the surrounding chrome cap is a separate owner's concern."

requirements-completed: [APPLY-01, TYPE-02, TYPE-03, TYPE-04, STATE-02, BP-01]

# Metrics
duration: 3min
completed: 2026-06-29
---

# Phase 52 Plan 04: Discovery Surface — Fluid-Fill + Clip Recovery + Font-PX Migration Summary

**The discovery marketplace surface now fluid-fills toward ~1920px then centers, the StrategyGrid tile strategy name recovers full text via `title={s.name}` while still rendering the honest real name, and discovery + StrategyGrid carry zero raw `text-[Npx]` — all with the accredited-investor attestation gate provably untouched and the frozen-spine guard green.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-29T11:46:35Z
- **Completed:** 2026-06-29T11:49Z
- **Tasks:** 2 completed
- **Files modified:** 3 (0 created, 3 modified)

## Accomplishments

- **APPLY-01 / TYPE-03 fluid-fill** — `discovery/[slug]/page.tsx` wraps the success fragment's content (Breadcrumb / PageHeader / InfoBanner / watchlist-status / StrategyTable) in `<div className="mx-auto max-w-[1920px]">`, so the data surface fills toward ~1920px then centers with gutters beyond. The cap lives at the page because `(dashboard)/layout.tsx` does not cap width. No horizontal scroll/overlap is introduced at 320px (the content was already responsive) or 2560px (the new cap centers the surface).
- **TYPE-02 / STATE-02 tile-name clip recovery** — `StrategyGrid.tsx:63` `<h3>` gains `title={s.name}` (the audit's `accidental-clip, none recovery` row), keeping `truncate min-w-0` so the `min-h-[44px]` header row stays aligned with the HealthScore / VerifiedBadge / Example badge / star-overlay. The tile keeps rendering the REAL `{s.name}` and the grid's existing honest "No strategies match your filters." absent branch — no fabricated placeholder name (no-invented-data).
- **TYPE-04 wider-measure verification** — `StrategyTable.tsx` (discovery's main content, `@container` from Phase 50-06) reads deliberate at the wider measure as-is; no column tweak was needed, so it was left byte-untouched (collision-free, frozen-spine clean) and its 24-test suite re-ran green.
- **DS-04 font-px migration** — every raw `text-[Npx]` under `discovery/**` + `StrategyGrid.tsx` migrated onto the named `--text-*` tiers: the Example-badge `text-[10px]` → `text-micro` (HoldingsTable:443 precedent), and the `[strategyId]/page.tsx` "still computing" prose article's eyebrow `text-[10px]` → `text-micro`, serif H1 `text-[28px] sm:text-[36px]` → `text-page-title` (fluid clamp drops the viewport bump), body `text-[13px]` → `text-small`. Named utilities (`text-sm`/`text-xs`) left as-is. `eslint.config.mjs` NOT touched (52-07 owns the error-ratchet).
- **BP-01 frozen-spine** — the 9-test `phase-52-frozen-spine-guards.test.ts` is green: zero-diff over all 8 frozen-island paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: discovery fluid-fill to 1920 + StrategyGrid tile-name clip recovery** — `9b39bcfe` (feat)
2. **Task 2: migrate discovery + StrategyGrid raw font-px to --text-* tiers** — `10ec0cac` (refactor)

## Files Modified

- `src/app/(dashboard)/discovery/[slug]/page.tsx` — wrapped the success fragment in `mx-auto max-w-[1920px]` (fragment → `<div>`); attestation gate untouched (lives in layout.tsx).
- `src/components/strategy/StrategyGrid.tsx` — tile `<h3>` gains `title={s.name}` (clip recovery, `truncate min-w-0` kept); Example-badge `text-[10px]` → `text-micro`.
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — "still computing" prose article raw px migrated: eyebrow → `text-micro`, H1 → `text-page-title`, body → `text-small`.

## Verification

- `npx vitest run "src/components/strategy/StrategyTable.test.tsx" src/__tests__/phase-52-frozen-spine-guards.test.ts` → **2 files, 33 tests passed**.
- `npx vitest run StrategyGrid.test.tsx StrategyTable.test.tsx discovery-selectors.contract.test.tsx SimulateImpactButton.test.tsx discovery-prefs.test.ts frozen-spine-guards` → **6 files, 69 tests passed** (coverage-gate-relevant discovery suite green).
- `grep -rn "text-\[[0-9][0-9]*px\]" discovery/ StrategyGrid.tsx | grep -v test` → **ZERO** (clean for the 52-07 ratchet).
- `git diff --name-only HEAD~2 HEAD | grep discovery/layout.tsx` → **empty** (attestation gate provably untouched).
- `npx tsc --noEmit` → **no errors originate in the 3 edited files**.
- `npx eslint` on the 3 changed files → **exit 0** (no new lint errors against the DS-04 strangler).
- `grep -c "max-w-\[1920px\]"` page = **1** (≥1); `grep -c "title="` StrategyGrid = **2** (≥1); `{s.name}` count rose 2→5 (real name still rendered, no placeholder).

## Acceptance Criteria

**Task 1:** `max-w-[1920px]` grep ≥ 1 (=1) ✓; layout.tsx in diff = 0 ✓; `title=` in StrategyGrid ≥ 1 (=2) ✓; `{s.name}` unchanged-or-higher (2→5, real name) ✓; StrategyTable tests exit 0 (24/24) ✓.
**Task 2:** zero raw `text-[Npx]` under discovery + StrategyGrid ✓; frozen-spine guard exit 0 (9/9) ✓.

## Deviations from Plan

None — plan executed exactly as written. No bugs (Rule 1), missing critical functionality (Rule 2), blocking issues (Rule 3), or architectural changes (Rule 4) were encountered. No auth gates. No package installs (CSS/chrome only, per threat register T-52-SC).

**Scope clarification (not a deviation):** the plan frontmatter `files_modified` lists 2 files, but Task 2's action explicitly scopes the migration to `src/app/(dashboard)/discovery/**` — which contains the raw px in `[slug]/[strategyId]/page.tsx`. Migrating that file's font-px is required to satisfy Task 2's zero-raw-px acceptance criterion (`grep ... "src/app/(dashboard)/discovery/"`), so the third file is in-scope by the binding action/glob, not an out-of-scope edit. It is not a frozen island and the frozen-spine guard is green.

## Threat Surface Scan

No new security-relevant surface. The two restyle touch points map to the plan's threat register: T-52-12 (attestation gate) is mitigated — layout.tsx is provably out of the git diff, so `force-dynamic` + the blocked-default gate cannot be weakened; T-52-13 (StrategyGrid `title={s.name}`) is mitigated — `title=` exposes only the already-rendered public marketplace tile name, never an un-gated field. No new endpoints, auth paths, file access, or schema changes.

## Known Stubs

None. The only "placeholder" grep hits in the changed files are (1) the new explanatory comment stating "never a fabricated placeholder (STATE-02 / no-invented-data)" and (2) a pre-existing Phase-15 trust-tier comment — neither is a data stub. The discovery tile renders the real `{s.name}` and the existing honest empty branch.

## Notes for Downstream Plans (52-07, 54)

- The `no-raw-font-px=error` ratchet for the `discovery/**` + `StrategyGrid.tsx` glob lands in the consolidated **52-07** (single owner of `eslint.config.mjs`). This plan left the surface CLEAN (zero raw px) so that ratchet flips green by construction.
- `StrategyTable.tsx` was left untouched and is still the live `@container` precedent the 52-01 tabular-nums contract gates; it reads deliberate at the wider ~1920 measure.
- A separate shared `DashboardChrome.tsx` `max-w` cap clamps the dashboard fluid-fill (noted in the phase brief as orchestrator-tracked, out of scope here); the page-level `max-w-[1920px]` cap is set correctly and StrategyGrid stays responsive.

## Self-Check: PASSED

- Files: all 3 modified files + this SUMMARY exist on disk.
- Commits: `9b39bcfe` and `10ec0cac` both present in git log.
