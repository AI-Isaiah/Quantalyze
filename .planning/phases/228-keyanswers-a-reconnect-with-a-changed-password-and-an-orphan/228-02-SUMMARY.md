---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
plan: 02
subsystem: wizard connect step / copy
tags: [CONN-02, CONN-04, wizard, copy-honesty]
requirements: [CONN-02, CONN-04]
status: complete
key-files:
  created:
    - src/lib/key-secret-outcome.ts
    - src/lib/key-secret-outcome.test.ts
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
commits: 3
plan_head_before: 078f1147b1c3b834a88254c630cce50423e49938
plan_head_after: f4538b980b0644807a4c060264eca27ae398755b
actuals:
  tasks: 3
  commits: 3
---

# Phase 228 Plan 02: the connect step shows the password outcome, the F6 strip stops over-claiming, KEY_ORPHANED names the key

## What shipped

- **`src/lib/key-secret-outcome.ts`** (client-safe, imports nothing at runtime): `KeySecretOutcome`, `keySecretField` (server fragment, `{}` when absent, blank name omitted), `parseKeySecretOutcome` (closed-set shape check), and `keySecretNoticeText`, the only builder of the four UI-SPEC section 1.3 sentences (the probe-then-compare "and it signs in" variant). Wire contract: `key_secret: { outcome: "updated" | "unchanged"; name?: string }` on the create-with-key 409 body. No new wizard code, so the rosters and `EXPECTED_TABLE_SIZE` did not move. Plan 03 imports this module.
- **`ConnectKeyStep`**: `keyOutcome` state set from the same response as `errorCode` (credential arm only), cleared by `handleSubmit`, the reuse submit, and the envelope's Retry (three `setKeyOutcome(null)` sites). One role-less `<p data-testid="wizard-key-outcome-notice" data-outcome>` is the immediate previous sibling of the envelope, positive or neutral recipe per UI-SPEC section 1.4. A polite `LiveRegion` is mounted unconditionally in the credential render, `message` null when there is no notice, otherwise the same sentence from the same builder.
- **`wizardErrors.ts`**: today's third `KEY_ORPHANED` fix sentence is held once as `KEY_ORPHANED_DISCONNECT_FIX`; the holder arm swaps it, by content, for the named sentence when `holder.name.trim().length > 0`. No holder, strategy holder (never enters the arm) or blank name leaves the fix list byte-identical.
- **`WizardClient`**: only the third arm of the dedup strip changed, to `We continued with the strategy this setup already created, on the key it was first connected with. The details you just entered did not change that key. To connect different credentials, delete this draft first.` The `dedupedKeptDraft` and `dedupedHeldOnly` sentences are byte-identical. The docblocks that quoted the retired sentence (WizardClient state docblock, ConnectKeyStep `handleContinueWithKey` docblock) now describe it in words.

## F6 wording narrowing (UI-SPEC A2), restated

CONTEXT suggested "were not checked or saved". The shipped sentence says "did not change that key" instead, because the post-validation same-session arm reaches the same strip after `validateKey` ran, so "checked" would be false there, and "not saved" is false for a resend of credentials the first request stored. CONTEXT's requirement, never claim the submitted credentials are connected, is met in full. Surfaced here, not blended (CLAUDE.md Rule 7).

## Verification

- vitest (plan verify sets, one run): `Test Files 10 passed (10)`, `Tests 672 passed (672)` over `key-secret-outcome.test.ts`, `ConnectKeyStep*`, `WizardClient.test.tsx`, `wizardErrors.test.ts`, `wizardErrors.invariant.test.ts`, `wizardKeyRosters.test.ts`, `seam-citations.invariant.test.ts`. `src/__tests__/contracts/contracts-registry.test.ts`: 67 passed (new test file did not need registering).
- `npx tsc --noEmit`: clean (no output).
- eslint on all eight touched files: clean (no output).
- Acceptance greps: `parseKeySecretOutcome` and `keySecretNoticeText` exports 1 each; `wizard-key-outcome-notice` testid 1; `<LiveRegion` 1; `setKeyOutcome(null)` 3; `KEY_ORPHANED_DISCONNECT_FIX` 3; `on the row for your key` 1; `choose “Disconnect” on that row` 1; retired sentence 0 in both `WizardClient.tsx` and `ConnectKeyStep.tsx`; `did not change that key` 1.

## PROOF-01 neuters (byte copy to the scratchpad, neuter, RED, cp back, cmp, GREEN; never git checkout/restore/stash)

Task 1 (a) drop `name` in `parseKeySecretOutcome`; (b) delete `setKeyOutcome(null)` from `handleSubmit`; (c) mount the LiveRegion only when `keyOutcome` is set.

```
### (a) RED
     × keeps a closed-set outcome and trims a string name 7ms
     × updated + named: the founder's sentence, positive recipe, no role, BEFORE the envelope 30ms
     × unchanged: the neutral recipe and the unchanged sentence 22ms
     × a non-ASCII nickname renders verbatim as text, never as markup 22ms
     × LiveRegion: a polite region is mounted EMPTY before any submit and carries the exact sentence after 14ms
     × G1: neither the notice, its attributes nor the LiveRegion carries a login, server or key id 11ms
cmp: identical (exit 0)
### (b) RED
     × lifecycle: a second submit removes the notice while it is in flight 15ms
      Tests  1 failed | 124 passed (125)
cmp: identical (exit 0)
### (c) RED
     × LiveRegion: a polite region is mounted EMPTY before any submit and carries the exact sentence after 40ms
      Tests  1 failed | 124 passed (125)
cmp: identical (exit 0)
### GREEN
 Test Files  2 passed (2)
      Tests  125 passed (125)
```

Task 2 (a) remove the `fix` map from the holder arm; (b) drop the `trim().length > 0` guard.

```
### (a) RED
     × a key holder with a name: the named bullet, in the SAME position, other bullets untouched 11ms
     × a non-ASCII nickname appears verbatim inside the curly quotes 1ms
     × [228-02 / CONN-04] KEY_ORPHANED's Disconnect bullet names the key when the holder is a key 14ms
      Tests  3 failed | 452 passed (455)
cmp: identical (exit 0)
### (b) RED
     × a key holder whose name is blank: today's bullet, never empty curly quotes 11ms
      Tests  1 failed | 454 passed (455)
cmp: identical (exit 0)
### GREEN
 Test Files  4 passed (4)
      Tests  530 passed (530)
```

Task 3: restore the retired sentence in the third arm of `WizardClient.tsx`.

```
### neuter: restore the retired sentence in the third arm
     × renders the neutral strip after a connect the server resolved onto the existing strategy 14ms
     × a deduped result for a strategy this session did NOT hold renders the corrected fallback, never the retired sentence 16ms
      Tests  2 failed | 40 passed (42)
cmp: identical (exit 0)
### GREEN
 Test Files  3 passed (3)
      Tests  205 passed (205)
```

## Deviations from Plan

None in code. Two notes for the reviewer:

1. **The 213 test that was titled "keeps the old sentence" was rewritten.** `WizardClient.test.tsx` carried an assertion that the fallback arm renders `OLD_COPY`. It now asserts the corrected `FALLBACK_COPY` and that `OLD_COPY` is absent; `OLD_COPY` stays as the absence pin the plan asked to keep. The absence assertions ("already connected", "checked", "not saved") are on the 154-06 test, as the plan specified.
2. **Left alone, out of the plan's file list:** a comment in `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx` (line ~339) still quotes the retired sentence. It is a comment about a strip that must not render, not an assertion on the string, so no test depends on it.

Test Contract item 8 (allocator and manager roles get the identical named Disconnect bullet) is a property of the route, which has no role branch, and is pinned on the route arm in Plan 03, not here. This plan pins that the bullet is a pure function of the holder.

## Manual backstop for the verifier (not run here)

The 320 px row of `e2e/reflow-sweep-authed.spec.ts` with the notice and the envelope both rendered, and axe at zero violations on `/strategies/new/wizard`. The notice carries `break-words` and no fixed width; the screen-reader order (refusal, then the polite outcome) is by the LiveRegion's polite queueing behind the envelope's `role="alert"`.

## Known Stubs

None.

## Threat Flags

None. The wire field carries only the outcome and the caller's own nickname; a G1 test feeds a login, server and key id both on the body and nested inside `key_secret` and asserts none reaches the notice, its attributes or the LiveRegion.

## Self-Check: PASSED

- FOUND: `src/lib/key-secret-outcome.ts`, `src/lib/key-secret-outcome.test.ts`
- FOUND commits `da4439353`, `e33f4a534`, `f4538b980` (`git merge-base --is-ancestor` against HEAD)
