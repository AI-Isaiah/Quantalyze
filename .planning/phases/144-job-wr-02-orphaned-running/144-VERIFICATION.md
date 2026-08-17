---
phase: 144-job-wr-02-orphaned-running
verified: 2026-08-17T18:05:00Z
status: gaps_found
score: 8/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The sql-tests CI gate went RED on the rewritten Part 1 pre-apply and GREEN post-apply — the designed TDD RED, observed with run URLs (144-03-PLAN must_haves truth #2)"
    status: failed
    reason: "The branch feat/v1.19-phase-144 has NEVER been pushed (git ls-remote origin feat/v1.19-phase-144 is empty) and no CI run contains any 144 commit (git merge-base --is-ancestor 009710d7 origin/feat/v1.19-job-rate → NOT in; the only v1.19 run, d773192cc at 11:40 UTC, predates the 14:41 UTC migration commit). No run URL exists or can exist. The pre-apply RED moment in CI is now UNRECOVERABLE as specified — the migration is already applied to TEST, so a CI run today can only show GREEN. Neither the rewritten SQL gate, the new TS gate, nor the migration-policy workflows have ever executed in CI at any 144 HEAD."
    artifacts:
      - path: "supabase/tests/test_retention_orphaned_running.sql"
        issue: "Never run in CI against live TEST post-apply. Green is asserted via (a) STEP 2 self-verify passing inside the MCP apply transaction (8944d269 commit message) and (b) throwaway-harness runs — both real evidence, but neither is the CI execution path the plan required"
      - path: "src/__tests__/retention-orphaned-running-terminalize.test.ts"
        issue: "Green locally at HEAD (re-run by verifier: 10/10 pass, 1.1s) but never in a CI shard"
    missing:
      - "Push the branch / open the PR and record the sql-tests + frontend (vitest shards incl. the new TS gate) + Migration Policy run URLs green at a HEAD containing all 144 commits, BEFORE the one-way merge"
      - "Record in 144-CENSUS.md (or the PR) that the pre-apply CI RED is substituted by neuter-8's offline RED (gate vs migration-absent DB, psql exit non-zero, 144-01-SUMMARY) — an honest substitution note, since the specified observation can no longer be made"
deferred: []
human_verification:
  - test: "The blocking human gate (144-03 must_haves truth #6): review the evidence bundle — 144-CENSUS.md §§5–7 (arm B 6/6 with forensics preserved; tick-1 zero as the SC#2 negative control at real scale; bound HOLDS at exactly 100 with the pre-committed md5 caf7fb80 matching byte-for-byte; bound PROGRESSES resuming at the microsecond tie 12:05:29.794561; conservation 402/402/402 across three ticks) — and approve BEFORE merge"
    expected: "Founder/operator approval recorded; merge is the one-way door that auto-applies 20260817120000 to PROD"
    why_human: "Merge-to-PROD authorization is deliberately reserved to a human by the plan; no automated check can grant it"
  - test: "After push/PR: confirm CI green at the 144 HEAD — sql-tests (the rewritten gate's live-TEST GREEN half), both vitest shard groups, Migration Policy / Drift gates"
    expected: "All green with run URLs; this simultaneously closes the recorded gap"
    why_human: "Requires pushing the branch — a remote write the read-only verifier must not perform"
  - test: "Post-merge PROD observation: SELECT jobid, jobname, schedule FROM cron.job on PROD — jobname retention_compute_jobs_orphaned_running present at '50 * * * *' (jobid will move OFF 29; match on JOBNAME per the corrected header) — then confirm the first :50 tick succeeds and moves ZERO rows"
    expected: "A quiet PROD tick (census: running=0, pending=0). Zero movement is the designed safe outcome and produces no positive evidence — do not read it as proof of function (CENSUS §1 states this correctly)"
    why_human: "PROD DB access is orchestrator/human-only; also a post-merge event outside this phase's commits"
  - test: "Observation-only (not a merge gate, per plan): TEST residual drains 196 → ~96 → 0 on subsequent :50 ticks; the 2819 stale-pending TEST backlog remains (deferral D-13) and continues to redden the 05:30 python shard until the CI-hygiene TODO is actioned"
    expected: "Backlog drains at ≤100/arm/tick; conservation holds (nothing vanishes)"
    why_human: "Requires live TEST queries over future wall-clock ticks"
---

# Phase 144: WR-02 orphaned-running DELETE→terminal UPDATE Verification Report

**Phase Goal:** An orphaned `running` compute job terminates VISIBLY — pollers break out, the audit trail survives — resolving the founder's open WR-02 DELETE-vs-reset call. (Requirements JOB-05, JOB-08.)
**Verified:** 2026-08-17, at HEAD `b089f4a9` on `feat/v1.19-phase-144`
**Status:** gaps_found — the goal's SUBSTANCE is achieved with unusually strong live evidence; ONE plan-level must-have (CI RED→GREEN with run URLs) is factually unmet because the branch was never pushed, and it is a pre-merge safety item on a PROD-auto-apply migration.
**Re-verification:** No — initial verification.

## Verdict per Success Criterion

### SC#1 — terminal UPDATE not DELETE; poller breaks out; audit survives — **ACHIEVED**

| Sub-claim | Evidence | Status |
|---|---|---|
| Body terminalizes, never removes | Migration `20260817120000` lines 615–639: two `WITH batch AS MATERIALIZED … UPDATE … SET status='failed_final'` arms; the only `DELETE` occurrences in the file are prose/negative-gate (`:808` is the ILIKE *rejection* of DELETE). STEP 2 self-verify (`:829`) asserts "no removal statement" against the body READ BACK from `cron.job` | ✓ VERIFIED |
| Poller breaks out | `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:207-210` at HEAD: `FINISHED_JOB_STATUSES = ["done", "failed_final"]`; both `isJobInFlight` (`:212`) and the evidence-positive `jobsHaveFinished` (`:238`) key on it. `failed_final` is also the ONLY terminal-failure value outside Phase 142's reaper exclusion set (`20260803130000:118-121`), so terminalizing UNBLOCKS the user-facing analytics failure message — asserted in gate text (`test_retention_orphaned_running.sql:263`) | ✓ VERIFIED |
| Audit survives — B3 | `next_attempt_at = now()` in BOTH SET lists (migration `:620`, `:639`); the 90-day retention key verified at source: `20260515210200:255-258` DELETEs `failed_final/failed_retry` on `COALESCE(next_attempt_at, created_at) < now() - 90 days` — so B3 restarts the clock and the audit record lasts ~90 days, not ~11 hours. Pinned three ways: migration STEP 2, SQL gate `:269` (count=2 + century-backdated behavioural seed), TS gate N5 neuter RED | ✓ VERIFIED |
| Live proof (TEST scope) | CENSUS §5: arm B moved exactly 6/6, arm attribution 6/6, B3 advanced 6/6, `claim_token` PRESERVED 6/6 (forensics), `error_kind='permanent'` 6/6; CONSERVATION **402 = 402** rows exist after ticks 1, 2 AND 3 (§5/§6/§7) — zero rows vanished across three real ticks. This is behavioral evidence on real data, not symbol presence | ✓ VERIFIED |

### SC#2 — 4h threshold UNCHANGED, cadence hourly, live jobs protected — **ACHIEVED**

| Sub-claim | Evidence | Status |
|---|---|---|
| 4h threshold unchanged | `interval '4 hours'` occurs exactly ONCE in the migration (arm A body, `:614` region); STEP 2 asserts it against the deployed body; SQL gate `:288` asserts count exactly 1 with the RT-01 rationale; TS gate `WINDOW_ARM_A` + N10 neuter (arm B importing 4h) observed RED. The 2h regression is a named NEGATIVE anchor (probe P7) | ✓ VERIFIED |
| Cadence hourly at :50 | Registration `'50 * * * *'` (migration `:604`); string-equality assertions in STEP 2 (`:698`) and SQL gate (`:237`) — B2's `::INT` cast is GONE (`grep -c '::INT'` and `split_part` on the gate both 0); TS gate asserts the literal ADJACENT to the `cron.schedule` call (N6 RED with the two prose copies intact). Live slot check on BOTH projects: `:50` free (CENSUS §4). Ticks observed at 15:50 / 16:50 / 17:50 | ✓ VERIFIED |
| Batch-tail protection — the negative control | CENSUS §5 tick 1: 396 rows claimed at 12:05 (3h47m old at tick time) — arm A moved **ZERO**. An unplanned negative control of exactly the property SC#2 names, on real rows at real scale with a real clock; stronger than the seeded RT-01 negative. The zero is meaningful precisely because the same rows WERE moved (100+100) once past 4h at ticks 2–3 | ✓ VERIFIED |

### SC#3 — ONE new migration; shipped migrations untouched; one behavior — **ACHIEVED**

- `git diff main...HEAD --name-only -- supabase/migrations/` returns exactly ONE file: `20260817120000_retention_orphaned_running_terminalize.sql`. `20260720120000` and `20260719120000` appear in no branch commit. ✓
- The migration re-registers the EXISTING jobname; TEST already runs the new body (byte-matched, `cron.job.command` md5 `4432bc62…` == repo dollar-tag span, commit 8944d269); PROD receives the identical body on merge via auto-apply — one behavior, both environments, by the single artifact. ✓
- The post-Wave-1 edit to the migration (8944d269, +32/−9) was verified COMMENT-ONLY (filtered diff of non-`--` lines is empty), so Plan 02's "byte-identical body" claim and the TS gate's pinned counts still hold — confirmed by re-running the TS gate at HEAD: **10/10 pass**. ✓

### SC#4 — stale-`pending` decided on measurement; WON'T-FIX carrying it — **ACHIEVED**

- REQUIREMENTS.md JOB-08 resolution block present (`:59-98`): dated WON'T-FIX, the census table VERBATIM (PROD pending **0** / TEST 2819; running 402 with the 6→402 correction noted inline), the structural argument ("nothing sweeps pending, so zero means zero have EVER stranded" — the load-bearing part, not the snapshot), both ⛔ traps restated, and the dated-claim discipline clause with the falsification condition. ✓
- The pre-merge RE-census demanded by that block WAS run: CENSUS §1, 2026-08-17, PROD `pending` = 0 and `running` = 0 (both statuses absent from the table entirely). Kill criterion NOT triggered; the WON'T-FIX rests on a fresh measurement, not the discuss-phase number. ✓
- TODOS.md "Phase 144 — recorded deferrals (logged 2026-08-17)": exactly **3** checkbox items verified — (D-13) TEST stale-pending as CI hygiene, (RESEARCH §6) chain-mid residual this phase creates, (D-09) fixture hygiene in `test_compute_jobs_fencing.py` (file confirmed untouched: 0 branch commits). ✓
- JOB-05/JOB-08 checkboxes deliberately NOT flipped (`- [ ]` at REQUIREMENTS `:55`, `:57`) — per Plan 02's decision, ticking is owned by phase verification/orchestrator. Orchestrator should flip on close.

## Gates (B1/B2/B3 + neuter matrices)

| Check | Evidence | Status |
|---|---|---|
| B1 — SQL gate rewritten in the SAME commit as the migration | `git show --stat 009710d7`: exactly 3 files — migration (814 lines), `test_retention_orphaned_running.sql` (802 changed lines), harness. One commit. | ✓ VERIFIED |
| B2 — no `::INT` hour-band cast | `grep -c '::INT'` = 0, `grep -c 'split_part'` = 0 on the gate; schedule compared by `IS DISTINCT FROM '50 * * * *'` (`:237`) | ✓ VERIFIED |
| B3 — next_attempt_at in both SET lists + retention interaction | See SC#1 table; retention body verified at its own source | ✓ VERIFIED |
| SQL gate genuinely ungated | `:207-211`: absent pg_cron → EXCEPTION, "deliberately an EXCEPTION and not a skip"; conservation runs FIRST after EXECUTE (`:489-501`) — the vacuity found and fixed in its own commit `734944f1` (exists, message names it) | ✓ VERIFIED |
| Word-bounded LIMIT in TWO halves | SQL gate `:333` pattern + `:337` regexp_matches count=2; TS gate `boundedLimits === 2` AND `allLimits === boundedLimits` (`:444-464`) — the P8/Control-A finding (one-arm widening passes both weaker forms) carried into both languages | ✓ VERIFIED |
| TS gate: 10 tests, recalibrated counts | 669 lines; counts 4/4/2/2/2/2/2/2 + 1/1 windows + 6 negatives + anti-vacuity guard + later-migration re-registration scan (FIX_TS constants `:72-74`). **Re-run by verifier at HEAD: 10/10 green, 1.1s** | ✓ VERIFIED |
| Neuter matrices (8 SQL + supplements, 14 TS) with observed REDs | Recorded VERBATIM in both SUMMARYs including the two control measurements and the honest "could-NOT-be-redden" list (arm C dominated; whole-block catch-all; two structurally-unexercisable catalog checks). NOT independently re-observed by this verifier (would require the throwaway cluster); accepted as documented evidence — the verbatim failure text, the S2 stays-green honesty, and the 734944f1 vacuity commit are the marks of real runs, not narration | ✓ (documented) |

## The falsified-claims ledger — did every correction land at every site?

| Correction | Sites claimed | Repo-wide grep result | Status |
|---|---|---|---|
| Census 6 → 402 | CONTEXT, RESEARCH, REQUIREMENTS | CONTEXT `:40` ⚠️-corrected; RESEARCH `:402`, `:652`, `:670` all carry the correction inline; REQUIREMENTS JOB-08 census row carries it; commit `309095e1` did the initial correction. No uncorrected "running = 6" found | ✓ COMPLETE |
| jobid-continuity ("keeps its deployed jobid") | Migration header (×2), ROADMAP, REQUIREMENTS — commit 8944d269 says "corrected … at every site it reached" | ROADMAP `:126` ✓ and REQUIREMENTS `:57` ✓ (diff of 8944d269 confirms both). **BUT two survivor sites the correction missed:** `144-PATTERNS.md:61` ("Keeping the name is what makes test_retention_orphaned_running.sql **and the deployed jobid continuous**") and `144-01-SUMMARY.md:48` (key-decisions: "so **the deployed jobid** and this SQL gate stay continuous") | ⚠️ INCOMPLETE — see Warnings |
| Arm-A-targets claim (396 "live targets" at apply time) | Struck in CENSUS §2, mechanism in §5 | Struck in place, not rewritten — instructive-error convention honored. The LIMIT-100 rationale explicitly re-based on the plan-check derivation (`§2`: "survives on the derivation that replaced it"), and 144-01-SUMMARY's "100 sits deliberately below 396" remains numerically true and the observation DID occur (one tick late, §6–§7). No stale copy asserting arm-A-qualification-at-apply-time found elsewhere | ✓ HANDLED |

## Anti-pattern scan

Files modified this phase (migration, SQL gate, TS gate, harness, REQUIREMENTS/TODOS hunks): zero unreferenced `TBD`/`FIXME`/`XXX`; zero stub returns; the `DELETE`/`failed_retry`/`claimed_by`/`enqueue_compute_job` tokens present only as negative anchors or prose. No debt-marker blockers.

## Asserted but NOT demonstrated — named plainly

1. **🛑 CI RED→GREEN with run URLs (the recorded gap).** The branch was never pushed; no CI run anywhere contains commit `009710d7` or later. The rewritten SQL gate, the new TS gate, and the migration-policy workflows have NEVER executed in CI at a 144 HEAD. The pre-apply RED half is now unobservable in CI (migration already on TEST); its honest substitutes on record are neuter-8's offline RED and the STEP-2-inside-apply pass. The GREEN half is still fully observable — push, then record run URLs before merge. Until then, "would have caught" applies to every gate this phase built.
2. **⚠️ The §3 confirming query as SPECIFIED was not shown.** Plan 02's notes owed Plan 03 the exact RESEARCH-§3 confirming query (`claim_token` non-null, `exchange='okx'`, `priority='normal'`, `claimed_by` NULL, strategies named `p97-fence-test-%`). CENSUS §3 contains none of those columns (no exchange, no priority, no strategy-name match). The verdict ("test-fixture residue, CONFIRMED") instead rests on a different — arguably stronger — evidence set: 45–276 ms create→update lifetimes (17–100× faster than the fastest real row), `next_attempt_at == created_at` to the microsecond, PROD holding zero rows of the shape, no in-repo writer, plus a control that DISPROVED the verifier's own `api_key_id` discriminator. The kill criterion (undiagnosed production writer) is reasonably excluded; the substance of the truth holds, but the promised query is unfulfilled and the fixture attribution is inference-by-shape, not a name-match. Counted VERIFIED with this caveat.
3. **ℹ️ No 144-03-SUMMARY.md exists.** Plan 03's evidence lives in 144-CENSUS.md plus five orchestrator commits — acceptable for an orchestrator-session BLOCKING plan, but ROADMAP's three plan checkboxes and the JOB-05/JOB-08 requirement checkboxes remain unticked; the orchestrator owns flipping them at close.
4. **ℹ️ PROD-scope evidence is structurally absent, and the artifacts say so.** PROD running=0 ⇒ the first PROD tick terminalizes nothing and "a quiet PROD is not proof" (CENSUS §1, verbatim). Proof of function is TEST-scope (live 402-row fixture) + the executed SQL gate + the offline harness. Correctly disclosed; no overclaim found.
5. **ℹ️ Residual 196 TEST rows still `running`** — drain on later ticks, explicitly NOT a merge gate (plan and CENSUS §7 agree).

## Warnings (non-blocking, per the blast-radius stopping rule)

- **W-144-1:** The falsified jobid-continuity claim survives at `144-PATTERNS.md:61` and `144-01-SUMMARY.md:48` (key-decisions). The 8944d269 correction named "every site it reached" but the grep says otherwise — the exact one-file-amendment class the project's own rule warns about. Planning-doc prose only (not user-facing, not data-integrity): fix in the close commit or log to TODOS; do not block on it.

## Human Verification Required

See frontmatter `human_verification` — four items: (1) the blocking evidence-bundle approval before the one-way merge, (2) CI green at the 144 HEAD after push (closes the gap), (3) post-merge PROD jobname/tick observation with the quiet-tick caveat, (4) observation-only TEST drain.

## Gaps Summary

The engineering goal of Phase 144 is achieved and exceptionally well-evidenced at TEST scope: the two-arm bounded terminalizer is deployed and byte-matched on TEST, three real ticks demonstrated arm-B positive, an unplanned real-scale SC#2 negative control, the bound holding at exactly 100 against a pre-committed set prediction, deterministic progression across a microsecond tie, and 402/402 conservation — while the frontend poller constant, the 90-day retention interaction, and all three sibling gates are verified at HEAD. The single gap is procedural but real on a PROD-auto-apply migration: **no CI run has ever executed this phase's gates** (branch never pushed), so Plan 03's "RED→GREEN observed with run URLs" must-have is unmet and merging now would send a migration to PROD from a branch CI has never seen. Remediation is the standard next step anyway — push, observe green, record URLs, then take the human gate.

---

_Verified: 2026-08-17T18:05:00Z_
_Verifier: Claude (gsd-verifier), read-only at HEAD b089f4a9_
