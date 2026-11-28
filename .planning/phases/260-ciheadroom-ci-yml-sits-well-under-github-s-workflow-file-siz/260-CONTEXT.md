# Phase 260: CIHEADROOM — ci.yml sits well under GitHub's workflow file size limit, and a gate outside ci.yml fails a PR when any workflow file nears it - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning

<domain>
## Phase Boundary

CI-only. Two outcomes and one constraint:

1. `.github/workflows/ci.yml` drops well under GitHub's workflow file size limit, with headroom measured in tens of kilobytes.
2. A size gate that lives in its own workflow (never in `ci.yml`) fails a PR loudly when any `.github/workflows/*.yml` file passes a ceiling set a margin below the limit, so it still fires when `ci.yml` itself is the oversized file.
3. Constraint: every existing test that reads `ci.yml` text keeps passing, or follows the moved code to its new file and still fails when the pinned behaviour changes. The `frontend` aggregator's `needs:` list and result loop, and every job name and step name, stay identical.

Out of scope: rewording or deleting `ci.yml`'s comments, restructuring jobs, reusable workflows or composite actions, any change to what a gate checks.

**The evidence (main session brief, measured by the Phase 243 agent 2026-11-27).** Main's `ci.yml` was 511,509 bytes. PR #1405 at 512,355 bytes got a CI run that failed at startup with zero jobs ("workflow file issue") on two pushes; at 511,664 bytes CI started normally. The limit is therefore consistent with 512,000 bytes. A PR that grows `ci.yml` by about 300 bytes silently gets no CI run, and the board shows only the non-CI checks.

**Byte census at `da98acd39` (this phase's base), measured with a block-scalar-aware classifier.** 236,643 bytes of YAML comments, 128,570 bytes of shell comments inside `run:` blocks, 102,304 bytes of shell code, 41,660 bytes of other YAML (511,509 total). The two largest `run:` bodies:

| Job | Step | Lines (at base) | Body bytes |
|---|---|---|---|
| `sql-tests` | `Run SQL self-tests against the local-stack lane` | 4342-5455 | about 88,700 |
| `sql-mutation` | `Assert the run PRINTED its coverage and cleared both floors` | 2882-3407 | about 40,400 |

Neither body contains a `${{ }}` expression (grepped), so either could run as a script file (background only: the run: bodies do not move in this phase). The next largest body is the `frontend` aggregator's (about 13,600 bytes), which this phase must not touch.

</domain>

<decisions>
## Implementation Decisions

### Approach (revised 2026-11-27 on the coordinator's direction, before planning)
- The main session (coordinator) directed, after measuring that 367,366 of ci.yml's 511,509 bytes are comment-only lines: move the long lineage and rationale comments into a doc, one section per job, with a one-line pointer left in ci.yml, because that changes no executed YAML; check first which pin tests assert on comment text. Measured here before deciding: a copy of ci.yml with EVERY YAML-level comment line removed (273,219 bytes, still valid YAML) fails none of the 39 vitest files that mention ci.yml; the three failures seen also fail on the unmodified tree (local spawn timeouts). The first draft of this context chose moving the two largest `run:` bodies into scripts; that is dropped. Moving comments touches no gate's execution, needs no test to follow code, and does not conflict with Phase 243 PR #1405, whose ci.yml hunk sits inside the `sql-tests` run body.

### Decided autonomously
- [Headroom] Q: "Which comments move?" → Selected: "YAML-level comment blocks (comment-only lines outside any run: block scalar) of 2,000 bytes or more, in every job except the frontend aggregator: 24 blocks, measured by research on the 2026-11-27 tree at about 105 KB moved, leaving ci.yml at about 406,650 bytes (about 105 KB under the hard limit, 54 KB under the gate's ceiling). The 25th block is the frontend job's own header, so it stays. Shell comments inside run: bodies stay, so the ARMS_FLOOR derivation table and every in-script note stay put" — moving a block back is a paste.
- [Headroom] Q: "Where do they go?" → Selected: "A new doc, `docs/ci-yml-notes.md`, one `##` section per job, each moved block under a `###` heading naming the job, the step or key it preceded, and a stable anchor; text moved verbatim (de-indented only)" — a doc is edited freely.
- [Headroom] Q: "What stays in ci.yml?" → Selected: "One pointer comment at the block's indentation, naming the doc and the anchor (for example `# Rationale: docs/ci-yml-notes.md#sql-mutation-1`)" — a pointer edit.
- [Headroom] Q: "Is the move provably lossless?" → Selected: "Yes. The move is done by a one-off script (not committed). The executor proves once, and records in the SUMMARY, that ci.yml parses to the same YAML object before and after and that every moved line appears verbatim in the doc. A committed vitest test pins that every pointer in ci.yml resolves to an existing anchor in the doc; the size gate, not a comment-length rule, guards regrowth" — tests are local.
- [Headroom] Q: "Strip the comments, or move the run: bodies into scripts?" → Selected: "Neither. Stripping loses the rationale; script moves change how gates execute and force about six reader tests to follow the code" — reversible either way.
- [Gate] Q: "Where does the size gate run?" → Selected: "A new workflow file, `.github/workflows/workflow-size.yml`, one job `workflow-size`, on pull_request (no paths filter, so it is always in the check count), push to main and workflow_dispatch; it checks out the repo and runs `node scripts/check-workflow-size.mjs`" — a new workflow file is deleted to undo; it never shares a file with ci.yml, so an oversized ci.yml cannot suppress it.
- [Gate] Q: "What ceiling and margin?" → Selected: "Hard limit 512,000 bytes as measured; the gate fails any workflow file above 460,800 bytes (90 percent, a 51,200-byte margin), and prints every file's size, its headroom to the ceiling and to the hard limit. No warning tier: a file is over the ceiling or it is not" — two constants in one script.
- [Gate] Q: "How does the gate prove it can fail?" → Selected: "`--self-test` builds a temporary over-ceiling file and an under-ceiling file, asserts red then green, and the workflow runs the self-test before the real scan; a vitest test pins the script's verdicts and the workflow wiring too" — tests are local.
- [Gate] Q: "Which files are scanned?" → Selected: "Every regular file matching `.github/workflows/*.yml` or `*.yaml`; an empty match is an error, never a pass" — local.
- [Readers] Q: "What about readers that cite a moved comment by quote or line?" → Selected: "Any test, script or pending PLAN.md anchor (plan-anchor-verify) that reads moved comment text is pointed at the doc in the same PR; dated prose elsewhere that merely says 'ci.yml carries X' is left, because the pointer at that spot leads to it" — pointer edits.

- [Consequences] Q: "The merge push runs a FULL sql-mutation pass because the changed-paths and sql-mutation job text moves; accept?" → Selected: "Yes, and the CHANGELOG says so; a PR touching ci.yml already runs FULL" — one run.
- [Consequences] Q: "The new workflow adds a check run that Railway and predecessorVerdict count; accept?" → Selected: "Yes. critical-regressions.test.ts's exact list of PR/push-triggered workflows gains workflow-size.yml; the gate and the shrink ship in one PR, because the unshrunk ci.yml is already over the ceiling" — a list edit.
- [Readers] Q: "Repoint prose that quotes moved comments?" → Selected: "Yes for the two research found: CLAUDE.md's 'ci.yml carries the derivation' and docs/runbooks/shared-test-db-mutex.md's 'ci.yml records that at length'; both name docs/ci-yml-notes.md as well" — pointer edits.
- [Doc] Q: "Doc format?" → Selected: "Moved text in fenced text blocks, no markdown links; docs/ci-yml-notes.md sits outside docs-link-check's runbook globs" — local.

### Claude's Discretion
- How each reader test is adapted (shared helper vs per-file), as long as each still fails when the behaviour it pins changes.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/ci-apt.sh` — precedent for a checked-in script that a ci.yml step runs with `bash scripts/...`.
- `scripts/check-planning-hygiene.ts`, `scripts/check-baseline-currency.mjs`, `scripts/lint-sql-gates.mjs --self-test` — precedent for a `check-*` script with a self-test mode.
- Action pins: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1` (same SHA across workflows).

### Established Patterns
- (Background; these readers read run: bodies, which do not move.) Readers of the `sql-tests` step: `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` (extracts and EXECUTES the body under bash, reads `SENTINEL_FLOOR`/`ARMS_FLOOR` and the derivation table from it), `src/__tests__/drift-check-scripts.test.ts` (around line 4821, pins the floors' literal values from ci.yml), `scripts/local-stack/sql-corpus-report.mjs` (prose pointer), `scripts/test-ledger-drift-check.sh` (prose pointer).
- Readers of the `sql-mutation` assert step: `src/__tests__/sql-mutation-nightly-parity.test.ts` (byte-equal `run:` blocks between ci.yml and the nightly), `src/__tests__/mutation-runner-floors.test.ts` (reads the `biting:` parse, the waiver ceiling read and more from ci.yml), `src/__tests__/sql-mutation-scope-step.test.ts` (step order; last step's name).
- 117 tracked files mention `ci.yml`; the planner greps every reader for text that lives inside the two moved bodies, not only the files above.

### Integration Points
- `ci.yml` jobs `sql-tests` and `sql-mutation`; `sql-mutation-nightly.yml`.
- New `.github/workflows/workflow-size.yml` adds one check run to every PR and to main's head SHA. The expected check count for a PR goes up by one.
- Coordination (updated after research): PR #1405 MERGED as v0.133.110.0 and this branch is rebased on it; its ci.yml hunks sit inside the sql-tests run body, 270 lines from the nearest moved block. Originally: Phase 243 PR #1405 edits `SENTINEL_FLOOR`/`ARMS_FLOOR` and the derivation table inside the `sql-tests` body (and the drift-check-scripts literal). Phase 258 PR #1408 edits `supabase-migrate.yml`. Whichever merges second rebases; if #1405 lands first, its floor edits are ported into the script before ship.

</code_context>

<specifics>
## Specific Ideas

- Measure and print the before and after byte counts of every workflow file in the SUMMARY and the CHANGELOG entry.

</specifics>

<deferred>
## Deferred Ideas

- Moving the smaller comment blocks, or `run:` bodies into scripts, if headroom is ever needed again.

</deferred>
