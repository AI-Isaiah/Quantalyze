---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-26T10:45:00Z
round: 2
depth: standard
# Round 2 scope: PR-3 (plan 19, migration B re-based on main), `git diff origin/main...HEAD -- . ':!.planning'`
# at head af2e92600 on gsd/phase-225-oneaccountonce. origin/main read at f34c9cacd (one commit ahead of the
# branch's merge parent 2aa1a0cbb). Every verdict below is bound to af2e92600 unless it says otherwise.
files_reviewed: 11
files_reviewed_list:
  - supabase/migrations/20261126102346_api_keys_venue_server_index.sql
  - supabase/migrations/down/20261126102346-rollback.sql
  - supabase/schema/functions/reconnect_allocator_api_key.sql
  - supabase/tests/test_api_keys_venue_identity_uniq.sql
  - supabase/tests/test_api_keys_account_identity.sql
  - scripts/mutation-floors.mjs
  - scripts/accounttruth-census.mjs
  - src/__tests__/accounttruth-census.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
findings:
  critical: 1
  warning: 0
  info: 3
  total: 4
  necessity: 0
status: issues_found
---

# Phase 225: Code Review Report, PR-3 round 2 (plan 19, migration B re-based)

**Reviewed:** 2026-11-26T10:45:00Z
**Head:** af2e92600 (branch `gsd/phase-225-oneaccountonce`); origin/main read at f34c9cacd
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

I read the 11-file diff against `225-19-PLAN.md` (its must_haves and Task 1/2 acceptance), `225-19-SUMMARY.md`, round 1 (`225-REVIEW-PR3.md`) and the repo CLAUDE.md migration rules. I also read `$HOME/.claude/gsd-core/references/necessity-review.md`; no necessity finding survived its evidence rule.

There is **one BLOCKER and no MEDIUM**. The re-base work holds: the merged gate, the reconnect body, the census pins and the ack all verified clean. The problem is the migration's NAME. origin/main moved after the rename, and B is now backdated against both main and the PROD ledger.

### Verified clean at af2e92600 (each one measured, not assumed)

- **Merged uniq gate.**
  - `RED-UNDER-SETUP` has 18 entries. All exist. Main's list ends with plan 13's `20261125132334_api_keys_venue_server_owner_read.sql`, then B comes LAST (`:68`).
  - All seven 6v arms are present, and their bodies and twins are unchanged from origin/main. The only 6v-region change is the section-header comment (`:866-871`). The seven are `6v-writes`, `6v-writes-ws`, `6v-omitted`, `6v-check-blank`, `6v-check-ws`, the narrowed `6v-no-grant` and `6v-owner-read`.
  - All five 6s arms are present: `6s-null-null` (before 6a), `6s-two-servers`, `6s-same-server`, `6s-null-vs-set` and `6s-two-owners`.
  - The final NOTICE (`:1162`) names all twelve.
  - Every 6s twin and the rewritten arm-2 and 6f twins are `sql` steps, so none has a find needle.
  - The five 6v `edit` twins each find exactly 1 occurrence in `20261123180000_api_keys_venue_server.sql`, as declared.
  - No conflict markers.
- **Account-identity gate twins.**
  - The nine RECON `edit` twins now target `20261126102346_api_keys_venue_server_index.sql`. Each `find` occurs exactly once in that file, matching `occurrences: 1`. The nine are the five retargeted (`RECON-twin`, `-ok`, `-hist`, `-tenant`, `-other-exchange`) and the four new `RECON-server-*`.
  - The header's copy of the server line starts `--   AND`, so it does not count.
  - The setup list (33 entries) ends `20261123180000`, then B.
  - I traced the arm ordering by hand under each RECON-server twin. Each twin's own arm is the first to redden. Earlier fixtures carry NULL servers, and on those every edited line agrees with the pristine one.
  - **Retargeting was required, not cosmetic.** B is now the latest definition, so an edit to 20260925120000 would be overwritten by B at replay.
- **Old name gone.** `grep -a -rn 20261125083433 --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .` prints nothing. The new name appears only in B, its rollback, both gates and the snapshot source line. The placeholder `20261126180000` appears nowhere outside `.planning`.
- **Reconnect re-base.**
  - I extracted the function from `20260925120000_api_keys_account_identity.sql` and from B and ran `diff`. B differs by exactly four things: the `v_venue_server TEXT` declaration, `venue_server` in the SELECT/INTO, a three-line comment, and the one EXISTS line `AND (s.venue_server IS NULL OR v_venue_server IS NULL OR s.venue_server = v_venue_server)`.
  - The committed snapshot body is byte-equal to B's body.
  - The rollback's body is byte-equal to 20260925120000's.
  - The REVOKE/GRANT pair is that migration's, verbatim.
  - Six migrations mention `reconnect_allocator_api_key`. Only 20260422101911, 20260925120000 and B define it. 20260927180000 names it in a COMMENT string only.
  - `npm run schema:functions:check`: `SQL function snapshot is current (142 functions).`
- **prod-body-ack `8ebf2301…`.** I reproduced it both ways the PR claims:
  - against `git show origin/main:` of the snapshot;
  - through VAC-04's own path: `--extract-fn supabase/schema/baseline.sql reconnect_allocator_api_key`, then `--diff-bodies`.

  Both print `DRIFT … f2e69a2d… 8ebf230179b99d1f49cc8ed959ad2f7386aad92b592722c4825bc7aa1bd43c74 6`. The baseline dump on the branch is byte-identical to origin/main's (same sha256 prefix). `scripts/prod-body-drift-check.sh:1303` matches `-- prod-body-ack: ${live_hash}` with `grep -F` across the changed files, and B carries the line once. The ack is still earned only by VAC-04 against live PROD on the PR (it fails closed).
- **Census pins agree with parse-only.**
  - `node scripts/mutation-runner/run.mjs --parse-only` at af2e92600 printed `coverage: files 94/121` and `arms: 0/1042/0` with no static defects.
  - `ARMS_FLOOR=1042`, `FILES_FLOOR=94` and `WAIVED_CEILING=0` agree with it. So do `armsSeen` 1042, `totalAnchored` 1042, the synthetic FULL log, the gate-family-meta key, and the per-file rows 18/20/20/20 and 45/45/45/45.
  - `stepsSeen` and `needles.length` rose 1186 -> 1190. That is the four RECON-server `edit` steps; the 6s twins are `sql` steps.
  - `npx vitest run` on the four census suites: `Test Files 4 passed (4)`, `Tests 316 passed (316)`.
- **Other static gates.**
  - `lint-migration-data-dependence`: `83 refusal(s), 83 allowlisted, 0 NEW`.
  - `lint-sql-gates`: `0 finding(s)`.
  - B's DO block reads `pg_catalog` only.
  - The rollback is one BEGIN…COMMIT, with a catalogue-only precondition (`indnkeyatts = 4`) and a catalogue-only verify.
- **Index DDL.**
  - Same name, same predicate, plus `(COALESCE(venue_server, ''))`. The new key is strictly finer, so the build cannot fail on stored rows.
  - No FK or constraint depends on the index (grepped migrations and the baseline).
  - No other `supabase/tests` file asserts a 23505 from it.

### Not run by me

- **The narrowed lane mutation runs** (`arms: 20/20/0`, `biting: 20`; `arms: 45/45/0`, `biting: 45`). These figures come from `225-19-SUMMARY.md`. The runner's `edit` steps rewrite migration files in place, and this worktree is read-only for me.
- **The round-1 CR-01 premise** (every same-owner reader is server-aware after PR-2b-2) was checked at grep depth only. `account_identity_tokens` documents the server-aware rule. The derive's key select at `job_worker.py:17247` now loads `venue_server`. `departed-history.ts` and `commit_scenario_batch.sql` reference `venue_server`. I did not re-trace those readers' behaviour.
- **No PROD read.** Plan 19 Task 3 is the orchestrator's.

## Critical Issues

### CR-01 (BLOCKER): migration B is backdated again; origin/main and PROD now carry 20261126130000, which is later than 20261126102346

**File:** `supabase/migrations/20261126102346_api_keys_venue_server_index.sql` (the filename) and `supabase/migrations/down/20261126102346-rollback.sql`

**Issue:**
1. origin/main moved after the branch's merge (`2aa1a0cbb`). Commit `f34c9cacd` (v0.133.90.0, Phase 238 NEVERCOMPUTED PR-2, #1363) adds `supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql`.
2. `git rev-list --count HEAD..origin/main` = 1.
3. That migration is APPLIED. `supabase-migrate.yml` run `45800983848` for head `f34c9cacd` reports `apply-test success` and `apply success` (the PROD apply), plus `redump-pr success`. So the PROD ledger tip is now at least `20261126130000`. I inferred that from the PROD apply job, not from a PROD ledger read.
4. B's version `20261126102346` sorts before it. This breaks plan 19's must-have: "Migration B carries a fresh honest UTC name later than every migration on origin/main and the PROD ledger tip".
5. Consequence on the PR: `.github/workflows/migration-policy.yml:246-288` queries `MAX(version)` from the remote ledger, finds `20261126102346 < 20261126130000`, and fails with "Backdated migration additions detected without allowlist entry".
6. If that gate were bypassed, `db push --include-all` would gap-fill B into an older slot. That is the silent-history-rewrite shape the policy exists to stop. Task 3 step 2 would also STOP on it, but the committed file is wrong now and must change before PR-3 opens.

**Why "rename to the current UTC" is not enough today.**
- `20261126130000` is FUTURE-dated. It names 13:00:00Z, and it merged at 10:24Z.
- At review time `date -u` read `20261126103908`.
- No honest current UTC exceeds the tip before 13:00:00Z. The two halves of the name rule (honest current UTC, and later than the tip) can both hold only after 13:00Z.
- Choosing between waiting for 13:00Z and taking a non-current timestamp above `20261126130000` is an orchestrator call. The backdated allowlist is not an option (plan 19 forbids it, and so does the policy's own error text).

**Fix:**
1. `git fetch origin && git merge origin/main` (never rebase).
2. `git mv` B and its rollback to a 14-digit name later than `20261126130000`, and later than anything else that has landed by then. Re-read `git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3` immediately before choosing.
3. Replace `20261126102346` in every non-planning file: B (all 14 lines naming it: RAISE/NOTICE messages and the rollback pointer), the rollback, the snapshot's `-- source migration:` line, the uniq gate's setup line, and the account-identity gate's setup line plus its nine RECON twin `file` paths. Then confirm both of these print nothing:
   - `grep -a -rn 20261126102346 --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .`
   - `grep -a -rn 20261125083433 --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .`
4. Re-run the plan 19 Task 1 and Task 2 checks on the re-merged tree: `npm run schema:functions:check` (the snapshot source line moves), `--parse-only`, the four census vitest suites, and both narrowed lane runs.
   - Measured today, the census numbers should not move from the f34c9cacd delta alone. Main's floors are still `FILES_FLOOR = 94`, `ARMS_FLOOR = 1033` and `WAIVED_CEILING = 0`. `git diff --stat 2aa1a0cbb origin/main` over `scripts/mutation-floors.mjs src/__tests__ supabase/tests supabase/schema` touches only three vitest files and no gate file.
   - Anything else that lands before the re-merge must be re-measured, not assumed.
5. Append one dated line to `225-10-SUMMARY.md` and `225-19-SUMMARY.md` naming the second rename and its cause.

## Appendix: LOW / Info (recorded only, never fixed, per the repo rule)

- **IN-01 (LOW): the retargeted RECON twins' prose still names the old migration.** `supabase/tests/test_api_keys_account_identity.sql:1022, 1039, 1064, 1075, 1093`. The RED-UNDER text of RECON-twin, -ok, -hist, -tenant and -other-exchange says "in migration 20260925120000". Their `RED-UNDER-M` `file` now points at B. The machine-read field is right, but a reader following the prose edits the wrong file. If the fixer renames B anyway (CR-01), the prose could name B by its final name at no extra cost.
- **IN-02 (Info): round-1 Info items carried forward unchanged.** Round 1's IN-01, IN-03, IN-04 and IN-05 are still present, by disposition (recorded only):
  - the "race past this check still hits the index" comment, `20261126102346…sql:126` and the function COMMENT;
  - the thinner index COMMENT;
  - the rollback COMMENT;
  - the census note at `scripts/accounttruth-census.mjs:141-147`.

  Nothing in plan 19 changed them.
- **IN-03 (Info): `225-19-SUMMARY.md` says "All six 6v arms".** The merged gate has seven: `6v-writes`, `6v-writes-ws`, `6v-omitted`, `6v-check-blank`, `6v-check-ws`, `6v-owner-read` and `6v-no-grant`. This is planning prose only. The arms themselves are intact, and the NOTICE names all seven.

---

_Reviewed: 2026-11-26T10:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 2 dispositions (phase orchestrator, 2026-11-26)

Reviewers this round: gsd-code-reviewer (this file), silent-failure-hunter, migration-reviewer, rls-policy-auditor.

| Finding | Source | Severity | Disposition |
|---|---|---|---|
| CR-01: B's name `20261126102346` sorts below `20261126130000` (#1363, on main and applied to PROD) | code-reviewer, migration-reviewer (CRITICAL) | BLOCKER | FIX at ship time. #1358, ahead in the queue, carries `20261126140000`, so no honest UTC name sorts after both before 14:00Z. B is renamed to the current UTC after 14:00Z, after a fresh merge of origin/main, and migration-reviewer re-checks the rename. Never the allowlist. |
| M1: three comments claimed the index backstops the null-server case; it admits a null beside a set server, and reconnect's check-then-UPDATE has no lock | silent-failure-hunter | MEDIUM, data integrity | FIXED (wording) in `9f13c34ad`. The race needs an MT5 key with no server. PROD on 2026-11-26 holds 0 such keys, live or disconnected (one read-only count, marker first), and the connect writers refuse an MT5 key with no server (PR-2b-2, founder ruling CONTEXT Q6), so current writers cannot produce the pair. No lock was added (minimal-fix rule). |
| M2: the index compares `venue_server` byte for byte, and no CHECK enforces normalisation | silent-failure-hunter | MEDIUM, defence in depth, not user-facing | BOOKED in TODOS.md as `[225-VENUE-SERVER-NORMALISED-CHECK]`. Every writer normalises today; PROD holds 0 non-normalised servers (same read). The only fix is a new defensive constraint, which the minimal-fix rule keeps out of this PR. |
| RLS audit | rls-policy-auditor | none | CLEAN (0 at any severity). |
| Migration review other than CR-01 | migration-reviewer | none | CLEAN: re-base, ack `8ebf2301…`, ACL, index DDL, data-dependence lint (0 NEW). |
| LOW/Info (IN-01..IN-03 here; SFH LOW items) | all | LOW/Info | Recorded only, never fixed (repo rule). |
