---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
plan: 06
subsystem: ui + ci-guards
tags: [react, useeffect, hydration, scenario-composer, structural-gate, grep-gate, vitest, tdd, scen-01, phase-closure]

# Dependency graph
requires:
  - "147-05 — the composer's series_state threading and the ScenarioComposer.test.tsx fetch-mock harness"
  - "147-03 — share-resolve.ts resolving through resolveDailyReturnSeries (allowlist pin target)"
  - "147-02 — the widened returns route + OG route (allowlist pin targets)"
  - "147-04 — the queries.ts book path (Layer B block-slice pin target)"
  - "147-01 — resolve-series.ts, the ONE resolver the gate pins every surface to"
provides:
  - "The hydration seam — fetchAddedReturns now fires for reopened/refreshed drafts, so the SCEN-01 acceptance anchor survives a browser refresh"
  - "src/__tests__/phase-147-series-resolution-guards.test.ts — SC2 as a CI invariant (repo-wide bare-reader ban + 8 allowlist pins)"
  - "DEF-147-A / DEF-147-B in TODOS.md — the class-closure audit findings, logged not fixed"
  - "147-VALIDATION.md closed: 7/7 ledger rows observed, Oracle Independence 5/5, status: executed"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A hydration effect that REUSES an existing add seam's guard predicate verbatim and leans on the fetch function's own in-flight ref — one dedup mechanism, not two"
    - "Two-layer structural gate: a repo-wide scan for the class (catches files the author never saw) plus per-surface allowlist pins (name the surface on failure, and see what a scan cannot — that the resolver is INVOKED)"
    - "Scope a source-scan to parsed .select() ARGUMENTS rather than free text, so prose, type annotations and log strings cannot redden it — then strip comments so the gate's own docstring cannot self-invalidate it"
    - "Falsify a structural gate TWICE: once on the class member the ledger names, once on a 'reference' pin, to prove the decorative-looking assertions are load-bearing"

key-files:
  created:
    - src/__tests__/phase-147-series-resolution-guards.test.ts
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - TODOS.md
    - .planning/phases/147-scen-01-the-scenario-engine-receives-the-real-series/147-VALIDATION.md

key-decisions:
  - "The hydration effect adds NO new dedup mechanism. fetchAddedReturns already dedupes via lazyAbortRef; a mount latch or ref flag would have been a second mechanism disagreeing with the first — the exact drift class this phase exists to end (Rule 7)"
  - "Layer A parses .select() arguments instead of scanning free text. A free-text scan would redden on the factsheet page's own hint: string and on every explanatory comment in the four fixed readers — and the tempting 'fix' would be editing correct prose"
  - "Layer B asserts the resolver CALL, never an import specifier: 147-01's leaf extraction means factsheet v2 and queries.ts legitimately reach the same function through the allocator-portfolio-payload re-export while the newer surfaces import the leaf"
  - "share-resolve.ts is a PURE layer with no select, so its pin is on the WIRING — the caller-supplied raw index must reach the resolver's second argument (paren-balanced arg extraction), not merely be mentioned in the file"
  - "The audit's two findings were logged and NOT fixed, including one live stub (DEF-147-A). Fixing them would have been silent scope expansion into an untouched surface"

requirements-completed: [SCEN-01]

# Metrics
duration: 45min
completed: 2026-08-05
---

# Phase 147 Plan 06: Phase closure — hydration re-fetch + the SC2 structural gate Summary

**A reopened or page-refreshed scenario now re-fetches every added strategy's series through the same guarded seam an add uses — so the founder can press F5 mid-walkthrough and the real series is still there — and "no fifth bare `daily_returns` reader" stopped being an observation and became a CI invariant, falsified twice on the way in.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-05T07:20Z (worktree base corrected first)
- **Completed:** 2026-08-05T08:05Z
- **Tasks:** 3 (Task 1 TDD RED→GREEN, Task 2 gate + two mutation experiments, Task 3 audit + closure)
- **Files:** 1 created, 4 modified

## Accomplishments

- **The acceptance anchor now survives a refresh.** `fetchAddedReturns` had exactly two call sites, both add seams. `openSavedScenario` did not call it and neither did the localStorage-draft hydration, so `addedReturnsById` starting empty on every fresh mount meant a reopened scenario rendered `[]` again — **the SCEN-01 symptom fully reproducible one F5 after the phase's column fix**. One effect covering both entry paths closes it. This is a *distinct root cause* (no fetch fired) from the four-reader column bug, and the commit messages say so.
- **The effect adds nothing to the lifecycle but itself.** The diff is 30 lines, 20 of them comment. It reuses the `:2194` add seam's guard predicate character-for-character and relies on `fetchAddedReturns`' own `lazyAbortRef` for in-flight dedup — no ref flag, no mount latch, no second mechanism. `grep -c "fetchAddedReturns("` is **3**, exactly as the plan's acceptance requires (two seams + one effect; the `useCallback` definition does not match the call pattern).
- **SC2 is structural now, in two layers that catch different things.** Layer A walks every production source under `src/` and inspects the argument of every `.select(...)`; a payload naming `daily_returns` without `returns_series` fails, printing the file **and the full offending select**. Layer B pins each of the four fixed readers, both reference implementations, and the resolver module itself — one `it()` apiece, so a failure names the surface. Layer A catches a file nobody hand-picked; Layer B catches what a scan structurally cannot see, that the resolver is actually *invoked*.
- **The gate was falsified twice, not once.** The ledger's chosen mutation (delete `returns_series` from the `getMyAllocationDashboard` embed — the **second** class member, deliberately not a surface the gate author picked) reddened **both** layers: 2 failed / 10 passed. A second experiment reverted the resolver call on the `factsheet v2` **reference** page — 1 failed / 11 passed — proving the two "already correct, just pinned" surfaces are genuinely held rather than decoratively listed. Both reverted by re-editing the mutated line; `git diff` returned to 0 lines for both files.
- **The audit found the class already closed where the plan pointed, and two things beside it.** All three `getPortfolioStrategies` consumers read scalar metrics only — **zero** touch `daily_returns`. But the audit surfaced a live stub (`DEF-147-A`: `buildEquityCurveSeries` returns `null` for every per-strategy equity curve behind a comment claiming `returns_series` isn't selected — it has been for some time) and a latent trap (`DEF-147-B`: two dead `daily_returns?: unknown` annotations on selects that use `PUBLIC_ANALYTICS_COLUMNS`, which carries neither column). Both logged to TODOS.md, **neither fixed**.
- **The phase ledger is closed with evidence, and honest about what it does not prove.** 7/7 falsifiability rows observed, Oracle Independence 5/5 with each box re-verified against source rather than carried forward on trust, per-task status filled from actual runs. The sign-off explicitly records that the manual PROD walkthrough — including the mid-walkthrough refresh the P6 fix exists for — is still open, so "ledger closed" cannot be misread as "SCEN-01 accepted".

## Task Commits

1. **Task 1 (RED): failing hydration re-fetch tests** — `3bee2083` (test) — 3 failed / 1 passed
2. **Task 1 (GREEN): the hydration effect** — `222cc9d4` (feat) — HYD-1…4 green; 220/220 in the file
3. **Task 2: the SC2 structural gate** — `3b57f988` (test) — 12/12 green; two mutation experiments recorded
4. **Task 3: consumer audit + ledger closure** — `c81b5d0b` (docs) — zero production-code diffs

No REFACTOR commit — the GREEN implementation needed no cleanup.

## Files Created/Modified

- **`src/__tests__/phase-147-series-resolution-guards.test.ts` (new, 375 lines)** — Layer A: `productionSources` walk (skips `*.test.*`, `__tests__/`, `*.d.ts`), `stripComments`, a paren/quote-aware `selectPayloads` extractor, and a `(?<!\w)daily_returns(?!\w)` column regex that excludes `csv_`/`mtm_`/`smoothed_mtm_` siblings. Plus an anti-vacuity `it()` proving the extractor *does* find real two-column selects, so an empty offender list means clean rather than blind. Layer B: 9 `it()`s — existence sweep, four fixed readers, two reference pages, the resolver module, and the column-regex unit pin.
- **`ScenarioComposer.tsx`** — one `useEffect` over `scenario.draft.addedStrategies`, guarded by `!strategyById.has(a.id) && addedReturnsById[a.id] === undefined`, placed after the memos it depends on. Comment names Phase 147 / RESEARCH P6, both prior-art call sites, and states the ⛔ no-second-mechanism rule.
- **`ScenarioComposer.test.tsx`** — one new top-level describe (HYD-1…4) with a `seedHydratedDraft()` fixture that persists a schema-v4 draft carrying an added strategy under a *matching* holdings fingerprint (a mismatch would re-initialize from holdings and drop the row, making every test vacuous). No existing test modified.
- **`TODOS.md`** — a Phase-147 audit section with the exact grep commands, the 0-bare-consumer result, and `DEF-147-A` / `DEF-147-B` with fix shapes and explicit "confirm before wiring" caveats.
- **`147-VALIDATION.md`** — SC-2 row closed; a full SC-2 evidence block with both experiments' pasted output; status column filled; Wave-0 items ticked; Oracle Independence rewritten with the verification for each box; sign-off closed with the manual-acceptance caveat; frontmatter `status: executed`, `wave_0_complete: true`.

## Decisions Made

- **No second dedup mechanism (Rule 7).** The obvious implementation is a `useRef` mount latch. It would have been wrong: `fetchAddedReturns` already returns early on `lazyAbortRef.current.has(id)`, and a latch would encode a *different* notion of "already handled" that drifts the moment remove-and-re-add enters the picture. HYD-3 proves the existing guard is sufficient by re-rendering with fresh payload identities both in-flight and after settle, and asserting the call count stays 1.
- **Layer A parses select arguments; it does not grep text.** A free-text `daily_returns`-without-`returns_series` scan reddens on `factsheet/[id]/v2/page.tsx:376`'s `hint:` string and on the explanatory comments the four fixed readers carry — and the tempting remedy would be editing correct prose to appease a test. Parsing `.select(...)` arguments makes the gate mean what it says. The cost is recorded, not hidden: the gate cannot see a bare *type annotation*, which is exactly why `DEF-147-B` is a backlog item rather than a CI failure, and the limitation is written into both the test docstring and the ledger.
- **Comments are stripped before matching.** This file's own docstring necessarily quotes a bare select and names both columns. Without stripping, the gate would either self-redden or — worse — self-green by matching its own prose.
- **The reference pins earn their place by experiment.** "Pin the two already-correct pages" is the kind of assertion that looks thorough and asserts nothing. Rather than argue it, the resolver call was deleted from `factsheet v2` and the pin observed to fall.
- **The audit's stub was logged, not fixed.** `DEF-147-A` is a live unwired data path in an untouched file. Fixing it would have been a satisfying two-line change and a clean scope violation; the orchestrator ruling was grep-and-log. The TODO carries the caveat that the response-size concern in the stale comment may still be valid even though its stated premise is not.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `node_modules` absent in the worktree**
- **Found during:** setup, before Task 1
- **Issue:** the worktree had no `node_modules`, so `npx vitest` / `npx tsc` / `npm run lint` were impossible.
- **Fix:** symlinked the main repo's **existing** install, exactly as the prompt directed and as 147-05 did. No package manager ran; nothing was resolved from a registry, so the Rule 3 package-install exclusion is not engaged.
- **Files modified:** none tracked (`node_modules` is gitignored).

**2. [Rule 1 - Bug] The share-resolve allowlist pin asserted a token that legitimately does not exist there**
- **Found during:** Task 2, first run of the gate (11 passed / 1 failed)
- **Issue:** the pin asserted `share-resolve.ts` contains the string `returns_series`. It does not — and should not. That file is a **pure** layer with no query; the raw index arrives as the camelCase parameter `returnsSeriesById`, and the only snake_case mentions are in comments, which the gate correctly strips. The assertion would have forced a cosmetic edit to production code to satisfy a test.
- **Fix:** replaced it with a genuine wiring pin — a paren-balanced `resolverCallArgs()` extractor asserting the raw-index channel reaches the resolver's **second argument**. That is what the SC-3(share) mutation (reverting to `normalizeDailyReturns(s.daily_returns)`) actually breaks.
- **Files modified:** `src/__tests__/phase-147-series-resolution-guards.test.ts`
- **Committed in:** `3b57f988`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug in my own new test). No architectural changes, no Rule 4 escalations, zero package installs, zero production files touched outside the plan's `files_modified`.
**Impact on plan:** none on scope. The plan's stated acceptance (`fetchAddedReturns(` count == 3) landed exactly.

## Issues Encountered

- **The worktree base was wrong on spawn again.** HEAD sat at `764038a7` (`origin/main`), 60+ commits behind — the same systematic wrong-base spawn 147-02 / 147-04 / 147-05 all reported. The branch-namespace assertion passed first, then the mandated `git reset --hard 9bfc2b3a` corrected it, and the presence of all four fixed readers was confirmed before any work began (the SC2 gate was green on first run, which is itself evidence the base was right — on the wrong base Layer A would have flagged all four).
- **Pre-existing lint warning** in `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1119` (`react-hooks/exhaustive-deps`) — untouched file, already booked as `DEF-142.2-11`, not fixed.

## Verification Results

- `npx vitest run "…/ScenarioComposer.test.tsx" --no-file-parallelism` → **220 passed**, zero skipped
- `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts` → **12 passed**
- Four structural gates together (phase-29 / 63 / 84 / 147) → **52 passed**
- Nine per-task verification files together → **9 files / 398 passed**
- Regression sweep `npx vitest run "src/app/(dashboard)/allocations"` → **119 files / 1620 passed**
- **Full suite** `npm run test -- --no-file-parallelism` → **740 files passed / 19 skipped; 10661 tests passed / 287 skipped**, 394s, zero failures
- `npx tsc --noEmit` → exit 0
- `npm run lint` → **0 errors** (1 pre-existing warning in an untouched file); route-contract + admin-manifest checks OK
- `grep -c "fetchAddedReturns(" ScenarioComposer.tsx` → **3** (plan acceptance)
- `git diff --name-only` for Task 3 → exactly `TODOS.md` + `147-VALIDATION.md`, zero production-code diffs
- No file deletions in any commit; no untracked files left behind; `STATE.md` / `ROADMAP.md` untouched

### Falsifiability (147-VALIDATION.md)

| SC | Mutation | Result |
|----|----------|--------|
| SC-2 (1) | Delete `returns_series` from the `getMyAllocationDashboard` `strategy_analytics (…)` embed — the SECOND class member, not hand-picked by the gate | ✅ RED: **2 failed / 10 passed**. Layer A named `src/lib/queries.ts` with the full bare select payload; Layer B's block-sliced embed pin fell (`expected 'strategy_analytics (…' to contain 'returns_series'`). |
| SC-2 (2) | Revert the resolver call in `factsheet/[id]/v2/page.tsx:71` to `normalizeDailyReturns(dailyRaw)` | ✅ RED: **1 failed / 11 passed**. The REFERENCE pin fell (`expected '…' to contain 'resolveDailyReturnSeries('`) — the reference surfaces are genuinely held. |

Both reverted **by re-editing the mutated line** (never a file-level `git checkout --`, per the 147-02 near-loss lesson); `git diff` confirmed 0 lines for both files afterwards.

## TDD Gate Compliance

Task 1 followed RED → GREEN in order, each gate its own commit with observed counts in the message: `3bee2083` (test, 3 failed / 1 passed) → `222cc9d4` (feat, 4 passed). No REFACTOR gate was needed. Tasks 2 and 3 are `type="auto"` without a `tdd` flag — Task 2 is test-only by construction (a structural gate, whose non-vacuity is established by mutation rather than by a RED-first cycle, which is the phase-63 precedent it mirrors), and Task 3 touched no code at all.

## Known Stubs

**None introduced by this plan.** Every path added here is live: the hydration effect fires a real request against the existing route, and the gate reads real source.

One **pre-existing** stub was *found* by the Task 3 audit and deliberately left in place: `buildEquityCurveSeries` (`src/app/(dashboard)/portfolios/[id]/page.tsx:211-231`) hard-codes `equityCurve: null` for every per-strategy curve. It is out of this phase's scope (an untouched file, a different surface, and not a wrong number — the chart omits per-strategy lines rather than fabricating them), and it is booked as `DEF-147-A` in TODOS.md with its fix shape. It does not block this plan's goal: the composer, not the portfolio detail chart, is what SCEN-01 is about.

## Threat Flags

None. This plan adds **no** endpoint, no query, no schema change and no trust boundary — the hydration effect is a new *trigger time* for a request that already existed with identical auth, identical route and identical 404 oracle (**T-147-17**, disposition `accept`, unchanged). The registered mitigations are discharged by test: **T-147-16** (self-inflicted fetch storm) by HYD-3, which re-renders with fresh payload identities both in-flight and post-settle and pins the call count at 1, and by HYD-2, which proves an in-book strategy fires nothing at all; **T-147-18** (future bare-reader regression) by the gate itself plus the two recorded mutation experiments. Zero package installs (**T-147-SC**).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **The phase's automated evidence is complete; the manual acceptance is not.** The *Manual-Only Verifications* table in `147-VALIDATION.md` is entirely outstanding and is orchestrator/founder work: the PROD walkthrough on strategy `4eab92b0` (**with a page refresh mid-walkthrough — that is what P6 was fixed for**), the A1 composite check (`data_quality_flags->'composite'`; if true, the factsheet renders the composite arithmetic curve while the composer gets the differenced `returns_series`, so SC1's day-count needs re-deriving before it is judged), the A2 missing-row census, and the OG re-unfurl with a cache-busting query string.
- **Day-count expectation:** N−1, never a hard-coded 136 — differencing consumes one day.
- **The gate will now fail any future PR** that adds a `daily_returns`-only select anywhere under `src/`, or that drops the resolver call from any of the eight pinned surfaces. Its one blind spot is documented in its own docstring: type annotations and prose are out of scope by design.
- **Backlog handed over:** `DEF-147-A` (unwired per-strategy equity curves behind a stale comment) and `DEF-147-B` (two dead type annotations) are in TODOS.md, both with fix shapes and both explicitly out of this phase's scope.

## Self-Check: PASSED

- Files claimed created/modified exist on disk and are in the diff: `src/__tests__/phase-147-series-resolution-guards.test.ts` (created), `ScenarioComposer.tsx`, `ScenarioComposer.test.tsx`, `TODOS.md`, `147-VALIDATION.md`
- Commits claimed exist in this worktree's history: `3bee2083`, `222cc9d4`, `3b57f988`, `c81b5d0b`
- `STATE.md` and `ROADMAP.md` are unmodified, as required
- No missing items.

---
*Phase: 147-scen-01-the-scenario-engine-receives-the-real-series*
*Completed: 2026-08-05*
