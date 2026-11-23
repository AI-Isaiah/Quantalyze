---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 02
subsystem: api
tags: [wizard, create-with-key, idempotency, deduped]
requires: []
provides:
  - "create-with-key F6 session-fence arm answers deduped: true (decision (a), second half)"
  - "F2 residual (RPC-internal replay) named in route comments"
affects: [213-03]
tech-stack:
  added: []
  patterns: ["boolean-only response marker; no identifier crosses back"]
key-files:
  created: []
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
decisions:
  - "deduped: true on the F6 session-fence arm; every route-owned arm that returns an existing draft now carries it (F6, venue fence, 23505 race, reuse resolver)."
  - "The existing wizard-dedup-notice SHOWS on the credential-path F6 replay (CONTEXT discretion default). Flagged for founder review (UI-SPEC Founder Review item 1)."
  - "F2 residual named, not fixed: RPC-internal replays return the same shape as a fresh mint; discriminating them needs a RETURNS TABLE change (migration, out of scope per SC-5)."
requirements-completed: [SC-1, SC-6]
metrics:
  tasks: 2
  commits: 2
  completed: 2026-11-14
status: complete
actuals:
  tokens: 600
  tasks: 2
  commits: 2
plan_head_before: 5157e1c91bb028ae03cd27cc45bd8c6a074b83d4
plan_head_after: ce6790890528e8c91845d28fe510731fd8768b4f
commits: 2
coverage:
  - id: D1
    description: "create-with-key's F6 session-fence arm answers deduped: true; a first connect carries no deduped"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "src/app/api/strategies/create-with-key/route.test.ts#returns the existing draft ... and answers deduped:true (Phase 213 decision (a) ...)"
        status: pass
      - kind: unit
        ref: "src/app/api/strategies/create-with-key/route.test.ts#a first connect is NOT reported as deduped"
        status: pass
    human_judgment: false
  - id: D2
    description: "The credential-path F6 deduped reaches WizardClient and shows the existing dedup notice; the reuse arm still shows none"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx#forwards deduped:true from the response into the onSuccess payload"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx#renders the neutral strip after a connect the server resolved onto the existing strategy"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx (unedited)"
        status: pass
    human_judgment: true
    rationale: "Showing the notice on an ordinary double-click is a UX discretion default pending founder review (UI-SPEC Founder Review item 1)."
---

# Phase 213 Plan 02: F6 replay answers deduped Summary

The create-with-key F6 session-fence replay now answers `{ ok, strategy_id, api_key_id, deduped: true }`, so every route-owned arm that returns an existing draft flags it, while a first connect still carries no `deduped`.

## What changed

- `route.ts`: single field `deduped: true` on the F6 arm (boolean only, no identifier; T-213-03 mitigated). A dated `CORRECTED 2026-11-14 (Phase 213 decision (a))` note sits beside the venue-fence "ADDITIVE AND APPEARS ON THIS ARM ONLY" paragraph (old sentences kept as lineage) and beside the F6 arm itself. A `F2 RESIDUAL (Phase 213)` comment sits at both final RPC success returns (`handleReuseExistingKey` and the credential path).
- Arms re-read per the plan: the venue fence (`venueMatch.kind === "draft"`), the 23505 venue-race re-read and the reuse resolver (`held.kind === "draft"`) already answered `deduped: true`; no change needed there.
- `route.test.ts`: the F6 case updated in place, its title now ends "and answers deduped:true (Phase 213 decision (a), supersedes the byte-identical F6 arm)". The vacuity fence "a first connect is NOT reported as deduped" is untouched.
- `ConnectKeyStep.tsx`: comment-only dated correction on the `deduped` docblock of `ConnectKeySuccess` (diff is added comment lines only).

## Task commits

1. Task 1 (tracer): `753d0ac87` (feat)
2. Task 2: `ce6790890` (docs)

## Verification

- Task 1 command (route.test.ts, ConnectKeyStep.test.tsx, WizardClient.test.tsx, ContributionWizardOverlay.preselect.test.tsx): 4 files, 298 passed. Tracer re-verified end to end before expansion.
- Task 2 command (ConnectKeyStep.test.tsx, key-storage-census.test.ts): 2 files, 88 passed.
- `tsc --noEmit -p tsconfig.json`: clean. `npm run lint`: 0 errors, 4 warnings (none in touched lines).
- `git diff --stat $(git merge-base origin/main HEAD) -- supabase/`: empty (SC-5).
- `scripts/verify-plan-anchors.mjs` on the plan: OK, 3 claims.
- Acceptance: non-comment `deduped: true` count in route.ts went 3 -> 4 (expect >=4); renamed F6 title contains `decision (a)`; vacuity fence title unchanged; preselect test passes unedited.

## SC-6 neuter evidence (route.ts backed up by cp to a mktemp dir in the scratchpad, restored by cp, shasum equal: 0a70eeea... each time)

| Neuter | RED observed |
|---|---|
| (i) remove `deduped: true` from the F6 arm | `returns the existing draft and skips Railway validate+encrypt+RPC when a draft already exists ... and answers deduped:true (Phase 213 decision (a) ...)` fails with `AssertionError: expected { ok: true, ...(2) } to deeply equal { ok: true, ...(3) }` / `- "deduped": true` (1 failed, 166 passed) |
| (ii) add `deduped: true` to the final `create_wizard_strategy` success return | `a first connect is NOT reported as deduped` RED, plus 7 other first-connect cases that `toEqual` the plain envelope (8 failed) |

## Deviations from Plan

None - plan executed exactly as written. (The plan's artifacts list mentions a "new pin that the credential-path F6 answer reaches the client contract"; the acceptance criteria name three existing pins that carry it end to end, and all three pass, so no new test was added.)

## Known Stubs

None.

## Threat Flags

None. T-213-03 mitigated (boolean only). T-213-04 accepted and named in code (F2 residual); to be repeated in the CHANGELOG `### Notes` at ship.

## Self-Check: PASSED

Commits 753d0ac87 and ce6790890 are on feat/213-keyflow; all three modified files exist.
