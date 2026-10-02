---
phase: 159-rank-public-ranking-integrity
plan: 02
subsystem: database
tags: [percentiles, ranking, postgres, security-definer, rls, closed-sets, vitest, supabase]

requires:
  - phase: 159-01
    provides: "159-CENSUS.md — the committed D-01 gate carrying real PROD counts, floor crossings and the per-strategy before/after snapshot"
  - phase: 42-PEER-03
    provides: "get_verified_cohort_rank SECURITY DEFINER RPC (migration 20260626120000) — the body this plan re-bases"
provides:
  - "isRankableAnalyticsRow + PERCENTILE_GATE_COLUMN in closed-sets.ts — the ONE shared published-percentile rank gate"
  - "getPercentiles and getOwnRowPercentiles both gated, with the <5 floors counting the gated cohort"
  - "get_verified_cohort_rank re-based with the computed-analytics gate in BOTH cohort predicates"
  - "test_get_verified_cohort_rank_gate.sql — the RPC's FIRST CI-executed test"
affects: [159-04, 159-05, 160-venue-provenance, ranking, discovery, my-strategies]

actuals:
  tokens: 15657   # chars/4 over the realized diff (62,628 chars, 7 files, +940/-18)
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Rank gate as a delegating helper in the MD-01 single-source module, never a local status predicate"
    - "Gate column composed ALONGSIDE a byte-frozen projection constant rather than appended to it"
    - "State-adaptive SQL test (Phase-156 precedent): SKIP loudly pre-migration, hard-fail on a missing function"
    - "Causal anti-vacuity arm: flip ONLY the gated column and assert the row then joins"

key-files:
  created:
    - supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql
    - supabase/tests/test_get_verified_cohort_rank_gate.sql
  modified:
    - src/lib/closed-sets.ts
    - src/lib/closed-sets.test.ts
    - src/lib/queries.ts
    - src/lib/queries.percentiles.test.ts
    - src/app/(dashboard)/my-strategies/page.test.tsx

key-decisions:
  - "Composed the gate column ONCE per function rather than duplicating the template literal in each of getPercentiles' two select branches — both branches interpolate the same local, so the gate cannot differ between the categorized and uncategorized reads"
  - "Put the getOwnRowPercentiles behavioural pins in queries.percentiles.test.ts: its only existing coverage (phase-149-my-strategies-parity.test.ts) is a SOURCE SCAN that never calls the function"
  - "Reworded a docblock instead of bumping the SI-01 allowlist — an allowlist of 2 for closed-sets.ts would permanently blind that guard to a real exact-match landing there later"
  - "Did NOT push the migration to TEST mid-phase (plan's schema-push gate); live verification is the apply-time DO block plus the first post-merge CI run"

patterns-established:
  - "Rank gate parity-by-construction: the SQL IN-list mirrors isComputedAnalytics member for member, asserted from both sides (closed-sets.test.ts and the new SQL gate)"
  - "Occurrence COUNT over presence check when a predicate must appear in two places (both cohort queries)"

requirements-completed: [RANK-01]

coverage:
  - id: D1
    description: "A failed/pending/computing analytics row neither receives a published percentile nor shifts any other strategy's, in getPercentiles"
    requirement: RANK-01
    verification:
      - kind: unit
        ref: "src/lib/queries.percentiles.test.ts#excludes a failed row that STILL holds KPI values, and lets it move no one"
        status: pass
      - kind: unit
        ref: "src/lib/queries.percentiles.test.ts#excludes pending, computing, null-status and absent-embed rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "complete_with_warnings is retained in the rank cohort and scored exactly like complete"
    requirement: RANK-01
    verification:
      - kind: unit
        ref: "src/lib/queries.percentiles.test.ts#scores a complete_with_warnings row exactly like a complete one"
        status: pass
      - kind: unit
        ref: "src/lib/closed-sets.test.ts#agrees with isComputedAnalytics on EVERY member of the status closed set"
        status: pass
    human_judgment: false
  - id: D3
    description: "The <5 floors count RANKABLE rows on BOTH TS callers (the honest denominator)"
    requirement: RANK-01
    verification:
      - kind: unit
        ref: "src/lib/queries.percentiles.test.ts#counts only RANKABLE rows against the <5 floor"
        status: pass
      - kind: unit
        ref: "src/lib/queries.percentiles.test.ts#applies the gated <5 floor exactly as getPercentiles does"
        status: pass
    human_judgment: false
  - id: D4
    description: "ONE shared helper serves both TS callers; no second status predicate exists; PERCENTILE_ANALYTICS_COLUMNS is byte-unchanged"
    requirement: RANK-01
    verification:
      - kind: other
        ref: "grep -c isRankableAnalyticsRow src/lib/queries.ts => 4 (import + both call sites + docblock); byte-freeze grep of the KPI string => 1 match, unchanged"
        status: pass
      - kind: unit
        ref: "src/lib/complete-status-scan.test.ts#scan of src/ matches the frozen allowlist"
        status: pass
    human_judgment: false
  - id: D5
    description: "get_verified_cohort_rank carries the computed-analytics gate in BOTH cohort predicates, with every prior guard preserved by a full-body re-base"
    requirement: RANK-01
    verification:
      - kind: other
        ref: "region read of both WHERE clauses + body diff vs 20260626120000 showing only the two predicate lines and prose"
        status: pass
    human_judgment: true
    rationale: "Structure is verified statically, but the migration has NEVER been APPLIED. Its self-verifying DO block (gate present twice, SECDEF, search_path, min-N, auth guard) and the new SQL gate both run for the first time only when the migration reaches a database. Until that first post-merge CI run the honest phrasing is 'would have caught', never 'did catch' — a human must confirm the apply succeeded."
  - id: D6
    description: "The RPC has its first CI-executed test, state-adaptive against a pre-migration database"
    verification:
      - kind: integration
        ref: "supabase/tests/test_get_verified_cohort_rank_gate.sql (auto-discovered by the ci.yml sql-tests glob; psql meta-command preflight run locally, clean)"
        status: unknown
    human_judgment: true
    rationale: "Never yet observed ARMED — the shared TEST project receives migration 20260821120000 only after merge, so on this PR the test takes its designed SKIP path. Its assertions are unproven until the first CI run after the migration lands."

duration: 34min
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 02: RANK-01 published-percentile rank gate Summary

**Failed/stale analytics rows are now outside published percentiles on BOTH engines — one delegating helper in `closed-sets.ts` wired into both TS callers, and a full-body re-base of `get_verified_cohort_rank` putting the same two-value gate in both cohort predicates, plus that RPC's first CI-executed test.**

## Performance

- **Duration:** 34 min
- **Started:** 2026-08-21T12:03:00Z
- **Completed:** 2026-08-21T12:36:51Z
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified) — +940 / -18

## Accomplishments

- **The defect, reproduced then closed.** The pre-fix RED was not abstract: in a 6-row fixture the two `failed` rows ranked at **percentile 83 and 100** — the top of the cohort — while carrying `computation_status='failed'`. That is the PROD fossil class 159-CENSUS.md measured (17 of 18 published strategies holding both `sharpe` and `cagr` on a failed row) in miniature.
- **One gate, both engines.** `isRankableAnalyticsRow` delegates to `isComputedAnalytics` rather than re-deriving status semantics, so `complete_with_warnings` — a terminal SUCCESS — stays ranked. The SQL `IN ('complete', 'complete_with_warnings')` list mirrors it member for member, which is what makes the migration's parity-by-construction prose a true sentence rather than an aspiration.
- **Both floors now count the gated cohort**, so the denominator `/discovery` ranks against and the N `/my-strategies` prints are the same honest number.
- **The RPC's first recurring CI gate.** `get_verified_cohort_rank` had shipped in phase 42 with zero CI-executed coverage — only a `HAS_LIVE_DB` vitest that never runs in CI and migration DO blocks that run once.

## Task Commits

1. **Task 1 (tracer, TDD): end-to-end gate on getPercentiles** — `6142e253` (test, RED) → `17fa4197` (feat, GREEN)
2. **Task 2 (TDD): getOwnRowPercentiles + closed-sets unit pins** — `8caed878` (test) → `c5eeca82` (feat)
3. **Task 3: RPC re-base + first CI SQL gate** — `358fbbda` (feat)
4. **Fallout fixes** (deviation, see below) — `78b048ea` (fix)

## Observed REDs (anti-vacuity ledger)

Every new pin has been observed failing. A pin that cannot fail is worse than none.

| Drill | Mutation | Observed RED |
|---|---|---|
| Pre-fix | none (original code) | Tests 1, 3, 4 red — fossil rows ranked at 83 and 100 |
| A / C | `isRankableAnalyticsRow` → `true` unconditionally | 8 pins red (all exclusion + both floors, both callers) |
| B / D | gate → exact-match on the bare `complete` value (Pitfall-1) | 4 pins red (every `complete_with_warnings` retention pin) |
| E | `PERCENTILE_GATE_COLUMN` → `"computed_at"` | the gate-column pin red |

Test 2 (`complete_with_warnings` retained) deliberately passes pre-fix — there was no gate at all — so its falsifier is drill B/D, not the pre-fix state. Recorded rather than glossed.

## Files Created/Modified

- `src/lib/closed-sets.ts` — `PERCENTILE_GATE_COLUMN` + `isRankableAnalyticsRow` next to `isComputedAnalytics` (D-03 placement)
- `src/lib/queries.ts` — both percentile callers gated; `PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged with a docblock explaining why it must stay so
- `src/lib/closed-sets.test.ts` — 8 helper input classes + gate-column pin + delegation-parity pin
- `src/lib/queries.percentiles.test.ts` — 4 `getPercentiles` gate behaviours + 2 `getOwnRowPercentiles` behaviours
- `src/app/(dashboard)/my-strategies/page.test.tsx` — population fixture teaches the gate column
- `supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql` — full-body re-base
- `supabase/tests/test_get_verified_cohort_rank_gate.sql` — first CI-executed test for the RPC

## Migration re-base diff summary

Body diff against `20260626120000` (extracted `CREATE OR REPLACE … $$;` region, diffed):

- **Two added executable lines, one per cohort query:** `AND a.computation_status IN ('complete', 'complete_with_warnings')` in the count query (line 51 of the body) and in the rank query (line 97).
- **Everything else is prose.** No other executable line changed. Preserved verbatim: `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, the REVOKE/GRANT posture, the in-function `42501` auth guard, decile quantization, the identity strip, `v_min_n CONSTANT INT := 20`, and the max_dd `100 - (<=)` direction.
- **DO block extended** from the inherited (a)–(d) with: **(e)** the gate predicate appears **≥2 times** in the deployed `pg_get_functiondef` output (an occurrence COUNT — a re-base gating only the count query would keep a presence check green while reintroducing the denominator/numerator divergence), **(f)** `search_path` still pinned via `proconfig`, **(g)** the min-N floor and auth guard still present.
- **`COMMENT ON FUNCTION` updated** to name the TS twin (`isRankableAnalyticsRow` → `isComputedAnalytics`).

House-rule grep re-run at Task 3 start: `20260626120000` is still the ONLY definition of this function. Timestamp `20260821120000` sorts after the latest existing migration (`20260819151000`).

## SQL-test seeding decision

**The behavioural arm IS included** — safe seeding proved feasible, so the plan's "explicitly infeasible" escape hatch was not taken. The sibling `test_get_published_trust_signals.sql` establishes the pattern: seed the full FK chain (`auth.users` → `profiles` → `strategies` → `strategy_verifications` → `strategy_analytics`) inside a transaction ending in `ROLLBACK`. Verified before relying on it that the verification state machine lives inside the `transition_strategy_verification` RPC and **no trigger** enforces transitions on the table, so a direct insert at `status='published'` is legal.

Two design points worth naming:

- **`REPEATABLE READ`**, because the arm compares a cohort count before and after seeding. Under `READ COMMITTED` a concurrent CI run committing a published+verified strategy between the two reads would flake the delta — a real hazard on this shared TEST DB.
- **A causal second arm.** Asserting only "the failed row is excluded" would pass even if it were excluded for an unrelated reason (missing verification, null metric, typo'd id). So the test flips **only** that row's `computation_status` to `complete` and asserts the count rises by one more — proving the row was cohort-eligible in every respect except its status. Without it, assertion 4a would be a coincidence dressed as a control.

## Census-precedes-migration evidence (D-01)

```
$ git log --oneline --date=short 8b06831b -1
8b06831b 2026-08-21 docs(159-01): record C-M1 PROD census results — crypto-sma crosses the <5 badge floor

$ git merge-base --is-ancestor 8b06831b HEAD && echo OK
CENSUS COMMIT IS ANCESTOR OF MIGRATION COMMIT — D-01 ordering holds
```

The census completion commit is a git ancestor of `358fbbda` (the migration commit), so the ordering is provable from history rather than asserted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] My own docblock prose broke the SI-01 `complete`-census guard**
- **Found during:** post-Task-3 verification (`src/lib/complete-status-scan.test.ts`)
- **Issue:** that guard greps **raw source** with `/===\s*["']complete["']/g` and does not strip comments. A sentence I wrote in `closed-sets.ts` quoted the literal comparison, pushing the frozen census for that file from 1 to 2 and reddening the scan.
- **Fix:** reworded the prose to describe the comparison without writing the operator, and left a note so the next author does not reintroduce it. **Deliberately did NOT bump the allowlist to 2** — that would have permanently blinded the guard to a *real* exact-match landing in `closed-sets.ts` later, converting a caught defect into a silent one.
- **Verification:** `complete-status-scan.test.ts` green; census for `lib/closed-sets.ts` back to 1.
- **Committed in:** `78b048ea`

**2. [Rule 3 - Blocking] Percentile fixtures predated the gate column**
- **Found during:** Task 1 (`queries.percentiles.test.ts`) and post-Task-2 sweep (`my-strategies/page.test.tsx`)
- **Issue:** both files build published-universe fixtures mirroring the percentile projection. That projection now carries `computation_status`, so status-less fixtures model rows whose computation never finished — which the gate correctly drops, taking the population under the `<5` floor. 5 tests red on the comparison-set copy and the own-scored Pnn suffix.
- **Fix:** fixtures declare a terminal-success status, matching what the DB actually returns. Existing assertions untouched — this aligns the mock with the new projection, it does not weaken a pin.
- **Verification:** `my-strategies/page.test.tsx` 12/12; full local suite swept for the rest of the class (see below) — no other fixture seeds the percentile projection without a status.
- **Committed in:** `78b048ea` and `6142e253`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** both are direct blast radius of this plan's own change and were caught by pre-existing repo guards. No scope creep; no pin weakened.

## Issues Encountered

**⚠️ Pre-existing failure NOT caused by this plan — belongs to plan 159-06 (out of my scope boundary, deliberately NOT fixed).**

The full local suite is **12030 passed / 1 failed**. The single failure is `src/__tests__/audit-coverage.test.ts`:

```
Found 1 uninstrumented mutation(s):
  src/app/api/strategies/csv-finalize/route.ts:2106
    > .update(updatePayload)
```

`git log` attributes that line to **`b9e1f333` — `feat(159-06): compare-and-set the csv-finalize FILL update on category_id IS NULL`**, a sibling Wave-1 plan merged into my base (`724ef5bc`). `csv-finalize/route.ts` is not in this plan's `files_modified` and is untouched by my diff (`git diff --name-only 724ef5bc HEAD` confirms 6 files, none of them that route).

**This will red the `frontend` CI aggregator for the whole phase until fixed.** The remedy is one line at the mutation site — either a `logAuditEvent(...)` call within 60 lines, or a `// @audit-skip: <reason>` pragma within 8 lines above the chain start (a CAS-guarded FILL update is a plausible skip candidate, but that is 159-06's call to make, not mine). Flagged for the orchestrator to route to 159-06 rather than fixed here, since editing another plan's file from this worktree risks a merge conflict with that agent's branch.

## Orchestrator follow-ups (I did not touch shared artifacts)

Per parallel-execution rules I did **not** modify `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` or `WINDOWS.md`.

1. **Mark RANK-01 complete** once every plan declaring it has a SUMMARY (shared-ID gate):
   ```bash
   gsd-tools query requirements.ready-ids .planning/phases/159-rank-public-ranking-integrity/159-02-PLAN.md RANK-01 --raw
   ```
2. **File the unarmed-gate residual** (ready to run):
   ```bash
   gsd-tools windows append \
     --kind unrun-verify \
     --phase 159 \
     --file "supabase/tests/test_get_verified_cohort_rank_gate.sql" \
     --description "get_verified_cohort_rank gate test has never run ARMED — it SKIPs until migration 20260821120000 reaches TEST after merge; confirm it goes green on the first post-merge CI run"
   ```
3. **File the 159-06 audit-coverage defect** (ready to run):
   ```bash
   gsd-tools windows append \
     --kind lint-warning \
     --phase 159 \
     --file "src/app/api/strategies/csv-finalize/route.ts" \
     --line 2106 \
     --description "Uninstrumented .update(updatePayload) added by 159-06 (b9e1f333) reds audit-coverage.test.ts — needs logAuditEvent or an @audit-skip pragma"
   ```

## Known Stubs

None — no placeholder values, no unwired components, no skipped tests introduced.

## Threat Flags

None. The plan's `<threat_model>` dispositions were all `mitigate` and are implemented: T-159-04 (cohort pollution) by the gate on both engines; T-159-05 (probe oracle) by preserving decile quantization, min-N 20, the identity strip and the anon REVOKE verbatim, plus a new SQL assertion that anon lacks EXECUTE; T-159-06 (SECDEF losing a guard) by the full-body rule, the extended DO block and the SQL test's structural arms. T-159-07 was pre-accepted per D-01.

## User Setup Required

None.

## Next Phase Readiness

- **RANK-01 is closed on both engines** at the source level; `PERCENTILE_ANALYTICS_COLUMNS` is byte-unchanged so the csv-finalize `CLOCK_SAFETY_KPI_COLUMNS` mirror prose stays true and plan 159-06's surface is undisturbed.
- **The one open loop is the migration apply.** Merging `supabase/migrations/**` to main auto-applies to PROD. Expect, per census: the `crypto-sma` category crosses the `<5` badge floor so **every percentile badge stops rendering** on public discovery (the pre-decided honest outcome, D-01), while the RPC surface shows **no visible change** (min-N 20 was already unmet at cohort 3, now 1). Phase UAT must be told to expect exactly this.
- **Blocking for the phase:** the 159-06 audit-coverage failure above must be resolved before the `frontend` aggregator can go green.

## Self-Check: PASSED

- `supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql` — FOUND on disk
- `supabase/tests/test_get_verified_cohort_rank_gate.sql` — FOUND on disk
- All 6 commits present on `worktree-agent-a85386934fddf0e5a`
- `npx tsc --noEmit` clean; `eslint` clean on all touched files; `check-route-contract` OK
- Task gates: Task 1 and Task 2 vitest runs exit 0; Task 3 file/grep gates pass; both cohort predicates confirmed by region read (not grep alone)

---
*Phase: 159-rank-public-ranking-integrity*
*Completed: 2026-08-21*
