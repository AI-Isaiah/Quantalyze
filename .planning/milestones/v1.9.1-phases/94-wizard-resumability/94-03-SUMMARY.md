---
phase: 94-wizard-resumability
plan: 03
subsystem: wizard
tags: [nextjs, react, client-component, composite, wizard, state-machine, snapshot, non-destructive]

# Dependency graph
requires:
  - phase: 94-wizard-resumability
    plan: 02
    provides: "MultiKeyConnectStep rehydrates State B on mount (draftStrategyId prop) — so a non-destructive back-nav to connect_key re-fills the stored keys"
  - phase: 88-onboarding
    provides: "SyncPreviewStep composite branch (isComposite from server-truth kickoff response), the three review/try-again button sites, and the mount kickoff/freshness-skip effect"
provides:
  - "Composite 'Review your keys' is NON-destructive: onReviewKeys = setStep(connect_key) + persistPointer only — the draft, its strategy_keys members, and the wizardSessionId all survive the round-trip"
  - "Single-key 'Try another key' destructive path (delete draft + fresh session) is byte-identical — no new destructive affordance added"
  - "cachedSnapshot short-circuit: returning to sync_preview with a held snapshot renders it directly — no strategy_analytics read, no /api/keys/sync POST, no poll"
  - "COMPLETE-composite durability: a finished stitch skips the kickoff regardless of the 5-min freshness window (hard-reload case), so it is never re-crawled/re-stitched merely to display"
affects: [wizard-resumability, composite-onboarding, WIZ-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Affordance split by server-truth discriminator: composite buttons resolve to a non-destructive callback (onReviewKeys) while single-key keeps the destructive one (onTryAnotherKey), gated on isComposite — never blended (Rule 7)"
    - "Thread-state-that-already-exists: WizardClient's captured syncSnapshot is passed back as cachedSnapshot for an early return in the child mount effect, instead of a new persistence layer"
    - "Durability skip keyed off the persisted data_quality_flags.composite marker: composite-ness is read for ANY complete row (fresh or stale), fail-CLOSED only on the fresh-skip path (no POST fallback); stale falls through to the kickoff (route fails CLOSED 503 end-to-end)"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx

key-decisions:
  - "WIZ-05 durability fail-closed scoping (deviation from plan's literal 'keep fail-CLOSED verbatim for any complete row'): the dq-marker fail-CLOSED SYNC_FAILED stays byte-identical on the FRESH-skip path (which has no POST fallback), but a STALE row with an absent/unreadable marker FALLS THROUGH to the kickoff POST (byte-identical to today's stale behavior) rather than failing closed. The route fails CLOSED (503) on unknowable membership, so the end-to-end guarantee holds. This was required to keep the frozen SyncPreviewStep.composite.render.test.tsx (default mock: stale complete + null dq marker) green — that file is NOT in files_modified, so it must pass untouched, and it does."
  - "WIZ-03 A2: composite 'Review your keys' is purely non-destructive (setStep + pointer); no separate 'start the composite over' affordance was added."
  - "onReviewKeys is optional (?): a missing wiring degrades to onTryAnotherKey rather than a dead click."

patterns-established:
  - "cachedSnapshot early-return is the FIRST statement of the mount IIFE (before createClient) — grep order guarantees no DB probe/kickoff on a cache hit."
  - "WizardClient-level callback wiring tested by stubbing the step children (SyncPreviewStep/MultiKeyConnectStep) so the two callbacks (non-destructive vs destructive) are exercised in isolation via captured props."

requirements-completed: [WIZ-03, WIZ-05]

# Metrics
duration: 12min
completed: 2026-07-11
---

# Phase 94 Plan 03: Non-destructive Review + Cached Crawl Snapshot Summary

**Composite "Review your keys" no longer deletes the draft (it is now a pure step transition back to connect_key), and returning to the crawled step renders the cached/persisted stitch snapshot instead of re-kicking the sync — including after a hard reload, where a COMPLETE composite skips the kickoff regardless of the 5-minute freshness window.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-11T21:20Z
- **Completed:** 2026-07-11T21:32Z
- **Tasks:** 3 completed
- **Files modified:** 4

## Accomplishments

### Task 1 — WIZ-03: split the review affordance from the destructive one (`3e25e0a9`)
- Added optional `onReviewKeys?: () => void` to `SyncPreviewStepProps`.
- All three review/try-again button sites (gate-failed card, composite success card, single-key success card) now resolve to `isComposite && onReviewKeys ? onReviewKeys : onTryAnotherKey`. Labels were already `isComposite`-branched; copy unchanged; `data-testid` unchanged.
- WizardClient's `onReviewKeys` body is `setStep("connect_key")` + `persistPointer("connect_key", strategyId)` only — NO `handleDeleteDraft` (which would cascade away every `strategy_keys` member) and NO `setWizardSessionId`/session regen. The existing destructive `onTryAnotherKey` closure is byte-identical (git-diff verified: zero changed lines in the closure body).

### Task 2 — WIZ-05: cachedSnapshot short-circuit + COMPLETE-composite durability skip (`b64c4006`)
- Added `cachedSnapshot?: SyncPreviewSnapshot | null` to props. The mount effect's async IIFE now returns FIRST (before `createClient()`) when a snapshot is held: `setSnapshot(cachedSnapshot); if (composite) setIsComposite(true); setPhase("passed")` — no `strategy_analytics` read, no `/api/keys/sync` POST, no poll.
- Restructured the complete-row branch: compute `isComplete = isComputedAnalytics(...)` and read `data_quality_flags` for ANY complete row. A COMPLETE composite (`dqFlags.composite === true`) skips the kickoff regardless of freshness (durability). Fresh non-composite skips (byte-identical); STALE non-composite / unreadable-marker falls through to the kickoff POST (byte-neutral).
- Threaded `cachedSnapshot={syncSnapshot}` at the WizardClient render site.
- Added `data_quality_flags` branches to the existing `installSupabaseMock` and `pendingClient` mocks in the render test so the new stale-path marker read is modeled (see Deviations).

### Task 3 — component tests (`3f54b11a`)
- `WizardClient.test.tsx`: "Review your keys" → connect_key with NO draft DELETE and no session regen; "Try another key" still issues the draft DELETE (destructive pin, research Pitfall 3). Step children stubbed to drive the callbacks directly.
- `SyncPreviewStep.render.test.tsx`: cachedSnapshot renders the passed factsheet with no `createClient` read and no `/api/keys/sync`; a COMPLETE composite 10 min old skips the kickoff; a COMPLETE-but-stale single-key row still POSTs (byte-neutral).
- RED verified by neutering both fixes locally (rename `onReviewKeys` prop; disable the `cachedSnapshot` early-return): the review pin and the cachedSnapshot pin both failed; restored → 183/183 green.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run "src/app/(dashboard)/strategies/new/wizard"` — **183/183 passing** (19 files), including the frozen `SyncPreviewStep.composite.render.test.tsx` and `SyncPreviewStep.render.test.tsx` suites.
- `npm run lint -- "src/app/(dashboard)/strategies/new/wizard"` — 0 errors (1 pre-existing warning in an unrelated file `allocations/widgets/performance/EquityChart.tsx`, out of scope).
- No migration. DESIGN.md honored (no copy/visual change — only callback wiring).
- Byte-identical pins confirmed: the destructive `onTryAnotherKey` closure has zero diff lines; the `setErrorCode("SYNC_FAILED")` fail-closed statements remain verbatim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WIZ-05 fail-closed scoping so the frozen composite render test stays green**
- **Found during:** Task 2.
- **Issue:** The plan's literal instruction ("perform the data_quality_flags read for any complete row and keep its fail-CLOSED SYNC_FAILED branch verbatim") would fail-close a STALE complete row whose marker is null/unreadable. The frozen `SyncPreviewStep.composite.render.test.tsx` — which is NOT in `files_modified`, so it must pass untouched — installs a default mock of a STALE complete row with a NULL dq marker and expects the flow to fall through to the kickoff POST (composite-ness comes from the kickoff response). Failing closed there would break all 5 composite pins + Finding-H + R2-5.
- **Fix:** Scoped the fail-CLOSED SYNC_FAILED to the FRESH-skip path only (which has no POST fallback and where it is byte-identical to today). A STALE complete row with an absent/unreadable marker falls through to the kickoff POST exactly as today; the route fails CLOSED (503) on unknowable membership, so the end-to-end fail-closed guarantee is preserved. A STALE complete row whose marker AFFIRMATIVELY says composite skips the kickoff (the durability requirement). This is strictly safer than the literal reading (it never blocks a legitimate stale single-key resume on a transient marker-read blip) and is what the plan's own byte-neutral pins ("a COMPLETE-but-stale single-key row still POSTs") require.
- **Files modified:** `SyncPreviewStep.tsx`.
- **Commit:** `b64c4006`.

**2. [Rule 3 - Blocking] Model the new stale-path marker read in the existing render-test mocks**
- **Found during:** Task 2.
- **Issue:** The mount effect now reads `data_quality_flags` for ANY complete row (fresh or stale). The existing `installSupabaseMock` (stale complete freshness probe) routed that read to its "heavy terminal fetch" branch, which in the `heavyOutcome:"throw"` variant REJECTS — aborting the mount effect and breaking `[H-0197]`. The `pendingClient` mock routed it to the never-resolving status-poll branch, breaking the in-flight-poll test.
- **Fix:** Added an explicit `cols === "data_quality_flags"` branch to both mocks returning a present, non-composite marker — so the stale single-key path falls through to the kickoff POST exactly as before and the existing suites keep testing what they intend. `installDeribitPassMock` and the composite render test needed no change (their branches already return a truthy/marker row).
- **Files modified:** `SyncPreviewStep.render.test.tsx`.
- **Commit:** `b64c4006`.

## Known Stubs

None. No placeholder data or unwired components introduced.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema change. Trust boundaries from the plan's threat register (T-94-10..14) are mitigated as designed: the non-destructive callback contains only `setStep` + `persistPointer` (grep-verified), never regenerates the session id, and `SyncPreviewSnapshot` carries only derived metrics/dates/labels (no key material). Zero new packages.

## Self-Check: PASSED

- Files exist: `SyncPreviewStep.tsx`, `WizardClient.tsx`, `WizardClient.test.tsx`, `SyncPreviewStep.render.test.tsx` — all FOUND.
- Commits exist: `3e25e0a9`, `b64c4006`, `3f54b11a` — all FOUND in git log.
