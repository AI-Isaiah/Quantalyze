---
phase: 95-stitch-progress-transparency
plan: 05
subsystem: ui
tags: [react, hooks, polling, supabase, strategy-analytics, wizard, refactor]

# Dependency graph
requires:
  - phase: 95-01
    provides: "SyncProgress.poll.test.tsx characterization pin (3s cadence, 40/41 cap, 10/11 grace, no-escalation asymmetry, counter reset, idle-not-forwarded)"
  - phase: 95-04
    provides: "SyncPreviewStep.progress.render.test.tsx sibling pin (per-key panel + interrupted state) — the last churn on the shared wizard file"
provides:
  - "One parametrized useStrategySyncPoller hook driving BOTH SyncProgress and the wizard SyncPreviewStep status-poll loops (#46 closed)"
  - "Duplicated strategy_analytics scheduling/cap/grace/escalation loop removed from both surfaces"
affects: [strategy-onboarding, composite-onboarding, sync-progress]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parametrized shared poll hook: schedule:number → setInterval semantics (cap/grace); schedule:readonly number[] → self-scheduled setTimeout backoff ladder (consecutive-error escalation + async onTerminal repoll)"
    - "Latest-callback refs synced in an effect so inline caller callbacks never re-run the poll effect (protects effect-local counters against 1s elapsed-timer re-renders)"
    - "Green-diff parity method: behavior preservation PROVEN by pre-existing pins passing byte-untouched, not asserted by new tests"

key-files:
  created:
    - "src/hooks/useStrategySyncPoller.ts"
  modified:
    - "src/components/strategy/SyncProgress.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"

key-decisions:
  - "Read shape keyed on schedule mode (number → .select(3 cols).single() PGRST116-grace; ladder → .select(2 cols).maybeSingle() error-as-value) so BOTH pin mocks (which match exact column strings + single vs maybeSingle) stay green byte-untouched — the plan's single stated read shape only matched SyncProgress"
  - "onTerminal owns BOTH the failed short-circuit AND the heavy success arms (returns done/repoll); the hook's terminal detection = failed || isComputedAnalytics"
  - "heavyFetchErrors moved to a component useRef (not an onTerminal closure local) so it survives the 1s elapsed-timer re-renders that recreate the closure — the heavy-fetch escalation pin needs it to persist across ticks"
  - "onTerminal signature extended to (status, error) so the single-key gate keeps computationError=nextError from the same tick (state would be stale)"

patterns-established:
  - "useStrategySyncPoller: the canonical shared strategy_analytics status-poll loop; new poll consumers parametrize it rather than hand-rolling setInterval/setTimeout"

requirements-completed: [UX-03]

# Metrics
duration: 17min
completed: 2026-07-12
---

# Phase 95 Plan 05: useStrategySyncPoller Extraction Summary

**One parametrized `useStrategySyncPoller` hook now drives both the SyncProgress and wizard SyncPreviewStep `strategy_analytics` poll loops, removing the duplicated scheduling/cap/grace/escalation code with ZERO behavior change — proven by all five pre-existing pins passing byte-untouched (#46 closed).**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-07-12T00:38:39Z
- **Completed:** 2026-07-12T00:55:44Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- New `useStrategySyncPoller` hook (284 lines) parametrizes the ONE shared status-poll loop: schedule (fixed number vs backoff ladder), optional cap/grace (SyncProgress) vs optional consecutive-error escalation (wizard), and an async `onTerminal` that returns `"done"`/`"repoll"` (R2-5).
- SyncProgress rewired: its `pollAttemptsRef` + `pollStatus` + setInterval effect deleted; polls via the hook (`schedule:3000, maxAttempts:40, missingRowGracePolls:10`). The `toSyncStatus` idle-drop forward filter stays surface policy.
- SyncPreviewStep rewired: its self-scheduling setTimeout ladder + consecutive-error counting + terminal detection deleted; polls via the hook (`schedule:POLL_BACKOFF_MS, maxConsecutiveErrors:3`). The heavy composite/single-key arms, `heavyFetchErrors` escalation, WIZ-05 durability, RT-1 stall behavior, and the 95-04 sync-progress piggyback all stay in the wizard.
- Duplication provably removed: `SyncProgress.tsx` has no `strategy_analytics` query (only `strategies`/`api_keys` for the exchange name); the wizard has no poll-loop `setTimeout` (only the elapsed-timer `setInterval` + kickoff/durability/heavy-arm reads). The hook is the only scheduling loop.

## Hook parameter surface
`useStrategySyncPoller({ enabled, strategyId, schedule, maxConsecutiveErrors?, maxAttempts?, missingRowGracePolls?, onStatus, onTerminal?, onError })`
- **Hook owns:** scheduling (interval vs ladder), the read, PGRST116/error-as-value distinction, attempt/grace/consecutive-error counting, terminal detection (`failed || isComputedAnalytics`), timer cancellation.
- **Stays out (surface-specific):** SyncProgress's `toSyncStatus` forward filter / exchange fetch / step-dots / elapsed timer; the wizard's kickoff / WIZ-05 durability / heavy arms / `heavyFetchErrors` / sync-progress piggyback / gate.

## Task Commits
1. **Task 1: Create parametrized hook** - `d8e43af0` (feat)
2. **Task 2: Rewire SyncProgress** - `e4a5a88e` (refactor)
3. **Task 3: Rewire SyncPreviewStep — #46 closed** - `d5766970` (refactor)

## Zero-edit-green pin gate (the safety contract)
All five pins pass with the test files BYTE-UNTOUCHED (`git status --porcelain` empty for each):
1. `SyncProgress.poll.test.tsx` (95-01 characterization) ✓
2. `SyncPreviewStep.composite.render.test.tsx` (frozen Phase-94) ✓
3. `SyncPreviewStep.render.test.tsx` (frozen Phase-94) ✓
4. `SyncPreviewStep.test.ts` (frozen sibling) ✓
5. `SyncPreviewStep.progress.render.test.tsx` (95-04) ✓

Verify results: targeted suites 388/388 green; full suite 7998 passed / 288 skipped with ONE pre-existing unrelated failure (see Deviations); `npx tsc --noEmit` clean; `npm run lint` 0 errors (1 pre-existing warning in EquityChart.tsx, out of scope).

## Files Created/Modified
- `src/hooks/useStrategySyncPoller.ts` (created) - The shared parametrized status-poll hook.
- `src/components/strategy/SyncProgress.tsx` (modified) - Deleted its poll loop; calls the hook.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (modified) - Deleted its poll-loop mechanics; calls the hook with the heavy arms in `onTerminal`.

## Decisions Made
- **Per-surface read shape keyed on schedule mode.** The two pin mocks match the EXACT select-column string and `.single()` vs `.maybeSingle()`. SyncProgress reads `computation_status, computation_error, computed_at` via `.single()` (PGRST116 grace); the wizard reads `computation_status, computation_error` via `.maybeSingle()` (error-as-value). The plan's Task-1 example stated only the SyncProgress shape; keying the read on `typeof schedule` satisfies both mocks without leaking column strings into the parameter surface.
- **`onTerminal` gained an `error` argument.** The single-key gate needs `computationError` from the same tick's read; the `computationError` state would be stale inside the closure.
- **`heavyFetchErrors` is a component `useRef`, not a closure local.** Both surfaces re-render every second (elapsed timer), recreating the `onTerminal` closure; a closure `let` would reset between the ~3s-apart heavy throws and never reach the escalation threshold. The ref persists across re-renders (matching the loop's documented "never needs a reset" invariant).

## Deviations from Plan

### Deferred Issues (out of scope — NOT fixed)

**1. Pre-existing full-suite failure: `limiter-ordering.test.ts` — unclassified sync-progress route**
- **Found during:** Task 3 full `npm run test` gate.
- **Issue:** `src/lib/api/limiter-ordering.test.ts > every rate-limited route is classified` fails because `src/app/api/strategies/[id]/sync-progress/route.ts` is not classified in the rate-limiter ordering manifest.
- **Root cause:** That route was committed by `3a4a83ea feat(95-03)` — an EARLIER plan in this phase. It is not in this plan's diff (95-05 touches only `SyncPreviewStep.tsx` + `useStrategySyncPoller.ts`, zero route/limiter/manifest files). There is no causal path from a client poll-loop refactor to a route-classification test.
- **Disposition:** OUT OF SCOPE per the deviation SCOPE BOUNDARY (pre-existing failure in an unrelated file caused by another plan). NOT fixed here. Should be addressed by classifying the 95-03 sync-progress route in the limiter manifest (its own follow-up). Flagged loudly to the orchestrator.

---

**Total deviations:** 0 auto-fixed. 1 pre-existing out-of-scope failure documented (not caused by this plan).
**Impact on plan:** None on the extraction. Every pin is green byte-untouched; the one full-suite red is a phase-level limiter-manifest gap from 95-03, independent of this refactor.

## Issues Encountered
- **`react-hooks/refs` lint error** on assigning the latest-callback refs during render. Resolved by syncing them inside a dedicated `useEffect` (declared before the poll effect so it flushes first); refs remain fresh because passive effects flush well before any ≥3s poll timer fires. Fixed within Task 3 before its commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SC-4 (roadmap) satisfied: one shared `useStrategySyncPoller`, duplicated loop removed, no behavior change proven by the zero-edit green pins. WIZ-05 durability + RT-1 stall semantics behaviorally preserved. #46 closable.
- **Blocker for a fully-green main:** the pre-existing `limiter-ordering` failure (95-03 sync-progress route unclassified) must be resolved separately before this phase's branch merges green.

## Self-Check: PASSED
- FOUND: `src/hooks/useStrategySyncPoller.ts`
- FOUND: `.planning/phases/95-stitch-progress-transparency/95-05-SUMMARY.md`
- FOUND commits: `d8e43af0`, `e4a5a88e`, `d5766970`
- All 5 pin files byte-untouched (`git status --porcelain` empty for each)
- `.planning` is gitignored (local-only) — SUMMARY not committed by design; no other `.planning` files touched (STATE/ROADMAP/REQUIREMENTS updates deferred to the orchestrator per spawn constraint)

---
*Phase: 95-stitch-progress-transparency*
*Completed: 2026-07-12*
