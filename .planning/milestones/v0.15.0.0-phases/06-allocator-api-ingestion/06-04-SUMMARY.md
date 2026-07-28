---
phase: 06-allocator-api-ingestion
plan: 04
subsystem: react-client-ui
tags: [nextjs, react, ui, client-component, polling, design-system, a11y, aria-live, tdd, f4, f8]

# Dependency graph
requires:
  - phase: 06-allocator-api-ingestion
    plan: 01
    provides: "migration 066 — api_keys.sync_status CHECK extended with 'revoked' + 'rate_limited' values; sync_error column + GRANT SELECT to authenticated"
  - phase: 06-allocator-api-ingestion
    plan: 03
    provides: "POST /api/allocator/holdings/sync route that returns {ok, job_id} | {already_inflight: true, next_attempt_at} | 400 | 403 | 500"
  - phase: 02-mandate-profile-builder
    plan: 01
    provides: "MandateSaveStatus aria-live='polite' inline helper pattern mirrored here for the pill helper line"
provides:
  - AllocatorSyncStatus sub-component with 7 LOCKED pill states + f8 Queued helper + f4 helperOverride
  - AllocatorExchangeManager extended with real Sync now button + 5s polling + AWAITED first-run sync chain (f4) + already_inflight next_attempt_at capture (f8)
  - Component tests asserting D-08 copy character-for-character (U+2026 ellipsis + U+2014 em-dash) + f4 403 error path + f8 Queued-state rendering
affects:
  - "08 MANAGE — /connections page can lift the pill to a shared SyncStatusPill component"
  - "11 ONBOARD — full sync-state matrix extends the 7-state pattern established here"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-08 copy-as-code with character-level test assertions (U+2026 + U+2014 verbatim)"
    - "Typographic glyphs documented inline with ELLIPSIS/EM_DASH constants + comments that ban the ASCII fallbacks"
    - "Polling state machine via useEffect + setInterval + clearInterval with unmount cleanup and hasSyncing gate"
    - "initialKeys→state MERGE effect preserving client-only fields across router.refresh() (Next 16 RSC client-refresh idiom)"
    - "Optimistic-then-corrective client state model (local optimistic → server router.refresh corrects)"
    - "AWAITED first-run POST with row-scoped aria-live error surface — no more fire-and-forget (f4)"
    - "next_attempt_at capture from route's already_inflight response surfaced as Queued helper (f8 rate-limit-contagion UI)"
    - "helperOverride prop as first-class aria-live surface for manager-side error injection (f4)"
    - "Tailwind motion-safe: variant to freeze spinner under prefers-reduced-motion"

key-files:
  created:
    - "src/components/exchanges/AllocatorSyncStatus.tsx (253 lines) — 7-state pill + helper line; f4 helperOverride + f8 Queued helper"
    - "src/components/exchanges/AllocatorSyncStatus.test.tsx (474 lines) — 28 tests, character-level copy verification + color map + f4/f8 rendering"
    - "src/components/exchanges/AllocatorExchangeManager.test.tsx (487 lines) — 13 tests, Sync now POST contract + optimistic + f4 LOCKED test + f8 Queued + polling lifecycle + Landmine 8"
  modified:
    - "src/components/exchanges/AllocatorExchangeManager.tsx (+210 / -31) — ExchangeConnection extended, handleSync added, handleAddKey AWAITS first-run POST, 5s polling + initialKeys merge, renders AllocatorSyncStatus, removes disabled Auto-synced button + HIGH-09 tech-debt comment"

key-decisions:
  - "Sub-component co-located at src/components/exchanges/AllocatorSyncStatus.tsx (NOT extracted to src/components/ui/ primitives) — Phase 08 will promote to shared SyncStatusPill once /connections needs the same"
  - "File name AllocatorSyncStatus not SyncStatusPill for Phase 06 — reflects allocator scope; rename deferred to the Phase 08 promotion"
  - "Disabled-button SR-readable reason uses title='Sync in progress' (not just disabled) per UI-SPEC Copywriting Contract row 2"
  - "First-run fetch is AWAITED (f4) with modal close BEFORE the await so errors land on the row's aria-live helper line instead of blocking the modal"
  - "30s threshold for Queued helper (f8) — avoids chatter on fresh syncs that will transition before the breaker matters"
  - "Client-only fields (queued_next_attempt_at + helper_override) NOT persisted; default to null on initialKeys merge unless a matching id already carries them"
  - "Tailwind motion-safe:animate-spin over raw CSS keyframes — leverages the existing globals.css precedent and keeps the diff tight"
  - "Input Props type widened via InitialKey omit/extend so the current pre-Plan-01 getUserApiKeys return shape (without sync_error) still satisfies the Props contract — the normalizer defaults sync_error to null"

patterns-established:
  - "D-08 copy-as-code: const strings for every pill label, const comments banning ASCII fallbacks (`// U+2026 — NOT three dots.`), unit tests grep each codepoint"
  - "Character-level test fidelity: `expect(textContent).toContain('\\u2026')` + `not.toContain('...')` pairs for every locked glyph"
  - "aria-live polite scope: the helper line is the sole announcement surface; pill itself has no aria-live so neutral idle→syncing→complete transitions are SR-silent"
  - "helperOverride pattern for cross-component error injection: optional prop takes precedence over computed helper; empty string does NOT suppress (explicit null/undefined means 'no override')"
  - "Landmine 8 fix: `useEffect(() => setKeys(merge(initialKeys, byId)), [initialKeys])` preserves client-only fields per matching row id while accepting server truth for shared fields"
  - "Optimistic revert pattern: setKeys on click → setKeys again in catch/non-ok branches — no separate error state; everything funnels through the row's helper_override field"

requirements-completed: [INGEST-05, INGEST-06, INGEST-07]

# Metrics
duration: 14min
completed: 2026-04-20
tests_green: "41/41 (28 AllocatorSyncStatus + 13 AllocatorExchangeManager); full suite 1330/1330 (59 skipped, 0 failed)"
tasks_completed: "2/3 (Task 06-04-03 is a checkpoint:human-action visual /qa audit — NOT executed by this agent)"
---

# Phase 06 Plan 04: Sync-status UI + Sync now + Awaited First-Run Summary

**Replaced the disabled "Auto-synced" stub with a real 7-state sync-status pill + helper line + awaited first-run POST chain, plus the f8 Queued helper that surfaces per-exchange circuit-breaker contagion from strategy-side 429s.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-20T08:15:19Z
- **Completed:** 2026-04-20T08:29:19Z
- **Tasks:** 2 / 3 (Task 3 is a human visual /qa checkpoint — NOT executed)
- **Files modified:** 4 (2 new components + 2 new test files + 1 extended manager; the manager counts in modified)
- **Commits:** 4 (TDD RED + GREEN for each of the two code tasks)

## Accomplishments

- **AllocatorSyncStatus** — new co-located sub-component at `src/components/exchanges/AllocatorSyncStatus.tsx` that renders a 7-state pill + helper line with D-08 copy LOCKED character-for-character (U+2026 ellipsis, U+2014 em-dash). 28 unit tests assert every pill label, every color class, the aria-live contract, the f8 Queued threshold, and the f4 helperOverride precedence.
- **AllocatorExchangeManager extension** — handleSync POSTs to `/api/allocator/holdings/sync` with optimistic `sync_status='syncing'`, reverts to `idle` and surfaces `"Sync request failed — click Sync now to retry"` on 4xx/5xx/network error, captures `next_attempt_at` from 200 `already_inflight` responses for the f8 Queued surface. handleAddKey now **AWAITS** the first-run POST (f4 — no more fire-and-forget); modal closes BEFORE the await so the error lands on the new row's aria-live helper line instead of blocking the modal. 5s `router.refresh()` polling loop (D-11) is active only while any row is `syncing` and is cleared on unmount. `initialKeys` merge effect (Landmine 8) preserves client-only fields across server-refresh cycles.
- **f4 LOCKED regression test** — `handleAddKey_shows_error_when_first_run_sync_fails_with_403` asserts that a 403 first-run failure: (a) closes the modal, (b) reverts the pill to `Idle` (not stuck at `Syncing…`), (c) surfaces `"Sync request failed"` in the helper line.
- **f8 state capture test** — asserts the `already_inflight` + `next_attempt_at` path propagates to `AllocatorSyncStatus` and renders `"Queued — exchange cooldown, retry in {N}s"` with the U+2014 em-dash.
- **Removed** the disabled `Auto-synced` button and the stale HIGH-09 tech-debt comment block (sync IS now available — the comment was misleading).
- **Zero regressions** — full Vitest suite: 1330 passed / 59 skipped / 0 failed. `npx tsc --noEmit` clean.

## Task Commits

Each task was committed atomically in TDD RED→GREEN pairs:

1. **Task 1 RED: AllocatorSyncStatus failing tests** — `afbe2d1` (test)
2. **Task 1 GREEN: AllocatorSyncStatus implementation** — `bf778e8` (feat)
3. **Task 2 RED: AllocatorExchangeManager failing tests** — `b389cfa` (test)
4. **Task 2 GREEN: AllocatorExchangeManager extension** — `cb73a78` (feat)

**Task 3 (checkpoint:human-action):** NOT executed — requires human-driven visual /qa audit of all 7 pill states + f4 first-run-403 flow + f8 Queued state on staging. Deferred to the parent orchestrator / next agent session per the plan's `checkpoint:human-action gate="blocking"` directive.

## Files Created/Modified

### Created

- `src/components/exchanges/AllocatorSyncStatus.tsx` (253 lines) — 7-state pill + helper line sub-component. Exports `AllocatorSyncStatus` + `AllocatorSyncStatusProps`. Inline 12×12 SVG spinner with `motion-safe:animate-spin`. Forward-compat fallback: unknown / null / `computing` → neutral `Idle` pill.
- `src/components/exchanges/AllocatorSyncStatus.test.tsx` (474 lines) — 28 tests. Covers: 7 pill labels verbatim, U+2026 + U+2014 codepoint assertions, pill color map (neutral / amber / red), aria-live helper contract, forward-compat fallback, f8 Queued helper (≥30s threshold, boundary, non-syncing skip), f4 helperOverride precedence, spinner motion-safe class.
- `src/components/exchanges/AllocatorExchangeManager.test.tsx` (487 lines) — 13 tests. Covers: pill + Sync now button render (no stale "Auto-synced"), POST contract, disabled-while-syncing + `title="Sync in progress"`, optimistic syncing before fetch resolves, 4xx/network error helper surfacing, f8 Queued from `already_inflight`, f4 happy path (sync='syncing', no error helper), **f4 LOCKED test** `handleAddKey_shows_error_when_first_run_sync_fails_with_403` (modal close + pill `Idle` + helper `"Sync request failed"`), 5s polling start/tick/unmount cleanup, Landmine 8 `initialKeys` prop→state merge.

### Modified

- `src/components/exchanges/AllocatorExchangeManager.tsx` (+210 / -31):
  - `ExchangeConnection` interface: added `sync_error: string | null` (Landmine 3), `queued_next_attempt_at: string | null` (f8 client-only), `helper_override: string | null` (f4 client-only).
  - New `InitialKey` input type: accepts `sync_error` as optional so pre-Plan-01 `getUserApiKeys` return shape still satisfies `Props`.
  - Added `normalizeInitialKey(k, prev)` helper — merges server truth with client-only field preservation.
  - Added `useEffect(() => setKeys(...merge...), [initialKeys])` (Landmine 8).
  - Added `useEffect(() => setInterval(() => startTransition(() => router.refresh()), 5000), [keys, router, startTransition])` with `clearInterval` cleanup (D-11).
  - Added `handleSync(apiKeyId)` — optimistic syncing + AWAITED POST + 4xx/network revert + f8 next_attempt_at capture.
  - Rewrote `handleAddKey` first-run block — removed fire-and-forget `.catch(() => {})`; AWAITS the POST; modal closes before the await; f4 error surfacing via `helper_override`; f8 already_inflight path.
  - Replaced `<Button variant="secondary" disabled title="Exchange sync is not yet available">Auto-synced</Button>` with `<AllocatorSyncStatus .../>` + `<Button variant="primary" disabled={key.sync_status === "syncing"} aria-label={...} title={...}>Sync now</Button>`.
  - Deleted the stale HIGH-09 tech-debt comment block at the previous lines 163-167.

## Decisions Made

1. **Sub-component co-located, not promoted** — `AllocatorSyncStatus` lives in `src/components/exchanges/` (not `src/components/ui/`). Phase 08 will lift to a shared `SyncStatusPill` primitive once `/connections` needs the same.
2. **Name: `AllocatorSyncStatus` (not `SyncStatusPill`)** — scoped name for Phase 06's single call-site. Rename deferred to the Phase 08 promotion.
3. **`title="Sync in progress"` on disabled button** — gives the SR a reason for the disabled state per UI-SPEC Copywriting Contract row 2. Not user-visible text.
4. **Modal closes BEFORE `await fetch(...)`** in the f4 path — so the error lands on the row's aria-live helper line rather than blocking the modal. Planner option chosen per UI-SPEC intent.
5. **30s threshold for Queued helper (f8)** — suppresses chatter on fresh syncs that will resolve before the breaker cooldown matters. The `QUEUED_THRESHOLD_SECONDS` constant + explicit `>= QUEUED_THRESHOLD_SECONDS` check are greppable + testable.
6. **Client-only fields via `InitialKey` type widening** — `queued_next_attempt_at` + `helper_override` are client-state-only, not DB columns. The manager's Props input type omits them (so callers don't have to fabricate them) and the normalizer defaults them on merge.
7. **Tailwind `motion-safe:animate-spin`** — leverages the globals.css precedent and keeps the diff tight. No new CSS keyframes, no reduced-motion conditional rendering.

## Deviations from Plan

### Task 2 test — f8 fake-timer removal

**Found during:** Task 2 GREEN phase.
**Issue:** The initial draft of the f8 test used `vi.useFakeTimers()` to anchor wall-clock for deterministic seconds-until math. When combined with `waitFor(...)` polling, fake timers blocked the microtask queue and the test hung for 5s before timing out. This also contaminated subsequent tests in the same file (fake timers bled into handleAddKey tests because the f8 test timed out before its `vi.useRealTimers()` ran).
**Fix:** Removed `vi.useFakeTimers()` from the f8 test and widened the seconds-drift regex from `(88|89|90|91|92)s` to `(86|87|88|89|90|91|92)s` (±3s for microtask latency). All 13 tests green.
**Rationale for Rule 3 classification:** Fake-timer / real-time conflict was a blocking-issue auto-fix inside the current task scope — the test setup was preventing me from completing Task 2. Not a behaviour change in production code; only the test's time-source strategy.
**Files modified:** `src/components/exchanges/AllocatorExchangeManager.test.tsx` (one test block re-worked in the GREEN commit).

### No other deviations

The plan's `<action>` block was followed verbatim otherwise. No architectural escalations needed.

## Known Stubs

None. Both new components wire real data paths (AllocatorSyncStatus renders from props; AllocatorExchangeManager POSTs to the real route and consumes the real response shape). The `getUserApiKeys()` pre-Plan-01 shape gap is handled via the `InitialKey` widened input type + `normalizeInitialKey` defaults — not a stub, a graceful degradation that disappears once Plan 01 ships `sync_error` into the projection.

## Threat Flags

None. The components consume the existing Plan 03 route surface (no new endpoints) and the existing `/api/keys/validate-and-encrypt` route. aria-live content is the already-sanitized `sync_error` from the DB (≤500 chars server-side per D-07) — no new PII surface.

## Acceptance Criteria — Status

**Task 1 acceptance criteria (AllocatorSyncStatus):**
- [x] `test -f src/components/exchanges/AllocatorSyncStatus.tsx` — passes
- [x] `test -f src/components/exchanges/AllocatorSyncStatus.test.tsx` — passes
- [x] `grep 'Syncing\u2026\|Syncing…'` ≥ 1 — 2 matches (constant + test expectation)
- [x] 7 state literals present — 14 occurrences across PILL_STYLES + case branches
- [x] 3 pill color families present — all three (`bg-[#F1F5F9]`, `bg-warning/10`, `bg-negative/10`)
- [x] `aria-live="polite"` + `role="status"` — 2 matches (one each)
- [x] Revoked helper copy verbatim — 1 match
- [x] `motion-safe:animate-spin` — 2 matches (code + test)
- [x] **f8:** `queuedNextAttemptAt|Queued.*exchange cooldown` — 5 matches (prop + helper literal + comment)
- [x] **f8:** `QUEUED_THRESHOLD_SECONDS|>= 30` — 3 matches
- [x] **f4:** `helperOverride` — 8 matches
- [x] `npx vitest --run src/components/exchanges/AllocatorSyncStatus.test.tsx` — 28/28 green

**Task 2 acceptance criteria (AllocatorExchangeManager):**
- [x] `sync_error: string | null` — 1 match in interface
- [x] **f8:** `queued_next_attempt_at` — 10 matches (interface + capture + render propagation + normalizer + clears)
- [x] **f4:** `helper_override|Sync request failed` — 16 matches (interface + 4 error surfaces + const + test + comments)
- [x] `/api/allocator/holdings/sync` — 3 matches (handleSync + handleAddKey chain + inline comment)
- [x] `setInterval|clearInterval` — 3 matches (D-11 polling)
- [x] `initialKeys.map` / `setKeys.*initialKeys` — 3 matches (merge + mount)
- [x] `<AllocatorSyncStatus` + import — 2 matches
- [x] `Auto-synced|Exchange sync is not yet available` — 0 matches (both removed)
- [x] `handleSync` — 3 matches (def + onClick + new line count)
- [x] `HIGH-09` — 0 matches (comment removed)
- [x] **f4 awaited:** `await fetch` patterns — 3 matches (validate-and-encrypt + handleSync + handleAddKey sync chain)
- [x] `.catch(() => {})` — 0 matches (no fire-and-forget)
- [x] **f4 LOCKED TEST NAME:** `handleAddKey_shows_error_when_first_run_sync_fails_with_403` — 2 matches in test file (describe + it and comment)
- [x] **f8 test present:** `Queued.*exchange cooldown|already_inflight.*next_attempt_at` — 3 matches in test file
- [x] `npx vitest --run src/components/exchanges/` — 41/41 green
- [x] `npx tsc --noEmit` — clean (no new errors)

## Verification

- **Automated verification:** `npx vitest --run src/components/exchanges/` returns 41/41 green (28 AllocatorSyncStatus + 13 AllocatorExchangeManager). Full suite `npx vitest --run` returns 1330 passed / 59 skipped / 0 failed. `npx tsc --noEmit` clean.
- **Manual verification:** Task 06-04-03 — the visual /qa audit of all 7 pill states + f8 Queued + f4 first-run-403 on staging — was NOT executed by this agent. It is a `checkpoint:human-action gate="blocking"` task per the plan and requires a human to force each `sync_status` via service-role UPDATE, seed a Queued-state compute_jobs row, and capture screenshots against DESIGN.md + UI-SPEC.

## TDD Gate Compliance

Both code tasks followed the RED→GREEN cycle with separate commits per gate:

- **Task 1:**
  - RED: `afbe2d1` `test(06-04): add failing AllocatorSyncStatus copy-verbatim + f4/f8 suite` — import fails because component doesn't exist yet
  - GREEN: `bf778e8` `feat(06-04): implement AllocatorSyncStatus 7-state pill + f4/f8 helpers` — 28/28 green
- **Task 2:**
  - RED: `b389cfa` `test(06-04): add failing AllocatorExchangeManager integration suite` — 12 failing + 1 passing (stale `Auto-synced` absence test passing coincidentally; other 12 fail on missing testId / interface / fetch mocks)
  - GREEN: `cb73a78` `feat(06-04): wire Sync now + awaited first-run + 5s polling + f4/f8 in AllocatorExchangeManager` — 13/13 green (also includes the fake-timer deviation fix inside the f8 test)

No REFACTOR commits were needed — implementations landed clean.

## Self-Check

### Files verified

- [x] `src/components/exchanges/AllocatorSyncStatus.tsx` — FOUND (253 lines)
- [x] `src/components/exchanges/AllocatorSyncStatus.test.tsx` — FOUND (474 lines, 28 tests)
- [x] `src/components/exchanges/AllocatorExchangeManager.tsx` — FOUND (modified in place)
- [x] `src/components/exchanges/AllocatorExchangeManager.test.tsx` — FOUND (487 lines, 13 tests)

### Commits verified

- [x] `afbe2d1` — FOUND on branch `worktree-agent-abec84d0`
- [x] `bf778e8` — FOUND
- [x] `b389cfa` — FOUND
- [x] `cb73a78` — FOUND

## Self-Check: PASSED
