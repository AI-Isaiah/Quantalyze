---
phase: 152-scen-composer-legibility
verified: 2026-08-07T22:15:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "On PROD (or a TEST-backed dev server) open the composer's Browse drawer as the founder and find the two 'Alpha Centauri' rows"
    expected: "Both rows carry the muted 'Yours' chip AND a second muted line reading 'Created Aug 4, 2026 · Private' / 'Created Jul 20, 2026 · Private' — the founder can tell which is which and pick one deliberately"
    why_human: "SCEN-05's acceptance is the founder resolving a real duplicate against real data; the automated suite proves the mechanism on fixtures, not that the founder's two rows carry parseable distinct created_at values in PROD"
  - test: "Add ≥1 strategy to a scenario and ask the founder the original question: 'what do the numbers actually mean?'"
    expected: "The WEIGHT / USD / MODE / LEV / NOTIONAL strip reads as labels for the columns beneath it, and a non-derivable notional (toggle a row off) is understood as 'not applicable', not as broken"
    why_human: "The em-dash remains the visible glyph per DESIGN.md's Numbers Contract; the 'not applicable' meaning is carried by the labelled column plus a title/sr-only sentence. Whether that reads as not-applicable to a sighted, non-hovering founder is a judgment only the founder can make. Review IN-03 also notes the labels sit ~8px right of the digits they label."
  - test: "Expand a row's detail panel, then click around the row (whitespace between badges, drag-select the strategy name), and expand a syncing row"
    expected: "The panel does not collapse on incidental clicks and the row's own state notes do not read as part of the panel"
    why_human: "Review IN-06 / IN-07 are interaction-feel findings deliberately left unfixed per the stopping rule; only a browser pass can judge whether they cross the annoyance bar"
  - test: "Run e2e/composer-axe.spec.ts in CI (seeded TEST project)"
    expected: "The expanded-panel scan runs (not skipped) and reports zero serious/critical axe violations"
    why_human: "The spec self-skips without TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY — a local run proves nothing. Only a CI execution is evidence."
deferred:
  - truth: "Drawer-added strategies show real CAGR / SHARPE in the detail panel"
    addressed_in: "TODOS.md (Phase 152 deferred residuals) — returns-route enrichment"
    evidence: "CONTEXT locked no new fetches this phase; WR-02 fixed the honest-copy half and logged the route widening. Panel renders an honest absence note, never fabricated figures."
  - truth: "Duplicate browse rows are prevented/cleaned up, not merely disambiguated"
    addressed_in: "Phase 154 (WIZCONT-02)"
    evidence: "ROADMAP SC4 itself scopes this: 'prevention of future duplicates is WIZCONT-02 in Phase 154 — this is the presentation half'"
  - truth: "Same-day own-row duplicates are distinguishable (key_count segment)"
    addressed_in: "TODOS.md (D-1 residual)"
    evidence: "D-1: created_at alone resolves the founder's real case (15 days apart); a key count costs a second query on the browse path"
---

# Phase 152: SCEN — Composer legibility Verification Report

**Phase Goal:** The composer is legible: rows say whose they are, what the numbers mean, open detail on click, and browse never presents an unresolvable duplicate
**Verified:** 2026-08-07T22:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SCEN-02 (ROADMAP SC1) — an allocator's own strategy is visually distinguishable in the composition list, wired through the PERSISTED schema, not client-derived | ✓ VERIFIED | Server bit `isOwn: isOwnRow` emitted at `browse/route.ts:296` (same variable that un-redacts the name); persisted as `isOwn: z.boolean().nullish()` on the NESTED `addedStrategySchema` (`scenario-state.ts:909`), `SCENARIO_SCHEMA_VERSION` unchanged at 4 (`:79`); rendered via `YoursChip` gated `a.isOwn === true` (`ScenarioComposer.tsx:6658`). Falsified: deleting the schema line goes RED (VALIDATION SC1 ledger) |
| 2 | SCEN-03 (ROADMAP SC2) — clicking a scenario row opens richer detail including a working factsheet link | ✓ VERIFIED | Real `<button>` on the strategy name with `aria-expanded` + `aria-controls="scenario-detail-{id}"` (`:6608-6624`); panel at `:6757-6862` renders PROVENANCE / MARKETS / TYPES / CAGR / SHARPE + `<Link href={`/factsheet/${a.id}`}>`; `src/app/factsheet/[id]/page.tsx` exists (OWN-02, Phase 148) so the link is not a dead end. 18 SCEN-03 tests incl. Enter/Space, one-open-at-a-time, six control exclusions, panel-click no-collapse |
| 3 | SCEN-04 (ROADMAP SC3) — the numbers on a row are labelled and a non-derivable notional does not read as broken | ✓ VERIFIED (see note) | `scenario-added-header` li renders WEIGHT / USD / MODE / LEV / NOTIONAL inside the `draft.addedStrategies.length > 0` guard (`:6421-6499`), `aria-hidden`, exactly once. Non-derivable notional keeps the DESIGN.md-mandated em-dash glyph (`DESIGN.md:160` — "em-dash `—`. Never `0`, never blank") and carries a cause-accurate sentence in `title` + `sr-only` (`renderNotional`, `:6011-6025`). Note: the visible glyph is still `—`; the "not applicable" meaning is carried by the label + sentence — routed to human verification |
| 4 | SCEN-05 (ROADMAP SC4) — browse never presents two indistinguishable rows for the same strategy | ✓ VERIFIED | Own-only, filtered-scope collision set (`StrategyBrowseDrawer.tsx:381-393`) drives a `browse-dedup-{id}` line rendering `Created {Mon D, YYYY} · {Status}` (`:727-748`) fed by the route's own-only `created_at`/`status`. 8 discrimination tests incl. unique-row, third-party, own-vs-third-party mix, normalization, filter-narrowing, missing/unparseable timestamp. Falsified: dropping the `isOwn !== true` term goes RED (VALIDATION SC4) |
| 5 | 152-01 — `isOwn` on EVERY row; `created_at`/`status` on own rows only; another owner's `created_at` appears nowhere in the payload | ✓ VERIFIED | Two exhaustive fence arms `ALLOWED_THIRD_PARTY` (7 keys) / `ALLOWED_OWN` (9 keys) at `route.test.ts:740-867` using `Object.keys().sort()).toEqual()` (no `objectContaining` in the H-0300 tests); whole-payload sweep `expect(JSON.stringify(body)).not.toContain("1999-01-01")` at `:820`; emission via single-key conditional spreads, never a `...row` spread |
| 6 | 152-02 — the bit survives both codec schemas; legacy and `null` blobs decode `ok`; version stays 4 | ✓ VERIFIED | `describe("SCEN-02 isOwn (Phase 152)")` at `scenario-state.test.ts:1199` — backward decode, null tolerance, strip guard through BOTH `scenarioDraftSchema` and `scenarioDraftSaveSchema` on a POPULATED fixture, version pin. All green |
| 7 | 152-03 — header renders once, only with ≥1 added row, aria-hidden; non-derivable notional carries a cause-accurate note | ✓ VERIFIED (scope amended by WR-06) | 5 header tests (`:12265-12405`) + 6 notional tests (`:12445-12710`). The plan's "per-key notional span is untouched" was deliberately superseded by review WR-06 (UI-SPEC amendment 5): both row kinds now route through one `renderNotional`, and a test pins that the per-key DERIVED title stays byte-verbatim |
| 8 | 152-04 — drawer hands `isOwn` through `handleAdd` without fabricating it; dedup line discriminates; Yours chip own-only | ✓ VERIFIED | `isOwn: s.isOwn` at `StrategyBrowseDrawer.tsx:433` (construction site 4/4); `YoursChip` gated `=== true` at `:681`; drawer's `AddedStrategy` now DERIVED from the persisted twin (`Omit<PersistedAddedStrategy,"id"> & {id: string}`, `:108`) with a mutual-assignability typecheck guard (WR-05 fix, real) |
| 9 | 152-05 — `isOwn` mapped at BOTH twin drawer seams; Bridge seam deliberately absent; four chip states | ✓ VERIFIED | Seam A `:4132`, seam B `:5484`, Bridge non-mapping documented at `:5520`. Tests: seam A, seam B, no-fabrication, chip true/false/null/absent, chip ordering |
| 10 | Post-review fixes CR-01 / WR-01 / WR-03 are real, not narrated | ✓ VERIFIED | CR-01/WR-06: `NOTIONAL_NOTE_BY_CAUSE` with three sentences indexed by a cause returned from the same expression as the text (`:5732-5750`, `:5979-6025`) — **I mutated `not-in-blend` to the equity sentence and got 2 test failures, one per row kind**. WR-01: narrow `isOwn`-only backfill in the dedupe branch with `lastEditedAt` untouched (`scenario-state.ts:504-536`) — **I replaced it with a bare `return draft` and got RED in both scenario-state and the composer seam test**. WR-03: React adjust-during-render (not a `useEffect`) at `:5949-5954`, lint-clean |

**Score:** 10/10 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Drawer-added strategies show real CAGR / SHARPE | TODOS.md Phase 152 residuals (returns-route enrichment) | CONTEXT locked no new fetches; panel shows an honest absence note ("Metrics not available in the composer — open the factsheet for full detail."), never a fabricated 0.00 |
| 2 | Duplicate rows prevented / cleaned up | Phase 154 (WIZCONT-02) | ROADMAP SC4 scopes 152 as "the presentation half" |
| 3 | Same-day own-row duplicates distinguishable (`key_count`) | TODOS.md D-1 residual | D-1: `created_at` resolves the founder's real 15-day-apart case; key count costs a second query |
| 4 | Stale-draft factsheet link can 404 | TODOS.md Pitfall 6 | Detecting it needs a per-row existence fetch, locked out by CONTEXT |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/strategies/browse/route.ts` | `isOwn` on every row + own-only `created_at`/`status` through the named-key fence | ✓ VERIFIED | `isOwn: isOwnRow` ×1; `grep -c '\.\.\.row'` = 0; user-scoped `createClient()` + `withPublishedOrOwner` untouched; eslint clean |
| `src/app/api/strategies/browse/route.test.ts` | Two exhaustive fence arms + whole-payload sweep | ✓ VERIFIED | `ALLOWED_THIRD_PARTY` / `ALLOWED_OWN`; `not.toHaveProperty("created_at")`; sweep present |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | `isOwn` on interface + NESTED schema; WR-01 backfill | ✓ VERIFIED | `isOwn?: boolean \| null` (`:115`), `isOwn: z.boolean().nullish()` (`:909`), no refine, no version bump |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | header li, cause-accurate notional, chip, detail panel, `addedMetricsByRef` thread | ✓ VERIFIED | All present and wired: prop defined `:2509`, passed `:5339`, consumed `:5879`; detail panel `:6757` |
| `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` | `isOwn` through `handleAdd`, dedup line, chip, WR-04 parse guard, WR-05 derived type | ✓ VERIFIED | `createdAt` is a validated `Date \| null` (`:635-640`) before any `toLocaleDateString` |
| `src/app/(dashboard)/allocations/components/YoursChip.tsx` | Closed shared ownership leaf | ✓ VERIFIED | `bg-badge-other/10 text-text-muted`, no variant prop, imported by BOTH the drawer (`:35`) and the composer (`:174`) |
| `e2e/composer-axe.spec.ts` | Axe scan covers the EXPANDED panel with an anti-false-green gate | ✓ VERIFIED (CI-gated) | Clicks `[aria-controls="scenario-detail-{id}"]`, asserts `aria-expanded === "true"` BEFORE `analyze()` (`:294-303`). Self-skips without TEST creds → routed to human/CI |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `route.ts` | `isOwnRow` (`:264`) | reuse of the server-side ownership bit | ✓ WIRED | `isOwn: isOwnRow` — chip and un-redacted name cannot disagree |
| `StrategyBrowseDrawer` | `GET /api/strategies/browse` | `fetch` → `json.strategies ?? []` → `setStrategies` | ✓ WIRED | No key-stripping map between the wire and state (`:237-249`) |
| Drawer `handleAdd` | `onAdd` payload | `isOwn: s.isOwn` pass-through | ✓ WIRED | `:433` — absent stays absent |
| Composer seams A+B | `scenario.addStrategyBrowse` | `handleAddStrategy` → `setValue(prev => addBrowsePure(...))` | ✓ WIRED | `:4132` / `:5484` → `ScenarioComposer.tsx:2327` → `useScenarioState.ts:318-322` |
| `addStrategyBrowse` | persisted draft | whole `strategy` object pushed into `addedStrategies` | ✓ WIRED | `scenario-state.ts:550`; persistence via `useCrossTabStorage` `setValue` (debounced 150ms), independent of `lastEditedAt` — so the WR-01 backfill DOES persist |
| Added-row name cluster | `YoursChip` | import + `a.isOwn === true` gate | ✓ WIRED | `:6658-6663` |
| Detail panel | `/factsheet/[id]` | `<Link href={`/factsheet/${a.id}`}>` | ✓ WIRED | Route directory exists |
| Both row kinds | `renderNotional(ref)` | single helper, two call sites | ✓ WIRED | per-key `:6415`, added `:6726` |
| `CompositionList` | `addedStrategyMetadataLookup` | new `addedMetricsByRef` prop | ✓ WIRED | defined `:2509` → passed `:5339` → destructured `:5879` → read `:6550` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `StrategyBrowseDrawer` rows | `strategies` | `fetch("/api/strategies/browse")` → real Supabase select incl. `created_at, status` | Yes | ✓ FLOWING |
| Drawer dedup line | `createdAt`, `s.status` | wire fields, own-only, parse-guarded | Yes (own rows only, by design) | ✓ FLOWING |
| Composer `YoursChip` | `a.isOwn` | wire → drawer → seam → mutator → persisted draft | Yes | ✓ FLOWING |
| Composer notional cell | `notionalCell(ref)` | `blendShareByRef` × `totalBookEquity` × `leverageByRef` (existing engine state) | Yes; honest em-dash + cause when any factor absent | ✓ FLOWING |
| Detail panel CAGR/SHARPE | `addedMetricsByRef[a.id]` | `addedStrategyMetadataLookup` ← `strategyById` (BOOK payload only) | Only for in-book legs; null for drawer-added | ⚠️ PARTIAL — known, deferred (WR-02); renders an honest absence note, never a fabricated figure |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Wire + codec suites | `npx vitest run src/app/api/strategies/browse/route.test.ts "…/scenario-state.test.ts" --no-file-parallelism` | 2 files / 125 tests passed | ✓ PASS |
| Composer + drawer suites | `npx vitest run "…/ScenarioComposer.test.tsx" "…/StrategyBrowseDrawer.test.tsx" --no-file-parallelism` | 2 files / 342 tests passed | ✓ PASS |
| Known local flake class | `npx vitest run "…/AllocationsTabs.scenario-state-preservation.test.tsx" --no-file-parallelism` | 2 passed (file lives at `allocations/`, not `allocations/components/`) | ✓ PASS |
| Typecheck | `npm run typecheck` | exit 0, no output | ✓ PASS |
| Lint (phase files) | `npx eslint route.ts ScenarioComposer.tsx StrategyBrowseDrawer.tsx YoursChip.tsx scenario-state.ts` | clean | ✓ PASS |
| CR-01/WR-06 non-vacuity | Mutated `not-in-blend` copy → the equity sentence, re-ran `-t "honest notional"` | 2 failed / 4 passed (one failure per row kind), reverted → green | ✓ PASS |
| WR-01 non-vacuity | Replaced the backfill with a bare `return draft`, re-ran `-t "WR-01"` | RED in scenario-state (1 failed) AND in the composer seam test (1 failed), reverted → green | ✓ PASS |
| Working tree after mutations | `git status --short` / `git diff --stat` | empty — both files byte-restored | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| — | `find scripts -path '*/tests/probe-*.sh'` | no matches; no probe referenced in any 152 PLAN/SUMMARY | ? N/A (TS/UI phase, no probe convention) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCEN-02 | 152-01, 152-02, 152-04, 152-05 | Own-uploaded strategy visually distinguishable in the composition list; additive WIRE + persisted-schema change | ✓ SATISFIED | Truths 1, 5, 6, 8, 9 |
| SCEN-03 | 152-06 | Row clickable → richer detail + factsheet link | ✓ SATISFIED | Truth 2, 10; factsheet route exists |
| SCEN-04 | 152-03 | Row numbers labelled; non-derivable notional not read as broken | ✓ SATISFIED (glyph decision routed to human) | Truths 3, 7, 10 |
| SCEN-05 | 152-01, 152-04 | Browser does not present an unresolvable duplicate | ✓ SATISFIED (presentation half; prevention = Phase 154) | Truths 4, 5, 8 |

No orphaned requirements: `REQUIREMENTS.md:1122` maps Phase 152 to exactly SCEN-02..05, all four claimed by plans.

**Bookkeeping note (INFO, not a gap):** SCEN-02..05 are still `- [ ]` in REQUIREMENTS.md and read "Pending" in the status table (`:1073-1076`), matching the pre-completion state (Phase 151's AUM-01 is `- [x]`). These flips belong to the phase-completion commit that follows verification.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| all 10 phase files | — | `TBD` / `FIXME` / `XXX` / `HACK` / `PLACEHOLDER` | — | None found — zero debt markers in any file this phase touched |
| `ScenarioComposer.tsx` | 2507 | `TODOS.md` reference in the `addedMetricsByRef` doc comment | ℹ️ Info | Formal follow-up reference (WR-02 entry exists in TODOS.md `:1432`), not an unreferenced debt marker |
| `ScenarioComposer.tsx` | 6338-6376 | Five elements share `data-testid="scenario-added-header-label"` (IN-02) | ℹ️ Info | Logged in TODOS.md; breaks Playwright strict-mode single-locator use only |
| `ScenarioComposer.tsx` | 6338-6376 | Header labels ~8px right of the digits (IN-03) | ⚠️ Warning (visual) | Logged in TODOS.md; routed to human verification item 2 |
| `ScenarioComposer.tsx` | 6446, 6683-6697 | Row-wide pointer amplification + provenance repeat / note ordering (IN-06, IN-07) | ⚠️ Warning (interaction) | Logged in TODOS.md; routed to human verification item 3 |

No stub patterns: no `return null` placeholder branches, no empty handlers, no hardcoded empty props at the phase's call sites. Every `—` in the touched render paths is the DESIGN.md-mandated honest-null glyph, and each is accompanied by an explanatory sentence or an em-dash-per-field contract.

### Human Verification Required

#### 1. Founder resolves the real Alpha Centauri duplicate

**Test:** On PROD (or a TEST-backed dev server signed in as the founder) open Scenario → Browse and locate the two "Alpha Centauri" rows.
**Expected:** Both carry the muted "Yours" chip AND a second muted line — `Created Aug 4, 2026 · Private` and `Created Jul 20, 2026 · Private` — so the founder can pick one deliberately.
**Why human:** The automated suite proves the mechanism against fixtures. Only a real signed-in session proves the founder's actual rows carry parseable, distinct `created_at` values through the own-only fence.

#### 2. "What do the numbers actually mean?" — answered

**Test:** Add ≥1 strategy, look at the composer row group, then toggle a row off and look at its notional cell (hover it too).
**Expected:** The WEIGHT / USD / MODE / LEV / NOTIONAL strip reads as labels for the columns beneath, and the non-derivable cell is understood as "not applicable — this row is not in the blend", not as broken.
**Why human:** The visible glyph is still `—` (DESIGN.md's Numbers Contract forbids replacing it with text); the "not applicable" meaning is carried by the labelled column plus a `title`/`sr-only` sentence. Whether that satisfies the founder's original complaint is a judgment call. Review IN-03 also notes ~8px label/digit misalignment.

#### 3. Detail-panel interaction feel

**Test:** Expand a row's detail, then click row whitespace and drag-select the strategy name; separately expand a syncing row.
**Expected:** The panel does not collapse on incidental clicks, and the row's own state notes do not read as part of the panel.
**Why human:** IN-06 / IN-07 were deliberately left unfixed per the project stopping rule; only a browser pass judges whether they cross the annoyance bar.

#### 4. e2e axe scan of the EXPANDED panel actually executes

**Test:** Run `e2e/composer-axe.spec.ts` in CI with the seeded TEST project.
**Expected:** The describe does NOT self-skip; the expanded-panel scan reports zero serious/critical violations.
**Why human:** The spec self-skips without `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`, so a local run is not evidence — the file says so itself.

### Gaps Summary

No gaps. Every ROADMAP Success Criterion resolves to a concrete, wired, tested mechanism in the codebase, and the wire → codec → seam → render chain for the ownership bit was traced end to end (including the persistence path, which does NOT depend on the deliberately-unbumped `lastEditedAt`).

I did not take the REVIEW's fix table at its word. I adversarially mutated the two fixes whose absence would be invisible — CR-01/WR-06's cause-accurate copy and WR-01's backfill — and both went RED for the right reason, then byte-restored green with a clean `git diff`. WR-03's fix is the adjust-during-render idiom the review claims (not the rejected `useEffect`), WR-04's parse guard yields a validated `Date | null`, and WR-05's drawer type is genuinely derived from the persisted twin rather than re-declared.

Two honest scoping notes, neither a gap:

1. **SC3's "reads as not applicable".** The em-dash glyph stays, because DESIGN.md `:160` mandates it for every null/non-finite value and CLAUDE.md forbids deviating without explicit approval. The requirement's intent is met through the labelled NOTIONAL column plus one cause-accurate sentence per em-dash cause (equity / not-in-blend / indeterminate), on BOTH row groups. Whether the founder now reads it as "not applicable" is human verification item 2, not an automated claim.
2. **Plan 152-03's truth "per-key rows … notional span is untouched" was intentionally superseded** by review WR-06 (UI-SPEC amendment 5), which extended the explanation to the per-key half. A test pins that the per-key DERIVED title is still byte-verbatim, so the supersession did not become a regression.

Status is `human_needed` rather than `passed` solely because four items require founder eyes or a CI run; there is nothing for `/gsd:plan-phase --gaps` to close.

---

_Verified: 2026-08-07T22:15:00Z_
_Verifier: Claude (gsd-verifier)_
