# 105 FOLD-DECISION — series-store fold (D6, DECIDE-ONLY; EXECUTE in Phase 106)

Locked 2026-07-14. This doc is the **106 execution contract**. Phase 105 writes NO
migration, DDL, or reader repoint. If any consumer of this decision concludes DDL is
needed *this phase*, STOP and flag — it is 106.

## 1. Decision (LOCKED)

The **tall table SURVIVES** — a per-strategy JSONB blob is REJECTED. In Phase 106:

- Rename `csv_daily_returns` → `daily_returns`.
- Add a `basis` column, default `'cash_settlement'` (back-compat with today's rows).
- Fold the `strategy_analytics_series` daily-return kinds — `mtm_daily_returns` and
  the 104 `cash_settlement` — INTO the tall table as `basis`-tagged rows.
- The persisted rows stay **sparse** (`_drop_nonfinite`, honest `gap_spans`) — the fold
  changes storage location + shape, not the honest-sparse discipline.

Why a JSONB blob CANNOT serve this (each is a hard blocker):
- `allocator_id` + date-range GDPR / per-key / admin queries need row-level indexing.
- The **per-key axis** (migration `20260624120000_csv_daily_returns_per_key_axis`).
- The **allocator-date index** (migration `20260625120000_csv_daily_returns_allocator_date_index`).
- The **owner-coherence trigger** (`enforce_csv_daily_returns_owner_coherence`).
- **Per-key RLS** (`supabase/tests/test_csv_daily_returns_perkey_rls.sql`).

This matches the ROADMAP §Phase 106 carry-forward.

## 2. Reader inventory (grep `csv_daily_returns`, re-run 2026-07-14)

**Current total: 66 files** (research advisory said ~70). Breakdown:

- **Frontend src/ non-test: 13** — `src/lib/queries.ts`, `src/lib/factsheet/composite-read-path.ts`,
  `src/lib/factsheet/compute.ts`, `src/lib/strategyGate.ts`, `src/lib/composite/compositeAttribution.ts`,
  `src/lib/gdpr-export-manifest.ts`, `src/lib/database.types.ts`, `src/lib/types.ts`,
  `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`,
  `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`,
  `src/app/api/admin/strategy-review/route.ts`, `src/app/api/strategies/csv-finalize/route.ts`,
  `src/app/factsheet/[id]/v2/page.tsx`.
- **Frontend src/ tests: 14** (incl. the 2 GDPR axes below).
- **Backend analytics non-test: 7** — `analytics_runner.py`, `job_worker.py`,
  `ingestion/long_fetch.py`, `csv_validator.py`, + 3 acceptance scripts
  (`bybit_reconcile.py`, `deribit_acceptance.py`, `zavara_acceptance.py`).
- **Backend analytics tests: 18.**
- **SQL migrations: 8** (base `20260522111839`, per-key axis, allocator-date index,
  kind-check extends, `derive_broker_dailies_kind`, `strategy_keys`, 2 wizard/cleanup migs).
- **SQL functions: 3** — `persist_csv_daily_returns` (SECDEF),
  `enforce_csv_daily_returns_owner_coherence` (trigger), `enforce_strategy_keys_owner_coherence`.
- **SQL tests: 3** — incl. `test_csv_daily_returns_perkey_rls.sql`.
- **GDPR — 2 export axes** (date-range + `allocator_id`-indexed): `gdpr-export.test.ts`,
  `src/lib/__tests__/gdpr-export-per-key-dailies.test.ts` (+ manifest `gdpr-export-manifest.ts`).

## 3. Migration shape (SKETCH — executed in 106, NOT here)

Prose sketch only (no runnable DDL in this doc):
- Rename the table `csv_daily_returns` to `daily_returns`.
- Add column `basis text not null default 'cash_settlement'`.
- Adjust the primary key / unique key to include `basis` (was strategy_id+date+key axis;
  becomes strategy_id+date+basis+key axis).
- Carry forward the per-key axis, the `allocator_id`+date composite index, the
  owner-coherence trigger, per-key RLS, and the `persist_csv_daily_returns` SECDEF —
  renamed/repointed at the new table, hardened (`SET search_path=public,pg_temp`,
  REVOKE PUBLIC/anon/authenticated, service-role grant only), NOT widened.
- Backfill: migrate the folded `strategy_analytics_series` kinds (`mtm_daily_returns`,
  `cash_settlement`) into `basis`-tagged rows; existing `csv_daily_returns` rows default
  to `basis='cash_settlement'`.
- Repoint BOTH GDPR export axes (date-range + allocator-indexed) to the new table + tests.
- **Merge obligations (106):** migrations auto-apply to PROD on merge → test-project MCP
  catch-up BEFORE merge, `migration-reviewer` + `rls-policy-auditor` on the SECDEF/RLS/trigger carry.

## 4. Locked caveats (carry into 106)

- **(a) MED-1 read-gate is mandatory.** The 106 cash reader MUST route through the
  `shouldReadCashSettlementSeries` predicate family (`src/lib/factsheet/composite-read-path.ts`)
  before trusting a cash series row — this is the D3 single choke point against stale
  terminal-failure rows. Per LOW-4, the INERT-read grep tripwire is NOT proof of a
  landed reader (it misses a reader imported via a constant); the status-gate IS the guarantee.
- **(b) GDPR-completeness bonus.** `strategy_analytics_series` is ABSENT from the GDPR
  export manifest today. Folding user daily returns into the tall table makes them
  exportable via the existing date-range + allocator axes, closing a latent
  GDPR-completeness gap for free.
- **(c) Strict-atomicity finalize SECDEF (D5 honest boundary).** The optional
  transactional-finalize SECDEF RPC MAY ride 106's fold migration (which already carries
  DDL + catch-up + reviewers) — it MUST NOT ship in 105. 105 stays ordered-idempotent.
- **(d) Convention travel.** Benchmark identity (`benchmark_symbol`) and the
  densify / `nan_dates` conventions echo travel WITH the folded rows so the round-trip
  guard and the 106 reader can rebuild the scalar input from the sparse rows.

## 5. Non-goals of Phase 105 (hard)

- NO DDL / migration file / SECDEF written.
- NO reader repointed to `daily_returns`.
- NO flag flip, NO backfill executed.
- 105 ships ONLY: the `shouldReadCashSettlementSeries` predicate (uncalled) + this doc.
