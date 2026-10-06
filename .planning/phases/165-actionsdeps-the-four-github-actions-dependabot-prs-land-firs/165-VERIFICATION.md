---
phase: 165-actionsdeps
verified: 2026-10-06T12:14:51Z
status: passed
score: 2/2 criteria met (C1 in substance, with recorded deviations; C2 met)
verified_at_sha: 12eb8479ba4cb141298bdb640a0f29d21c3fba04
drift_subjects:
  - .github/workflows/analytics-deploy-verify.yml
  - .github/workflows/cassette-refresh.yml
  - .github/workflows/ci.yml
  - .github/workflows/contracts.yml
  - .github/workflows/main-ci-cancelled-watcher.yml
  - .github/workflows/migration-drift-check.yml
  - .github/workflows/migration-policy-self-test.yml
  - .github/workflows/migration-policy.yml
  - .github/workflows/mutex-probe.yml
  - .github/workflows/nightly.yml
  - .github/workflows/phase-19-stability.yml
  - .github/workflows/prod-prober.yml
  - .github/workflows/sql-function-snapshot.yml
  - .github/workflows/supabase-migrate.yml
  - .github/workflows/test-restore-from-baseline.yml
founder_decision: "2026-10-06 via AskUserQuestion, 'Pass 165/165.1 now, 165.2 after nightly': pass 165 and 165.1 now with their deviations recorded; 165.2 stays open."
supersedes: "The 2026-09-27 retirement ('Land as maintenance, retire the phases'), which closed 165 WITHOUT delivery. The PRs then landed as maintenance, and this report measures that they meet the phase's criteria."
---

# Phase 165: ACTIONSDEPS Verification Report

**Phase goal:** The four GitHub Actions dependabot PRs (#643, #627, #626, #612) are RESOLVED, landed
or deliberately closed, one at a time in the research-verified order with the full suite green
between each.
**Verified:** 2026-10-06 at `12eb8479b` (origin/main). This is a bookkeeping close: the phase had no
plans. Its PRs landed as maintenance after the 2026-09-27 retirement, and the founder decided on
2026-10-06 to pass it on that record.
**Status:** passed

## Per-criterion results

Every PR state, merge SHA and run conclusion below was re-read with `gh pr view` / `gh run view`
on 2026-10-06.

| # | Criterion (ROADMAP, this phase's slice) | Verdict | Evidence |
|---|---|---|---|
| 1 | PRs land one at a time in the verified order: #643, then #627 and #626, then #612 alone (validated on `migration-drift-check.yml`, `supabase` 2.98.2). Every merge must assert `conclusion == "success"`. | MET in substance, with deviations | #643 was CLOSED 2026-10-01 with the comment "Superseded by #916 (merged as c110555e), which carries this update". #916 merged as `c110555e`; push CI `36920076462` concluded `success`. #627 merged as `91f4239a` on 10-02 (CI `37058017079` `success`). #626 merged as `025499e2` on 10-03 10:03Z (CI `37115117611` `success`). #612 merged alone as `8b93c9e9` on 10-03 10:24Z (CI `37116307820` `success`). On #612's head `5a6f6033`, Migration Drift Check run `37115280445` concluded `success`, and its log carries `version: 2.98.2` as the setup-cli input. |
| 2 | This phase's own PRs are each landed or closed with a reason, and no Railway deploy was silently skipped (the Phase-158 watcher observed quiet or loud, never grey). | MET | #643: closed with a reason, superseded by #916. #627, #626 and #612: merged. `gh run list --created '>=2026-10-01'`: `analytics-deploy-verify.yml` had 17 runs and all 17 concluded `success`. `main-ci-cancelled-watcher.yml` had 63 runs and all 63 concluded `success`; the 2026-10-06 brief read 60, and the 3 extra are later runs. |

## Deviations (recorded, accepted by the founder 2026-10-06)

1. **#643 did not land as its own PR.** Its change, `actions/checkout` 7.0.1, rode inside batch PR
   #916, which was also the npm minor/patch group. So npm group work reached `main` (10-01) before
   the rest of the actions slice. The verified order puts npm last.
2. **The pip group overtook the end of the actions slice.** #898 (pip, Phase 165.1) merged
   2026-10-02 19:08Z. That is before #627 (10-02 20:02Z), #626 and #612 (10-03). The criterion's
   "actions first" ordering held within this phase's slice, but not across ecosystems. 165.1 records
   the same fact.
3. **"Full local suite between each" was not measured.** The evidence is the full CI suite on each
   merge push, asserted `success` above. A local-suite reading per merge does not exist.
4. **The `supabase` version reading is the setup-cli input** (`version: 2.98.2` in the
   drift-check log). It is not a `supabase --version` output line.

## Not in scope

The campaign's close criterion, zero open dependabot PRs and a green nightly audit, belongs to
Phase 165.2, which stays OPEN. DEPS-01 is satisfied only when 165.2 closes.

---

_Verified: 2026-10-06T12:14:51Z (bookkeeping close; GitHub reads only)_
