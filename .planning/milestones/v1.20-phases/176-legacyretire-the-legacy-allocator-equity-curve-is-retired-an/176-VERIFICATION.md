---
status: passed
verified_at_sha: e13328f0f35a5cdcb6dd156c14c54c7c0bf43653
drift_subjects:
  - supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql
  - supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql
  - supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql
  - src/lib/queries.ts
  - analytics-service/services/job_worker.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/tests/test_legacy_table_not_named.py
  - scripts/prod-prober/cron-manifest.json
---

# Phase 176: LEGACYRETIRE Verification Report

**Phase Goal:** The legacy allocator equity curve (the snapshot series written by the holdings poll and the daily refresh) is retired: every reader moves to the marked series, and the poll and refresh writers stop or are repurposed.
**Verified:** 2026-11-03
**Status:** passed
**Re-verification:** No, initial verification
**Score:** 3/3 roadmap success criteria verified, 9/9 founder decisions (D-01 to D-09) honoured in code; 0 behavior-unverified truths

Method: code read against origin/main (`git show origin/main:<path>`), because the phase branch predates later main commits. The SUMMARY claims were not taken as evidence; each was re-measured, including a fresh read-only read of PROD (marker query first, alone, named PRODUCTION).

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| SC-1 | A census lists every reader of the legacy curve and each is moved to the marked series or removed | VERIFIED | RESEARCH `## Census` and CONTEXT census of record list the readers. Re-grep of origin/main (`src`, `analytics-service` production code, `scripts`, `supabase/tests`, excluding historical migrations) finds no live reference to `allocator_equity_snapshots`, `persist_equity_snapshots`, `replace_equity_snapshots_window`, `partitionTrustworthyEquitySnapshots`, `_owed_reconstructs_for_zero_snapshot_book` or the zero-history bootstrap. Remaining hits are docstrings, comments, retirement pins, test fakes and runbook prose. Each reader below. |
| SC-1a | Warm-up gate on derived days | VERIFIED | `src/lib/queries.ts`: `snapshotCount = equityHistoryState === "ready" ? equityDailyPoints.length : null`, the drawn derived curve's day count. KpiStrip keeps `snapshotCount < 30` with the generic countdown. |
| SC-1b | Depth copy and baseline banner removed (D-07) | VERIFIED | `minHistoryDepthMonths`, `equityBaselineUnknown`, `partitionTrustworthyEquitySnapshots` have no production reference. Tests `queries.my-allocation.test.ts` ("D-07: the payload carries no ...") and `KpiStrip.warmup.test.tsx` Test E pass (25 passed under `-t "D-07\|allocator book"`). |
| SC-1c | Bridge outcomes on the account's derived equity (D-03, D-05, D-06) | VERIFIED | Migration `20261102120000`: `derived_account_return_over` compounds the derived row's flow-neutral `returns` (absent day counts as no change, NULL when the curve does not cover the window or no return falls inside it, `1+r<=0` compounds to -100%). `compute_bridge_outcome_deltas` holding branch calls it. The one-time D-06 reset function is owner-only. Self-verify block asserts the old per-symbol reader is absent. SQL gate `test_bridge_outcome_deltas_derived.sql` exists and CI `sql-tests` is green on main. |
| SC-1d | Zero-history bootstrap and its Python twin removed | VERIFIED | `enqueue_refresh_allocator_equity_for_all` dropped by the PR 3 migration (catalogue self-check plus my own PROD read: 0 dropped functions present). `_owed_reconstructs_for_zero_snapshot_book` has no code reference, only the retirement pin. |
| SC-1e | `delete_allocator_api_key` and both replace RPCs | VERIFIED | Replace RPCs and `extract_symbol_value_at` dropped. `delete_allocator_api_key` re-based in the same migration: Step 4 now deletes the allocator's derived `equity_curve` row and that key's `key_inputs:<id>` row under the last-key test (D-09); lock, search_path, lock_timeout and ACL kept and asserted. Gate `test_api_key_delete_atomicity.sql` Part 3 was flipped to require the delete and was shown RED under three neuterings in PR3-REVIEW. |
| SC-1f | Shared-key reader rule (D-01, absorbs 181) | VERIFIED | `queries.ts`: `allocatorEligibleApiKeyIds = eligibleKeyIds`, with no strategy-link subtraction. Link reads remain only for the reconstruct note. |
| SC-1g | GDPR export, generated types, tooling lists | VERIFIED | No reference to the dropped table in `src` (manifest, types). Coverage checker models `DROP TABLE` (SFH-3 fixed). Both operator scripts deleted; `bybit_unified_flows.py` kept per D-08. |
| SC-2 | Poll and refresh writers stop or are repurposed with the new job named; cron manifest matches | VERIFIED | Both job kinds route to `run_retired_allocator_equity_job` (DONE no-op; a `force_rebuild` row fails permanent with a warning). The kind rows stay (FK). Holdings sync no longer enqueues a reconstruct (migration `20261103120000`). `cron-manifest.json` has 18 jobs and no `refresh-allocator-equity`. Hourly prober reported `cron-drift: 18 vs 18, 0 differing`. The holdings poll keeps writing `allocator_holdings`, which other surfaces read; the poll never wrote the legacy table. |
| SC-3 | TODOS entries `167.2.1.1.1.1-MT5-BTC-MISSING-CLOSE-LEGACY-EXCLUSION` and `167.2.1.1.1.1-SFOX-NONSTABLE-LEGACY-EXCLUSION` are closed | VERIFIED | Both carry a dated `CLOSED 2026-11-02 (Phase 176 LEGACYRETIRE, SC-3)` paragraph naming the drop migration. The OKX double-count entry is NARROWED and stays open (store 2, `allocator_holdings`), as planned. The closure paragraphs hedge "does not claim the apply has happened"; the apply has since happened (below), so the hedge is stale wording only. |

## PROD Read-back (read only, 2026-11-03, marker query run alone first: named PRODUCTION)

| Reading | Value | Expected |
|---|---|---|
| Legacy table gone | true | true |
| Public function bodies naming the table or a dropped function (comments stripped) | 0 | 0 |
| Dropped functions still present | 0 | 0 |
| Cron jobs: allocator group | derive 00:40, poll 01:00, bridge batch 03:00, all active; `refresh-allocator-equity` absent | 3 jobs |
| Open jobs of the two retired kinds / created in last 48h | 0 / 0 | 0 / 0 |
| `snapshot_rebuild_boundary` derived rows | 0 | 0 |
| Allocators with a derived `equity_curve` row | 7 (newest compute 2026-11-03 01:37Z, after the drop) | 7 |
| Holding-branch bridge rows | 0 | 0 (nothing to recompute) |

This matches plan 16's confirming re-read (R1 7/7/7/7, R3 all 0, 3 cron jobs), which I did not need to trust.

## Other Checks

- Main CI at head (after the re-dump PR) is green. The failure on the PR 3 merge commit was only the expected `sql-gate-lint` baseline drift, cleared by re-dump PR #1186 (v0.133.17.1). `Supabase Migrate` is success for the PR 1, PR 2 and PR 3 merge SHAs (apply-test then apply).
- Local runs: `test_legacy_table_not_named.py` and `test_legacy_allocator_jobs_retired.py` 7 passed; `legacyretire-runbook-forms.test.ts` 185 passed.
- Review disposition: PR 2 (one MEDIUM user-facing, one HIGH ack, silent-failure items: all fixed). PR 3 (CR-01 and SFH-3 round 1, MD-01 under D-09 round 2; round 3 clean in all four reviewers). SFH-1 (migration does not check cron) is recorded and not fixed because it conflicts with D-04.
- Anti-patterns: no TBD/FIXME/XXX markers introduced in the verified production paths.

## Warnings (non-blocking, none gates the goal)

1. **Closure records still open on the phase branch.** The ROADMAP `### Phase 176` entry shows plans 12 to 16 unchecked and "12/17 plans executed" although their SUMMARYs are complete; the ROADMAP lines for Phases 181 (absorbed) and 182 (superseded) say "Closes with 176" and have not been closed. `phase complete` bookkeeping, not code.
2. **Vestigial names kept on purpose.** `equityCurveSource: "legacy"` (rebuilding-state stamp), the inert payload field `historyReconstructFailed`, and the cap/marker machinery are retained and booked (`176-RECONSTRUCT-CAP-MARKER-INERT`). They read nothing from the dropped table.
3. **Known LOW residues recorded in PR3-REVIEW:** `key_capture:`, `native_unpriced:` and `nav_mark_refusal:` derived rows can outlive a last-key hard delete (`key_capture` already booked as `167.1.2.2.1-KEY-CAPTURE-ORPHAN`); a one-round-trip compose race could restore a curve after a delete.
4. **Bridge compounding logic has no PROD exercise.** PROD holds no holding-branch bridge rows, so the D-05 arithmetic is proven by the SQL gate in CI, not by live data. It is covered by a test, so it is not a behavior-unverified truth.

## Gaps

None.
