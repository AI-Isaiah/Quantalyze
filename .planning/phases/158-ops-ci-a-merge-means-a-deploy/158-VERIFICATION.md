---
phase: 158-ops-ci-a-merge-means-a-deploy
verified: 2026-08-21T05:05:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Phase-PR live CI run (one run covers four recorded backstops): (a) plant a temporarily failing supabase/tests assertion → frontend concludes FAILURE with sql-tests=failure in the loop output, revert → green (both polarities); (b) read the e2e + e2e-seeded Playwright per-spec output — each of the five newly wired specs (api-key-flow, sync-analytics-flow, full-flow, csv-upload-flow, my-strategies) reports >=1 executed non-skipped case; (c) the three 'Acquire shared-test-db mutex' steps run in situ (background psql survives step boundaries; release step fires); (d) the unseeded job's NEXT_PUBLIC_ALLOWED_ORIGINS line works in production mode (no 'Origin not allowed' reds); (e) test_defer_compute_job_token_fence / _null_token_backcompat execute for the first time (they skip locally without TEST env)"
    expected: "frontend red on the planted failure and green after revert with sql-tests=skipped tolerated only on fork/dispatch; every wired spec >=1 executed case; acquire steps log ACQUIRED and jobs complete; fencing tests green in CI"
    why_human: "GitHub-side behavior (expression substitution, background-process survival on the runner image, prebuilt-artifact production mode) is only observable on a real CI run of the phase PR — the plans tagged these `verification: backstop` and deferred them to PR time; not runnable from this tree"
    result: "PASSED 2026-08-21 — see 158-UAT.md item 1. (a) both polarities: PR #697 run 32424762495 all-green; drill PR #698 run 32426772489 sql-tests FAILED on planted assertion and frontend concluded FAILURE with sql-tests=failure in the loop output. (b) CI dot reporter cannot attribute per-spec, so each wired spec was executed individually at HEAD under its batch env: 3/4/4/2/1 executed cases, zero failures. (c) all three acquire steps ran; e2e-seeded waited 75s behind python then acquired (real contention). (d) unseeded job green incl. the repaired specs (403-without-origin arm exercised locally under the exact CI env). (e) fencing tests executed in the python job (~30 cases)."
  - test: "Post-merge mutex drill: `gh workflow run mutex-probe.yml` ×3 back-to-back; poll all three to conclusion (assert the literal string `success`, never 'not failure'); pull per-run job timings via `gh api …/actions/runs/<id>/jobs` and confirm the locked windows do not overlap"
    expected: "All three dispatched runs conclude `success` with pairwise non-overlapping lock windows — THREE runs, not two (the eviction needed exactly three)"
    why_human: "workflow_dispatch only exists for workflows on the default branch — inert until the phase PR merges (recorded backstop truth, 158-01)"
    result: "PASSED 2026-08-21 — see 158-UAT.md item 2. Three sequential dispatches on ci-probe/mutex-drill (CR-01 ref gate): runs 32448377859/32448628304/32448874335 all literal `success`, plus push-run 32448078841. assert-serialization windows abut exactly (sample: 1787287921–966–011–056, 45s holds, zero overlap). Probe branch deleted."
  - test: "Post-merge watcher drill: `gh workflow run main-ci-cancelled-watcher.yml -f run_id=31273384829 -f attempt=1` twice; then `gh issue list --label main-ci-cancelled --state open`; close the issue afterward (closing re-arms dedup). Do NOT omit `-f attempt=1` — the run's current conclusion is `success`, so a bare run_id is a clean no-op indistinguishable from a broken watcher"
    expected: "First dispatch CREATES one issue labeled main-ci-cancelled; second dispatch COMMENTS on it (no duplicate); both watcher runs conclude the literal `success`"
    why_human: "workflow_run/workflow_dispatch activate only from the default branch (recorded backstop truth, 158-02); the predicate was unit-exercised against real API payloads but the live issues.create → createComment transition has never run"
    result: "PASSED 2026-08-21 — see 158-UAT.md item 3. Runs 32448117561/32448154607 both literal `success`; first CREATED dedup issue #699, second COMMENTED (no duplicate); #699 closed afterward (dedup re-armed)."
  - test: "FIFO arrival-order observation (RESEARCH A1, low priority): during the post-merge probe drill, compare acquisition order against contender start order in the assert-serialization log"
    expected: "Waiters granted roughly in arrival order — logged observation only; the probe deliberately does NOT hard-assert this"
    why_human: "Recorded backstop truth (158-01) with honestly-unproven status: the GREEN run's arrivals shared one barrier second, so order was unresolvable. Mutual exclusion (the property the design depends on) IS proven; fairness is not. Abstained rather than silently passed"
    result: "RECORDED 2026-08-21 — see 158-UAT.md item 4. Run 32448377859: arrival [1,2,3] vs acquisition [1,3,2] — NOT arrival-ordered; fairness disclaim confirmed live. Mutual exclusion held (zero overlap). Observation only."
---

# Phase 158: OPS-CI — A merge means a deploy — Verification Report

**Phase Goal:** A merged PR always produces an honestly-reported CI verdict and a deployed analytics service — main CI can no longer conclude `cancelled` and silently skip the Railway deploy, no gate is present-but-ungating, and the two known deterministic false-reds are gone
**Verified:** in-tree 2026-08-20T23:59Z at HEAD `4ecd2c01`; backstops discharged 2026-08-21T05:05Z on `feat/v1.20-phase-158` (merge-base with main: `35c74149`)
**Status:** passed — all in-tree must-haves verified 2026-08-20; the 4 `verification: backstop` truths discharged 2026-08-21 by live measurement (PR #697 run + drill PR #698 red-polarity + post-merge probe ×3 + watcher ×2), evidence in 158-UAT.md
**Re-verification:** Yes — backstop items re-measured live post-merge (2026-08-21); in-tree verification unchanged from 2026-08-20

Verification was performed against the tree at HEAD, which includes the 3-iteration review fix loop (24 findings, final review `status: clean`), the credential scrub, and the e2e fail-closed env fix — NOT against the stale SUMMARY snapshots. Where review fixes superseded plan literals (mutex sizing 60→90 min TTL), the superseding value was verified instead and is noted.

## Goal Achievement

### Observable Truths

| # | Truth (roadmap SC + plan backstops) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC-1 mechanism: three simultaneous DB-touching contenders serialize through an external FIFO mutex with TTL/steal + manual-unlock runbook; the evicting group is gone | ✓ VERIFIED | 0 non-comment `group: shared-test-db` mappings in ci.yml; `pg_advisory_lock(61616158)` ×3 + `PGAPPNAME=ci-shared-test-db-mutex` ×3; sizing cap 3600 < TTL `timeout-minutes: 90` ×3 < `pg_sleep(6000)` ×3 (review-fix WR-04/CR-04 resized from the plan's 60 — recorded, coherent); probe both polarities confirmed LIVE via GitHub API this session: run 32390070135 `success` (same-key, zero overlap), run 32389730596 `failure` (distinct-key neuter) — the assertion can fail; `git ls-remote origin 'refs/heads/ci-probe/*'` empty; runbook `docs/runbooks/shared-test-db-mutex.md` (pg_terminate_backend ×2, key ×4, `granted` holder-vs-waiter cross-check ×7) indexed in README; regression pins `critical-regressions.test.ts` 143/143 green run BY THE VERIFIER under Node 22 (asserts acquire step per job, timeout-minutes 90, group never reappears) |
| 2 | SC-1 detection: a `cancelled` main-run conclusion raises a loud dedup'd issue; the watcher can never red main HEAD | ✓ VERIFIED (in-tree) | `main-ci-cancelled-watcher.yml` parses; `on:` = workflow_run(["CI"], completed, main) + workflow_dispatch(run_id, attempt); permissions exactly `{contents: read, issues: write}`, no `actions: write`; zero `exit [1-9]`/`setFailed`/`core.error` paths; `persist-credentials: false`; label `main-ci-cancelled` exists on the repo (gh label list). Live create→comment transition = backstop → human item 3 |
| 3 | SC-2: failing `sql-tests` blocks the `frontend` aggregator; skip tolerated only on fork PR / workflow_dispatch | ✓ VERIFIED (structural) | `sql-tests` present in the frontend `needs:` list (ci.yml:61 region) AND the result loop (`sql-tests=${{ needs.sql-tests.result }}` at :822) AND a dedicated tolerance arm (:868-880) with `is_fork_pr`/`is_dispatch`, `fail=1` + `::error` on trusted-event skip; `if: always()` kept; the only `needs:` diff vs main is the sanctioned `+ - sql-tests` under frontend. Live both-polarity proof on the PR = backstop → human item 1a |
| 4 | SC-3: orphaned e2e specs (incl. NAV-01) execute in a CI batch; DB-types drift has an explicitly recorded no-gate decision | ✓ VERIFIED (in-tree) | Each of the 5 specs appears EXACTLY once: api-key-flow + sync-analytics-flow on the unseeded invocation (:1929), full-flow + csv-upload-flow + my-strategies in the seeded list (:2548-2550); `NEXT_PUBLIC_ALLOWED_ORIGINS` ×3 (unseeded + pre-existing seeded precedent); `e2e/my-strategies.spec.ts` (164 lines): HAS_SEED_ENV ×5, seedTestAllocator ×4, `a[href="/my-strategies"]` ×2, zero heading-text selectors; zero bare `test.skip(true)` across the four repaired specs; full-flow carries the dated skipped-by-design decision (:105); TODOS.md `[158-OPS-03]` ×18 (≥16); `158-DB-TYPES-DECISION.md` complete (migration 20260621120000, database.types.test.ts compensating control, revisit trigger). Per-spec ≥1-executed-case on the PR = the plan's own backstop (WINDOWS.md unrun-verify) → human item 1b |
| 5 | SC-4: TEST stale-`pending` backlog drained TEST-only, closed on measured counts; both fencing UPDATEs stamp `claimed_at` | ✓ VERIFIED | Stamps at `test_compute_jobs_fencing.py:1160` and `:1216` (`datetime.now(timezone.utc).isoformat()`, current-time not backdated); whole-class audit recorded (no third instance); drain interlocks OBSERVED REFUSING LIVE by the verifier this session (PROD-ref → exit 3 before any network call; missing DRAIN_CONFIRM_TEST → exit 3); zero `delete(` / zero `cron.` in source; `failed_final` (schema-correct, not the plan's invalid `failed`); evidence artifact carries REAL measured tables (2026-08-20 17:22–17:34Z: BEFORE stale set 0, 0 terminalized, idempotent second run 0, MODE 2 measured + flip deferral recorded in TODOS) — closure on measurement, with the PR #674 correction paragraph present |
| 6 | SC-5: `MultiKeyConnectStep` passes under any test ordering; root cause closed on mechanism, not retried away | ✓ VERIFIED | 158-OPS11-EVIDENCE.md: 15-run sweep (26 `sequence.seed=` lines, 7 Node-22 references), 0 reproductions incl. both exact CI shards; both 140.5 fences re-proven falsifiable at HEAD (neuter→RED→restore, independent assertions); zero code changed; no retry/reorder-shaped diff (grep clean); both target specs 80/80 green run BY THE VERIFIER under Node 22 this session. Plan's must_have explicitly sanctions mechanism closure backed by sweep evidence — that is what shipped |
| 7 | Backstop (158-01): FIFO arrival-order fairness (RESEARCH A1) | ✓ RECORDED (live observation 2026-08-21) | Pre-merge GREEN run's arrivals shared one barrier second (unresolvable); post-merge run 32448377859 resolved it: arrival [1,2,3] vs acquisition [1,3,2] — NOT arrival-ordered, fairness disclaim confirmed live; mutual exclusion held (windows abut, zero overlap). Observation only — nothing depends on fairness. → 158-UAT.md item 4 |
| 8 | Backstop (158-01/158-02): live both-polarity aggregator proof + watcher create→comment dispatch | ✓ VERIFIED (live 2026-08-21) | Discharged live: green polarity = PR #697 run 32424762495 (all 21 checks); red polarity = drill PR #698 run 32426772489 (planted sql-tests failure → frontend FAILURE with `sql-tests=failure` in the loop output); watcher runs 32448117561/32448154607 → issue #699 created then commented, closed after. → 158-UAT.md items 1, 3 |
| 9 | Backstop (158-06): every newly wired spec reports ≥1 executed case in its batch on the phase PR | ✓ VERIFIED (measured at HEAD 2026-08-21) | PR #697's batches green with the wired specs present; CI's dot reporter cannot attribute per-spec, so each spec was executed individually at HEAD under its batch env: api-key-flow 3/12, sync-analytics-flow 4/18, full-flow 4/10, csv-upload-flow 2/4, my-strategies 1/1 executed — zero failures, skips are correct env-gated CI mirrors. → 158-UAT.md item 1(b) |

**Score:** 9/9 truths verified (truths 1-6 verified in-tree 2026-08-20; rows 7-9 — the plan-tagged `verification: backstop` truths — discharged by live measurement 2026-08-21: PR #697 run, drill PR #698 red polarity, post-merge probe ×3 + watcher ×2; evidence in 158-UAT.md)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `.github/workflows/mutex-probe.yml` | 3-contender serialization proof, in-tree drill | ✓ VERIFIED | 17,941 bytes; key ×3; push trigger `ci-probe/**` only (never main); persist-credentials false; PGAPPNAME=ci-mutex-probe; barrier-equality anti-vacuity assertion |
| `.github/workflows/ci.yml` | Mutex adoption + aggregator gating + batch lists | ✓ VERIFIED | Parses (17 jobs); all counts above; three acquire blocks byte-identical (review SHA-256 check) |
| `.github/workflows/main-ci-cancelled-watcher.yml` | Cancelled-conclusion → dedup'd issue | ✓ VERIFIED | Parses; correct triggers/permissions; zero red-check paths |
| `docs/runbooks/shared-test-db-mutex.md` + README entry | Manual-unlock runbook | ✓ VERIFIED | All six sections; no credentialed DSN pattern; indexed under Incident response |
| `scripts/drain-test-compute-backlog.ts` | Guarded TEST-only drain | ✓ VERIFIED | 27,805 bytes; 5 interlocks (2 re-observed refusing live); terminalize-only |
| `analytics-service/tests/test_compute_jobs_fencing.py` | claimed_at stamps | ✓ VERIFIED | Lines 1160, 1216 |
| `e2e/my-strategies.spec.ts` | NAV-01 seeded spec | ✓ VERIFIED | Seeded contract complete; own-seed assertions; wired in the seeded batch |
| `e2e/{api-key,sync-analytics,full,csv-upload}-flow.spec.ts` | Repaired, reasoned skips | ✓ VERIFIED | Zero bare skips; dated decisions in-file; each wired exactly once |
| `158-OPS04-DRAIN-EVIDENCE.md` | Measured before/after | ✓ VERIFIED | Real tables + idempotency + #674 correction |
| `158-OPS11-EVIDENCE.md` | ≥10-seed sweep + closure | ✓ VERIFIED | 26 seed lines; mechanism-closure statement |
| `158-DB-TYPES-DECISION.md` | Recorded no-gate decision | ✓ VERIFIED | This IS the OPS-03 "explicitly recorded decision" arm — a deliverable, not a gap |
| `TODOS.md` `[158-OPS-03]` dispositions | ≥16 class-closure lines | ✓ VERIFIED | 18 tagged lines |
| Repo label `main-ci-cancelled` | Exists | ✓ VERIFIED | `gh label list` confirms |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| ci.yml (3 DB jobs) | TEST Postgres session mode | background psql, `pg_advisory_lock(61616158)` | ✓ WIRED | 3 identical acquire steps; session-mode reachability proven by the GREEN probe run on real runners |
| ci.yml frontend aggregator | sql-tests | needs entry + result-loop row + tolerance arm | ✓ WIRED | Both-places rule holds; actionlint needs-reference check (summary) + pin suite green |
| watcher | ci.yml workflow "CI" | `on: workflow_run, workflows: ["CI"]` | ✓ WIRED | Byte-match on the workflow name; branches [main], types [completed] |
| watcher | GitHub Issues | dedup'd github-script block, env-injected | ✓ WIRED | Zero `${{ }}` in script bodies; label exists |
| my-strategies.spec.ts | seed helpers + /my-strategies route | seedTestAllocator + href-scoped nav | ✓ WIRED | Patterns present; local seeded run + red neuter drill recorded in 158-05 |
| ci.yml seeded list | e2e/my-strategies.spec.ts | MA-8 both-halves | ✓ WIRED | List entry (:2550) + in-spec HAS_SEED_ENV; full-flow's env-not-gate divergence recorded in the MA-8 comment with a do-not-"fix" note |
| drain script | TEST compute_jobs | supabase-js service-role, interlock-before-import | ✓ WIRED | Executed for real 2026-08-20 (measured tables) |

### Behavioral Spot-Checks (run by the verifier this session)

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Regression pins (mutex step presence, TTL 90, group-never-reappears, C-0293 on the watcher) | `PATH=node@22 npx vitest run src/__tests__/critical-regressions.test.ts --no-file-parallelism` | 143/143 passed | ✓ PASS |
| OPS-11 targets green at HEAD | `npx vitest run MultiKeyConnectStep.test.tsx MultiKeyConnectStep.payload.test.ts` (Node 22) | 80/80 passed | ✓ PASS |
| Drain PROD-ref hard-reject before network | invoke with PROD-ref URL + confirm env | `REFUSED: target URL carries the PRODUCTION project ref`, exit 3 | ✓ PASS |
| Drain confirm-env interlock | invoke with TEST-ref URL, no DRAIN_CONFIRM_TEST | `REFUSED: DRAIN_CONFIRM_TEST=true is required`, exit 3 | ✓ PASS |
| Probe both-polarity conclusions are real | `gh api …/runs/{32390070135,32389730596}` | `success` / `failure` on `ci-probe/158-mutex` | ✓ PASS |
| Probe throwaway ref cleaned | `git ls-remote origin 'refs/heads/ci-probe/*'` | empty | ✓ PASS |
| Allowlist-blind secret scan over the phase range | `gitleaks git . --log-opts=35c74149..HEAD` (no `--config`) | 58 commits, no leaks found | ✓ PASS |
| Workflow YAML validity | PyYAML parse of ci.yml / probe / watcher | all parse (17 / 3 / 1 jobs) | ✓ PASS |

Not run deliberately: `pytest tests/test_compute_jobs_fencing.py` from the main checkout — the credentialed env here would execute the live-DB tests against shared TEST and mutate state (verification must not mutate). The stamps are grep-proven at HEAD; the plan run recorded 16 passed / 28 skipped; CI is the tests' first real execution (folded into human item 1e).

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventional probes exist or are declared by this phase. The phase's probe is `mutex-probe.yml` (a CI workflow): its two pre-adoption runs were verified live via the GitHub API above (RED neuter → GREEN same-key); the post-merge ×3 drill is human item 2.

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
| --- | --- | --- | --- |
| OPS-01 | 158-01, 158-02 | ✓ SATISFIED (mechanism + live drills passed 2026-08-21) | Eviction layer removed + probe-proven mutex + watcher + runbook; #616 CLOSED 2026-08-21 by PR #697's `Closes #616` |
| OPS-02 | 158-01 | ✓ SATISFIED (structural + live both-polarity proven) | needs + loop + tolerance arm; green #697 / red drill #698 |
| OPS-03 | 158-05, 158-06 | ✓ SATISFIED (in-tree + per-spec executed-case proven at HEAD) | 5 specs wired, 18 dispositions, DB-types decision artifact (the requirement's explicitly permitted arm) |
| OPS-04 | 158-03 | ✓ SATISFIED | Stamps + guarded drain + measured closure (BEFORE stale set 0 — honest no-op; #674 correction recorded) |
| OPS-11 | 158-04 | ✓ SATISFIED | Reproduction-first sweep, mechanism closure, no retry-shaped change |

No orphaned requirements: REQUIREMENTS.md maps exactly OPS-01..04 + OPS-11 to Phase 158; every ID appears in a plan's `requirements:` field.

### Decision Coverage (non-blocking)

158-CONTEXT.md records no user-gated decisions (autonomous infra phase); its binding constraints are all honored at HEAD: mutex+watcher fix shape ✓, group removed never shrunk ✓, no new needs edges ✓, TTL/steal + runbook shipped with adoption ✓, three-contender verification ✓ (probe matrix ×3), OPS-04 never-migration/never-unschedule ✓, OPS-11 not retried away ✓. The "#616 closed on MECHANISM" clause is discharged: PR #697 carried `Closes #616` and merged 2026-08-21 (issue closed).

### Test Quality Audit

| Concern | Finding |
| --- | --- |
| Disabled tests on requirements | All e2e skips carry reason strings (grep: zero bare `test.skip(true)`); csv-upload's 2 server-side skips are tracked (WINDOWS.md skipped-test + TODOS) — known-open by orchestrator direction, not a gap |
| Circular tests | None found; probe assertions use DB `clock_timestamp()` windows; oracle for the drain is row counts, not the tool's own claims |
| Vacuity controls | Every load-bearing gate was proven able to fail (probe neuter RED; my-strategies neuter drill; ci.yml pin key-divergence drill; TODOS tag-strip drill; detector falsification in 158-04) — the founder rule held throughout |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | none | — | Zero TBD/FIXME/XXX in any phase-modified code file; no stub/placeholder implementations |

### Human Verification Required

None remaining. The four backstop items (see frontmatter, each with a `result:` line) were discharged 2026-08-21 by live measurement — phase-PR run #697, drill PR #698 red polarity, post-merge probe ×3 and watcher ×2 dispatches. Full evidence: 158-UAT.md (4/4 passed).

### Known-open, deliberately tracked (NOT gaps)

Credential rotation (human action, TODOS + AR-158-3); SEC-02 `.planning/` credential sweep (Phase 163 scope); WR-06 promotion decision; auth.users leak convention; csv-upload-flow's 2 cases skipped until `ANALYTICS_SERVICE_URL` exists in CI; 15 remaining orphan specs (one-missing-convention root cause, dispositioned); DB-types no-gate decision (that IS the OPS-03 deliverable).

### Gaps Summary

No gaps. Every in-tree must-have is verified with evidence at HEAD, including live re-observation of the drain interlocks, the probe conclusions on GitHub, and two named test suites run by the verifier under CI-parity Node 22. The four plan-recorded backstop truths — abstained on 2026-08-20 per the honest-verifier contract — were discharged 2026-08-21 by the phase PR's live CI run and the post-merge dispatches, so the phase is honestly `passed` on measurement, not assertion.

---

_Verified: in-tree 2026-08-20T23:59Z; backstops discharged 2026-08-21T05:05Z_
_Verifier: Claude (gsd-verifier)_
