# ci.yml notes

These are the long rationale and lineage comments that Phase 260 (CIHEADROOM) moved verbatim out of `.github/workflows/ci.yml` on 2026-11-27, with only the block's own indentation removed.

The selection rule was: YAML-level comment blocks of 2,000 bytes or more (a maximal run of comment-only lines outside any `run:` block scalar) in every job except the `frontend` aggregator. Shell comments inside `run:` bodies did not move, and neither did the `frontend` job's own header.

`ci.yml` keeps one pointer comment of the form `# Rationale: docs/ci-yml-notes.md#<anchor>` where each block stood. Words such as "above", "below", "this step" and "this job" inside a block refer to the place in `ci.yml` where its pointer stands.

Why: GitHub starts no run for a workflow file above 512,000 bytes, and `ci.yml` had reached 511,664. `scripts/check-workflow-size.mjs`, run by `.github/workflows/workflow-size.yml`, now fails a PR when any workflow file passes 460,800 bytes.

This file is edited freely. `src/__tests__/workflow-size-gate.test.ts` fails when a pointer in `ci.yml` names no anchor here, or an anchor here has no pointer.

## changed-paths

<a id="changed-paths-1"></a>
### changed-paths-1: job changed-paths, at job level, before `runs-on:`

```text
# Phase 164.6.3 / CI-DOCSPATH-01 — the docs-only path filter's DETECTOR.
# It publishes ONE boolean, `docs_only`, computed by `scripts/classify-
# changed-paths.mjs` from the PR's own diff. Every filtered job below reads
# it through a job-level `if:`; the `frontend` aggregator reads it to judge
# the skips it causes. It changes WHEN gates are invoked and nothing else:
# no gate is added, removed, or made to assert anything different.
#
# ⛔ NO `if:` — BY CONSTRUCTION, and this is the single most load-bearing
# line in the job. Every filtered job depends on this one — most in the
# inline `needs: [changed-paths]` spelling, and five (frontend-coverage,
# test-db-drift, e2e, e2e-seeded, lighthouse-mobile) as an extra entry in a
# `needs:` list they already had; the SPELLING differs, the EDGE does not.
# (⚠️ CORRECTED 2026-09-23, Phase 164.4.2: `sql-tests` moved to the inline
# spelling when it dropped `needs: python`, and `test-db-drift`, which inherited
# that edge, took its place in the list. The inline count this line used to
# state had already drifted before that, so it is no longer restated.) And
# a skipped `needs:` job SKIPS its dependents — the mechanism this file
# already states verbatim in the aggregator's `test-db-drift` arm ("a skipped or
# failed `needs:` job SKIPS its dependents") and again for `e2e-seeded`. A
# conditional here would therefore not skip ONE gate, it would silently skip
# the whole corpus, which is the exact fail-open this phase exists to
# refuse. The job runs on EVERY event and hard-codes a code verdict for
# anything that is not a pull_request, so the push/dispatch corpus is never
# filtered (`ci.yml`'s own header: every commit to main must produce its own
# recorded green run, and Railway waits on main CI).
# (⚠️ CORRECTED 2026-10-01, Phase 164.9.4 review WR-01, by the founder's
# 2026-09-27 routing: a PUSH is now classified by its pushed range
# `before..HEAD` with the same rule, and fails SAFE to code whenever that
# range cannot be determined. A workflow_dispatch is still never filtered.
# A docs-only push is a SHORT run, never a missing one: this job, the
# always-on jobs and the `if: always()` `frontend` aggregator still run, so
# the SHA still gets its own recorded green run. The sentence above is kept
# as lineage.)
#
# ⛔ The DB-touching jobs' ban on new `needs:` edges does NOT apply to this
# one, for the same reason it does not apply to `sql-gate-lint` and
# `sql-mutation`: that ban exists because those jobs share the TEST
# advisory-lock mutex and their `if:` conditions diverge, so a chain edge can
# silently skip a dependent. `changed-paths` has no `if:`, shares no
# resource, waits on no mutex, touches no database and runs identically on a
# fork PR, a same-repo PR, a push and a workflow_dispatch. Without this
# paragraph a future reader reads the sixteen new edges as a violation of
# that ban; they are not.
#
# `permissions:` and `concurrency:` are inherited from the workflow level
# (lines ~40 and ~53) exactly as every other job here does; restating them
# per-job would fork two sources of truth for no gain, and a second
# concurrency group inside a workflow that already has one changes
# cancellation semantics rather than tightening them. `contents: read` is
# sufficient here — the `git diff` route was chosen over a third-party
# changed-files action precisely so no permission uplift and no new action
# SHA are needed.
# (⚠️ CORRECTED 2026-10-02, Phase 164.9.4 review round 2, SFH-04: this job
# now declares its OWN `permissions:` block, `contents: read` plus
# `checks: read`. On a docs-only push the classifier reads the `frontend`
# check run on `before` through `gh api` and takes the short path only when
# it concluded `success`. A job-level block REPLACES the workflow-level one,
# so `contents: read` is restated, not inherited. No new action SHA. The
# sentence above is kept as lineage.)
# (⚠️ CORRECTED 2026-10-02, review round 3, WR-01 + SFH LOW-04: the block
# stays `contents: read` plus `checks: read`, but the classifier now reads
# EVERY GitHub Actions check run on `before`, all workflows and all events,
# not only `frontend`. That mirrors Railway's own gate, which
# docs/runbooks/railway-worker.md records as the commit's check-runs, every
# workflow's non-red. `e2e` and `lighthouse-mobile` sit outside the
# `frontend` aggregator, and CI run `36892795002` concluded failure while its
# `frontend` concluded success. The paragraph above is kept as lineage.)
#
# ⭐ Phase 164.4.2 / DECISION D — this job ALSO publishes the SQL gate
# SUBSET that `sql-mutation` narrows to on a pull request:
# `sql_gate_mode` (`full` | `subset`) and `sql_gate_files` (space-separated
# repo-relative `supabase/tests/test_*.sql` paths, empty on `full`), both
# computed by `scripts/sql-gate-subset.mjs`. WHY HERE and not in a job of
# its own: this job is already a `needs:` of `sql-mutation`, already checks
# out with `fetch-depth: 0` for the three-dot diff, and already owns "what
# changed against the merge base" — the derivation calls the SAME
# `changedFilesAgainstBase()` the docs classifier does. A second job
# computing it would be a second deep clone and a second diff to keep
# identical. The derivation hard-codes FULL for every event that is not a
# pull_request, and forces FULL when the mutation machinery or a migration
# changed; `sql-mutation` refuses the subset on a non-PR event independently.
# ⛔ Adding these two outputs changes nothing about `docs_only` and adds no
# `if:` — the no-`if:` paragraph above binds this derivation too.
# (⚠️ CORRECTED 2026-10-03, Phase 164.9.6 D-01/D-03/D-09/D-10: on a push to
# `refs/heads/main` the derivation no longer hard-codes FULL. It judges the
# PUSHED range through `pushRangeFiles`, the lister it shares with the docs
# classifier, and emits `subset` (the changed gates plus every gate whose
# RED-UNDER-SETUP loads a changed migration), `none` (the range changed no
# gate, no migration and no mutation machinery) or `full`, each with a
# reason. Every doubt about the range reads FULL. The job now publishes a
# THIRD output, `sql_gate_reason`, one printable line saying why. A
# workflow_dispatch, a schedule and a push to any other ref still read
# FULL. On a pull request it is unchanged. The sentence "The derivation
# hard-codes FULL for every event that is not a pull_request" above is kept
# as lineage.)
# (⭐ 2026-10-03, Phase 164.9.6.1 D-02: the block gains `actions: read`.
# The SQL gate subset's tolerant predecessor proof reads the `sql-gate-lint`
# job log through the job-logs endpoint
# (`repos/<repo>/actions/jobs/<id>/logs`), which needs the Actions read
# scope. Without it the read fails and the proof fails SAFE to FULL, so a
# predecessor red only with the founder-tolerated baseline drift would
# still force a FULL sql-mutation run and the tolerance would never engage.
# The paragraphs above that say the block is `contents: read` plus
# `checks: read` are kept as lineage.)
```

## frontend-local-stack

<a id="frontend-local-stack-1"></a>
### frontend-local-stack-1: job frontend-local-stack, at job level, before `needs:`

```text
# Phase 164.5 / VAC-07 — THE LOCAL-STACK LANE. App-level specs against a REAL
# Supabase stack (Postgres + PostgREST + GoTrue), booted by
# `scripts/local-stack/run.sh up` from the committed `supabase/schema/baseline.sql`.
#
# WHY IT EXISTS. `src/__tests__/csv-finalize-concurrent-never-classified.test.ts`
# fires TWO concurrent `csv-finalize` POSTs on ONE never-classified
# `wizard_session_id` from two supabase-js clients with SEPARATE access tokens, and
# asserts exactly one applied receipt, one named refusal, and a `category_id`
# holding the winner. That guarantee lives in the database — the partial unique
# index `strategies_user_wizard_session_source_uniq` plus the route's
# compare-and-set — so a mocked client cannot open the race at all. Nor can the
# pg-lane `sql-mutation` uses: it is BARE POSTGRES, with no PostgREST and no
# GoTrue, and `scripts/local-stack/run.sh` states the boundary in its own header.
#
# ⛔ AND THIS JOB IS WHAT MAKES THAT SPEC EXECUTE AT ALL. The spec is deliberately
# EXCLUDED from `vitest.config.ts`'s jsdom project (`vitest.local-stack-files.ts`)
# so the sharded `frontend-test` job — which has no stack — does not redden. The
# consequence is exact: WITHOUT THIS JOB THE SPEC RUNS NOWHERE. That is the shape
# of `src/__tests__/csv-finalize-rpc.test.ts`'s tombstone — six live-DB cases that
# skipped silently in every CI shard, for months, over a function that had been
# DROPped — and the sentence recorded there is the standard this job clears:
# "Coverage that cannot execute is worse than absent coverage."
# `src/__tests__/local-stack-lane-wiring.test.ts` runs in the ORDINARY shards and
# fails if this job is renamed or removed, stops naming
# `vitest.local-stack.config.ts`, or drops out of either aggregator list.
#
# ⛔ THE SPEC FAILS — IT DOES NOT SKIP — WHEN THE STACK IS ABSENT, so a broken boot
# step cannot green-wash this job. Its setup throws a message naming
# `scripts/local-stack/.stack-env` and the command that writes it. MEASURED
# 2026-09-07 with the lane deliberately down: `Tests 2 failed (2)`, exit 1, and
# ZERO skipped — the word this file's tombstone is remembered by never appears.
#
# AGGREGATOR ROW — DECIDED HERE, NOT LEFT TO OMISSION. This job references NO
# secret and NO repository variable, carries NO `if:`, holds NO `needs:`, touches
# NO shared resource (its stack is Docker containers private to its own runner —
# `run.sh` REFUSES any non-local DSN, so it can reach neither shared TEST nor
# PROD), and waits on no mutex. It therefore runs identically on a fork PR, a
# same-repo PR, a push and a `workflow_dispatch`; it has no legitimate skip; and a
# `skipped` result is ALWAYS a real fault. ⇒ It takes the `frontend:` result
# loop's STRICT DEFAULT ARM with NO tolerance — the `frontend-seam-redis` /
# `sql-gate-lint` / `sql-mutation` reasoning, and the OPPOSITE of the `test-db-drift` /
# `e2e-seeded` rows, whose tolerances exist only because those jobs consume a repo
# variable a fork cannot see.
# ⛔ The DB-touching jobs' ban on new `needs:` edges does NOT apply to this one:
# that ban exists because those jobs share the TEST advisory-lock mutex and their
# `if:` conditions diverge, so a chain edge can silently skip a dependent. This job
# shares no resource, waits on no mutex, and has no `needs:` of its own to skip
# through.
#
# ⚠️ `timeout-minutes` — A HEADROOM FIGURE OVER ONE UNMEASURED TERM, SAID SO.
# MEASURED 2026-09-07 on macOS/darwin-arm64 with all 13 stack images ALREADY
# CACHED: `run.sh up` (start + baseline load) 26-31 s, the spec itself 1-2 s,
# `down` 2-3 s — about 36 s of lane work. The UNMEASURED term is a COLD
# `supabase start` on a fresh ubuntu runner, which must pull those 13 images,
# plus `npm ci` on a node_modules cache miss. No SHA-bound ubuntu run of this job
# exists yet, so 20 is headroom over an unmeasured pull, NOT a measured total.
# ⛔ When the first green ubuntu run reports its wall clock, REPLACE this with a
# value derived from it. Do not answer a crossing by widening it again.
# Phase 164.6.3 / CI-DOCSPATH-01 — docs-only path filter: this changes WHEN
# this job is invoked (not on a `.planning/`-only PR), never WHAT it asserts.
# ⚠️ CORRECTION to the AGGREGATOR ROW paragraph above, which states this job
# "carries NO `if:`, holds NO `needs:`" and again that it "has no `needs:` of its
# own to skip through". As of this phase it holds both, and ONLY these two: the
# detector edge and the docs-only conjunct. Every other clause of that paragraph
# stands — no secret, no repo variable, no shared resource, no mutex — so its row
# keeps the STRICT DEFAULT ARM with no tolerance of its own.
```

<a id="frontend-local-stack-2"></a>
### frontend-local-stack-2: job frontend-local-stack, inside step `Capability probe - does the lane supply what the SQL self-test corpus demands`, before `env:`

```text
# Phase 164.4.2 plan 04, RESEARCH Assumption A1, MEASURED here rather than
# assumed. `sql-tests` was to move onto this lane only if the lane supplied what
# `supabase/tests/test_*.sql` needs: pg_net, the supabase_vault extension,
# auth.uid()/auth.jwt(), the three platform roles and pg_cron. The probe
# derives DEMAND from the corpus every run (files mentioning each object,
# LANE-ONLY files excluded) and reads SUPPLY from this lane's own catalogue
# through the mode-600 `.stack-env` handoff `run.sh up` just wrote. It prints
# ONE `stack-probe:` line with both sides on it. The DSN is never printed.
#
# ⚠️ INFORMATIONAL ABOUT CAPABILITY, FATAL ABOUT MEASUREMENT, ON PURPOSE AND
# FOR NOW. This step FAILS when the probe could not measure: a MEASURE_FAIL
# verdict, an absent line, a count or state it cannot read, or an exit status
# that contradicts the printed verdict. It PASSES with a ::warning:: on
# `verdict INSUFFICIENT`. Nothing THIS job runs depends on those capabilities,
# and a gate that goes red over a capability its own subject does not use is a
# gate that gets disabled.
# ⭐ HAND-OFF TAKEN, 2026-09-23 (Phase 164.4.2 plan 05) — in `sql-tests`, not
# here. Plan 04's decision read this step's line on run 35816624285 (`verdict
# SUFFICIENT`) and chose PROCEED. `sql-tests` now boots its own copy of this
# lane and runs this probe FATAL on INSUFFICIENT before its corpus, because its
# corpus is what consumes the capabilities. This step keeps the tolerance on
# purpose: on the same boot a red here would only duplicate `sql-tests`'s red
# under a job that does not depend on them. ⛔ The tolerance is not a pattern;
# do not copy it to a gate whose subject needs the capabilities.
# DECISION C still allows the fallback only on a refutation that was measured
# and written down with its run id.
#
# Captured to a file and `cat` back rather than piped through `tee`, for the
# `sql-mutation` reason: a pipe makes `$?` the last command's status.
```

## frontend-live-db-lane

<a id="frontend-live-db-lane-1"></a>
### frontend-live-db-lane-1: job frontend-live-db-lane, at job level, before `needs:`

```text
# Phase 164.9 plan 08 / ROADMAP criterion 13 — THE LIVE-DB LANE. The ~49 specs
# gated on `HAS_LIVE_DB` (`src/lib/test-helpers/live-db.ts`), run against a REAL
# Supabase stack booted by `scripts/local-stack/run.sh up` from the committed
# `supabase/schema/baseline.sql`.
#
# WHY IT EXISTS, and why it is not simply credentials on the shards. That whole
# class SKIPS in every vitest shard, and the `frontend-test` job below forbids
# fixing that in the obvious way IN ITS OWN WORDS: adding the two live-DB
# variables there would un-skip the class inside the shards, shift the merged
# report's denominator and invalidate the ratchet baseline — which was measured
# with those tests skipped, and which backs a BLOCKING gate. So the class gets
# its own INVOCATION instead. ⛔ Nothing in this plan changed `frontend-test`;
# its prohibition, its shard matrix and its reporting behaviour are untouched.
#
# ⭐ AND IT RUNS UNDER AN EXECUTION LEDGER (Phase 164.9, the ledger round arising
# from plan 08 and its fix round). 18 arms of this corpus fail against the
# committed schema-only baseline and NONE is closable by a fixture — the fix
# round already closed all 17 that were. `scripts/live-db-execution-ledger.txt`
# is the dated, shrink-only record of exactly those 18, and the job is GREEN iff
# the failing set MATCHES it and RED the moment it changes in either direction.
# ⛔ That is a RATCHET, not a tolerance: the row stays in the aggregator's STRICT
# default arm, nothing here is advisory, no test is skipped and every test still
# executes. Read the ledger's own header before touching it.
#
# ⭐ THE PRECEDENT, AND THE INVERSION. `frontend-seam-redis` above sets env
# JOB-WIDE and its own comment calls itself "the exact INVERSE of the
# frontend-test warning". This job is the same shape for the same reason: the
# live-DB variables reach these specs HERE and only here, safe because this job
# runs the DERIVED live-DB corpus and nothing else. ⛔ NEVER WIDEN THIS JOB'S
# TEST SELECTION. Widening it is the one edit that turns the sentence above from
# true into false, and nothing else in this file would notice.
#
# NO SECRET AND NO REPOSITORY VARIABLE is referenced anywhere in this job. Every
# credential it uses is minted by the stack it boots and handed over through the
# mode-600 `scripts/local-stack/.stack-env` written by `run.sh up`. It therefore
# runs identically on a fork PR, a same-repo PR, a push and a workflow_dispatch —
# which is what earns it the `frontend:` result loop's STRICT DEFAULT ARM with no
# tolerance of its own, the `frontend-seam-redis` / `sql-gate-lint` /
# `sql-mutation` / `frontend-local-stack` reasoning and the OPPOSITE of the
# `test-db-drift` / `e2e-seeded` rows, whose tolerances exist only because those jobs
# consume a repo variable a fork cannot see. (`sql-tests` held the first of those
# rows until Phase 164.4.2 moved it onto a private database; it now takes the strict
# arm this job does.)
#
# ⛔ THE LANE REFUSES TO BOOT IN THE PRODUCTION-LINKED CONTEXT, and it is asserted
# rather than commented. `vitest.livedb.globalsetup.ts` asks `run.sh
# --print-workdir` where the stack would start and throws if the answer is this
# repository's own `supabase/` directory — the directory this checkout's CLI
# context links to PRODUCTION and which governs production deploys. `run.sh` is
# the ONLY way this job reaches the CLI; no bare invocation appears anywhere in
# it.
#
# ⛔ AND THE LANE FAILS RATHER THAN SKIPS WHEN THE STACK IS ABSENT. Measured while
# building it: with no stack up, `npm run test:live-db` exits 1 with a named
# refusal and ZERO skipped tests. A quietly-skipping live-DB corpus is
# `src/__tests__/csv-finalize-rpc.test.ts`'s tombstone — six live-DB cases that
# skipped silently in every shard for months — and it is the exact condition
# criterion 13 exists to end.
#
# ACCEPTED COST, stated rather than discovered later: the `frontend` aggregator
# now waits on a SECOND container-booting job. That is wall clock spent to give a
# previously ungated test class a place where it can go RED, which is the trade
# criterion 13 exists to make. The two container jobs are independent of each
# other and run in parallel, so the cost is the slower of the two, not their sum.
#
# ⚠️ `timeout-minutes` — HEADROOM OVER AN UNMEASURED TERM, SAID SO, in the same
# words `frontend-local-stack` uses for its own. What is measured: this corpus is
# 49 files driving real HTTP against PostgREST and GoTrue, run with
# `fileParallelism: false` because they share one database. What is NOT measured:
# their wall clock on a cold ubuntu runner that must pull the stack images, since
# no SHA-bound run of this job exists yet. 30 is headroom over that, NOT a
# measured total. ⛔ When the first green run reports its wall clock, REPLACE this
# with a value derived from it rather than widening it again.
#
# ⛔ THE COST THIS LANE CANNOT COVER, named so nobody reads it as broader than it
# is: a local stack cannot catch drift that exists only on the shared project.
# That drift has its own gates — VAC-08 (the `test-db-drift` job) for repo-versus-
# shared-project ledger and function bodies, VAC-04 (in `migration-drift-check.yml`)
# for repo-versus-production bodies. This job is not a substitute for either.
#
# Phase 164.6.3 / CI-DOCSPATH-01 — docs-only path filter, on ONE physical line:
# this changes WHEN this job is invoked (not on a `.planning/`-only PR), never
# WHAT it asserts. A skip caused by that `if:` is judged by the aggregator's ONE
# uniform docs-only arm, never by an arm of this row's own.
```

## sql-gate-lint

<a id="sql-gate-lint-1"></a>
### sql-gate-lint-1: job sql-gate-lint, at job level, before `needs:`

```text
# Phase 164.3 / VAC-03 — the static vacuity linter over supabase/tests/*.sql.
#
# WHY IT EXISTS. Phase 164's review found five distinct mechanisms by which
# an arm of a SQL gate file was GREEN in CI while proving nothing. All five
# shipped, passed review, and passed this very workflow. Three of them, plus
# one narrow case of a fourth, are detectable in the file TEXT — so a sixth
# instance written into a NEW gate file becomes a lint failure on the
# pushing developer's machine instead of a red-team finding two phases on.
# There is deliberately no rule for the fifth mechanism (arm reachability is
# not statically decidable, phase decision D-16); the mutation runner's
# first-failure identity assertion is its detector.
#
# HERMETIC BY DESIGN: NO database, NO Docker, NO secrets, NO network — so
# this gate can never flake, and it runs identically on a fork PR, a
# same-repo PR, a push and a workflow_dispatch. That property is what earns
# it the NO-TOLERANCE row in the `frontend` aggregator below: unlike
# `test-db-drift` and `e2e-seeded`, it has no legitimate reason to be skipped,
# so any non-success is a real fault. Same reasoning as `frontend-seam-redis`.
#
# `permissions:` and `concurrency:` are inherited from the workflow level
# (lines ~40 and ~53) exactly as every other job here does; restating them
# per-job would fork two sources of truth for no gain, and a second
# concurrency group inside a workflow that already has one changes
# cancellation semantics rather than tightening them.
#
# Phase 164.6.3 / CI-DOCSPATH-01 — WHEN this gate is invoked, never WHAT it
# asserts: on a PR whose diff is entirely under `.planning/` it does not
# run. The NO-TOLERANCE rule stated above is untouched — a `skipped` here is
# judged by the aggregator's one uniform docs-only arm, not by a tolerance
# arm of this row's own, and on any code PR this `if:` is true and the job
# runs exactly as it did before.
```

<a id="sql-gate-lint-2"></a>
### sql-gate-lint-2: job sql-gate-lint, before step `Baseline content-drift gate self-test - every finding kind fires on a synthetic corpus`

```text
# ── Phase 164.5, criterion 7: BASELINE-CONTENT-DRIFT ──────────────────
# A THIRD SIBLING in this job, for the same reason the app-GUC gate is a
# sibling rather than a rule: different corpus (supabase/schema/, not
# supabase/tests/ or supabase/migrations/), different engine. It calls
# `diffFunctionBodies()` from scripts/sql-body-normalize.mjs — Phase
# 164.3's D-05 declared SINGLE shared normalizer — and writes no second
# one. Same hermetic contract (no DB, no Docker, no secrets, no network),
# same mode identity: these two lines are the EXACT commands a developer
# runs, pasted verbatim from the script's own header.
#
# WHAT IT CATCHES that nothing else does. Phase 164.5's co-edit gate fires
# on a BYTE CHANGE to supabase/schema/baseline.sql. It structurally cannot
# fire in the other direction — a migration moves a function body and the
# committed dump is left alone — which is exactly what Phase 164.7 did.
# This pins the dump to the chain and lands BEFORE any migration squash
# (decision D-04): squashing onto an unpinned, already-drifted baseline
# would freeze that drift into the new floor permanently.
#
# ⚠️ DATED 2026-09-07. This gate ships GREEN, not red-by-design. Its
# known drift — MEASURED 114 MATCH / 6 DRIFT / 2 SNAPSHOT_MISSING /
# 0 SNAPSHOT_ONLY / 0 UNCOMPARABLE — is carried as EIGHT dated rows in
# CONTENT_DRIFT_ALLOWLIST, each pinning the snapshotHash/candidateHash
# PAIR plus nargs and the differing-line count. That is plan 164.5-03's
# P-03 decision: PRECEDENT B (a ratchet) over PRECEDENT A (the declared
# red interval the app-GUC steps above ran for four plans). This phase
# exists because an artifact shipped with no staleness gate and no
# consumer; a gate that cannot block for an interval reproduces that same
# class in a smaller form.
#
# ⛔ THE ROWS MAY ONLY SHRINK, and a red corpus step from here is a
# REGRESSION. It is NEVER cleared by adding a row or by loosening the pin:
#   • a DIFFERENT drift on an already-pinned function fails
#     (`allowlist-hash-moved`) — the pin is the hash pair, never the name;
#   • a row that has stopped being true fails (`allowlist-stale`) and says
#     to DELETE it;
#   • a row missing either hash is refused at startup
#     (`allowlist-malformed`);
#   • UNCOMPARABLE is a MEASURE_FAIL, never a pass.
# `src/__tests__/baseline-content-drift-allowlist.test.ts` re-derives the
# row count and the name set from the script's own bytes and fails in
# BOTH directions, so neither growth nor un-recorded progress is silent.
#
# What DOES clear a row: a regeneration of supabase/schema/baseline.sql
# from PROD. That is a separate REVIEWED act on a credential-bearing
# surface, and it also moves the sha256 recorded in
# supabase/schema/BASELINE.md — three coupled edits, not a step inside a
# hermetic gate.
#
# ⚠️ STATED BLINDNESS, printed by the gate on every run: FUNCTION BODIES
# ONLY. No tables, columns, policies, triggers, grants or indexes. The
# chain side is supabase/schema/functions/*.sql, a hermetic TEXT-REPLAY
# rendering (its own currency gated by `tsx scripts/dump-sql-functions.ts
# --check` in sql-function-snapshot.yml), NOT a live replay — 69 of 262
# migrations fail to replay from empty, so a live replay is impossible
# here rather than merely slow.
```

<a id="sql-gate-lint-3"></a>
### sql-gate-lint-3: job sql-gate-lint, before step `Assert the extractor self-test PRINTED its kind census and cleared the floor`

```text
# ⛔ [164.8.1 review, finding 2] THE EXIT CODE IS NOT THE MEASUREMENT.
# The bare step above asserts only that the script exited 0 — and a module
# whose main guard does not fire exits 0 having emitted NOTHING. That is
# not hypothetical: the script's own tail records the macOS
# `/var` -> `/private/var` case where the entry-point comparison was false
# for every copy under a temp dir and this file "exited 0 having emitted
# NOTHING". The realpath fix landed; the FAILURE MODE stayed reachable,
# and a silent no-op satisfied this step. So the command is re-run with its
# stdout captured and the census line it must PRINT is asserted.
#
# Only the stdout fd differs — argv is byte-identical to the bare line
# above, which stays as the mode-identity pin that
# src/__tests__/refdata-allowlist.test.ts reads (`run: <cmd>`, trimmed,
# exactly once per workflow), and is the same reasoning the `sql-mutation`
# job records for its own RUNNER_LOG.
#
# ⛔ NO `|| true` AND NO BARE ZERO-STATUS `exit` IN THIS BLOCK. Its twin in
# test-restore-from-baseline.yml lives in a job whose softening-token scan
# (src/__tests__/test-restore-workflow-wiring.test.ts) refuses both, and
# the two copies are kept as ONE text. `set -uo pipefail` WITHOUT `-e` is
# what makes that possible: a non-matching `grep` yields the empty string
# instead of aborting the step, so an absent line reaches its own
# MEASURE_FAIL message rather than dying with no `::error::` at all.
#
# ⛔ CORRECTED 2026-09-25 (Phase 164.9.2, plan-checker W1). The paragraph
# above is FALSE and is kept as lineage. GitHub runs every `run:` here as
# `bash -e {0}` (no `shell:` override in this file), and `set -uo pipefail`
# never turns `-e` off. So each unbounded capture below (`node` status,
# `ok_line`, `floor`, and in the next step `census` and `scanned_line`)
# aborted the step BEFORE its own MEASURE_FAIL could print: red, but
# unnamed. The twin in test-restore-from-baseline.yml was fixed on
# 2026-09-10; this copy was not. Each capture now carries the same
# `|| <name>=$?` bound and rc>1 branch as the twin, and both copies are
# EXECUTED under `bash -e` by src/__tests__/test-restore-workflow-wiring.test.ts.
```

<a id="sql-gate-lint-4"></a>
### sql-gate-lint-4: job sql-gate-lint, before step `Data-dependence gate self-test - every refusal fires on its red fixture`

```text
# ── Phase 164.9, criterion 5: the data-dependent migration refusal ────
# A FIFTH SIBLING in this job, and — like the app-GUC gate, the baseline
# content-drift gate and the reference-data audit above — NOT an eighth
# rule of lint-sql-gates. Different corpus (supabase/migrations, not
# supabase/tests) and a different question: does a migration's guard raise
# on rows the TEST database does not have? Same hermetic contract — no
# database, no Docker, no secrets, no network — which is what earns it a
# place in the job the `frontend` aggregator gates with NO tolerance.
#
# WHAT IT CATCHES that nothing else does. The TEST restore is SCHEMA-ONLY,
# so TEST mirrors production's CATALOGUE and never its DATA. A migration in
# this repo's house style — an anonymous block that reads a populated table
# and RAISEs on an unexpected count — therefore applies cleanly to
# production and REFUSES on TEST; and because a failed TEST apply gates the
# production apply, that refusal WITHHOLDS A PRODUCTION DEPLOY. Nothing
# else in CI sees the shape: it is valid SQL, it passes review, and it is
# green everywhere until the merge that applies it.
#
# ⛔ IT IS A MECHANISM, NOT A PRAGMA, and there is no opt-out marker by
# DECISION. Phase 164.8 designed the escape hatch, specified it with a
# three-arm proof, and deliberately did not build it because it had zero
# consumers. A hatch is something a person must remember to claim under
# exactly the deploy pressure that makes people claim things; a refusal on
# the pull request cannot be forgotten and cannot be claimed.
#
# ⛔ A RED CORPUS SCAN IS CLEARED BY MAKING THE MIGRATION'S SELF-VERIFICATION
# CATALOGUE-ONLY, OR BY MAKING THE READ TOLERANT OF AN EMPTY TABLE — never
# by relaxing the classifier and never by widening
# scripts/lint-migration-data-dependence-baseline.txt, which only shrinks.
# For something ALREADY MERGED the interim remedy is unchanged and is
# REVERT THE MERGE, never an edit to supabase-migrate.yml.
#
# Mode identity: the two bare lines below are the EXACT commands a
# developer runs locally, pasted verbatim from the script's own header.
```

<a id="sql-gate-lint-5"></a>
### sql-gate-lint-5: job sql-gate-lint, before step `Assert the data-dependence scan PRINTED its corpus census`

```text
# ⛔ THE EXIT CODE IS NOT THE MEASUREMENT. The bare step above asserts only
# that the script exited 0 — and a module whose main guard does not fire
# exits 0 having emitted NOTHING. This job carries a MEASURED record of
# exactly that for its sibling extractor (the macOS /var -> /private/var
# entry-point comparison, above), where a silent no-op satisfied a bare
# step. So the command is re-run with its stdout captured and the census
# line it must PRINT is asserted. Only the stdout fd differs: argv is
# byte-identical to the bare line above, which stays as the mode-identity
# pin that src/__tests__/lint-migration-data-dependence.test.ts reads.
#
# ⛔ NO SOFTENING TOKEN IN THIS BLOCK: no trailing-truth command after a
# pipeline, and no bare zero-status `exit`. The tokens are deliberately
# NOT spelled out here — the acceptance scan for these steps greps this
# very region for them, so a prohibition written literally would report
# itself as the violation. Its twin above, outside that region, spells
# them out; this one names the class.
# `set -uo pipefail` WITHOUT `-e` is what makes that possible: a
# non-matching `grep` yields the empty string instead of aborting the step,
# so an absent line reaches its own MEASURE_FAIL message rather than dying
# with no `::error::` at all.
#
# ⛔ CORRECTED 2026-09-25 (Phase 164.9.2 plan 04 follow-up). The paragraph
# above is FALSE and is kept as lineage; it is the same false claim the
# reference-data steps' dated correction answers. The runner gives every
# `run:` here `bash -e {0}`, and `set -uo pipefail` never turns `-e` off, so
# the unbounded `node` status capture and `census` grep aborted this step
# BEFORE their own `::error::` lines: red, but unnamed. Both now carry the
# reference-data steps' `|| <name>=$?` bound (and an rc>1 branch for the
# grep), and src/__tests__/test-restore-workflow-wiring.test.ts EXECUTES
# this body under `bash -e`.
```

## sql-mutation

<a id="sql-mutation-1"></a>
### sql-mutation-1: job sql-mutation, at job level, before `needs:`

```text
# Phase 164.3 / VAC-01 + VAC-02 — the RED-UNDER mutation runner over the
# annotated SQL gate corpus. THE ON-EVERY-PUSH DETECTOR THIS PHASE EXISTS
# TO CREATE.
#
# WHY IT EXISTS. A gate arm that CANNOT FAIL is indistinguishable from a
# passing one by every signal a reviewer reads — green check, green log,
# three specialist reviews. All five vacuity mechanisms Phase 164's review
# catalogued were GREEN in this very workflow. The only way to know an arm
# can fail is to BREAK the thing it guards and watch it fail, so that is
# what this job does: for each annotated arm it applies the
# arm's declared mutation to COPIES, runs the gate, and requires that the
# FIRST `TEST FAILED (…)` names THAT arm — red-anywhere is not success —
# then restores and requires green. `sql-gate-lint` above catches the
# statically-decidable shapes; this catches the one that is not (D-16).
#
# ⛔ IT MUST NOT TOUCH THE SHARED TEST DATABASE, and that is a hard
# constraint rather than a preference (D-07). The run deliberately BREAKS
# arms and restores them, and TEST sits behind an advisory-lock mutex shared
# with everyone else's CI. Every arm therefore gets its OWN throwaway
# PostgreSQL cluster, created by `scripts/pg-lane/run.sh` under a scratch
# dir and torn down on success, on failure and on interrupt.
#
# CONSEQUENCE FOR THE AGGREGATOR ROW: no secret, no repo variable, no shared
# resource, no `if:` — so this job runs identically on a fork PR, a same-repo
# PR, a push and a workflow_dispatch, and a `skipped` result is ALWAYS a real
# fault. It therefore takes the aggregator's STRICT default arm with NO
# tolerance, exactly like `frontend-seam-redis` and `sql-gate-lint`, and the
# OPPOSITE of `test-db-drift` / `e2e-seeded`. (Since Phase 164.4.2 `sql-tests`
# is on THIS side: it runs its corpus on a private database and cites this
# paragraph for its own strict row.)
# ⛔ The DB-touching jobs' ban on new `needs:` edges does NOT apply here: that
# ban exists because those jobs share the TEST advisory-lock mutex and their
# `if:` conditions diverge, so a chain edge can silently skip a dependent.
# This job has NO mutex, NO `if:`, and its clusters are private to its own
# runner — it can neither queue behind the mutex nor skip a dependent.
#
# `permissions:` and `concurrency:` are inherited from the workflow level
# (lines ~40 and ~53), matching `sql-gate-lint` and every other job here.
# Restating them per-job would fork two sources of truth, and a second
# concurrency group inside a workflow that already has one changes
# cancellation semantics rather than tightening them.
#
# No `npm ci` and no node_modules: `run.mjs` and `parse.mjs` import only
# node builtins. An install this job does not need is an install that can
# fail and flake the gate.
#
# ⭐ REVERSAL, 2026-09-04 (phase 164.4.1, PGCRON-LANE). This job now DOES
# install one thing — `postgresql-<major>-cron` — and the sentence above is
# the standard it has to clear, not a rule being quietly ignored. It clears
# it on all three counts:
#   * It is an install this job NEEDS. Five idiom gate files (~103 sections)
#     probe `pg_extension` for pg_cron, and THREE of them read
#     `cron.job.command` as an ORACLE for the deployed job body
#     (164.4.1-RESEARCH § Q3). Without the extension on the lane those files
#     cannot be annotated at all — they were DEFERRED as `lane-blocked:` for
#     exactly that reason, and retiring that deferral is this phase.
#     A shim was costed and REJECTED by measurement: it would have to
#     reimplement `cron.schedule()` faithfully enough to satisfy those
#     oracles, i.e. an oracle written by the same hand as the claim, while
#     the real extension measures +0.009 s/lane (RESEARCH § Q4).
#   * It cannot flake in the way that sentence guards against. It is a
#     distro/PGDG apt package on an ephemeral runner — no registry account,
#     no build, no network beyond apt's own signed chain — unlike an `npm
#     ci` resolving a live dependency graph.
#   * Its failure mode is LOUD and EARLY: the step ends with `ls -l` on the
#     `.so` and the `.control`, under `set -euo pipefail`, so a missing
#     artifact exits the step non-zero BEFORE any lane is spawned, instead
#     of surfacing later as an opaque per-lane start failure. (The lane
#     itself also refuses with a named diagnosis — `scripts/pg-lane/run.sh`,
#     the two pg_cron layers — so neither side degrades silently.)
# ⛔ This reversal licenses THIS install and no other. A second one must
# argue itself here on the same three counts.
#
# TIMEOUT (threat T-164.3-20): the cost is one lane per annotated arm plus a
# baseline and a restore leg; the run PRINTS its own `per-arm lane time:`
# line, which is the number to re-read rather than a figure restated here.
#
# ⛔ PROJECT FROM THE PER-LANE COST, AND FROM THE WORST ONE OBSERVED — never
# from the arm count alone. A linear fit over arm count is what stood here
# until 2026-09-03, and a measurement falsified it: it projected ~313s for
# 189 arms and the job took 458s, 46% over. The two per-lane observations,
# both dated, are the whole reason:
#   * mean 1.0s/lane — EVERY ubuntu run up to 163 arms (33751634051: 45 arms
#     / 119s; 33774615747: 86 / 171s; 33785233457: 134 / 232s;
#     33794810067: 163 / 278s) AND every local run on the authoring box,
#     including 219 arms / 266s wall (2026-09-04, plan 164.4-08).
#   * mean 1.7s/lane — ubuntu run 33804312706 (2026-09-03, plan 164.4-07,
#     189 arms, 458s wall). The SAME corpus measured 1.0s/lane locally, so
#     the cost is a property of that ubuntu run, not of the batch content.
# For ONE day those two readings could not be separated — CI-host variance
# and a real ubuntu-only per-lane cost predict the same single data point —
# so this comment projected from the WORST (1.7s) plus the fixed non-lane
# overhead that run implies (458 - 189 x 1.7 ~= 137s: checkout, node setup,
# cluster init, per-arm orchestration). The NEXT run settled it; see below.
#
# ⭐ RESOLVED 2026-09-04 — THE 1.7s WAS HOST VARIANCE, NOT A PER-LANE COST.
#   this batch, 219 arms:  333s = 5.6 min at mean 1.0s/lane   [MEASURED,
#     ubuntu run 33854344121, PR #738 head 33e5a8c6]
#   Decisive because it is LARGER and FASTER than the run that raised the
#   question: 219 arms / 333s / 1.0s beats 189 arms / 458s / 1.7s. A real
#   per-lane cost cannot be unpaid by a bigger corpus, so run 33804312706 is
#   an outlier and the model holds at ~1.0s/lane + ~130s fixed.
# ⚠️ Keep BOTH observations above. If a future run measures ~1.7s again, the
#   outlier reading is falsified and the 9.8-min worst case returns; that is
#   the number to re-derive from, not this projection.
#
# ⛔ CORRECTED 2026-09-04 (plan 164.4-11) — COUNT LEGS, NOT ARMS. The model
#   above multiplied the ARM count by the per-lane cost, and that UNDERCOUNTS
#   by construction: this job also runs a BASELINE leg and a RESTORE leg PER
#   FILE (the first line of this comment says so; the projection did not use
#   it). Every newly annotated FILE therefore adds two lanes that no arm
#   count sees. legs = arms + 2 x annotated files, and both quantities are
#   printed by the run itself — `lane-invocations: <arms> (… plus <F>
#   baseline / <F> restore leg(s))`.
#   Re-derived over the two most recent ubuntu runs, both SHA-bound and both
#   timed from the job's own started_at/completed_at:
#     239 arms / 28 files = 295 legs -> 369s   [run 33872399902, f9f455b6]
#     247 arms / 32 files = 311 legs -> 464s   [run 33882082307, 4591b17d]
#   The 16-leg step between them cost 95s, so these two do NOT determine a
#   line — the spread is host variance, exactly the class resolved above.
#   Project from the WORST per-leg observed, which is the discipline this
#   comment already used for per-lane: (464 - 130) / 311 = ~1.07 s/leg.
#   phase end, 262 arms / 39 files = 340 legs:
#     340 x 1.07 + 130 ~= 494s ~= 8.2 min                      [PROJECTION]
#   At the friendlier ~1.0 s/leg the same 340 legs project ~470s ~= 7.8 min.
#   Both are under 10, so the DECISION below is unchanged.
# ⚠️ This is the LAST projection Phase 164.4 needs — 39/71 is its end state.
#   Replace it with the MEASURED ubuntu wall clock of the plan-164.4-11 PR as
#   soon as that run exists, and re-derive from legs, never from arms.
#
# ⭐ MEASURED 2026-09-05 (Phase 164.4.1 END STATE, plan 06's deferred half, taken
# by the orchestrator because a worktree executor cannot produce a SHA-bound run):
# workflow_dispatch run **33961609382**, head sha
# **1aa8bb7088e978320041b6a97d187b8247b8fe3d**, sql-mutation **success in 567 s
# (9.45 min)** — 10:47:54Z -> 10:57:21Z. Corpus on ubuntu is IDENTICAL to the
# authoring box: coverage: files 44/71, arms: 363/363/0, biting: 363,
# lane-invocations: 363, lane-blocked: 0, lane-probe AVAILABLE, no defects,
# per-arm lane time mean 1.1s. pg_cron came from noble/universe at 1.6.2-1.
# LEGS: 363 arms + 44 baseline + 44 restore = **451 legs**; at the measured
# 1.1 s/leg that is ~496 s of lane time plus ~71 s of job overhead.
# ⚠️ SUPERSEDED 2026-09-05 by the phase review: that run measured the 363-arm tree and stays
# as the dated ubuntu measurement. The corpus is now 361 arms / **449 legs** (361 + 44 + 44)
# after CR-02 reclassified two unfalsifiable arms. Two fewer legs does not move the DECISION.
#
# ⛔ TRIGGER REACHED — MEASURED 2026-09-05, run **33973362161** at head sha
# **ab0d56445b91bae8ac0460cb35cde12aaefce3dc** (the first ubuntu run of the SHIPPING tree; the
# 567 s run above measured a superseded 363-arm tree AND the previous provisioning step).
# `sql-mutation` SUCCESS in **646 s = 10.8 min** — 14:58:0xZ -> 15:08:4xZ. Corpus identical to
# the authoring box: coverage: files 44/71, arms: 361/361/0, biting: 361, lane-invocations: 361,
# lane-blocked: 0, pending: 0, lane-probe AVAILABLE, no defects. The rewritten selector worked:
# `PGBIN the lane will boot: /usr/lib/postgresql/16/bin`, major 16, pg_cron 1.6.2-1.
# 449 legs, so ~1.15 s/leg + overhead — SLOWER per leg than the 567 s run at MORE arms, which
# is runner variance, not a corpus change. That is the point: the variance alone is ~80 s.
#
# ⚖️ THE RULE FIRES. It says raise only when a MEASURED run REACHES ~10 minutes; 10.8 min does.
# `timeout-minutes` 15 -> **20**, and this is the ONE raise the rule allows.
# ⛔ 20 IS THE CEILING. If a MEASURED ubuntu run reaches it, STOP — do NOT raise again. The
# locked decision (164.4-CONTEXT.md) is that PRs then run CHANGED gate files with a scheduled
# full run enforcing the floors, and the split is PRINTED, never silent. That is a separate
# plan (a runner subset mode plus ci.yml work), booked as [REDUNDER-SUBSET-SPLIT].
# ⚖️ RULE APPLIED LITERALLY: 9.45 min does NOT reach the ~10 min trigger, so
# `timeout-minutes` STAYS 15 — this is the closest a measured run has come
# (previous high 464 s / 7.7 min, run 33882082307), and the next file-count
# ratchet is likely to cross it. When it does, the raise is to 20 ONCE.
#
# DECISION 2026-09-04 (plan 164.4-08, RE-AFFIRMED by plan 164.4-11 on the
# corrected legs model): `timeout-minutes` STAYS 15, applying the rule
# literally — raise only when a MEASURED run reaches ~10 minutes. The
# largest MEASURED ubuntu run is 464s = 7.7 min (run 33882082307), and the
# worst-case legs projection for the PHASE END is 8.2 min. Both are under
# 10, so there is nothing to raise yet. 15 still leaves headroom for a slower runner while
# bounding a wedged cluster rather than burning the job's default 360.
# ⛔ 20 minutes is a CEILING, not the next rung. If a MEASURED ubuntu run
# reaches it, STOP — do not raise again. The locked decision
# (164.4-CONTEXT.md) is that PRs then run CHANGED gate files with a
# scheduled full run enforcing the floors, and the split is PRINTED, never
# silent. That is a separate plan (a runner subset mode plus ci.yml work),
# NOT a further timeout raise.
#
# ⚖️ RULE RE-APPLIED 2026-09-07 (phase 164.7 plan 05) — NO CHANGE, and the
# reading is recorded rather than the decision restated. The corpus grew to
# 46 files / 380 arms = **472 legs** (380 + 46 baseline + 46 restore). Local
# macOS wall clocks, from 164.7-05-FLOORS.log: **531 s** and **528 s** at
# `per-arm lane time: mean 1.1s`, plus one 614 s run whose 1.3 s/arm is
# contaminated by a busy-wait loop running beside it and is reported as such.
# ⛔ None of the three is an ubuntu number, and this rule reads MEASURED
# UBUNTU runs — no SHA-bound ubuntu run of a 46-file corpus exists yet. The
# rule's one permitted raise was already taken above, and 20 is the CEILING,
# so there is nothing to raise: a future crossing is answered by
# [REDUNDER-SUBSET-SPLIT], not by a third value.
#
# ⚖️ RULE RE-APPLIED 2026-09-18 (phase 164.1.1 PROBERCADENCE, plan 01) — NO
# CHANGE, reading recorded rather than the decision restated. The corpus
# grew to 47 files / 397 arms = **491 legs** (397 + 47 baseline + 47
# restore) — one new annotated file, test_prod_prober_cadence.sql, two new
# biting arms (G1, S1). Local macOS wall clock, `nohup node
# scripts/mutation-runner/run.mjs` over the full corpus: **~975 s (~16.25
# min)** at `per-arm lane time: mean 2.0s over 397 arm run(s)`.
# ⛔ Not an ubuntu number, and this rule reads MEASURED UBUNTU runs — no
# SHA-bound ubuntu run of a 47-file corpus exists yet. The rule's one
# permitted raise was already taken above and 20 is the CEILING, so there
# is nothing to raise here either. ⚠️ Unlike the 164.7 reading, this local
# figure is not comfortably below the ceiling (~16.25 of 20 min) — flagged,
# not acted on, because the rule fires on a MEASURED ubuntu run, not a
# local projection; the next PR touching this job should capture the
# ubuntu wall clock and re-apply the rule against it.
# ⚖️ RULE RE-APPLIED 2026-09-18 (phase 164.1.1 PROBERCADENCE, plan 02) — NO
# CHANGE, reading recorded rather than the decision restated. The corpus
# stays at 47 files (FILES_FLOOR unmoved) / grows to 402 arms = **496 legs**
# (402 + 47 baseline + 47 restore) — five new biting arms (O1, A1, N1, U1,
# V1) in the SAME file plan 01 added, test_prod_prober_cadence.sql. Local
# macOS wall clock, `nohup node scripts/mutation-runner/run.mjs` over the
# full corpus at this plan's final SQL bytes: **~1020 s (~17.0 min)** at
# `per-arm lane time: mean 2.0s over 402 arm run(s)`.
# ⛔ Not an ubuntu number, and this rule reads MEASURED UBUNTU runs — no
# SHA-bound ubuntu run of a 47-file/402-arm corpus exists yet. The rule's
# one permitted raise was already taken above and 20 is the CEILING, so
# there is nothing to raise here either. ⚠️ The local reading is now CLOSER
# to the ceiling than the plan-01 reading (~17.0 of 20 min, was ~16.25) —
# flagged again, not acted on, for the same reason: the rule fires on a
# MEASURED ubuntu run, not a local projection. If the NEXT arms move pushes
# a measured ubuntu run over 20, the recorded answer is
# [REDUNDER-SUBSET-SPLIT], never a third raise.
# ⭐ 2026-10-03 (Phase 164.9.6 SUBSETMAIN): [REDUNDER-SUBSET-SPLIT] has SHIPPED. A push
# to main now runs a SUBSET or skips the lane (`none`), and `sql-mutation-nightly.yml`
# runs the full corpus and enforces the floors. The three mentions above are lineage.
# ⭐ 2026-10-03 (Phase 164.9.6.1 SUBSETSHARD): a FULL run's crossing of this ceiling is
# now answered by in-job concurrency (D-01): the runner drives up to
# `LANE_CONCURRENCY_CAP` gate files at once in this one job (`defaultLaneConcurrency`
# in scripts/mutation-runner/run.mjs), prints it as `lane-concurrency:`, and the
# assert step MEASURE_FAILs without that line. 20 STAYS the declared ceiling and was
# not raised (D-03 adds no wall-time guard). Separately, a predecessor red ONLY with
# tolerated baseline-content drift (DRIFT / SNAPSHOT_MISSING rows) no longer forces a
# FULL run on the next push (D-02/D-05): `predecessorVerdict`'s opt-in
# `tolerateBaselineDrift`, taken by the SQL gate subset alone (D-04).
# Phase 164.6.3 / CI-DOCSPATH-01 — docs-only path filter: this changes WHEN
# this job is invoked (not on a `.planning/`-only PR), never WHAT it asserts.
# ⚠️ CORRECTION to the two paragraphs above, which say this job has "no `if:`" and
# "NO `if:`". It now has exactly one, and only this one. The consequence those
# paragraphs draw is UNCHANGED: it consumes no secret, no repo variable and no
# shared resource, so it keeps the aggregator's STRICT default arm with no
# tolerance of its own, and a `skipped` under a CODE classification is still
# always a real fault.
# ⚠️ CORRECTED 2026-10-03, Phase 164.9.6 D-09. The job still has exactly ONE
# job-level `if:` (the docs-only one above), and its strict aggregator row is
# unchanged: it reports `success` or `failure`, never `skipped`. What changed is
# one level down. Its STEPS now carry one uniform step-level condition,
# `steps.scope.outputs.skip_lane != 'true'`, which skips only the lane and only
# on a verified `none` on a push to main (see the scope step below). "No `if:`"
# above is therefore true of the JOB and no longer true of its steps.
```

<a id="sql-mutation-2"></a>
### sql-mutation-2: job sql-mutation, inside step `Provision pg_cron for the lane's PostgreSQL (Phase 164.4.1)`, before `run:`

```text
# ⚠️ THIS STEP'S FIRST RUN IS THE MEASUREMENT. 164.4.1-RESEARCH assumption
# A1 ("`apt-get install postgresql-16-cron` succeeds on ubuntu-latest and
# yields a PG16-loadable .so") was INSPECTED, never executed — there was
# no ubuntu host in the research session. Everything below is written to
# PRINT rather than to assume, so the first job log settles it:
#   * the `apt-cache policy` block answers RESEARCH Open Question 1 —
#     does the runner's pg_cron come from PGDG or from noble `universe`?
#     Either is acceptable; which one won is a fact, not a guess.
#   * the `dpkg -s … Version:` line makes the macOS-1.6.7 / ubuntu-1.6.x
#     minor skew VISIBLE (RESEARCH A2) instead of inferred.
#   * the major print + hard refusal covers RESEARCH A5: `ubuntu-latest`
#     maps to 24.04 (PostgreSQL 16.15) TODAY. If it rolls to an image on
#     a different major, this job and the authoring box would measure
#     DIFFERENT corpora — the exact split success criterion 1 forbids —
#     so that is a MEASURE_FAIL here, never a silent adaptation. Since
#     2026-09-05 that major is read off the binaries `run.sh
#     --print-pgbin` resolves, so the refusal answers for the server the
#     arms actually run on rather than for a second, divergent guess.
#   * the `PGBIN the lane will boot:` line makes that resolution VISIBLE,
#     which is what lets a two-major image be diagnosed from the log.
#   * a bindir with pg_ctl and NO pg_config gets its own named refusal,
#     because run.sh treats pg_config as optional and would still run
#     there; reporting that as `major is 'none', not 16` blamed A5 for
#     a missing package. Likewise an unresolvable PGBIN now REPRINTS
#     run.sh's own stderr instead of telling the reader to go rerun it.
# Read those in the log before trusting any downstream run.
#
# Shape copied from the only apt analog in this workflow, `sql-tests`'
# "Install psql client" step. The reversal of this job's no-install
# stance is argued in the job header above.
```

<a id="sql-mutation-3"></a>
### sql-mutation-3: job sql-mutation, inside step `Runner self-test - every defect kind still fires`, before `run:`

```text
# ⛔ SP-C02. This step was MISSING, and its absence was the largest hole
# in this job. Verified by repo-wide grep at the time: `run.mjs
# --self-test` was invoked by NOTHING, while the two sibling jobs both
# run theirs (`lint-sql-gates.mjs --self-test` at ~:796,
# `verify-plan-anchors.mjs --self-test` at ~:1139).
#
# It is the SOLE proof that the runner's six defect kinds — `no-red`,
# `wrong-first-failure`, `occurrence-mismatch`, `identity-rewrite`,
# `synthesised-identity`, `floor` — can still fire. The corpus run below
# is GREEN BY CONSTRUCTION at E/E: a runner whose defect reporting was
# disabled would still print its `arms:` line, clear both floors and exit
# 0. Vitest covers `neuterArm`, the floors and the identity helpers; it
# never covers `runCorpus`'s defect REPORTING, because that needs a
# cluster. So without this step, "0 defects" was a number nothing could
# contradict — this phase's own thesis, inside this phase's own gate.
#
# BEFORE the corpus run, for the same reason `sql-gate-lint` orders its
# two steps that way: a clean scan means nothing unless the detector can
# still fire. It needs no extra provisioning — it drives the same
# throwaway `initdb` cluster `scripts/pg-lane/run.sh` creates for the
# corpus run. Measured 2026-08-29: 8/8, in seconds; 12/12 after
# 164.3.1-11 added the Primitive-A and -B regression corpus (2026-09-01);
# 15/15 after the 164.3.1 review added the F1 message-embedded forgery,
# the injected-lane absurdity FIRE scenario and the `lane-unrunnable`
# MEASURE_FAIL (2026-09-02); 16/16 after 164.4-01 added the parse-time
# refusal of a twin targeting a pg-lane stand-in fixture — GRAMMAR rule
# 4, threat T-164.4-01 (2026-09-02); 17/17 after 164.4-03 added the
# stale-deferral probe — a lane that CAN host pg_cron while idiom files
# are still classified lane-blocked, threat T-164.4-11 (2026-09-03).
#
# ⛔ MODE IDENTITY: the bare command from the script's own header, no
# wrapper. Pinned from vitest by src/__tests__/mutation-runner-floors.test.ts.
#
# ⭐ CURRENCY 2026-10-03 (Phase 164.9.6.1 SUBSETSHARD, D-01): the
# `SELF-TEST (concurrency)` family now proves, on REAL lanes, that a
# serial run and a four-wide run of the same SUBSET agree on every
# tally, the exit code and the ordered defect list, and that the
# four-wide run really had more than one lane in flight. The counts
# above are lineage; the self-test prints its own.
```

<a id="sql-mutation-4"></a>
### sql-mutation-4: job sql-mutation, inside step `Mutate every annotated RED-UNDER arm and require it to bite`, before `env:`

```text
# ⛔ MODE IDENTITY (164.3-RESEARCH Pitfall 2,
# `reference_gstack_evidence_wrapper_reddens_suite`). The command below
# is byte-identical to the one in the script's own header and to what a
# developer runs locally. No wrapper, no flags, no npm alias.
#
# Its stdout goes to a FILE and is `cat` back into the log, rather than
# through `| tee`. Two measured reasons, both from this repo:
#   * a PIPE makes `$?` the LAST command's status. That hazard bit this
#     plan's own execution (`--self-test` reported FAIL while the shell
#     reported exit 0, because `$?` was `tail`'s). `status=$?` on the
#     very next line cannot be fooled;
#   * the log has to survive into the assertion step below, and the file
#     must live in RUNNER_TEMP, NOT the workspace: the runner asserts
#     `git status --porcelain` is unchanged across its own run and would
#     report `dirty-checkout` on a log file written beside the corpus.
# argv is unchanged either way — only the stdout fd differs, which in CI
# is a file regardless.
#
# ⭐ MODE IDENTITY, EXTENDED 2026-09-23 (Phase 164.4.2 / DECISION D). The
# step now has TWO named invocations, and the rule above binds both:
#   * FULL — the LAST command below, byte-identical to before this
#     extension and to the runner header's bare command. Every push,
#     every workflow_dispatch, and every pull request whose derivation
#     said `full` runs it. A merge is the moment the full picture is
#     owed, so the push to main always runs the whole corpus and
#     enforces every floor.
#   * SUBSET — `--subset-from <list>`, the runner header's documented
#     SUBSET gate command, taken ONLY when `changed-paths` said `subset`
#     AND this event is a pull_request. ⛔ Two independent controls on
#     the event: the derivation already forces `full` for a non-PR
#     event, and this step refuses the subset branch on its own —
#     because the derivation is a script this job does not own.
# ⛔ The name list is NEVER interpolated into a shell command. It
# crosses the job boundary as an `env:` value, is split by `read -r -a`
# (no globbing, no eval), and is written one path per line with
# `printf` into RUNNER_TEMP — not the workspace, for the
# `dirty-checkout` reason above. The runner re-validates every line
# against the same strict pattern the derivation emitted it under.
# Whichever branch ran, the runner prints exactly one `scope:` line,
# and the assert step below judges it.
#
# ⭐ MODE IDENTITY, EXTENDED 2026-10-03 (Phase 164.9.6 / D-04). A push
# to `refs/heads/main` may now take the SUBSET branch too: the
# derivation judges the pushed range and `changed-paths` hands its list
# over exactly as on a pull request. That is the ONE event the refusal
# was widened by, never removed: a push to any other ref, a
# workflow_dispatch, a schedule or an unset event still runs FULL here,
# whatever the derivation said. Any non-`full` mode this step does not
# honour (a `subset` on another event, a `none` that reached it) is
# printed as a `::warning::`, and SQL_GATE_REASON is rewritten to say
# the step refused it before the FULL command runs, so the runner's
# `scope-reason:` line (D-12) tells the truth about why FULL ran. The
# FULL command itself is unchanged, byte for byte. The 2026-09-23
# paragraph's "the push to main always runs the whole corpus" and its
# "the derivation already forces `full` for a non-PR event" are kept as
# lineage: both stopped being true for a push to main on 2026-10-03.
```

## plan-anchor-verify

<a id="plan-anchor-verify-1"></a>
### plan-anchor-verify-1: job plan-anchor-verify, at job level, before `if:`

```text
# Phase 164.3 / VAC-05 — re-resolve every anchor and quote a PENDING plan
# makes about the tree.
#
# WHY IT EXISTS. A plan is a set of claims about the tree, and nothing ever
# compared them to it. Both of Phase 164's wave-3 plans were STALE ON
# ARRIVAL, measured: `164-04` anchored edits at `v2/page.tsx:563-573` in a
# file an earlier plan had shrunk to 423 lines, and `164-03` specified a
# two-argument `deriveShareToken` against a source whose signature had grown
# a third parameter — followed literally it would have minted share links
# that fail verification. A human caught both by reading carefully. This job
# is that reading, mechanized.
#
# ⛔ SCOPED TO `pull_request`, DELIBERATELY NOT main-push. This is D-13's
# ruling applied to the analogous case rather than re-decided:
# `.planning/` is TRACKED here and plans routinely merge to main BEFORE they
# execute (this phase's own plans do). A pending plan sitting on main whose
# anchor drifts because unrelated code merged would redden main CI — and
# **Railway waits on main CI and SKIPS the analytics-service deploy when it
# is red**. D-13 removed exactly that coupling for VAC-04; a push trigger
# here would re-introduce it through a different door. The founder accepted
# a red board, not halted deploys.
# Nothing is lost by the narrower trigger: a stale anchor matters at EXECUTE
# time, and execution happens on a branch, so the PR is where the check has
# to bite. See the aggregator row below — it is STRICT on `pull_request` and
# tolerates `skipped` ONLY on the events this `if:` excludes.
#
# HERMETIC BY DESIGN: NO database, NO Docker, NO secrets, NO network, NO
# node_modules (the script imports only node builtins). It reads tracked
# files and exits. It cannot flake, and it runs identically on a fork PR.
#
# `permissions:` and `concurrency:` are inherited from the workflow level
# (lines ~40 and ~53), matching `sql-gate-lint` and `sql-mutation`.
# Restating them per-job would fork two sources of truth, and a second
# concurrency group inside a workflow that already has one changes
# cancellation semantics rather than tightening them.
```

## sql-tests

<a id="sql-tests-1"></a>
### sql-tests-1: job sql-tests, at job level, before `needs:`

```text
# audit-2026-05-07 follow-up Issue 6 — wire the supabase/tests/test_*.sql
# files into CI. Pre-fix, the 5 plain PL/pgSQL test files were
# committed but never invoked by any workflow or `package.json`
# script — covering P911-P920, P917, P918, P919, P920, P455, P475
# with no CI signal. A future migration could silently break the
# sanitize_user sentinel trigger, the retention guard, the data
# deletion FK action, the log_audit_event_service ceiling, or the
# wizard draft guard with no test failure to catch it.
#
# ⭐ Phase 164.4.2 (DECISION B, the tracer) — THIS JOB NO LONGER TOUCHES SHARED
# TEST. It boots a database of its OWN with `scripts/local-stack/run.sh up` (the
# Supabase CLI stack `frontend-local-stack` proved, loaded from the committed
# `supabase/schema/baseline.sql` behind the lane's currency guard), runs the
# corpus against it, and tears it down. The database is private to this job's
# runner: nobody else's CI can see it, and this job can see nobody else's.
# ⛔ CORRECTED 2026-09-23 (Phase 164.4.2 plan 08, D-F): "behind the lane's
# currency guard" now means the guard NAMES a replay set rather than rejecting
# a dump that predates the newest migration. `run.sh up` loads the dump, then
# replays exactly the `supabase/migrations/` files the committed marker
# `supabase/schema/baseline-carried-migrations.txt` says it does not carry,
# and fails loud when that set cannot be determined or a replayed migration
# errors. A PR that ADDS a migration therefore has that migration on this
# job's lane BEFORE merge — the corpus runs against the PR's own schema.
#
# WHERE THE SHARED-TEST MACHINERY WENT. Everything here that existed only
# because this job wrote the shared TEST project is GONE from this job: the
# fork-author and configured-test-DB repo-variable `if:` clauses, the
# `needs: python` stagger edge and its ⛔ block, the job-level `permissions:`
# the ordering wait needed, the "Wait for the TEST schema apply" step, and the
# shared-test-db mutex's acquire / release / dead-holder-verdict steps. The ONE
# step that is inherently ABOUT shared TEST — VAC-08, the repo-vs-TEST ledger
# and function-body drift check — cannot follow the corpus, because a private
# database has no drift to measure. It moved, together with the wait, the
# mutex, the gate and the stagger edge, into the `test-db-drift` job (placed
# after `python`, the job its `needs:` edge waits on).
# ⛔ So a reader who finds no mutex here, where the file's other DB jobs have
# one: this job holds no key because it shares no database. `test-db-drift` is
# the job that now holds the shared-test-db advisory key in its place. (The
# key's number, the variable's name and the drift script's path are
# deliberately NOT spelled anywhere in this job, so that grepping this job's
# body for any of them answers "moved" rather than "maybe still here" — the
# same reason the corpus step below does not spell the mutation runner's
# script path.)
#
# Security (audit-2026-05-07 red-team Finding 6) — the two defenses, RE-ARGUED
# for the move rather than silently dropped:
#
#   1. Fork-author gate — REMOVED, together with the only thing it protected.
#      It existed so a fork PR could never receive TEST_SUPABASE_DB_URL. This
#      job now consumes NO secret and NO repository variable: its DSN is the
#      local stack's own loopback URL, read from the mode-600
#      `scripts/local-stack/.stack-env` handoff and refused unless it names
#      127.0.0.1/localhost. A fork PR running it can steal nothing and write
#      nothing shared. The gate went where the secret went: `test-db-drift`.
#
#   2. Meta-command filter — KEPT VERBATIM. A malicious commit inside THIS
#      repo could still put psql CLIENT-side meta-commands (\!, \copy, \o,
#      \COPY) in a test file, and those run on the runner whatever database
#      psql is pointed at. That threat was never about shared TEST, so the
#      "Preflight - reject psql meta-commands" step applies to a throwaway
#      lane exactly as it did before. No untrusted github.event.* content
#      flows into any run: step.
#
# AGGREGATOR ROW — CITED, NOT RE-DERIVED. This job now makes the argument
# `sql-mutation`'s header makes for itself: no secret, no repo variable, no
# shared resource, no mutex, and no `if:` beyond the docs-only conjunct — so it
# runs identically on a fork PR, a same-repo PR, a push and a
# workflow_dispatch, a `skipped` result is ALWAYS a real fault, and its row
# takes the `frontend:` loop's STRICT DEFAULT ARM with no tolerance. The
# tolerance arm it used to carry existed only because it consumed a secret; it
# moved with the secret, to `test-db-drift`'s row.
# ⛔ The DB-touching jobs' ban on new `needs:` edges no longer applies to this
# job, for the `sql-mutation` / `frontend-local-stack` reason: it shares no
# resource and waits on no mutex. Its one `needs:` edge is the docs-only
# detector.
#
# ⚠️ `timeout-minutes` — DERIVED FROM THE WORK, not carried over. The 90 this job
# had was the shared-test-db mutex TTL, sized for a 3600s acquire cap it no
# longer has. MEASURED on ubuntu, CI run 35816624285, `frontend-local-stack`
# (the SAME boot): job total 2m31s, of which `run.sh up` took 1m35s and
# teardown 21s. This job's corpus step, MEASURED on shared TEST over six
# merge-push runs (164.4.2-MEASUREMENT.md), did 0m17s-1m19s of useful work,
# ~47s typical. Setup + boot + corpus + teardown is therefore ~4 min at the
# worst observed corpus. 20 is the value `frontend-local-stack` uses for the
# same boot plus a test run, and it leaves ~5x headroom for a cold image pull
# or a slower corpus on the lane. ⛔ Do not answer a crossing by widening it: a
# corpus that needs 20 minutes against a private database is a finding.
#
# LANE-ONLY — THE EXCLUSION STILL HOLDS, FOR A DIFFERENT REASON THAN ITS MARKER
# STATES. A file carrying a `-- LANE-ONLY:` header is still not executed here;
# the census and the per-file notice in the corpus step are unchanged. The
# marker's own text argues from shared TEST carrying the REAL `pg_net`, and
# this job no longer runs there. On THIS lane the exclusion holds because
# (a) the file's arms assert against `net._lane_posts`, a pg-lane STAND-IN that
# `scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql` creates and no
# Supabase stack has (CI run 35347643700 printed `relation "net._lane_posts"
# does not exist` when it was run against a database without it), and (b) this
# lane carries the real `pg_net` too (run 35816624285: `pg_net=1/present`), so
# a variant made to run here would send genuine outbound HTTP from the runner.
# Its execution and mutation coverage still belong to `sql-mutation` on the
# pg-lane. ⛔ The marker text in the .sql file is deliberately NOT edited:
# `supabase/tests/` is counted by several independent pins, and this workflow
# is where the exclusion decision is written down.
#
# The test files use plain `RAISE EXCEPTION` (no pgTAP) — under
# `psql -v ON_ERROR_STOP=1` a failed assertion exits non-zero and
# fails the job.
#
# Phase 164.6.3 / CI-DOCSPATH-01 — docs-only path filter: this changes WHEN
# this job is invoked (not on a `.planning/`-only PR), never WHAT it asserts.
```

## python

<a id="python-1"></a>
### python-1: job python, at job level, before `timeout-minutes:`

```text
# TTL for the shared-test-db mutex (Phase 158 / OPS-01): GitHub kills the job
# at 90m, the psql session drops, and Postgres releases the advisory lock.
# That IS the steal path. Manual unlock:
# docs/runbooks/shared-test-db-mutex.md.
#
# 158-REVIEW CR-04 — why 90 and not 60. Each CI run takes this lock THREE
# times (python ~7m, e2e-seeded ~8-9m across build + the Playwright batch,
# sql-tests the balance) ≈ 20m of lock-time per run. The phase's own success
# criterion is that THREE simultaneous runs serialize and ALL SUCCEED, so the
# last job to acquire can legitimately queue behind ~8 other holds ≈ 60m. The
# acquire cap is sized to 3600s to absorb exactly that, and this TTL must
# then cover setup + that full cap + this job's own work (~2m + 60m + ~12m ≈
# 74m) with headroom. At 60m the waiter died of its OWN TTL mid-queue — and
# with sql-tests now BLOCKING the `frontend` aggregator that reddens main
# HEAD and makes Railway skip the analytics deploy, i.e. #616's damage
# through a new door. The trade is a wider worst-case WEDGED hold (90m);
# runbook section 3 is the manual override for that.
# ⚠️ Phase 164.4.2 (2026-09-23): the third taker is now `test-db-drift`, which
# holds the key only across VAC-08's read-only drift check, so "sql-tests the
# balance" above names a hold that has moved to a different job and shrunk. The
# derivation is kept as the dated reading it is: a smaller per-run lock time only
# widens this TTL's headroom, so 90 is not re-derived here.
# (2026-09-25, Phase 164.4.2.1: `test-db-drift` left the key; the holders in
# ci.yml are `python` and `e2e-seeded`.)
# ⛔ The holder's `pg_sleep` must stay ABOVE this number (WR-01) — it is 6000s.
# (2026-09-26, Phase 164.9.4 CIOFFMUTEX, D-10: this job holds no key and no
# `pg_sleep` any more, so the derivation above is lineage. 90 is kept
# UNCHANGED on purpose: D-10 forbids widening or re-deriving it in this
# phase, and the lane boot plus the ~15-minute pytest fit well inside it.)
```

<a id="python-2"></a>
### python-2: job python, before step `Type gate - mypy strict over the running-service surface`

```text
# @runtime_checkable Protocol only verifies method *presence* at runtime,
# not signature shape; mypy --strict catches signature drift (e.g.
# `validate(req)` vs `validate(request)`) at type-check time before the
# test pipeline. --follow-imports=silent has a plain consequence: a
# module reached only by import is FOLLOWED with its errors SUPPRESSED,
# so a green run cannot tell "checked" from "reached". That is why the
# entry modules are named on the command line: main_worker.py was in
# exactly that state, reached via services/mt5_session_monitor.py's
# import of SHUTDOWN.
#
# B-mypy program: the strict floor started at services/ingestion/ (Phase
# 19 / BACKBONE-02 / MC-3) and widened to services/ (B-mypy part g,
# v0.24.15.60), routers/ (part h, v0.24.15.61) and models/ (part i),
# all verified 0 at the time (lineage: then against supabase 2.15.1 /
# postgrest 1.0.2, which CI no longer installs). Phase 164.6.1's
# 96 -> 100 reading below was taken against the deps
# analytics-service/requirements.txt pins today; read the pins there,
# not here. That set was not the whole running service: the
# entry module was never on the command line. Phase 164.6.1
# (MYPY-MAINPY-01) names the four top-level service modules too:
# main.py (the `uvicorn main:app` entry), main_worker.py (merged into
# the API process), main_worker_healthz.py and sentry_init.py. Before:
# services/ routers/ models/, 96 source files as mypy counts them.
# After: that set plus exactly those four, 100. No module left.
# src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts pins
# this command's path set to the service surface derived from the
# tracked tree (git ls-files) and to the Makefile `typecheck` set, so a
# top-level module or package (namespace packages included) added
# without widening this line is a RED check, not a stale comment.
# scripts/ stays ungated: they are
# one-off operational tooling (backfills, cassette recording), not the
# running service, and gating them would add a types-PyYAML dev-dep plus
# friction for throwaway scripts. tests/ stays untyped by design.
# --config-file=pyproject.toml makes mypy read THAT file and no other:
# without it, a mypy.ini or .mypy.ini written by an earlier step (or left
# untracked in the checkout) is preferred over pyproject.toml and replaces
# the pinned [tool.mypy] config wholesale. The Makefile `typecheck`
# recipe passes the same flag, so local and CI read one config.
```

<a id="python-3"></a>
### python-3: job python, before the unnamed step `- run: pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_w`

```text
# PR #149 v0.22.25.3 follow-up: wire the test Supabase project into
# the python job so the P97 fence regression tests in
# tests/test_compute_jobs_fencing.py execute against a real DB. The
# test project (`qmnijlgmdhviwzwfyzlc`) was caught up to main's
# migration head (109-119 applied 2026-05-12), so live-DB fixtures
# no longer hit pre-existing schema drift.
#
# Gated on the repository VARIABLE `E2E_TEST_DB_CONFIGURED` (NOT
# `secrets.X != ''`) — vars are introspectable in workflow logs so
# a missing/typo'd var fails loudly. When the var is unset (forks,
# repos without a configured test DB), the secrets fall back to
# empty strings AND `CI` is demoted to '' so `_need_supabase()` in
# `tests/test_compute_jobs_fencing.py` falls into the `pytest.skip`
# branch instead of the CI=true hard-fail branch.
# (2026-09-26, Phase 164.9.4 CIOFFMUTEX: this job no longer reaches the shared TEST project or takes the shared-test-db key; pytest runs against the local-stack lane private to this runner. The text above is lineage.)
# tech-debt #16: gate covers services/ + routers/ + main_worker.py
# (was services/ only — the 7.8k-LOC route layer and the worker
# entrypoint contributed zero to the only Python coverage gate).
# Combined measured ~87% clears the 80 floor; exchange/internal/csv
# routers (32/36/42%) are now inside the denominator so they can no
# longer regress unseen. Keep byte-identical with Makefile `test:`.
# (2026-09-26, Phase 164.9.4 CIOFFMUTEX: this job no longer reaches the shared TEST project or takes the shared-test-db key; pytest runs against the local-stack lane private to this runner. The text above is lineage.)
#
# SERIAL (v1.9.1 Phase 97): the `-n auto --dist loadgroup` parallelization
# (absorbed from #610) is DEFERRED. Even with every live-DB module pinned
# to one `shared_test_db` xdist_group worker, the GLOBAL-claim fence tests
# (`test_compute_jobs_fencing.py`) flake under `-n auto`: the group's own
# tests run in a loadgroup-variable order and any imperfect per-test
# compute_jobs cleanup pollutes a later global-`claim_compute_jobs_with_priority`
# assertion (tie-break picks a foreign row / `single()` finds 0 rows /
# the seeded row is claimed out of the batch → None). Main's stable serial
# order avoids this. The `want_job_id` claim scoping + decoy regression +
# xdist_group infra all LAND (they are correct and the offline decoy pins
# the scoping); re-enabling `-n auto` needs per-test claim-space isolation
# first (TODOS: v1.9.1 Phase-97 parallelization deferral). The cross-run
# shared-test-db mutex acquired in the step below still prevents two runs
# from contending. Keep byte-identical with Makefile `test:`.
# (2026-09-26, Phase 164.9.4 CIOFFMUTEX: this job no longer reaches the shared TEST project or takes the shared-test-db key; pytest runs against the local-stack lane private to this runner. The text above is lineage.)
# (2026-10-14, Phase 164.9.8.1 PYXDIST: pytest now runs in parallel, `-n auto --dist loadgroup`. The SERIAL deferral above misread the cause: the
# `shared_test_db` group never formed, because the conftest grouping hook ran after xdist's own hook had already read the markers, so each live DB
# test was its own work unit; `tryfirst=True` on that hook makes the group real, proven by `tests/test_xdist_group_is_real.py`. The limiter-identity
# flake was `routers.*` module pollution from fixtures that evicted without restoring, fixed in the polluters through `tests/limiter_stub.py`.
# The pointer "(TODOS: v1.9.1 Phase-97 parallelization deferral)" is dangling: that TODOS entry was dropped by tracker consolidation `193afe818`.
# Byte-identity with Makefile `test:` is now pinned in `src/__tests__/local-stack-lane-wiring.test.ts`. The text above is lineage.)
```

## test-db-drift

<a id="test-db-drift-1"></a>
### test-db-drift-1: job test-db-drift, at job level, before `runs-on:`

```text
# ⛔ CORRECTED 2026-09-25 (Phase 164.4.2.1 DRIFTOFFMUTEX, D-02): this job no longer
# holds the shared-test-db key. Its Acquire, Release and dead-holder Verdict steps
# are gone. VAC-08 is read-only, and its ordering after `apply-test` is the
# `Wait for the TEST schema apply to conclude (merge pushes only)` step (an
# Actions-API fact plus the in-flight flag), which runs immediately before VAC-08.
# ⛔ CORRECTED 2026-09-25 (round-2 review, IN-04): not IMMEDIATELY before. The
# `actions/setup-node` step runs between the wait and VAC-08, and its duration
# adds to the merge-push window described below. The sentence is kept as lineage.
# ⚠️ That wait is merge-push only. On a `pull_request` run it does not run, so
# VAC-08 has NO ordering against `apply-test` or a dispatched restore; on a merge
# push a seconds-wide window remains between the wait's exit and VAC-08's first
# read. Accepted because an overlap can only red loudly, never pass on a state
# that never committed (runbook `docs/runbooks/shared-test-db-mutex.md`, section 0).
# ⛔ Do not widen the wait's `if:` to PRs: it keys on this commit's own
# `supabase-migrate.yml` run, which never exists on a PR.
# The key only made this job queue behind `python` and `e2e-seeded` (up to 20m31s
# for 2-5 s of work, per 164.4.2-MEASUREMENT). `needs: [python, changed-paths]` is
# KEPT: it makes the same-commit `supabase-migrate.yml` run register long before
# the wait's appearance grace expires, and the mypy contract names it as the
# downstream backstop for a skipped `python`. The paragraphs below, "WHY THIS JOB
# STILL HOLDS THE KEY", "THE HONEST CONSEQUENCE" and the long ⛔ block, are
# LINEAGE. They stay in place because `python` and `e2e-seeded` reference the ⛔
# block by name (D-08); inside this job the key is named, never numbered, because
# the holder-set pin in critical-regressions.test.ts reads comments.
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
#
# Phase 164.4.2 — VAC-08, IN A JOB OF ITS OWN. The repo-vs-shared-TEST ledger
# and function-body drift check used to be a step of `sql-tests`. When
# `sql-tests` moved to a database private to its own runner, this step could
# not follow it: VAC-08 measures drift BETWEEN this repo and the SHARED TEST
# project, and a throwaway database has none to measure. It was not deleted and
# it was not left to skip — a drift check that no-ops when its credential is
# absent is the silent-no-op class this repo's gates exist to refuse, and
# VAC-08 exits 1 on an absent TEST_SUPABASE_DB_URL for exactly that reason.
#
# WHAT IT CARRIES, all moved VERBATIM from `sql-tests`: the "Wait for the TEST
# schema apply" step, the shared-test-db mutex (acquire, best-effort release,
# dead-holder verdict), the VAC-08 step and its secret, the job-level
# `permissions:` the wait's Actions API read needs, the 90m TTL, the fork /
# `vars.E2E_TEST_DB_CONFIGURED` / docs-only `if:`, and `needs: [python,
# changed-paths]` with the ⛔ block that explains it. ⛔ Do not "simplify" the
# `needs: python` edge away: it is the measured reason `python` and this job are
# not dispatched onto the mutex at the same instant.
#
# WHY THIS JOB STILL HOLDS THE KEY, which is NOT the reason the ⛔ block below
# gives. That block moved here verbatim and is LINEAGE: its "this job" is
# `sql-tests` as it was, running the reaper gate's cron body against shared
# TEST. VAC-08 runs read-only SELECTs, but it reads the migration ledger and
# the function bodies `supabase-migrate.yml`'s `apply-test` WRITES while holding
# the same shared-test-db key — so holding it means VAC-08 never judges a
# half-applied push, and the wait step orders it after the apply for the same
# commit.
#
# ⭐ THE HONEST CONSEQUENCE, stated here because Area E depends on it: this job
# still holds the shared-test-db key. Phase 164.4.2 removed ONE HOLDER of the key, not the
# key — the holders are now `python`, `e2e-seeded` and `test-db-drift`. Plan
# 09's AFTER table must carry `test-db-drift` BY NAME: a wait that merely moved
# from `sql-tests` into this job is not a win, and reading only `sql-tests`'s
# timings would report one.
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
#
# AGGREGATOR ROW: this job inherits the tolerance `sql-tests` carried, because
# it inherits the reason for it — it consumes a secret and a repo variable a
# fork cannot see, so its `if:` skips it on a fork PR and on
# workflow_dispatch. See the `frontend:` loop's `test-db-drift` arm.
#
# ⚠️ The ⛔ block below, moved VERBATIM from `sql-tests` (Phase 164.4.2):
# (2026-09-25, Phase 164.4.2.1: `python` and `e2e-seeded` point here for the
# mutex mechanism and its ⛔ constraints, and those constraints still bind THEM.
# The "Acquire" step and "this job" the block describes are now theirs; this job
# holds no key and has no such step.)
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
# Phase 142.1 (D-05): this job must SERIALIZE against the `python` and
# `e2e-seeded` jobs. These SQL files run against the ONE
# shared Supabase test project (`secrets.TEST_SUPABASE_DB_URL`), and
# test_strategy_analytics_stuck_computing_reaper.sql `EXECUTE`s the REAL
# deployed cron body — a GLOBAL `ORDER BY computing_started_at ASC LIMIT 25`
# over strategy_analytics that cannot be scoped to a caller. Each tick
# briefly holds `FOR UPDATE SKIP LOCKED` locks on up to 25 FOREIGN candidate
# rows inside a rolled-back transaction under a 5 s `lock_timeout`. Two
# concurrent gate runs — or a gate run overlapping the `python` /
# `e2e-seeded` jobs writing the same project — must SERIALIZE, not race:
# unserialized, one run's rows land in the other's 25-row budget and the
# LIMIT assertions redden on interleaving rather than on a defect, and the
# 5 s lock_timeout turns lock contention into a 55P03 failure on an innocent
# PR.
#
# HOW it serializes (Phase 158 / OPS-01): the shared-test-db mutex's "Acquire"
# step below takes a Postgres SESSION advisory lock (the shared-test-db key) on the
# TEST project through the session-mode DSN and holds it across this job's
# DB-touching span. `python` and `e2e-seeded` take the SAME key. Contenders
# BLOCK inside the lock instead of queueing in GitHub's concurrency layer.
# Proven from real runners before adoption by .github/workflows/mutex-probe.yml
# (three simultaneous contenders, pairwise non-overlapping hold windows).
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
#
# ⛔ Do NOT give this job its own private lock key — 142-REVIEW.md:286-291
# proposed the equivalent (a private concurrency-group name), and it is the
# wrong fix: a distinct key serializes this job only against itself and does
# nothing about the `python`/`e2e-seeded` jobs writing the SAME project. All
# three must take the shared-test-db key.
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
#
# Costs wall-clock: this job queues behind `python` (~7m) and then waits on
# the mutex rather than overlapping it — the same price `e2e-seeded` pays
# below, and for the same reason. With the mutex the wait burns runner time;
# under the old concurrency group it burned an entire gate (see below).
#
# ⛔ Do NOT reintroduce a job-level GitHub concurrency group for the shared
# test DB (all three jobs carried one until Phase 158). That layer is what
# BROKE, and no reshaping of it is a fix. GitHub Actions holds exactly ONE
# pending entry per concurrency group: "Any previously pending job or
# workflow in the concurrency group will be canceled." With two members that
# was stable (one runs, one pends). Adding this job made THREE, and `python`
# + `sql-tests` both dispatch at t=0 while `e2e-seeded` arrives minutes later
# behind frontend-typecheck — so `e2e-seeded` EVICTED whichever of the first
# two was still pending. The victim is CANCELLED, which renders as a GREY
# check, not a red one, and branch protection is deferred on this repo, so
# nothing blocked on it — and Railway's "wait for CI" then SKIPPED the
# analytics deploy, leaving prod on stale code with no signal (issue #616).
# On a push to main touching supabase/migrations/** that is the merge which
# auto-applies migrations to PROD while losing either the Python drift gates
# or this job — the only gate that EXECUTEs the real deployed cron body, and
# the one that caught D-19.
# ⛔ SHRINKING the shared-test-db concurrency group was never the fix either:
# the eviction is CROSS-run, so fewer members only changes which run gets
# evicted, not whether one does. The eviction layer had to GO, not shrink.
#
# `needs: [python]` below is KEPT. Under the group it was load-bearing (it
# kept `python` and `sql-tests` from being queued at the same instant, so the
# group never held two pending entries). With the group gone it no longer
# carries correctness weight, but it costs nothing and keeps one fewer
# simultaneous waiter on the mutex — so removing it buys nothing.
#
# ⛔ Do NOT "finish the chain" by adding `sql-tests` to `e2e-seeded`'s
# `needs:`. A skipped `needs:` job skips its dependents, and the two `if:`
# conditions diverge on `workflow_dispatch`: this job requires
# `github.event_name == 'push'` (false on dispatch) while `e2e-seeded` only
# requires `!= 'pull_request'` (true) — so the chain would disable
# `e2e-seeded` on every manual run and trip the aggregator's skip check.
# ⚠️ CORRECTED, Phase 164.6.3 / CI-DOCSPATH-01. This line read "`python` carries no
# `if:`, so this job's own dependency is always safe". `python` now carries exactly
# one `if:` — the docs-only conjunct — so the edge CAN now skip this job. That is
# harmless here and only here: the two conditions do not diverge, because this job
# carries the SAME conjunct first in its own `if:` and would skip on the same input
# anyway. ⛔ The ban the paragraph above states is unchanged: no NEW `needs:` edge
# among these three DB-touching jobs, and no edge whose `if:` diverges from this
# job's own.
# Found by the /ship pre-landing review, 2026-08-03. The mutex does NOT
# change this: it serializes without any `needs:` edge, which is precisely
# why no new edge among these three jobs is warranted.
# (Phase 158 / OPS-02: this job IS listed in the `frontend` aggregator's
# `needs:`. That is not such an edge — `frontend` carries `if: always()`, so
# a skip here cannot skip the aggregator; it is read as a RESULT, not
# depended on for ordering.)
```

<a id="test-db-drift-2"></a>
### test-db-drift-2: job test-db-drift, at job level, before `timeout-minutes:`

```text
# TTL for the mutex below (Phase 158 / OPS-01): GitHub kills the job at 90m,
# the psql session drops, and Postgres releases the advisory lock. That IS
# the steal path — no reaper cron needed. Manual unlock:
# docs/runbooks/shared-test-db-mutex.md.
# 158-REVIEW CR-04: 90m, not 60m — sized so THREE simultaneous runs can all
# succeed (setup + the 3600s acquire cap + this job's own work). See the
# fuller derivation on the `python` job's identical TTL comment.
# ⛔ The holder's `pg_sleep` must stay ABOVE this number (WR-01) — it is 6000s.
# (2026-09-25, Phase 164.4.2.1: there is no mutex in this job any more. The value
# is left unchanged per D-04, since SC-4 forbids raising it and lowering it is out
# of scope. The pg_sleep sentence above now applies to `python` and `e2e-seeded`
# only.)
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
# ⭐ WHAT 90m NOW BOUNDS, since the mutex derivation above no longer applies here:
# the `needs:` queue is outside this TTL (the timer starts when the job does), so
# the job's own worst case is setup (checkout, psql install, setup-node: minutes),
# plus the ordering wait's `WAIT_BUDGET_SECONDS` (900s, in
# scripts/wait-for-test-schema-apply.sh), plus VAC-08. VAC-08's statements carry a
# 30s `statement_timeout` with `LEDGER_QUERY_ATTEMPT_BUDGET` retries, and its
# connects are bounded by the step's `PGCONNECT_TIMEOUT` below, so a black-holed
# TEST host fails in seconds rather than squatting a runner until this TTL. That
# sums to well under 30m; 90m is a generous ceiling, not a sized number. Lowering
# it is a separate decision (D-04), taken against that sum.
# ⛔ CORRECTED 2026-09-25 (Phase 164.4.2.1 round-2 review, IN-05): "a black-holed
# TEST host fails in seconds" holds at CONNECT only. `PGCONNECT_TIMEOUT` bounds
# the connect, and `statement_timeout` is enforced by the SERVER, so it bounds a
# running query only while the server can still answer. A network loss AFTER
# connect leaves psql blocked on a read until TCP keepalive gives up, which by
# default is far longer than this job, so that case is bounded only by this
# `timeout-minutes`. scripts/test-ledger-drift-check.sh carries the same
# qualification above its psql commands. The paragraph above is kept as lineage.
```

<a id="test-db-drift-3"></a>
### test-db-drift-3: job test-db-drift, before step `Wait for the TEST schema apply to conclude (merge pushes only)`

```text
# ── THE ORDERING WAIT (Phase 164.9 plan 06, [164.8-PUSH-RACE-VAC08]) ───
# On a merge push this job's DB work must not begin before the TEST schema
# apply for the SAME commit has concluded. The mutex below guarantees the
# two never OVERLAP; it guarantees nothing about which goes FIRST. This step
# checks that fact rather than racing for it.
#
# ⛔ IT SITS BEFORE THE ACQUIRE, DELIBERATELY. A job that waited while
# holding the shared-test-db key would starve every other contender on a
# database other people's CI writes to — including the very apply it is
# waiting for, which would wedge the two until the acquire cap expired.
# (2026-09-25, Phase 164.4.2.1: in THIS job there is no acquire any more, so
# "the mutex below" and "BEFORE THE ACQUIRE" describe `python` and `e2e-seeded`.
# Here the wait is the ONLY ordering control on VAC-08, and a pin in
# critical-regressions.test.ts holds it before VAC-08, enabled and fail-closed.
# On a `pull_request` run this step does not run, so there VAC-08 has no
# ordering control at all — see the ⚠️ in this job's CORRECTED header.)
# (2026-09-26, Phase 164.9.4: ci.yml holds no shared-test-db key; the holders are supabase-migrate.yml apply-test and test-restore-from-baseline.yml restore, the probe is mutex-probe.yml, and analytics-deploy-verify.yml only names the key in issue text.)
#
# ⛔ NO `needs:` EDGE WAS ADDED, AND NONE MAY BE. These three jobs' `if:`
# conditions diverge and a skipped `needs:` job skips its dependents — the
# long ⛔ note on `test-db-drift` (moved there from `sql-tests` in Phase
# 164.4.2) records why. The ordering IS this wait.
#
# Three named outcomes, one log line each. The logic lives ONCE, in
# scripts/wait-for-test-schema-apply.sh, whose `--self-test` proves all
# three reachable (and proves a held flag beats an absent run):
#   apply-concluded  the apply for this commit finished — proceed. An
#                    UNSUCCESSFUL finish says so and still proceeds: it
#                    already carries its own red check, and reddening here
#                    would duplicate it under this job's name.
#   no-apply-run     no apply run appeared for this commit within the
#                    appearance grace AND the in-flight flag is clear —
#                    nothing to order against. The ordinary case.
#   wait-exhausted   the budget ran out with the flag still held or the
#                    apply still unfinished — RED, naming which, with the
#                    runbook.
#
# `github.event_name == 'push'` is conjoined onto this job's own gating,
# explicitly rather than inherited: on a pull request there is no apply to
# order against, so a wait there would buy nothing and cost every PR.
#
# ⛔ AND IT IS THE ONLY EVENT CLAUSE HERE, IN ALL THREE SITES. Each job's
# own `if:` carries a fork guard, and the two jobs that have one spell it
# DIFFERENTLY (`github.event_name == 'push' || ...` versus
# `github.event_name != 'pull_request' || ...`). Copied down here, those
# two spellings made three steps documented as one thing read as three
# different conditions — while the trailing `github.event_name == 'push'`
# already SUBSUMED both of them: on a push each parenthesised clause is
# unconditionally true, so `A && (push || X) && B && push` and
# `A && (!pr || X) && B && push` are both exactly `A && B && push`. The
# subsumed clause is dropped rather than reconciled. The one remaining
# difference between the three is `vars.E2E_TEST_DB_CONFIGURED`, present
# here in exactly the two jobs whose own `if:` carries it — that one IS
# "this job's own gating" and stays.
```

## e2e-seeded

<a id="e2e-seeded-1"></a>
### e2e-seeded-1: job e2e-seeded, at job level, before `timeout-minutes:`

```text
# TTL for the shared-test-db mutex (Phase 158 / OPS-01): GitHub kills the job
# at 90m, the psql session drops, and Postgres releases the advisory lock.
# That IS the steal path. Manual unlock:
# docs/runbooks/shared-test-db-mutex.md.
#
# 158-REVIEW CR-04 — why 90 and not 60. Each CI run takes this lock THREE
# times (python ~7m, e2e-seeded ~8-9m across build + the Playwright batch,
# sql-tests the balance) ≈ 20m of lock-time per run. The phase's own success
# criterion is that THREE simultaneous runs serialize and ALL SUCCEED, so the
# last job to acquire can legitimately queue behind ~8 other holds ≈ 60m. The
# acquire cap is sized to 3600s to absorb exactly that, and this TTL must
# then cover setup + that full cap + this job's own work (~2m + 60m + ~12m ≈
# 74m) with headroom. At 60m the waiter died of its OWN TTL mid-queue — and
# with sql-tests now BLOCKING the `frontend` aggregator that reddens main
# HEAD and makes Railway skip the analytics deploy, i.e. #616's damage
# through a new door. The trade is a wider worst-case WEDGED hold (90m);
# runbook section 3 is the manual override for that.
# ⚠️ Phase 164.4.2 (2026-09-23): the third taker is now `test-db-drift`, which
# holds the key only across VAC-08's read-only drift check, so "sql-tests the
# balance" above names a hold that has moved to a different job and shrunk. The
# derivation is kept as the dated reading it is: a smaller per-run lock time only
# widens this TTL's headroom, so 90 is not re-derived here.
# (2026-09-25, Phase 164.4.2.1: `test-db-drift` left the key; the holders in
# ci.yml are `python` and `e2e-seeded`.)
# ⛔ The holder's `pg_sleep` must stay ABOVE this number (WR-01) — it is 6000s.
# (2026-09-27, Phase 164.9.4 CIOFFMUTEX, D-10: this job holds no key and no
# `pg_sleep` any more, so the derivation above is lineage. 90 is kept
# UNCHANGED on purpose: D-10 forbids widening or re-deriving it in this
# phase. The lane boot, the build and the seeded batch fit inside it.)
```

<a id="e2e-seeded-2"></a>
### e2e-seeded-2: job e2e-seeded, at job level, before `needs:`

```text
# v1.16 close-out (2026-08-01): serialize against the `python` job (and
# `sql-tests`, whose place Phase 164.4.2 gave to `test-db-drift`). All three
# drive the ONE shared Supabase
# test project (the shared-TEST URL secret), and `claim_compute_jobs_with_priority`
# claims a GLOBAL batch of 50 ready rows — it cannot be scoped to a caller.
# So while this job drives the wizard and enqueues `compute_jobs`, a
# concurrent `python` fencing test that seeds a pending row and then claims
# it gets its row swept into THIS job's traffic (or vice versa), and
# `_claim_one(..., want_job_id=...)` correctly returns None rather than a
# foreign row — reddening 10 fencing/drain tests with `assert None is not None`
# and `assert 'pending' == 'running'`.
# (2026-09-25, Phase 164.4.2.1: `test-db-drift` left the key; the holders in
# ci.yml are `python` and `e2e-seeded`. `test-db-drift` still reads shared TEST
# but no longer serializes against this job; "All three" above is lineage.)
#
# The serialization already on `python` (see its comment) was added for
# CROSS-PR contention and explicitly reasons about "two different PRs' python
# jobs"; it never covered two jobs INSIDE one run. `e2e` (the smoke batch)
# does not need it — it builds against `https://placeholder.supabase.co` and
# never reaches the shared project.
#
# Costs wall-clock: this job waits behind `python` (~7m) instead of
# overlapping it. That is the price of the tests being trustworthy; the
# alternative is a suite that reds on interleaving rather than on defects.
# (2026-09-27, Phase 164.9.4 CIOFFMUTEX, D-01/D-02: this job left the key
# too, after `python`. It seeds, builds and runs its specs against a
# local-stack lane private to this runner, so it no longer drives the shared
# project and has nothing to serialize against. The paragraphs above are
# lineage.)
#
# Phase 158 / OPS-01: the mechanism used to be a repo-wide GitHub concurrency
# group shared with `python` and `sql-tests`. It is now the "Acquire
# shared-test-db mutex" step below — a Postgres SESSION advisory lock on the
# shared-test-db key. ⛔ Do NOT reintroduce that group in any shape (including a
# shrunken one): with three members, a third arrival EVICTED the queued run,
# which concluded `cancelled` — a GREY check that Railway read as a failed
# check-suite, silently skipping the analytics deploy (issue #616). The
# eviction is CROSS-run, so shrinking only changes which run dies. Full
# mechanism in the ⛔ block on `test-db-drift` (moved there from `sql-tests`).
# (2026-09-27, Phase 164.9.4 CIOFFMUTEX: the step named above is gone from
# this job, which holds no key. The ⛔ against the concurrency group still
# stands. The text above is lineage.)
# ⛔ Do NOT add `test-db-drift` to this `needs:` list to serialize the shared test
# DB (this warning named `sql-tests` until Phase 164.4.2 moved its `if:` into
# `test-db-drift`). It looks right and it silently disables THIS job on
# every `workflow_dispatch` run: a skipped `needs:` job skips its dependents,
# and the two `if:` conditions diverge on manual dispatch — `test-db-drift`
# requires `github.event_name == 'push'` (false) while this job only requires
# `!= 'pull_request'` (true). The aggregator at the `e2e-seeded result=`
# check then errors on the skip. Serialization needs no `needs:` edge at all
# now — the mutex does it, which is exactly why adding one is still wrong.
# (2026-09-27, Phase 164.9.4 CIOFFMUTEX, D-10: the mutex this cites is gone
# from this job, and nothing here serializes the shared test DB any more.
# The skip-propagation reason above still holds on its own, so the ⛔ stands
# and no `needs:` edge is added, to `test-db-drift` or to `python`.)
```

<a id="e2e-seeded-3"></a>
### e2e-seeded-3: job e2e-seeded, before step `Verify build inlined real test-Supabase URL`

```text
# retro-PR188-D4 (pr-test-analyzer #36, HIGH/8), kept as lineage: this step
# asserted that the rebuild inlined the REAL shared-TEST URL, read from a
# secret. If the build ever short-circuits silently (e.g. a restored
# .next/cache satisfying a stale manifest, or an env plumbing drift), the
# seed-gated specs would self-skip via HAS_SEED_ENV checks and CI would
# still report green, with the seeded coverage a no-op.
# 2026-09-27, Phase 164.9.4 CIOFFMUTEX D-09: RETARGETED, not weakened, and
# its NAME is kept (the C-0293(c) pin in critical-regressions.test.ts reads
# it). The build now inlines the lane URL exported by the handoff step, and
# this step fails when:
#   - NEXT_PUBLIC_SUPABASE_URL is empty (the handoff did not export it);
#   (i)   the lane's loopback host:port is NOT inlined in .next/static or
#         .next/server;
#   (ii)  the placeholder Supabase host IS inlined;
#   (iii) a hosted-project-shaped URL (https, a 20-character lowercase
#         alphanumeric label, supabase.co) IS inlined, i.e. a build aimed
#         at a shared or production project.
# (iii) cannot false-red on the placeholder: its label is 11 characters.
# Whether some benign bundle string matches (iii) is UNMEASURED; the first
# PR CI build is the measurement. A false red there is a D-05 root-cause
# fix (tighten the pattern to the inlined-URL shape), never the removal of
# the arm.
# (2026-10-02, review 164.9.4 round 2 IN-02: MEASURED. The first reading is
# CI run `37039941530` at `d69f43c6b`: on a real lane build arm (iii)
# matched nothing and the step exited 0. The D-05 instruction above still
# governs any future false red. The sentence above is kept as lineage.)
# No URL or host is printed on any path: this log is public. Every grep
# sends its output to /dev/null, and every error line is fixed text.
# (2026-10-01, Phase 164.9.4 review SFH-01: (ii) and (iii) are NEGATIVE
# arms, so `if grep ...; then exit 1` read grep's exit status 2 (an error:
# a missing directory, an unreadable file, an I/O fault) exactly like 1
# (no match), and passed on a bundle it never fully read. Both scanned
# directories are now asserted to exist first, and (ii)/(iii) capture the
# status and fail LOUD on anything that is not 0 or 1. Their stderr is no
# longer discarded: grep's error lines name file paths, never the pattern
# or a URL, so the public-log rule above still holds.)
```
