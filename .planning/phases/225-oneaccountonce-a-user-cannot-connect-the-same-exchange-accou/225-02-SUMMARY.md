---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 02
subsystem: database
tags: [postgres, runbook, one-time-delete, prod-census, exec-on-fixture]
requires:
  - phase: 167.1.2
    provides: marker columns, delete_allocator_api_key, published-composite delete guard
provides:
  - docs/runbooks/oneaccountonce census files and the single-transaction stop-on-difference delete.sql
  - src/__tests__/oneaccountonce-delete-sql-exec.test.ts (36 tests, executed on a throwaway cluster)
  - the PROD removal of the 13 founder-confirmed same-owner duplicate keys and their 2 strategies (2026-11-23)
affects: [155.2 plan 12 recapture, allocator_equity_derived follow-up, 225 ship PR-1]
actuals:
  tokens: 19200
  tasks: 3
  commits: 2
plan_head_before: 2ab976392c596434a9a1476127f4f98e88116bae
plan_head_after: 7c96c6de003097d255c7a554103e315ed0bfd11f
key-files:
  created:
    - docs/runbooks/oneaccountonce/README.md
    - docs/runbooks/oneaccountonce/marker.sql
    - docs/runbooks/oneaccountonce/census-keys.sql
    - docs/runbooks/oneaccountonce/census-strategies.sql
    - docs/runbooks/oneaccountonce/census-dependents.sql
    - docs/runbooks/oneaccountonce/census-triggers.sql
    - docs/runbooks/oneaccountonce/delete.sql
    - src/__tests__/oneaccountonce-delete-sql-exec.test.ts
  modified: []
key-decisions:
  - "Derived allocator_equity_derived key_inputs rows are outside the confirmed manifest and are NOT deleted by delete.sql (OQ-4); the founder decides delete-or-leave"
  - "Check H measures pg_stat_xact_user_tables deltas against a baseline taken before the first write, so stale session counters cannot trip it"
status: complete
---

# Phase 225 Plan 02: One-time same-owner duplicate removal (ONCE-03) Summary

Single-transaction, stop-on-difference `delete.sql` plus read-only census files, proven on a throwaway cluster, then run once on PROD: 13 same-owner duplicate keys and their 2 strategies are gone.

**Deviation record (cited, not re-opened):** this plan DELETES rows, overriding the standing "keep data; disconnect, never delete" rule and the never-deletes half of D-01, for same-owner duplicates only. Authority: the founder's verbatim 2026-11-23 answer in 225-CONTEXT Q5 and the ROADMAP `### Phase 225` deviation line, and the founder's confirmation of the exact manifest ("Yes, delete all").

## What was built

- `delete.sql`: one `BEGIN` / `DO` / `COMMIT`, tokens inside string literals. Checks, each raising a bracketed label and writing nothing: A inputs and marker, B discovery equality, C key state (live, holder, strategy_keys, protected), D protected fingerprints, E strategy set and owner, F off-manifest rows found from `pg_constraint`, G write counts, H post-write (manifest gone, protected unchanged, no unlisted table written, via `pg_stat_xact_user_tables` deltas). Writes run per owner under `SET LOCAL ROLE authenticated` with the owner's claims: strategies first, then each key through `delete_allocator_api_key(key, true)`; recompose enqueued per owner after the checks. The GDPR sanitize bypass is never named or set.
- Census files: `census-keys`, `census-strategies`, `census-dependents` (every FK into api_keys or strategies plus non-FK derived rows), `census-triggers`; `marker.sql`; README with run order, stop rules and hazards.
- `oneaccountonce-delete-sql-exec.test.ts`: template-database fixture, real `delete_allocator_api_key`, published-composite guard and write-once trigger bodies, baseline-cut tables, FK names and actions cross-checked against the baseline. 36 tests: happy path (exact manifest, decoys byte-identical, one recompose per owner), every abort arm asserting non-zero exit, named check and unchanged count plus md5 of every fixture table.

## PROOF-01 record (verbatim)

Each neuter: `cp` backup of `delete.sql`, edit, `npx vitest run src/__tests__/oneaccountonce-delete-sql-exec.test.ts`, restore with `cp`, `cmp` silent, GREEN. No git checkout, restore or stash.

1. Check B removed: `IF v_found IS DISTINCT FROM v_arr THEN` became `IF false AND v_found IS DISTINCT FROM v_arr THEN`. RED: `Tests  3 failed | 33 passed (36)`, including `× extra key: a fourth same-owner duplicate exists that the pasted manifest omits [B-discovery]` with `AssertionError: delete.sql must exit non-zero; stdout=0|0`, `× missing id ... [B-discovery]`, `× a second run on the cleaned database aborts at discovery ...`. Restored, `cmp` printed nothing (`CMP_SILENT`), GREEN `Tests  36 passed (36)`.
2. Check H table-written loop removed: `IF (r.d_ins <> 0 OR ...` became `IF false AND (r.d_ins <> 0 OR ...`. RED: `Tests  1 failed | 35 passed (36)`, `× deep cascade into an unlisted table: ... [H-post-write]` with `stdout=0|0`. Restored, `CMP_SILENT2`, GREEN 36 passed.
3. Check F count removed: `IF v_n > 0 AND NOT (...)` became `IF false AND v_n > 0 AND NOT (...)`. RED: 2 failed, both `[F-off-manifest]` arms (blocking row, table never named). Restored, `CMP3`.
4. Same-owner clause dropped from discovery (`AND h.user_id = k.user_id`). RED: happy path plus the B, C, D and E arms fail (the cross-owner marked decoy is discovered). Restored, `CMP4`.

## Task 3 precondition

`155.2-12-SUMMARY.md` did not exist at the run (read-only check), so the 155.2 freeze precondition held.

## PROD run record (2026-11-23, orchestrator via Supabase MCP, counts only)

1. `marker.sql`: non-NULL, names PROD.
2. Census BEFORE, re-run immediately before the delete; it matched the founder-confirmed manifest exactly.
   - census-keys: 13 rows (deribit 7, mt5 1, okx 5) across 5 owners; all 13 disconnected; none a holder, none in strategy_keys, none in a published composite; the mt5 row's ordinal is k2 (equal to sealed keymap k2); none of the protected k1, k3, k10 keys in the set.
   - census-strategies: 2 strategy rows (1 private, 1 published, both source wizard); 0 strategy_keys link rows.
   - census-triggers: 21 triggers on the confirmed tables. `mt5_server_clock_readings_write_once` admits the cascade (`pg_trigger_depth() > 1`). `api_keys_published_composite_delete_guard` is not hit (no strategy_keys links).
   - census-dependents, rows_referencing: allocator_holdings 2470; api_key_nav_marks 28; compute_jobs 99 by api_key_id and 57 by strategy_id; csv_daily_returns 1599 by api_key_id and 272 by strategy_id; funding_fees 285; key_permission_audit 9; match_candidates 119; mt5_server_clock_readings 11; position_snapshots 15; positions 9; reconciliation_reports 132; strategies.api_key_id 2; strategy_analytics 2; strategy_analytics_series 24; strategy_verifications 2; trades 125. Every FK referencer with `in_confirmed_list = false`: 0. non_fk_derived (allocator_equity_derived key_inputs): 3.
3. `delete.sql`: tokens filled in a scratchpad copy (verified by diff that only the tokens differ), run as ONE MCP call; it committed. Final select: `manifest_keys_remaining` 0, `manifest_strategies_remaining` 0. The MCP did not return the script's NOTICE line, so the per-table delete tally is NOT available and is not reported here; the census AFTER is the durable record.
4. Census AFTER:
   - census-keys: 0 rows (same-owner duplicate count 0, so census-strategies has 0 rows).
   - Protected k1, k3, k10: 3 of 3 present (the D and H fingerprint checks passed inside the transaction).
   - Orphan allocator_holdings (no matching api_keys row): 0.
   - `derive_allocator_equity` jobs queued in the last 15 minutes: 5, one per owner.
   - allocator_equity_derived key_inputs rows for the deleted keys: 3 remaining. They are not FK rows and were deliberately not deleted (OQ-4).

## Associated derived data (founder decision)

CLOSED, 2026-11-23. The coordinator decided to delete them (option a) under the founder's Q5 ruling recorded in 225-CONTEXT.md, "Delete also all associated factsheet, data etc.", because these rows are derived data of the keys deleted under that ruling. No new founder question was needed.

Follow-up run: the marker named PROD. Re-reading the rows right before the delete gave 0 `key_inputs:<deleted key id>` rows, not 3. The 5 derive_allocator_equity recompose jobs that delete.sql queued (one per owner) had all reached `done`, and the recompose rewrote each owner's derived rows without the deleted keys. Because the set differed, nothing was deleted by hand. Before: 3 rows (census right after delete.sql). After: 0 rows, removed by the product's own recompose. No TODOS.md item is owed.

## Hand-off to 155.2 plan 12

Deleting sealed k2 renumbers the MT5 ordinals that `docs/runbooks/mt5-parity/capture-keymap.sql` assigns (every MT5 key, disconnected included, by created_at then id): old k3 becomes k2, old k10 becomes k9. The 155.2 plan 12 recapture must build a fresh keymap and `labels.json` from PROD and never reuse the sealed ordinal list. The orchestrator relayed this in its run report to the coordinator for the founder and for whoever runs 155.2 plan 12; the coordinator acknowledged it on 2026-11-23 and carries the renumbering into 155.2's re-plan (fresh keymap and labels.json, never the sealed one).

## Deviations from Plan

None - plan executed exactly as written. Note: the exec test carries every Task 2 abort arm when the Task 1 commit lands (one harness written once); commits were split by file.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema change.

## Self-Check: PASSED

Files exist under `docs/runbooks/oneaccountonce/` (7) and `src/__tests__/oneaccountonce-delete-sql-exec.test.ts`; commits `ba6ab9243` and `7c96c6de0` are ancestors of HEAD; `npx vitest run src/__tests__/oneaccountonce-delete-sql-exec.test.ts` gives 36 passed.

ship: rides PR-1 (orchestrator ships PR-1 after plans 01-04)
