# Phase 94 — Deferred Items

Items surfaced during the Phase-94 review cycle (verifier + WIZ-01 security +
silent-failure-hunter + fable red team) that are intentionally NOT fixed in
Phase 94 and are carried forward.

## D-1 — Delete-draft while ON connect_key (State B) leaves stale panels → 403 on Continue
**Severity:** LOW · **Source:** fable red team (RT-Finding 4) · **Status:** deferred (pre-existing, orthogonal)

`WizardClient.handleDeleteDraft` resets parent wizard state but leaves `step`
at `connect_key`, so `MultiKeyConnectStep` never remounts — its local
`panels`/`strategyId` (and now the Phase-94.1 `committedSig`/dirty state) still
reference the just-deleted strategy. The rehydration effect bails on a null
`draftStrategyId` without resetting those. A subsequent Continue then POSTs
`set-members` for the deleted strategy → 403.

**Why deferred:** this predates Phase 94.1 (it is Phase-88 delete-draft
behavior), and the trigger — deleting the draft from *inside* connect_key State B
— is off the resumability paths Phase 94 hardened. The new dirty/committed-set
state introduced in 94.1 merely *rides along* the same stale mount; it does not
create the bug and reports clean against a deleted committed set.

**Fix direction (when picked up):** on `handleDeleteDraft`, either force a
remount of `MultiKeyConnectStep` (key it on `strategyId`) or route the step back
to a clean `connect_key` initial state so its local panels/refs are rebuilt.
Belongs with a broader connect_key lifecycle pass, not the 94.1 hardening scope.
