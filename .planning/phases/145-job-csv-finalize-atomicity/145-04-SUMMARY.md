---
phase: 145-job-csv-finalize-atomicity
plan: 04
subsystem: api
tags: [nextjs, route, python, seam, sentry, copy-honesty, csv-finalize, tdd]

requires:
  - phase: 145-02
    provides: "145-DECISION.md — founder-locked option (i-b): the route calls the folded RPC directly, the CONTRIB-02 shape, for both paths"
  - phase: 145-03
    provides: "20260819120000_csv_finalize_atomic_fold.sql — finalize_csv_strategy_with_returns (caller-agnostic, NOT edited here) + deferred-items.md #1-#4"
provides:
  - "src/app/api/strategies/csv-finalize/route.ts — ONE write path: finalizeAtomicOrErrorResponse (shared by both handlers) + read-only resolveExistingStrategyOrRefuse 23505 arm with checks-BEFORE-metadata ordering; hop 0 (postProcessKey dispatch) deleted; honest failure copy; three new capture sites"
  - "analytics-service/routers/process_key.py — csv-finalize branch DELETED (D-06 obligation 2); csv step='finalize' deliberately falls to the API-6 422; get_user_scoped_supabase import removed (utility kept in db.py per 140.x obligation)"
  - "re-pointed gates: cross-submission-merge (5 arms at the resolve arm), after-failloud (paths 1/2 via the enqueue arm), route.test.ts (CONTRIB-02 + TS-13 at the fold), csv-validate-route (14 tests), thin-adapters (3 tripwires), seam rosters (budgets/log-coverage/limiter-posture), source-csv-constraint (fold migration), test_process_key.py (dead-branch pin)"
  - "deferred-items #1-#4 discharged: schema snapshots regenerated (fold snapshot in), database.types.ts pruned, MUTATING_RPC_NAMES re-pointed, live persist tests retired"
affects: [145-05 (c14 rebuild + capture pin tests + TODOS deferrals), 145-06 (TEST apply + live exercise + merge gate)]

actuals:
  tokens: 64374   # chars/4 over the realized 34-file diff (git show HEAD | wc -c = 257,499)
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Shared finalize-outcome helper: both route handlers converge on ONE fold caller + ONE failure surface (fold-fail 500, resolve 409/200, fail-closed 503), so the two writers the pre-fold route had cannot drift"
    - "Read-only 23505 resolve arm: identity checks (name, then range-as-READ) precede ANY metadata write — the ordering itself is what makes the 409 refusal copy truthful"
    - "Neuter-RED via verified-differing route VARIANTS + a vitest alias override — production files never edited for a neuter (the Plan 03 register, TS edition)"

key-files:
  created:
    - supabase/schema/functions/finalize_csv_strategy_with_returns.sql (generated)
  modified:
    - src/app/api/strategies/csv-finalize/route.ts
    - analytics-service/routers/process_key.py
    - src/lib/process-key-client.ts
    - src/__tests__/csv-finalize-cross-submission-merge.test.ts
    - src/__tests__/csv-finalize-after-failloud.test.ts
    - src/app/api/strategies/csv-finalize/route.test.ts
    - analytics-service/tests/test_process_key.py
    - analytics-service/tests/test_persist_csv_daily_returns_live.py
    - src/__tests__/csv-validate-route.test.ts
    - src/lib/resilient-fetch.ts
    - src/lib/database.types.ts
    - src/__tests__/audit-coverage.test.ts
    - tests/integration/process-key-thin-adapters.test.ts

key-decisions:
  - "Fold-failure arm code is CSV_FINALIZE_FAIL at 500 (not the plan's default CSV_PERSIST_FAIL): the wizard's retry-enable predicate freezes Submit on CSV_PERSIST_FAIL, which would contradict the honest 'nothing was saved — try again' copy; CSV_FINALIZE_FAIL re-enables retry and was already the finalize-failure code. Pinning tests updated in the same diff (the plan's stated escape hatch)."
  - "The contribution error arm's 422 collapsed into the shared 500 fold-failure arm — Task 1's 'single 5xx arm' is singular by specification, and 422 is not a 5xx"
  - "A third capture (finalize-resolve-read-fail) added on the fail-closed resolve-read arm — window B's defect WAS zero capture; recreating a capture-less fail-closed arm would regress the exact anomaly D-12 closes (Rule 2)"
  - "23505 is routed to the resolve arm on error.code alone (no constraint-name sniffing): a dailies-index 23505 (unreachable behind the route's duplicate-date 400) resolves to a refetch-miss and fails CLOSED — provably safe without a brittle string match"
  - "Manager success envelope no longer carries the upstream spread (step/queued/etc.) — it is the route's own { ok, strategy_id, status, correlation_id }; status is ECHOED from the resolved row on the 23505 path, never fabricated"

metrics:
  duration: 56m
  completed: 2026-08-17

status: complete
---

# Phase 145 Plan 04: csv-finalize fold caller wiring Summary

Both csv-finalize handlers now reach strategies + strategy_verifications + csv_daily_returns ONLY through `finalize_csv_strategy_with_returns` on the SSR user client (option i-b, exactly as 145-DECISION.md records), the Python csv-finalize branch is deleted with a dead-branch pin holding the door shut, the 23505 resolve arm is read-only with CR-01 checks before any metadata write, all three dishonest copy sentences are gone, and every one of the ~30 tests the wiring broke was re-pointed in the SAME commit (`8c4087ac`).

## Commit

**`8c4087ac`** — `feat(145-04): wire the csv-finalize fold per 145-DECISION + honest copy + captures + same-commit test re-points` — 34 files, wiring + Python deletion + copy + captures + every re-pointed test + deferred-items #1-#4 discharge in ONE commit (verified via `git show --stat`). Zero hunks on `20260816140000`, `20260817120000`, and `20260819120000` (verified: `git show HEAD -- <all three> | wc -l` = 0).

## Decision arm implemented

**(i-b)** — the route calls the folded RPC directly on the SSR cookie-session client, for BOTH paths (manager passes `p_terminal_status='pending_review'`, contribution passes `'private'` verbatim — D-08). Phase 106 Stage B's "unified backbone is the sole finalize path" ruling is consciously reversed for this flow, recorded in the route header and the branch-dispatch comment. The (i-a) shape appears nowhere.

## Task outcomes

| Task | Outcome |
|------|---------|
| 1 | `persistDailyReturnsOrErrorResponse` dissolved into `finalizeAtomicOrErrorResponse` + `resolveExistingStrategyOrRefuse`; hop 0 + INTERNAL_API_TOKEN check + getSession token forwarding deleted from the manager handler; metadata UPDATE moved AFTER the fold/resolve outcome (Pitfall 6); Python branch (old :1110-1346) deleted with a tombstone comment; `postProcessKey` import removed; CR-01 rationale carried to the resolve arm. Verify: tsc exit 0; fold name ×16 in route.ts; zero non-test `persist_csv_daily_returns` references (the plan's grep chain passes) |
| 2 | Both retired sentences at ZERO occurrences in route.ts (`Nothing was changed`=0, `Your strategy was created but`=0, count-asserted); `finalize-fold-fail` ×1, `finalize-resolve-refused` ×1 (+ `finalize-resolve-read-fail` ×1, deviation 2) — all grep-unique against the taken step list; one-shot captures, no throttle, no secrets option (no forwarded JWT exists on this path any more — mirrors the metadata-update exemplar) |
| 3 | Five CR-01 arms re-pointed at the resolve arm, each observed RED (table below) + six further neuters on the changed gates + the Python dead-branch neuter; scoped vitest trio green (21 tests), full `test_process_key.py` 105 passed, `mypy --strict` clean on all six touched modules, eslint clean, `schema:functions:check` green; ONE commit verified |

## Neuter-RED table (every neuter on a VERIFIED-DIFFERING variant of route.ts wired in via a vitest alias override — the committed production file was never edited for a neuter; each variant generation refused no-op/missing-anchor transforms)

| # | Arm / gate | Neuter (variant transform) | Observed RED (verbatim head) | Restored |
|---|-----------|---------------------------|------------------------------|----------|
| 1 | Merge case (2025 onto committed 2024 → 409) | range refusal disabled (`> 0` → `> 9999`) | `AssertionError: the route reported success for a submission whose file the committed strategy does not hold … expected 200 not to be 200` | GREEN |
| 2 | Range filter uses payload's own min/max | min-bound corrupted (`date.lt.${minDate}` → `date.lt.${maxDate}`) | `AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]` (filter mismatch) | GREEN |
| 3 | POSITIVE first submit creates via fold | success check disabled (`if (!error && isUuid(...))` → `if (!error && false && ...)`) | `AssertionError: expected 500 to be 200` | GREEN |
| 4 | POSITIVE instructed retry resolves | name check inverted (`!==` → `===`) | `AssertionError: expected 409 to be 200` | GREEN |
| 5 | Failed resolve read fails CLOSED | fail-closed disabled (`if (staleErr)` → `if (staleErr && false)`) | `AssertionError: expected 200 to be 503` | GREEN |
| 6 | D-08 'private' wire pin (route.test.ts) | `terminalStatus: "private"` → `"pending_review" as "private"` | `AssertionError: expected 'pending_review' to be 'private'` | GREEN |
| 7 | D-12 fold-fail capture pin | step tag renamed (`finalize-fold-fail` → `neutered-step`) | `AssertionError: expected "vi.fn()" to be called with arguments: [ …(2) ]` | GREEN |
| 8 | D-11 honest-copy pin | sentence replaced (`Nothing was saved — the submission rolled back completely` → `The submission may have partially saved`) | `AssertionError: expected 'Your strategy could not be saved. The…' to contain 'Nothing was saved'` | GREEN |
| 9 | TS-13 error-never-restamped pin | success decided by isUuid alone (`if (!error && isUuid(...))` → `if (isUuid(...))`) | `AssertionError: Deciding the success path by isUuid(strategy_id) alone … expected true to be false` | GREEN |
| 10 | after-failloud path 1 (placeholder-upsert capture, re-pointed driver) | step tag renamed (`placeholder-upsert` → `neutered-ph`) | `AssertionError: expected undefined to be defined` (capture absent) | GREEN |
| 11 | D-07 p_rows wire pin (manager fold call carries the series) | `p_rows: args.rows` → `p_rows: []` | `AssertionError: expected [] to deeply equal [ { date: '2024-01-01', …(1) } ]` | GREEN |
| PY | Python dead-branch pin (`test_process_key_csv_finalize_branch_is_dead_answers_422`) | run against the PRE-DELETION router (throwaway `git worktree` at `8fecdab9` — the real branch alive, no file edited) | `AssertionError: … assert 'CSV_FINALIZE_FAILED' == 'MISSING_STRATEGY_ID'` (the live branch answered instead of the 422) — worktree removed after | GREEN |

Restore proof: after deleting the final variant, the three scoped suites re-ran GREEN against the real route (21/21), and the working tree carried no scratch files at commit time.

## Deviations from Plan

### Auto-fixed / adapted

**1. [Rule 3 - Blocking] ~20 additional tests re-pointed beyond the plan's four named files** — the wiring broke `csv-validate-route.test.ts` (14 csv-finalize tests: delegation, metadata, Tests 6/7/8a/13/13b, enqueue drivers), `tests/integration/process-key-thin-adapters.test.ts` (3 adapter tests → converted to no-dispatch tripwires; I-T3e inverted: csv-finalize must now succeed WITHOUT `INTERNAL_API_TOKEN`), and four seam roster invariants (`SEAM_ROUTE_BUDGETS` + `EXPECTED_ROUTE_BUDGETS` row deleted, `EXPECTED_SEAM_FILES` row deleted, limiter-posture roster row deleted + vacuity floor 15→14, budgets count pin 15→14). All in the same commit — the 144-§8 class the plan's key_links mandate. Files: see commit stat.

**2. [Rule 2 - Missing critical] `finalize-resolve-read-fail` capture added on the fail-closed resolve-read arm** — the plan specifies two new step tags; leaving the fail-closed arm console-only would recreate window B's exact defect (a backend failure arm with zero Sentry coverage) on its successor. One call site, grep-unique, one-shot. Plan 05's capture-pin tests can extend to it.

**3. [Considered decision, plan's escape hatch used] fold-failure envelope = 500 `CSV_FINALIZE_FAIL`, not `CSV_PERSIST_FAIL`** — the plan said keep `CSV_PERSIST_FAIL` "unless a test pins otherwise"; `CsvSubmitStep`'s retry predicate (pinned by RED-TEAM-L2) FREEZES Submit on `CSV_PERSIST_FAIL`, which would ship an honest "try again" sentence beside a dead button. `CSV_FINALIZE_FAIL` re-enables retry and was already this route's finalize-failure code (the old contribution 422 arm). `CSV_PERSIST_FAIL` survives only on the fail-closed resolve 503 (byte-compat with the merge test's pinned 503). Pinning tests updated in the same diff.

**4. [Adaptation] Neuters executed on scratch VARIANTS, never on the production file** — the runtime's edit classifier (correctly) refused a bug-introducing edit to route.ts. Adopted Plan 03's register: a temporary generator derived each variant from the real body (refusing no-op/missing-anchor transforms), a temporary vitest config aliased the route specifier to the variant, and both harness files were deleted before commit. The Python neuter used a throwaway `git worktree` at the pre-deletion commit instead. Plan 05 should reuse this pattern for its own neuter-REDs.

**5. [Rule 3 - Blocking] Worker-pipeline live tests re-seeded via direct service-role INSERT** — `test_csv_daily_returns_dualaxis_live.py` / `test_csv_daily_returns_perkey_rls_live.py` import helpers from `test_persist_csv_daily_returns_live.py`, so the file could not be deleted outright (module-level ImportError would redden collection). Tests 1-6 (direct callers of the dropped RPC) were retired; Tests 9-10's seeding re-pointed from the dropped RPC to a direct INSERT mirroring the fold's shape; Tests 7-11 and all shared helpers kept.

**6. [Note] Commits made on `feat/v1.19-phase-145`** — the branch the orchestrator explicitly designated for this worktree (not a protected ref; the generic per-agent-branch namespace check is superseded by that explicit instruction — same as Plan 03's recorded note).

**7. [Note] JOB-06 deliberately NOT marked complete** — the requirement spans the whole phase (Plan 05's honesty-gate rebuild + Plan 06's TEST apply/live exercise remain); marking it after the caller wiring alone would be a false checkbox (the Plan 01 register, followed by every plan since).

### Sanctioned by the plan
- **`NEW-C14-07` describe marked `describe.skip`** with a `Plan 05 rebuilds this` comment — it pins the dissolved upstream-body spread; the surviving TS-13 discipline is pinned by route.test.ts's re-pointed describe. Plan 05 owns the file (exactly the plan's instruction for c14 blocks that fail against the new wiring).
- The vacuous RED-TEAM-M1 block still passes (its pre-create 400 driver is wiring-independent) and was left untouched — Plan 05 deletes and replaces it.

## Copy — the three sentences (D-11)

| Arm | Old (dishonest) | New (truthful under the fold) |
|-----|-----------------|-------------------------------|
| fold failure (500, was persist-fail 500 + probe-fail's sibling) | "Your strategy was created but the daily-return data could not be saved…" — would lie in the OTHER direction under the fold | "Your strategy could not be saved. Nothing was saved — the submission rolled back completely, so it is safe to try again. Contact support@quantalyze.com if it persists." |
| 409 CSV_SESSION_REUSED (resolve refusal) | "…so we stopped before writing. Nothing was changed." — false: metadata had already been overwritten | "This wizard session already created a strategy with a different track record, so we refused before writing anything of this submission. Start a new strategy to upload a different file." — true by ORDERING (checks precede metadata) |
| fail-closed resolve read (503) | "…Nothing was changed. Try again shortly." — false: a prior attempt had committed | "We could not confirm what is already saved for this strategy, so we stopped before writing anything of this submission. Try again shortly." |

Both retired sentences: ZERO occurrences in route.ts, code and comments (count-asserted).

## What could NOT be verified here (and why)

- **The fold against a real database** — no Supabase MCP / psql in this session by design; the SQL behavior is proven by Plan 03's harness-cluster gates, and TEST apply + live end-to-end exercise (incl. SC#3's measured before/after) is Plan 06 (orchestrator-only). The route-level tests mock the RPC boundary.
- **CI shard behavior / full `npm run test:coverage`** — scoped suites + all suites touching the changed surface were run locally green (merge 5, after-failloud 4, route.test 12, csv-validate-route 48, c14 30+2skip, seam/adapter batch 389, misc 114); the full sharded coverage run is CI's job.
- **`sql-tests` designed-RED state** — unchanged from Plan 03 (the three re-pointed SQL gates stay designed-RED on shared TEST until Plan 06 applies the migration); no SQL file touched here.
- **`csv-finalize-rpc.test.ts`** (skipIf live-DB, never in CI — Pitfall 7) still names the dropped 5-arg RPC; logged as deferred-items #5 (owner Plan 05/06) rather than half-fixed here.
- **wizardErrors.ts:2028** retains one historical mention of the old `finalize_csv_strategy` name inside an explicitly past-tense paragraph about migration 20260728120000 — kept deliberately (it names what the function was called then); every present-tense claim in that file was re-pointed.

## Known Stubs

None wired to UI. One skipped test recorded: `NEW-C14-07` (`describe.skip`, Plan 05 owns the rebuild — see Deviations/Sanctioned).

## Self-Check: PASSED

- `src/app/api/strategies/csv-finalize/route.ts` — FOUND (fold call ×16, no old-RPC calls)
- `analytics-service/routers/process_key.py` — FOUND (branch deleted, import removed)
- `src/__tests__/csv-finalize-cross-submission-merge.test.ts` — FOUND (5 re-pointed arms)
- `src/lib/process-key-client.ts` — FOUND (comments re-pointed, userAccessToken transport kept)
- `supabase/schema/functions/finalize_csv_strategy_with_returns.sql` — FOUND; the two stale snapshots — GONE
- Commit `8c4087ac` — FOUND in `git log`
- Zero hunks on `20260816140000` / `20260817120000` / `20260819120000` — VERIFIED
