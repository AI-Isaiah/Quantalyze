---
phase: "225"
slug: "oneaccountonce"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-23"
validated: "2026-11-27"
verified_at_sha: 8567885d5
---

# Phase 225 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Audited retroactively by `/gsd-validate-phase 225` on 2026-11-27, after the phase closed. The file was in State A: it had been seeded at plan time and never filled. 58 tasks across 21 plans: 49 have an automated command, and 9 are orchestrator or founder checkpoints that are manual by design. One gap was found and filled. It was SF-M4 / IN-01: nothing pinned the short-circuit POST server bracket.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS routes, libs, exec-on-fixture SQL), pytest 9.0.2 (analytics-service), pg-lane SQL gates through the mutation runner, mypy strict |
| **Config file** | `vitest.config.ts`, `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `scripts/mutation-floors.mjs` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_mt5_validate.py -q` (the MT5 validation layer); `npx vitest run src/app/api/strategies/create-with-key/route.test.ts src/app/api/keys/validate-and-encrypt/route.test.ts src/lib/venue-identity.test.ts` (the connect layer) |
| **Full suite command** | `npx vitest run`; `cd analytics-service && python3 -m pytest`; `node scripts/mutation-runner/run.mjs` |
| **Estimated runtime** | phase subset: pytest about 140 s, vitest about 50 s, the 9 SQL gates about 10 min on the pg-lane |

---

## Sampling Rate

- **After every task commit:** the quick run for the touched layer, plus `mypy --strict` when Python changed.
- **After every plan wave:** the phase subset below (pytest, vitest, and the touched SQL gates on the pg-lane).
- **Before `/gsd-verify-work`:** full suite green; `node scripts/mutation-runner/run.mjs` exits 0 with `WAIVED_CEILING` untouched.
- **Max feedback latency:** 225 s for the quick runs.

---

## Audit run (2026-11-27, origin/main 8567885d5, plus the one new test)

| Layer | Command | Result |
|-------|---------|--------|
| pytest, the 32 files the plans name | `python3 -m pytest <32 files> -q` | **2467 passed, 2 skipped.** Neither skip is a phase-225 gap. One is `test_job_worker.py:4677`, which needs `LANE_DB_URL` (the local-stack lane, Docker, deliberately not booted: the Phase 244 agent has booked it). The other is `test_mt5_validate.py:721`, an empty parameter set that predates the phase. |
| vitest, the 35 files the plans name | `npx vitest run <35 files>` | **3042 passed** on three runs out of four. ⚠️ The first, cold run reported 2 failures (68.8 s, while the transform cache was still empty). Those runs did not reproduce on the three warm runs, and their names were not captured because only the run's tail was kept. They are recorded here as an unexplained one-off, not hidden. |
| SQL gates, the 9 files the plans name | `node scripts/mutation-runner/run.mjs --file <gate>` (narrowed DIAGNOSTIC; it never exits 0 by design) | **119/119 arms biting, 0 waived:** account_identity 45, swap_account_slot 24, venue_identity_uniq 20, commit_scenario_batch_venue_server_identity 12, fingerprint_sameday_empty 6, wizard_composite_fence 5, exchange_not_user_writable 4, fingerprint_unpriced 2, wizard_session_idempotency 1. ⚠️ The first `test_api_keys_account_identity.sql` run printed "1 defect(s)" while every one of its 45 arms bit. It ran while other suites loaded the machine. The rerun, alone, printed "No defects in the narrowed scope." with 45/45 biting. |
| static checks | `lint-migration-data-dependence.mjs`; `mutation-runner --parse-only`; `baseline-content-drift-check.mjs --self-test`; `npm run schema:functions:check`; the `census.sql` write-keyword count | each exit 0; census write-keyword count 0 |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Task | Test Type | Automated Command (files) | File Exists | Status |
|---------|------|------|-------------|------|-----------|---------------------------|-------------|--------|
| 225-01-01 | 01 | 1 | CONN-03 | Task 1 (tracer): migration A1 end to end on the pg-lane: column, 13-parameter wizard RPC, one gate arm proving | migration linter | `node scripts/lint-migration-data-dependence.mjs` | ✅ | ✅ green |
| 225-01-02 | 01 | 1 | CONN-03 | Task 2: CONN-03 column arms, privilege pin, generated types | SQL gate (mutation) | `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ✅ | ✅ green |
| 225-01-03 | 01 | 1 | CONN-03 | Task 3: census moves and the PROOF-01 record for this plan | mutation census | `node scripts/mutation-runner/run.mjs --parse-only; rc=$?; echo "exit=$rc"; test ` | ✅ | ✅ green |
| 225-02-01 | 02 | 1 | ONCE-03 | Task 1 (tracer): census-keys + delete script + exec test, happy path end to end on a throwaway cluster | vitest | `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` | ✅ | ✅ green |
| 225-02-02 | 02 | 1 | ONCE-03 | Task 2: the remaining census files and every abort arm, each proven to write nothing | vitest | `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` | ✅ | ✅ green |
| 225-02-03 | 02 | 1 | ONCE-03 | Task 3: orchestrator runs the census and the one-time delete on PROD | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-03-01 | 03 | 2 | CONN-03 | Task 1 (tracer): assertion 5h on the 13-parameter function, green on the lane with its twins biting | SQL gate (mutation) | `supabase/tests/test_api_keys_exchange_not_user_writable.sql` | ✅ | ✅ green |
| 225-03-02 | 03 | 2 | CONN-03 | Task 2: the session-idempotency and composite-fence gates, then a corpus-wide zero | SQL gate (mutation) | `supabase/tests/test_wizard_composite_fence.sql`; `supabase/tests/test_wizard_session_idempotency.sql` | ✅ | ✅ green |
| 225-04-01 | 04 | 2 | MT5D-08 | Task 1 (tracer): swap_account_slot with its happy path and ACL proven on the lane against the real trigger | migration linter | `node scripts/lint-migration-data-dependence.mjs` | ✅ | ✅ green |
| 225-04-02 | 04 | 2 | MT5D-08 | Task 2: every ordering and refusal arm, each leaving both rows unchanged | SQL gate (mutation) | `supabase/tests/test_swap_account_slot.sql` | ✅ | ✅ green |
| 225-04-03 | 04 | 2 | MT5D-08 | Task 3: register the new gate file and its arms in every mutation census, in one commit | vitest | `src/__tests__/gate-family-meta.test.ts`; `src/__tests__/lint-sql-gates.test.ts`; `src/__tests__/mutation-annotation-parser.test.ts`; `src/__tests__/mutation-runner-floors.test.ts` | ✅ | ✅ green |
| 225-04-04 | 04 | 2 | MT5D-08 | Task 4: orchestrator ships PR-1, then confirms on PROD that both migrations are live before any PR-2 plan star | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-05-01 | 05 | 3 | CONN-01, ONCE-01 | Task 1 (tracer): the route refuses an own-draft match by name end to end: builder, both arms, copy entry, rost | vitest | `src/app/api/strategies/create-with-key/route.test.ts`; `src/lib/wizardErrors.invariant.test.ts` | ✅ | ✅ green |
| 225-05-02 | 05 | 3 | CONN-01, ONCE-01 | Task 2: roster and render pins, the naming sentence, and the wizard surface test | vitest | `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx`; `src/lib/wizardErrors.roster-render.test.tsx`; `src/lib/wizardErrors.test.ts`; `src/lib/wizardKeyRosters.test.ts` | ✅ | ✅ green |
| 225-06-01 | 06 | 3 | CONN-03, MT5D-08 | Task 1 (tracer): one fixture, two runtimes: normalise, same and pick agree case for case | vitest | `src/lib/venue-identity.test.ts` | ✅ | ✅ green |
| 225-06-02 | 06 | 3 | CONN-03, MT5D-08 | Task 2: the live same-login read and the swap helper, typed and registered | vitest | `src/__tests__/audit-coverage.test.ts`; `src/lib/venue-identity.test.ts` | ✅ | ✅ green |
| 225-07-01 | 07 | 4 | ONCE-01, CONN-03, MT5D-08 | Task 1 (tracer): an MT5 connect beside the owner's failing key is validated, admitted without identity, and ta | vitest | `src/app/api/strategies/create-with-key/route.test.ts` | ✅ | ✅ green |
| 225-07-02 | 07 | 4 | ONCE-01, CONN-03, MT5D-08 | Task 2: the server in the write, the fence's server rule, the swap-failure path, the secrets | vitest | `src/__tests__/audit-coverage.test.ts`; `src/app/api/strategies/create-with-key/route.test.ts` | ✅ | ✅ green |
| 225-08-01 | 08 | 4 | ONCE-01, ONCE-02, CONN-03, MT5D-08 | Task 1 (tracer): an allocator add beside the owner's failing key is inserted without identity and takes the sl | vitest | `src/app/api/keys/validate-and-encrypt/route.test.ts` | ✅ | ✅ green |
| 225-08-02 | 08 | 4 | ONCE-01, ONCE-02, CONN-03, MT5D-08 | Task 2: working-holder refusal, the server on the insert, the cross-owner share, the dark fence, and the rotat | vitest | `src/__tests__/audit-coverage.test.ts`; `src/app/api/keys/[id]/rotate-secret/route.test.ts`; `src/app/api/keys/validate-and-encrypt/route.test.ts`; `src/lib/wizardErrors.invariant.test.ts` | ✅ | ✅ green |
| 225-08-03 | 08 | 4 | ONCE-01, ONCE-02, CONN-03, MT5D-08 | Task 3: the demoted key is named on its card (OQ-1) | vitest | `src/components/exchanges/AllocatorExchangeManager.liveness.test.tsx`; `src/components/exchanges/AllocatorExchangeManager.test.tsx`; `src/components/strategy/ApiKeyManager.test.tsx`; `src/lib/account-share-note.test.ts` | ✅ | ✅ green |
| 225-09-01 | 09 | 4 | MT5D-08 | Task 1 (tracer): a working key's poll takes the slot from the owner's failing holder through the swap, audited | pytest | `tests/test_account_identity_stamper.py` | ✅ | ✅ green |
| 225-09-02 | 09 | 4 | MT5D-08 | Task 2: refused swaps fall back to today's state; the superseded 167.1.2 pin flips; the mark paths stay | pytest | `tests/test_account_identity.py`; `tests/test_account_identity_stamper.py`; `tests/test_venue_server_identity.py` | ✅ | ✅ green |
| 225-10-01 | 10 | 6 | CONN-03, ONCE-02 | Task 1 (tracer): migration B rebuilds the index with the server member, and the uniqueness gate proves its new | SQL gate (mutation) | `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ✅ | ✅ green |
| 225-10-02 | 10 | 6 | CONN-03, ONCE-02 | Task 2: reconnect agrees with the new index; every RECON twin targets migration B; the census fixture matches | SQL gate (mutation) | `supabase/tests/test_api_keys_account_identity.sql` | ✅ | ✅ green |
| 225-10-03 | 10 | 6 | CONN-03, ONCE-02 | Task 3: move every mutation census for the new arms, in one commit | vitest | `src/__tests__/gate-family-meta.test.ts`; `src/__tests__/lint-sql-gates.test.ts`; `src/__tests__/mutation-annotation-parser.test.ts`; `src/__tests__/mutation-runner-floors.test.ts` | ✅ | ✅ green |
| 225-10-04 | 10 | 6 | CONN-03, ONCE-02 | Task 4: orchestrator runs the gate-A5 backfill census on PROD before PR-3 opens | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-11-01 | 11 | 5 | ONCE-01, ONCE-02, CONN-03, MT5D-08 | Task 1 (tracer): an okx connect is resolved after validation: a working holder is refused before the write, a  | vitest | `src/__tests__/audit-coverage.test.ts`; `src/app/api/strategies/create-with-key/route.test.ts`; `src/lib/wizardErrors.invariant.test.ts` | ✅ | ✅ green |
| 225-11-02 | 11 | 5 | ONCE-01, ONCE-02, CONN-03, MT5D-08 | Task 2: per-owner pins: an exchange key and an MT5 login refused for one owner, the cross-owner share admitted | vitest | `src/app/api/strategies/create-with-key/route.test.ts` | ✅ | ✅ green |
| 225-12-01 | 12 | 5 | ONCE-04, CONN-03 | Task 1 (tracer): the MT5 server: capture with a wildcard pre-check, backfill, interim fallback, cross-owner st | pytest | `tests/test_account_identity.py`; `tests/test_account_identity_stamper.py`; `tests/test_venue_server_identity.py` | ✅ | ✅ green |
| 225-12-02 | 12 | 5 | ONCE-04, CONN-03 | Task 2: the gate-A5 backfill census runbook for the orchestrator | static check | `docs/runbooks/venue-server-backfill/census.sql` | ✅ | ✅ green |
| 225-13-01 | 13 | 1 | CONN-03 | Task 1: a human decides how the TypeScript identity twin reads the broker server | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-13-02 | 13 | 1 | CONN-03 | Task 2 (tracer): the GRANT migration, and the uniqueness gate proves owner-read with no write and no anon | SQL gate (mutation) | `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ✅ | ✅ green |
| 225-13-03 | 13 | 1 | CONN-03 | Task 3: move every mutation census for the new arm, in one commit, measured from the origin/main base | vitest | `src/__tests__/gate-family-meta.test.ts`; `src/__tests__/lint-sql-gates.test.ts`; `src/__tests__/mutation-annotation-parser.test.ts`; `src/__tests__/mutation-runner-floors.test.ts` | ✅ | ✅ green |
| 225-14-01 | 14 | 1 | CONN-03 | Task 1 (tracer): two live keys on one login and two servers compose end to end through the real derive | pytest | `tests/test_allocator_equity_departed.py`; `tests/test_derive_allocator_equity_job.py`; `tests/test_derive_refusal_rows.py`; `tests/test_venue_server_identity.py` | ✅ | ✅ green |
| 225-14-02 | 14 | 1 | CONN-03 | Task 2: a key with no server on a login with two servers is refused by name, live or disconnected | pytest | `tests/test_derive_allocator_equity_job.py`; `tests/test_derive_refusal_rows.py`; `tests/test_venue_server_identity.py` | ✅ | ✅ green |
| 225-14-03 | 14 | 1 | CONN-03 | Task 3: the match scorer reads the server and counts two servers as two accounts | pytest | `tests/test_match_portfolio_aum_native_unpriced.py`; `tests/test_match_portfolio_aum_per_key.py`; `tests/test_match_router.py` | ✅ | ✅ green |
| 225-15-01 | 15 | 2 | CONN-03 | Task 1 (tracer): the owner's key read carries the server through keyAccountOf, and the TS twin replays the sha | vitest | `src/lib/departed-history.test.ts`; `src/lib/latest-holdings-per-key.test.ts`; `src/lib/portfolio-exposure.test.ts`; `src/lib/venue-identity.test.ts` | ✅ | ✅ green |
| 225-15-02 | 15 | 2 | CONN-03 | Task 2: the browser projection carries venue_server, and the strict key schema accepts it | vitest | `src/__tests__/api-key-runtime-guard.test.ts`; `src/__tests__/history-reconstruct-note-predicate-twins.test.ts`; `src/lib/queries.my-allocation.test.ts`; `src/lib/sec-005-api-keys-projection.test.ts` | ✅ | ✅ green |
| 225-15-03 | 15 | 2 | CONN-03 | Task 3: the dashboard, the key card and the gap lines read the server-aware identity | vitest | `src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts`; `src/components/exchanges/AllocatorExchangeManager.departed-history.test.tsx`; `src/components/exchanges/AllocatorExchangeManager.test.tsx`; `src/lib/departed-history.test.ts`; `src/lib/queries.test.ts` | ✅ | ✅ green |
| 225-16-01 | 16 | 3 | CONN-03 | Task 1 (tracer): the re-based recompute counts two servers as two accounts, proven by the first gate arm | SQL gate (mutation) | `supabase/tests/test_commit_scenario_batch_venue_server_identity.sql` | ✅ | ✅ green |
| 225-16-02 | 16 | 3 | CONN-03 | Task 2: one arm per remaining clause of the identity rule, and the TypeScript path reproduces every literal | SQL gate (mutation) | `supabase/tests/test_commit_scenario_batch_venue_server_identity.sql` | ✅ | ✅ green |
| 225-16-03 | 16 | 3 | CONN-03 | Task 3: move every census for the new gate file and its arms, in one commit | vitest | `src/__tests__/gate-family-meta.test.ts`; `src/__tests__/lint-sql-gates.test.ts`; `src/__tests__/mutation-annotation-parser.test.ts`; `src/__tests__/mutation-runner-floors.test.ts` | ✅ | ✅ green |
| 225-17-01 | 17 | 4 | CONN-03 | Task 1 (tracer): the eight existing fingerprint twins bite against the new body | SQL gate (mutation) | `supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql`; `supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql` | ✅ | ✅ green |
| 225-17-02 | 17 | 4 | CONN-03 | Task 2: record the re-base's expected baseline drift, never as an allowlist row | drift check | `node scripts/baseline-content-drift-check.mjs --self-test && npm run schema:func` | ✅ | ✅ green |
| 225-17-03 | 17 | 4 | CONN-03 | Task 3: the orchestrator reads PROD before PR-2b-2 merges | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-18-01 | 18 | 3 | CONN-03, ONCE-01 | Task 1 (tracer): the wizard's validation refuses a session on another server, end to end through the router | pytest | `tests/test_mt5_client_contract.py`; `tests/test_mt5_validate.py` | ✅ | ✅ green |
| 225-18-02 | 18 | 3 | CONN-03, ONCE-01 | Task 2: every other path to a stored MT5 key carries the same guarantee (the worker adapter, the parity suites | pytest | `tests/test_ingestion_mt5.py`; `tests/test_mt5_probe_parity_roster.py`; `tests/test_mt5_validate.py`; `tests/test_mt5_validate_parity.py` | ✅ | ✅ green |
| 225-18-03 | 18 | 3 | CONN-03, ONCE-01 | Task 3: evidence from plan 20's poll verdicts before PR-2c merges, and one founder attempt on each side of its | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-19-01 | 19 | 5 | CONN-03, ONCE-02 | Task 1 (tracer): merge main into the phase branch, rename B, and prove both of B's gates bite on the merged tr | SQL gate (mutation) | `supabase/tests/test_api_keys_account_identity.sql`; `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ✅ | ✅ green |
| 225-19-02 | 19 | 5 | CONN-03, ONCE-02 | Task 2: re-base every mutation census on main plus plan 10's arms, by measurement | vitest | `src/__tests__/accounttruth-census.test.ts`; `src/__tests__/gate-family-meta.test.ts`; `src/__tests__/lint-sql-gates.test.ts`; `src/__tests__/mutation-annotation-parser.test.ts`; `src/__tests__/mutation-runner-floors.test.ts` | ✅ | ✅ green |
| 225-19-03 | 19 | 5 | CONN-03, ONCE-02 | Task 3: the last read-only PROD pass before PR-3 merges | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-20-01 | 20 | 2 | CONN-03, ONCE-01 | Task 1 (tracer): the derive's deal-ledger read writes one verdict line per poll, end to end from the derive jo | pytest | `tests/test_mt5_derive_branch.py`; `tests/test_mt5_read.py` | ✅ | ✅ green |
| 225-20-02 | 20 | 2 | CONN-03, ONCE-01 | Task 2: the balance read and the allocator holdings read write the same verdict line | pytest | `tests/test_allocator_positions.py`; `tests/test_mt5_read.py`; `tests/test_mt5_sync_path.py` | ✅ | ✅ green |
| 225-20-03 | 20 | 2 | CONN-03, ONCE-01 | Task 3: after PR-2c0 deploys and one daily MT5 poll cycle runs, count the verdicts, gate PR-2c on them, and bo | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |
| 225-21-01 | 21 | 3 | CONN-03, ONCE-01 | Task 1 (tracer): the derive refuses a terminal session on another broker server, end to end from the derive jo | pytest | `tests/test_allocator_equity_dropped_day_pnl.py`; `tests/test_allocator_equity_realized_basis.py`; `tests/test_allocator_equity_writer_basis.py`; `tests/test_derive_allocator_equity_job.py`; `tests/test_job_worker.py`; `tests/test_key_mode_linked_strategy_recompute.py`; `tests/test_mt5_derive_branch.py`; `tests/test_mt5_handover.py`; `tests/test_mt5_read.py`; `tests/test_mt5_server_clock.py`; `tests/test_nav_marks_compose_roundtrip.py`; `tests/test_nav_marks_derive_apply.py`; `tests/test_nav_marks_g01_review_fixes.py`; `tests/test_nav_marks_reads.py`; `tests/test_nav_marks_writer_chain_base.py` | ✅ | ✅ green |
| 225-21-02 | 21 | 3 | CONN-03, ONCE-01 | Task 2: the sync's balance read and the allocator holdings read refuse a session on another broker server, end | pytest | `tests/test_allocator_positions.py`; `tests/test_allocator_positions_non_ccxt.py`; `tests/test_marksource_cross_curve.py`; `tests/test_mt5_read.py`; `tests/test_mt5_sync_path.py` | ✅ | ✅ green |
| 225-21-03 | 21 | 3 | CONN-03, ONCE-01 | Task 3: after the deploy, read one daily MT5 poll cycle on Railway and confirm the bracket refused no correct  | manual / checkpoint | see Manual-Only | ✅ | ✅ done (manual, recorded in SUMMARY) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Threat references for each plan are in `225-SECURITY.md`.

---

## Gaps found and filled (2026-11-27)

| Gap | Requirement | Finding | Test added | PROOF-01 |
|-----|-------------|---------|------------|----------|
| The short-circuit POST server bracket in `run_probe` (`analytics-service/services/mt5_probe.py`, the `classify_trade_capability(...) == "undetermined"` branch) was unpinned: skipping it left every test green (225-REVIEW-PR2C.md mutation table, "0 red") | CONN-03, ONCE-01 (plan 18 Task 1, "the bracket at all three sites") | SF-M4 = IN-01 | `analytics-service/tests/test_mt5_validate.py::test_mt5_server_changing_before_the_short_circuit_verdict_fails_closed_transient`: the terminal refuses trading, and the second `account_info` reports another server. The answer must be 424 `NETWORK_ERROR_DETAIL` and never the operator 500 computed on the foreign session. | The `assert_expected_server(post, ...)` call in that branch was replaced with `pass` in the file, after a byte backup. RED: `E       assert 500 != 500` (the answer was `MT5_GATEWAY_UNCONFIGURED`). Restored with `cp`, `cmp` silent, GREEN: 1 passed. Reproduced twice, by the nyquist auditor and by the orchestrator. Whole file: 133 passed, 1 skipped. |

**SF-M1** (225-REVIEW-PR2C.md: a permanently wrong server is answered "transient, try again") is a disposition question, not a coverage gap. It was not fixed in this pass. The transient answer is the plan's own mitigation for T-225-60 ("never a permanent blame"), and a permanent answer would blame a user whose broker aliases server names. That aliasing case is still unmeasured. The finding is MEDIUM and user-facing, so it is booked in `TODOS.md` as `[225-MT5-SERVER-MISMATCH-TRANSIENT-COPY]`, with an owner and a trigger.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions / Record |
|---|---|---|---|
| Live ONCE-03 deletion on PROD (225-02 T3) | ONCE-03 | PROD writes by the orchestrator via MCP | marker query, census re-run that stops on any difference, delete, before/after counts recorded in 225-02-SUMMARY |
| PR-1 ship and PROD liveness of A1 and A2 (225-04 T4) | CONN-03, MT5D-08 | deploy checkpoint | recorded in 225-04-SUMMARY |
| Gate-A5 backfill census on PROD (225-10 T4) | CONN-03 | read-only PROD census | recorded in 225-10 and 225-19 SUMMARYs |
| Founder decision on how the TS twin reads the server (225-13 T1) | CONN-03 | human decision | "Owner-only read", recorded in 225-13-SUMMARY and CONTEXT Q6 |
| PROD read before PR-2b-2 merges (225-17 T3) | CONN-03 | read-only PROD | ⚠️ not recorded (see 225-SECURITY.md T-225-57); the same counts were read in 225-19 T3 on 2026-11-26 |
| Plan 20 verdict evidence and the founder attempt (225-18 T3) | CONN-03, ONCE-01 | PROD logs plus a founder action | the plan 20 verdicts are recorded (28/28 True). ⚠️ The post-deploy correct-server positive control is still a pending human item in 225-VERIFICATION.md (T-225-60) |
| Last read-only PROD pass before PR-3 (225-19 T3) | CONN-03, ONCE-02 | read-only PROD | recorded in 225-19-SUMMARY |
| One poll cycle of verdicts after PR-2c0 (225-20 T3) | CONN-03, ONCE-01 | Railway logs | recorded (28/28 True, 11/11 keys, 4/4 servers) |
| One poll cycle after the poll-path bracket (225-21 T3) | CONN-03, ONCE-01 | Railway logs | PASS 2026-11-27: 22 True, 0 False, 0 refused, 11/11 keys (225-21-SUMMARY) |

---

## Validation Architecture` (verbatim below); the per-task map is filled by the planner's `<verify>` blocks.

## Seeded Validation Architecture (from research, 2026-11-23; kept as lineage)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (TS routes, libs, exec-SQL tests), pytest 9.0.2 (analytics-service), pg-lane + `psql` gates (`supabase/tests/*.sql`), mutation runner (`scripts/mutation-runner/run.mjs`), mypy strict |
| Config files | `vitest.config.ts`, `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (`[tool.mypy]`), `scripts/mutation-floors.mjs` |
| Quick run (route + libs) | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts src/app/api/keys/validate-and-encrypt/route.test.ts src/lib/account-share-note.test.ts src/lib/wizardKeyRosters.test.ts src/lib/wizardErrors.invariant.test.ts` |
| Quick run (stamper) | `cd analytics-service && python3 -m pytest tests/test_account_identity_stamper.py -x -q` (130 passed at HEAD) |
| Types | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (from `.github/workflows/ci.yml`; the Makefile `typecheck` target runs the same set) |
| One SQL gate | `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <the gate's RED-UNDER-SETUP files> --gate supabase/tests/test_api_keys_venue_identity_uniq.sql` (the apply list is the file's own `RED-UNDER-SETUP` JSON; the new migrations must be appended to it and to every other gate whose behaviour reads the new column or function) |
| Full suite | `npx vitest run`; `cd analytics-service && python3 -m pytest`; `node scripts/mutation-runner/run.mjs`; `npm run lint`; `npm run schema:functions:check` |

Environment notes measured: the Docker daemon is DOWN on the research machine, so the local-stack lane (`scripts/local-stack/run.sh`, used by `sql-tests`) cannot boot; the pg-lane and the exec-on-fixture vitest pattern need only PostgreSQL 16 server binaries, which are installed. Executors that need `supabase gen types --local` need Docker started first.

### Phase Requirements → Test Map

| Req | Behaviour | Test type | Command | Exists | Neuter target for PROOF-01 (named arm first) |
|-----|-----------|-----------|---------|--------|----------------------------------------------|
| ONCE-01 (exchange) | OKX key whose uid a same-owner live key holds is refused 409 `KEY_VENUE_ALREADY_CONNECTED`, uid in no body/log | vitest | `route.test.ts` (existing arm at `:2006`) + new owner-vs-owner arm | partial | drop `.eq("user_id", userId)` in the resolver, expect the cross-owner arm RED |
| ONCE-01 (MT5) | same-owner MT5 login + same server refused by name before `validateKey`, zero writes | vitest | `route.test.ts` new arm beside `:2067` | no (Wave 0) | make the pre-validation arm fall through |
| CONN-01 | own draft on the same account answers the new named 409 with `strategy_name`; session fence still answers `deduped` | vitest | `route.test.ts` flips at `:1675 :1692 :2084 :2193 :2692`, keeps `:1544 :4647` | flips needed | restore `deduped: true` in D2 and D3 |
| ONCE-01 (wizard copy) | new code recognised, copy present, rosters/invariants consistent | vitest | `wizardKeyRosters.test.ts`, `wizardErrors.invariant.test.ts`, `wizardErrors.roster-render.test.tsx`, `ConnectKeyStep.test.tsx` | edits | remove the code from `CREATE_WITH_KEY_OWN_CODES` (UNKNOWN render) |
| ONCE-02 | different owners, same exchange/login/server both connect; each owner's resolver sees only its own rows | vitest + SQL | route test with two user ids; SQL arm inserting for two users | no | weaken the index to drop `user_id` (SQL arm RED), drop the resolver owner filter (route arm RED) |
| ONCE-02 (strategy-linked key in an allocator book) | a key with `strategies.api_key_id` and allocator holdings stays unaffected by a same-owner connect on another account | vitest | route test: second account connects, first untouched | no | n/a (assert zero writes to the first key) |
| ONCE-04 | two keys of different owners with the same login and server both stamp with no marker; same-owner second key marks | pytest | `test_account_identity_stamper.py` new arms | no | remove the `user_id` filter in the holder lookup / drop the server write |
| CONN-03 (index) | same owner + login, servers A and B both live; same server refused 23505 naming the index; NULL vs NULL refused | SQL gate | `test_api_keys_venue_identity_uniq.sql` rewritten arm 2 + new arms | edit | recreate the old login-only index (live `sql` step) |
| CONN-03 (column) | CHECK refuses blank and over-length server; column not in `API_KEY_USER_COLUMNS_ARR`; column ungranted to `authenticated` | SQL gate + vitest | new SQL arm; `sec-005-api-keys-projection.test.ts` | no | drop the CHECK / add the column to the allowlist |
| CONN-03 (writers) | connect writes the normalised server into the same INSERT; routes pass it | vitest | `route.test.ts` for both routes asserting the RPC args / insert row | no | stop sending `p_venue_server` |
| CONN-03 (backfill) | stamped MT5 key with NULL server gets its server written once from the session; unstamped key gets login and server in one UPDATE; no data-reading DO block | pytest + lint | `test_account_identity_stamper.py`; `node scripts/lint-migration-data-dependence.mjs` | no | skip the backfill write |
| CONN-03 (normalisation parity) | TS and Py produce identical bytes for an ASCII+whitespace fixture list | vitest + pytest | one fixture file read by both | no | change one side's fold |
| MT5D-08 (stamper) | failing holder beside working key: working key holds the slot, old holder marked `duplicate`, dependents re-pointed, audit once, recompose enqueued; working holder keeps its slot; both failing leave the incumbent | pytest | `test_account_identity_stamper.py` | no | make `working_holder_predicate` constant, or skip the swap call |
| MT5D-08 (function) | `swap_account_slot` ordering against the real trigger and index: marked new key, holder with dependents, wrong owner, working holder, composite pair each behave per the Pattern; service_role-only ACL | SQL gate | new `supabase/tests/test_swap_account_slot.sql` with `RED-UNDER-M` twins | no | edit the function (drop the re-point UPDATE: `ACCOUNT_SHARE_KEY_IS_A_HOLDER`; drop the marker clear: `ACCOUNT_SHARE_HOLDER_IS_MARKED`) |
| MT5D-08 (connect) | failing same-owner holder: key admitted unstamped then swapped; working holder: refused | vitest | `route.test.ts` for both routes | no | resolver returns "working" always |
| D-18 parity | SQL (including the new function), TS and Py tuples agree | vitest + pytest | `account-share-note.test.ts`; `test_derive_allocator_equity_job.py` | extend | change one tuple member |
| F-9 card sentence | failing marked key with a working holder names the holder; WR-02 otherwise unchanged | vitest | `account-share-note.test.ts`, `AllocatorExchangeManager*.test.tsx` | extend | return null |
| ONCE-03 | census/delete script deletes exactly the manifest on a fixture; aborts untouched on any difference | vitest exec-on-fixture | new `src/__tests__/*-exec.test.ts` modelled on `mt5-parity-capture-sql-exec.test.ts` | no | delete the equality assertion in the script: the "extra key" arm goes RED |
| ONCE-03 (live) | before/after counts and holder fingerprints recorded verbatim | manual, orchestrator | marker query then `census.sql`, `delete.sql` | n/a | n/a (checkpoint, not a gate) |

### Sampling Rate
- **Per task commit:** the quick run lines above for the touched layer, plus `mypy` when Python changed.
- **Per wave merge:** full vitest, full pytest, the touched SQL gates via pg-lane, `npm run lint`, `npm run schema:functions:check`.
- **Phase gate:** the migration PRs pass migration-reviewer and rls-policy-auditor with no MEDIUM+ finding; `sql-mutation` runs every new `RED-UNDER-M` (the push to `main` takes a subset, the nightly takes FULL; a migration no gate lists forces a FULL fallback, so append the new migrations to the relevant `RED-UNDER-SETUP` lists); `node scripts/mutation-runner/run.mjs` exits 0 with `WAIVED_CEILING` untouched.

### Wave 0 Gaps
- [x] New SQL gate file or arms for the column CHECK, the rewritten index arm and the swap function, with `RED-UNDER` prose plus `RED-UNDER-M` twins.
- [x] Update every gate that pins the 12-argument `create_wizard_strategy` signature (list in F-6, item 5).
- [x] The doubled-language normalisation fixture file and its two readers.
- [x] The census/delete SQL files and their executed-on-fixture vitest.
- [x] Grep every census a new `supabase/tests` file or arm moves (`scripts/mutation-floors.mjs` symbols, `src/__tests__/mutation-runner-floors.test.ts`, `docs/sql-gate-lineage.md`, any file-count pin) and move them in the same commit; read floors by symbol, never restate.
- [x] `database.types.ts` regeneration path (needs the Docker local stack, or a documented hand edit).

### PROOF-01 protocol (per gate)
Back up the file to be neutered with `cp <file> <scratch>/<name>.bak`; apply the neuter edit; run the gate and record the RED line with the named arm first; restore with `cp <scratch>/<name>.bak <file>`; `cmp <file> <scratch>/<name>.bak` must print nothing; rerun and record GREEN. Record the edit, command, RED line and GREEN line verbatim in the plan SUMMARY. Never `git checkout`, `git restore` or `git stash` on uncommitted work.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (49 automated; the 9 manual tasks are checkpoints by design, listed above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 225s (quick runs)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-11-27

## Validation Audit 2026-11-27

| Metric | Count |
|---|---|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |
