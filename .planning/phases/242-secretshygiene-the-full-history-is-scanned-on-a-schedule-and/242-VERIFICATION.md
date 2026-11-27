---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
verified: 2026-11-27T14:05:00Z
status: passed
score: 3/3 must-haves verified
verified_at_sha: 9f0fb9e6a8aa3f733d3dc1cee81a9a8e96a912ef
drift_subjects:
  - .github/workflows/secret-scan-full-history.yml
  - .gitleaksignore
  - src/__tests__/secret-scan-full-history.test.ts
  - supabase/migrations/20261127130000_cron_destinations_exact.sql
  - supabase/migrations/down/20261127130000-rollback.sql
  - supabase/schema/functions/cron_sync_tick.sql
  - supabase/schema/functions/ops_staleness_check.sql
  - supabase/schema/functions/match_engine_cron_tick.sql
  - supabase/schema/functions/prod_prober_cadence_check.sql
  - supabase/tests/test_cron_sync_tick.sql
  - supabase/tests/test_prod_prober_cadence.sql
  - supabase/tests/test_ops_staleness_check.sql
  - supabase/tests/test_analytics_service_settings_and_vault_tick.sql
  - scripts/mutation-floors.mjs
  - .github/workflows/ci.yml
behavior_unverified: 0
overrides_applied: 0
---

# Phase 242: SECRETSHYGIENE Verification Report

**Phase Goal:** The full history is scanned for secrets on a schedule, and the cron functions post the service key only to exact named hosts.
**Verified:** 2026-11-27T14:05:00Z
**Status:** passed
**Re-verification:** No, initial verification

Everything that can be observed before merge was re-run by this verifier and passes. Three items can only be observed after merge, and one of them is part of SC-1's literal text ("green on its first run"), so the phase is `human_needed`, not `passed`. No gap and no blocker was found.

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | A scheduled workflow scans the full history and is green on its first run. Historical findings are suppressed by the method chosen at plan time, and no credential-shaped literal is re-published. (SECR-03) | ? UNCERTAIN (WARNING, human) | Workflow, ignore file and pins all exist and work: see below. "Green on its first run" cannot be observed before merge. The pre-merge proxy is green: `gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD" --redact --no-banner` printed `2791 commits scanned.` and `no leaks found`; the squash-shaped range scan `45d7b4e5c..HEAD` printed `41 commits scanned.` and `no leaks found`. |
| 2 | `cron_sync_tick` and `ops_staleness_check` post the service key only to exact named hosts; a SQL gate arm goes RED on a wildcard host. The entry's gate-arm and tab-key guard gaps are closed, each with an arm that goes RED. (SECR-04) | ✓ VERIFIED | The migration compares by equality against a two-origin array in the CHECK and in all four key-posting bodies; no pattern remains. Arms W1 (wildcard sibling host), P2 (posted header equals the Vault secret, the entry's gate-arm gap) and K1 (tab, CR, LF key, the tab-key guard gap) each go RED under their own neuter in all four gates. |
| 3 | PROOF-01: each gate goes RED on a neutered copy with its named arm first, restored from a byte backup and GREEN, recorded verbatim in the plan SUMMARY. New SQL arms carry RED-UNDER twins. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane. | ✓ VERIFIED | Twins: every new arm has an adjacent `RED-UNDER-M` object; the runner executed each and read `RED (identity ok)`. SUMMARYs 02, 03 and 04 carry the cp/cmp/GREEN rows (9, 10 and 6 `cmp` mentions); SUMMARY 01 carries a 7-row table for the scan. Reviewers: 242-REVIEW.md line 200 records "migration-reviewer and rls-policy-auditor reported 0 findings at any severity on the migration and its rollback"; 242-REVIEW-R3.md records "0 findings (round 1; the migration did not change after round 1)". Checked independently: `git log` shows the migration and rollback last changed at 12:09 in commit `3f49a3be9` (plan 04), before review round 1 (`eda5153e8`), and nothing touched them afterwards. Plan 05 and 06 SUMMARYs carry no PROOF-01 rows because they move census numbers and records, not gates (the census contract test passes). |

**Score:** 2/3 truths verified (0 present, behavior-unverified). SC-1 is carried as UNCERTAIN for its post-merge clause only.

### SC-1 detail (what was checked)

- `.gitleaksignore`: 31 non-comment lines; every one matches `^[0-9a-f]{40}:<file>:<rule>:<line>$` (0 that do not); awk field count is 4 for all 31. No three-part (global) line, no inline comment. Header names both silent traps. Only commit hashes, file names, rule ids and line numbers appear, no credential-shaped value.
- Method matches the roadmap's allowed choice (commit-scoped fingerprints, no `--baseline-path` report committed). `.gitleaks.toml` is unchanged from the merge-base.
- Workflow `.github/workflows/secret-scan-full-history.yml`: triggers are `schedule` (one daily cron, 05:30 UTC) and `workflow_dispatch` only; `ref: main` with `fetch-depth: 0`; gitleaks 8.30.1 installed from a hard-coded sha256 (checksums file never fetched); `--redact`, never `-v`; `--remerge-diff HEAD` so merge-only content is scanned; a planted-finding self-test step proves the pinned binary's four-part and three-part and inline-comment semantics each day; the scan step exits red on any gitleaks code other than 0 or 2, on `ERR` in the log, and when `commits scanned` differs from the count git reports (gitleaks otherwise exits 0 on "0 commits scanned"); a `report` job holding the only `issues: write` scope files or comments on one deduplicated count-only issue. Red-redeploy decision recorded in the workflow header (Railway can gate on the failing check; founder-accepted coupling, same as the nightly SQL mutation run).
- Calibrated pins: `npx vitest run src/__tests__/secret-scan-full-history.test.ts --testTimeout=120000` gave `Tests 15 passed (15)`.

### SC-2 detail (what was checked)

- `supabase/migrations/20261127130000_cron_destinations_exact.sql` (825 lines): `ALTER TABLE ... CHECK (key <> 'analytics_service_url' OR value = ANY (ARRAY[prod origin, 'http://127.0.0.1:9']))`; `c_allowed_origins CONSTANT TEXT[]` and `IF NOT (v_url = ANY (c_allowed_origins))` in `match_engine_cron_tick`, `prod_prober_cadence_check`, `cron_sync_tick` and `ops_staleness_check` (four bodies, at lines 221, 375, 465, 668); blank-key guard `btrim(v_key, E' \t\r\n')`; refusal never echoes the stored value. Non-comment `up.railway.app` occurrences are only the two exact origin literals (CHECK, four arrays) and the verify block's concatenated needle. No `LIKE` or `~` destination test remains in any of the four committed function snapshots.
- Only these four functions post the Vault key: `grep -l analytics_service_key supabase/schema/functions/` returns exactly them.
- Currency: `git diff 45d7b4e5c..origin/main` (7 newer commits) touches none of the migrations, function snapshots, gates, prober manifest, `.gitleaksignore` or `.gitleaks.toml`, and the newest migration on main is still `20261126180000`, so the new timestamp is free and sorts last and the re-based bodies are still the latest definitions.
- Rollback exists at `supabase/migrations/down/20261127130000-rollback.sql` (old CHECK, four old bodies); the analytics-settings gate's SUMMARY records it as tested.
- Runbooks no longer carry the suffix regex (`ops-staleness-go-live.md`, `prod-prober-cadence-go-live.md`); `match-engine.md` carries the closure note.

### Behavioral Spot-Checks and Probe Execution

All four gates were run by this verifier through the mutation runner on the pg-lane, one `--file` run each (narrowed diagnostic mode: exit code is by design not 0; the verdict is the arm list and the last line):

| Gate | Command | Result | Status |
|---|---|---|---|
| `supabase/tests/test_cron_sync_tick.sql` | `node scripts/mutation-runner/run.mjs --file ...` | `arms: 11/11/0`, `biting: 11`, `lane-invocations: 11`, every arm `RED (identity ok)` including W1, P2, K1; restore exit 0; `No defects in the narrowed scope.` | PASS |
| `supabase/tests/test_prod_prober_cadence.sql` | same | `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`, W1 and K1 `RED (identity ok)`; `No defects in the narrowed scope.` | PASS |
| `supabase/tests/test_ops_staleness_check.sql` | same | `arms: 16/16/0`, `biting: 16`, `lane-invocations: 16`, W1 and K1 `RED (identity ok)`; `No defects in the narrowed scope.` | PASS |
| `supabase/tests/test_analytics_service_settings_and_vault_tick.sql` | same | `arms: 17/17/0`, `biting: 17`, `lane-invocations: 17` (U3, W1, K1 among them), every arm `RED (identity ok)`; `No defects in the narrowed scope.` | PASS |
| census and floors | `node scripts/mutation-runner/run.mjs --parse-only` | `No static defects. Every prose marker has a twin and every needle still matches.` | PASS |
| census and floors, floor tests | `vitest run mutation-runner-floors, ci-anti-skip-gate.contract, gate-family-meta, mutation-annotation-parser, gitleaks-allowlist` | all passed (1267 passed across the six files requested, see note) | PASS |
| secret-scan pins | `vitest run src/__tests__/secret-scan-full-history.test.ts --testTimeout=120000` | `15 passed (15)` | PASS |
| full-history scan | `gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD" --redact --no-banner` | `2791 commits scanned`, `no leaks found` | PASS |
| squash-shaped scan | same, `--log-opts="45d7b4e5c..HEAD"` | `41 commits scanned`, `no leaks found` | PASS |

Note on one transient: the first combined vitest run showed one failure in `drift-check-scripts.test.ts` (the `mktemp -d` leak detector at line 4284). It ran concurrently with the pg-lane gate runs, which create `tmp.*` directories; the detector attributes by a `missing.txt` signature and the file's own header warns about parallel strangers. Re-run alone, the file read `952 passed (952)`. Treated as a concurrency artifact of this verification, not a defect; the same file's ARMS_FLOOR=599 pin passed.

Probe discovery (Step 7c): the plans declare no `scripts/*/tests/probe-*.sh`; the SQL gate files above are the phase's executable proofs.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| each gate's `RED-UNDER-SETUP` apply list | `20261127130000_cron_destinations_exact.sql` | file path in the list | WIRED | cron_sync gate lists it last in `apply`; every twin edits that file by `find`/`nth` and the runner matched all needles (`--parse-only` clean). |
| ci.yml `ARMS_FLOOR` and per-file table | gate sentinels | `ALL N ARMS EXECUTED` | WIRED | table moved 8->11, 7->9, 14->16, 13->16 and floor 589->599; the census contract test passes. |
| `scripts/mutation-floors.mjs` `ARMS_FLOOR` | annotated arm count | `--parse-only` | WIRED | `arms: 0/1089/0`. Upper bound on biting until CI FULL (human item 4). |
| `secret-scan-full-history.yml` | `.gitleaksignore`, `.gitleaks.toml` | repo-root read by gitleaks | WIRED | scan over HEAD reads zero with the ignore file; removing a line reddens it (SUMMARY 01 S-02, shape pins S-03 and S-04). |
| `report` job | `scan` job result | `needs.scan.result != 'success'` | WIRED | files or comments on one issue carrying a count and a run link only. |

### Data-Flow Trace (Level 4)

Not applicable: no UI rendering. The one value that flows to an external sink, the Vault key into the `X-Service-Key` header, is guarded by the destination equality test and traced by arm P2 (posted header equals the secret).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SECR-03 | 242-01, 242-06 | A full-history secret scan runs on a schedule; suppression method and red-scan blocking decided at plan time | SATISFIED pre-merge; first-run proof pending | Workflow, `.gitleaksignore`, pins, scans above. Human item 1 is the first-run record. |
| SECR-04 | 242-02, 242-03, 242-04, 242-05, 242-06 | `cron_sync_tick` and `ops_staleness_check` post the key only to exact named hosts; gate-arm and tab-key guard gaps closed | SATISFIED pre-merge; applied-ness pending | Migration, four gates, runner results above. Human item 2 is TEST and PROD apply. |

Both IDs appear in REQUIREMENTS.md (lines 188 and 189, traceability rows at 366 and 367, status Pending until the phase closes); no other requirement is mapped to Phase 242, so there are no orphans. REQUIREMENTS.md traceability still reads `Pending` for both; flipping it belongs to `phase complete` once the human items resolve.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| (new and changed files) | - | `TBD`, `FIXME`, `XXX` markers | none found | grep over the workflow, ignore file, test file, migration and rollback returned nothing |

Review residuals recorded, not blocking: R3 IN-01 and the silent-failure-hunter LOW (string-matching pins cannot list every deliberate control-flow rewrite of the scan step; each such edit shows plainly in a diff). Neither is MEDIUM or above, and per repo rule they are recorded in REVIEW.md only.

### Deferred Items

None. The post-merge items below are part of this phase's own SCs, not later-phase work. Phase 246 re-bases on this migration, which is a dependency in the other direction.

### Coincidental-reliance (advisory)

None flagged. The vitest real-binary scoping arm skips on CI (no gitleaks on PATH), but the workflow's own self-test step re-measures the same semantics against the pinned binary each day, so the property does not rest on a fixture-only precondition.

### Review and Records

- Code review loop converged at round 3: 0 CRITICAL, 0 HIGH, 0 MEDIUM from code-reviewer and silent-failure-hunter; migration-reviewer and rls-policy-auditor 0 findings at any severity.
- Records: both TODOS entries (`SECRETSCAN-FULLHISTORY-01`, `167.1.2.2.2-CRON-TICK-RESIDUALS`) are deleted from `TODOS.md` (0 hits), WINDOWS entry 61 half (c) is marked answered with half (b) left open, and the remaining id mentions are lineage prose in the migration header, an applied migration comment, CHANGELOG history and planning documents.
- Not done at verification time and belonging to the ship step: the CHANGELOG entry and VERSION bump for this phase (repo rule: written in the release commit before the push). No such entry exists yet in this worktree; this is not a phase-goal gap.

## Post-merge evidence (2026-11-27)

Code PR #1394 squash-merged as `1863fe809f9907719bce306a4d8d43a34af973e8` (PR head `7143f6b80035c7cb4ca077082d2b0849fa2eaf0a`, rebased on main `f4e3d7d29`, VERSION 0.133.106.0).

1. **First dispatched scan.** `secret-scan-full-history.yml` dispatched on main, run `46037489748`: success. `gitleaks self-test passed`, `2764 commits scanned`, `no leaks found`; the `report` job skipped, no issue filed. SC-1 met.
2. **Applied on TEST and PROD.** `supabase-migrate.yml` push run `46035189697` for `20261127130000_cron_destinations_exact.sql`: `apply-test` success, PROD `apply` success. Its `redump-pr` job failed on a transient HTTP 403 in the open-PR lookup; the re-dispatch, run `46036945243` (apply-test, apply and redump all success), opened re-dump PR #1401. PROD read through the Supabase MCP after the marker query read PRODUCTION: `system_settings_analytics_service_url_allowed` is `CHECK (key <> 'analytics_service_url' OR value = ANY (ARRAY[<prod origin>, 'http://127.0.0.1:9']))`, and all four function bodies carry `c_allowed_origins CONSTANT TEXT[] := ARRAY[<prod origin>, 'http://127.0.0.1:9']` with no suffix wildcard (body md5s `124accfa…`, `9909cc30…`, `33f4af05…`, `21ff6c96…`). The TEST apply is `apply-test` success; TEST was not read directly.
3. **Re-dump merged.** #1401 (rebased twice onto a moving main; VERSION, package.json, CHANGELOG only) merged as `9f0fb9e6a8aa3f733d3dc1cee81a9a8e96a912ef`. Main CI run `46044996012` is success; `baseline-content-drift-check` now reads `MATCH 147, DRIFT 3`, the four 242 rows cleared and no allowlist row was added (the 3 remaining are older pinned rows).
4. **sql-mutation FULL.** On the PR head's CI run `46032677854`: `scope: FULL 99/99 annotated files`, `arms: 1110/1110/0`, `biting: 1110`, `lane-invocations: 1110`; ARMS_FLOOR compared against a real biting count. The PR run's only reds were `sql-gate-lint` (the four expected DRIFT rows) and the `frontend` aggregator from that alone; `test-db-drift` (VAC-08) passed.

## Human Verification (resolved above)

### 1. First dispatched run of the scheduled scan on main

**Test:** After merge, dispatch `secret-scan-full-history.yml` on main and read the run.
**Expected:** Green; self-test prints `gitleaks self-test passed`; scan prints a commit count equal to the derived count, then `no leaks found`; no issue filed. Record the run id and the line.
**Why human:** SC-1 names the first run; a workflow registers only from the default branch. Runner git is unmeasured, but both coverage checks fail closed.

### 2. Migration applied on TEST and PROD

**Test:** After merge, confirm `apply-test` then PROD `apply` succeed for `20261127130000`, and VAC-04's four hashes equal the four `prod-body-ack` pragmas.
**Expected:** Both green; CHECK and four bodies hold the two-origin set on both databases.
**Why human:** Post-merge fact; no database access was permitted here; PROD auto-applies with no human gate.

### 3. Bot baseline re-dump

**Test:** Merge the post-apply re-dump PR; re-read `baseline-content-drift-check`.
**Expected:** The four expected DRIFT rows clear.
**Why human:** Produced by a bot after the PROD apply.

### 4. CI sql-mutation FULL and the aggregator

**Test:** Read `sql-mutation` on the PR head SHA and the `frontend` aggregator.
**Expected:** `ARMS_FLOOR=1089` compared with a real biting count and green; `ci.yml` floors 38/599 pass.
**Why human:** Only a FULL CI run compares the static 1089 with measured biting; locally the four changed gates were run narrowed and bite on every arm.

## Gaps Summary

No gaps. Every pre-merge claim in the SUMMARYs that this verifier re-ran held: the four gates, the census and parse-only check, the scan pins, the full-history scan over `--remerge-diff HEAD`, and a squash-shaped range scan. The remaining uncertainty is confined to four post-merge observations, the first of which is SC-1's own "green on its first run" clause.

---

_Verified: 2026-11-27T14:05:00Z_
_Verifier: Claude (gsd-verifier)_
