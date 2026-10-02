# Phase 106: Cutover — flip + delete legacy + janitor — Research

**Researched:** 2026-07-14
**Domain:** Prod feature-flag cutover · legacy dead-code deletion (Python worker + Next routes) · prod DDL store-fold (dual-axis tall table) · cron/reliability
**Confidence:** HIGH on the code map (every claim re-grepped against source this session); MEDIUM on the series-store-fold shape (design not yet chosen — that is a discuss-phase decision, not a research fact)

> **No CONTEXT.md exists yet.** This research feeds a Fable discuss-phase → planner. The `## User Constraints` section below is populated from the LOCKED governing architecture + standing invariants in ROADMAP.md, because those bind this phase exactly as CONTEXT decisions would.

---

<user_constraints>
## User Constraints (binding — from ROADMAP standing invariants + the governing principle)

### Locked architecture (the governing principle — [[feedback_dailies_canonical_unified_derive]])
- **"Nothing bypasses the unified backbone; first dailies, then everything derives."** Phase 106 makes the queued backbone path THE path and deletes the legacy/dark alternatives. Every deletion must leave the backbone (`derive_basis_series` → `compute_all_metrics`) as the sole surviving derive route.

### Locked invariants (from ROADMAP §Standing invariants — LOCKED from v1.8/v1.9)
- **SC-4 byte-identity** — every existing single-key + published-composite factsheet (cash AND MTM) stays byte-identical across the flag flip and every deletion, unless a fix's blast radius is explicitly evidenced. This is the phase's hardest gate.
- **No-invented-data** — honest empty state / DQ marker, never a fabricated number.
- **Worker-only decryption** — key ciphertext never leaves the server.
- **Migrations auto-apply to prod on merge** — SECDEF-hardened, routed through migration-reviewer + rls-policy-auditor. Any DDL in this phase auto-applies to PROD the moment the PR merges.

### Locked prior decisions carried into 106
- **Series-store fold = tall table, NOT JSONB blob** (105 D6 decision, RECOMMENDED + locked in 105 planning): rename `csv_daily_returns` → `daily_returns` + add a `basis` column; MTM folds IN. Rationale: it is an allocator-indexed relational table with ~15 readers incl. 2 GDPR axes — a JSONB blob cannot serve those queries.
- **`trades_to_daily_returns_with_status` stays LIVE** (it is not part of the dark path).
- **105.1 teaser exception is PERMANENT** — onboarding preview is compute-unified / persist-nothing. Do NOT "re-discover" it as a bypass. The *lead-capture* teaser-series persistence (below) is NEW deferred scope, not a reversal.

### Claude's Discretion (research recommends; discuss-phase confirms)
- The **split** of Phase 106 into sub-phases and their sequence (this is the primary deliverable — see §Recommended Split).
- The series-store-fold migration SHAPE (online backfill vs cutover, how MTM's rich JSONB metadata maps onto a tall table).
- Whether the lead-capture teaser series is a 106 slice or its own phase.

### Deferred / out of scope (do NOT pull in)
- Tier-4 E1/E2/E3 (portfolio aggregation second-Sharpe, allocator equity reconstruction, matching) → v1.11.
- Leverage (107) and scenario-planner (108) backbone folds — later phases.
- `portfolio-stats.ts` / `health-score.ts` — stay live.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (ROADMAP §Phase 106 SC) | Research Support |
|----|-------------------------------------|------------------|
| BB-03 / SC-1 | `USE_COMPUTE_JOBS_QUEUE` flipped permanent via STAGED flip, FULL E2E green after each stage | §Scope 1 — flag map (TWO flags, not one); §Validation |
| BB-03 / SC-2 | All FOUR dark-path re-entry points retired BEFORE dark path deleted; grep proves ZERO live callers of `run_strategy_analytics` at delete time | §Scope 2 — re-entry map (found a 5th SITE); §Scope 3 |
| BB-03 / SC-3 | Legacy finalize branches DELETED (`run_strategy_analytics`, `routers/analytics.py`, `phase12_backfill_enqueue.py`, `_metrics_result_for` residue); `trades_to_daily_returns_with_status` KEPT | §Scope 3 — deletion blast radius |
| BB-03 / SC-4 | Series-store fold EXECUTED (`csv_daily_returns`→`daily_returns` + `basis` col, MTM folded); ~15 readers + RLS/SECDEF/migrations repointed; auto-applies to prod, objects verified | §Scope 4 — the DDL heavy hitter |
| BB-03 / SC-5 | `computing`-janitor cron reaps orphaned rows + `after()` fail-loud; `metrics_snapshot` retired only after its 3 repoints land | §Scope 5 + §Scope 6 |
</phase_requirements>

## Summary

Phase 106 is the prod-risk peak of v1.10: it flips prod onto the queued backbone permanently, deletes ~1,000–1,500 LOC of legacy compute + 2 files, executes a **prod DDL store-fold on a dual-axis GDPR-bearing table**, retires the onboarding `metrics_snapshot` home, stands up a reliability cron, and carries three 105/105.1 residuals. These are not one risk profile — they span "reversible env-var flip" to "irreversible DDL that auto-applies to prod on merge and touches GDPR export + RLS." Bundling them into one phase forces the safest item to wait on the riskiest, and forces one Fable red team to hold five unrelated blast radii in its head at once.

**The single most important finding: the ROADMAP names one cutover flag (`USE_COMPUTE_JOBS_QUEUE`) but the codebase has TWO independent gate systems.** `USE_COMPUTE_JOBS_QUEUE` is an env var read directly in the Next.js routes (`csv-finalize`, `finalize-wizard`, `keys/sync`); `process_key_unified_backbone` is a Supabase `feature_flags` kill-switch row (env fallback `PROCESS_KEY_UNIFIED_BACKBONE`) read via `isUnifiedBackboneActive()` (TS) and `is_unified_backbone_active()` (Python). Both must be permanently-on for the unified path, and each has its own reader set, its own kill-switch monitor cron, and its own fail-soft semantics. "Flip the flag permanent" is really "retire TWO flag systems" — and the kill-switch flag is the *rollback mechanism itself*, so deleting its reads removes the ability to revert. This is the first thing the discuss-phase must pin down.

**The second most important finding: the series-store fold is not a rename.** `csv_daily_returns` is a dual-axis tall table (`strategy_id` XOR `api_key_id`, plus a denormalized `allocator_id`), with 3 indexes, a SECDEF persist RPC, an owner-coherence trigger, owner-RLS policies, 2 distinct GDPR export axes, and ~15 prod readers across frontend + Python. The MTM series it must "fold in" lives in a *structurally different* store (`strategy_analytics_series`, `(strategy_id, kind)` PK, JSONB payload) carrying round-trip metadata (`densify_policy`, `nan_dates`, `gap_spans`, `conventions`, benchmark identity) that the 105 SC-4 mechanism DEPENDS on and that a flat `(date, daily_return DOUBLE)` row cannot hold. Folding these two into one table is a genuine schema-design problem, prod-DDL, GDPR-affecting, and irreversible-ish. It deserves its own sub-phase, its own migration-reviewer + rls-policy-auditor pass, and its own test-project MCP catch-up.

**Primary recommendation:** SPLIT into **106 (flip + dark-path retire/delete + janitor)**, **106.1 (series-store fold DDL)**, and **106.2 (metrics_snapshot retirement + lead-capture teaser series)** — sequenced strictly by risk and reversibility. Do the reversible, no-DDL flip-and-delete first behind the still-live kill-switch; do the irreversible DDL fold second in isolation; do the lead-capture product feature (which has genuinely open product questions) last or as its own phase. Details + the 5 discuss-phase decisions at the end.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Flag flip / kill-switch retire | API/Backend (Next routes) + Worker (Python) | Config (Vercel + Railway env) | Both flags read in TS routes AND Python worker; env pins live in Vercel/Railway |
| Dark-path deletion (`run_strategy_analytics`) | Worker (Python analytics-service) | API (thin HTTP wrapper `routers/analytics.py`) | Compute is worker-owned; the HTTP route is a thin re-entry to delete |
| Re-entry retirement | Split: Worker (flag, script) + API (keys/sync TS, compute-analytics HTTP) | — | Re-entry points span both runtimes — must be retired in both before the Python delete |
| Series-store fold | Database/Storage (DDL, RLS, SECDEF) | Worker (writers) + API (readers) + Frontend (queries) | Owned by the DB tier; blast radius reaches every tier that reads the table |
| `computing`-janitor | Worker/Cron (Python `routers/cron.py` or a new scheduled tick) | Database (the `computing` rows) | Reliability sweep over worker-owned state |
| `after()` fail-loud | API (Next.js `after()` in finalize routes) | Observability (Sentry) | `after()` is a Next.js server primitive; fail-loud = surface to Sentry |
| Lead-capture teaser series | Database (new store + RLS) + API (verify-strategy) | Product/CRM (lead linkage) | New persistence + contact linkage — a product feature, not backbone hygiene |

## Standard Stack

No external packages are installed in this phase — it is prod-cutover, deletion, DDL, and cron work on the existing stack. **`## Package Legitimacy Audit` is N/A (zero new dependencies).**

Existing tools this phase operates within (all already in the repo, versions from the running project):

| Tool | Role in 106 | Evidence |
|------|-------------|----------|
| Supabase Postgres migrations | The store-fold DDL; auto-applies to prod on merge to `supabase/migrations/**` | [[project_supabase_migrate_auto_on_push]]; CLAUDE.md |
| Next.js `after()` | Fire-and-forget finalize epilogue → the fail-loud target | `src/app/api/strategies/{csv-finalize,finalize-wizard}/route.ts` (10 routes use `after()`) [VERIFIED: grep] |
| FastAPI cron router | Existing `routers/cron.py` — the natural home for a `computing`-janitor tick | `analytics-service/routers/cron.py` [VERIFIED: grep] |
| Vercel Cron / existing cron routes | 8 crons under `src/app/api/cron/` incl. `flag-monitor` (already reads `process_key_unified_backbone`) | `ls src/app/api/cron/` [VERIFIED] |
| `reset_stuck_computing_rows.py` | Existing one-time stuck-`computing` reset script → the janitor's logic seed | `analytics-service/scripts/reset_stuck_computing_rows.py` [VERIFIED: read] |
| Vitest / pytest | The two suites the FULL E2E gate runs against (coverage-gated CI) | CLAUDE.md; `.planning/config.json` nyquist=true |

## SCOPE MAP — 7 items, each with file:line evidence + risk + DDL/reversibility/SC-4 + sequencing

> Every line number below was RE-GREPPED this session (2026-07-14, post-105.1). Where 105/105.1 already moved or deleted something, it is noted.

### Scope 1 — The prod flag flip (`USE_COMPUTE_JOBS_QUEUE` → permanent-on)

**Risk: HIGH.** **DDL: no.** **Reversible: YES (until the flag reads are deleted — then NO).** **SC-4 exposure: HIGH** — a prior flip already exposed 2 latent CSV bugs ([[project_unified_backbone_csv_flag_flip]]).

**Finding 1a — there are TWO flag systems, not one.** [VERIFIED: grep + read of both seams]

| Flag | Type | Read via | Reader sites (prod, non-test) |
|------|------|----------|-------------------------------|
| `USE_COMPUTE_JOBS_QUEUE` | Env var, read `=== "true"` inline | direct `process.env` in TS routes | `csv-finalize/route.ts:684, :1247`; `finalize-wizard/route.ts:890, :934`; `keys/sync/route.ts:183, :534` |
| `process_key_unified_backbone` | Supabase `feature_flags` row (kill-switch) + env fallback `PROCESS_KEY_UNIFIED_BACKBONE` | `isUnifiedBackboneActive()` (`src/lib/feature-flags.ts:111`) / `is_unified_backbone_active()` (`analytics-service/services/feature_flags.py:96`) | TS: `csv-validate:155`, `finalize-wizard:626`, `csv-finalize:1019`, `keys/sync:292`, `verify-strategy:75`. Python: the `/process-key` path + `csv_adapter.py:145`. Kill-switch monitors: `cron/flag-monitor/route.ts:61`, `cron/phase19-error-rollup/route.ts:41` |

**Implication (load-bearing for the discuss-phase):** "flip `USE_COMPUTE_JOBS_QUEUE` permanent" is under-specified. The full cutover requires deciding, for EACH flag independently: (a) pin the env permanently-on and leave the reads (cheap, keeps rollback), or (b) delete every branch and the flag entirely (true cutover, removes rollback). The `process_key_unified_backbone` row IS the rollback / auto-rollback kill-switch (`flag-monitor` cron auto-flips it off on error-rate spikes — `src/lib/feature-flags.ts:29-32`). Deleting its reads deletes the safety net. **Recommendation: pin BOTH envs permanently-on and KEEP the kill-switch reads through at least one stability window; delete the branches only after the fold (106.1) is also proven.** The "delete the flag reads" cleanup can be its own trailing slice — it is pure code-hygiene once prod has run permanent-on for a window.

**Finding 1b — full E2E surface to re-test after the flip** (a flip already broke CSV — [[project_unified_backbone_csv_flag_flip]]): CSV single-key, ccxt single-key, Deribit single-key, composite (stitch) — each in BOTH cash and MTM basis. Plus the onboarding sync-teaser arm (105.1) and the per-key allocator dashboard read (`queries.ts` per-key `csv_daily_returns`). See §Validation Architecture for the concrete map.

### Scope 2 — The 4 dark-path re-entry points (the ZOMBIE trap)

**Risk: CRITICAL (this is the sharpest trap).** **DDL: no.** **Reversible: retirement is reversible; the subsequent delete is NOT.** **SC-4 exposure: LOW directly, but a missed re-entry = a live strategy silently computed by the latent-buggy dark path (doesn't thread `cumulative_method`/`day_basis`).**

**The dark path core:** `run_strategy_analytics` (`analytics_runner.py:1208`) → direct `compute_all_metrics(` at `analytics_runner.py:1678`. Reached two ways: the job handler `run_compute_analytics_job` (`job_worker.py:1590`, calls it at `:1607`, dispatched for `kind=="compute_analytics"` at `job_worker.py:5831`), and the HTTP wrapper `routers/analytics.py:24`. [VERIFIED: grep — these are the ONLY two non-test invocations of `run_strategy_analytics`.]

The FOUR re-entry points that ROUTE traffic into that chain — all VERIFIED present this session:

| # | Re-entry point | Evidence | Enqueues / invokes | Retirement |
|---|----------------|----------|--------------------|-----------|
| 1 | `BROKER_DAILIES_VIA_FUNDING` flag path | def `job_worker.py:185`; **TWO enqueue sites** — sync epilogue `job_worker.py:1520` AND periodic re-sync `cron.py:451` | when `false`, enqueues `"compute_analytics"` instead of `"derive_broker_dailies"` | pin flag `true` permanent, then delete the ternary + the `else` branch at both sites |
| 2 | UNGUARDED `scripts/phase12_backfill_enqueue.py` | `:54` (`.eq("kind","compute_analytics")`), `:121` (`"kind":"compute_analytics"`) | bulk-enqueues `compute_analytics` for all published strategies | delete the script + its deploy caller `scripts/phase12_deploy.py:39,353` + tests |
| 3 | `legacyKeysSyncHandler` (TS) | def `keys/sync/route.ts:526`; calls `computeAnalytics(strategy_id)` at `:619`; reached at `:321` when `isUnifiedBackboneActive()` false | POSTs `/api/compute-analytics` (client `analytics-client.ts:162`) | delete the legacy arm + the `:292` `isUnifiedBackboneActive()` branch once the flag is permanent |
| 4 | HTTP `POST /api/compute-analytics` + job kind | `routers/analytics.py:15-24`; dispatch `job_worker.py:5831` | direct `run_strategy_analytics` / `run_compute_analytics_job` | delete `routers/analytics.py`, unregister the router, drop the `compute_analytics` dispatch arm |

**⭐ FLAGGED 5th SITE (new finding — the ROADMAP inventory named only ONE enqueue site for #1):** the `BROKER_DAILIES_VIA_FUNDING` revert path has **two** enqueue sites, not one — the sync_trades epilogue (`job_worker.py:1520`) that the inventory names, AND the periodic reconcile/re-sync in `cron.py:451`. Both must be retired together or a cron tick re-enqueues `compute_analytics` after the epilogue is cleaned. There is also a DB-level `compute_jobs.kind` CHECK constraint and the `TIMEOUT_PER_KIND` map entry (`job_worker.py:262`) that reference `compute_analytics` — dropping the kind means a migration to the CHECK constraint (minor DDL) + removing the timeout entry.

**Safe retirement ORDER (before any deletion):** (1) pin `BROKER_DAILIES_VIA_FUNDING=true` and both flags permanent-on; (2) delete/neuter #2 the unguarded script (highest blast radius — it can enqueue for *all* strategies with no gate); (3) retire #1's two enqueue sites; (4) retire #3 the TS legacy arm; (5) retire #4 the HTTP route + dispatch arm; (6) grep-gate ZERO live callers of `run_strategy_analytics`; (7) only THEN delete the dark path (Scope 3). A test already encodes this invariant negatively: `test_cash_basis_series_sc4.py:720` asserts exactly two `basis="cash_settlement"` persist sites and warns against a third being added "to `run_compute_analytics_job` — the 106-slated dark-path re-entry point."

### Scope 3 — The dark-path deletion

**Risk: HIGH.** **DDL: minor (drop `compute_analytics` from `compute_jobs.kind` CHECK).** **Reversible: NO (code deletion; revert = git).** **SC-4 exposure: MEDIUM** — the dark path is a *parallel* compute; deleting it must not remove a code path a live strategy still reaches (hence Scope 2 must fully precede this).

The "dark path" = the legacy trades-based `run_strategy_analytics` chain (`analytics_runner.py:1208`, computes at `:1678`) — distinct from the KEPT CSV path `run_csv_strategy_analytics` (`analytics_runner.py:2124`, now routes through `derive_basis_series` at `:2342` since 105). Deletion blast radius (~1,000–1,500 LOC + 2 files per the inventory):
- `run_strategy_analytics` + its private helpers in `analytics_runner.py` (careful: `run_csv_strategy_analytics` shares lifted helpers — `analytics_runner.py:133` notes shared structure; must NOT delete shared code).
- `routers/analytics.py` (whole file) + unregister from the FastAPI app.
- `run_compute_analytics_job` (`job_worker.py:1590`) + the `compute_analytics` dispatch arm (`:5831`) + `TIMEOUT_PER_KIND` entry (`:262`).
- `scripts/phase12_backfill_enqueue.py` + `phase12_deploy.py` wiring.
- `_metrics_result_for` residue — **already DELETED in 105** (grep-gate 0 repo-wide per STATE.md); confirm 0 at 106 delete time.
- **KEEP:** `trades_to_daily_returns_with_status` (explicit in SC-3), the shared helpers, `run_csv_strategy_analytics`, `compute_all_metrics`.
- Large test surface to prune: `test_analytics_runner.py` has ~40 `run_strategy_analytics` tests, `test_job_worker.py` several `run_compute_analytics_job` mocks, plus `test_phase12_backfill_enqueue.py`, `test_phase12_deploy.py`, `test_phase35_backfill_enqueue.py`. Deleting the code reddens these — plan the test deletion in the same wave.

### Scope 4 — The series-store fold (Tier-2 #3 EXECUTION — the DDL heavy hitter)

**Risk: HIGHEST in the phase.** **DDL: YES — auto-applies to prod on merge.** **Reversible: NO (irreversible-ish; a rename + backfill + reader repoint cannot be cleanly rolled back once prod writes land).** **SC-4 exposure: HIGHEST** — every existing factsheet reads its dailies from this store.

**Finding 4a — it is NOT a rename; the two stores have incompatible shapes.** [VERIFIED: read both DDLs]

`csv_daily_returns` (`supabase/migrations/20260522111839_...` + `..._per_key_axis.sql` + `..._allocator_date_index.sql`):
- Tall relational: `(id BIGINT IDENTITY PK)`, `strategy_id UUID` **XOR** `api_key_id UUID` (CHECK `num_nonnulls=1`), `allocator_id UUID` (denormalized for RLS), `date DATE`, `daily_return DOUBLE PRECISION`.
- 3 indexes: unique `(strategy_id,date)`, unique `(api_key_id,date)`, partial `(allocator_id,date) WHERE allocator_id IS NOT NULL`.
- SECDEF `persist_csv_daily_returns(p_user_id,p_strategy_id,p_rows)` (owner-checked, probe-oracle-closed) + owner-coherence trigger `enforce_csv_daily_returns_owner_coherence`.
- Owner-RLS policies (`csv_daily_returns_allocator_owner_select` etc.).

`strategy_analytics_series` (where MTM `mtm_daily_returns` + cash `cash_settlement` kinds live — `supabase/migrations/20260428120919_...`):
- `(strategy_id, kind)` PK, `payload JSONB`, deny-all RLS, read only via `fetch_strategy_lazy_metrics` SECDEF RPC.
- The MTM payload carries the 105 SC-4 round-trip metadata: `densify_policy`, `nan_dates`, `gap_spans`, `conventions`, and the benchmark identity (α/β/corr) — a rich object, NOT a flat `(date, return)` list.

**The core problem:** folding MTM into a tall `(date, daily_return DOUBLE)` table + `basis` column has NO home for the per-series metadata that the SC-4 anti-divergence reconstruction depends on. Options the discuss-phase must choose between: (a) tall table gets sidecar metadata columns / a companion `(strategy_id, basis)` metadata row; (b) keep MTM's metadata in a JSONB column on the folded table; (c) the tall table holds only the sparse `_drop_nonfinite` rows and the metadata stays in `strategy_analytics_series` (partial fold — defeats the "one store" goal). This is unresolved and is the single biggest design decision in the whole phase.

**Finding 4b — ~15 prod readers + 2 GDPR axes.** [VERIFIED: grep — 70 total files, ~15 non-test prod readers]
- Frontend/TS: `queries.ts` (per-key allocator dashboard blend, `:2600` etc.), `composite-read-path.ts`, `factsheet/compute.ts`, `compositeAttribution.ts`, `strategyGate.ts`, `types.ts`, `database.types.ts`, `SyncPreviewStep.tsx`, `discovery/[slug]/[strategyId]/page.tsx`, `factsheet/[id]/v2/page.tsx`, `admin/strategy-review/route.ts`, `csv-finalize/route.ts`.
- **GDPR (2 distinct axes — both must repoint):** `gdpr-export-manifest.ts` declares `csv_daily_returns` (strategy axis, `:849`) AND `csv_daily_returns_per_key` (allocator axis, projected bundle name, `:878-879`); `scripts/check-gdpr-export-coverage.ts:369,387` enforces both. A rename breaks the GDPR coverage gate unless both entries + the erasure-CASCADE allowlist are updated.
- Python writers/readers: `analytics_runner.py`, `csv_validator.py`, `long_fetch.py`, `job_worker.py`.
- SECDEF/schema: `persist_csv_daily_returns.sql`, `enforce_csv_daily_returns_owner_coherence.sql`, and 7 migrations reference the name.

**Finding 4c — migration shape + backfill.** A rename (`ALTER TABLE ... RENAME`) preserves data + indexes but breaks every reader atomically at merge time — so the reader repoint must ship in the SAME PR as the DDL (or use a compatibility view). Adding `basis` requires backfilling existing rows to `basis='cash_settlement'` (the current table is cash-only) and then migrating MTM rows OUT of `strategy_analytics_series` into the new table with `basis='mark_to_market'`. That MTM migration is the hard part (Finding 4a). **Test-project MCP catch-up is MANDATORY before merge** — the new SQL tests (RLS, owner-coherence, GDPR) will be RED-guarded and fail if the test project hasn't caught up ([[project_test_project_catchup_unmasks_stale_tests]], [[reference_db_test_ci_wiring]]).

### Scope 5 — The `metrics_snapshot` legacy-delete tail (collapse #4 remainder)

**Risk: MEDIUM.** **DDL: eventual (drop the column/table home after repoints).** **Reversible: repoints reversible; the final drop NOT.** **SC-4 exposure: LOW-MEDIUM** (onboarding/landing surfaces, not the core factsheet).

`metrics_snapshot` (on `strategy_verifications`) is the ONLY home for the landing card + 90-day public teaser + `matched_strategy_id`/`return_24h`/`equity_curve`. 105.1 satisfied the "onboarding routes through the backbone" half; retirement now waits ONLY on **3 reader repoints** (BYPASS-INVENTORY §DEAD-ROUTE #6):
1. landing card, 2. 90-day teaser, 3. `matched_strategy_id`·`return_24h`·`equity_curve`.
Prod readers (VERIFIED grep): TS — `verify-strategy/route.ts`, `landing/VerificationSection.tsx`, `landing/VerificationResults.tsx`, `analytics-schemas.ts`, `portfolio-analytics-adapter.ts`, `types.ts`, `database.types.ts`. Python — `process_key.py`, `portfolio.py`, `equity_reconstruction.py`, `strategy_matching.py`, and the ingestion adapters (WRITES). **Note:** the ingestion adapters WRITE `metrics_snapshot` — retiring the store means those writes must repoint too, not just the 3 named readers. Confirm write-side scope at plan time.

### Scope 6 — The `computing`-janitor cron + `after()` fail-loud

**Risk: LOW-MEDIUM (reliability, additive).** **DDL: no.** **Reversible: YES.** **SC-4 exposure: none.**

- **Janitor:** logic already exists as a one-time script `scripts/reset_stuck_computing_rows.py` (finds `strategy_analytics` rows stuck `computation_status='computing'` >5min with no active `compute_jobs` row, sets `failed`). 106 makes it a recurring cron. Natural home: `routers/cron.py` (Python, alongside the existing reconcile tick) OR a new `src/app/api/cron/` route (Vercel Cron, alongside the 8 existing crons). Recommendation: Python `routers/cron.py` — it already owns worker-state reconciliation and the reset logic is Python.
- **`after()` fail-loud:** the finalize epilogues use Next.js `after()` (`csv-finalize/route.ts`, `finalize-wizard/route.ts`) fire-and-forget — a silent failure there leaves a strategy stuck `computing`. Fail-loud = wrap the `after()` body so an exception is surfaced to Sentry (org `metaworld-fund-ltd` — [[reference_sentry_triage_workflow]]) rather than swallowed. This pairs with the janitor (janitor reaps; fail-loud prevents the silent-failure in the first place).

### Scope 7 — Carried residuals from 105 / 105.1

| Carry | What | Risk | DDL? | Recommendation |
|-------|------|------|------|----------------|
| **M2** — seam MTM prestamp precedes series persist | single-key broker-derive seam writes `_prestamp_payload["metrics_json_by_basis"]` (MTM scalar) at `job_worker.py:3163` BEFORE `persist_basis_series(...)` at `job_worker.py:3197` — the "harmful direction" (fresh scalar over stale/absent series). Pre-existing Phase-103 latent (verified at `4c23f94f`), NOT a 105 regression; composite path got ordering right. | MEDIUM | Maybe (if fixed via a finalize-RPC) | **Fold into 106 flip work** — but note it may WANT the series-store fold's finalize-RPC (SC-5 ordered-idempotent). If a strict-atomicity SECDEF RPC is built, it belongs with 106.1's fold DDL. Decide: fix M2 as a cheap ordering swap in 106, OR defer to 106.1 if it rides the RPC. |
| **M3** — round-trip guard is build-time, not runtime | the anti-divergence "guard" is a TEST harness + persisted `densify_policy`/`nan_dates` echo that ENABLES a future runtime reconstruct-check — there is no LIVE runtime guard today. | LOW | no | The operational reconstruct-check "lands with 106's reader." **In scope IF a folded-store reader is built in 106.1** — otherwise defer. Not a 106-flip concern. |
| **Lead-capture teaser series** | persist a teaser daily series keyed on the SUBMITTER (not the archived `00000…0001` sentinel) for sales outreach — overturns the 105.1 "no reader" premise. | MEDIUM-HIGH | YES (new store + RLS + lead linkage) | **Its own slice or its own phase.** It has OPEN PRODUCT questions (one lead-record store vs series linked to a verification/lead row — see [[project_teaser_series_persist_for_lead_contact]]) that are NOT backbone-hygiene. Do NOT bundle with the cutover. |

## Runtime State Inventory

> This IS a cutover/deletion/migration phase — inventory REQUIRED. "After every file is updated, what runtime systems still have the old string cached, stored, or registered?"

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `csv_daily_returns` table (prod ~2185+ rows at last migration snapshot) holds the canonical cash dailies under the OLD name; `strategy_analytics_series` holds MTM/cash JSONB kinds; `metrics_snapshot` on `strategy_verifications` holds teaser/landing data. | **Data migration** (rename + backfill `basis` + move MTM rows) — NOT just a code edit. Applies to prod on merge. |
| **Live service config (UI/DB, not git)** | `feature_flags` table row `process_key_unified_backbone` (the kill-switch — lives in Supabase, NOT git); prod env vars `USE_COMPUTE_JOBS_QUEUE`, `PROCESS_KEY_UNIFIED_BACKBONE`, `BROKER_DAILIES_VIA_FUNDING`, `PHASE_19_STABILITY_CACHE_TTL_S` in **Vercel** (Next) AND **Railway** (analytics worker) — two separate env stores. | **Manual/API** — pin envs in BOTH Vercel and Railway; decide fate of the `feature_flags` kill-switch row. |
| **OS/scheduler-registered state** | Vercel Cron schedules for the 8 `src/app/api/cron/*` routes (incl. `flag-monitor` reading the kill-switch); Railway worker process (`main_worker.py` dispatch loop) that binds job kinds at import; a NEW janitor cron must be REGISTERED (Vercel Cron entry or Railway schedule). | **Re-register** the janitor cron; verify `flag-monitor` still valid (or retire it with the flag). |
| **Secrets / env var names** | The flag env var NAMES above are read by name in code — deleting a flag's reads must not orphan an env still set, and pinning must use the EXACT name (`PROCESS_KEY_UNIFIED_BACKBONE` value must be literally `"on"`, `USE_COMPUTE_JOBS_QUEUE` literally `"true"` — VERIFIED comparison strings). | Update code + env together; no secret VALUE changes. |
| **Build artifacts / installed** | `compute_jobs.kind` CHECK constraint + `TIMEOUT_PER_KIND` map still list `compute_analytics` after code deletion; deleted Python modules leave stale `__pycache__`; deleted tests leave stale coverage baselines. | Migration to drop the kind from CHECK; clear caches; re-baseline coverage. |

**Nothing-found categories:** none are empty for this phase — every category has live state. This is why it is the prod-risk peak.

## Common Pitfalls

### Pitfall 1: Treating the cutover as one flag
**What goes wrong:** pinning `USE_COMPUTE_JOBS_QUEUE=true` while `process_key_unified_backbone` (or its env fallback) is still off/flappable → the `/process-key` Python path and 5 TS routes still take the legacy arm. **Avoid:** map and pin BOTH flags; treat the kill-switch row as the rollback mechanism and retire it LAST. **Warning sign:** an E2E surface still hits `run_strategy_analytics` after the "flip."

### Pitfall 2: Deleting the dark path before ALL re-entry points are dead
**What goes wrong:** the unguarded `phase12_backfill_enqueue.py` or the `cron.py:451` re-sync (the 5th site) enqueues `compute_analytics` after deletion → dispatch KeyError or a silently-skipped compute → a strategy stuck `computing`. **Avoid:** grep-gate ZERO live callers (test already scaffolds this) AND drop the `compute_analytics` kind from the CHECK constraint so a stale enqueue fails loud at insert. **Warning sign:** any `.eq("kind","compute_analytics")` or `p_kind: "compute_analytics"` remaining at delete time.

### Pitfall 3: Series-store fold loses the SC-4 round-trip metadata
**What goes wrong:** MTM's `densify_policy`/`nan_dates`/`gap_spans`/`conventions`/benchmark-identity JSONB has no home in a flat `(date, return)` tall table → the 105 SC-4 reconstruction can't reproduce byte-identity → factsheet drift. **Avoid:** design the metadata home BEFORE the migration (Finding 4a options); prove SC-4 with a golden byte-identity sweep on the folded store. **Warning sign:** the fold migration only maps `(date, daily_return)` and drops payload keys.

### Pitfall 4: DDL merges before test-project catch-up
**What goes wrong:** the RED-guarded new RLS/SECDEF/GDPR SQL tests fail in CI because the test project lags prod schema ([[project_test_project_catchup_unmasks_stale_tests]]). **Avoid:** apply the fold migration to the test project via Supabase MCP BEFORE merge; run migration-reviewer + rls-policy-auditor. **Warning sign:** `supabase/tests/test_*.sql` red on the fold PR.

### Pitfall 5: GDPR export silently breaks on the rename
**What goes wrong:** `csv_daily_returns` is exported on TWO axes (strategy + per-key) with an erasure-CASCADE allowlist; a rename that misses `gdpr-export-manifest.ts` or `check-gdpr-export-coverage.ts` fails the GDPR coverage gate or (worse) drops a user-data axis from exports. **Avoid:** repoint both GDPR entries + the coverage checker + the CASCADE allowlist in the same PR; the coverage gate is CI-enforced. **Warning sign:** `check-gdpr-export-coverage.ts` red or a missing bundle key.

## Recommended Split (PRIMARY DELIVERABLE)

The phase spans four incompatible risk profiles. Sequence strictly by reversibility + blast radius, so the safe work does not wait on the dangerous work and each Fable red team holds ONE blast radius.

### **Phase 106 — Flip + dark-path retire/delete + janitor (NO DDL, reversible-first)**
- Scope 1 (flip BOTH flags permanent-on via a STAGED flip; KEEP kill-switch reads for the stability window), Scope 2 (retire all 4 re-entry points + the 5th `cron.py:451` site), Scope 3 (delete the dark path once grep-gate is 0; minor CHECK-constraint DDL to drop the `compute_analytics` kind), Scope 6 (janitor cron + `after()` fail-loud), Scope 7-M2 (cheap ordering swap).
- Why first: mostly reversible until the deletes; runs behind the still-live kill-switch; no store migration; SC-4 is protected by "nothing reads a new store" (no schema change). This is the highest-value, lowest-irreversible-risk cut.
- Gate to advance: prod runs permanent-on for a full stability window with FULL E2E green (all 8 basis×connector surfaces) before touching DDL.

### **Phase 106.1 — Series-store fold (the DDL, isolated, irreversible)**
- Scope 4 (rename → `daily_returns` + `basis` col + MTM fold + ~15 reader repoints + 2 GDPR axes + RLS/SECDEF/owner-coherence + test-project catch-up), plus Scope 7-M3 (runtime reconstruct-check reader) and the M2 finalize-RPC IF it rides the fold.
- Why isolated: only irreversible prod DDL in the milestone; auto-applies on merge; touches GDPR + RLS; needs migration-reviewer + rls-policy-auditor + MCP catch-up; the metadata-home design (Finding 4a) is an unsolved schema problem deserving its own research/discuss cycle.
- Depends on: 106 (unified path must be the only path before the store it feeds is reshaped).

### **Phase 106.2 — `metrics_snapshot` retirement + lead-capture teaser series (product + cleanup)**
- Scope 5 (3 reader repoints + write-side repoint, then retire the `metrics_snapshot` home) + Scope 7 lead-capture (new SUBMITTER-keyed store + RLS + lead linkage).
- Why last / possibly own phase: lead-capture has OPEN PRODUCT questions (not backbone hygiene) and new DDL/RLS; `metrics_snapshot` retirement is independent of the fold. Bundling product-feature ambiguity into the cutover is the classic scope-creep trap.

**Alternative if the team wants fewer phases:** merge 106.2's `metrics_snapshot` cleanup into 106.1 (both are DDL/reader-repoint work) and spin lead-capture out entirely. But keep the flip+delete (106) and the fold DDL (106.1) firmly separate — that boundary is the one non-negotiable split.

## The 3–5 highest-stakes decisions the Fable discuss-phase MUST pressure-test

1. **TWO flags, and the rollback question.** Confirm both `USE_COMPUTE_JOBS_QUEUE` (env) and `process_key_unified_backbone` (kill-switch row + `PROCESS_KEY_UNIFIED_BACKBONE` env) are in scope. Decide per flag: pin-and-keep-reads (retains auto-rollback via `flag-monitor`) vs delete-branches (true cutover, removes the safety net). **Recommendation to pressure-test: pin both, keep the kill-switch reads through ≥1 stability window, delete branches only after 106.1.** Getting this wrong either leaves a half-cutover or removes rollback before the DDL lands.

2. **The series-store-fold metadata home (Finding 4a).** MTM's round-trip JSONB metadata (`densify_policy`/`nan_dates`/`gap_spans`/`conventions`/benchmark-identity) has no home in a flat tall table, yet SC-4 reconstruction depends on it. Decide: sidecar columns, a JSONB metadata column on the folded table, or a partial fold. This is the single design decision that determines whether the fold can preserve byte-identity — it must be settled before ANY migration is drafted.

3. **Is the fold even in the same phase as the flip?** Pressure-test the split. The flip+delete is reversible-until-delete and no-DDL; the fold is irreversible prod DDL touching GDPR/RLS. Confirm they are separate phases (106 vs 106.1) so the safe work ships and stabilizes before the dangerous DDL, and so each red team scopes one blast radius.

4. **Lead-capture teaser series: 106 slice or its own phase, and what shape?** It overturns the 105.1 "no reader" premise and introduces a new SUBMITTER-keyed store + RLS + lead/contact linkage — a PRODUCT feature with open questions (one lead-record store with series+contact, vs series linked to an existing verification/lead row — [[project_teaser_series_persist_for_lead_contact]]). Decide whether it belongs in this milestone at all, or defers as its own phase; do not let its ambiguity gate the cutover.

5. **The 5th re-entry site + the `compute_analytics` kind teardown.** Confirm the `cron.py:451` periodic-re-sync enqueue is retired together with the `job_worker.py:1520` epilogue (the inventory named only one), and that dropping the `compute_analytics` kind from the `compute_jobs.kind` CHECK constraint + `TIMEOUT_PER_KIND` is sequenced AFTER all enqueue sites die but so a stray enqueue fails loud. A missed enqueue site = a live strategy silently computed by the latent-buggy dark path.

## Validation Architecture

> nyquist_validation = true (`.planning/config.json`) — included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`analytics-service/`, `--cov-fail-under=80`) + Vitest v8 (`src/`, coverage-gated: lines 82/stmts 80/fns 74/branches 72) |
| Config file | `analytics-service/pytest.ini` (+ conftest); `vitest.config.ts` |
| Quick run (Python) | `cd analytics-service && python -m pytest tests/test_job_worker.py tests/test_analytics_runner.py -x` |
| Quick run (TS) | `npx vitest run src/app/api/keys/sync src/lib/feature-flags` |
| Full suite | `cd analytics-service && python -m pytest` ; `npx vitest run --coverage` |

### Phase Requirements → Test Map (106 flip+delete slice)
| Req | Behavior | Test Type | Automated Command | Exists? |
|-----|----------|-----------|-------------------|---------|
| SC-1 | permanent-on flip, all 8 surfaces byte-identical | golden/SC-4 | `pytest tests/test_cash_basis_series_sc4.py -x` + composite golden | ✅ (extend) |
| SC-2 | zero live callers of `run_strategy_analytics` at delete | grep-gate | `test_cash_basis_series_sc4.py:720` seam-count test (extend to run_strategy_analytics) | ✅ (extend) |
| SC-3 | dark path gone, `trades_to_daily_returns_with_status` kept | unit + grep | new `test_dark_path_deleted.py` | ❌ Wave 0 |
| SC-5 | janitor reaps stuck `computing`; `after()` fail-loud | integration | new cron test in `test_cron_router.py` | ❌ Wave 0 (seed from `reset_stuck_computing_rows.py`) |

### Full E2E surface after EACH flip stage (Pitfall 1/2)
CSV · ccxt · Deribit · composite — each in cash AND MTM (8 cells) + onboarding sync-teaser + per-key allocator dashboard read. A prior flip broke CSV silently ([[project_unified_backbone_csv_flag_flip]]) — do not treat any cell as "obviously fine."

### Sampling Rate
- **Per task commit:** touched-suite quick run.
- **Per wave merge:** full pytest + `vitest run --coverage` (coverage is a blocking CI gate).
- **Phase gate:** full suite green + SC-4 golden sweep + (106.1) test-project MCP catch-up applied.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_dark_path_deleted.py` — SC-2/SC-3 grep-gate ZERO `run_strategy_analytics` callers + kind removed from CHECK.
- [ ] `analytics-service/tests/test_cron_router.py` janitor case — SC-5 stuck-`computing` reap (seed logic from `reset_stuck_computing_rows.py`).
- [ ] (106.1) `supabase/tests/test_daily_returns_rls.sql` + GDPR coverage extension for the renamed table — RED-guarded; needs test-project catch-up.
- [ ] Extend `test_cash_basis_series_sc4.py` seam-count assertion to also gate `run_strategy_analytics` invocations.

## Security Domain

> `security_enforcement` absent from config → enabled. This phase is DDL/RLS/SECDEF-heavy (fold) + a prod flag cutover — security is central.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | **yes** | The folded `daily_returns` table must preserve `csv_daily_returns`'s owner-RLS (`allocator_id = auth.uid()`) + owner-coherence trigger + probe-oracle-closed SECDEF. Any RLS gap on rename = cross-tenant dailies leak. |
| V5 Input Validation | yes | SECDEF `persist_*` RPCs keep the 22023 array-typeof guard + 5000-row cap on the renamed function. |
| V6 Cryptography | no (worker-only decryption invariant unchanged; no ciphertext moves) | — |
| V7 Error Handling / Logging | yes | `after()` fail-loud → Sentry (org `metaworld-fund-ltd`); janitor logs stuck rows; no silent finalize failure. |
| V8/V9 Data Protection (GDPR) | **yes** | Both GDPR export axes + the erasure-CASCADE allowlist must survive the rename; a missed axis = a GDPR data-completeness violation. |

### Known Threat Patterns for this cutover
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| RLS lost on table rename → cross-tenant dailies read | Information Disclosure | rls-policy-auditor on the fold PR; re-create owner policies + owner-coherence trigger explicitly; SQL RLS test (RED-guarded) |
| SECDEF search_path / owner-check regression on renamed RPC | Elevation of Privilege | migration-reviewer; keep `SET search_path=public,pg_catalog`; re-run probe-oracle test |
| Stale `compute_analytics` enqueue after delete → silent no-compute | Denial of Service | drop kind from CHECK so insert fails loud; grep-gate 0 enqueue sites |
| Kill-switch removed before stability proven → no rollback on latent bug | (availability) | keep `process_key_unified_backbone` reads through ≥1 window; delete branches last |
| GDPR export axis dropped on rename | Compliance | repoint both `gdpr-export-manifest.ts` entries + coverage checker in the same PR (CI-gated) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 105 D6 "tall table, rename + basis col" fold decision is still binding (not superseded by a later discuss) | Scope 4 / User Constraints | If superseded, the whole 106.1 design changes |
| A2 | Prod `csv_daily_returns` row count is near the migration-snapshot ~2185 (a small table → cheap rewrite) | Scope 4 Finding 4c | If large now, the rename/backfill needs CONCURRENTLY + online strategy |
| A3 | The stability-window discipline from Phase 19 (`PHASE_19_STABILITY_CACHE_TTL_S`, `flag-monitor`) is the intended rollback path for this flip too | Scope 1 / Decision 1 | If the team wants a hard cutover with no window, sequencing changes |
| A4 | `metrics_snapshot` ingestion-adapter references are WRITES that must repoint (not just the 3 named readers) | Scope 5 | Under-scoped retirement if writes are missed |
| A5 | The lead-capture teaser series is genuinely deferred/optional for this milestone | Scope 7 | If it's a hard v1.10 requirement, it can't be spun out |

## Open Questions
1. **What is prod's current `csv_daily_returns` row count and growth rate?** — needed to choose online-backfill vs cutover-rewrite for the fold (A2). Recommendation: query prod via Supabase MCP at 106.1 plan time.
2. **Does the `flag-monitor` auto-rollback still make sense post-cutover, or is it retired with the flag?** — affects whether the kill-switch reads stay.
3. **One store or two for lead-capture (series+contact vs series linked to a lead row)?** — open product question ([[project_teaser_series_persist_for_lead_contact]]).

## Environment Availability
| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (test-project catch-up) | 106.1 DDL fold | ✓ (per memory; gsd-executor has none — human/MCP does it) | — | Manual apply_migration; MANDATORY before merge |
| Vercel env + Cron | flag pin + janitor | ✓ | — | — |
| Railway env + worker | Python flag pin | ✓ | — | — |
| Sentry (metaworld-fund-ltd) | `after()` fail-loud target | ✓ (read-only MCP) | — | log.error |

**Blocking:** none for 106 (flip/delete). 106.1 is BLOCKED on test-project MCP catch-up before merge (not a tool gap, a sequencing gate).

## Sources

### Primary (HIGH confidence — re-grepped/read this session)
- `.planning/ROADMAP.md` §Phase 106 (+ Phases 104/105/105.1, coverage matrix) — read
- `.planning/BACKBONE-BYPASS-INVENTORY.md` (Tier-2 collapses + DEAD-ROUTE MAP) — read
- `.planning/STATE.md` (resume anchor, 105/105.1 CLOSED notes, M2/M3 carries) — read
- `src/lib/feature-flags.ts` + `analytics-service/services/feature_flags.py` — read (TWO-flag finding)
- `analytics-service/services/analytics_runner.py` (:1208 dark path, :1678 compute, :2124/:2342 CSV kept) — grep
- `analytics-service/services/job_worker.py` (:185/:1520 flag, :1590 handler, :3163/:3197 M2 seam, :5831 dispatch) — grep
- `analytics-service/routers/analytics.py` (:24) + `routers/cron.py` (:451 5th site) — read
- `analytics-service/scripts/phase12_backfill_enqueue.py` (:54/:121) + `reset_stuck_computing_rows.py` — read
- `src/app/api/keys/sync/route.ts` (:321/:526/:619) — grep
- `supabase/migrations/20260522111839_csv_daily_returns.sql` + `..._per_key_axis.sql` + `..._allocator_date_index.sql` + `20260428120919_strategy_analytics_series.sql` — read (fold shape)
- `src/lib/gdpr-export-manifest.ts` (:849/:878) + `scripts/check-gdpr-export-coverage.ts` (:369/:387) — grep (GDPR axes)
- `analytics-service/services/basis_series.py` (`_KIND_BY_BASIS`, round-trip metadata) — read

### Secondary (MEDIUM — memory / prior-phase records)
- [[project_unified_backbone_csv_flag_flip]], [[project_milestone_v1_10_backbone_unification]], [[feedback_dailies_canonical_unified_derive]], [[project_teaser_series_persist_for_lead_contact]], [[project_test_project_catchup_unmasks_stale_tests]], [[reference_db_test_ci_wiring]], [[project_supabase_migrate_auto_on_push]]

## Metadata
**Confidence breakdown:**
- Flag map (2-flag finding): HIGH — both seams read this session.
- Dark-path re-entry map (incl. 5th site): HIGH — all invocations grepped; only 2 non-test callers of `run_strategy_analytics` confirmed.
- Series-store fold shape: MEDIUM — table/store DDLs read, but the metadata-home design is an open decision, not a fact.
- Split recommendation: HIGH — driven by evidenced reversibility/DDL/blast-radius differences.

**Research date:** 2026-07-14
**Valid until:** 2026-07-28 (fast-moving — the codebase is under active 106 planning; re-grep line numbers at plan time).
