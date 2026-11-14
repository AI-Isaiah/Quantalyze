---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 09
subsystem: phase gate, no-email sweep, legacy-pointer arm, SC4 default
tags: [sc4, sc6, sc7, sc8, red-on-revert, phase-gate, records-for-ship]
requires: ["212-01", "212-02", "212-03", "212-04", "212-05", "212-06", "212-07", "212-08"]
provides:
  - "no-email-in-copy sweep covers every SC6-touched module and both SC3 dashboard forms, with two exact reasoned allowlist entries"
  - "permanent legacy-support-phrase arm over the ten hand-typed files that carried the thirteen census strings, with a self-test"
  - "dialog-envelope law no longer counts the two validate-and-encrypt host forms as per-route dialogs"
  - "WINDOWS entry 12 (D-161-05-B) fixed; ROADMAP 212 and PITFALLS Finding #10 carry the dated CORRECTED note"
key-files:
  modified:
    - src/__tests__/no-email-in-copy.test.ts
    - src/lib/dialog-envelope.invariant.test.ts
    - .planning/WINDOWS.md
    - .planning/ROADMAP.md
    - .planning/research/PITFALLS.md
key-decisions:
  - "SC4 busy copy: founder-pending default applied, both carriers byte-identical, nothing edited"
  - "Dialog-envelope population: exclude the two host forms by a hand-typed, reasoned, anti-stale map rather than bump the count of 4 or add roster rows for a route whose roster already has its own law"
status: complete
commits: 4
plan_head_before: 689f17c90949742a2fcfab752da3086f74a7ca6c
plan_head_after: 608e283ed3c33f6186bb779bb9c4daed3eca8cf5
actuals:
  tokens: 2500
  tasks: 3
  commits: 4
---

# Phase 212 Plan 09: Phase gate and sweep extension Summary

The no-email sweep and a new legacy-pointer arm now cover every module this phase touched for SC6, the whole-`src` census returns only the two known comment lines, SC4's founder-pending default is verified byte-for-byte, SC7 holds, and the full suites are green at the phase head apart from one flaky shared-tmpdir test (named below).

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 (tracer) | `084812fe4` | test(212-09): no-email sweep and legacy-pointer arm cover every touched module |
| 3 (deviation fix) | `5a4535d62` | test(212-09): dialog-envelope law excludes the two validate-and-encrypt host forms |
| 3 | `7e64d615a` | docs(212-09): WINDOWS 12 fixed by Phase 212 (planning only) |
| 3 | `608e283ed` | docs(212-09): ROADMAP 212 and PITFALLS record the measured consumer count and lease-key facts (planning only) |

Task 2 changed no file (the default keeps the carriers), so it has no commit.

## Task 1: sweep and legacy-pointer arm

- `USER_FACING_SOURCES` gained the twelve paths named in the plan. `SOURCE_ALLOWLIST` gained two exact entries: `you@example.com` in `SignupForm.tsx` (the email input placeholder) and `local@host.tld` in `admin/match/send-intro/route.ts` (a format description in a code comment). The "still needed" case passes for both.
- New describe "SC6 - rewritten user-facing sources carry no legacy support pointer" over a hand-typed list of ten files. It drops lines whose trimmed text starts with `//`, `*` or `/*`, then fails naming `file:line` on any remaining case-insensitive match of the legacy phrase. The phrase is joined from two halves at runtime, so the test file carries no such string. Self-test: a planted non-comment line is flagged at the right line; planted `//`, ` *` and `/*` lines are ignored.
- Result: `no-email-in-copy.test.ts` 46 passed.
- Census at HEAD (the plan's `[HEAD=15]` marker predates plans 05-07): `grep -rni 'contact support' src | grep -v wizardErrors.ts | grep -v test | wc -l` = 2, and excluding the two known comment files (`src/lib/gdpr-export.ts:379`, `src/lib/factsheet/fetch-and-build-payload.ts:224`) = 0.
- `verify-plan-anchors.mjs` on this PLAN: exit 0 (6 claims, no stale). Plans 01-08 each have a SUMMARY and their commits are ancestors of HEAD.

### SC8 RED-on-revert observations (backup with cp to the scratchpad, restore the old string, run, cp back, cmp)

| File reverted | Old string restored | Observed RED | cmp after restore |
|---|---|---|---|
| `src/app/api/admin/partner-import/route.ts` | `...Contact support. Do NOT re-run the import.` | new arm failed: `src/app/api/admin/partner-import/route.ts:1039: audit_warning: "Import succeeded ... Contact support. Do NOT re-run the import."` (1 failed, 45 passed) | exit 0 |
| `src/app/api/admin/match/send-intro/route.ts` | `...could not be written. Contact support.` | new arm failed: `src/app/api/admin/match/send-intro/route.ts:627: audit_warning: "Intro committed ... Contact support."` (1 failed, 45 passed) | exit 0 |
| `src/components/auth/ProfileForm.tsx` | `Set at signup. Contact support to change it.` | new arm failed: `src/components/auth/ProfileForm.tsx:119: text="Set at signup. Contact support to change it."` (1 failed, 45 passed) | exit 0 |

GREEN rerun after the three restores: 46 passed, `git status` shows only the test file modified.

## SC4 outcome (Task 2)

The founder-pending default is applied and nothing is edited under it.

- Carrier gates: `grep -c 'Try again in a minute.' analytics-service/services/closed_sets.py` = 1; `grep -c 'Our MetaTrader terminal is briefly busy.' src/lib/wizardErrors.ts` = 1. `git diff origin/main...HEAD -- analytics-service/services/closed_sets.py` is empty; the same diff of `src/lib/wizardErrors.ts` adds or removes no line containing the busy title or `Try again in a minute.`
- Pins agree: `tests/test_validate_key_venue_transient.py` + `tests/test_mt5_server_known.py` = 73 passed; vitest `rotate-secret/route.test.ts` + `MultiKeyConnectStep.test.tsx` = 141 passed (2 files).
- Measured basis (`212-SC4-MEASUREMENT.md`, read-only, 2026-11-14, PROD marker query first): no p95 hold distribution exists. Railway filter `mt5.stage` over 2026-11-07..14 returned 0 entries, and `duration_ms` and `lease_wait` filters also returned 0. The only `mt5_terminal_lease` wait lines since 2026-10-15 are two on 2026-10-23: "waited 18.32s" and "waited 16.20s", both under the 20 s bound. `cron_runs` `mt5_terminal_scrub` rows carry no hold duration (completed_at minus started_at is 0 s on all 27). No number was invented.
- Lock finding: a derive leases the job terminal's key and a wizard validate leases the validation terminal's key (Phase 164.6.6 D-02/D-05), so a running derive cannot make an interactive validate wait. This is pinned behaviourally by plan 01 (`tests/test_mt5_concurrency.py`, with an equal-config RED control). The ROADMAP/TODOS 0.51 premise of "20 s against a 40 s derive" was true before 164.6.6 and is false at HEAD (recorded in ROADMAP 212 and PITFALLS, Task 3).
- `_MT5_LEASE_WAIT_S` stays 20 s: raising it would break the D-26 120 s client budget, and no measurement supports a different number.
- Copy kept per the founder-pending default ("Try again in a minute."). Research found no truthful static number: wizard-only holders bound about 285 s at code defaults, the worker validate path up to the 30-minute `process_key_long` ceiling, and the owed-scrub refusal is unbounded while a scrub keeps failing.
- If the founder chooses a number, these pins move together: the Python carrier `MT5_TERMINAL_BUSY_DETAIL` (`analytics-service/services/closed_sets.py`), the TS `KEY_MT5_TERMINAL_BUSY` title and `fix[0]` (`src/lib/wizardErrors.ts`), `EXPECTED_MT5_TERMINAL_BUSY_DETAIL` (`tests/test_validate_key_venue_transient.py`), the fixture in `src/app/api/keys/[id]/rotate-secret/route.test.ts`, and the title pin in `MultiKeyConnectStep.test.tsx`. The Python banned-word fence stays.

## Task 3: phase gate

Run at the phase head (code at `5a4535d62`; the later two commits are planning-only).

| Gate | Exit | Counts |
|---|---|---|
| SC7: `git diff --name-only origin/main...HEAD -- supabase/migrations` (and all of `supabase/`) | 0, prints nothing | 0 files |
| `npm test` (final clean run, no concurrent pytest) | 1 | 1 failed, 26312 passed, 306 skipped (26619); 1 failed file of 1258, 20 skipped files. The one failure is the flaky case below; it passed 931/931 on two isolated reruns. |
| `npm test` (first run, parallel with `make test`) | 1 | 8 failed, 26304 passed, 306 skipped: 7 were wall-clock timeouts from CPU contention (`display-sign-single-source` 3, `return-stats.single-source` 3, `ci-apt-bounded` R4 SIGKILL at its 55 s spawn timeout), all 128 tests in those three files green when rerun alone; 1 was the real defect fixed below |
| `npm run lint` | 0 | 0 errors, 4 warnings (all pre-existing unused vars in `composite-read-path.ts` and `queries.stale-analytics-detail.test.ts`, not files this phase touched); admin-route manifest, route-contract, planning-hygiene (rules 1, 6, 7) and canonical-domain all OK |
| `npm run typecheck` | 0 | no output |
| `make test` (analytics-service) | 0 | 14873 passed, 101 skipped, 1173 warnings (7m06s) |
| `make typecheck` (mypy) | 0 | Success: no issues found in 139 source files |
| `npm run check:planning-hygiene` after the planning edits | 0 | OK |

Coverage threshold line from the first run: "Required test coverage of 80% reached. Total coverage: 94.64%".

Flaky test, not caused by this phase: `src/__tests__/drift-check-scripts.test.ts` "IN-04 ... a failing VAC-08 run leaves no new mktemp directory behind" failed once in the full run (it looks for new `tmp.*` directories holding `missing.txt` in the shared system tmpdir, so a concurrent process running the same gate script on this machine can trip it). Two isolated reruns: 931 passed, 931 passed. Booking it is the ship step's call; it is not a phase-212 regression.

### WINDOWS and ROADMAP

- `gsd-tools windows fixed 12` worked and the diff was clean (counts 52/19 to 51/20, `last_updated`, the table row and the JSON entry only; no collateral). Committed alone as `7e64d615a`. The tool does not write a `reason`; the citing note is this SUMMARY and plan 03.
- ROADMAP Phase 212 gets one dated `CORRECTED 2026-11-14 (Phase 212 planning, measured at HEAD)` paragraph directly after the Goal line, recording (a) the two live consumers and (b) the lease-key fact plus the SC4 founder-answer clause. The diff is exactly that one added line; Goal and SC3 are byte-unchanged (`grep -c '^3. The three validate-and-encrypt consumers render from `code`'` = 1). PITFALLS Finding #8/#10 paragraph gets the same dated note for fact (b) appended; its existing text is unchanged. Both ride one planning-only commit, `608e283ed`. The ROADMAP `**Plans:**` count and plan rows were not touched (the orchestrator owns them).
- Re-grep at the phase head of `three validate-and-encrypt consumers`, `three .keys/validate-and-encrypt. consumers` and `against a 40 s` across `.planning` (excluding `milestones/` and this phase directory): hits are only ROADMAP lines 431, 432 and 439 (the Goal, my note, SC3), all kept as lineage on purpose. No new hit needs the note.
- Planning-only guard: the last two commits carry only `.planning/` paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The dashboard-dialog envelope law counted six dialogs, expected four**
- **Found during:** Task 3, full `npm test`.
- **Issue:** `src/lib/dialog-envelope.invariant.test.ts` (WIZERR-07) derives its population as "a `.tsx` under `src/components` or `src/app/(dashboard)` that calls `buildEnvelope(` and mounts `<Modal`". Plan 08 made `StrategyForm.tsx` and `AllocatorExchangeManager.tsx` call `buildEnvelope` (they already mounted a `<Modal`), so the population rose from 4 to 6 and case "C. NON-VACUITY" went RED. Both are large host components, not per-route dialogs, and have no `DASHBOARD_DIALOG_ROUTE_CODES` row; their route's roster is `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, held by the roster-render fifth surface plan 08 added.
- **Fix:** a hand-typed `COVERED_BY_WIZARD_ROSTER` map (two entries, each with a reason), `derivePopulation` filters it, and a new anti-stale case requires each excluded file to still match the predicate (so an exclusion cannot outlive its cause and hide a real future dialog). `EXPECTED_DIALOG_COUNT` stays 4; the literal was not bumped, as the test's own message demands. Alternatives rejected: adding roster rows (a source change to `wizardErrors.ts` for a route with its own law) and loosening the predicate.
- **RED evidence:** the failing run itself ("expected 6 to be 4", listing both files) before the edit; 18 passed after.
- **Files modified:** `src/lib/dialog-envelope.invariant.test.ts` (not in the plan's `files_modified`).
- **Commit:** `5a4535d62`

### Plan marker out of date

The Task 1 verify marker `[HEAD=15 EXPECT==2]` was measured before plans 05-07; at execution HEAD the census was already 2, so there was no reduction to observe in this plan. The census closing condition holds and is now pinned by the new arm for the ten rewritten files.

**Total deviations:** 1 auto-fixed (test-only), 0 architectural.

## Records for ship

The ship step owns `TODOS.md`, `CHANGELOG.md`, `VERSION` and `package.json`. This plan edited none of them (nor `STATE.md`, and `ROADMAP.md` only by the planned CORRECTED note).

- Delete from `TODOS.md` (and name each in the CHANGELOG entry): `0.07` (plan 02), `0.09` (plan 01), `0.012` (plan 03, WINDOWS 12 is already marked fixed), `0.013` and `[WIZFORM-02-VE-CODECHANNEL]` (plan 08), `[164.2-WIZARD-BARE401]` (plan 04), `CONTACT-SUPPORT-POINTERS-01` (plans 05-07).
- `0.51`: closes as "recorded and structurally pinned" under the SC4 default (plan 01's key-separation pin plus the unchanged carriers); if the founder answers SC4 with a number, re-home it to that change instead and move the pins listed under "SC4 outcome".
- `[164.2-SEAMCODE-UNION]` stays open: re-point its stale route-file and invariant-test citations by symbol.
- Phase 145 entry `OPTION CSV_FINALIZE_MOVED`: its `GATED ON WIZFORM-02 CLOSING` gate opens; update its text, do not pick it up.
- Book ONE user-facing survivor entry, owned by a later migration phase: the SQL `computation_error_copy` arms in `supabase/schema/functions/computation_error_copy.sql` (ELSE, permanent, transient, unknown; SC7 forbids the migration here, so csv-finalize's TS string and the SQL ELSE arm are not in parity, on purpose) and the five Python strings outside the `src` census (`services/exchange.py` `VALIDATION_UNEXPECTED`, `services/csv_validator.py`, `services/job_worker.py` two, `routers/portfolio.py`), per plan 07's SUMMARY.
- Optional, ship's call: the `drift-check-scripts.test.ts` IN-04 flake above (LOW, a shared-tmpdir race; per the repo rule a LOW is not booked in `TODOS.md`, so record it in the phase REVIEW instead).
- Planning-only commits that must not ride the ship branch: the `161-UI-SPEC.md` amendment (plan 01), `7e64d615a` (WINDOWS) and `608e283ed` (ROADMAP and PITFALLS), plus the SUMMARY commits. Check the ship branch changes nothing under `.planning` before the push.

## Known Stubs

None.

## Threat Flags

None. T-212-18 (user-facing copy naming an address) is mitigated: the sweep covers every touched module and the two allowlist entries are exact and must remain in their files.

## Self-Check: PASSED

- FOUND: `src/__tests__/no-email-in-copy.test.ts`, `src/lib/dialog-envelope.invariant.test.ts`, `.planning/WINDOWS.md`, `.planning/ROADMAP.md`, `.planning/research/PITFALLS.md`.
- FOUND commits (ancestors of HEAD): `084812fe4`, `5a4535d62`, `7e64d615a`, `608e283ed`; `git rev-list --count 689f17c90..HEAD` = 4 before this SUMMARY commit.
- `STATE.md`, `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` untouched; no file under `supabase/` changed.
