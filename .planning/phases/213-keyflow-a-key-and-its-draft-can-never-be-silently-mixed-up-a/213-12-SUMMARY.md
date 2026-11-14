---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 12
subsystem: ui
tags: [wizard, multi-key, mt5, decision-c, sc-3, sc-6, vitest]

requires:
  - phase: 213-03
    provides: "COMPOSITE_MT5_UNSUPPORTED server refusal on both composite routes"
  - phase: 213-08
    provides: "six venue-independent long-wait cases re-seated onto ccxt panels"
provides:
  - "Multi-key EXCHANGES roster with no MT5 card, whatever MT5_UI_ENABLED says"
  - "multi-add-key-mt5-note footer note replacing the add-key button while the single-key form is on MT5"
  - "enterMulti early return on an MT5 draft (closes the 153.4 CR-03 carry-over)"
  - "venueLabel name fallback for a rehydrated legacy MT5 member panel"
affects: []

tech-stack:
  added: []
  patterns:
    - "Stale-handler test: read the button's onClick from its __reactProps$ key before the UI hides it, then call it, to prove a guard the UI makes unreachable"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.credential-input.test.tsx"

key-decisions:
  - "The note state is a single useState<ExchangeId | null> set from onSingleDraftChange next to the existing ref and dirty flag; ConnectKeyStep's mount-time effect reports the initial or restored exchange, so no extra wiring was needed."
  - "MT5_UI_ENABLED import dropped from the component: the roster spread was its only reader."
  - "One extra case added (the stale-handler pin) so the enterMulti early return can fail on its own: neuter (i) and (ii) both go RED through the button alone."

requirements-completed: [SC-3, SC-6]

duration: 35 min
completed: 2026-11-14
status: complete

actuals:
  tokens: 12000
  tasks: 2
  commits: 2
commits: 2
plan_head_before: 65db54f4ea3fcc7faf1ff0269c5593ed531b8aa7
plan_head_after: 98a7d538b217901bf08d10b244857a3bad3ed2e4

coverage:
  - deliverable: "No MT5 card in the multi-key roster, flag on or off; class guard names MT5 as its one exception"
    verification:
      - kind: test
        ref: "MultiKeyConnectStep.test.tsx#[213 (c) supersedes] the panel renders the third field ... no member panel's exchange grid offers an MT5 card"
        status: pass
      - kind: test
        ref: "MultiKeyConnectStep.test.tsx#THE CLASS GUARD ... MT5 is the one named exception"
        status: pass
    human_judgment: false
  - deliverable: "Footer note replaces the add-key button while MT5 is selected; the button returns on another venue; enterMulti refuses an MT5 draft"
    verification:
      - kind: test
        ref: "MultiKeyConnectStep.test.tsx#[213 (c) supersedes] the add-key POST ... the note renders, and no add-key POST can be made"
        status: pass
      - kind: test
        ref: "MultiKeyConnectStep.test.tsx#[213 (c)] a STALE '+ Add another key window' handler cannot carry an MT5 draft into a member panel"
        status: pass
      - kind: test
        ref: "MultiKeyConnectStep.test.tsx#[213 (c) supersedes] mixed venues ... leaving MT5 on the single-key form restores the add-key button"
        status: pass
    human_judgment: true
    rationale: "The note copy is UI-SPEC 3.2 as written (Claude's discretion, flagged for founder review item 4); whether a note reads better than a hidden button is a judgment."
  - deliverable: "A rehydrated legacy MT5 member panel shows a venue name and its Remove control"
    verification:
      - kind: test
        ref: "MultiKeyConnectStep.test.tsx#[213 (c) supersedes] the MT5 card is selected, named ... a rehydrated legacy MT5 member shows its venue name and a Remove control"
        status: pass
    human_judgment: false
---

# Phase 213 Plan 12: MT5 cannot be a composite member, UI half Summary

The multi-key roster no longer offers MT5, the single-key footer swaps "+ Add another key window" for the exact UI-SPEC 3.2 note while MT5 is selected, `enterMulti` refuses an MT5 draft, and a rehydrated legacy MT5 member panel is named by `venueLabel`; every MT5-premised test is re-seated, converted in place, or (two D-08 paste cases) deleted with the single-key equivalents named.

## What changed

- `MultiKeyConnectStep.tsx`: MT5 roster spread deleted and its CR-03 comment replaced by a dated `SUPERSEDED 2026-11-14 (Phase 213 decision (c))` note; the roster-parity docblock names MT5 as the one exception; `singleDraftExchange` state set from `onSingleDraftChange`; the `footerSlot` renders `multi-add-key-mt5-note` (exact sentence) while it is `"mt5"`, else the button; `enterMulti` returns before any panel or mode change on an MT5 draft; the validated-panel summary reads `active?.name ?? venueLabel(p.exchange)`; the unused `MT5_UI_ENABLED` import is dropped.
- `MultiKeyConnectStep.test.tsx` (88 to 89 `it(` declarations): three CR-03 cases converted in place, class guard updated, three serialized-specific WIZFORM-05 cases converted, one stale-handler case added; `mt5Panel`, `mixedVenuePanels` removed, `enterMultiFromMt5Draft` kept as `fillMt5SingleKeyDraft` (no longer clicks add-key), `WAIT_PROMISE_120` removed (its only user was a converted case). The plan 08 comment block now states both the re-seats and the conversions (Task 2, comment lines only).
- `MultiKeyConnectStep.credential-input.test.tsx` (12 to 10 `it(` declarations): Broker server case converted in place; two D-08 cases deleted; `renderPanel1OnMt5` removed.

## Task commits

1. Task 1 (tracer): `b588b32c5` feat
2. Task 2: `98a7d538b` test (comment lines only: every added line trimmed starts with `//`, every removed line was a comment)

Tracer gate (end-of-phase, automated-only verify): the Task 1 verify command (3 files) re-run before Task 2, 111 passed.

## Deleted cases and where the behaviour stays pinned

Deleted from `MultiKeyConnectStep.credential-input.test.tsx` (no member panel can be on MT5, so they have no subject):

1. "with MT5 selected in a panel, a pasted investor password is kept exactly as pasted (D-08), because the server now stores it verbatim and a client strip would be the only trim left" retained by `ConnectKeyStep.credential-input.test.tsx` "with MT5 selected, a pasted investor password is kept exactly as pasted (D-08), because the server now stores it verbatim and a client strip would be the only trim left".
2. "with MT5 selected in a panel, a pasted login is still stripped (D-08 exempts the password only)" retained by `ConnectKeyStep.credential-input.test.tsx` "with MT5 selected, a pasted login is still stripped (D-08 exempts the password only)".

## Case ledger (MultiKeyConnectStep.test.tsx)

| Case | Disposition |
|---|---|
| CR-03 add-key POST carries the broker server | CONVERTED: no add-key button, note exact, no panel, no add-key POST |
| CR-03 third field gates submit | CONVERTED: flag on, no member panel offers an MT5 card (vacuity floor: single-key form offers it) |
| CR-03 MT5 card selected, named, summary | CONVERTED: rehydrated legacy MT5 member's first summary span is exactly "MT5", Remove control present |
| CR-03 flag OFF | KEPT unchanged |
| CR-03 class guard | UPDATED: MT5 absent from the panels, equality against the single-key roster minus the named exception |
| WIZFORM-05 serialized member names the deadline | CONVERTED: exact note, no `multi-add-key`, no panel |
| WIZFORM-05 mixed venues ladder | CONVERTED: MT5 hides the button, okx restores it, panel 0 seeded on okx with no MT5 card |
| WIZFORM-05 D-17 remedy | CONVERTED: rehydrated MT5 member shows its name and Remove, no remedy naming another exchange |
| WIZFORM-05 six venue-independent cases | RE-SEATED by plan 08, untouched here (plan 08's SUMMARY named exactly the three above as left for this plan) |

## Verification

- Task 1 verify (3 files): 111 passed. Task 2 verify (6 files: step test, `wizardErrors.roster-render`, `wizardErrors.invariant`, `seam-wire-vocabulary.invariant`, `ConnectKeyStep.test`, `key-storage-census`): 368 passed, 6 files, nothing skipped or todo.
- `tsc --noEmit -p tsconfig.json`: clean. `npm run lint`: 0 errors, 4 warnings (pre-existing, none in these files).
- `grep -v '^\s*//' MultiKeyConnectStep.tsx | grep -c multi-add-key-mt5-note`: 1 (HEAD was 0).
- No case dropped: step test 88 at the merge base, 89 now.
- `git diff --stat <merge-base> -- supabase/`: empty (SC-5).
- `scripts/verify-plan-anchors.mjs` on the plan: OK, 6 claims.

## SC-6 neuter evidence

Byte backup of `MultiKeyConnectStep.tsx` by `cp` to a `mktemp -d` directory in the scratchpad; after each break, the two component test files were run and the file restored by `cp`; `shasum -a 256` equal to the backup after every restore (5 of 5).

| Neuter | RED observed |
|---|---|
| (i) always render the `multi-add-key` button (`singleDraftExchange === "mt5"` replaced with `false`) | 5 failed: "[213 (c) supersedes] ⭐ the add-key POST carries the broker server ... the note renders, and no add-key POST can be made" (the note case, failing on `multi-add-key` present), the stale-handler case, the serialized-member-names-the-deadline conversion, the mixed-venues conversion, and the credential-input Broker server conversion |
| (ii) remove the `enterMulti` early return and render the button | the same 5 failed. Both (i) and (ii) reach RED through the button, so the early return needed its own pin: |
| (ii-b) remove only the `enterMulti` early return | exactly 1 failed: "[213 (c)] ⭐ a STALE '+ Add another key window' handler cannot carry an MT5 draft into a member panel" |
| (iii) re-add an MT5 roster entry | 4 failed: "[213 (c) supersedes] the panel renders the third field ... no member panel's exchange grid offers an MT5 card", "flag OFF: no MT5 card, and every other venue's panel is untouched", "⭐ THE CLASS GUARD ... MT5 is the one named exception (Phase 213 decision (c))", and the mixed-venues conversion (panel 0 offered an MT5 card) |
| (iv) drop the `?? venueLabel(p.exchange)` fallback | 2 failed: the rehydrated-member conversion in CR-03 and the D-17 conversion (first summary span blank instead of "MT5") |

## Deviations from Plan

**1. [Rule 2 - Missing test] Added one case, the stale-handler pin.** The plan's neuter (ii) ("remove the `enterMulti` early return while also rendering the button") reds through the button alone, so the early return itself could be removed with every other case green (T-213-19 would be unguarded). The new case reads the button's `onClick` from its React props before picking MT5, then calls it after the button is hidden; it alone goes RED when only the early return is removed (neuter ii-b). Raises the step test count 88 to 89, which the acceptance criterion permits.

**2. [Plan wording] `enterMultiFromMt5Draft` kept, renamed `fillMt5SingleKeyDraft`.** The plan said to remove it only if no case still uses it; two converted cases still need the fill without the click, so it stays with the click removed.

**3. [Cleanup of own mess] `WAIT_PROMISE_120` removed.** Its only user was the converted "serialized member panel names ..." case; left unused it would add a lint warning. `SERIALIZED_BUDGET_MS`, `SERIALIZED_DEADLINE_MS`, `SIGNING_IN` and `QUEUE_LINE` stay (still read by other cases).

**Total deviations:** 3 (1 added coverage, 1 helper rename, 1 own-mess cleanup). **Impact:** none on scope.

## Known Stubs

None.

## Threat Flags

None new. T-213-19 mitigated (early return pinned by its own case; server refusal is the backstop); T-213-20 mitigated (venue-name fallback pinned, existing Remove control asserted).

## Self-Check: PASSED

- `MultiKeyConnectStep.tsx`, `MultiKeyConnectStep.test.tsx`, `MultiKeyConnectStep.credential-input.test.tsx` exist; commits `b588b32c5` and `98a7d538b` are ancestors of HEAD on `feat/213-keyflow`.
- `git rev-list --count 65db54f4e..HEAD` = 2 before this SUMMARY commit.
