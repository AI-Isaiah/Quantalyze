---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
plan: 01
subsystem: secret-scan
tags: [security, secrets-scan, gitleaks, ci, PROOF-01, SECR-03]
requires: []
provides:
  - ".gitleaksignore: 31 four-part commit fingerprints in six commented groups, the suppression contract every gitleaks scan of this repo reads"
  - ".github/workflows/secret-scan-full-history.yml: daily cron plus dispatch scan of main's history (sha256-pinned gitleaks 8.30.1, redacted) and a report job that files one count-only issue"
  - "src/__tests__/secret-scan-full-history.test.ts: ignore-file shape pins, workflow pins each calibrated RED on a bad copy, and a real-binary scoping arm"
affects: [242-06]
tech-stack:
  added: []
  patterns: ["commit-scoped .gitleaksignore under whole-line reason comments", "calibration helper that also rejects a bad copy whose code (comments stripped) equals the real file"]
key-files:
  created:
    - .gitleaksignore
    - .github/workflows/secret-scan-full-history.yml
    - src/__tests__/secret-scan-full-history.test.ts
  modified:
    - vitest.node-env.ts
decisions:
  - "Calibration arms compare each bad copy's code, comments stripped, against the real workflow's, so a replacement that lands in a header comment is reported instead of silently passing (found when the first no --redact calibration edited the header)"
  - "The six reason-comment groups name the kind of site in words from the file names and the RESEARCH Reading column only; no variable name or value is quoted"
metrics:
  duration: "about 25 minutes"
  completed: 2026-11-27
status: complete
actuals:
  tokens: 9800
  tasks: 3
  commits: 2
plan_head_before: dc91a3a2f34f3187fec150f02fcae07f769093d3
plan_head_after: 743396ccd71edcfb7616eb622802315717ce7931
---

# Phase 242 Plan 01: Scheduled full-history secret scan Summary

A daily scan of the full history of main now runs with the repo `.gitleaks.toml` and a repo-root `.gitleaksignore` of 31 four-part commit fingerprints, reads zero over this branch's whole history, files one count-only deduplicated issue when red, and every property the decisions name is pinned and shown RED on a bad copy.

`commits: 2` and `plan_head_after` are measured at SUMMARY write time and cover the two task commits; the SUMMARY's own commit follows them.

## Scan counts

| | commits scanned | findings | per rule |
|---|---|---|---|
| plan time (origin/main `45d7b4e5c`) | 2743 | 31 | 30 generic-api-key, 1 jwt |
| execute time (origin/main `45d7b4e5c`, unchanged) | 2743 | 31 | 30 generic-api-key, 1 jwt, 31 distinct fingerprints across 22 files, the only distinct Secret value `REDACTED` |
| this branch's HEAD after the ignore file (Task 1) | 2750 | 0 | `no leaks found` |

The exact scan command the workflow runs, over this branch's HEAD with `--exit-code 2`, exited 0 and printed `no leaks found`, with 0 `Invalid .gitleaksignore entry` lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan premise wrong] An inline comment after a fingerprint is silent, with no `Invalid .gitleaksignore entry` warning**
- **Found during:** Task 3, row S-03
- **Issue:** the plan (Task 1 acceptance criterion 3 and S-03) expects a warn-level `Invalid .gitleaksignore entry` count of 1 after appending text to a fingerprint. Measured on gitleaks 8.30.1 at `--log-level warn` and at `--log-level debug`: 0 such lines. An inline comment without a colon leaves the line with four colon-separated parts, so gitleaks treats it as a well-formed fingerprint that matches nothing. The warning fires only for lines that do not split into 3 or 4 parts (a probe with `two:parts`, `solo` and `a:b:c:d:e` printed three warnings, so the check is live).
- **Fix:** no code change. The scan reads `leaks found: 1` for the voided line and no warning, which makes the vitest shape pin the ONLY guard for this trap. Recorded in row S-03.
- **Files modified:** none
- **Commit:** n/a

**2. [Process] Neuters were applied with a short Python replacement instead of the Edit tool**
- The plan says to apply each neuter with the Edit tool. Each was a one-line byte-exact replacement with the same effect, every file was backed up first with `cp`, restored with `cp`, and proved with `cmp` and `git diff --quiet`. No effect on the proof.

**3. [Tracked, no fix] S-06 and S-07 also redden the Task 1 arm, not only the Task 2 arm**
- The plan names the scan-command arm for S-06 and the checkout arm for S-07 as the first RED. Both neuters also fail the earlier Task 1 arm `workflow: the scan step runs gitleaks git over main's HEAD with the repo config, redacted` (it asserts `--redact` and `ref: main` too), which is declared first and so prints first. The plan's named arm is red as well in both rows.

## PROOF-01

Every non-natural row: (1) `cp` the file to the session scratchpad; (2) apply the neuter, nothing committed; (3) run and copy the first failing facts; (4) `cp` back, `cmp` (exit 0, no output) and `git diff --quiet -- <file>` (exit 0); (5) re-run for GREEN. Scan command (call it SCAN): `gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --no-banner --exit-code 2 --report-format json --report-path <scratchpad>/r.json`, with the findings read from the JSON report's File, RuleID and StartLine fields only. Q is `npx vitest run src/__tests__/secret-scan-full-history.test.ts --testTimeout=120000`.

| ID | Neuter | Command | RED | Restore | GREEN |
|---|---|---|---|---|---|
| S-01 scan-natural | natural: the Task 1 measurement before `.gitleaksignore` existed | SCAN over `--log-opts=origin/main` | RED: `leaks found: 31` over 2743 commits, 30 generic-api-key and 1 jwt (the exit code was not captured through the pipe) | n/a: the ignore file is the fix | GREEN: `no leaks found` over 2750 commits (HEAD, Task 1) |
| S-02 drop-one-line | delete the first fingerprint line of `.gitleaksignore` (the CHANGELOG.md site, rule generic-api-key, line 46, under the first group) | SCAN at `--log-level warn` | RED: `WRN leaks found: 1`, rc=2, `finding: CHANGELOG.md generic-api-key 46`, equal to the deleted line's last three fields | cmp: exit 0, no output | GREEN: `INF no leaks found`, rc=0, 0 invalid-entry warnings |
| S-03 inline-comment | append two spaces and a hash-x comment to the first fingerprint line | SCAN at `--log-level warn`; Q | RED: `WRN leaks found: 1`, rc=2, `finding: CHANGELOG.md generic-api-key 46`; `Invalid .gitleaksignore entry` count: 0 (see deviation 1, the line went inert with no warning). Q: `× ignore file: every entry is a four-part commit fingerprint with nothing after it`, `Tests  1 failed \| 12 passed \| 1 skipped (14)` | cmp: exit 0, no output | GREEN: `INF no leaks found`, rc=0; Q `Tests  13 passed \| 1 skipped (14)` |
| S-04 global-line | replace the first fingerprint line with its last three fields only | SCAN; Q | RED (Q): `× ignore file: every entry is a four-part commit fingerprint with nothing after it`, `Tests  1 failed \| 12 passed \| 1 skipped (14)`. SCAN: `INF no leaks found`, rc=0, GREEN, which is the trap: a global line suppresses that site in every commit, past and future, so a scan can never show it, and only the shape pin can | cmp: exit 0, no output | GREEN: SCAN `INF no leaks found`, rc=0 |
| S-05 workflow-trigger | add a pull_request trigger under `on:` | Q | RED: `× workflow: the triggers are schedule and workflow_dispatch only, on one daily cron`, `Tests  1 failed \| 12 passed \| 1 skipped (14)` | cmp: exit 0, no output | GREEN: `Tests  13 passed \| 1 skipped (14)` |
| S-06 workflow-redact | remove `--redact` from the scan step's command | Q | RED: `× workflow: the scan step runs gitleaks git over main's HEAD with the repo config, redacted`, then `× workflow: the scan command is main's HEAD, redacted, and never verbose`, `Tests  2 failed \| 11 passed \| 1 skipped (14)` | cmp: exit 0, no output | GREEN: `Tests  13 passed \| 1 skipped (14)` |
| S-07 workflow-scope | change `ref: main` to the dispatching ref expression | Q | RED: `× workflow: the scan step runs gitleaks git over main's HEAD with the repo config, redacted`, then `× workflow: the scan job checks out main with full history`, `Tests  2 failed \| 11 passed \| 1 skipped (14)` | cmp: exit 0, no output | GREEN: `Tests  13 passed \| 1 skipped (14)` |

Each non-natural row ended with `git diff --quiet` exit 0 on the restored file.

## Verification lines

- Q (final): `Tests  13 passed | 1 skipped (14)`. The behavioural arm ran (gitleaks 8.30.1 is on PATH); the one skip is the advertised-skip arm `it.skipIf(HAS_GITLEAKS)`, which runs only when the binary is absent.
- Behavioural arm result, over a throwaway repo with two runtime-built values at one file and line in two commits: no ignore file 2 findings, only the first commit's four-part line 1, the three-part global line 0, the four-part line plus an inline comment 2.
- `actionlint .github/workflows/secret-scan-full-history.yml`: exit 0, no output.
- Final suite run (the plan's nine files): `Test Files  9 passed (9)`, `Tests  456 passed | 2 skipped (458)` (the two skips are the two advertised-skip arms, in this file and in `gitleaks-allowlist.test.ts`).
- Range scan `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=origin/main..HEAD` after the two code commits: `9 commits scanned.` `no leaks found`. (9 commits: the 2 code commits plus the phase's planning commits ahead of origin/main.)
- Acceptance greps: ignore-file entries matching the four-part shape 31, not matching 0; merge-path trigger lines in the workflow 0; `vitest.node-env.ts` entries for the new test 1; `git diff --quiet origin/main -- .gitleaks.toml` exit 0; the dedup label appears once in the workflow, `issues: write` once, upload or git-write verbs 0, `-v` or `--verbose` 0.
- Note for the verifier: SC-1's "green on its first run" is a post-merge verification item. A scheduled or dispatched workflow registers only from the default branch, so the first real run is a `workflow_dispatch` on main after the code PR merges; record that run id and its `no leaks found` line then.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the scheduled workflow, which is in the plan's threat model (T-242-01 to T-242-05); the report job holds the sole `issues: write` scope and reads nothing but a count.

## Self-Check: PASSED

- `.gitleaksignore`, `.github/workflows/secret-scan-full-history.yml`, `src/__tests__/secret-scan-full-history.test.ts` exist; `vitest.node-env.ts` carries the new entry.
- Commits `97e065136` and `743396ccd` are ancestors of HEAD.
