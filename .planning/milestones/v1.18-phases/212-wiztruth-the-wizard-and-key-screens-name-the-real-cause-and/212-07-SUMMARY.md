---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 07
subsystem: server strings (account export, finalize-wizard, admin audit warnings, csv-finalize)
tags: [sc6, sc7, sc8, contact-pointer, red-on-revert, server-copy]
requires: []
provides:
  - "account/export export_truncated and export_manifest_drift name the contact form (UI-SPEC rows 10-11), pinned through the real route"
  - "finalize-wizard composite computation_error names the contact form (row 9), pinned through the upsert capture"
  - "send-intro and partner-import audit_warning name the admin's own action (rows 12-13), pinned at source level"
  - "csv-finalize ENQUEUE_LOST_RACE_USER_COPY names the contact form (row 8); WR-07 oracle is a hand-typed sentence"
affects:
  - src/app/api/account/export/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/admin/match/send-intro/route.ts
  - src/app/api/admin/partner-import/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
key-files:
  created: []
  modified:
    - src/app/api/account/export/route.ts
    - src/__tests__/gdpr-export-route.test.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/app/api/admin/match/send-intro/route.ts
    - src/app/api/admin/partner-import/route.ts
    - src/__tests__/redteam-b02-regressions.test.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/app/api/strategies/csv-finalize/route.test.ts
key-decisions:
  - "Founder-pending default applied in Task 3 alone: TS string rewritten, WR-07 oracle hand-typed, SQL arms untouched (SC7)"
status: complete
commits: 3
plan_head_before: c3b04867b86ae9d95493cd60bf684113baead342
plan_head_after: 369062e792ce9e6ced857be4b6bbf148bbe598d6
actuals:
  tokens: 4000
  tasks: 3
  commits: 3
---

# Phase 212 Plan 07: Server strings name the contact form Summary

Five routes no longer point at a support channel that does not exist: four server refusals and the composite/lost-race `computation_error` values say "use the contact form", the two admin audit warnings tell the admin to add the audit entry by hand, and every string has a RED-on-revert pin.

## Tasks and commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Tracer: export refusals (rows 10-11) | e607aeba7 | account/export/route.ts, gdpr-export-route.test.ts |
| 2 | Composite error + admin audit warnings (rows 9, 12, 13) | a6350613d | finalize-wizard route + test, send-intro, partner-import, redteam-b02-regressions.test.ts |
| 3 | csv-finalize lost-race copy + oracle re-cut (row 8) | 369062e79 | csv-finalize route + test |

## RED-on-revert evidence (SC8)

Each file was backed up with `cp` to the scratchpad, neutered by restoring the old legacy-pointer wording, run, restored with `cp`, `cmp` exit 0, and rerun GREEN.

- **Task 1 (tracer)**, `account/export/route.ts`
  - Reverting `export_truncated` text: RED, 2 failed | 15 passed. Failing cases: "specialist apply: refuses to mint URL on ANY truncation (size cap / row cap / parent-id cap)" and "NEW-C16-08: refuses to mint URL (+ refunds token) when a NULL-PK parent dropped child rows".
  - Reverting `export_manifest_drift` text: RED, 1 failed | 16 passed. Failing case: "red-team #7: refuses with export_manifest_drift when bundle lacks profiles".
  - `cmp` exit 0 after each restore; final run 17 passed.
- **Task 2**, three files reverted at once (send-intro, partner-import, finalize-wizard)
  - RED, 3 failed | 187 passed. Failing cases: the two new "212 SC6 — admin audit_warning sentences" cases (send-intro, partner-import) in `redteam-b02-regressions.test.ts`, and "fails LOUD (409 + terminal stamp) when a composite reaches the unified path" in `finalize-wizard/route.test.ts`.
  - `cmp` exit 0 for all three files; final run 190 passed. The M-02 300-character window case stayed green throughout.
  - **The finalize-wizard test DOES pin the upsert text**: the admin mock captures `STATE.strategyAnalyticsUpserts`, so the existing composite case now asserts `stamp.computation_error` equals the hand-typed row 9. Plan 09's census arm is therefore not the only RED proof for this string.
- **Task 3**, `csv-finalize/route.ts`
  - Reverting `ENQUEUE_LOST_RACE_USER_COPY`: RED, 1 failed | 19 passed. Failing case: "[WR-07] ... a 40001 lost race -> the owner reads curated copy: no operator jargon, no SQL text, no promise of an automatic retry" (the exact-equality oracle).
  - `cmp` exit 0; final run 20 passed.

## Verification

- Combined run of the four test files: 4 files, 227 tests passed.
- `npm run typecheck`: clean.
- `git diff --name-only origin/main...HEAD -- supabase/`: empty (SC7 holds); `git status --short supabase`: empty.
- Scoped legacy-phrase census over the five routes (`grep -i 'contact support'`): 0 (HEAD was 6).
- `scripts/verify-plan-anchors.mjs` on the plan: OK, 5 claims.
- ESLint on the csv-finalize route and test (the test lost its now-unused `readFileSync`/`resolve` imports): clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Accuracy] send-intro audit_warning status is 207, not 500**
- **Found during:** Task 2
- **Issue:** The plan's must_haves say "both stay status 500". At HEAD only partner-import answers 500 for its `audit_warning`; send-intro's `audit_warning` body is status 207 (a committed-but-unaudited intro, an existing deliberate shape).
- **Fix:** Only the string was changed; both statuses are exactly as they were (partner-import 500, pinned by M-02; send-intro 207). No behavior change.
- **Files modified:** none beyond the planned ones.

**2. [Rule 2 - Comment hygiene] Legacy support phrase removed from a historical RED-demo quote in `csv-finalize/route.test.ts`**
- **Found during:** Task 3
- **Issue:** An older comment block (RED DEMO NEUTER 2) quoted the old sentence verbatim, including the legacy phrase; plan 09's whole-`src` census counts comments.
- **Fix:** The quote now reads `<the legacy support pointer>`, and the neighbouring remark that the oracle is "parsed from the SQL" says it was until 2026-11-14.
- **Files modified:** src/app/api/strategies/csv-finalize/route.test.ts
- **Commit:** 369062e79

**3. [Rule 3 - Blocking] Unused imports removed**
- Replacing the SQL-parsing IIFE left `readFileSync` and `resolve` unused in `csv-finalize/route.test.ts`; both imports were removed (they had no other use).

## Findings recorded, not rewritten (Rule 3)

- Rows 9 and 11 keep internals wording outside SC6's pointer clause: "unified-backbone finalize path" (composite computation_error) and "Export manifest drift" (export_manifest_drift). Both are user-visible text that reads as internals jargon.
- No in-app caller of `POST /api/account/export` was re-searched here; rows 10-11 stay plain wire text per UI-SPEC.

## Survivors for ship (records for the ship PR; ship owns TODOS.md)

Book ONE user-facing survivor entry, owned by a later migration phase, covering the legacy support pointer that this phase could not touch:

- SQL `computation_error_copy` arms in `supabase/schema/functions/computation_error_copy.sql`: ELSE, permanent, transient, unknown. SC7 forbids a migration here. Until it ships, csv-finalize's TS string and the SQL ELSE arm are NOT in parity, on purpose (recorded in the route's `ENQUEUE_LOST_RACE_USER_COPY` comment and the WR-07 test header).
- Python strings outside the `src` census: `services/exchange.py` (`VALIDATION_UNEXPECTED`), `services/csv_validator.py`, `services/job_worker.py` (two) and `routers/portfolio.py`.

## Known Stubs

None.

## Threat Flags

None. All rewritten strings stay static (no interpolated operator text); the WR-07 unscrubbed-text assertion is kept (T-212-16). The admin sentences tell the admin to add the audit entry by hand and not re-send/re-run (T-212-17).

## Self-Check: PASSED

- Commits e607aeba7, a6350613d, 369062e79 are ancestors of HEAD.
- All nine files_modified paths exist; STATE.md and ROADMAP.md untouched; nothing under supabase/ changed.
