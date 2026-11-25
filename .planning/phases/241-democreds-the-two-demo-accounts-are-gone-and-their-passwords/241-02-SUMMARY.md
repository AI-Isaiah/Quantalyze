---
phase: 241-democreds-the-two-demo-accounts-are-gone-and-their-passwords
plan: 02
subsystem: secret-guard
tags: [security, secrets-guard, lint-chain, PROOF-01, SECR-02]
requires: ["241-01"]
provides:
  - "scripts/check-demo-credential-digests.ts: whole-tree digest guard (four digest rows, role/path/line output, no path allowlist), chained into npm run lint"
  - "src/__tests__/check-demo-credential-digests.test.ts: one live-tree arm per role plus anti-vacuity, canary, edge and failure-text arms"
  - "e2e admin-gate test without Pair A literals, first arm now a structural no-quoted-credential check"
affects: [241-04]
tech-stack:
  added: []
  patterns: ["32-bit rolling fingerprint prefilter with sha256 confirmation over raw bytes", "whole-tree scan with EMPTY-SCAN, file and byte floors and a coverage arm against an independent git ls-files count"]
key-files:
  created:
    - scripts/check-demo-credential-digests.ts
    - src/__tests__/check-demo-credential-digests.test.ts
  modified:
    - src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts
    - vitest.node-env.ts
    - package.json
decisions:
  - "The guard's unreadable tracked paths are a violation (UNREADABLE) in scanTree, not only a list: a path that was not scanned cannot count toward a pass"
  - "One extra arm beyond the plan, 'the digest table has one row per role', so a dropped row cannot leave the live-tree arms vacuous"
metrics:
  duration: "about 1 hour 15 minutes"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 20000
  tasks: 3
  commits: 2
plan_head_before: 7ffa5e49d6e05744dbd4a06f49cf2caa0a68327e
plan_head_after: 86bdec6415fce929be4edbb2a429476965043cde
---

# Phase 241 Plan 02: Whole-tree demo credential digest guard Summary

A digest guard (rolling 32-bit fingerprint plus sha256 over every byte of every `git ls-files` path, no path allowlist, own source included) now fails `npm run lint` by role, path and line if any of the four demo literals returns, and every arm of it, plus the e2e structural arm, is shown RED and restored byte-exact.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) | `a500b0a72` | scripts/check-demo-credential-digests.ts, src/__tests__/check-demo-credential-digests.test.ts, src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts, vitest.node-env.ts, package.json |
| 2 | `86bdec641` | src/__tests__/check-demo-credential-digests.test.ts |
| 3 | this SUMMARY's own commit | 241-02-SUMMARY.md |

`commits: 2` in the frontmatter is the measured count of `plan_head_before..plan_head_after` at the moment the SUMMARY was written; the SUMMARY commit follows it. The ship branch for the code PR carries the five code files only and changes nothing under the planning directory.

## Pre-fix RED (PROOF-01 step 1, natural)

The guard landed before the e2e edit, so the first run on the real tree was a genuine RED. Quick command Q = `npx vitest run src/__tests__/check-demo-credential-digests.test.ts --testTimeout=120000`; lint link C = `npx tsx scripts/check-demo-credential-digests.ts`.

Q, first failing arms (the pair-B arms stayed GREEN; summary `Tests  2 failed | 4 passed (6)`):

```
× pair-A-login: no tracked file carries it 8ms
× pair-A-password: no tracked file carries it 1ms
+   "pair-A-login src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:67",
+   "pair-A-login src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:71",
+   "pair-A-password src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:72",
```

C, exit 1, exactly three offender lines:

```
[check-demo-credential-digests] 3 match(es):
  - pair-A-login src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:67
  - pair-A-login src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:71
  - pair-A-password src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:72
```

Pre-scrub tree (an archive of the Pre-scrub commit recorded in 241-01-SUMMARY, `64f809b4449d6fc68e3bdccca724bd3bdfb339f9`, scanned with the guard's own `scanTree`; 12,176 files listed, 12,176 scanned, 0 unreadable). The archive directory was deleted afterwards.

| Role | Distinct files | Hits |
|---|---|---|
| pair-A-login | 8 | 15 |
| pair-A-password | 8 | 11 |
| pair-B-login | 5 | 5 |
| pair-B-password | 1 | 1 |

This matches the RESEARCH census (8/15, 8/11, 5/5, 1/1).

## PROOF-01

Every non-natural row follows the same five steps: byte backup by `cp`, neuter or plant, run, restore by `cp` then `cmp` (no output, exit 0) then `git diff --quiet -- <file>` (exit 0), re-run. Nothing was committed while a plant or neuter was in the tree. The README target for the plants is the tracked README; the binary target is the tracked bootstrap PNG under the svg-chart-parity snapshots directory. No literal, email or digest appears in any row. Each captured RED output was also counted for the four literals afterwards (`literal-occurrences: ... =0` for all four roles in every row; logins counted case-insensitively).

| ID | Neuter or plant | Command | RED | Restore | GREEN |
|---|---|---|---|---|---|
| P-01 prefix-e2e | natural: the guard landed while the e2e test still held Pair A's two needle constants (2 login lines, 1 password line) | Q and C | RED: × pair-A-login: no tracked file carries it 8ms; × pair-A-password: no tracked file carries it 1ms; C exit 1 with the 3 offender lines above | n/a: fixed by the Task 1 edit | GREEN: Tests  11 passed (11) after the edit (Q plus the e2e test file) |
| P-02 prescrub-tree | natural: scan of the archived pre-scrub commit | scanTree over the archive | RED: pair-A-login 8 files / 15 hits; pair-A-password 8 / 11; pair-B-login 5 / 5; pair-B-password 1 / 1 | n/a: archive deleted | n/a: counts only, the live tree is GREEN (row P-03 GREEN) |
| P-03 plant-A-login | one line holding the pair-A-login literal appended to README.md | Q; C | RED: × pair-A-login: no tracked file carries it 8ms; C: pair-A-login README.md:170 (exit 1) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-04 plant-A-password | one line holding the pair-A-password literal appended to README.md | Q; C | RED: × pair-A-password: no tracked file carries it 6ms; C: pair-A-password README.md:170 (exit 1) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-05 plant-B-login | one line holding the pair-B-login literal appended to README.md | Q; C | RED: × pair-B-login: no tracked file carries it 6ms; C: pair-B-login README.md:170 (exit 1) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-06 plant-B-password | one line holding the pair-B-password literal appended to README.md | Q; C | RED: × pair-B-password: no tracked file carries it 6ms; C: pair-B-password README.md:170 (exit 1) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-07 plant-upper | the pair-A-login literal upper-cased, appended to README.md | Q | RED: × pair-A-login: no tracked file carries it 8ms | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-08 plant-crlf | the pair-B-password literal on a line ending in CRLF, appended to README.md | Q | RED: × pair-B-password: no tracked file carries it 6ms | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-09 plant-eof | the pair-A-password literal appended with no trailing newline | Q | RED: × pair-A-password: no tracked file carries it 6ms | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-10 plant-embedded | the pair-B-login literal with alphanumerics on both sides, appended to README.md | Q | RED: × pair-B-login: no tracked file carries it 9ms | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-11 plant-binary | the pair-A-password literal appended as raw bytes to the tracked PNG | Q | RED: × pair-A-password: no tracked file carries it 8ms | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-12 neuter-fold | script: the single fold helper returns its byte unchanged | Q | RED: × case: login rows fold case, password rows do not 8ms (only that arm failed: Tests  1 failed \| 14 passed (15)) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-13 neuter-start | script: the window-start condition requires one more byte, so offset 0 is missed | Q | RED: × edges: CRLF, offset 0, EOF without newline, embedded in a token, after NUL bytes 8ms (then, declared after it, the every-window arm: Tests  2 failed \| 13 passed (15)) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-14 neuter-skip | script: every path under the planning directory is skipped before reading | Q | RED: × coverage: every tracked file is read (scanned count equals git ls-files count, none unreadable) 46ms (then floors: Tests  2 failed \| 13 passed (15)) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-15 neuter-empty | script: the EMPTY-SCAN condition made unreachable (the push never runs) | Q | RED: × EMPTY-SCAN: an empty file list is a failure, not a pass 9ms (Tests  1 failed \| 14 passed (15)) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-16 neuter-confirm | script: the sha256 comparison made always false | Q | RED: × canary: a runtime-digested literal is found once, a clean buffer zero times 11ms (4 later arms also failed: Tests  5 failed \| 10 passed (15)) | cmp: exit 0, no output | GREEN: Tests  15 passed (15) |
| P-17 binding | one hex character of the pair-B-password row's sha256 flipped, plus the pair-B-password literal planted in README.md | Q three times | (a) with the row flipped: Tests  15 passed (15), GREEN while it should be RED (the row is what binds); (b) script restored by cp, cmp exit 0, plant still in place: RED: × pair-B-password: no tracked file carries it 16ms | cmp: exit 0, no output (script, then README.md) | (c) README.md restored by cp, cmp exit 0: GREEN: Tests  15 passed (15) |
| P-18 failure-text | during P-03, C's captured output was counted for the planted literal with `grep -acF -f` against a mode-600 pattern file (never printed) | C output | RED: C exit 1 with only `pair-A-login README.md:170`; occurrence count of the planted literal in C's output: 0 | cmp: exit 0, no output (P-03) | GREEN: Tests  15 passed (15) |
| P-19 e2e-structural | a synthetic quoted assignment to a `SYNTHETIC_PASSWORD`-named identifier (value visibly synthetic) appended to e2e/match-queue.spec.ts | `npx vitest run src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts --testTimeout=120000` | RED: × contains no quoted credential assignment in executable code 17ms (Tests  1 failed \| 4 passed (5)) | cmp: exit 0, no output | GREEN: Tests  5 passed (5) |

Notes on the table:
- P-17's first attempt exited 127 for every run because `$Q` is not word-split by this shell; nothing had changed (script and README cmp 0, diff quiet) and the whole row was redone with a shell function. The recorded lines are from the redo.
- P-15 describes "removes the push" as making its condition unreachable (`filesScanned < 0`), which is the same effect with a one-token edit.
- No seed pin changes in this phase ("Seed and drain coupling" is unchanged), so ROADMAP SC-4's "any changed seed pin" has no row.

## Verification lines

- Quick command after Task 2: `Test Files  1 passed (1)`, `Tests  15 passed (15)` (4 role arms, the table-shape arm, the wiring arm, and the 9 arms named in the plan).
- Guard CLI: `[check-demo-credential-digests] OK — 12188 tracked files, 263448564 bytes scanned against 4 digest rows; 0 matches.`
- Pre-push suite (the plan's list plus every `src/lib/*invariant*.test.ts`): `Test Files  28 passed (28)`, `Tests  956 passed | 1 skipped (957)`. The one skip is `it.skipIf(HAS_GITLEAKS)` in the gitleaks-allowlist test, which runs only when the gitleaks binary is absent; gitleaks is installed here, so that is by design.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0 (four pre-existing unused-variable warnings in files this plan did not touch), last link: `[check-demo-credential-digests] OK — 12188 tracked files, 263448564 bytes scanned against 4 digest rows; 0 matches.`
- `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=origin/main..HEAD` after the two code commits: `18 commits scanned.` `no leaks found`. The final scan after this SUMMARY's commit is quoted in the hand-off.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Unreadable paths are a violation, not just a list**
- **Found during:** Task 2
- **Issue:** The plan asked scanTree to record unreadable paths without counting them; a CLI that only listed them would still print OK for a tree it did not fully scan.
- **Fix:** each unreadable path also pushes an `UNREADABLE:` violation, which `main()` prints and exits 1 on.
- **Files modified:** scripts/check-demo-credential-digests.ts
- **Commit:** a500b0a72

**2. [Rule 2 - Missing critical functionality] A table-shape arm**
- **Found during:** Task 1
- **Issue:** if a digest row were deleted, its live-tree arm would pass vacuously.
- **Fix:** one extra arm, `the digest table has one row per role`, asserting the four roles in order. The plan's passed-count floor of 14 became 15.
- **Files modified:** src/__tests__/check-demo-credential-digests.test.ts
- **Commit:** a500b0a72

**3. [Rule 3 - Blocking] A scratch loader had to be recreated**
- Plan 01 had deleted its loader, so a new one was written in the session scratchpad (mode 700). It read both pairs from history into memory only (Pair A from the e2e test at the pre-scrub commit, Pair B from the removed lines of commit 65e1cc52), printed only roles, lengths, counts and the four digest rows, and was deleted at the end. Plants were appended by a script, never through a shell variable.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. The guard adds no network surface; it reads tracked files and writes to stdout only.

## Ship note

These five files ride the code PR, which opens only after plan 01's records PR has merged. VERSION, package.json version and CHANGELOG are not touched here; the orchestrator writes them at ship time.
