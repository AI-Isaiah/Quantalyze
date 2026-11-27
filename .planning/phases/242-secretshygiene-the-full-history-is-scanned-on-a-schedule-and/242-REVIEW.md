---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
reviewed: 2026-11-27T11:06:38Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - .github/workflows/secret-scan-full-history.yml
  - .gitleaksignore
  - src/__tests__/secret-scan-full-history.test.ts
  - vitest.node-env.ts
  - supabase/migrations/20261127120000_cron_destinations_exact.sql
  - supabase/migrations/down/20261127120000-rollback.sql
  - supabase/schema/functions/cron_sync_tick.sql
  - supabase/schema/functions/match_engine_cron_tick.sql
  - supabase/schema/functions/ops_staleness_check.sql
  - supabase/schema/functions/prod_prober_cadence_check.sql
  - supabase/tests/test_cron_sync_tick.sql
  - supabase/tests/test_ops_staleness_check.sql
  - supabase/tests/test_prod_prober_cadence.sql
  - supabase/tests/test_analytics_service_settings_and_vault_tick.sql
  - scripts/mutation-floors.mjs
  - .github/workflows/ci.yml
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - docs/runbooks/match-engine.md
  - docs/runbooks/ops-staleness-go-live.md
  - docs/runbooks/prod-prober-cadence-go-live.md
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
  necessity: 0
status: issues_found
---

# Phase 242: Code Review Report

**Reviewed:** 2026-11-27T11:06:38Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 242 has two deliverables. SECR-03 is a scheduled gitleaks scan of main's full history, with a commit-scoped `.gitleaksignore` and a vitest pin. SECR-04 is a forward migration that narrows the analytics destination to two exact origins in the CHECK and in four SECURITY DEFINER bodies, and widens the blank-key trim to four whitespace characters. It comes with a manual rollback, gate arms W1/K1/P2/U3, and the census and floor moves.

**SECR-04 is correct. I found no defect in the migration, the rollback or the gate arms.** Each item below was checked against its source:
- **The re-based bodies.** I extracted each one and diffed it against the definition it replaces: `match_engine_cron_tick` from 20260911120000, `prod_prober_cadence_check` from 20260918120000, `cron_sync_tick` from 20261010140000 and `ops_staleness_check` from 20261020120000. Each diff contains exactly four kinds of change: the allow-list constant (pattern to `TEXT[]`), the guard (`!~` to `= ANY`), the key trim (`btrim(v_key)` to the explicit four-character set), and the refusal tail. Comments changed too. Every other line is byte-identical, including the dollar-quote tags.
- **Re-base targets are current.** No later migration redefines any of the four functions, either on this branch or on origin/main since `45d7b4e5c`.
- **The rollback.** Its four bodies are byte-identical (`cmp`) to the definitions this migration replaces. Its CHECK and COMMENT are the 20260907120000 text.
- **The snapshots.** The function text in each regenerated snapshot is byte-identical to the migration's body.
- **VAC-04 acks.** `node scripts/sql-body-normalize.mjs --diff-bodies` reads DRIFT for all four functions. In each case the `live` field equals that function's `prod-body-ack` pragma.
- **Mutation twins.** `node scripts/mutation-runner/run.mjs --parse-only` prints `arms: 0/1089/0`, `coverage: files 96/123` and `No static defects`, so every twin's `find`/`occurrences`/`nth` resolves. Each new twin's mutant is one the arm actually discriminates: W1 restores the suffix rule, K1 restores the bare `btrim`, P2 posts a fixed header, and U3 reinstalls the old CHECK. I traced K1 against each one-character omission from the trim set, and each omission still reddens it.
- **CI census.** The sum on `ci.yml`'s `ARMS_FLOOR=599` line is 599.
- **No other key-posting path.** Only these four functions post the key. The prober cron manifest, captured 2026-11-24, registers all four ticks and no inline key-posting command.

**SECR-03 has four Warnings, all about whether the scan can go red.** Running the deliverable locally with gitleaks 8.30.1 and the branch's `.gitleaksignore` gives zero findings over HEAD (2772 commits) and over current main (2709 commits). So it should be green on its first run. But measurement shows two gaps: the scan step reports clean when the underlying `git log` fails, and it never scans the diff a merge commit introduces. On top of that, neither the step's fail-red wiring nor the real-scanner arm is enforced in CI.

## Warnings

### WR-01: The scan step fails open when `git log` errors: gitleaks exits 0 with "0 commits scanned"

**File:** `.github/workflows/secret-scan-full-history.yml:81-104`
**Issue:**
- **Measured.** Running the step's command with a `--log-opts` value git rejects printed `ERR [git] ...` and `0 commits scanned`, then `no leaks found`. gitleaks exited **0** and wrote a report of `[]`.
- **What the step does with that.** It treats rc 0 as clean and has no floor on the number of commits scanned. The count step reads `[]` and sets `findings=0`, the `scan` job succeeds, and `report` never runs.
- **Consequence.** Any condition that makes gitleaks' internal `git log` fail produces a green "clean" verdict while scanning nothing. Examples: a ref that does not resolve, a git safe-directory refusal, or a future edit to `--log-opts`. This is the one property the workflow exists to guarantee.

**Fix:** Make the step prove it scanned the history. Capture gitleaks' stderr, refuse any `ERR` line, and require that the scanned-commit count equals `git rev-list --count HEAD`.
```bash
log="${RUNNER_TEMP}/gitleaks.log"
gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --no-banner \
  --exit-code 2 --report-format json --report-path "${report}" 2> >(tee "${log}" >&2)
rc=$?
want=$(git rev-list --count HEAD)
got=$(sed 's/\x1b\[[0-9;]*m//g' "${log}" | grep -aoE '[0-9]+ commits scanned' | grep -aoE '^[0-9]+' || echo 0)
if grep -aq ' ERR ' <(sed 's/\x1b\[[0-9;]*m//g' "${log}") || [ "${got}" -ne "${want}" ]; then
  echo "::error::MEASURE_FAIL: gitleaks scanned ${got} of ${want} commits or logged an error; the scan did not cover main's history."
  exit 1
fi
```
Pin it in the vitest file with a predicate and a calibration copy (see WR-02). If WR-03's merge-diff option is adopted, re-measure what the scanned-commit count means before comparing it with `git rev-list --count`.

### WR-02: Nothing pins the scan's fail-red wiring; a copy that can never go red passes every arm

**File:** `src/__tests__/secret-scan-full-history.test.ts:194-204` (`scanCommandProblems`) and the predicate set at lines 166-265
**Issue:**
- **What the test does not check.** No predicate mentions `--exit-code`, `exit "${rc}"`, `continue-on-error` or `|| true`. `grep -nF` over the file finds `--exit-code` only in the behavioural arm's own spawn (line 401).
- **Copies that pass anyway.** Each of these edits passes `triggerProblems`, `checkoutProblems`, `scanCommandProblems`, `binaryPinProblems`, `reportEscapeProblems`, `issuesWriteProblems` and `reportJobProblems`:
  - `--exit-code 2` changed to `--exit-code 0`;
  - the step's trailing `exit "${rc}"` changed to `exit 0`;
  - `continue-on-error: true` added to the scan step.
- **Consequence.** In every case the `scan` job reports success on findings, the workflow stays green, and `report` (gated on `needs.scan.result != 'success'`) never files the issue. The file's header says each predicate is calibrated so that "a predicate that cannot fail is caught". But the property this workflow most depends on has no predicate at all.

**Fix:** Add a `failRedProblems(text)` predicate over the comment-stripped `scan` job. It requires `--exit-code 2` on the gitleaks line and `exit "${rc}"` as the step's final statement. It refuses `continue-on-error` anywhere in the job and refuses `|| true` / `|| :` after the gitleaks invocation. Give it calibration copies for all three edits above. The WR-01 coverage check belongs in the same predicate.

### WR-03: Merge commits' own diffs are never scanned, so "full history" misses merge-only content

**File:** `.github/workflows/secret-scan-full-history.yml:85` (and the claims at lines 6-9)
**Issue:**
- **What gitleaks runs.** With `--log-opts=HEAD`, gitleaks spawns `git log -p -U0 HEAD`, as observed in the process list during the local run. Unless a `--diff-merges` variant is given, `git log -p` prints no patch for a merge commit.
- **Measured in a throwaway repo.** Content added only inside a merge commit (a conflict resolution or an "evil merge") was missed by both the default invocation and `--log-opts=HEAD`. Each reported `3 commits scanned`, `no leaks found` for a four-commit history.
- **Control.** The same runtime-built fixture committed normally exits 2.
- **Exposure on main.** main has 93 merge commits (the newest dated 2026-08-02). Their resolution content has never been scanned by this workflow. If main ever takes a merge commit again, its resolution will not be scanned either.
- **Consequence.** The header says "any NEW credential committed to main turns it red". That claim is false for merge-only content.

**Fix:** In the same throwaway repo, `--log-opts="--remerge-diff HEAD"` was parsed by gitleaks 8.30.1 (git 2.39) and reported the merge-only fixture as one finding at the merge commit. `--diff-merges=first-parent` also caught it, and `--cc` did not. `--remerge-diff` shows only what a merge's resolution changed, so it adds the least noise.

Adopting it means two things:
- Re-measure main with it first, and suppress any new merge-commit fingerprints by the same four-part rule.
- Pin the new log-opts in `scanCommandProblems`.

Until then, narrow the header's claim so it does not cover merge resolutions.

### WR-04: The real-scanner arm, the one that proves the ignore-file semantics, never runs in CI

**File:** `src/__tests__/secret-scan-full-history.test.ts:383-471`
**Issue:**
- **What the arm is for.** The behavioural arm is the file's evidence for the three properties the shape pin rests on:
  - a four-part line suppresses one commit;
  - a three-part line suppresses every commit;
  - an inline comment voids the line.

  Its comment says this is "so the pin cannot be a belief about gitleaks".
- **It is skipped in CI.** It runs only under `it.skipIf(!HAS_GITLEAKS)`. In `ci.yml`, gitleaks appears only in the `secret-scan` job (through `gitleaks-action`), so no vitest shard has the binary on PATH. CI therefore always takes the skip branch, and the companion arm `expect(HAS_GITLEAKS).toBe(false)` passes.
- **Consequence.** In CI those semantics are never re-measured. A gitleaks bump that changed the fingerprint format or how `.gitleaksignore` is read would leave this file green. The shape regex at line 46 would then guard a format the scanner no longer honours.
- **Precedent.** This matches `src/__tests__/gitleaks-allowlist.test.ts`, so it follows the repo's convention. The convention still leaves the arm unable to fail where it matters.

**Fix:** Run the arm where the pinned binary exists. One option is a step in `secret-scan-full-history.yml`, after the install step, that runs `npx vitest run src/__tests__/secret-scan-full-history.test.ts` with gitleaks on PATH. That step needs Node and dependencies. The other option is to install the sha256-pinned binary (the same step) in one vitest shard. In either case, make the skip arm fail when `CI` is set, so a lost binary goes red instead of skipping.

## Info

### IN-01: Two self-tests and a restore fixture still model the old suffix-rule CHECK

**File:** `scripts/test-only-normalize-analytics-url.sh:488-490`, `scripts/restore-test-from-baseline.sh:4139` and `:4193`, `scripts/restore-test-from-baseline-fixtures/baseline-fixture.sql:117`
**Issue:**
- **What they still spell.** Each self-test builds its own `system_settings` with the old suffix-pattern CHECK and seeds a sibling host under the Railway domain. The CHECK this phase installs refuses that host. The normalizer's comment calls it "its real allow-list constraint". The restore self-test's copy even admits any loopback port.
- **Why nothing breaks.** Every leg inserts under its own hand-written CHECK, never under `baseline.sql`'s.
- **Why it still matters.** The models now describe a constraint that no environment carries. That leaves the "two spellings of one rule" the phase's CONTEXT cites Rule 7 against.

**Fix:** Point both self-tests' CHECK at the two-origin equality, and seed a stand-in that the real CHECK admits. Or say in each fixture that it deliberately models a pre-Phase-242 shape.

### IN-02: Stale comments inside the live function source and a gate

**File:** `supabase/migrations/20261127120000_cron_destinations_exact.sql:210` and `:370`; `supabase/tests/test_cron_sync_tick.sql:370`
**Issue:**
- **Line 210** (`match_engine_cron_tick`) still says "The CHECK constraint in STEP 1b". In this file the CHECK is STEP 1.
- **Line 370** (`prod_prober_cadence_check`) cites "STEP 1b of 20260907120000", a constraint this migration has just replaced.
- **Both live in the function source.** Both land in `prosrc` and in `pg_get_functiondef`.
- **The gate's U1-SETUP comment** says "V2 left a blank one". K1 now runs between them and leaves the whitespace key.

**Fix:** Point both body comments at this migration's STEP 1. Change the U1-SETUP comment to "K1 left a whitespace one". Note that body comments are diffed by VAC-04 and by the snapshots, so fold the change into this migration before merge rather than into a later one.

### IN-03: The destination guard does not refuse a NULL url on its own

**File:** `supabase/migrations/20261127120000_cron_destinations_exact.sql:221`, `:375`, `:465`, `:668`
**Issue:**
- **The NULL case.** For a NULL `v_url`, `IF NOT (v_url = ANY (c_allowed_origins))` evaluates to NULL, and plpgsql does not take the branch.
- **Who catches it instead.** NULL is refused only by the preceding `IF v_url IS NULL OR v_url = ''` guard. Each gate's U1 twin shows this: standing that guard down lets the tick post to a NULL url.
- **Not a regression.** The replaced `v_url !~ c_url_allowed` behaved the same way.
- **The tension.** The comments call this re-test "the last thing between an admin-writable row and a live service key in an outbound header". On its own it does not cover NULL.

**Fix (optional):** `IF (v_url = ANY (c_allowed_origins)) IS NOT TRUE THEN` refuses NULL by itself. The guard line is a twin `find` string in four gates, so changing it moves every twin that names it.

### IN-04: The loopback origin stays admissible on PROD, so an app-admin can silently mute all four ticks

**File:** `supabase/migrations/20261127120000_cron_destinations_exact.sql:140` and each body's `c_allowed_origins`
**Issue:**
- **What an admin can do.** `system_settings_admin_all` is FOR ALL TO authenticated. An app-admin can point PROD's row at the loopback discard literal, which both layers admit by design.
- **What follows.** All four ticks then post to a closed local port. That includes the two alarms, `prod_prober_cadence_check` and `ops_staleness_check`. `net.http_post` is fire-and-forget, so every tick returns a request id and nothing reports the muting.
- **Status.** This was already possible under the old rule. CONTEXT records the two-origin set as a decision. It is a residual, not a regression.

**Fix:** None required for this phase. If it is ever closed, the loopback admission could be made conditional on the database marker, or a prober arm could alarm when PROD's row equals the loopback literal.

### IN-05: `.gitleaksignore` entries are not checked to name commits on main

**File:** `src/__tests__/secret-scan-full-history.test.ts:46` (`ENTRY_RE`) and `.gitleaksignore`
**Issue:**
- **What the shape test accepts.** Any 40-hex commit.
- **The self-suppression path.** CI's PR-range `secret-scan` reads the PR head's `.gitleaksignore`. A PR can therefore commit a value and, in a later commit, a four-part line for that first commit, and its own PR scan stays green.
- **The backstop and its limit.** The scheduled scan catches it after the squash merge, because the squash commit has a different SHA. But that is up to a day later, and the value was already public on the PR branch.
- **The stale-entry path.** An entry whose commit is not on main is either dead or a self-suppression of this kind.

**Fix:** Add a step to the scheduled workflow, which has full history. For each entry it runs `git merge-base --is-ancestor <commit> HEAD` and `git cat-file -e <commit>:<file>`, and fails on any miss.

---

_Reviewed: 2026-11-27T11:06:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 1 — silent-failure-hunter findings (MEDIUM+), recorded by the orchestrator

- **SFH-M1 (MEDIUM, same defect as WR-02):** the scan's fail-red contract is unpinned in `src/__tests__/secret-scan-full-history.test.ts` (`scanCommandProblems`): `continue-on-error: true`, `|| true`, a removed `exit "${rc}"`, or `--exit-code 0` each keep every arm green.
- **SFH-M2 (MEDIUM, same defect as WR-04):** the real-binary arm skips on every CI shard (no gitleaks on PATH) and the replacement "advertises skip reason" arm can only pass, so nothing in CI proves the pinned gitleaks treats a three-part line as global and an inline comment as inert.

Disposition: WR-01 and WR-03 are phase-goal gaps (a scan that reports clean when it scanned nothing, and merge-commit content the "full history" scan never reads), so a fixer round runs and fixes every MEDIUM+ finding: WR-01, WR-02/SFH-M1, WR-03, WR-04/SFH-M2. migration-reviewer and rls-policy-auditor reported 0 findings at any severity on the migration and its rollback.

## Fix round 1

**Fixed:** 2026-11-27. **Commits:** `e52c6442d` (WR-01, WR-03), `d0aed2a24` (WR-02 / SFH-M1), `bb22a00b6` (WR-04 / SFH-M2), `8c9b2644d` (fixture determinism, found while doing WR-04).
**Fixer:** Claude (gsd-code-fixer), run directly in the phase worktree at the orchestrator's instruction (no nested worktree).
**Gates ran in:** the phase worktree itself, gitleaks 8.30.1, git 2.39.5, actionlint, vitest 5.0.5.

### Measurements (WR-03, WR-01)

| | before (`--log-opts=HEAD`) | after (`--log-opts="--remerge-diff HEAD"`) |
|---|---|---|
| commits reachable (`git rev-list --count HEAD`) | 2881 | 2881 (merge commits: 99) |
| gitleaks "commits scanned" | 2773 | 2781 |
| findings with the current `.gitleaksignore` | 0 | **0** (no new merge-commit fingerprints needed) |
| runtime | 1m49s | 48s |

- `git rev-list --count HEAD` is **not** what gitleaks counts: it scans a commit only when its patch holds a non-binary file that is not a pure deletion. The workflow's `want` is therefore `git log --remerge-diff --diff-filter=d --numstat --format='commit %H' HEAD` counted per commit with a non-binary numstat row. Measured equal to gitleaks on both forms (2773 plain, 2781 remerge; 2785 at the final HEAD, which grew by this round's own commits).
- `--log-opts="--remerge-diff HEAD"` is accepted by gitleaks 8.30.1 and still covers ordinary commits (the 8 extra are merge commits). No credential-looking finding appeared, so nothing was added to `.gitleaksignore` and nothing needed escalating.
- `.gitleaksignore`'s and the issue body's reproduction commands now use the same log-opts form.

### Flake found and fixed (not in the review)

A random `api_key = "<base64url>"` plant was missed by the generic rule in 4 of 150 throwaway repos (2.7 percent; a hex variant missed 32 of 150). The real-binary vitest arm failed once on it during this round, and the new self-test would have been a daily false red. Both now plant a private-key block built at runtime (0 misses in 150), with every line differing between the two commits so the second commit's `-U0` hunk is a whole block. The source text carries no key-shaped literal.

### PROOF-01

In-place neuter of `.github/workflows/secret-scan-full-history.yml` from a byte backup (`cp`), the vitest file run, restore by `cp`, `cmp`. Every restore printed `cmp` identical, and the final file is byte-identical to the committed one (`wf_identical`); the final run is GREEN (see Verification). Arm names are the vitest names, shortened here.


The neutered edits, in order: `--exit-code 2` to `0`; `continue-on-error: true` on the scan step; a final `exit 0`; `|| true` after the gitleaks command; the ERR-line check removed; the commit-count comparison removed; log-opts back to plain `HEAD`; self-test without the exit-2 demand; self-test without the suppression count; self-test step removed. Each reddened only the named arm(s).

Runtime behaviour of the two new steps, run as extracted scripts (exit codes follow from the `exit 1` after each `MEASURE_FAIL` line; the pipe here hid them):

```text
=== B0 real selftest.sh
gitleaks self-test passed
exit=
=== B3 selftest, log-opts=HEAD (blind to merge-only content)
::error::MEASURE_FAIL: gitleaks self-test: expected 2 findings (ordinary commit and merge-only), got 1.
exit=
=== B4 selftest, suppression line carries an inline comment (inert line)
43c43
< printf '# self-test\n%s\n' "${fp}" > .gitleaksignore
---
> printf "# self-test\n%s  # inline\n" "${fp}" > .gitleaksignore
::error::MEASURE_FAIL: gitleaks self-test: a four-part line did not leave exactly one finding.
exit=
=== B1 scan step, a log-opts git rejects (nosuchref)
1:23PM INF 0 commits scanned.
1:23PM INF scanned ~0 bytes (0) in 35.7ms
1:23PM INF no leaks found
gitleaks exit code: 0
::error::MEASURE_FAIL: gitleaks scanned 0 of 2785 commits or logged an error; the scan did not cover main's history.
exit=
=== B2 scan step, expected count off by one
1:24PM INF 2785 commits scanned.
1:24PM INF scanned ~347435700 bytes (347.44 MB) in 41.8s
1:24PM INF no leaks found
gitleaks exit code: 0
::error::MEASURE_FAIL: gitleaks scanned 2785 of 2786 commits or logged an error; the scan did not cover main's history.
exit=
```

### Verification

- `npx vitest run src/__tests__/secret-scan-full-history.test.ts src/__tests__/critical-regressions.test.ts src/__tests__/gitleaks-allowlist.test.ts --testTimeout=120000`: Test Files 3 passed (3), Tests 222 passed | 1 skipped (223).
- The real-binary arm ran 8 times in a row after the fixture change: 15 passed each time.
- `actionlint .github/workflows/secret-scan-full-history.yml`: clean.
- `gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD" --redact --no-banner`: 2785 commits scanned, no leaks found.
- `gitleaks git . --config .gitleaks.toml --log-opts=origin/main..HEAD --redact --no-banner`: 34 commits scanned, no leaks found.

### Residuals

- WR-04 was fixed by the in-workflow self-test, not by running vitest where the binary exists. The vitest arm still skips on CI shards; the scheduled workflow is where the pinned binary's semantics are re-measured daily. The vacuous `expect(HAS_GITLEAKS).toBe(false)` arm was removed.
- CI's own PR-range `secret-scan` job (gitleaks-action) still uses its default log options, so a merge commit on a PR branch is not remerge-scanned there; main's daily scan now is.
- The count check assumes gitleaks keeps counting "commits with a non-binary, non-deleted file". A gitleaks bump that changes that fails the scan red (fail-closed) and the self-test line in the log names the cause.
- Info findings IN-01..IN-05 were out of scope and are untouched.
