---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 12
subsystem: strategy-form
tags: [strategy-form, rename-gate, api-key-link, routing]
requires: []
provides:
  - "StrategyForm edit mode writes neither strategies.name nor strategies.api_key_id"
affects:
  - src/components/strategy/StrategyForm.tsx
tech-stack:
  added: []
  patterns: ["mode === \"create\" gates on existing JSX and payload"]
key-files:
  created: []
  modified:
    - src/components/strategy/StrategyForm.tsx
    - src/components/strategy/StrategyForm.test.tsx
decisions:
  - "Create mode kept, not deleted (RESEARCH open question 3 default)."
  - "The edit-mode link writer in handleApiKeySubmit and its link-failure copy were removed, not just hidden, so no dead browser writer of api_key_id remains."
metrics:
  tasks: 2
  completed: 2026-11-10
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: c83dc7a2d0fa9324146a77e9a23053b82666e18b
plan_head_after: 4420f9bcab8536ffc57f18ef1834807fcae2ce43
---

# Phase 200 Plan 12: StrategyForm stops writing the name and the key in edit mode Summary

The edit form no longer renders the Strategy Name picker or the Data Source card and connect modal, and its browser `.update(...)` never carries `name`, so the name route's D-17 gate and the confirmed re-point path are the only writers.

## What changed

- **Task 1 (D-09), commit `92fab493b`.** The `Strategy Name` select renders only when `mode === "create"`. The payload spread is `...(mode === "create" ? { name } : {})`, so an edit save never sends `name`, changed or not. The off-list option logic (164.6.6.3.1 D-01) and the send-when-changed rule (D-02) lost their subject and were removed with the picker; the describe was rewritten to the new rule.
- **Task 2 (D-03, D-07), commit `4420f9bca`.** The Data Source card and the Connect API Key modal render only in create mode. `handleApiKeySubmit` stays for create. Its edit-mode `strategies.update({ api_key_id })` block (KEYLINK-01 edit arm) was removed together with `KEY_LINK_FAILED_COPY` and the `"link"` intent of `toUserFacingStrategyError`, which nothing else used (grep over `src`). The create-mode INSERT arm and the 42501 redaction on save are unchanged.

## Tests

`src/components/strategy/StrategyForm.test.tsx`: 7 added, 7 removed.

- Added (D-09): edit renders no Strategy Name control; edit save after a description change sends no `name`; an untouched edit save sends no `name`; create still renders the picker.
- Added (D-03/D-07): edit renders no Connect API Key control, no Data Source card, no modal; edit with a key already linked renders no Data Source card; create still renders the card and an enabled Connect API Key button.
- Removed: off-list name option, deliberate-pick sends name, re-pick sends no name, on-list not duplicated (all about the removed picker); the three edit-mode connect specs (link persisted, 42501 link denial, generic link failure), replaced by the absence specs.
- `create mode still sends name, defaulting to Alpha Centauri` kept verbatim.

## RED evidence

Backups are byte copies in `<scratchpad>/p200-bak/12/`; each restore was `cp` then `cmp` exit 0.

- gc-200-12-neuter: picker render. Before implementing, `edit mode: renders no Strategy Name control` failed against the unmodified component (`queryByLabelText("Strategy Name")` returned the select). Implemented; GREEN.
- gc-200-12-neuter: payload. `StrategyForm.tsx` edited in a byte copy (`200-12-StrategyForm.tsx.bak`): `...(mode === "create" ? { name } : {})` became `...{ name }`. RED: 2 failed, `edit mode: a save after changing the description sends no name key` and `edit mode: an untouched save sends no name key either`, both `AssertionError: expected { user_id: 'user-a', ...(10) } to not have property "name"`. Restored, `cmp` 0, 18/18 GREEN.
- gc-200-12-neuter: Data Source card (`200-12-StrategyForm-task2.tsx.bak`): the card's `mode === "create"` gate replaced with `true`. RED: 2 failed, `edit mode: renders no Connect API Key control and no Data Source card` and `edit mode with a key already linked: still no Data Source card (no re-point surface)`. Restored, `cmp` 0.
- gc-200-12-neuter: connect modal (`200-12-StrategyForm-task2b.tsx.bak`): the modal's gate replaced with `true`. RED: 1 failed, `edit mode: renders no Connect API Key control and no Data Source card` (the `Connect Exchange API Key` title text rendered). Restored, `cmp` 0, 18/18 GREEN.

## Gates

- `npx tsc --noEmit -p .`: pass.
- `npx eslint` on both changed files: pass.
- `npx vitest run` on StrategyForm.test, StrategyForm.credential-input.test, display-sign-single-source, wizardErrors.roster-render, the edit page test and format-percent-contract: 6 files, 187/187 passed.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 5 claims, no stale.

## Deviations from Plan

- **[Rule 2 - Missing critical functionality] Removed the dead edit-mode link writer.** The plan said `handleApiKeySubmit` stays for create. Gating only the JSX would have left an `api_key_id` browser writer in source with no UI and no test, the exact thing T-200-08 mitigates. Removed it plus the now-unused link copy and `"link"` intent. Commit `4420f9bca`. Files: `StrategyForm.tsx`, `StrategyForm.test.tsx`.
- **Pin file not edited.** `display-sign-single-source.test.ts` stayed untouched: the `StrategyForm.tsx` R5 count (2 error lines) did not move and the test is green.

## Known limits (recorded, not fixed)

- T-200-09: an owner can still write `name` or `api_key_id` through raw PostgREST; closing it needs a migration (out of scope, no migration in this phase).
- The edit page no longer shows the strategy name inside this form; whether it is shown elsewhere on the page was not in this plan's scope and was not checked.
- The No-API warning modal is untouched; it is only reachable from create-mode submit.

## Threat Flags

None.

## Self-Check: PASSED

- `src/components/strategy/StrategyForm.tsx` and `.test.tsx` modified: FOUND.
- Commits `92fab493b` and `4420f9bca` are ancestors of HEAD: FOUND.
- STATE.md, ROADMAP.md, REQUIREMENTS.md untouched.
