---
phase: 163-harden-fail-safe-closed-and-loud
plan: 03
subsystem: repo-hygiene / CI gates
tags: [security, ci-gate, no-allowlist, scrub, sec-02]
status: complete
requires:
  - "scripts/check-route-contract.ts (skeleton the scanner is built on)"
  - "package.json lint chain (frontend-lint CI job, inside the `frontend` aggregator)"
provides:
  - "scripts/check-planning-hygiene.ts — no-allowlist local-identity scanner"
  - "npm run check:planning-hygiene + the lint-chain wiring"
  - "a tracked tree with zero username / absolute-home-path occurrences"
affects:
  - "every future PR: a new absolute path in any tracked file now fails `npm run lint`"
tech-stack:
  added: []
  patterns:
    - "scripts/check-*.ts gate chained into `npm run lint` (house precedent)"
    - "encoded needle so a scanner passes its own scan without a path carve-out"
    - "latin1 byte-exact reads for NUL-safety instead of grep semantics"
key-files:
  created:
    - scripts/check-planning-hygiene.ts
    - src/__tests__/check-planning-hygiene.test.ts
  modified:
    - package.json
    - .planning/REQUIREMENTS.md
    - "95 tracked files scrubbed (88 under .planning/, 5 under docs/, 2 applied Supabase migration headers)"
decisions:
  - "Scrubbed to ZERO raw prefix occurrences rather than to the `\\/Users\\/<user>/` placeholder form, because the plan's own Task-1 verify checks the bare prefix. The scanner still exempts the placeholder by value for future authors; that exemption is proven by unit test, not by tree contents."
  - "Applied-migration edits are comment-only and carry a RECORDED EXCEPTION header; precondition (version- vs content-hash reconciliation) verified read-only from two independent sources before any edit."
  - "Scanner reads latin1, not utf8 as the plan text suggested — same NUL-safety property, but byte-exact 1:1 with no replacement-character collapse."
metrics:
  duration: ~50 min
  completed: 2026-08-26
actuals:
  tokens: 47000
  tasks: 3
  commits: 3
---

# Phase 163 Plan 03: SEC-02 username + absolute-path scrub and no-allowlist gate Summary

Scrubbed the macOS username and local absolute home paths out of **95** tracked files
(~940 occurrences) and stood up `scripts/check-planning-hygiene.ts`, a zero-path-allowlist
scanner chained into `npm run lint` that fails the build on any recurrence — proven able
to fail from both directions.

## The live measurement (recorded PRE-EDIT)

Measured at `354aa53ec` with a NUL-safe node walk over `git ls-files`, before a single byte
changed:

| Figure | Live (2026-08-26) | What the record previously said |
|---|---|---|
| Tracked files scanned | 5693 | — |
| **Bearing files, tree-wide** | **95** | 94 (plan), 87 (RESEARCH) |
| — under `.planning/` | 88 | 80 / 87 |
| — outside `.planning/` | 7 (5 `docs/`, 2 applied migrations) | 7 ✓ |
| Username-bearing files | 87 | 80 |
| Absolute-home-path-bearing files | 68 | 57 → 59 |
| Dash-mangled-scratch-bearing files | 26 | not previously counted |
| Raw occurrences (all three classes) | 940 | — |

**The count drifted again during the phase itself.** The plan corrected RESEARCH's 87 → 94;
the live number was **95**. Every prior figure was an undercount, and the two smallest (80,
87) were `.planning/`-only unions that would have left the seven non-planning files leaking
on a public repo. This is the third consecutive re-measure to move the number — treat any
recorded count here as stale on sight and re-measure.

## What was scrubbed, and to what

| Shape | Occurrences | Rewritten to |
|---|---|---|
| absolute path into this repo | 372 | repo-relative (prefix deleted) |
| repo root, no trailing segment | 32 | `<repo-root>` |
| dash-mangled scratchpad dir name | 49 | `<project-scratch>` |
| other absolute home subpath | 6 | `<home>/…` |
| elided home path (`…/…`) | 6 | `<home>/…` |
| bare username | 5 | `<user>` |
| raw prefix in prose (naming the pattern) | 11 | escaped spelling |

Post-scrub the tree reads **0 of 5693**; the `wizardErrors` suite still passes 238/238,
which is the evidence that the NUL-carrying fixture came through the scrub untouched.

## Task 1 precondition — verified, not assumed

The plan made Task 1 HALT-if-content-hashed. Two independent **read-only** sources agree the
Supabase CLI reconciles applied migrations by VERSION:

- The installed CLI binary (v2.84.2) contains
  `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY)`,
  the reconciliation read `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`,
  and an upsert keyed `ON CONFLICT (version)`. There is no hash column and no content comparison.
- Upstream `pkg/migration/apply.go` `FindPendingMigrations` diffs version STRINGS parsed out
  of filenames; contents are never read for the comparison.

So the two comment-only edits cannot break `supabase migration list`. Both migrations carry a
`⚠️ RECORDED EXCEPTION` header naming the edit, the rule it deviates from (migration-reviewer
#11), and this evidence. `git diff --unified=0` confirms **every changed line in both files
begins with `--`** — zero SQL bytes moved.

## The gate

`scripts/check-planning-hygiene.ts`, three violation codes — `LOCAL-USERNAME`,
`ABSOLUTE-HOME-PATH`, `SCRATCH-HOME-PATH` — plus `EMPTY-SCAN`.

- **No path allowlist, at all.** Not for its own source, not for tests, not for
  `supabase/migrations/`, not for fixtures. A test drives five paths that a path-based
  allowlist would plausibly carve out and asserts each still fails.
- **One exemption, by VALUE:** the placeholder `<user>` immediately following a matched
  prefix. Nothing in the tree currently uses that form (the scrub went to repo-relative), so
  the exemption is exercised by unit test rather than by tree contents — deliberate, so a
  future author can legitimately write a placeholder example without being blocked.
- **Self-match solved by encoding, not by carve-out:** the needle is base64/char-coded and the
  docblock spells the patterns escaped. The scanner passes its own scan.
- **NUL-safe:** every file is read `latin1` (byte-exact 1:1). `git grep -I` was deliberately
  not used anywhere in this plan — it classifies the deliberate NUL in
  `src/lib/wizardErrors.test.ts` as binary and skips past it, so a miss there reads as clean.
- **Anti-vacuity:** zero files enumerated is `EMPTY-SCAN`, a failure; the success line always
  prints the scanned count (`5695 tracked files scanned`).
- **Wiring:** `npm run check:planning-hygiene` plus an `&&` link in `lint`, which runs in the
  `frontend-lint` CI job already inside the `frontend` aggregator's `needs:`. No workflow file
  changed. Deliberately NOT attached to `secret-scan` — outside the aggregator and already red
  on `workflow_dispatch`, so a violation there would gate nothing.

## How the gate was proven able to fail

Two neuters, opposite directions, both restored:

1. **Tree direction (green → RED → green).** With lint green, wrote
   `.planning/red-demo-scratch.md` containing one raw home-path prefix and `git add -N`-ed it
   so `git ls-files` would enumerate it. `npm run lint` exited **1** with
   `ABSOLUTE-HOME-PATH: .planning/red-demo-scratch.md:1 — …`. Deleted the file and un-staged
   it; lint exit **0** again.
2. **Source direction (the no-allowlist property itself).** Injected
   `if (relPath.startsWith("supabase/migrations/")) return violations;` into `scanFile` — the
   exact blindness the gate forbids. The suite went RED on precisely the right assertion:
   `supabase/migrations/20260517013000_applied.sql must not be exempted by path: expected []
   to have a length of 1 but got +0`. Restored from the commit; 0 `NEUTER` lines remain and the
   suite is 15/15 green.

The second proof matters more than the first: it shows the test that guards the gate's
defining property can actually fail, rather than only that the gate notices a fresh string.

## Tasks and commits

| Task | Name | Commit |
|---|---|---|
| 1 | Re-measure, verify the migration precondition, scrub 95 files | `95862ef66` |
| 2 | The no-allowlist scanner, wired into `npm run lint` | `e823549d0` |
| 3 | Record the four decisions in SEC-02 | `06b43531a` |

## Verification

| Check | Result |
|---|---|
| Plan Task-1 NUL-safe scan | `clean: 0 of 5693 tracked files` |
| `npx vitest run src/lib/wizardErrors.test.ts` | 238/238 pass |
| `npx vitest run src/__tests__/check-planning-hygiene.test.ts` | 15/15 pass |
| `src/__tests__/contracts/` (scan all of `src/` globally) | 109/109 pass, 5 files |
| `critical-regressions` + the 3 sibling scanner suites | 210/210 pass |
| `npm run lint` | exit 0 (3 pre-existing eslint warnings, 0 errors) |
| `npx tsc --noEmit` | exit 0 |
| `git diff --diff-filter=D` on each commit | 0 deletions |

## Deviations from Plan

### 1. [Rule 1 — correctness] Scrubbed the bare prefix, not to the placeholder path form

The plan's action text says to substitute the username segment with `<user>` (leaving
`\/Users\/<user>/…`), while the plan's own Task-1 `<verify>` fails on ANY occurrence of the
bare prefix. Those two cannot both hold. The verify is the executable contract, so absolute
paths were rewritten repo-relative (or to `<home>/…`), eliminating the prefix entirely — which
is also the plan's stated preference for paths pointing into the repo. The scanner still
implements the value exemption exactly as specified, so the instruction is honoured where it
is load-bearing (the gate's forward rule) rather than where it self-contradicts.
Files: the 95 scrubbed files. Commit `95862ef66`.

### 2. [Rule 1 — correctness] `latin1` reads instead of `utf8`

The plan specifies `readFileSync(..., "utf8")` for NUL-safety. `latin1` gives the same
property strictly more provably: a byte-exact 1:1 decode with no replacement-character
collapse over binary content, and the same encoding is used for the write-back in the scrub so
the NUL fixture round-trips byte-identically. Documented in the scanner docblock.
File: `scripts/check-planning-hygiene.ts`. Commit `e823549d0`.

### 3. [Rule 2 — missing coverage] Scanner also matches the dash-mangled form tree-wide

The dash-mangled scratchpad form was not counted in any prior measurement (26 files, 49
occurrences). It is a home path with the separators mangled — the same disclosure, so it gets
the same treatment and its own violation code. Two prose mentions of the pattern (in this
phase's own PLAN and RESEARCH) were rewritten to escaped spelling rather than deleted.

### 4. Stale integers corrected in `.planning/REQUIREMENTS.md`

SEC-02's line carried "80 files / 57 paths". Replaced with the live 95 / 5693 figures and an
explicit note that both 80 and 87 were `.planning/`-only. `.planning/ROADMAP.md` SC-4 still
quotes the old 80/57 in its historical prose; left alone as another plan's surface and
non-blocking (stale integer, not a false claim about behaviour).

## Known Stubs

None. The gate is live in the lint chain, scans the real tracked tree, and has been
demonstrated failing.

## Threat Flags

None. No new network, auth, file-access, or schema surface — the two SQL files changed only
comment bytes.

## Notes for the phase verifier

Sibling Wave-1 plans are writing their SUMMARYs into the same tracked tree while this ran. Any
of those artifacts that carries an absolute worktree or scratchpad path will now fail
`npm run lint`. **That is the gate working, not a defect** — scrub the offending artifact
(repo-relative paths, `<user>` placeholder, escaped spelling when naming the pattern) and
re-run. Re-running `npm run check:planning-hygiene` over the merged tree at the phase gate is
the intended step.

The SEC-02 checkbox is left unchecked; status is the phase verifier's call.

## Self-Check: PASSED

- Files exist on disk: `scripts/check-planning-hygiene.ts`,
  `src/__tests__/check-planning-hygiene.test.ts`,
  `.planning/phases/163-harden-fail-safe-closed-and-loud/163-03-SUMMARY.md`.
- Commits exist in the log: `95862ef66`, `e823549d0`, `06b43531a` (all on
  `worktree-agent-a7637a98ea98d1b57`, ahead of base `354aa53ec`).
- This SUMMARY was staged and `npm run lint` re-run over it: exit 0,
  `5696 tracked files scanned` — the artifact passes the gate it documents.
