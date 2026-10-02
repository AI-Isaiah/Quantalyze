# Phase 104: Unified queued path persists (process_key_long) — Research

**Researched:** 2026-07-14
**Domain:** Python analytics-service worker pipeline — dailies-canonical backbone unification (cash single-key)
**Confidence:** HIGH (code-verified seams + flag topology; SC-4 divergence analysis MEDIUM-HIGH)

## Summary

Phase 104 = BB-01. The stated premise — "`process_key_long` is a scaffold that never persists trades/positions/analytics" — is **STALE**. That was true at investigation time (2026-05-27, `.planning/phase-19/QUEUED-PATH-COMPLETION-PLAN.md`) but was **FIXED + DEPLOYED + E2E-verified in prod** (PR #335/#336, v0.24.10.8/.9). Today `run_process_key_long_job` (`analytics-service/services/ingestion/long_fetch.py`) advances the verification state machine and then **delegates persistence** by enqueuing a proven tail job — `sync_trades` (fill-based okx/binance/bybit) or `derive_broker_dailies` (ledger deribit) — which persists the return series (`csv_daily_returns`) and auto-chains to `compute_analytics` / `compute_analytics_from_csv`, writing `strategy_analytics` and flipping `computation_status='complete'` (`long_fetch.py:474-527`). So analytics ARE persisted — via the **legacy compute path**, not via the Phase-103 shared route `derive_basis_series`.

Therefore the real Phase-104 work is **not** "wire up persistence from scratch." It is: **route the CASH persist that the queued path lands on through the Phase-103 shared `derive_basis_series` route** — the single-key analogue of what Phase 103 did for MTM. Concretely, the cash return series the queued path already computes (in `derive_broker_dailies`, `job_worker.py`) gets an **additive** canonical persist as a `strategy_analytics_series` row with `kind='cash_settlement'` (added to `_KIND_BY_BASIS`, `basis_series.py:61`) via `persist_basis_series`, exactly mirroring the MTM persist that sits at `job_worker.py:2934-3136`.

**The central SC-4 finding (load-bearing — read `## Common Pitfalls` Pitfall 1):** you CANNOT naively make the cash **scalars** a cache of a `derive_basis_series` re-derive and preserve byte-identity. `derive_basis_series` does `_drop_nonfinite` → `gap_fill_daily_returns` (0.0-fill) → `compute_all_metrics`. The legacy cash scalar path (`analytics_runner.py:2246-2318`) deliberately does the **opposite** on interior gaps: for broker sources it **reinstates** NaN interior breaks so the TWR segmenter honors them (DQ-03, suffix-only headline); for user CSV it leaves the series **sparse** (no 0.0 weekend fill). Routing cash scalars through `derive_basis_series` would **bridge broker guard-day breaks** and **0.0-fill user-CSV gaps** → different Sharpe/vol/CAGR → **SC-4 violation**. So Phase 104 must persist the cash **series** additively (dark, no reader repoint) while leaving the authoritative scalar compute UNTOUCHED. Making scalars a cache of the series — and reconciling the NaN/gap-fill divergence — is **Phase 105** (delete `_metrics_result_for`, composite, `periods_per_year` collapse), per ROADMAP.

**Primary recommendation:** In the single-key broker-derive seam (`job_worker.py`, `run_derive_broker_dailies_job`, right next to the existing MTM `derive_basis_series` block at :2934-3136), add an **additive** cash-series persist: `derive_basis_series(cash_returns, benchmark, conventions…) → persist_basis_series(basis="cash_settlement")`. Add `"cash_settlement"` to `_KIND_BY_BASIS`. Change **nothing** about `csv_daily_returns`, `strategy_analytics.metrics_json`, or `analytics_runner.py`'s scalar compute (SC-4 held by construction — authoritative readers untouched). No DDL, no new SECDEF fn (reuse the already-hardened `upsert_strategy_analytics_series_batch`). Prove SC-4 with a pure-Python dual-run byte-identity test (pattern: `tests/test_native_nav_sc4_identity.py`).

## User Constraints (from orchestrator brief + REQUIREMENTS.md invariants)

> No CONTEXT.md exists yet (`has_context: false`). These LOCKED constraints come from the Phase-104 orchestrator brief and the v1.10 standing invariants (`REQUIREMENTS.md:9`). The planner MUST honor them; `discuss-phase` should confirm the scope-interpretation items flagged `[ASSUMED]` in `## Assumptions Log`.

### Locked Decisions
1. **BEHIND THE FLAG — no prod-visible behavior change.** Prod runs `process_key_unified_backbone='on'`; the persist added this phase is **additive/dark** (a new `strategy_analytics_series` row no factsheet reader reads yet), mirroring how Phase 103 added `mtm_daily_returns`. Reader repoint + flag cutover = Phase 106.
2. **SC-4 byte-identity:** the queued path's CASH results must be byte-identical to the legacy `process_key`/finalize path. Non-negotiable — a 106 flag flip must be a no-op for cash.
3. **Dailies-canonical:** persist via the Phase-103 `derive_basis_series` / `persist_basis_series` shared route. Do NOT build a parallel derive. Cash "joins" via `_KIND_BY_BASIS["cash_settlement"]`.
4. **No new valuation math.** `derive_basis_series` composes existing primitives only (`_drop_nonfinite`, `gap_fill_daily_returns`, `compute_all_metrics`, `_consecutive_spans`).
5. **Migrations auto-apply to PROD on merge** → **prefer NO DDL** (achievable: `strategy_analytics_series.kind` is unconstrained TEXT — "Add a new kind = INSERT a new row; no ALTER TABLE", migration `20260428120919:83`). Any SECDEF fn must be hardened (search_path + REVOKE PUBLIC/anon/authenticated) + routed through migration-reviewer + rls-policy-auditor. **This phase needs neither** if it reuses `upsert_strategy_analytics_series_batch` (already SECURITY DEFINER + `SET search_path = public, pg_temp` + RLS deny-all + service-role-only, migration `20260428120919:34-53`).
6. **Composite is OUT OF SCOPE for 104** (Phase 105). 104 = single-key cash.

### Claude's Discretion
- Exact placement of the cash-series persist call (recommended: alongside the MTM block in `run_derive_broker_dailies_job`).
- Test fixture shape for the SC-4 dual-run harness.
- Whether to also persist a `cash_settlement` series for the fill-based `sync_trades` path when `BROKER_DAILIES_VIA_FUNDING` is off (see `## Open Questions` Q3).

### Deferred Ideas (OUT OF SCOPE — belong to 105/106)
- Deleting `_metrics_result_for` (`job_worker.py:4178`); routing composite cash through `derive_basis_series`; collapsing the two `periods_per_year` rules — **Phase 105**.
- Making cash **scalars** a cache of the persisted cash series (requires reconciling the NaN/gap-fill divergence) — **Phase 105**.
- Series-store fold (`csv_daily_returns`→`daily_returns` + `basis` column) — decided in 105, executed 106.
- `USE_COMPUTE_JOBS_QUEUE` permanent flip, dark-path deletion, janitor cron — **Phase 106**.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BB-01 | `process_key_long` (unified queued path) actually PERSISTS trades/positions/analytics via the Phase-103 shared route, behind the existing flag (no prod behavior change yet). | Premise is stale — persistence already happens via delegated tail jobs (`long_fetch.py:474-527`). The remaining backbone-unity work is routing the CASH series through `derive_basis_series`/`persist_basis_series` additively (`basis="cash_settlement"`), mirroring the Phase-103 MTM block at `job_worker.py:2934-3136`. SC-4 held by leaving authoritative scalars untouched (see Pitfall 1). No DDL (kind is unconstrained TEXT). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Queued key ingestion + state machine | API/Backend (Railway analytics worker) | — | `long_fetch.py` / `job_worker.py`; no frontend change this phase |
| Cash daily-return series compute | API/Backend (`derive_broker_dailies`) | — | Already computes the cash `returns` series; the persist seam lives here |
| Canonical series persist | Database (`strategy_analytics_series` via SECDEF RPC) | API/Backend | `persist_basis_series` → hardened `upsert_strategy_analytics_series_batch` |
| Cash scalar authority (unchanged) | API/Backend (`analytics_runner.py`) | Database (`strategy_analytics.metrics_json`) | Stays authoritative in 104; becomes a cache-of-series in 105 |
| Flag gating / cutover | Frontend env (`USE_COMPUTE_JOBS_QUEUE`) + Backend flag (`process_key_unified_backbone`) | — | Cutover is Phase 106; 104 ships dark |

## Standard Stack

No new packages. This is internal Python worker refactoring on the existing analytics-service stack.

### Core (existing, in-repo — reuse verbatim)
| Module / Symbol | Location | Purpose | Why standard |
|-----------------|----------|---------|--------------|
| `derive_basis_series` | `analytics-service/services/basis_series.py:102` | Turn an already-computed daily-return series into (sparse rows, scalar cache, gap mask, conventions echo) | The LOCKED shared route; Phase 103 built it for exactly this adoption |
| `persist_basis_series` | `services/basis_series.py:167` | Authoritative single-row upsert (or heal-delete) of a basis series row | Already used for MTM; single-row PK `(strategy_id, kind)` = no span-reconcile |
| `_KIND_BY_BASIS` | `services/basis_series.py:61` | basis→kind map; add `"cash_settlement": "cash_settlement"` (kind string TBD) | The documented join point for cash |
| `upsert_strategy_analytics_series_batch` (RPC) | migration `20260428120919:34` | SECURITY-DEFINER atomic batch upsert | Already hardened (search_path + RLS deny-all + service-role grant); reuse, no new SECDEF |
| `compute_all_metrics` | `services/metrics.py:398` | Branchless pure `(dailies, conventions)` → scalars | The shared kernel every path converges on |
| `gap_fill_daily_returns` | `services/broker_dailies.py:123` | Reindex to dense calendar, 0.0-fill no-activity days | The densifier `derive_basis_series` composes |

### Conventions the cash persist MUST thread (byte-identity anchors)
Cash conventions are NOT constants — they come from `asset_class` + `returns_denominator_config`, identical to the MTM block and the legacy cash headline (`analytics_runner.py:2288-2316`, `job_worker.py:2945-2967`):
- `periods_per_year` = `periods_per_year_for_asset_class(strategy_row["asset_class"])` — √365 crypto / √252 traditional (#597).
- `cumulative_method` / `day_basis` = from `parse_returns_denominator_config(...)` (Zavara → `simple` + active); **absent ⇒ `geometric` + `calendar`** (byte-identical to the pre-Fix-A recompute).

**Installation:** none. `npm view` / `pip index` N/A — no external dependency added.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All work reuses in-repo modules. slopcheck / registry verification skipped by design (no new dependency). If the planner later proposes any package, gate it behind `checkpoint:human-verify` per protocol.

## Architecture Patterns

### System Data Flow (queued cash path, today + the 104 addition)

```
/process-key (flow_type ∈ {onboard,resync}, process_key_unified_backbone=ON)
        │
        ▼
  enqueue compute_jobs kind='process_key_long'
        │
        ▼
  run_process_key_long_job  (long_fetch.py)
    ├─ validate → encrypt → advance strategy_verifications state machine
    └─ enqueue TAIL job (long_fetch.py:497-514):
         ├─ fill-based (okx/binance/bybit) → 'sync_trades'
         │        └─ run_sync_trades_job → enqueue
         │             ('derive_broker_dailies' if BROKER_DAILIES_VIA_FUNDING
         │               else legacy 'compute_analytics')   ← Q3 branch
         └─ ledger (deribit)             → 'derive_broker_dailies'
                                  │
                                  ▼
        run_derive_broker_dailies_job  (job_worker.py ~1900-3140)
          ├─ combine_realized_and_funding → cash `returns`  (DENSE, 0.0-filled,
          │        guard days = NaN → SKIPPED at write → ABSENT)
          ├─ UPSERT csv_daily_returns   (cash SERIES, authoritative)   :2909
          ├─ [MTM] derive_basis_series(mtm_returns) → persist kind=mtm_daily_returns  :2991-3136
          │  ◀── 104 ADDS HERE: derive_basis_series(cash `returns`)
          │       → persist_basis_series(basis="cash_settlement")   (ADDITIVE / DARK)
          ├─ PRESTAMP strategy_analytics (DQ flags, metrics_json_by_basis)  :3104-3110
          └─ enqueue 'compute_analytics_from_csv'   :3138
                                  │
                                  ▼
        run_csv_strategy_analytics  (analytics_runner.py ~2200-2318)
          ├─ load returns from csv_daily_returns
          ├─ broker → REINDEX dense → interior gaps become NaN AGAIN  :2272-2277  (DQ-03)
          │  user-CSV → stays SPARSE (no gap-fill)                    :2259-2262
          └─ compute_all_metrics(returns) → strategy_analytics.metrics_json  :2318
                 (cash SCALARS, authoritative — UNTOUCHED by 104)
```

### Pattern 1: Additive dark-series persist (the Phase-103 template)
**What:** Persist a new `strategy_analytics_series` row for a basis WITHOUT repointing any reader. The row is "dark" until a later phase's frontend/reader change consumes it.
**When to use:** Every step of the backbone merge that must land in prod with zero visible change (104, 105 composite).
**Example (the MTM precedent 104 mirrors for cash):**
```python
# Source: analytics-service/services/job_worker.py:2991-3136 (Phase 103 MTM)
_mtm_basis_result = derive_basis_series(
    mtm_returns, _mtm_benchmark_rets,
    periods_per_year=_mtm_periods,
    cumulative_method=_mtm_cumulative, day_basis=_mtm_day_basis,
)
# ... success-matrix gating (persist result, else result=None to HEAL/delete) ...
def _persist_mtm_series(result=_persist_mtm_series_result) -> None:
    persist_basis_series(ctx.supabase, strategy_id, basis="mark_to_market", result=result)
await db_execute(_persist_mtm_series)
```
For cash: same shape, `basis="cash_settlement"`, fed the cash `returns` variable already in scope, threading the cash conventions (not the MTM ones — same values though, computed identically).

### Pattern 2: Success-matrix + heal-delete (Pitfall 5 discipline)
`persist_basis_series(result=None)` DELETEs any stale row. Cash persist must mirror the MTM authoritative-write matrix: a fresh row only on a clean derive; degrade/compute-reject/not-attempted → `result=None` (delete) so a stale cash-series row can never outlive an authoritative-NULL/absent state (`job_worker.py:3112-3136`, `basis_series.py:180-186`).

### Anti-Patterns to Avoid
- **Making cash scalars a cache of `derive_basis_series` in 104.** Breaks SC-4 (Pitfall 1). That reconciliation is Phase 105.
- **Touching `analytics_runner.py:2318` or `csv_daily_returns` writes in 104.** Those are the authoritative cash readers; changing them is the 105/106 fold, and any change risks SC-4.
- **Adding a CHECK/enum/DDL for the new kind.** Unnecessary — kind is free TEXT by design. DDL auto-applies to prod = avoidable risk.
- **Reading the live env flag inside the worker.** Read `job.metadata['unified_backbone_at_claim']` (stamped at claim), not `is_unified_backbone_active()` (`long_fetch.py:23-27`, Pitfall 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sparse-rows + scalar-cache + gap-mask from a series | A parallel cash derive | `derive_basis_series` | It IS the shared route; a fork reintroduces the divergence 104 exists to kill |
| Series row upsert | Direct table write | `persist_basis_series` → `upsert_strategy_analytics_series_batch` | Single-row atomic authoritative replace + hardened SECDEF; heal-delete semantics |
| Cash conventions | Hardcode 365/geometric/calendar | `periods_per_year_for_asset_class` + `parse_returns_denominator_config` | #597 asset-class clock + Zavara override; hardcoding = wrong money numbers |
| Byte-identity proof | Manual eyeball | `assert_series_equal(check_exact=True)` dual-run harness | Precedent `test_native_nav_sc4_identity.py`; pure-Python, CI-safe |

**Key insight:** Every primitive this phase needs already exists and is tested. Phase 104 is a ~15-40 LOC wiring change (one derive+persist block + one `_KIND_BY_BASIS` entry) plus a byte-identity test — NOT new machinery.

## Runtime State Inventory

> Rename/refactor-adjacent (adds a persisted kind in prod). Explicit answers below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics_series` gains a new row per broker strategy with `kind='cash_settlement'` (additive; runs in prod via `derive_broker_dailies` which is NOT flag-gated). Existing `csv_daily_returns` + `strategy_analytics.metrics_json` UNCHANGED. | New dark write in prod on next derive per strategy. No backfill required for 104 (dark). Note: no reader consumes it until 105/106. |
| Live service config | None — no external service config embeds this. | None — verified: change is confined to worker code + one series-store kind. |
| OS-registered state | None. | None. |
| Secrets/env vars | `USE_COMPUTE_JOBS_QUEUE` (frontend env), `process_key_unified_backbone` (feature_flags table), `BROKER_DAILIES_VIA_FUNDING` (kill-switch) — all READ only, none renamed/changed. | None. Cutover flips are Phase 106. |
| Build artifacts / migrations | **No migration ships** (kind is free TEXT). Test-project MCP catch-up NOT needed (no DDL). | None — verified against migration `20260428120919:83`. |

## Common Pitfalls

### Pitfall 1: The `derive_basis_series` scalar cache DIVERGES from the legacy cash headline (SC-4 killer)
**What goes wrong:** If you make cash **scalars** the cache emitted by `derive_basis_series`, Sharpe/vol/CAGR change vs the legacy path for two real strategy classes.
**Why it happens:** `derive_basis_series` = `_drop_nonfinite(returns)` → `gap_fill_daily_returns` (0.0-fill) → `compute_all_metrics` (`basis_series.py:126-139`). The legacy cash path does the **opposite**:
- **Broker-sourced:** `analytics_runner.py:2272-2277` REINDEXES to a dense span so in-span guard days become **NaN**, and the TWR segmenter computes a **suffix-only** headline honoring the break (DQ-03, `:2246-2262`). `derive_basis_series` DROPS those NaN days and 0.0-fills them → the segmenter sees NO break → **compounds across it** (a bridged, wrong money number).
- **User CSV (`api_key_id IS NULL`):** legacy leaves the series **SPARSE** and feeds it directly (`:2259-2262`). `derive_basis_series` 0.0-fills calendar gaps (weekends) → different vol/Sharpe.
**How to avoid:** In 104, persist only the cash **SERIES** additively; leave the authoritative scalar compute (`analytics_runner.py`) and `metrics_json` **untouched**. SC-4 holds by construction (authoritative readers unchanged). Note: the cash-series **rows** themselves DO match `csv_daily_returns` — `_drop_nonfinite` of the broker dense-with-NaN series yields exactly the 0.0-kept / guard-day-absent rows already stored — so the persisted series is honest; only the derive's internal scalar cache diverges, and 104 doesn't treat it as authoritative.
**Warning signs:** any diff in a byte-identity dual-run where the fixture has an interior guard day or a weekend gap. Confidence: **HIGH** (both branches verified in source).

### Pitfall 2: Feeding the wrong `returns` variable / wrong conventions
**What goes wrong:** Persisting a cash series with MTM conventions, or from the pre-gap-fill series, silently mis-annualizes.
**How to avoid:** Feed the exact cash `returns` the cash headline uses and the exact cash conventions (`periods_per_year_for_asset_class` + `returns_denominator_config`, `geometric`/`calendar` fallback). Reuse the MTM block's convention resolution (`job_worker.py:2945-2967`) — same values.
**Warning signs:** Zavara (`simple`/active) or a traditional-asset (√252) strategy shows a mismatched cached scalar in the persisted row vs `metrics_json`.

### Pitfall 3: Reading the live flag instead of the claim snapshot
**What goes wrong:** Path selection flips mid-run if you read `is_unified_backbone_active()`.
**How to avoid:** Read `job.metadata['unified_backbone_at_claim']` (`long_fetch.py:24-27`). (Relevant if the plan touches drain/routing logic; the recommended derive-seam change doesn't.)

### Pitfall 4: Fill-based path may bypass `derive_broker_dailies` (BROKER_DAILIES_VIA_FUNDING off)
**What goes wrong:** If the recommended persist lives only in `derive_broker_dailies`, fill-based strategies whose `sync_trades` tail enqueues legacy `compute_analytics` (kill-switch off, `job_worker.py:1509-1512`) never persist a `cash_settlement` series.
**How to avoid:** Confirm `BROKER_DAILIES_VIA_FUNDING` is ON in prod (memory says the funding-inclusive path is the intended one) so all broker strategies route through `derive_broker_dailies`. If off for any venue, the plan must decide whether 104 covers those (see Q3). Confidence: MEDIUM (kill-switch state not verified this session).

### Pitfall 5: Stale series outliving an authoritative-NULL scalar
Covered by Pattern 2 — mirror the MTM success matrix; `result=None` heal-deletes.

## Code Examples

### Resolve cash conventions (verified — reuse from the MTM block)
```python
# Source: analytics-service/services/job_worker.py:2945-2967 (MTM) +
#         analytics-service/services/analytics_runner.py:2288-2316 (cash headline)
from services.metrics import periods_per_year_for_asset_class
from services.allocated_capital import metrics_day_basis

_cash_periods = periods_per_year_for_asset_class(
    ctx.strategy_row.get("asset_class") if isinstance(ctx.strategy_row, dict) else None
)
if denominator_config is not None:
    _cash_cumulative = denominator_config.cumulative_method
    _cash_day_basis = metrics_day_basis(denominator_config.metrics_basis)
else:
    _cash_cumulative, _cash_day_basis = "geometric", "calendar"
```

### Additive cash-series persist (the 104 addition — shape mirrors MTM)
```python
# Source pattern: job_worker.py:2991-3136 — adapt basis + returns variable
from services.basis_series import derive_basis_series, persist_basis_series
try:
    _cash_basis_result = derive_basis_series(
        cash_returns, benchmark_rets,          # the cash series already in scope
        periods_per_year=_cash_periods,
        cumulative_method=_cash_cumulative, day_basis=_cash_day_basis,
    )
except ValueError:
    _cash_basis_result = None                  # degrade → heal-delete (Pitfall 5)

def _persist_cash_series(result=_cash_basis_result) -> None:
    persist_basis_series(ctx.supabase, strategy_id, basis="cash_settlement", result=result)
await db_execute(_persist_cash_series)
# Requires: _KIND_BY_BASIS["cash_settlement"] = "cash_settlement"  (basis_series.py:61)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `process_key_long` never persists analytics (scaffold) | Delegates to `sync_trades`/`derive_broker_dailies` tail → persists via legacy compute | 2026-05-27 (PR #335/#336) | The stated 104 premise is stale; 104 is a backbone-routing change, not a persistence bootstrap |
| Cash series + cash scalars persisted independently (divergence class) | (104) additive canonical cash series via `derive_basis_series`; (105) scalars become its cache | Phase 103→106 arc | Kills the √252-vs-√365 / geometric-vs-arithmetic divergence — but the scalar cache-ification is 105, not 104 |
| MTM only on the shared route | Cash joins `_KIND_BY_BASIS` | Phase 104 (this) | First cash adoption of the backbone |

**Deprecated/outdated:** `.planning/phase-19/QUEUED-PATH-COMPLETION-PLAN.md` "three defects / never persists" — all FIXED; read it for the ORIGINAL contract (`§ "The contract the queued path must satisfy"`, lines 165-176) but treat its status as historical.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 104 scope = additive single-key cash **series** persist (scalars untouched); scalar cache-ification is Phase 105 | Summary / Locked #6 | If planner expects scalars-as-cache in 104, SC-4 breaks (Pitfall 1) — must be resolved before planning |
| A2 | The persist seam is `run_derive_broker_dailies_job` (next to MTM), not `analytics_runner.py` | Architecture / Rec | If fill-based strategies bypass `derive_broker_dailies`, coverage gap (Q3) |
| A3 | `BROKER_DAILIES_VIA_FUNDING` is ON in prod so all broker strategies route through `derive_broker_dailies` | Pitfall 4 / Q3 | Uncovered fill-based strategies get no cash series in 104 |
| A4 | The additive dark write in prod (new kind row) satisfies "no prod behavior change" (matches Phase 103's MTM precedent) | Locked #1 | If "no prod write at all" is required, persist must be gated behind `USE_COMPUTE_JOBS_QUEUE` — changes the plan |
| A5 | Kind string `"cash_settlement"` is acceptable and unconstrained (no DDL) | Standard Stack | Verified TEXT-free (migration :83); low risk |
| A6 | Composite cash is entirely Phase 105 (104 = single-key only) | Locked #6 | ROADMAP-confirmed; low risk |

## Open Questions

1. **Does "no prod behavior change" permit the additive dark write?** (A4)
   - Known: Phase 103 added `mtm_daily_returns` as an additive prod write with no visible change — the accepted precedent.
   - Unclear: whether 104 must instead gate the cash persist behind `USE_COMPUTE_JOBS_QUEUE` so nothing new writes until 106.
   - Recommendation: follow the 103 precedent (additive/dark) unless discuss-phase says otherwise. Confirm at `/gsd:plan-phase` discuss.

2. **Scope confirmation — series-only in 104?** (A1)
   - Known: SC-4 forbids scalar cache-ification without the NaN/gap reconciliation (Pitfall 1); ROADMAP puts that in 105.
   - Recommendation: lock 104 = additive cash **series** only. The value delivered is the canonical cash series existing behind the scenes so 105 can flip scalars to cache it.

3. **Fill-based coverage when `BROKER_DAILIES_VIA_FUNDING` is off.** (A3)
   - Known: `sync_trades` tail enqueues legacy `compute_analytics` (not `derive_broker_dailies`) when the kill-switch is off (`job_worker.py:1509-1512`).
   - Recommendation: verify prod kill-switch state; if any venue runs legacy, either accept the gap for 104 (dark anyway) or add the persist in `run_compute_analytics_job` too. Planner decision.

4. **Does `upsert_strategy_analytics_series_batch` accept an arbitrary kind, or does it validate against a set?**
   - Known: table `kind` is free TEXT; the RPC "aggregates {kind: payload}" (migration comment). MTM already added a new kind through it with no ALTER.
   - Recommendation: grep the RPC body during Wave 0 to confirm no CASE/whitelist on kind before writing the persist call. Low risk (MTM precedent).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python analytics-service test suite (pytest) | SC-4 dual-run + round-trip tests | ✓ | `pytest.ini` testpaths=tests | — |
| `strategy_analytics_series` table + hardened RPC | cash series persist | ✓ (prod + test proj) | migration `20260428120919` | — |
| Supabase MCP (for gsd-executor) | test-project catch-up | ✗ | — | **Not needed — no DDL ships**; pure-Python tests run in CI |
| Railway analytics deploy | prod verification | ✓ (post-merge) | — | Additive/dark → no live verification gate this phase |

**Missing dependencies with no fallback:** none. **With fallback:** Supabase MCP unavailable to executor is a non-issue — 104 has no migration, so no test-project catch-up.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), `--cov-fail-under=80` gate (CLAUDE.md) |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`) |
| Quick run command | `cd analytics-service && python -m pytest tests/test_basis_series.py tests/test_derive_broker_dailies_dualmode.py -x` |
| Full suite command | `cd analytics-service && python -m pytest --cov --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BB-01 | Cash series persisted as `kind='cash_settlement'` on a clean broker derive | unit | `pytest tests/test_derive_broker_dailies_dualmode.py -k cash_settlement -x` | ❌ Wave 0 (extend) |
| BB-01 | SC-4: authoritative cash scalars (`metrics_json`) BYTE-IDENTICAL before/after the additive persist | unit (dual-run) | `pytest tests/test_native_nav_sc4_identity.py -x` (pattern) → new `test_cash_basis_series_sc4.py` | ❌ Wave 0 |
| BB-01 | Round-trip guard: persisted cash rows re-derive to the cached scalars under the conventions echo | unit | `pytest tests/test_basis_series.py -k cash -x` | ❌ Wave 0 (extend existing) |
| BB-01 | Heal-delete: degrade / <2 finite rows → `result=None` deletes any stale cash-series row | unit | `pytest tests/test_derive_broker_dailies_dualmode.py -k heal -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_basis_series.py tests/test_derive_broker_dailies_dualmode.py -x`
- **Per wave merge:** full analytics suite with `--cov-fail-under=80`
- **Phase gate:** full suite green + `check_exact=True` SC-4 dual-run passing before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_cash_basis_series_sc4.py` — dual-run byte-identity: legacy cash scalar path vs the state after the additive persist; assert `metrics_json` unchanged AND persisted cash rows == `csv_daily_returns` rows. Cover: broker guard-day-interior fixture, user-CSV weekend-gap fixture, Zavara `simple`/active fixture, √252 traditional fixture. (Pattern: `test_native_nav_sc4_identity.py`.)
- [ ] Extend `tests/test_basis_series.py` — `_KIND_BY_BASIS["cash_settlement"]` mapping + `persist_basis_series(basis="cash_settlement")` round-trip + heal-delete.
- [ ] Extend `tests/test_derive_broker_dailies_dualmode.py` — assert the cash-series persist call fires on clean derive, heal-deletes on degrade, and does NOT alter `csv_daily_returns` / `metrics_json`.
- No framework install needed (pytest present).

## Security Domain

> `security_enforcement` absent in config → treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched |
| V3 Session Management | no | — |
| V4 Access Control | yes | Series writes go through service-role-only SECDEF RPC + RLS deny-all (`strategy_analytics_series`); no new grant. Reuse existing — do not widen. |
| V5 Input Validation | yes | Kind is code-controlled constant (`_KIND_BY_BASIS`), not user input; payload floats via `_safe_float` (postgrest rejects NaN). No new input surface. |
| V6 Cryptography | no | Credential decryption path unchanged (`long_fetch.py` already hardened, worker-only KEK). No new crypto. |

### Known Threat Patterns for the analytics worker
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| New SECDEF fn with loose search_path | Elevation of Privilege | **Avoid entirely** — reuse `upsert_strategy_analytics_series_batch` (already `SET search_path = public, pg_temp` + REVOKE + service-role grant). If any new SQL is proposed, route through migration-reviewer + rls-policy-auditor. |
| Prod DDL auto-apply on merge | Tampering/availability | No DDL ships (kind is free TEXT). |
| Stale/leaked series row (wrong money number surfaced later) | Information disclosure / integrity | Pitfall 5 heal-delete; dark until reader repoint. |

## Sources

### Primary (HIGH confidence — code-verified this session)
- `analytics-service/services/ingestion/long_fetch.py:1-531` — queued handler, tail delegation, drain semantics
- `analytics-service/services/basis_series.py:1-225` — `derive_basis_series` / `persist_basis_series` / `_KIND_BY_BASIS`
- `analytics-service/services/job_worker.py:2900-3140` (MTM derive+persist seam), `:1509-1512` (sync_trades tail), `:5679-5688` (dispatch)
- `analytics-service/services/analytics_runner.py:2200-2318` — legacy cash scalar compute, NaN-reinstatement / sparse-CSV branches (SC-4 divergence source)
- `analytics-service/services/broker_dailies.py:123-171` — `gap_fill_daily_returns`, `combine_realized_and_funding`
- `supabase/migrations/20260428120919_strategy_analytics_series.sql:34-104` — table (free-TEXT kind), hardened SECDEF RPC, RLS
- `.planning/ROADMAP.md:98-108`, `.planning/REQUIREMENTS.md:35-39`, `.planning/BACKBONE-BYPASS-INVENTORY.md` (Tier 2 + DEAD-ROUTE MAP), `.planning/STATE.md` (carry-forwards)
- `analytics-service/tests/test_native_nav_sc4_identity.py:1-45` — SC-4 dual-run harness pattern

### Secondary (MEDIUM confidence)
- Memory `project_unified_queued_path_scaffold` (STATUS: FIXED+DEPLOYED) + `.planning/phase-19/QUEUED-PATH-COMPLETION-PLAN.md` — historical premise
- `BROKER_DAILIES_VIA_FUNDING` prod state (inferred ON; not verified live)

## Metadata

**Confidence breakdown:**
- Standard stack / seams: HIGH — every symbol read in source
- SC-4 divergence analysis: MEDIUM-HIGH — both legacy branches (broker NaN-reinstate, user-CSV sparse) verified; exact per-strategy blast radius depends on fixture coverage
- Scope interpretation (series-only 104): MEDIUM — reconciled ROADMAP + STATE + bypass inventory + SC-4 constraint; flagged for discuss (A1)
- Pitfalls: HIGH — root causes traced to source with line evidence

**Research date:** 2026-07-14
**Valid until:** ~2026-08-14 (stable internal codebase; re-confirm seam line numbers before planning — job_worker.py is actively edited)

## RESEARCH COMPLETE
