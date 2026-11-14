---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
verified: 2026-11-14T20:40:00Z
status: passed
score: 6/6 success criteria verified
verified_at_sha: 201c2a31cf37c4bbf7378c6cae2300a83182431c
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - src/lib/wizard/localStorage.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/app/api/strategies/composite/add-key/route.ts
  - src/app/api/strategies/composite/set-members/route.ts
  - src/lib/wizardErrors.ts
  - src/lib/queries.ts
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/StrategiesSection.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/exchanges/key-feeds-confirm.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
---

# Phase 213: KEYFLOW Verification Report

**Phase Goal:** A wizard draft is never resumed onto a different key without the user seeing it, and every key state the product can reach has a control that gets the user out (founder decisions a-d, 2026-11-14).
**Verified:** 2026-11-14
**Status:** passed
**Re-verification:** No, initial verification

Method: read the code diff `4c4fa1993..HEAD -- src` against the ROADMAP contract, CONTEXT (including "Founder answers to the hand-back"), then ran all 25 test files the phase touched (25 files, 1377 tests, all pass), then neutered each gate myself and confirmed RED, restoring each file from a byte backup (worktree clean afterwards). I did not rely on the SUMMARY neuter tables.

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| SC-1 | Unknown incoming key + stored draft key: no resume; create-with-key returns `deduped` on every existing-draft return | VERIFIED | `deriveWizardResumeOverrides` ANDs `!unknownMeetsStoredKey` into the single `if` that emits `wizardSessionId` (and the CSV burn). It declines on `source==="api"`, incoming `null`, stored string key, unless the stored draft is the one on screen (F1). The CSV literal `null` is untouched (`sessionKeyMatches` unchanged). `create-with-key` F6 session-fence arm now answers `deduped: true`; the venue-fence and reuse arms already did. The RPC-replay residual (F2) is named in code, and it needs a `RETURNS TABLE` change, so it is a recorded residual and not a gap. CR-02 option (1) is implemented: `WizardClient` shows the founder's sentence only on a same-`strategyId` dedup, and a neutral sentence on the `heldSession`-only arm (R3-M2, Claude's Discretion). Neuter RED: dropping `!unknownMeetsStoredKey` fails 3 tests (pure helper x2 and the wired `ContributionWizardOverlay.sessionid-fence` case); removing `deduped: true` from the F6 arm fails the route pin; `setDedupedKeptDraft(false)` fails the CR-02 case (draft on key A, Try another key, submit key B). |
| SC-2 | Manager can disconnect an orphan from the "No strategy yet" row; row kept; `KEY_ORPHANED` copy names the control | VERIFIED | `page.tsx` reads strategyless keys for every role (the `isAllocator` gate on the placeholder read is gone; only the portfolio read stays allocator-only). `deriveStrategylessKeys` filters on `disconnected_at == null`, the venue fence's own live-key test, so revoked or inactive orphans are listed with Disconnect and without "Finish setup". `StrategyTable` renders a Disconnect button when `onDisconnect` is passed. `StrategiesSection.DisconnectKeyConfirm` calls `disconnect_allocator_api_key` (live baseline definition read: owner-scoped via `auth.uid()`, role-agnostic, idempotent, only stamps `disconnected_at`, so the row is kept). It reuses the feeds-aware confirm via `key-feeds-confirm.ts`, announces and moves focus. `KEY_ORPHANED` fix lines now name "Disconnect" on that row, and no line points at Profile → API keys (F3). The way-out test, "after Disconnect the same account is not refused as KEY_ORPHANED", models the venue-fence filter and the partial unique index; SQL arm 6b of `test_api_keys_venue_identity_uniq.sql` is the DB-side pin. Neuter RED: removing the `onDisconnect` branch fails 8+ cases in `StrategiesSection.disconnect.test.tsx`. |
| SC-3 | No MT5 composite card; `composite/add-key` refuses `mt5` with a named code | VERIFIED | MT5 card removed from the `MultiKeyConnectStep` roster whatever `MT5_UI_ENABLED` says. `add-key` returns 400 `COMPOSITE_MT5_UNSUPPORTED` ahead of the flag gate, validation and RPC, so the answer is flag-independent. `set-members` also refuses an owned `mt5` member (user-scoped, tenant-filtered read; a faulted read refuses 500 and never passes; an unowned id gives no oracle). The `enterMulti` carry-over refuses an MT5 draft, and the footer shows a note instead of the button. The code is in the `wizardErrors` union with copy, and in both admitted-code lists. Neuter RED: `if (isMt5)` to `if (false)` fails 10 `add-key` cases (flag on and off, mixed case); the set-members check fails its case; removing the `enterMulti` guard and the footer swap each fail named MultiKeyConnectStep cases. |
| SC-4 | Composer shows basis-dependent metrics as pending until every leg's asset class resolves; never a number on the interim basis | VERIFIED | One `legsPending` boolean: any engine-set leg with a drawer-added `metricsState === "pending"` or in `loadingReturnsIds`. Book legs arrive settled. `settle()` writes `addedAssetClassById` and `addedMetricsById` in the same async tick (React 18 batching), so there is no settled-metrics, interim-basis render. It holds `gatedBlendMetrics` (cagr, volatility, Sharpe, Sortino), the strip's Sharpe delta and book-Sharpe tooltip, own-book Sharpe and Sortino deltas and their basis-built records, the gate caption, rolling Sharpe, volatility and Sortino panels plus notes, the benchmark section, the factsheet preview, and the peer-rank inputs (so no request is made). F5: a failed probe is terminal for the hydration effect, and remove then re-add is the retry. Basis-invariant figures (max drawdown) stay. Nothing persists a basis-dependent figure: save, update and commit bodies carry no figures (pinned in `ScenarioComposer.save.test.tsx`). Neuter RED: `legsPending` forced false fails 13 cases in `added-metrics`; nulling only Sharpe and Sortino in the peer-rank path fails the one-request-after-settle case; removing the F5 conjunct fails 6 cases. |
| SC-5 | No migration expected; if needed, reviewers clean | VERIFIED | `git diff 4c4fa1993..HEAD --stat -- supabase analytics-service scripts` is empty. Nothing needed migration-reviewer or rls-policy-auditor. |
| SC-6 | Each fix has a test that goes RED when reverted | VERIFIED | Independently reproduced for every gate above (see the SC rows). 25 touched test files: 1377 passed. `213-REVIEW.md` is `clean` after three rounds. |

**Score:** 6/6 success criteria verified, 0 behavior-unverified.

## Requirements Coverage

The ROADMAP records `Requirements: TBD`, and SC-1..SC-6 are the contract. There are no requirement IDs and no orphaned requirements.

## Anti-Patterns

No `TBD`, `FIXME` or `XXX` tokens appear in the added lines of `git diff 4c4fa1993..HEAD -- src`. No stubs found: the Disconnect confirm, the feeds helpers, the refusals and the pending holds are all substantive and wired from the page down to the RPC and the engine.

## Accepted Residuals (founder-accepted defaults, not gaps)

- F2: the RPC-internal replay inside `create_wizard_strategy` or `create_wizard_strategy_for_key` carries no `deduped` (it would need a `RETURNS TABLE` change). It is reachable only on an F6 read fault or a concurrent double-submit of one session, and it is a missing notice, not a cross-key mix-up. It is named in code and should be named in the CHANGELOG Notes.
- MT5 composite refusal is a UX fence, not a DB invariant: a direct PostgREST insert into `strategy_keys` is not fenced (CONTEXT "No SQL change"). PROD has 0 MT5 composite members (measured 2026-11-14).
- The unreachable MT5 tripwire in `add-key` is kept deliberately (IN-07, accepted).
- Review LOWs (not booked): the RPC-success contract-violation arm does not set `unansweredAttemptRef`, an impossible state today.

## Human Verification

None required for the verdict. Every SC is behaviorally pinned by tests that fail when reverted. Optional, non-blocking: one real-browser pass on `/strategies` as a manager with an orphaned key (Disconnect dialog, focus landing on the next row or the heading, the polite announcement) and on the composer (pending dash for a drawer-added leg, then one number). jsdom cannot judge visual fit.

## Bookkeeping Notes For The Orchestrator

- The ROADMAP `### Phase 213` section still shows `5/12 plans executed` with plans 06 to 12 unticked, although all 12 SUMMARYs exist. Reconcile at `phase complete`.
- At ship: confirm per id with `grep -aF` that TODOS `164.2.1-INCOMING-NULL-CONFLATION`, `0.08`, the 153.6 MT5 composite OUT line and `0e` are gone, and name them in the CHANGELOG.

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_
