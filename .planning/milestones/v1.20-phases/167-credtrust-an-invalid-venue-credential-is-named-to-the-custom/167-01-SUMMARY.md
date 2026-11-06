---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
plan: 01
subsystem: wizard
tags: [wizard, error-vocabulary, cross-language, mt5, venue-agnostic, census-pins]

# Dependency graph
requires: []
provides:
  - "wire code SIGN_IN_FAILED, emitted from the ONE validate arm where a login was attempted"
  - "WizardErrorCode KEY_SIGN_IN_FAILED, carrying the UI-SPEC copy verbatim and an action set with NEITHER RECOVERABLE_ACTIONS member, so no Retry renders"
  - "a VENUE_WIRE_CODE_TO_VERDICT row, so the minted code routes to its own terminal instead of UNKNOWN"
  - "both wizard rosters admit the new code — KNOWN_CREATE_WITH_KEY_CODES and KNOWN_ADD_KEY_CODES"
  - "STATUS_CONTRACT S-27 and the 3b FLAT wire-body test"
affects: [167-03, 167-04, 167-05]

# Actuals
actuals:
  tasks: 3
  commits: 3
  plan_head_before: 8f23a4f3

status: complete
---

# Phase 167 Plan 01 — SUMMARY

**The wizard now has an honest terminal for a venue sign-in failure: a minted wire code, a minted
`WizardErrorCode` whose copy claims no cause the classifier refused to claim, and no Retry button —
because `buildEnvelope` derives non-recoverability from the action set rather than being told.**

## ⚠️ How this record came to be written by the orchestrator

⛔ **The executor did not write this summary. It was terminated mid-task-3 by a weekly API rate
limit**, after its third commit had landed and while it was re-running the task-3 verification.
Rather than resume a dead agent (this repo's rule is respawn, never resume), the orchestrator:

1. **Inspected the working tree first**, because dying inside a neuter → RED → restore cycle is the
   dangerous case. **The tree was CLEAN** apart from three files belonging to other phases — the
   restore had completed and nothing neutered was left behind.
2. **Re-ran all three task verifications independently** (below). All green.
3. Wrote this record from the three commits and its own measurements.

⭐ **Nothing here is taken from the executor's word.** Every figure below was re-measured at HEAD.

## Task Commits

| task | commit | what |
|---|---|---|
| 1 | `569567ec` | mint `SIGN_IN_FAILED` cross-language — one path, wizard side |
| 2 | `8fd10ea4` | move every census pin the mint reddened — 7 sites, all named |
| 3 | `367f2aad` | `STATUS_CONTRACT` S-27 + the 3b wire-body test |

## Verification — re-run by the orchestrator at HEAD `367f2aad`

| task | command | result |
|---|---|---|
| 1 | `vitest run src/lib/wizardErrors.test.ts src/lib/envelope.test.ts -t "KEY_SIGN_IN_FAILED"` | **5 passed**, discovery confirmed |
| 2 | `vitest run src/lib/` | **201 files, 4216 passed**, 9 skipped |
| 3 | `pytest tests/test_validate_key_venue_transient.py tests/test_envelope_recoverable.py` | **41 passed** |

⛔ Each command asserts non-zero test discovery — `0 collected` is a loud failure here, never a pass.

## ⭐ The pin census: the plan named 5 sites, the RUN found 7

This is the plan/run gap the brief warned about, reproducing exactly. The precedent (164.5.4-02)
recorded that *"the two pins the plan named would have gone green while three other gates stayed
red"*; this plan was written to instruct RUNNING the gate files rather than working from a list,
and that is what surfaced the extra sites.

All values GREPPED at HEAD, never counted, never blanket-incremented:

| site | file | before → after |
|---|---|---|
| copy-table pin 1 | `src/lib/wizardErrors.test.ts` | 94 → **95** |
| copy-table pin 2 | `src/lib/wizardErrors.test.ts` | 94 → **95** |
| roster non-vacuity | `src/lib/dialog-envelope.invariant.test.ts` | 32 → **33** |
| emitter vocabulary | `src/lib/seam-venue-vocabulary.invariant.test.ts` | gained `SIGN_IN_FAILED`, 41 → **42** members |
| derived floor | `src/lib/seam-venue-vocabulary.invariant.test.ts` | 24 → **25** |
| roster A | `ConnectKeyStep.tsx` (`KNOWN_CREATE_WITH_KEY_CODES`) | admits the new code |
| roster B | `MultiKeyConnectStep.tsx` (`KNOWN_ADD_KEY_CODES`) | admits the new code |

⭐ **The floor move is arithmetic, not taste**, and it was checked in both directions: that file's own
rule is `floor(0.6 × N)`, and with 42 members `floor(0.6 × 42) = 25`. At 41 it was 24, which is why
the pin had been correct until this mint.

⛔ **A deliberate NON-edit worth recording:** `dialog-envelope.invariant.test.ts` carries TWO
`expect(checked).toBe(...)` assertions — `5` and `32`. Only the `32` belongs to this roster. The `5`
was left untouched. A blanket increment would have silently broken a calibration that has nothing to
do with this phase, which is the defect class this repo's grep-don't-count rule exists to prevent.

## What the customer now sees

The copy is reproduced verbatim from the checker-approved `167-UI-SPEC.md`. It claims NEITHER
*"The exchange rejected these credentials"* (`KEY_AUTH_FAILED`'s line — the false permanent blame
that 164.5.4 removed) NOR *"a fault on our side of the store"* (`KEY_MUST_BE_RECONNECTED`'s line —
the opposite cause). It says we could not sign in, names a credential that no longer works as one
possible reason, and does not guess between them.

⭐ **No Retry renders, and the absence is DERIVED rather than asserted.** `buildEnvelope` computes
`recoverable` from `actions` against `RECOVERABLE_ACTIONS`; the new entry carries neither member, so
the control simply does not exist. ⛔ No `recoverable: false` was written anywhere.

**Venue-agnostic by construction:** unconditional lines say "credentials" / "this account" / "the
venue". MT5 has a password and no API key; bybit has a key and no password — so the one
venue-specific noun rides a `fixRequires` gate rather than appearing in shared copy.

## Scope discipline

- ⛔ `VERSION` and `CHANGELOG.md` untouched — plan `167-05` owns the single release commit.
- ⛔ No floor lowered, no ceiling raised, no waiver added, no red cleared by widening an allowlist.
- ⛔ The three files belonging to other phases (`.planning/milestone.lock`, `.planning/state.json`,
  `164.5.3-VERIFICATION.md`) were never staged, and the executor's three commits did not sweep in
  the unrelated baseline-dump files that were sitting uncommitted in the shared working tree
  alongside it — verified by name across all three commits.

## Known limits

⚠️ **The task-3 verification the executor was running when it died is green, but the executor's own
final self-check never completed.** The orchestrator's re-run above is the evidence for this plan,
not the executor's unfinished one. Anything the executor might have intended after that point is not
in the record and was not assumed.
