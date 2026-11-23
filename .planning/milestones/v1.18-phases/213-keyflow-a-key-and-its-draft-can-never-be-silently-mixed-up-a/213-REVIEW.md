---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
reviewed: 2026-11-14T17:38:53Z
reviewed_at_sha: ff6c2b05818937c5c37b68d69953fde167e8220f
diff_base: 4c4fa1993
depth: standard
files_reviewed: 43
files_reviewed_list:
  - "src/__tests__/contracts/contracts-registry.test.ts"
  - "src/__tests__/degrade-warning-scan.test.ts"
  - "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx"
  - "src/app/(dashboard)/allocations/components/KpiStrip.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
  - "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx"
  - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.pending.test.tsx"
  - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts"
  - "src/app/(dashboard)/strategies/StrategiesLegend.test.tsx"
  - "src/app/(dashboard)/strategies/StrategiesLegend.tsx"
  - "src/app/(dashboard)/strategies/StrategiesSection.disconnect.test.tsx"
  - "src/app/(dashboard)/strategies/StrategiesSection.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.credential-input.test.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx"
  - "src/app/(dashboard)/strategies/page.key-pill.test.tsx"
  - "src/app/(dashboard)/strategies/page.merged.test.tsx"
  - "src/app/(dashboard)/strategies/page.tsx"
  - "src/app/api/strategies/composite/add-key/route.test.ts"
  - "src/app/api/strategies/composite/add-key/route.ts"
  - "src/app/api/strategies/composite/set-members/route.test.ts"
  - "src/app/api/strategies/composite/set-members/route.ts"
  - "src/app/api/strategies/create-with-key/route.test.ts"
  - "src/app/api/strategies/create-with-key/route.ts"
  - "src/components/exchanges/AllocatorExchangeManager.tsx"
  - "src/components/exchanges/key-feeds-confirm.ts"
  - "src/components/strategy/StrategyTable.default-mounts.test.tsx"
  - "src/components/strategy/StrategyTable.pending-chip.test.tsx"
  - "src/components/strategy/StrategyTable.tsx"
  - "src/lib/queries.my-strategies.test.ts"
  - "src/lib/queries.ts"
  - "src/lib/wizard/derive-resume-overrides-arity.contract.test.ts"
  - "src/lib/wizard/localStorage.test.ts"
  - "src/lib/wizard/localStorage.ts"
  - "src/lib/wizardErrors.invariant.test.ts"
  - "src/lib/wizardErrors.test.ts"
  - "src/lib/wizardErrors.ts"
findings:
  critical: 2
  warning: 1
  info: 7
  total: 10
  necessity: 0
severity_scale:
  sev_critical_count: 0
  sev_high_count: 2
  sev_medium_count: 1
  sev_low_count: 4
  sev_informational_count: 3
status: clean
---

# Phase 213: Code Review Report

**Reviewed:** 2026-11-14T17:38:53Z
**Depth:** standard (with targeted cross-file tracing on the four decision paths)
**Files Reviewed:** 43
**Status:** issues_found

Severity mapping onto the GSD tiers: HIGH maps to `CR-` (critical tier), MEDIUM to `WR-`, LOW and INFO to `IN-`. Each finding carries its five-level `Severity:` line.

## Summary

I reviewed `git diff 4c4fa1993..HEAD` (non-planning) against the ROADMAP `### Phase 213:` contract (decisions (a) to (d), SC-1 to SC-6), `213-CONTEXT.md` (including F1/F2/F3/F5), `213-UI-SPEC.md` and the twelve plan SUMMARYs. Beyond the diff I read the code it depends on: `deriveWizardResumeOverrides` and its one caller, the F6 fence and every `ok: true` arm of create-with-key, the live `disconnect_allocator_api_key` definition (migration 20260422101911, the only migration that CREATEs it, and the same body in `supabase/schema/baseline.sql`: owner check through `auth.uid()`, no role gate, EXECUTE for `authenticated` and `service_role` only), `/api/keys/[id]/memberships` (owner-checked, no role gate, so the manager feeds read works), `Modal`, `factsheet-context` `userRange`, `basis-context` `windowView`/`useWindowedView`, the MultiKeyConnectStep rehydration effect, and `fetchAddedReturns`/`handleRemoveAdded`.

What holds up:
- **SC-1 (decision a).** The F1 decline is exact: API branch, incoming `null`, stored string key, stored draft not the one on screen. On that path nothing else of key A's draft is restored, because `step` and `showResumeBanner` are already gated on `initialDraftId`. The telemetry label can only fire when the session id was actually declined. `deduped: true` is now on every route-owned arm (F6 at the session fence, venue fence, 23505 re-read, reuse), and the F2 RPC-replay residual is named in both places.
- **SC-2 security.** The Disconnect path is owner-scoped in the RPC itself. The client sends only the row's key id, and the row is resolved against the array that rendered it. The set-members `api_keys` read is user-client, with explicit `.in(ids)` and `.eq("user_id")`. A non-owned id yields no row and falls through to the RPC's single ownership answer, so there is no ownership oracle, and the test pins the tenant filter. The widened orphan list matches the venue fence's live-key test (`disconnected_at IS NULL`).
- **SC-3.** The MT5 refusal runs before the flag gate and any write on add-key, and before the RPC on set-members, and both step rosters admit the code. `enterMulti` refuses an MT5 draft.

Two HIGH findings remain. One is the recorded factsheet zoom gap the caller asked me to rate: it breaks SC-4 as written and is reachable with no user action during the probe. The other is new: the F6 `deduped: true` makes the dedup notice state something false on an in-session cross-key resubmit, which is the mix-up this phase exists to remove. One MEDIUM: the Disconnect confirm's Esc-in-flight behaviour, also asked for by the caller. It turns an RPC failure into a silent one and leaves that row's Disconnect dead.

Also checked, no finding:
- The create-with-key "the way out opens" test uses a predicate-respecting fake. Dropping `.is("disconnected_at", null)` would match the disconnected row and red it.
- Placeholder rows render on the table's last page, after the ranked rows, so the new `KEY_ORPHANED` "listed at the end of the list" is true.
- `kSentence` ("N of your keys have no strategy yet") stays true for the widened list.
- `ContributionWizardOverlay`, which manager-only accounts now reach through Finish setup, has no role guard.

Coverage disclosure: I read every source file in full context. For the 20 test files I read the decision-relevant cases (F6 `deduped`, the way-out test, the set-members tenant pin, the Disconnect in-flight case) and otherwise relied on the SUMMARYs' neuter records. I did not run the test suite, and I did not consult DESIGN.md; the visual contract was checked only against UI-SPEC.

Necessity: `necessity-review.md` was read. No finding qualifies. The add-key MT5 gates that the diff marks unreachable are dead code (category 3, IN-07), not necessity.

## Critical Issues

### CR-01: Zoomed factsheet preview derives Sharpe/Sortino/vol on the interim basis while a probe is open (SC-4 breach)

**Severity:** HIGH (user-facing; a phase success criterion fails as written)
**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` : `buildReturnsBody` / `buildScenarioFactsheetPayload` (KNOWN GAP docblock); consumer `src/app/factsheet/[id]/v2/basis-context.tsx` : `useWindowedView` -> `windowView`
**Evidence:**
- The held payload blanks the full-range `strategyMetrics` ratios, but it still carries `periodsPerYear: <interim 365>`.
- `windowView` re-derives `strategyMetrics`, `bootstrapCI` and `quantiles` over the slice with `deriveSeriesBundle(slice, rederiveArgs(view))`, so it annualizes on the interim basis. With `figureRecord: null` the gate is in its "figures show, no note" state, so those numbers render.
- The zoomed range is not a gesture made during the probe. `factsheet-context.tsx` keeps `userRange` in state and uses it while `userRange[1] <= maxIdx`. A pending leg contributes `[]`, so the axis does not shrink. A user who zoomed the preview to 3M/6M/12M earlier and then adds a drawer leg therefore sees the zoomed strip's Sharpe/Sortino/Ann. vol on √365 at once. Those numbers change when the probe answers `traditional` (√252), with no user action.
- That is the `159-BASIS-FLIP` symptom decision (d) closes. It is also inconsistent within the panel: the full-range view shows dashes while the zoomed view shows numbers.
**Why it matters:** SC-4 reads "never shows a number computed on the interim basis". Recording the gap in 213-10-SUMMARY does not satisfy the criterion. A verifier cannot mark SC-4 passed while this stands unless the founder explicitly waives it.
**Suggested minimal fix:** Pick one.
- (a) Disable or hide the preview's period/brush control and reset `userRange` while `basisPending`. 213-10-SUMMARY's Known Gaps already proposes "disabling the preview's period control while `basisPending`", and it touches only `ScenarioFactsheetChart`.
- (b) Carry a csv-only `basisPending` flag on the synth payload. `windowView` would then NaN `ann_vol`/`sharpe`/`sortino` and the bootstrap ratio CIs when the flag is set, mirroring the full-range hold.

Add a test that zooms first, then adds a held-open leg, and asserts the zoomed Sharpe cell is `—`. Neuter the fix and see it go RED (SC-6).

**Fix status:** Fixed in 27a62d5e0 (option b: csv-only `basisPending` on the synth payload, honoured by `windowView`; pinned by a zoom-first test, neutered RED).

### CR-02: F6 `deduped: true` makes a cross-key resubmit in the same session announce "These credentials are already connected" while keeping key A's draft and discarding key B

**Severity:** HIGH (user-facing false statement; a phase-goal gap: "a key and its draft can never be silently mixed up")
**File:** `src/app/api/strategies/create-with-key/route.ts` : POST, F6 session-fence arm (`existingDraft?.id && existingDraft.api_key_id`); `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` : `onTryAnotherKey`, `onReviewKeys`, `handleConnectSuccess`, and the `wizard-dedup-notice` strip
**Evidence:**
1. The F6 fence reads `strategies` by `(user_id, wizard_session_id)` only, before any validate or venue-identity step. It does not compare the submitted credentials with the draft's key. The ROADMAP's own description of decision (a) says so.
2. `onTryAnotherKey`, which is offered on every sync_preview refusal, and `onReviewKeys` both return to `connect_key` and keep `wizardSessionId`. That is deliberate (161-04 keep-and-resume).
3. For a single-key draft, the MultiKeyConnectStep rehydration GET returns no members. The step stays in State A, and `ConnectKeyStep` POSTs the new credentials with the same `wizard_session_id`.
4. F6 hits and returns key A's `strategy_id`/`api_key_id`, now with `deduped: true`. `handleConnectSuccess` sets `dedupedExisting` and the wizard renders "These credentials are already connected. We continued with your existing strategy instead of creating a duplicate."
   - Key B was never validated or stored.
   - The wizard is back on key A, often the key that just failed sync_preview.
   - The sentence is false: the credentials on screen are not connected.
5. The cancelled-wait path ("connecting again picks up that key") has the same shape when the user edits the credentials before resubmitting.
6. The 161-04 comment in `onTryAnotherKey` says "DIFFERENT key ⇒ the normal create path runs". That is false at HEAD, because F6 runs first.

Before Phase 213 this path was a silent cross-key resume. Phase 213 adds a false explanation to it. Neither `213-RESEARCH.md` nor the 213-02 plan considered the back-nav entry. I found no case in `create-with-key/route.test.ts` or `WizardClient.test.tsx` that submits a different key after Try another key in one session; the existing Try-another-key tests pin only the step transition and the telemetry event. Showing the notice on the F6 arm was a CONTEXT "Claude's Discretion" default, already flagged for founder review. This finding is the evidence for that review.
**Why it matters:** The phase goal is that a draft is never resumed onto a different key without the user seeing it. Here the user sees a sentence that says the opposite of what happened, and has no way to connect key B except deleting the draft.
**Suggested minimal fix:** This needs a founder call. SC-1 requires `deduped` on the F6 arm, so the fix sits on the client or in the token handling, not in removing the flag.
- **(1) Honest copy, smallest change.** Leave the route alone. In `handleConnectSuccess`, when `result.deduped` arrives and `result.strategyId` equals the `strategyId` this session already held, show a different strip that names what happened: "We kept the strategy this setup already created, on its original key. To connect different credentials, delete this draft first." Keep the existing sentence for the venue-fence and reuse arms, where it is true. This removes the false statement on every entry, the cancelled-wait edit included. The cross-key resume stays, but the user is now told about it, which is what the phase goal asks for.
- **(2) Root cause: rotate the token on `onTryAnotherKey`** (single-key drafts only; composite back-nav keeps its token for add-key). Then a different key takes the normal create path, which is what the 161-04 comment intended.
  - Precondition: a SAME-key resubmit is resumed only if `resolveByVenueIdentity` resolves it. That needs a non-null `venueAccountId`, which is MT5's login or whatever `validation.venue_account_id` reports for a ccxt venue. It also returns `UNRESOLVED` on a read fault.
  - For a venue that reports no account id, the same key resubmitted under a fresh token mints a second `api_keys` row and a second draft.
  - Option (2) also does not cover the cancelled-wait edit, so it needs (1) or an equivalent beside it.

Whichever option is chosen, add a WizardClient or route test: a draft over key A, then Try another key, then a submit of key B. Assert the new behaviour, then neuter it and see RED (SC-6).

**Fix status:** Fixed in bfcb25d99 (founder option 1, honest copy, client only: `handleConnectSuccess` sets `dedupedKeptDraft` when `deduped` lands on the strategyId this session already held, and the `wizard-dedup-notice` strip then shows "We kept the strategy this setup already created, on its original key. To connect different credentials, delete this draft first."; the stale 161-04 comment in `onTryAnotherKey` carries a dated CORRECTED note; the route is unchanged; pinned by a draft-A / Try another key / key-B test, neutered RED).

## Warnings

### WR-01: Disconnect confirm: Esc during the in-flight RPC closes the dialog for real, so an RPC error is shown nowhere and that row's Disconnect stops opening

**Severity:** MEDIUM (user-facing silent failure; contradicts UI-SPEC 1.4 "Esc and the Modal close button are ignored while the request is in flight")
**File:** `src/app/(dashboard)/strategies/StrategiesSection.tsx` : `DisconnectKeyConfirm` (`close`, `disconnect`) and the `onDisconnect` host handler; `src/components/ui/Modal.tsx` : `Modal`
**Evidence:**
- `Modal` renders a native `<dialog>` and listens to `onClose` only. A browser Esc fires `cancel`, then `close`. Nothing calls `preventDefault()` on `cancel`, so the dialog closes in the DOM. `close()` then returns early because `loading` is true, so React keeps `disconnectTarget` set and `Modal`'s `open` stays `true`.
- If the RPC then succeeds, `onDisconnected` cleans up correctly.
- If it fails (`rpcError`), `setError(...)` renders the `role="alert"` line inside a closed dialog. The user sees no error, no announcement, and the row stays put: a silent failure.
- Clicking the same row's Disconnect again calls `setDisconnectTarget` with the same `id`. The component is keyed `disconnectTarget.id`, so it does not remount, and `Modal`'s effect depends on `[open]`, which is unchanged. `showModal()` is never called again, so the row's Disconnect is dead until another row's Disconnect is clicked or the page reloads.
- 213-06-SUMMARY records the visual close as "carried from the source confirm". On this surface the outcome is worse than cosmetic.
- The jsdom test (`IN-FLIGHT: … Esc and the close button are ignored`) pins only the React state guard. jsdom does not close a `<dialog>` on Esc, so that test cannot fail on the real-browser behaviour (an SC-6 gap for this guard).
**Suggested minimal fix:** Give `Modal` an optional `onCancel?: (e) => void` (or `dismissible?: boolean`) passed to `<dialog onCancel>`. In `DisconnectKeyConfirm`, call `e.preventDefault()` while `loading`. That keeps the dialog open, so the error line is visible and re-clicking is never needed. Add a test that dispatches a `cancel` event on the dialog while in flight and asserts `defaultPrevented`, plus an error-after-Esc case asserting the alert is visible. The existing `AllocatorExchangeManager` confirm can take the same prop later; it is not required here.

**Fix status:** Fixed in caf3830ed (`Modal` `onCancel`, prevented while loading; three pins, each neutered RED).

## Info

### IN-01: The shared feeds read logs under the wrong component tag

**Severity:** LOW
**File:** `src/components/exchanges/key-feeds-confirm.ts` : `readKeyFeedsForConfirm`
**Issue:** The `console.error` prefix is hard-coded `[AllocatorExchangeManager]`, but the function is now also called from the `/strategies` Disconnect confirm. A failure there reads in Sentry breadcrumbs as the Profile page.
**Fix:** Use a neutral tag (`[key-feeds-confirm]`) or take a caller tag argument.

### IN-02: Post-Disconnect focus and announcement can misfire on duplicate labels

**Severity:** LOW
**File:** `src/app/(dashboard)/strategies/StrategiesSection.tsx` : the `focusRequest` effect and `onDisconnected`
**Issue:**
- Focus is resolved by matching `aria-label` text in the whole document. Two keys with the same exchange and label (legal: no uniqueness on `label`) make `find` return the first match, which can be the row being removed. Focus then drops to `<body>` after `router.refresh()`.
- Two successive Disconnects of identically-labelled keys set the same `announcement` string, which `LiveRegion` may not re-announce.
**Fix:** Focus by key id (`data-key-id`), and make the announcement unique per event (for example, clear it before setting).

### IN-03: The pending hold has no bound, so a hung `/returns` probe holds every basis figure indefinitely

**Severity:** LOW
**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` : `fetchAddedReturns`, `legsPending`
**Issue:** CONTEXT (d) relies on "pending is therefore always terminal". The probe `fetch` has no timeout, so a stalled response keeps `legsPending` true until the browser's own network timeout. The "loading returns…" affordance does tell the user something is outstanding, so this is not silent.
**Fix:** Bound the probe (an `AbortSignal.timeout`, then route to `markMetricsUnavailable`) so the "always terminal" premise holds by construction.

### IN-04: `gatedBlendMetrics` holds CAGR, though CONTEXT says basis-invariant figures are not held

**Severity:** LOW
**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` : `gatedBlendMetrics`
**Issue:** `cagr` is nulled while `legsPending`, but CONTEXT (d) says "Basis-invariant figures (for example CAGR on the calendar clock) are not held". The strip paints no CAGR today, so nothing visible is wrong, but the object now disagrees with the decision text for any future consumer. (The factsheet builder's two-basis CAGR rule is the considered one.)
**Fix:** Apply the builder's two-basis gate rule here, or leave `cagr` ungated by `legsPending`, and state which in the comment.

### IN-05: A legacy MT5 composite member still rehydrates into a member panel

**Severity:** INFO
**File:** `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` : the rehydration effect, `KeyPanel`
**Issue:** With the MT5 roster card gone, a rehydrated MT5 member gets `requiresPassphrase` false and generic labels. The summary-name fallback covers only the name. PROD has 0 MT5 composite members (CONTEXT, measured 2026-11-14), and set-members refuses on Continue, so this is unreachable today.
**Fix:** None needed now. If the count ever moves, render a refusal on that panel rather than an editable one.

### IN-06: The add-key MT5 refusal runs before the rate limiter

**Severity:** INFO
**File:** `src/app/api/strategies/composite/add-key/route.ts` : POST, `if (isMt5)`
**Issue:** The refusal returns before any limiter token is taken. It does no write and no external call, so the exposure is cheap unthrottled 400s for an authenticated user. This is noted only because the ordering comment says it also precedes "every rate-limit token".
**Fix:** None required.

### IN-07: Unreachable MT5 gate and three-credential guard kept as a "tripwire"

**Severity:** INFO (category 3, dead code; not necessity)
**File:** `src/app/api/strategies/composite/add-key/route.ts` : the `MT5_ENABLED` gate and the MT5 three-credential guard after the new refusal
**Issue:** Every `isMt5` request now returns earlier, so both blocks cannot run. They are kept on purpose and labelled unreachable.
**Fix:** Acceptable as written. Delete them if the stitch job never gains an MT5 arm.

---

_Reviewed: 2026-11-14T17:38:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunt (pr-review-toolkit:silent-failure-hunter, same diff)

### SFH-M1: Disconnect confirm drops the RPC error unlogged, and a thrown rejection leaves `loading` stuck

**Severity:** MEDIUM (user-facing silent failure)
**File:** `src/app/(dashboard)/strategies/StrategiesSection.tsx` : `DisconnectKeyConfirm.disconnect`
**Issue:** `rpcError` sets the user-facing line but is never logged or captured, so a failing Disconnect leaves no trace for operators. A rejected promise (network fault) is not caught, so `loading` never resets and the confirm stays locked.
**Fix:** Log and capture `rpcError` with the repo's client-side capture, and wrap the call in try/catch/finally that resets `loading` and shows the same error line. Fixed in the fixer round together with WR-01.

**Fix status:** Fixed in caf3830ed (logged and captured via `captureToSentry`; try/catch/finally resets `loading`).

### SFH-M2: A read fault on the stored key declines the session id the same way an unknown key does

**Disposition:** Rejected, by design. ROADMAP founder decision (a), "refuse when unknown", explicitly covers this case: an incoming key the client cannot identify never resumes a stored-key draft. A distinct telemetry reason would be LOW and is not booked.

### SFH-L1..L7

LOW/INFO observations (telemetry granularity, comment wording, defensive branches). Recorded here only; never fixed or booked, per the repo's review rule.

## Re-review (round 2)

**Reviewed:** 2026-11-14 at `5f55c5fa0` (fix commits 27a62d5e0, caf3830ed, bfcb25d99; `git diff 8fccc2fca..HEAD -- src`)
**Reviewer:** Claude (gsd-code-reviewer)
**Inputs:** the round-1 sections above, the ROADMAP `### Phase 213:` section, and 213-CONTEXT.md "Founder answers to the hand-back (2026-11-14, via the coordinator)".
**Method:** I read every changed source and test hunk, and traced `strategyId` and `wizardSessionId` through `WizardClient`, the Stop-waiting path in `ConnectKeyStep`, the `onSuccess` callers in `ConnectKeyStep` and `MultiKeyConnectStep`, `windowView` / `rederiveArgs` / `leverageEligibleFor`, the scenario builder's slot map and comparator blocks, and `Modal`. The three touched test files pass at HEAD (3 files, 68 tests). I checked by inspection, not by neutering, that each pin can fail. `src` was not modified.

### Verdict per finding

| id | verdict | evidence |
|---|---|---|
| CR-01 | **Closed** | The builder emits `basisPending: true` only when held and non-degenerate. `windowView` NaNs `ann_vol`, `sharpe` and `sortino` and empties the bootstrap Sharpe and Sortino intervals when `ingestSource === "csv" && basisPending === true`. That is the same set the builder's slot map measured as basis-dependent under geometric conventions; the builder never passes arithmetic. Comparators: `spx` and `none` are `inertComparatorBlock`s, so `keepBase` returns the base block. `btc` carries only `cumulative`, so its summary and joint are null and `keepBase` applies too. Leverage: the control is gated `!scenarioMode && leverageEligible` (`FactsheetView.tsx`, `leverageGroupRenders`), so no levered full-range re-derive happens in the preview. Public factsheet: the flag's only writer is `buildScenarioFactsheetPayload`, whose one caller is `ScenarioFactsheetChart`. Server payloads never carry it, and `held` also requires the csv arm. NaN forms: the test asserts the dash on all five slots and `not.toContain("NaN")` in the zoomed DOM. Can it fail? Yes: drop `held` from `windowView`, or the spread from the builder, and the zoomed Sharpe cell shows a number. |
| CR-02 | **Closed as the founder specified, with one residual entry (WR-02 below)** | `handleConnectSuccess` sets `dedupedKeptDraft` from `deduped === true && strategyId != null && result.strategyId === strategyId`. That is the founder's literal condition ("the same `strategyId` this wizard session already held"). The closure reads the pre-update `strategyId`, and the dep is added. The strip's copy matches CONTEXT verbatim. The route is unchanged. Resume and reload: `strategyId` is initialised from `initialDraft?.id` (`useState` initialiser), so a resumed session that hits F6 is still compared correctly. The only `onSuccess` path that forwards `deduped` is the `ConnectKeyStep` credential arm. The preselect reuse arm and `MultiKeyConnectStep` Continue never forward it, so no composite back-nav can show the new strip falsely. `handleConnectSuccess` is a dependency only of `useCallback`s, never of a `useEffect`, so the new `strategyId` dep cannot re-fire anything. Can it fail? Yes: the founder-required draft-A, Try another key, key-B test asserts the new copy and the absence of the old one, and the second case pins the old copy for a strategy the session did not hold. |
| WR-01 | **Closed (handler level)** | `Modal` passes an optional `onCancel` to `<dialog onCancel>`. Other callers pass nothing, so React attaches no handler and their behaviour is unchanged. `DisconnectKeyConfirm` prevents `cancel` while `loading`. Can it fail? Yes: `ESC-CANCEL-PREVENTED` checks `defaultPrevented`, and `ERROR-AFTER-ESC` fails through `dialog()` throwing on a closed dialog if `cancel` is not prevented. Limit: `pressEscape` encodes the assumed browser sequence, so the pins prove the handler, not a real browser (see the LOW line below). |
| SFH-M1 | **Closed** | `try/catch/finally` resets `loading` on a rejection. A returned error and a thrown one both go through `report`, which logs and calls `captureToSentry` with tags only, so no key id is sent. The signature matches `sentry-capture.ts`. Can it fail? Yes: without the `catch`, the `REJECTION` pin sees a stuck `loading`; without `report`, both capture pins fail. |

### New findings (round 2)

#### WR-02: The cancelled-wait entry still shows "These credentials are already connected" for credentials that were never validated

**Severity:** MEDIUM (user-facing false statement; the residual of CR-02)
**File:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` : `handleConnectSuccess` (`setDedupedKeptDraft` condition); `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` : `handleStopWaiting`, the deadline abort, and the credential-arm `onSuccess`
**Evidence:**
1. The first submit of a fresh session is aborted by **Stop waiting** or by the client deadline. The route does not read `request.signal` (the step's own docblock above `handleStopWaiting` says so), so the draft and key A are written server-side.
2. The client never receives a `strategy_id`. The only `setStrategyId` calls are `handleConnectSuccess` and the two delete paths, which set it to null. `wizardSessionId` does not rotate either: its only setters are the hydration override, the two CSV re-mints and the two delete paths.
3. The cancelled copy invites a retry ("Your key details are still on this page … connecting again picks up that key"). A user who edits the credentials and submits again hits F6, which answers `deduped: true` with key A's ids without validating the new credentials.
4. `strategyId` is null, so `dedupedKeptDraft` is false and the strip reads "These credentials are already connected. We continued with your existing strategy…". The new credentials are neither validated nor stored, so that sentence is false.
5. Round 1 put this entry in scope for option (1): "This removes the false statement on every entry, the cancelled-wait edit included". The founder's literal condition, "the same `strategyId` this wizard session already held", does not reach it, because this session never held one.

**Suggested minimal fix (client only, inside the founder's option):** In `ConnectKeyStep`, set a ref when an attempt ends unanswered (user abort or deadline). On the credential arm's success, forward `heldSession: true` alongside `deduped` when that ref is set. In `handleConnectSuccess`, change the condition to `deduped === true && ((strategyId != null && result.strategyId === strategyId) || result.heldSession === true)`.

Resubmitting the SAME credentials after Stop waiting then shows the "kept … on its original key" copy, which is still true. Add a test: Stop waiting, edit, resubmit answered `deduped: true`; assert the kept copy; neuter and see RED.

Because the founder's wording is literal, the coordinator may instead take this back to the founder rather than to a fixer. Either way, it is open.

**Fix status:** Fixed in 8f9f90734 (founder option 1 covers every entry point, client only: `ConnectKeyStep` records an attempt that ended unanswered, user abort or deadline, and forwards `heldSession` on the next deduped credential success; `handleConnectSuccess` shows the kept-draft sentence when `deduped` lands on the held strategy or `heldSession` is set; the route is unchanged; pinned in `ConnectKeyStep.test.tsx` for both abort arms plus a no-prior-abort fence, and in `WizardClient.test.tsx` for a session that never held a strategy, each half neutered RED).

### LOW (one line each, not booked)

- LOW (unverified): Chrome's close-watcher anti-abuse rule makes `cancel` non-cancelable on a second Esc that has no user activation in between. A double Esc during the request may therefore still close the dialog and reproduce WR-01. Check it in a real Chrome with the RPC throttled.
- LOW: while pending, `windowView` does not apply the builder's CAGR/Calmar two-basis gate rule. On a record the two clocks disagree on (for example 70 days), the zoomed CAGR shows and the full-range CAGR is dashed. The value is basis-invariant, so SC-4's "no interim-basis number" still holds.

### Round-2 status

One open MEDIUM (WR-02). `status: issues_found`.

_Re-reviewed: 2026-11-14_
_Reviewer: Claude (gsd-code-reviewer)_

## Silent-failure re-check (round 3, fix range 8fccc2fca..HEAD)

### R3-M1: `heldSession` is set only on the two abort arms, so a lost response (SERVICE_UNREACHABLE) still leads to the false "already connected" strip

**Severity:** MEDIUM (user-facing). **File:** `ConnectKeyStep.tsx` : `handleSubmit` catch. The non-abort arm also ends with no answer while the route may have written key A and its draft. **Fix:** mark `unansweredAttemptRef` on every catch arm, and pin a network-error-then-deduped case.

**Fix status:** Fixed in c1f54975b (`ConnectKeyStep.handleSubmit` now sets `unansweredAttemptRef` on the non-abort `SERVICE_UNREACHABLE` arm too; an HTTP error the server answered still does not set it; pinned by a network-error-then-deduped case and an answered-error fence, neutered RED).

### R3-M2: on the `heldSession`-only arm, "kept the strategy this setup already created, on its original key" is a guess

**Severity:** MEDIUM (user-facing). **File:** `WizardClient.tsx` : `handleConnectSuccess`. When the first attempt wrote nothing (rejected, or the abort came before the write), a later dedup can come from an earlier setup's strategy, so the specific sentence would be false. **Fix:** keep the founder's sentence for the same-`strategyId` match. The heldSession-only arm gets neutral copy that is true in both cases (copy wording is Claude's Discretion in CONTEXT).

**Fix status:** Fixed in c1f54975b (`WizardClient` keeps the founder's sentence only for the same-`strategyId` match; the `heldSession`-only arm shows "We continued with a strategy that already exists for these credentials or this setup instead of creating a duplicate. To connect different credentials, delete that draft first."; the WR-02 WizardClient pin is updated in place with the supersession stated; neutered RED).

LOW (not booked): raw `rpcError` in `console.error`; the success path briefly re-enables the button before close; no other `periodsPerYear` consumer outside `basis-context.tsx`.

## Re-review (round 3)

**Reviewed:** 2026-11-14 at `3730a3f18` (fix commits 8f9f90734 for WR-02, c1f54975b for R3-M1 and R3-M2; `git diff df608806f..HEAD -- src`)
**Reviewer:** Claude (gsd-code-reviewer)
**Inputs:** the sections above, 213-CONTEXT.md "Founder answers to the hand-back" (CR-02 option (1), honest copy, client only; the founder's sentence applies when the dedup returns the strategy this session already held) and "Claude's Discretion".
**Method:** I read every changed hunk in `WizardClient.tsx`, `ConnectKeyStep.tsx` and their tests. I traced every setter of `dedupedExisting`, `dedupedKeptDraft`, `dedupedHeldOnly` and `unansweredAttemptRef`, every `deduped: true` arm of `create-with-key/route.ts`, the client's non-OK handling (`readCreateWithKeyBody` records a parse failure and does not throw), the client deadline against the route's `maxDuration = 300`, when `wizardSessionId` is persisted, and whether `ConnectKeyStep` can remount inside one session (`MultiKeyConnectStep` has no `setMode("single")`). Both touched test files pass at HEAD (2 files, 129 tests). I checked by inspection, not by neutering, that each pin can fail. `src` was not modified.

### Verdict per finding

| id | verdict | evidence |
|---|---|---|
| WR-02 | **Closed** | `unansweredAttemptRef` is set on both abort arms of the `handleSubmit` catch. The credential-arm success forwards `heldSession: true` only together with `data.deduped === true`. `handleConnectSuccess` computes `sameStrategy` first, and `dedupedHeldOnly` requires `!sameStrategy && heldSession === true`, so the two flags cannot both be true. A Stop-waiting or deadline session that never held a `strategyId` no longer reaches "These credentials are already connected". The route is unchanged, so this stays inside the founder's "client only". Pins: the user-abort and deadline cases assert `{ deduped: true, heldSession: true }`, and the no-prior-abort fence asserts the property is absent. |
| R3-M1 | **Closed** | The non-abort catch arm (`SERVICE_UNREACHABLE`, a lost response) now sets the same ref. An HTTP error the server answered goes through the `!res.ok` branch, which does not set it. That is correct, because the route's answered errors come before the write or from a failed RPC, apart from one impossible-state arm (LOW below). Pins: network-error-then-deduped asserts `heldSession`, and the answered-error fence asserts `not.toHaveProperty("heldSession")`. |
| R3-M2 | **Closed** | The founder's sentence shows only when `sameStrategy` is true, which is the founder's literal condition. The `heldSession`-only arm shows "We continued with a strategy that already exists for these credentials or this setup instead of creating a duplicate. To connect different credentials, delete that draft first." That is true on both route arms that can answer it: F6 (this setup's draft, written by the unanswered attempt) and the venue fence's own-draft arm (an earlier setup's draft for these credentials). "That draft" is accurate because every route arm that sets `deduped: true` returns an existing draft. Connected strategies come back as `VENUE_ALREADY_CONNECTED`, which is an error, not a dedup. Wording is Claude's Discretion under CONTEXT. Pins: the WizardClient case for a session that never held a strategy, and the case for a held strategy that differs from the deduped one, both assert the neutral copy and the absence of the other two. |

### Every dedup entry into `wizard-dedup-notice`, and the sentence it now shows

| entry | client state | sentence | true? |
|---|---|---|---|
| Draft A held, Try another key or Review keys, submit key B (F6) | `strategyId` = returned id | founder's "kept … on its original key" | Yes (CR-02) |
| As above, after a submit was aborted or lost (F6) | `sameStrategy` wins over `heldSession` | founder's sentence | Yes |
| Fresh session; first submit aborted, past the deadline, or lost; then any resubmit (F6, or the venue fence onto an earlier draft) | `strategyId` null, `heldSession` | neutral | Yes, for either arm |
| Fresh session; first submit answered `deduped` by the venue fence or the 23505 re-read | `strategyId` null, no `heldSession` | "These credentials are already connected" | Yes: only the venue identity of THESE credentials can reach those arms, because F6 misses when the session has no row |
| Reload after an unanswered first submit | `wizardSessionId` is not persisted before the first success (API branch), so a fresh token is minted | F6 cannot hit | n/a |
| Preselect reuse arm; `MultiKeyConnectStep` Continue | `deduped` is not forwarded (round 2) | no notice | n/a |

Remount check: the ref lives per `ConnectKeyStep` mount. Inside one session that mount ends only on a success, which sets `strategyId`, so the id comparison takes over from there. There is no multi→single path that would remount it with the ref cleared.

### New findings (round 3)

None at MEDIUM or above.

### LOW (one line each, not booked)

- LOW: the RPC-success contract-violation arm (`!row?.strategy_id || !row?.api_key_id`, an answered 500 after the write may have committed) does not set `unansweredAttemptRef`, so a different-key resubmit would get "already connected". It needs `create_wizard_strategy` to report success with an unusable body, which is an impossible state today.
- LOW: the ref is never cleared. A same-mount abort followed by an answered error followed by a deduped success still forwards `heldSession`, and the neutral copy is true then as well.

### Round-3 status

WR-02, R3-M1 and R3-M2 are closed. Every dedup entry shows a sentence that is true for its case. No MEDIUM+ remains open. `status: clean`.

_Re-reviewed: 2026-11-14_
_Reviewer: Claude (gsd-code-reviewer)_
