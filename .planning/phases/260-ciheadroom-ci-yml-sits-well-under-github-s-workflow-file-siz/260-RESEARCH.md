# Phase 260: CIHEADROOM - Research

**Researched:** 2026-11-27
**Domain:** GitHub Actions workflow hygiene; repo-internal CI test census (no external libraries)
**Confidence:** HIGH for the census and the measured numbers (every claim below was produced by running something in a scratch copy of this tree); MEDIUM for GitHub-side behaviour (doc-cited, one measured data point from the Phase 243 agent).

> **COURSE CHANGE (orchestrator, 2026-11-27, after the first draft of this research).** The headroom mechanism is no longer "move two `run:` bodies into scripts". It is now: **move long YAML-level comment blocks (comment lines outside any block scalar) into `docs/ci-yml-notes.md`, one section per job, leaving a one-line pointer comment in `ci.yml`.** No `run:` body moves, no executed YAML changes. Sections 1 to 6 below research THAT path. The earlier run-body-move census is kept as **Appendix A (fallback)** because it is measured, not re-derived, and is the answer if the comment move ever proves insufficient.
>
> **DEVIATION RECORD NEEDED (CLAUDE.md "Deviation policy").** `260-CONTEXT.md` `### Decided autonomously` bullets `[Headroom]` (all of them) and `[Readers]` and the ROADMAP `### Phase 260` Success Criterion 1 ("long inline `run:` bodies moved into checked-in scripts") still describe the run-body move. The override must be recorded in the phase's CONTEXT.md **and** the ROADMAP, never one alone. Not done by this research (planning files are the orchestrator's to edit).

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied from `260-CONTEXT.md`. Bullets marked **SUPERSEDED** are overridden by the orchestrator course change above; the `[Gate]` bullets are unchanged and still locked.

### Locked Decisions
- [Headroom] **SUPERSEDED** "Move the two largest run: bodies verbatim into checked-in bash scripts that the step calls with one line; the step keeps its name, if: and env:. Expected ci.yml after: about 382 KB, about 130 KB under the limit"
- [Headroom] "Strip or move the YAML comments instead (they are 237 KB)?" -> "No. The comments stay where they are" **SUPERSEDED** (this is exactly what the course change reverses).
- [Headroom] "Reusable workflows or composite actions?" -> "No" (still holds).
- [Headroom] "Script paths and names?" **SUPERSEDED** (`scripts/ci-sql-self-tests.sh`, `scripts/ci-sql-mutation-assert.sh`, no longer created).
- [Headroom] "Is the moved body byte-identical?" **SUPERSEDED**.
- [Headroom] "What happens to sql-mutation-nightly.yml's copy of the assert step?" **SUPERSEDED** (nightly untouched).
- [Headroom] "Do future phases that raise SENTINEL_FLOOR / ARMS_FLOOR edit ci.yml?" **SUPERSEDED** (they keep editing `ci.yml`; the floors stay in the `sql-tests` run body).
- [Gate] "A new workflow file, `.github/workflows/workflow-size.yml`, one job `workflow-size`, on pull_request (no paths filter, so it is always in the check count), push to main and workflow_dispatch; it checks out the repo and runs `node scripts/check-workflow-size.mjs`" - a new workflow file is deleted to undo; it never shares a file with ci.yml, so an oversized ci.yml cannot suppress it.
- [Gate] "Hard limit 512,000 bytes as measured; the gate fails any workflow file above 460,800 bytes (90 percent, a 51,200-byte margin), and prints every file's size, its headroom to the ceiling and to the hard limit. A file within 10 percent of the ceiling prints a ::warning:: but passes" - two constants in one script.
- [Gate] "`--self-test` builds a temporary over-ceiling file and an under-ceiling file, asserts red then green, and the workflow runs the self-test before the real scan; a vitest test pins the script's verdicts and the workflow wiring too" - tests are local.
- [Gate] "Every regular file matching `.github/workflows/*.yml` or `*.yaml`; an empty match is an error, never a pass" - local.
- [Readers] "They read the script file, and each also asserts the ci.yml step still calls that exact script ..." **SUPERSEDED** (no reader needs to follow a moved body; see 3.1).

### Claude's Discretion
- How each reader test is adapted (shared helper vs per-file), as long as each still fails when the behaviour it pins changes. (Under the comment-move path no reader needs adapting; this now covers only the new gate's tests and the one registry edit in 4.2.)

### Deferred Ideas (OUT OF SCOPE)
- Trimming `ci.yml`'s 237 KB of YAML comments (lineage notes) into docs, if headroom is ever needed again. (**Note:** the course change pulls this forward; the "Deferred" entry is now the active plan. Out of scope remains: rewording or deleting comments, restructuring jobs, reusable workflows or composite actions, any change to what a gate checks.)
</user_constraints>

<phase_requirements>
## Phase Requirements

None mapped (CI-only; ROADMAP `**Requirements**: none mapped`). The four ROADMAP success criteria are the contract and are mapped to tests in the Validation Architecture.
</phase_requirements>

## Summary

**Headroom.** `ci.yml` is 511,509 bytes at this branch's base (`da98acd39`) and 511,664 at `origin/main` (`9c5c414b0`, which contains merged Phase 243 PR #1405). GitHub documents the limit as "Each workflow file in the `.github/workflows` directory must be 500 KB or smaller to trigger a run" [CITED: docs.github.com/en/actions/reference/limits]. 500 KiB is exactly 512,000 bytes, which is why the Phase 243 measurement (511,664 B runs, 512,355 B does not) fits [ASSUMED that GitHub means KiB; the two measured data points agree with it]. Moving the YAML-level comment blocks of 2,000 bytes or more gives, measured on a scratch copy:

| Variant | Blocks moved | ci.yml after | Headroom to 512,000 | Doc size |
|---|---|---|---|---|
| Orchestrator's list **including** the `frontend` aggregator's header block | 25 | **392,383 B** | 119,617 | 110,213 B |
| Same list **excluding** the `frontend` job (24 blocks) | 24 | **406,650 B** | 105,350 | 96,969 B |

[VERIFIED: scratch copies built by a block-scalar-aware classifier; numbers re-measured with `wc -c`.] **The brief says "skipping the `frontend` aggregator job entirely, leaving ci.yml near 392 KB". Those two statements disagree:** the 25th block (lines 3621-3806, 14,324 B, the aggregator's own header comment) is the difference between 392 KB and 407 KB. The planner must pick one. Skipping gives 406.6 KB (still 54 KB under the gate's 460,800 ceiling, and 8 KB under its warn threshold of 414,720).

**No reader breaks.** The 45 test files that mention `ci.yml` or `.github/workflows` (2,759 tests) were run on the unmodified tree and on the 24-block variant: **0 newly failing tests** (the 8 failures in the variant are a subset of the 13 that fail on the unmodified scratch tree, all environmental: 5 s/20 s timeouts under CPU contention and a missing git history for `sql-mutation-scope-step`'s end-to-end arms). The 25-block variant result is in Appendix B (also 0 real failures). The mechanism is simple: every reader that parses `ci.yml` either strips comment lines first (`liveLines`, `stripComments`), slices by structural keys (`\n  job:`), or asserts on `run:` text, and none of the 24 moved blocks sits inside a `run:` block scalar.

**The gate.** A new workflow `.github/workflows/workflow-size.yml` plus `scripts/check-workflow-size.mjs`. A working draft of both was written in the scratch copy and exercised: `--self-test` passes (red, green and empty each behave); against the **unmodified** tree it exits 1 naming `ci.yml` at 511,509 bytes; against the 24-block tree it exits 0 and prints `ci.yml: 406650 bytes, 54150 to the ceiling 460800, 105350 to the hard limit 512000`. Dropping the new workflow into the tree breaks exactly **one** existing test, a registry that pins the exact set of PR/push-triggered workflows (4.2). Everything else that enumerates `.github/workflows/` (SHA-pin, permissions, persist-credentials, concurrency, ci-apt-bounded, ghcr-login) passes on a conforming file.

**Primary recommendation:** Move the comment blocks mechanically with a script (classifier in Code Examples), prove no executed YAML changed by a before/after structural diff, add `workflow-size.yml` + `check-workflow-size.mjs` + one vitest file, add the one registry line in `critical-regressions.test.ts`, and **do not use `ci.yml:LINE` anchors in this phase's own PLAN.md files** (the line numbers shift by about 1,600 lines and `plan-anchor-verify` re-resolves pending plans on every PR).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Keep `ci.yml` under GitHub's size limit | CI workflow file (YAML) | `docs/` (comment text lives there) | Pure file-size property of one tracked file; no runtime tier involved |
| Detect a workflow file nearing the limit | Separate workflow + node script | vitest (pins verdicts and wiring) | Must not live in `ci.yml`: an oversized `ci.yml` starts no run, so a gate inside it cannot fire |
| Preserve gate behaviour while moving comments | Existing vitest/node self-tests | `plan-anchor-verify`, `docs-link-check` | They are the readers; the move must leave all of them green |
| Rationale prose for each job | `docs/ci-yml-notes.md` | one-line pointer in `ci.yml` | Rationale is documentation, not executed configuration |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js builtins only (`node:fs`, `node:os`, `node:path`, `node:url`) | CI pins `node-version: 22`; local box has v25.8.1 | `scripts/check-workflow-size.mjs` | Same shape as `scripts/check-baseline-currency.mjs` / `lint-sql-gates.mjs --self-test` (CONTEXT code_context) |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1` | Fetch tree | Identical pin in every workflow; `critical-regressions.test.ts` SHA-pin policy enforces a 40-char SHA |
| `actions/setup-node` | `949feb2413d6458794dcd2491c4babbbce0c15c1  # v7.1.0` | `node-version: 22` | Pin copied from `contracts.yml` and `sql-mutation-nightly.yml` |
| vitest | repo's existing | tests for the gate | `vitest.config.ts` INCLUDE globs already collect `src/**/*.test.ts` and `scripts/**/*.test.{ts,tsx}` |

[VERIFIED: pins read from `.github/workflows/contracts.yml` and `.github/workflows/sql-mutation-nightly.yml` this session.]

### Supporting
None. No `npm install`, no new dependency. (`yaml` 2.9.1 and `js-yaml` exist in `node_modules` only transitively: `grep -n '"yaml"\|"js-yaml"' package.json` returned nothing and no file under `src scripts tests tools` imports either. **Do not start importing them** for this phase; use the text-level proof in Code Examples.)

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Comment move | Run-body move (Appendix A) | Gives ~130 KB but touches 7 test files and 70 tests; the comment move touches 0 tests |
| Gate as a vitest test inside the frontend shards | Separate workflow | A vitest check lives behind `ci.yml`; an oversized `ci.yml` runs nothing, so it would never fire. Locked decision says separate workflow |

**Installation:** none.

**Version verification:** not applicable (no registry packages). Action SHAs verified by reading the existing workflows.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Nothing to audit. `slopcheck`/`package-legitimacy check` not run (no package names). Packages removed due to SLOP: none. Packages flagged SUS: none.

## Architecture Patterns

### System Architecture Diagram

```
 developer edits any .github/workflows/*.yml
        |
        v
  git push / PR ----------------------------------------------+
        |                                                      |
        v                                                      v
  GitHub: file > 512,000 B ?                            workflow-size.yml (own file)
   yes -> NO run for THAT file (silent)                   trigger: pull_request, push main, dispatch
   no  -> ci.yml runs as today                              |
                                                            v
                                                   node scripts/check-workflow-size.mjs --self-test
                                                     (red fixture must fail, green must pass)
                                                            |
                                                            v
                                                   node scripts/check-workflow-size.mjs
                                                     scan .github/workflows/*.yml|*.yaml (lstat bytes)
                                                       |-- 0 files        -> exit 1 (never a pass)
                                                       |-- any > 460,800  -> ::error:: + exit 1  (still runs when ci.yml is the big one)
                                                       |-- any >= 414,720 -> ::warning::, exit 0
                                                       '-- else           -> print sizes + headroom, exit 0

 comment move (one-off, scripted):
   ci.yml  --classify lines (block-scalar aware)-->  YAML-level comment blocks >= 2,000 B
        |                                                   |
        | replace each block with one pointer line          v
        v                                          docs/ci-yml-notes.md  (## <job> sections, fenced text)
   ci.yml (-105..119 KB, executed YAML byte-identical)
```

### Recommended Project Structure
```
.github/workflows/workflow-size.yml     # new, one job `workflow-size`
scripts/check-workflow-size.mjs         # new, exports scan/judge/constants, --self-test
src/__tests__/workflow-size-gate.test.ts# new: verdicts + wiring pins (vitest INCLUDE already collects it)
docs/ci-yml-notes.md                    # new: one `## <job>` section per job that lost a block
.github/workflows/ci.yml                # 24 or 25 comment blocks -> one-line pointers
src/__tests__/critical-regressions.test.ts  # +1 line in the merge-path registry
```

### Pattern 1: Pointer comment
**What:** Replace a contiguous YAML-level comment block with one comment line at the first line's indent, e.g. `# Moved to docs/ci-yml-notes.md (section: sql-mutation).` Plain text, no markdown link.
**When to use:** every moved block. A planner should add a stable per-block heading in the doc (job name, then the first line of the original block) so two blocks of one job are distinguishable.
**Example:** see Code Examples (the exact script that produced the measured numbers).

### Pattern 2: Gate script with pure `judge()` and a `--self-test`
**What:** `scan(dir) -> rows`, `judge(rows) -> {ok, lines, errors}`, a self-test that writes a temp over-ceiling and under-ceiling file, and an empty-directory arm. Precedent: `scripts/lint-sql-gates.mjs --self-test`, `scripts/sql-gate-subset.mjs --self-test`.
**Example:** the draft in Code Examples was run and passes its own self-test.

### Anti-Patterns to Avoid
- **A size check inside `ci.yml`** (or any file that can itself be oversized). It cannot fire when it matters. Locked.
- **`paths:` filter on `workflow-size.yml`.** Locked "no paths filter, so it is always in the check count".
- **Quoting a credential-shaped literal into the moved doc or CHANGELOG** (CLAUDE.md). The moved doc was scanned and is clean (4.4), but do not add literals while editing.
- **A skip-CI trailer token anywhere in a commit message or PR body** (CLAUDE.md "CI gate integrity" trap 1). The doc itself contains none (grepped for `skip ci`, `ci skip`, `skip-checks`, `no ci]`: 0 hits), and file content is not what GitHub scans, but this phase is exactly about CI silently not running, so the trap is live in the ship commit.
- **`ci.yml:LINE` anchors in this phase's PLAN.md files** (see 3.2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deciding which lines are "YAML-level comments" | A naive `grep '^\s*#'` | The block-scalar-aware classifier in Code Examples | A `#` line inside `run: |` is shell code (128,570 B of it), and moving it changes the executed script. Naive grep would move it. |
| Proving "no executed YAML changed" | Eyeballing the diff | Strip classified comment lines from base and new, compare byte-for-byte, plus pointer-lines-only residue check | 1,644 lines move; review cannot be the proof |
| Size gate output format | Custom annotations | `::error file=...::` / `::warning file=...::` workflow commands | Same convention every other gate in `ci.yml` uses |

**Key insight:** the only thing that makes this move safe is the block-scalar boundary. Everything else (readers, gitleaks, lint) was measured to be indifferent to YAML-level comments.

## Runtime State Inventory

Not a rename/refactor/migration of a runtime-visible string. Omitted by instruction. One explicit check anyway: *after every file in the repo is updated, what runtime systems still carry the old state?* **None.** Branch protection and Railway read check-run names, not file contents; job names and step names are unchanged (comments only). The one runtime-adjacent effect is the extra check run (4.5).

## Common Pitfalls

### Pitfall 1: Moving a shell comment instead of a YAML comment
**What goes wrong:** the `ARMS_FLOOR` derivation table (`#   test_x.sql   8` lines) and all `run:`-body `#` lines are shell comments that `ci-anti-skip-gate.contract.test.ts` regex-reads from the executed body (`/^#\s+(test_[A-Za-z0-9_]+\.sql)\s+(\d+)\s*$/gm`, 23 tests). Moving them silently breaks 23+ tests.
**Why it happens:** a line-oriented mover that does not track `run: |` scope.
**How to avoid:** classifier below; the CONTEXT census already named this: 128,570 B of shell comments stay.
**Warning signs:** after the move, `git diff --stat` shows deletions inside a `run:` block, or any vitest failure in `ci-anti-skip-gate`/`mutation-runner-floors`.

### Pitfall 2: `ci.yml` is mutation-gate machinery, so the merge triggers a FULL mutation run
**What goes wrong:** `scripts/sql-gate-subset.mjs` treats `.github/workflows/ci.yml` as machinery on a PR (always FULL), and on a push to `main` only when the `changed-paths` or `sql-mutation` job SECTION TEXT differs between before and after (`ciMutationSectionsChanged` via `jobSection`, which compares raw text including comments). The 24-block list moves 1 block out of `changed-paths` (lines 96-199) and 4 out of `sql-mutation` (2107-2356, 2435-2464, 2719-2757, 2762-2817), so the merge push derives FULL with reason `... ci.yml (job section(s) changed: changed-paths sql-mutation)`.
**Why it matters:** the FULL run must fit `sql-mutation`'s 20-minute declared ceiling. It does today (a PR touching `ci.yml` is already FULL by the same rule), so this is expected behaviour, not a defect. It is also self-correcting: one run, then the next push is subset/none again.
**How to avoid / decide:** either accept (recommended; nothing else needed) or exclude those five blocks (about 32.6 KB: 7,444 + 18,218 + 2,261 + 2,738 + 3,950) to keep the merge push cheap, at the cost of headroom. The planner should state the choice.
[VERIFIED: read `scripts/sql-gate-subset.mjs:128-141, 178-200, 283-285, 360-369`; `node scripts/sql-gate-subset.mjs --self-test` passes on the moved tree.]

### Pitfall 3: Line-number citations shift by ~1,600 lines
**What goes wrong:** `plan-anchor-verify` (PR-only job) runs `node scripts/verify-plan-anchors.mjs --pending` over every pending PLAN.md and fails a PR whose plan cites `ci.yml:N` with a range outside the file or a quote that moved. After the move `ci.yml` goes from 7,482 to 6,048 lines (24-block variant) .
**How to avoid:** this phase's PLAN.md files must cite `ci.yml` by symbol/quote only. Measured at HEAD: `node scripts/verify-plan-anchors.mjs --pending` prints `scanned: 8 pending plan file(s) of 197`, `claims: 28 checked`, `OK: 8 plan file(s), no stale claims.` and **none of the 8 pending plans mentions `ci.yml` at all** (155.2-11..14, 157-02/03, 230-09/10; `grep -c ci.yml` is 0 for each). So nothing pending breaks today. Risk window: phases 248 SQLGATES2 and 249 TESTLANES edit `ci.yml` and, if planned before this ships with `ci.yml:N` anchors, would go stale.
[VERIFIED: ran the command above at HEAD this session.]

### Pitfall 4: The new workflow breaks the exact-set registry
**What goes wrong:** `src/__tests__/critical-regressions.test.ts` test `classifies exactly the known PR/push-triggered workflows` pins the sorted list `ci.yml, contracts.yml, migration-drift-check.yml, migration-policy-self-test.yml, migration-policy.yml, mutex-probe.yml, sql-function-snapshot.yml, supabase-migrate.yml`. Adding `workflow-size.yml` (PR + push triggers) fails it. Measured: it is the only newly failing test with the new workflow present.
**How to avoid:** add `` `${WORKFLOW_DIR}/workflow-size.yml` `` after `supabase-migrate.yml` (alphabetical). Calibrate by running it before the edit (red) and after (green).

### Pitfall 5: The gate and the shrink must land in ONE PR
The unmodified `ci.yml` is above the gate's 460,800 ceiling (it would print `::error:: ci.yml is 511509 bytes`). A gate PR without the shrink is red; a shrink PR without the gate leaves the problem undetected next time. Ship together (CONTEXT already says this phase does both).

### Pitfall 6: Predecessor-proof reads every Actions check run on `before`
`scripts/classify-changed-paths.mjs` `predecessorVerdict` (requirements (b) and (c)) counts **every** GitHub Actions check run and suite on the previous `main` commit. The new workflow runs on every push to `main`, so its check is part of that set: red `workflow-size` on `before` means the next push is not "proven green" and runs FULL; a still-running `workflow-size` (a few seconds) reads as pending and also runs FULL. Both are the documented safe direction ("ACCEPTED COST ... IN-03") and the same cost every other workflow already imposes. Not a defect; document it in the CHANGELOG notes.
[VERIFIED: read `scripts/classify-changed-paths.mjs:403-470`.]

## Code Examples

### The classifier and mover that produced every number in this document
```js
// Scratch tool (NOT committed). Block-scalar aware: a `key: |` / `- run: |` line opens a
// scalar whose body (blank lines and lines indented deeper than the key) is shell, not YAML.
// A "block" = consecutive YAML-level comment lines (no blank line between).
import { readFileSync } from "node:fs";
const lines = readFileSync(".github/workflows/ci.yml", "utf8").split("\n");
let inScalar = false, scalarIndent = -1, job = null, inJobs = false;
const kind = [], jobOf = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i], t = l.trim(), ind = l.length - l.trimStart().length;
  if (/^jobs:\s*$/.test(l)) inJobs = true;
  const m = /^  ([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l); if (inJobs && m) job = m[1];
  jobOf.push(job);
  if (inScalar) { if (t === "" || ind > scalarIndent) { kind.push("scalar"); continue; } inScalar = false; }
  if (t.startsWith("#")) { kind.push("ycomment"); continue; }
  kind.push("other");
  const sm = /^(\s*)(?:- )?[A-Za-z0-9_.-]+:\s*[|>][+-]?[0-9]?\s*(#.*)?$/.exec(l);
  if (sm) { inScalar = true; scalarIndent = ind + (l.trimStart().startsWith("- ") ? 2 : 0); }
}
// blocks = runs of kind==="ycomment"; select bytes >= 2000; skip job === "frontend" if the planner decides to.
```
Measured at base: 211 YAML-comment blocks, 238,290 B total; 25 blocks >= 2,000 B = 120,692 B (24 excluding `frontend` = 106,368 B); 1,644 lines. At `origin/main` the same 25 blocks have identical sizes (PR #1405's three hunks are inside the `sql-tests` run body, which is a scalar).

### The 25 blocks (lines at base `da98acd39`; identical block sizes at `origin/main`)
| Lines | Bytes | Job | First line |
|---|---|---|---|
| 96-199 | 7,444 | changed-paths | Phase 164.6.3 / CI-DOCSPATH-01 - the docs-only path filter's DETECTOR. |
| 732-797 | 4,968 | frontend-local-stack | Phase 164.5 / VAC-07 - THE LOCAL-STACK LANE. |
| 944-972 | 2,212 | frontend-local-stack | Phase 164.4.2 plan 04, RESEARCH Assumption A1 |
| 1053-1136 | 5,958 | frontend-live-db-lane | Phase 164.9 plan 08 - THE LIVE-DB LANE. |
| 1604-1634 | 2,064 | sql-gate-lint | Phase 164.3 / VAC-03 - the static vacuity linter |
| 1679-1733 | 3,679 | sql-gate-lint | Phase 164.5, criterion 7: BASELINE-CONTENT-DRIFT |
| 1840-1873 | 2,396 | sql-gate-lint | [164.8.1 review, finding 2] THE EXIT CODE IS NOT THE MEASUREMENT |
| 1995-2028 | 2,356 | sql-gate-lint | Phase 164.9, criterion 5: the data-dependent migration refusal |
| 2036-2065 | 2,110 | sql-gate-lint | THE EXIT CODE IS NOT THE MEASUREMENT (second) |
| 2107-2356 | 18,218 | sql-mutation | Phase 164.3 / VAC-01 + VAC-02 - the RED-UNDER mutation runner |
| 2435-2464 | 2,261 | sql-mutation | THIS STEP'S FIRST RUN IS THE MEASUREMENT |
| 2719-2757 | 2,738 | sql-mutation | SP-C02 |
| 2762-2817 | 3,950 | sql-mutation | MODE IDENTITY (164.3-RESEARCH Pitfall 2) |
| 3409-3443 | 2,278 | plan-anchor-verify | Phase 164.3 / VAC-05 |
| **3621-3806** | **14,324** | **frontend** | **Aggregator. Branch protection gates on this single required check** |
| 4002-4111 | 7,670 | sql-tests | audit-2026-05-07 follow-up Issue 6 |
| 5654-5682 | 2,120 | python | TTL for the shared-test-db mutex |
| 5742-5779 | 2,676 | python | @runtime_checkable Protocol |
| 5916-5959 | 4,030 | python | PR #149 follow-up: wire the test Supabase project |
| 5990-6144 | 12,037 | test-db-drift | CORRECTED 2026-09-25 (Phase 164.4.2.1 DRIFTOFFMUTEX, D-02) |
| 6154-6184 | 2,588 | test-db-drift | TTL for the mutex below |
| 6212-6265 | 3,953 | test-db-drift | THE ORDERING WAIT (Phase 164.9 plan 06) |
| 6640-6668 | 2,116 | e2e-seeded | TTL for the shared-test-db mutex |
| 6683-6737 | 3,938 | e2e-seeded | v1.16 close-out |
| 6981-7016 | 2,608 | e2e-seeded | retro-PR188-D4 |

[VERIFIED: produced by running the classifier above on `.github/workflows/ci.yml` and on `git show origin/main:.github/workflows/ci.yml`.]

### Draft gate script (run in scratch: self-test OK; RED on the unmodified tree; GREEN on the moved tree)
```js
#!/usr/bin/env node
// Fails when any .github/workflows/*.yml|*.yaml file passes CEILING bytes.
// GitHub: "Each workflow file ... must be 500 KB or smaller to trigger a run" (500 KiB = 512,000 B).
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const HARD_LIMIT = 512_000;
export const CEILING = 460_800;                 // 90 percent; a 51,200-byte margin
export const WARN_AT = Math.floor(CEILING * 0.9); // 414,720: within 10 percent of the ceiling

export function scan(dir) {
  const names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort();
  const rows = [];
  for (const n of names) { const st = lstatSync(join(dir, n)); if (st.isFile()) rows.push({ name: n, bytes: st.size }); }
  return rows;
}

/** PURE: rows -> { ok, lines, errors }. An empty set is an error, never a pass. */
export function judge(rows) {
  if (rows.length === 0) return { ok: false, lines: [], errors: ["MEASURE_FAIL: no workflow files matched; a gate over nothing is not a pass"] };
  const lines = [], errors = [];
  for (const r of rows) {
    lines.push(`${r.name}: ${r.bytes} bytes, ${CEILING - r.bytes} to the ceiling ${CEILING}, ${HARD_LIMIT - r.bytes} to the hard limit ${HARD_LIMIT}`);
    if (r.bytes > CEILING) errors.push(`::error file=.github/workflows/${r.name}::${r.name} is ${r.bytes} bytes, over the ${CEILING}-byte ceiling (GitHub starts NO run above ${HARD_LIMIT}).`);
    else if (r.bytes >= WARN_AT) lines.push(`::warning file=.github/workflows/${r.name}::${r.name} is within 10 percent of the ceiling (${r.bytes}/${CEILING}).`);
  }
  return { ok: errors.length === 0, lines, errors };
}
// selfTest(): temp dir with under.yml (CEILING-1) and over.yml (CEILING+1); assert red names over.yml,
// the under-only set is green, and an empty dir is red. main(): judge(scan(".github/workflows")), exit 0/1.
```
For testability the planner should let `main()` take the directory from an argument (`node scripts/check-workflow-size.mjs [dir]`, default `.github/workflows`) so a vitest arm can run the real script over a fixture directory in a subprocess, rather than only calling `judge()` in-process. (The draft omits the argument; trivial addition.)

### Draft workflow (conventions copied from `contracts.yml` and `sql-mutation-nightly.yml`; passes every `critical-regressions` invariant once the registry line is added)
```yaml
name: Workflow size

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: workflow-size-${{ github.workflow }}-${{ github.head_ref || github.run_id }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  workflow-size:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1  # v7.1.0
        with:
          node-version: 22
      - name: Self-test - an over-ceiling file goes red, an under-ceiling file goes green
        run: node scripts/check-workflow-size.mjs --self-test
      - name: Scan every workflow file against the ceiling
        run: node scripts/check-workflow-size.mjs
```
Notes: the `concurrency.group` shape mirrors `contracts.yml` (`${{ github.workflow }}-${{ github.head_ref || github.run_id }}`, so pushes to `main` never cancel each other, per the CLAUDE.md "every commit must produce its own recorded run" requirement that `ci.yml` documents at lines 30-37). No `shell:`/`defaults:` override (the shell-model pins in `test-restore-workflow-wiring.test.ts` assume none). Do not write the advisory key `61616158` anywhere in it (the mutex census says every workflow other than the four takers carries 0).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Rationale as 237 KB of `ci.yml` comments | Rationale in `docs/`, pointer in `ci.yml` | this phase | `ci.yml` leaves the 512,000-byte cliff |
| GitHub silently starts no run | Dedicated size gate in its own workflow | this phase | The failure becomes a red check instead of an absent one (CLAUDE.md "count the checks" trap) |

**Deprecated/outdated:** the CONTEXT "[Headroom] No. The comments stay where they are" decision (superseded).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GitHub's "500 KB" means 500 KiB = 512,000 bytes | Summary, gate constants | If it were 500,000 bytes, the measured 511,664-byte run would not have started; the two measured data points (from the Phase 243 agent, not re-measured here) contradict that, so risk is low. The 460,800 ceiling is below both readings. |
| A2 | lychee skips fenced/inline code by default (`--include-verbatim` off) | 4.3 | Only matters if the doc is placed under `docs/runbooks/` and a block contains a path-like or URL-like string; mitigated by placing it at `docs/ci-yml-notes.md` |
| A3 | Railway's deploy gate reads every workflow's check runs for a commit | 4.5 | If it only read some, the extra check is harmless; if it reads all (as `docs/runbooks/railway-worker.md` records), a red `workflow-size` on a `main` SHA blocks that SHA's deploy, which is the intended loudness |

## Open Questions (RESOLVED)

All four are resolved in 260-CONTEXT.md: Q1 skip the frontend block ([Headroom] "Which comments move?"); Q2 accept the FULL run ([Consequences]); Q3 docs/ci-yml-notes.md ([Doc]); Q4 the deviation is recorded in CONTEXT "Approach (revised ...)" and ROADMAP SC-1.

1. **Include the `frontend` aggregator's header block (14,324 B) or skip it?**
   - What we know: 25 blocks -> 392,383 B; 24 blocks -> 406,650 B. Both variants were run against the 45-file reader set with 0 real failures (Appendix B for the 25-block one).
   - What's unclear: the brief states both "skip frontend entirely" and "near 392 KB".
   - Recommendation: skip it (24 blocks, 406.6 KB). SC-4 says the aggregator's `needs:` list and result loop stay identical; those are YAML, not the header comment, so moving the comment is also compatible, but skipping removes any argument. 105 KB of headroom is "tens of kilobytes" many times over.
2. **Accept the one FULL mutation run on the merge push (Pitfall 2) or exclude the five `changed-paths`/`sql-mutation` blocks?**
   - Recommendation: accept; say so in the CHANGELOG. PRs touching `ci.yml` are already FULL.
3. **Where does `docs/ci-yml-notes.md` live?** Recommendation: exactly that path. It is outside the `docs-link-check` globs (`docs/runbooks/soc2-readiness.md`, `docs/runbooks/**/*.md`) so the link checker never reads it; fenced `text` blocks and no markdown links keep it inert either way.
4. **CONTEXT.md / ROADMAP deviation record** (top of this file): who writes it and when.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | gate script, tests, classifier | yes | v25.8.1 local; CI `node-version: 22` | none needed |
| vitest | tests | yes | repo's (via main checkout's `node_modules`) | none |
| gitleaks | verifying the moved doc | yes | 8.30.1 (same as CI `GITLEAKS_VERSION`) | none |
| lychee | verifying `docs-link-check` | **no** | CI pins v0.23.0 | not needed if the doc stays outside the globs |
| `gh` | reading PR #1405 | yes | n/a | n/a |

**Missing dependencies with no fallback:** none. **With fallback:** lychee (unverified locally; avoided by placement).

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) + node self-test (`--self-test`) |
| Config file | `vitest.config.ts` (INCLUDE already covers `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.{ts,tsx}`) |
| Quick run command | `node scripts/check-workflow-size.mjs --self-test && npx vitest run src/__tests__/workflow-size-gate.test.ts src/__tests__/critical-regressions.test.ts` |
| Full suite command | the 45-file reader set: `npx vitest run $(git grep -a -l -E "ci\.yml\|\.github/workflows" -- 'src/**/*.test.ts' 'tests/**/*.test.ts' 'scripts/**/*.test.*' 'src/**/*.test.tsx')` plus the five node self-tests below |

### Phase Requirements -> Test Map
| Success criterion | Behavior | Test type | Automated command | File exists? | How it is shown to fail |
|---|---|---|---|---|---|
| SC-1 | `ci.yml` is well under 512,000 B with tens of KB headroom | node gate + vitest | `node scripts/check-workflow-size.mjs` (exit 0) and a vitest arm asserting `statSync(ci.yml).size <= HARD_LIMIT - 50_000` | Wave 0 (new) | Run the gate on the unmodified tree: exits 1 naming `ci.yml` 511,509 (measured). Neuter by setting `CEILING` huge -> the vitest ceiling arm goes red. |
| SC-1 (safety) | The move changed no executed YAML | one-off verification step in the plan (not a permanent test) | classifier script: strip YAML-level comment lines from base and new `ci.yml`, compare; residue must be exactly the pointer lines | Wave 0 (scratch tool, committed only if the planner wants it) | Move one `run:` shell comment as well -> the stripped-text comparison differs. Supporting evidence already gathered: `yaml` 2.9.1 `deepStrictEqual` of base vs 24-block `ci.yml` passed. |
| SC-2 | Gate fails any file over the ceiling, passes under, errors on empty, warns near | node self-test + vitest (subprocess over fixture dir) | `node scripts/check-workflow-size.mjs --self-test` | Wave 0 (new) | Red fixture is the test: over-ceiling file must produce exit 1 and `::error file=`. Neuter: change `>` to `>=` off-by-one or return `ok: true` -> self-test and vitest both red. Restore from a byte backup (project rule: never `git checkout`/`stash`). |
| SC-2 | Gate lives outside `ci.yml` and still runs when `ci.yml` is the oversized file | vitest wiring pin | assert `workflow-size.yml` exists; `ci.yml` text does not contain `check-workflow-size`; `on:` has `pull_request`, `push`, `workflow_dispatch`; no `paths:`/`paths-ignore:`; job key `workflow-size`; `--self-test` step precedes the scan step; `permissions: contents: read`; persist-credentials false; SHA pins | Wave 0 (new) | Delete the `paths`-free trigger or add `paths:` -> pin red. Move the step into `ci.yml` -> "ci.yml must not contain" arm red. |
| SC-2 | New workflow satisfies repo workflow invariants | existing vitest | `npx vitest run src/__tests__/critical-regressions.test.ts` | exists; **needs one registry line** | Run before the registry edit: `classifies exactly the known PR/push-triggered workflows` is red (measured). |
| SC-3 | Every existing reader keeps passing | existing vitest + node self-tests | the 45-file set; `node scripts/lint-sql-gates.mjs --self-test`, `node scripts/sql-gate-subset.mjs --self-test`, `node scripts/classify-changed-paths.mjs --self-test`, `node scripts/verify-plan-anchors.mjs --self-test`, `node scripts/baseline-content-drift-check.mjs --self-test`; `node scripts/verify-plan-anchors.mjs --pending` | exist | Measured: 0 newly failing vs baseline on the 24-block variant; all five self-tests rc 0. A move that pulls a shell comment (Pitfall 1) turns 23+ tests red, which is the calibration that the readers can still fail. |
| SC-4 | `frontend` aggregator `needs:` + result loop, and every job/step name, identical | verification step | diff `jobs.frontend` text (24-block variant leaves it byte-identical because the whole job is skipped) and the sorted list of `- name:` / job keys between base and new | scratch | Rename a job in the moved tree -> name-list diff non-empty. |
| gitleaks / lint | Moved doc is clean | node | `gitleaks dir docs/ci-yml-notes.md --config .gitleaks.toml`; `tsx scripts/check-planning-hygiene.ts`; `tsx scripts/check-canonical-domain.ts` | exist | Measured clean (4.4). |

**Local environment caveat (measured):** on a scratch copy without git history and under CPU contention, 13 tests fail on the UNMODIFIED tree (5 s / 20 s timeouts in `lint-sql-gates`, `restore-test-from-baseline`, `local-stack-lane-wiring`, `ci-apt-bounded R4`; `sql-mutation-scope-step` end-to-end arms need full history; `mutation-annotation-parser`, `spec-disabling.invariant`, `ci-docs-path-filter` also appeared). The verifier must compare against a baseline taken the same way, or run in the real worktree with history. **Never run two vitest invocations concurrently** (that is what caused the timeouts).

### Sampling Rate
- **Per task commit:** the quick command above plus `node scripts/sql-gate-subset.mjs --self-test`.
- **Per wave merge:** the 45-file reader set run serially, compared to a same-way baseline.
- **Phase gate:** reader set green, `check-workflow-size` exit 0 on the real tree, `gitleaks dir` clean, `verify-plan-anchors --pending` OK, the planning hygiene lint OK.

### Wave 0 Gaps
- [ ] `scripts/check-workflow-size.mjs` with exported `scan`/`judge`/constants and `--self-test`, optional directory argument.
- [ ] `src/__tests__/workflow-size-gate.test.ts` (verdicts over a fixture dir via subprocess, empty-dir arm, wiring pins, `ci.yml` size arm).
- [ ] `.github/workflows/workflow-size.yml`.
- [ ] One-line edit to the merge-path registry in `src/__tests__/critical-regressions.test.ts`.
- [ ] The mover script (scratch) and a before/after structural proof recorded in the SUMMARY (before and after byte counts of every workflow file, per CONTEXT specifics).

## Security Domain

`security_enforcement` is absent from config (treated as enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a |
| V3 Session Management | no | n/a |
| V4 Access Control | yes (workflow token scope) | `permissions: contents: read` top-level, exactly one block (pinned by `critical-regressions`) |
| V5 Input Validation | minimal | script takes an optional directory argument; use `lstat`, only regular files, no shell interpolation |
| V6 Cryptography | no | n/a |
| V14 Config / supply chain | yes | 40-char SHA pins; `persist-credentials: false`; no new third-party action |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential-shaped literal quoted into a new tracked doc (CLAUDE.md warns) | Information disclosure | `gitleaks dir` with the repo config over the doc: **no leaks found** (8.30.1). `.gitleaks.toml` has no path allowlist for `ci.yml` or `docs/`, and `.gitleaksignore` has no `ci.yml` fingerprint, so moving lines out of `ci.yml` orphans no ignore entry. |
| Gate silently vacuous (empty match passes) | Tampering / repudiation | empty directory is an error; self-test has an empty arm |
| Workflow file over the limit starts no run (silent absence of CI) | Denial of service on the gate set | the gate itself; CLAUDE.md "count the checks" |
| Home path / username leaking into tracked prose | Information disclosure | `check-planning-hygiene.ts` rule 1: OK with the doc present |

## Findings by the four requested topics

### 3.1 Non-vitest readers of `ci.yml` comment text or line positions
- **`scripts/verify-plan-anchors.mjs` (+ job `plan-anchor-verify`, PR-only).** Run at HEAD: `scanned: 8 pending plan file(s) of 197 / deferred: 0 / claims: 28 checked / OK`. Pending plans: 155.2-11, 155.2-12, 155.2-13, 155.2-14, 157-02, 157-03, 230-09, 230-10. **None anchors or even mentions `ci.yml`.** Its own tests use a fixture `ci.yml` of 50 generated lines, not the real file (`src/__tests__/verify-plan-anchors.test.ts:343`), and R2-W05 (`:967-978`) extracts the `plan-anchor-verify` job's assert step from the real file, which is `run:` text and unmoved. `node scripts/verify-plan-anchors.mjs --self-test` passes on the moved tree.
- **Other scripts that name `ci.yml`** (23 files under `scripts/`): all prose or `run:`-body/step-name/job-key reads. The only runtime ones are `scripts/sql-gate-subset.mjs` (`ciMutationSectionsChanged`, Pitfall 2), `scripts/classify-changed-paths.mjs` (`DRIFT_STEP_RUN_LINE`, the `frontend` check name, job sections for `changed-paths` `actions: read`), and `scripts/pg-lane/mutex-dead-holder-lane.sh` (extracts a step from `supabase-migrate.yml`, not `ci.yml`). Their `--self-test`s pass on the moved tree (`lint-sql-gates`, `sql-gate-subset` 31 arms, `classify-changed-paths` 25 arms, `baseline-content-drift-check` 41 assertions, `verify-plan-anchors`).
- **Python tests (`analytics-service/tests`)**: none opens `ci.yml`. `test_mt5_session_monitor.py:2263` reads `prod-prober.yml`; `golden_parity.py`, `live_db_dsn.py`, `test_compute_job_metadata_merge_live.py`, `Makefile` mention `ci.yml` in prose only.
- **`ci.yml:NNN` line citations in tracked non-planning text (about 30 files)**: prose in comments, TODOS and runbooks (`scripts/test-ledger-drift-check.sh:95-97`, `scripts/prod-body-drift-check.sh:61`, `src/lib/source-scan.ts:21`, `src/__tests__/drift-check-scripts.test.ts:4843`, `e2e/composer-axe.spec.ts:41`, ...). Every one is already stale; **no test or script reads any of them as a line**. Not worth a sweep.
- **Prose that cites moved comment CONTENT** (searched by 1,202 fixed-string needles from the moved text, kept only where `ci.yml` appears within 3 lines): `CLAUDE.md:386` ("`ci.yml` carries the derivation", the `timeout-minutes` 20 derivation lives in the `sql-mutation` header block 2107-2356), `docs/runbooks/shared-test-db-mutex.md:811` ("`ci.yml` records that at length", the `needs:`-skip rationale in the `changed-paths` block), plus test comments (`lint-sql-gates.test.ts:1565`, `local-stack-lane-wiring.test.ts:1461`, `mutation-runner-floors.test.ts:2636`, `test-restore-workflow-wiring.test.ts:81`). All prose. Recommendation: fix the two that a human would follow (`CLAUDE.md:386`, runbook `:811`) to say `docs/ci-yml-notes.md`; leave test-comment prose (CONTEXT: "prose elsewhere is not swept"). CLAUDE.md is a project file the phase may edit as a normal change; it is not edited by this research.
- **CLAUDE.md census greps** (`grep -c 61616158`, `grep -n 'wait-for-test-schema-apply.sh'`, `grep -n 'cov-fail-under'` against `ci.yml`): moving comments can only lower a count. `61616158` is already 0 in `ci.yml`. The `wait-for-test-schema-apply.sh` grep's "the rest are comments" sentence stays true with fewer comments. `cov-fail-under` is in a `run:` line, unmoved.

### 3.2 `docs-link-check`
Job `docs-link-check` runs `lychee --offline --no-progress --verbose docs/runbooks/soc2-readiness.md 'docs/runbooks/**/*.md'` (lychee v0.23.0, binary cached). Internal links only. `docs/ci-yml-notes.md` is **outside both globs**, so it is never read; if it were placed under `docs/runbooks/` it would be, and a relative link or bare URL outside code blocks would be resolved against the tree. Use fenced ```` ```text ```` blocks and no markdown links. lychee is not installed locally, so this is unverified by execution [ASSUMED for the verbatim-skipping detail, A2].
No test enumerates `docs/*.md` (grepped `readdirSync`/`ls-files` over `docs`): the only readers of `docs/` read named files (`adr-0008`, `legacyretire-go-live.md`, `marksource-*`, `mt5-parity`).

### 3.3 Gitleaks / secret-scan
`secret-scan` runs `gitleaks/gitleaks-action` v3.0.0 (`GITLEAKS_VERSION: 8.30.1`, `GITLEAKS_CONFIG: .gitleaks.toml`, `fetch-depth: 0`). The config extends the default ruleset with path allowlists; **none names `ci.yml` or `docs/`** (`grep -n 'ci.yml\|workflows\|docs/' .gitleaks.toml` returned nothing relevant) and `.gitleaksignore` (78 lines, commit:file:rule:line fingerprints, one CHANGELOG pair) has no `ci.yml` entry. Measured: `gitleaks dir docs/ci-yml-notes.md --config .gitleaks.toml` over the 24-block doc (96,969 B) prints `no leaks found`. The 25-block doc is the same text plus the aggregator block. Because the doc is the same bytes `ci.yml` already carried and `ci.yml` is scanned by the same rules, there is no new exposure; the range scan will see the doc's lines as additions in one commit and they pass. CLAUDE.md's warning (credential-shaped fixture literals in prose; full-history `workflow_dispatch` scans 37 pre-existing latent hits) concerns text added to CHANGELOG/prose, not this move.

### 3.4 The 25-block (including `frontend`) variant
See Appendix B for the result of running the reader set on it.

### 3.5 PR #1405
`gh pr view 1405` reports **state MERGED** (`9c5c414b0 v0.133.110.0 - Phase 243 DBBACKSTOP PR-B`, 2026-11-27 21:11Z); the brief's "open" is stale. Its `ci.yml` diff is three hunks at lines 5380-5394 of the `sql-tests` run body: one added shell comment line, one added derivation-table row, and `SENTINEL_FLOOR=41 -> 42`, `ARMS_FLOOR=620 -> 627` plus the table's sum comment. All are inside a block scalar, so **no hunk touches any YAML-level comment block** and the nearest moved block (python, 5654) is 270 lines away: a three-way merge is clean. Block sizes and the 25-block count are identical on both trees. It also changed `drift-check-scripts.test.ts` (literals 41/620 -> 42/627, which still read `ci.yml` and are unaffected under this path), `ci-anti-skip-gate.contract.test.ts` (`okCount` 1 -> 2) and `scripts/mutation-floors.mjs` (`FILES_FLOOR` 101, `ARMS_FLOOR` 1126). **Action:** this branch (`gsd/phase-ciheadroom`, based on `da98acd39`, 2 commits ahead, 1 behind `origin/main`) must be rebased or merged onto `origin/main` before the mover script is run, so the pointer edit and the size numbers (`ci.yml` 511,664 B on main) are measured on the real base. Re-run the classifier then; expect the same 25 blocks.

## 4. New workflow: conventions, registries and check-run effects

### 4.1 Conventions to copy
From `contracts.yml` and `sql-mutation-nightly.yml` (read this session): top-level `permissions: contents: read` (exactly one block), top-level `concurrency` with `cancel-in-progress`, checkout pinned `3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1` with `persist-credentials: false`, setup-node pinned `949feb2413d6458794dcd2491c4babbbce0c15c1  # v7.1.0` with `node-version: 22` and no `cache: npm` (nothing is installed). `runs-on: ubuntu-latest` (the nightly pins `ubuntu-24.04` only because PostgreSQL 18 broke its lane; irrelevant here).

### 4.2 Tests that enumerate `.github/workflows/` (all measured with the draft present)
| Test | What it enumerates | Result with draft |
|---|---|---|
| `critical-regressions.test.ts` `SHA-pin policy`, `Workflow-level permissions`, `persist-credentials policy`, `permissions block cardinality`, `concurrency` | every file via `readdirSync` | pass for a conforming file |
| `critical-regressions.test.ts` `classifies exactly the known PR/push-triggered workflows` | **exact sorted list of 8** | **FAILS until `workflow-size.yml` is added to it** (only failure) |
| `contracts/ci-apt-bounded.contract.test.ts` | every workflow step for apt calls; census "17 apt-reaching steps and 14 wrapper callers" | pass (no apt in the new file) |
| `contracts/ghcr-login-before-image-pull.contract.test.ts` | every `.yml` for image pulls | pass |
| `contracts-registry.test.ts` | contract test registry, not workflows | n/a |
| `test-restore-workflow-wiring.test.ts`, mutex census | named files only | pass; keep `61616158` out of the new file |

### 4.3 Check-run effects
- **Expected check count per PR and per `main` SHA rises by one** (`workflow-size`). CONTEXT already records this.
- `main-ci-cancelled-watcher.yml` triggers on `workflow_run` for workflow `"CI"` only: unaffected.
- `classify-changed-paths.mjs` `predecessorVerdict`: counts every GitHub Actions check run and suite on `before` (Pitfall 6): a still-running or red `workflow-size` on the previous `main` commit forces FULL on the next push. Documented safe direction.
- Railway: per `docs/runbooks/railway-worker.md:73` and `ci.yml`'s own comment, Railway gates on the commit's check-runs, "every workflow's check on it must be non-red". A red `workflow-size` on a `main` SHA therefore blocks that SHA's deploy. This is the intended loudness; note it in the CHANGELOG.
- Docs-only short path: `DOCS_ONLY_PREFIXES = [".planning/"]`; a PR touching `ci.yml`, `docs/` or `.github/workflows/workflow-size.yml` is code, all jobs run, `sql-mutation` is FULL (Pitfall 2). A push to `main` that is docs-only still runs `workflow-size` (no `paths:` filter), as intended.

## Sources

### Primary (HIGH confidence)
- Repo files read and executed this session: `.github/workflows/ci.yml`, `sql-mutation-nightly.yml`, `contracts.yml`, `migration-policy-self-test.yml`; `scripts/sql-gate-subset.mjs`, `scripts/classify-changed-paths.mjs`, `scripts/verify-plan-anchors.mjs`, `scripts/check-canonical-domain.ts`, `scripts/check-planning-hygiene.ts`; `src/__tests__/critical-regressions.test.ts`, `local-stack-lane-wiring.test.ts`, `test-restore-workflow-wiring.test.ts`, `drift-check-scripts.test.ts`, `contracts/ci-anti-skip-gate.contract.test.ts`, `mutation-runner-floors.test.ts`, `sql-mutation-nightly-parity.test.ts`, `sql-mutation-scope-step.test.ts`; `.gitleaks.toml`, `.gitleaksignore`; `docs/runbooks/railway-worker.md`.
- `gh pr view 1405` / `gh pr diff` and `git diff HEAD...origin/main` for the #1405 hunks.
- Scratch experiments: 5 vitest runs of the 45-file reader set (baseline, unmodified-after-run-body-move, 24-block comment move, injection probe, 24-block + new workflow); 5 node self-tests; `gitleaks dir`; `yaml` deep-equal.

### Secondary (MEDIUM confidence)
- [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits): "Each workflow file in the `.github/workflows` directory must be 500 KB or smaller to trigger a run."

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no external packages; pins copied from existing workflows).
- Architecture: HIGH (draft gate and workflow run and pass/fail as designed in scratch).
- Pitfalls: HIGH (each one was observed as a test result or read from source).
- GitHub limit semantics: MEDIUM (doc says 500 KB; byte value inferred from two measurements).

**Research date:** 2026-11-27
**Valid until:** 2026-12-04 (the census is bound to `da98acd39`/`9c5c414b0`; `ci.yml` moves with every CI phase, so re-run the classifier and the reader set after rebasing).

---

## Appendix A - Fallback census: moving the two `run:` bodies (superseded path, kept because it is measured)

Use only if the comment move proves insufficient. Everything here was run on a scratch copy at HEAD (`da98acd39`), moving `sql-tests` "Run SQL self-tests against the local-stack lane" and `sql-mutation` "Assert the run PRINTED its coverage and cleared both floors" to `scripts/ci-sql-self-tests.sh` / `scripts/ci-sql-mutation-assert.sh` with a one-line `run: bash scripts/...`.

**Sizes.** Raw YAML body bytes 88,725 and 40,424 (CONTEXT's "about 88,700 / 40,400" confirmed); dedented script bodies 77,892 and 35,470 B. `ci.yml` after: **381,977 B**; `sql-mutation-nightly.yml`: 64,723 -> 24,181 B. Neither body contains `${{`. Both begin `set -euo pipefail`, so `bash script` and the default `run:` shell (`bash -e {0}`) behave the same; neither uses `$0`, `BASH_SOURCE`, `dirname`, `cd` or `trap`; all paths are workspace-relative or `${GITHUB_WORKSPACE}`-rooted; `RUNNER_TEMP`, `GITHUB_*`, `LANE_ENV_FILE`, `RUNNER_LOG`, `SQL_GATE_FILES` arrive via the step `env:`. The extractors include a trailing blank line that YAML's `|` clip strips (the `ci.yml` body has one, the nightly's does not), so "byte-identical" must be checked with trailing blank lines normalised.

**Measured breakage (70 tests in 6 files; 45-file reader set, baseline-subtracted):**
| File | Newly failing | What it reads |
|---|---|---|
| `contracts/ci-anti-skip-gate.contract.test.ts` | 23 | extracts and EXECUTES the `sql-tests` body; reads `SENTINEL_FLOOR=`, `ARMS_FLOOR=`, the derivation table |
| `mutation-runner-floors.test.ts` | 39 | the assert step (text of the job slice and an executed copy `countRecheckScript()`) |
| `sql-mutation-nightly-parity.test.ts` | 2 | byte-equal `run:` of the assert step; `expect(...run).toContain("scope-reason:")`; the `is missing or empty.` calibration |
| `test-restore-workflow-wiring.test.ts` | 4 | `[164.8.4-02]` psql capture-then-echo redaction pairs read from `ci.yml` (a credential-leak gate) |
| `local-stack-lane-wiring.test.ts` | 1 | `sql-tests` block must call `capability-probe.mjs --refuse-nonlocal-dsn` |
| `drift-check-scripts.test.ts` | 1 | `grep -ac SENTINEL_FLOOR=NN` / `ARMS_FLOOR=NNN` on `ci.yml` |

**Silent coverage losses (found by an injection probe: bad lines appended to both bodies on the unmodified layout, then compared to the moved layout; these tests fail pre-move and still PASS post-move, so they would need to be pointed at the script):** `ci-anti-skip-gate` "does not re-introduce the empty-corpus `exit 0`" (the old extractor silently picks the NEXT step's `run: |` when the named step is a one-liner, so it passes vacuously); `test-restore-workflow-wiring` "no hand-copied redaction expression survives" (ci.yml arm) and `[164.8.4-01]` workspace-rooted references; `sql-mutation-nightly-parity` shape arms (`secrets.`, `61616158`); `ci-apt-bounded` (scans workflow files, not scripts). Not affected: `sql-mutation-scope-step`, `lint-sql-gates`, `critical-regressions`, `ci-docs-path-filter`.

**Mutation-gate machinery:** a body moved to `scripts/ci-sql-mutation-assert.sh` would NOT be in `MACHINERY_PREFIXES` / `PUSH_MACHINERY_PREFIXES` (`scripts/sql-gate-subset.mjs:128-141`), so a push editing only it could derive `none` and skip the lane; it would need a single-file entry added (and a self-test claim). A PR editing only the script is FULL anyway ("0 of N changed files are gate files").

## Appendix B - 25-block variant (including the `frontend` header block)

Run serially on a scratch copy with all 25 blocks moved (`ci.yml` 392,383 B, doc 110,213 B): 2,759 tests, 2 newly failing against the baseline. Both were `Test timed out in 5000ms` under load (`mutation-runner-floors` "absurdity floor ... runCorpus's real verdict loop" and "lane-concurrency line is echoed on a clean log"); re-run in isolation with `-t`, **27 passed**. So the 25-block variant has **0 real failures**: moving the `frontend` aggregator's header comment is also safe for every reader. `lint-sql-gates`' MW02 execution oracle runs the aggregator's result loop (a `run:` body), which is not touched. The choice in Open Question 1 is therefore about the brief's SC-4 optics and the 14 KB, not about test safety.
