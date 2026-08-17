---
phase: 143-job-dropped-enqueue-reconciliation-sweep
verified: 2026-08-17T12:35:00Z
status: passed
status_scope: "TEST-scope. Founder decision 2026-08-17: accept TEST-scope verification and continue the run; /ship stays a separate human act."
status_caveat: >-
  ⚠️ SC#1's PROD half is NOT established and cannot be by anything this phase did — the migration
  is applied to TEST only, and merging AUTO-APPLIES to PROD. What IS measured: the live TEST tick
  of 2026-08-17 09:35:00 UTC inserted compute_jobs 58728527 through FORCE ROW LEVEL SECURITY
  (L-2/T-143-02 resolved). The 143-04 checkpoint:human-verify remains UNDISCHARGED — no human has
  typed "approved". Three of five human_verification items were discharged in 694444e3; the three
  that remain all reduce to authorizing /ship. ⚠️ The first PROD tick will enqueue ZERO jobs (census
  = 0 candidates): that is the SAFE outcome and produces NO positive evidence. Proof of function is
  the offline harness, the CI gates and the live TEST tick — never PROD quietness.
score: 3/3 success criteria verified (TEST scope) — 0 failed, 0 behaviour-unverified
behavior_unverified: 0
overrides_applied: 0
requirement: JOB-04
requirement_ticked: false
requirement_tick_verdict: "CORRECT — the mechanism is live on TEST only; PROD is untouched by deliberate scope. Ticking JOB-04 now would assert a production property that does not yet exist."
re_verification: null

warnings:
  - id: W-1
    severity: warning
    class: falsified-claim-survives-in-artifact
    file: supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql
    lines: "291-302, 411-413"
    issue: >-
      The D-11 premise is still asserted in the SHIPPED migration header after Plan 04
      falsified it. Line 411-413 states the alert "only reaches Sentry if SENTRY_DSN is set
      on the WORKER's Railway service, which is a different service from the FastAPI app"
      and flags it "unproven until Plan 04". Census part B section 15 measured that there IS
      no separate worker service (merged into the FastAPI process since 2026-04-20,
      main.py:80-86 / :271), that process has called init_sentry() since Phase 16
      (main.py:69), and SENTRY_DSN is set on it. Line 291-302 likewise still says "treat the
      write path as unproven" — the live 09:35 tick proved it. Plan 04 edited THIS FILE to
      correct D-12's return_message premise in the same session and left D-11 standing.
    rule: "A scope amendment touching ONE file is incomplete (project standing rule)."
    blast_radius: "SQL comment only. No behavioural or data-integrity effect."
  - id: W-2
    severity: warning
    class: falsified-claim-survives-in-artifact
    file: analytics-service/main_worker.py
    lines: "1086-1094"
    issue: >-
      The init_sentry() rationale comment calls main.py "the sibling FastAPI process" and
      asserts the reconcile-sweep alert "would emit into the void in production while every
      unit test stayed green." Both halves are falsified by D-11. 143-CONTEXT.md:170-172
      explicitly warns against exactly this inference ("Do not let a future reader infer from
      it that production was previously unalerted — it was not") — and the code comment is
      the artifact that invites it. The init_sentry() call itself remains correct (it covers
      the standalone `python -m main_worker` path); only its stated justification is stale.
    blast_radius: "Python comment only. No behavioural effect."
  - id: W-3
    severity: warning
    class: correction-not-propagated
    files:
      - ".planning/phases/143-.../143-CONTEXT.md:120-126"
      - ".planning/phases/143-.../143-RESEARCH.md:131, 196, 210"
    issue: >-
      SC#2's mechanism correction (commit c5000cd9) touched exactly two files —
      .planning/ROADMAP.md and .planning/milestones/v1.16-ROADMAP.md. 143-02-SUMMARY.md:41
      names the un-corrected carriers by name: "CONTEXT/RESEARCH/PLAN all attribute SC#2 to
      the partial unique index; that is not the operative mechanism." Both still carry the
      falsified sentence verbatim with NO correction banner. CONTEXT demonstrably accepts
      amendment banners — it carries two for D-11 (lines 134 and 150) — so the omission is
      selective, not structural. RESEARCH contains zero correction markers anywhere.
    blast_radius: "Planning ledgers. The operative artifacts (migration header 314-330, SQL gate Part 3 header 613-644, ROADMAP SC#2) all carry the correction."
  - id: W-4
    severity: warning
    class: stale-ledger
    file: .planning/STATE.md
    lines: "6, 8, 572-578"
    issue: >-
      STATE.md was never advanced past Plan 03. `stopped_at` still reads "Completed
      143-03-PLAN.md ... migration still UNAPPLIED — Plan 04 owns TEST apply and the live
      tick" — falsified: the migration IS applied to TEST (jobid 18) and the tick was
      observed. `last_updated` is 2026-08-16T22:03, `current_phase` is still 153.7, and the
      per-plan metrics table has rows for P01/P02/P03 but none for P04. Three of the
      143-02/143-03 learning entries are tagged "[Phase ?]" rather than "[Phase 143]".
  - id: W-5
    severity: warning
    class: gate-never-executed
    file: supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
    lines: "325-823 (Parts 2, 3, 4)"
    issue: >-
      The SQL gate's twelve behavioural arms, the SC#2 re-run part and the LIMIT+1 bound part
      have NEVER executed against the real schema. 143-03-SUMMARY.md:239 states this plainly
      ("Parts 2-4 have run only against the harness + addendum: no RLS, no real scheduler, no
      compute_jobs_set_updated_at_trigger, minimal table shapes"). Plan 04 applied the
      migration to TEST but ran only Part 1's assertion; census part B has no Part 2/3/4
      entry. The branch has never been pushed (33 commits ahead of origin/main, no upstream),
      so the sql-tests CI job has never run this file once. First real-schema execution
      arrives on the PR's first sql-tests run.
  - id: W-6
    severity: info
    class: correction-wording
    file: .planning/ROADMAP.md:95
    issue: >-
      The SC#2 correction sentence leads with "the operative guard is the sweep's FOR UPDATE
      SKIP LOCKED ... NOT the partial unique index", then correctly states two clauses later
      that "Sequential double-execution cannot conflict at all, because tick 1's INSERT
      removes the strategy from the zero-jobs conjunct." SC#2 as written is the SEQUENTIAL
      case, whose operative guard is the zero-jobs conjunct — not SKIP LOCKED. The migration
      header (314-330) and the SQL gate Part 3 header (613-644) both get the split right
      (zero-jobs conjunct = sequential; SKIP LOCKED then ON CONFLICT = concurrent). The
      ROADMAP's lead clause is the one imprecise restatement of an otherwise correct
      correction.

human_verification:
  - test: "Discharge the `checkpoint:human-verify` gate in 143-04-PLAN.md Task 3."
    expected: >-
      A human reads the evidence bundle (143-CENSUS.md part B sections 6-15) and types
      \"approved\" to authorize /ship. This is the phase's own declared remaining gate and
      143-04-SUMMARY.md:124-126 records it as owed.
    why_human: "Authorization to merge a migration that AUTO-APPLIES to PROD. No agent may self-grant it."
  - test: "[✅ DISCHARGED 2026-08-17 in commit 694444e3 — corrected, not logged] W-1 and W-2 (falsified D-11 premise in the migration header and in main_worker.py)."
    expected: >-
      Either a comment-only correction commit touching both files, or an explicit TODOS.md
      entry. The project stopping rule says prose is never blocking — but the standing
      one-file-amendment rule says the D-12 correction that touched this exact file should
      have carried D-11 with it.
    why_human: "Judgment call between two of the project's own standing rules."
  - test: "[✅ DISCHARGED 2026-08-17 in commit 694444e3 — pre-execution ledgers ARE amendable; correction banners added at the anchors, plus both RESEARCH tables] W-3 (SC#2 correction absent from 143-CONTEXT.md and 143-RESEARCH.md)."
    expected: "A correction banner on 143-CONTEXT.md:120 and 143-RESEARCH.md:131/196/210, or an accepted decision that pre-execution artifacts are historical and are not amended."
    why_human: "Policy call on whether pre-execution ledgers are amendable records or frozen history."
  - test: "Inspect the PR's FIRST sql-tests CI run and confirm Parts 2-4 pass against the real TEST schema (W-5)."
    expected: >-
      Twelve directional arms green, Part 3's two-tick assertion green, Part 4's LIMIT+1
      bound green. If any arm REDs, the harness diverged from the real schema and the
      SC#1/SC#3 offline evidence is weaker than recorded.
    why_human: "Requires pushing the branch and reading a CI run — outside this phase's scope by its own design."
  - test: "Re-run the pre-merge census, then merge and confirm the first PROD tick at :35."
    expected: >-
      Census still shows 0 candidates on PROD; the first PROD tick runs and enqueues ZERO
      jobs. Note honestly: a zero-row tick is the SAFE outcome and produces NO positive
      evidence. Proof of function is the offline harness, the CI gate and the live TEST tick
      — never PROD quietness.
    why_human: "Merging to PROD is /ship's act, deliberately not taken by this phase."
  - test: "Update STATE.md to reflect Plan 04 completion (W-4)."
    expected: "`stopped_at` no longer asserts the migration is UNAPPLIED; a P04 metrics row exists."
    why_human: "Ledger hygiene; needs the owner's decision on whether STATE advances to 143 or stays on the v1.18 pointer."

deferred:
  - truth: "Composite strategies stranded without analytics are healed"
    addressed_in: "Not scheduled — deliberate non-coverage"
    evidence: "TODOS.md:2594 (D-09). Money-safety exclusion: enqueueing compute_analytics_from_csv on a composite would overwrite a correct headline with the single-key math its own handler abandoned."
  - truth: "The wizard/API first-hop enqueue drop is detected"
    addressed_in: "Not scheduled — deliberate non-coverage"
    evidence: "TODOS.md:2607 (D-05). 'No dailies AND no jobs' is byte-identical to a brand-new strategy; needs a different signal with its own false-positive profile."
  - truth: "142's reaper header no longer carries the falsified return_message premise"
    addressed_in: "TODOS.md follow-on"
    evidence: "TODOS.md:2615. Same D-12 falsification, different file, outside this phase's scope."
---

# Phase 143: JOB — Dropped-enqueue reconciliation sweep — Verification Report

**Phase Goal:** "`after()` never ran at all" enqueue drops — architecturally invisible from inside
the route handler — are detected by absence and healed
**Requirement:** JOB-04
**Verified:** 2026-08-17
**Status:** human_needed
**Re-verification:** No — initial verification
**Branch:** `feat/v1.19-job-rate` @ `10824fab` (33 commits ahead of `origin/main`, never pushed)

## Verdict in one line

The mechanism exists, is substantive, is wired end to end, and was **observed working on a real
database**. Three success criteria hold at TEST scope. What is owed is not code: an undischarged
human gate, a PROD merge this phase deliberately did not take, and four stale-claim / stale-ledger
items — one of them inside the shipped migration itself.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A strategy with dailies, NO `compute_jobs` row of ANY status, no terminal `strategy_analytics` row, past a grace window, is re-enqueued by a pg_cron sweep and a Sentry alert fires | ✓ VERIFIED (TEST scope) | **Heal half — measured live.** The `35 * * * *` tick at `2026-08-17 09:35:00.061575+00` (`succeeded`, 125 ms) inserted job `58728527-…` for the seeded orphan `de19555f-…`, `kind=compute_analytics_from_csv`, `status=pending`, `metadata={"source":"reconcile-sweep","detected_at":"2026-08-17T09:35:00.061076+00:00"}`, `created_at` == tick start. This resolves landmine L-2 (can the cron role write `compute_jobs` through FORCE RLS) by measurement, not inference. **Alert half — behaviourally tested + production reachability measured.** `main_worker.dispatch_tick:707-716` emits exactly one warning-level `capture_message` for a marker-carrying job; `test_marker_job_captures_sentry_event` asserts exactly one capture and `test_unmarked_job_does_not_capture` asserts zero for an unmarked job (8/8 JOB-04 pytests pass, run by me). Production reachability: `main.py:69` calls `init_sentry()` at import, `main.py:271` runs `dispatch_loop` in the app lifespan, `SENTRY_DSN` is set on that service. ⚠️ See "What was NOT observed" below. |
| 2 | Running the sweep twice in a row produces no duplicate job | ✓ VERIFIED | **Offline oracle:** 143-throwaway-harness arm G — two `EXECUTE`s of the body read back out of `cron.job.command` → exactly 1 job row. **Live:** immediately post-tick the probe re-evaluated against the deployed predicate returned zero rows (census part B §12) — it had left the candidate set. **CI gate:** `test_reconcile_dropped_enqueue_sweep.sql` Part 3 asserts one row AND the SAME row id after tick 2 (a delete-and-reinsert would hold the count at one while resetting `attempts`/`claim_token`). ⚠️ Mechanism correction — see the dedicated section below. |
| 3 | A strategy inside the grace window, or with any existing job row, or with a terminal analytics row, is never touched | ✓ VERIFIED (see W-5 on real-schema coverage) | **Twelve identity-scoped arms** executed against the DEPLOYED body: B (dailies landed this instant), C1 (running `derive_broker_dailies`), C2 (`failed_final`), C3 (`done`), D1-D4 (`complete` / `complete_with_warnings` / `failed` / `computing`), E (composite via `strategy_keys`), F (`archived`); every untouched arm asserted on ZERO marker-carrying rows for **its own** strategy id, never a global count. Arm D1 observed **RED** under the neuter that drops `'complete'` from the exclusion list — the mass-re-enqueue signature — and green again on restore. **Real-data confirmation:** TEST's one pre-existing dailies-bearing strategy (zero `compute_jobs`, excluded SOLELY by the terminal-analytics conjunct) was NOT healed by the live tick — census part B §14 shows zero `compute_jobs` rows with `source='reconcile-sweep'` on the whole project after the probe was cleaned up. |

**Score: 3/3 truths verified at TEST scope.** Zero behaviour-unverified. Zero failed.

### What was NOT observed — stated plainly rather than smoothed

1. **No Sentry event has ever fired from a real reconcile-sweep job.** TEST has no worker, so the
   job the live tick inserted was never claimed. The alert half is pinned at every joint — the
   cross-language marker contract test (`test_cron_body_marker_matches_worker_literal`) asserts the
   literal `== "reconcile-sweep"` comparison in the worker source against the migration file text;
   the live tick proved the cron writes exactly those two keys; the pytests prove the claim path
   emits — but the composed chain has never executed end to end.
2. **The sweep is not on PROD**, and SC#1 therefore is not established there. This is a deliberate
   scope boundary, not an omission: merging `supabase/migrations/**` auto-applies to PROD and is
   `/ship`'s act. Saying SC#1 "passes" without that distinction would be the false-completion class
   this milestone has spent three phases closing.
3. **The first PROD tick will enqueue ZERO jobs.** The census puts the standing candidate population
   at 0 on both projects. That is the safe outcome and it is also **no positive evidence**. Do not
   read PROD quietness as proof of function.
4. **SQL gate Parts 2-4 have never run against the real schema** (W-5).

### The SC#2 mechanism correction — is it coherently recorded?

**Mostly yes; two ledgers still carry the falsified claim.**

The measured mechanism is a two-part split, and it is stated correctly in the artifacts that matter:

| Case | Operative guard | Recorded correctly in |
|------|-----------------|-----------------------|
| Sequential re-run | the **zero-jobs conjunct** — tick 1's INSERT removes the strategy from the predicate, so tick 2's batch is empty and the INSERT is never reached | migration header 314-330; SQL gate Part 3 header 613-644; 143-02-SUMMARY:41; census §12; STATE learnings 684 |
| Concurrent race | **`FOR UPDATE SKIP LOCKED`** first (an INSERT into `compute_jobs` key-share-locks its parent `strategies` row), **`ON CONFLICT DO NOTHING`** second; removing BOTH is the only combination yielding 23505 at READ COMMITTED | same set |

Falsified attribution **still standing, uncorrected**:

- `143-CONTEXT.md:120` — "Idempotency (SC#2) rides the EXISTING partial unique index"
- `143-RESEARCH.md:131`, `:196`, `:210` — same claim, three times, `:210` phrasing it as "SC#2 is a
  property of the index, not of new code"

Commit `c5000cd9` touched exactly two files (`.planning/ROADMAP.md`, `.planning/milestones/v1.16-ROADMAP.md`)
and its own message says it patched "both roadmaps ... so the falsified attribution does not survive
in a second ledger." It survives in two more. 143-02-SUMMARY.md:41 named CONTEXT and RESEARCH
explicitly as carriers — so this was known, not missed. Filed as **W-3**.

One wording wobble in the correction itself (**W-6**): ROADMAP:95 leads with "the operative guard is
the sweep's `FOR UPDATE SKIP LOCKED`" for a criterion that describes the *sequential* case, then
gives the correct sequential reason two clauses later. The migration header and the SQL gate get the
split right; the ROADMAP's lead clause is the one imprecise restatement.

### The D-11 and D-12 corrections

| Correction | Falsified premise | Corrected where | Still standing where |
|---|---|---|---|
| D-12 | `cron.job_run_details.return_message` carries the RAISE NOTICE healed count | migration header 425-448 (replaced with the observed `DO` command tag + a working row-count query); census §13; TODOS.md:2615 for 142's reaper | — (142's reaper is out of scope and correctly deferred) |
| D-11 | The worker is a separate Railway service; the alert is unproven until its `SENTRY_DSN` is checked | 143-CONTEXT.md:150-172 (a thorough, correctly-scoped amendment); census §15; 143-04-SUMMARY:46 | **migration header 411-413 and 291-302** (W-1) and **main_worker.py:1086-1094** (W-2) |

W-1 is the sharper of the two: Plan 04 edited that exact file to land the D-12 correction and left
D-11's falsified sentence three paragraphs away. The migration is the artifact that auto-applies to
PROD and is the one a future reader opens first.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` | pg_cron sweep, applied TEST, PROD untouched | ✓ VERIFIED | 817 lines. Registers ONE cron job, no DDL/function/policy/grant. Five load-bearing conjuncts (archived-exclusion, dailies EXISTS, zero-jobs NOT EXISTS un-kind-scoped, four-status terminal-analytics NOT EXISTS, `strategy_keys` composite exclusion) + `MAX(created_at) < now() - interval '1 hour'` grace evaluated last. `AS MATERIALIZED` / `ORDER BY` anchor ASC / `LIMIT 25` / `FOR UPDATE SKIP LOCKED` / `ON CONFLICT DO NOTHING`. Filename `20260816140000` is the repo tip; no later migration touches the jobname. |
| STEP 2 self-verify (same file, 689-814) | apply-time gate on the DEPLOYED body | ✓ VERIFIED | Reads back out of `cron.job`, never re-typed. 13 positive anchors, 2 occurrence-count anchors (`PUBLIC.COMPUTE_JOBS` == 2, `MAX(DG.CREATED_AT)` == 2), 4 negative anchors (`computed_at`, `updated_at`, `enqueue_compute_job`, IN-subquery-LIMIT). Every failure message names the consequence, not the token. |
| `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` | CI SQL gate | ⚠️ VERIFIED-BUT-UNRUN | 823 lines, 4 parts. Discovered by the existing `sql-tests` job glob (`ci.yml:1020`), correct `test_*.sql` prefix. Part 1 is deliberately ungated (no green-skip). Parts 2-4 use `EXECUTE v_command` against the deployed body — a real oracle, not a re-implemented predicate. **Never executed against the real schema** (W-5). |
| `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | migration-content gate | ✓ VERIFIED | 422 lines, 11 tests. **I ran it: 11/11 pass.** Extracts the `$cron$` body with an anti-vacuity guard (extraction must contain the INSERT), asserts occurrence counts rather than bare `toContain` for the collision-prone anchors, and checks no LATER migration re-registers the jobname. |
| `analytics-service/main_worker.py` | `init_sentry()` + reconcile-sweep capture | ✓ VERIFIED | `init_sentry()` at `main():1100` (after `basicConfig`, before the KEK check). Capture at `dispatch_tick:668-742`: reads `metadata`, gates on `source == "reconcile-sweep" and attempts <= 1`, emits one warning-level `capture_message` carrying `strategy_id` + `detected_at` only (no PII), wrapped in its own try/except that **logs loudly** on failure. `sentry_sdk` imported as a module so tests can spy on it. |
| `analytics-service/tests/test_main_worker.py` | JOB-04 pytests | ✓ VERIFIED | **I ran them: 8/8 pass.** `test_main_calls_init_sentry`, `test_marker_job_captures_sentry_event`, `test_unmarked_job_does_not_capture`, `test_capture_failure_does_not_fail_job`, `test_reclaimed_marker_job_does_not_re_alert`, `test_marker_job_without_attempts_still_alerts`, `test_capture_failure_is_logged_loudly`, `test_cron_body_marker_matches_worker_literal`. |
| `143-CENSUS.md` | TEST+PROD census + live-tick evidence | ✓ VERIFIED | Part A (authoring census, PostgREST) + Part B §6-15 (apply, byte-match, slot table, cron role, the tick, SC#2 live, D-12 falsification, cleanup, D-11 verdict). Two plan deviations escalated and labelled rather than glossed. |
| `143-REVIEW.md` | code review | ✓ VERIFIED | 0 blockers, 0 critical, 3 warnings, 1 info — all three warnings fixed (see below). |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| cron body INSERT | `compute_jobs.metadata` | `jsonb_build_object('source','reconcile-sweep','detected_at',now())` | ✓ WIRED | Observed live with the exact two keys. |
| `compute_jobs.metadata` | `claim_compute_jobs_with_priority` | `metadata = COALESCE(metadata,'{}') \|\| jsonb_build_object(...)` — a MERGE | ✓ WIRED | Review traced the current RPC definition (`20260719073701`); the marker survives the claim rewrite. This was the gap most likely to break the contract silently, and it does not. |
| claimed job | `dispatch_tick` Sentry capture | `_meta.get("source") == "reconcile-sweep"` | ✓ WIRED | Behaviourally tested; `attempts <= 1` gate fires on the first claim (the claim RPC increments `attempts` from the `NOT NULL DEFAULT 0` column BEFORE returning the row). |
| migration file text | worker source text | `test_cron_body_marker_matches_worker_literal` | ✓ WIRED | Cross-language contract pinned on the `== "reconcile-sweep"` COMPARISON, not the bare literal — the `f62c3866` vacuity fix. Migration filename hardcoded with a rename-guard message. |
| `dispatch_tick` | initialized Sentry client in PROD | `main.py:69 init_sentry()` + `main.py:271 dispatch_loop` in lifespan | ✓ WIRED | Read and confirmed in `main.py`. `sentry-sdk` pinned 2.64.0 so `new_scope()` (a 2.x API) exists — a 1.x pin would have made this an `AttributeError` swallowed into permanent silence. |
| `test_*.sql` gate | CI `sql-tests` job | `files=(supabase/tests/test_*.sql)` glob, `ci.yml:1020` | ⚠️ WIRED, NEVER FIRED | Discovery is correct; the branch has never been pushed, so the job has never run this file. |

---

## Behavioural Spot-Checks (run by me, this session)

| Behaviour | Command | Result | Status |
|---|---|---|---|
| TS migration-content gate | `npx vitest run src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | 11 passed (1 file) | ✓ PASS |
| JOB-04 worker pytests | `python3 -m pytest tests/test_main_worker.py -k "sweep or reconcile or sentry"` (from `analytics-service/`) | 8 passed, 55 deselected | ✓ PASS |
| Debt-marker scan on all 4 modified source files | `grep -nE "TBD\|FIXME\|XXX"` | zero matches | ✓ PASS |
| Migration is the repo tip | `ls supabase/migrations \| awk -F_ '$1>20260816140000'` | only `down/` | ✓ PASS |
| No later migration unschedules the sweep | `grep -rln reconcile_dropped_enqueue_sweep supabase/migrations/` | only the migration itself | ✓ PASS |
| mypy on the modified worker file | `mypy --strict main_worker.py` | 9 `no-untyped-def` at lines 494/784/800/849/912/931/965 | ℹ️ NOT A FINDING — all pre-existing and outside the phase-touched regions (643-742, 1086-1100); CI's strict floor is `services/ routers/ models/`, which does not include `main_worker.py` (`ci.yml:1192`) |
| SQL gate Parts 1-4 against TEST | — | not runnable here (no `psql`; Supabase MCP not held by this agent) | ? SKIP → human (W-5) |

---

## Probe Execution

Not applicable — this phase declares no `scripts/*/tests/probe-*.sh`. Its equivalent runnable
evidence is the CI SQL gate (unrun, W-5), the two suites above (both run green), and the live TEST
tick (recorded in census part B §11).

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| migration | 291-302, 411-413 | Falsified claim asserted as current (D-11) | ⚠️ Warning | Prose. Misleads a future reader into believing production was unalerted and the write path unproven — both measured false in this same phase. |
| `main_worker.py` | 1086-1094 | Falsified claim asserted as current (D-11) | ⚠️ Warning | Comment. "Would emit into the void in production" — CONTEXT explicitly warns against this exact inference. |
| `143-CONTEXT.md` / `143-RESEARCH.md` | 120 / 131,196,210 | Correction not propagated (SC#2) | ⚠️ Warning | Planning ledgers assert a mechanism the phase measured to be wrong. |
| `.planning/STATE.md` | 6, 8, 572-578 | Stale ledger | ⚠️ Warning | Asserts the migration is UNAPPLIED. It is applied. |

**No blockers.** Under the project stopping rule (`feedback_review_blast_radius_bar_and_stopping_rule`),
prose and ledger findings are never blocking — they are logged. All four above are prose/ledger.

### Code review warnings — all three closed, verified in code

| # | Finding | Fix commit | Verified |
|---|---|---|---|
| WR-01 | Three text anchors said "zero-jobs conjunct" but were satisfied by the INSERT target — `public.compute_jobs` occurs twice, so deleting the conjunct left one occurrence and all three gates stayed green. Same class as the `f62c3866` vacuity. | `262a6711` | ✓ Occurrence-count gates present in all three: migration `v_jobs <> 2` (738-741), SQL Part 1 (233), TS `.toBe(2)` (192). Each message names the mass-re-enqueue consequence. |
| WR-02 | The Sentry capture's `except Exception: pass` was completely silent — the alert could die exactly as silently as the rejected `pg_net` bridge, with no test able to see it. | `41661642` | ✓ `logger.warning(..., extra={"event_type": "reconcile_sweep_alert_emit_failed"})` at 735-742; `test_capture_failure_is_logged_loudly` passes. The swallow correctly stays (an unwrapped raise would take the whole claimed batch). |
| WR-03 | The alert re-fired on every re-claim (marker persists for the row's lifetime; the claim RPC merges rather than clears), so one heal could become an alert storm. | `b00df416` | ✓ `_attempts <= 1` gate at 706-707. Fail-open is carried by the `<= 1` (admits 0), not by the `or 1` default — measured and documented; `test_marker_job_without_attempts_still_alerts` and `test_reclaimed_marker_job_does_not_re_alert` both pass. |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| JOB-04 | A reconciliation sweep detects strategies with persisted daily-returns data but NO `compute_jobs` row of any status and no terminal `strategy_analytics` row past a grace window, and idempotently re-enqueues + alerts Sentry | **SATISFIED ON TEST / NOT YET ON PROD — correctly left unticked** | All three SCs verified at TEST scope. `REQUIREMENTS.md:54` unticked, `:1405` "Pending". |

### Is leaving JOB-04 unticked the right call?

**Yes, and I would have flagged it as a false completion had it been ticked.**

The requirement's verb is "detects ... and idempotently re-enqueues + alerts Sentry" — a property of
a running system, not of a merged file. Today that system is TEST. On PROD the sweep does not exist:
no `cron.job` row, no tick, no heal, no alert. Ticking JOB-04 now would make `REQUIREMENTS.md`
assert a production property that is false, and the tick is the artifact a future reader trusts
without re-measuring. 143-04-SUMMARY.md:106-108 reaches the same conclusion for the same reason.

**Can the phase be considered complete with it unticked?** Yes — with one honest qualification.
Every act inside this phase's scope is done: the mechanism is authored, gated three ways, applied to
TEST, and proven by a real tick. The remaining act (merge) is `/ship`'s, by explicit design and by
the PROD-auto-apply hazard the migration header documents at 453-462. So the phase is
*execution-complete*. It is not *outcome-complete*, and the unticked requirement is precisely the
right marker of that gap — it is the thing that will still be unticked if the merge never happens.

**What this verification will NOT do:** pass or fail SC#1 on PROD. That criterion's PROD half is
establishable only by an act this phase deliberately did not take. Recording it as passed would be
a lie; recording it as failed would punish the phase for its own correct scope discipline. It is
recorded as verified-at-TEST-scope with the PROD gap named, and routed to human verification.

---

## Gaps Summary

**No gaps blocking goal achievement.** The phase goal — dropped enqueues detected by absence and
healed — is achieved and was observed happening on a real database at `2026-08-17 09:35:00 UTC`.

What is outstanding is four things, none of them code:

1. **An undischarged human gate.** `143-04-PLAN.md` Task 3's `checkpoint:human-verify` has not been
   discharged; no human has typed "approved". The phase's own SUMMARY names this as "the phase's
   remaining gate". This alone forces `status: human_needed`.
2. **Two falsified D-11 claims still standing in shipped artifacts** (W-1, W-2) — one of them in the
   migration header that Plan 04 edited for a different correction in the same session.
3. **One correction not propagated to two planning ledgers** (W-3), both named as carriers by the
   summary that made the correction.
4. **A CI gate that has never executed** (W-5) — Parts 2-4 first run on the PR's first `sql-tests`
   job. Until then, SC#3's grace-window and existing-job arms rest on the throwaway harness
   (which does execute the real deployed body text, but against a stub schema with no RLS and no
   triggers) plus one real-data confirmation of the terminal-analytics arm from the live tick.

**On honesty:** this phase falsified three of its own premises mid-flight (SC#2's mechanism, D-12's
`return_message`, D-11's separate-worker-service) and corrected all three where it mattered most.
Two neuters that "did not redden" were recorded as failures of the gate rather than successes of the
code. A gate that could not fail was found by review and replaced with an occurrence count. That is
the behaviour this project asks for, and it is why the findings above are warnings rather than
blockers — the phase's own instruments found most of them first. The residue is that corrections
stopped one or two files short of the surface they falsified, which is the exact standing rule the
project wrote down after the v1.17 milestone audit.

---

_Verified: 2026-08-17T12:35:00Z_
_Verifier: Claude (gsd-verifier)_
