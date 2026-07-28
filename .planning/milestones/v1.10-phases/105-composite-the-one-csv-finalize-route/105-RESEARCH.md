# Phase 105: Composite → the one CSV finalize route — Research

**Researched:** 2026-07-14
**Domain:** Python analytics-service worker — dailies-canonical backbone unification (CASH scalar cache-ification: composite + single-key CSV; onboarding; venue/denominator fork collapse; transactional finalize)
**Confidence:** HIGH on seams/divergence math (all code-verified this session); MEDIUM on transactional-finalize DDL shape (a plan-time decision) and on split-shape (judgment).

## Summary

Phase 105 is where CASH stops being a backbone bypass. Phase 103 put MTM on the shared `derive_basis_series` route and Phase 104 added a *dark, series-only* cash persist at the single-key broker seam — but the **authoritative cash SCALARS still come from the legacy paths** (`analytics_runner.py` single-key, `_metrics_result_for` composite). 105 makes those scalars a **cache of a persisted cash series**, deletes `_metrics_result_for`, collapses the two `periods_per_year` rules, folds the venue-source + allocated-capital forks upstream, unifies onboarding, makes csv-finalize transactional, and **decides** (not executes) the series-store fold. The gate on every one of these is **SC-4: every existing single-key + published-composite cash factsheet stays byte-identical.**

The central risk is exactly what Phase 104 deferred to here: `derive_basis_series` internally does `_drop_nonfinite → gap_fill_daily_returns(0.0) → compute_all_metrics`, and that 0.0-densification **diverges** from what the legacy cash paths compute on. The divergence is real and, for user-CSV strategies, **broad** (not an edge case). The fix is a targeted redesign of `derive_basis_series` that **decouples the honest sparse persisted ROWS from the SCALAR-input series**, letting the caller pass the exact legacy-conditioned series so the scalar is byte-identical *by construction* — while the derive path itself stays single and branchless (the conditioning moves upstream into preparation, which is precisely collapse #6).

**Primary recommendation:** Add an explicit `scalar_returns: pd.Series | None = None` parameter to `derive_basis_series`. When omitted it defaults to today's `gap_fill_daily_returns(sparse)` (MTM byte-identical — zero change to Phase-103 behavior). Cash call sites pass the **exact series the legacy path computes on** (composite: `gap_fill_daily_returns(stitched)`; single-key broker: dense-reindex-with-interior-NaN; user-CSV: the sparse series verbatim), built upstream in preparation. Persisted `series_rows` stay `_drop_nonfinite(returns)` (honest, unchanged). Carry a **densify-policy tag** in the `conventions` echo so the round-trip guard and the future (106) reader can rebuild the scalar input from the sparse rows. Prove SC-4 with the existing `check_exact=True` dual-run harness on four fixtures (composite-with-member-guard-NaN, single-key broker guard day, user-CSV weekend gap, Zavara simple/active). **Split recommendation: keep #1/#2/#5/#6 + transactional finalize as one phase (they share the one `derive_basis_series` change and the one SC-4 gate); carve onboarding (#4) into 105.1 if the plan exceeds ~2 waves** (it is an additive/dark write to a *separate* store — `strategy_verifications.metrics_snapshot` — with no authoritative-factsheet byte-identity coupling).

---

## THE CENTRAL ANSWER — how the cash-scalar re-route reproduces the legacy scalars byte-identically (SC-4)

### The divergence, exactly (all three cash surfaces)

`derive_basis_series` (`services/basis_series.py:149-162`) computes its scalar cache as:

```
sparse = _drop_nonfinite(returns)          # .replace([inf,-inf],nan).dropna()   (metrics.py:201)
dense  = gap_fill_daily_returns(sparse)    # .reindex(full_calendar, fill_value=0.0)  (broker_dailies.py:137)
scalar = compute_all_metrics(dense, …)
```

`gap_fill_daily_returns` **only fills index positions that are ABSENT** with 0.0; an in-index NaN is left as NaN. The load-bearing consequence: `_drop_nonfinite` runs *first*, so any interior NaN is removed from the index and then re-inserted by `gap_fill` as **0.0** — i.e. an interior NaN break is **bridged to a flat 0.0 day**. The three legacy cash paths do the opposite (or nothing):

| Surface | Legacy series `compute_all_metrics` sees | `derive_basis_series` would compute on | Divergence |
|---|---|---|---|
| **Composite cash** (`_metrics_result_for`, `job_worker.py:4262-4287`) | `gap_fill_daily_returns(stitched)` — inter-member uncovered days → 0.0 (bridge), but **member-guard interior NaN stays NaN** (break/suffix-only; ValueError under `simple`) | `_drop_nonfinite(stitched)` → member-guard NaN dropped → `gap_fill` → **0.0** (bridge) | member-guard interior NaN: **break vs 0.0-bridge** |
| **Single-key broker CSV** (`analytics_runner.py:2272-2277`) | dense-reindex where in-span guard days become **NaN** → segmenter suffix-only headline (DQ-03) | guard days → dropped → 0.0 (bridge) | guard day: **break vs 0.0-bridge** |
| **Single-key user CSV** (`api_key_id IS NULL`, `analytics_runner.py:2259-2262`) | the series **sparse, no gap-fill** — vol/Sharpe over the actual points only | weekends/calendar gaps → **0.0-filled** → vol/Sharpe diluted | **every weekend-spanning CSV** — 0.0 days lower the std, shift the mean |

`stitch_clipped_series` (`stitch_composite.py:245`) is a `pd.concat(...).sort_index()` with **no gap-fill** — uncovered inter-member days are *absent*, and a member's own DQ-01 guard day is an *in-index NaN* (each member is gap-filled 0.0 within its window by `combine_*`, so the only interior NaN is a refused/guard day). So the composite divergence surfaces exactly when a member carries a guard day. The F-5 arm (`job_worker.py:4291-4311`) already exists precisely because `_metrics_result_for` can hit an interior chain-break — confirming this is a live-reachable shape, though today it is largely defense-in-depth ("the allocated path gap-fills 0.0", `:4298`).

**Worked example (user-CSV, the dominant risk).** A traditional strategy uploaded with only trading days, spanning a Friday→Monday:
- Legacy: index `{Fri, Mon}`, returns `[0.01, 0.02]` → `vol = std([0.01, 0.02])·√252`.
- `derive_basis_series`: `gap_fill` inserts Sat, Sun as 0.0 → `[0.01, 0.0, 0.0, 0.02]` → `vol = std([0.01, 0, 0, 0.02])·√252` — **strictly lower**, different Sharpe/Sortino, different CAGR-denominator behavior.

This diverges for **essentially every** user-uploaded traditional strategy with a weekend in its span. It is the single broadest SC-4 blast radius in the phase — larger than the guard-day cases, which only fire on refused days.

### Why the naive options fail

- **(b) "feed `derive_basis_series` the exact legacy series"** — insufficient alone. The function *re-transforms* whatever you pass (`_drop_nonfinite → gap_fill`), so passing the dense-with-NaN broker series still gets its NaN dropped-then-0.0-filled. The internal densification is the problem, not the input.
- **(a) "make densification a parameter / mode flag"** — workable but couples a source-class branch *into the derive*, which is exactly what collapse #6 wants gone, and it entangles the row-derivation with the scalar-derivation (they need *different* inputs — see below).
- **"just densify everything with 0.0 and accept the shift"** — this is what MTM did (the `basis_series.py:26-50` docstring openly accepts an MTM scalar shift because MTM was brand-new/unreleased). **Cash is live and published → SC-4 forbids any shift.** This is the whole reason 104 deferred scalar-cache-ification to 105.

### The recommendation — decouple ROWS from SCALAR-INPUT (concrete)

The root cause is that `derive_basis_series` conflates two concerns that cash needs to separate:
1. **The honest sparse persisted rows** — `_drop_nonfinite(returns)`. Correct for every basis; keep unchanged. (104-RESEARCH already proved these rows equal the `csv_daily_returns` rows for broker.)
2. **The scalar-input series** — must equal what the legacy path computes on, which is *different per source class* and *different from the rows* (broker rows have guard days absent, but the scalar wants them present-as-NaN).

So the two inputs genuinely cannot be one series. Introduce an explicit scalar input:

```python
def derive_basis_series(
    returns: pd.Series,                    # ROW source — sparse persisted truth via _drop_nonfinite
    benchmark_rets: pd.Series | None,
    *,
    periods_per_year: int,
    cumulative_method: str,
    day_basis: str,
    benchmark_symbol: str | None = None,
    scalar_returns: pd.Series | None = None,   # NEW: exact series compute_all_metrics sees
    densify_policy: str | None = None,          # NEW: echoed for round-trip/reader rebuild
) -> BasisSeriesResult:
    sparse = _drop_nonfinite(returns).sort_index()
    if len(sparse) < 2:
        raise ValueError(...)
    scalar_input = scalar_returns if scalar_returns is not None else gap_fill_daily_returns(sparse)
    metrics = compute_all_metrics(scalar_input, benchmark_rets, periods_per_year=…, …)
    series_rows = [ … from sparse … ]          # unchanged
    gap_spans   = _consecutive_spans(…)         # unchanged, from sparse
    conventions = {periods_per_year, cumulative_method, day_basis}
    if benchmark_symbol is not None: conventions["benchmark"] = benchmark_symbol
    if densify_policy is not None:   conventions["densify"] = densify_policy   # "zero_fill"|"broker_nan"|"sparse"
    return BasisSeriesResult(metrics.metrics_json, metrics.sibling_kinds, series_rows, gap_spans, conventions)
```

**Why this satisfies SC-4 for all three cash surfaces AND keeps MTM byte-identical:**
- **MTM / any caller that omits `scalar_returns`** → `gap_fill_daily_returns(sparse)` — *bit-for-bit today's behavior*. Phase-103 MTM is untouched (no `scalar_returns` passed). This is the SC-4 safety for the already-published MTM scalars.
- **Composite cash** → caller passes `scalar_returns = gap_fill_daily_returns(stitched)` (the exact `_metrics_result_for` input, member-guard NaN preserved) → scalar byte-identical to `_metrics_result_for`. `_metrics_result_for` is then **deleted** (the two now compute the same thing; SC1).
- **Single-key broker CSV** → caller passes the dense-reindex-with-NaN series (`analytics_runner.py:2273-2276` verbatim) → byte-identical to legacy.
- **Single-key user CSV** → caller passes the **sparse series unchanged** (`scalar_returns = sparse`, no gap-fill) → byte-identical to legacy.
- **The derive path stays single and branchless** — the *decision* of which `scalar_returns` to build lives in preparation (collapse #6), not in `derive_basis_series`. That is the whole point of #6 and it dovetails with this design.

**Round-trip guard implication (new finding).** The persisted rows are sparse, but the scalar was computed on a densify-policy-specific input. To let the round-trip guard (and the 106 reader) rebuild the scalar input from the sparse rows, the **densify policy must be carried in the `conventions` echo** (`"densify": "zero_fill" | "broker_nan" | "sparse"`). This is additive-only (a caller that omits it is byte-invisible, exactly like the `benchmark` key added in 104 at `basis_series.py:186-187`). Without it, a reader cannot know whether to 0.0-fill, NaN-reinstate, or leave-sparse when reproducing the scalar — and the round-trip guard would falsely redden on a broker/user-CSV series.

**Confidence: HIGH** — every branch verified in source (`basis_series.py:149-195`, `broker_dailies.py:123-137`, `metrics.py:201`, `analytics_runner.py:2259-2324`, `job_worker.py:4262-4290`, `stitch_composite.py:217-246`).

---

## User Constraints (from orchestrator brief + REQUIREMENTS.md invariants)

> No CONTEXT.md exists (`has_context: false`). These come from the Phase-105 orchestrator brief, the ROADMAP §Phase 105, and the v1.10 standing invariant (SC-4, `ROADMAP.md:19`). `discuss-phase` should confirm the scope items flagged in `## Assumptions Log`.

### Locked Decisions
1. **Behind the existing flag (`USE_COMPUTE_JOBS_QUEUE` / `process_key_unified_backbone`); SC-4 is the gate.** Every re-route must be byte-identical for existing published cash factsheets, proven by a golden byte-identity sweep.
2. **Dailies-canonical, no forks.** Composite cash + the CSV single-key runner + onboarding route through the SHARED `derive_basis_series`/`persist_basis_series`. Do not build a parallel derive. Delete `_metrics_result_for` (grep-gated).
3. **No new valuation math.** `compute_all_metrics` untouched. All changes are routing/preparation/persistence.
4. **Series-store fold is DECIDE-ONLY in 105; EXECUTE in 106.** Any DDL is prod-affecting (migrations auto-apply to prod on merge). If a transactional-finalize SECDEF is proposed, it is DDL → hardening + migration-reviewer + rls-policy-auditor + test-project MCP catch-up before merge.
5. **Benchmark identity travels with `conventions`** (α/β/correlation are outside the persist round-trip guarantee — carry `benchmark_symbol`, incl. on composite rows — 104-carry LOW-2).
6. **The two 104-carry pre-reqs MUST be addressed** (MED-1 stale-row heal, MED-2 venue-agnostic conventions echo) — they detonate the moment 105 lights the cash reader / makes cash scalars a cache.
7. **No git branch ops in subagents.** DB gates in `supabase/tests/test_*.sql`; `*_live.py` skip in CI; the executor has NO Supabase MCP.

### Claude's Discretion
- Exact placement of the `scalar_returns` construction (recommend: in the per-source preparation that collapse #6 creates).
- Whether to carry `densify` as a string enum vs a structured object (recommend string enum).
- Whether the user-CSV single-key inline swap (#2) lands in 105 core or 105.1 (recommend 105 core — same `derive_basis_series` change, broadest SC-4 risk, "do together with #1").
- Test-fixture shapes for the SC-4 sweep.

### Deferred Ideas (OUT OF SCOPE — 106+)
- **Execution** of the series-store fold (`csv_daily_returns`→`daily_returns` + `basis` column); flag flip; deletion of the dark `run_strategy_analytics` path + its 4 re-entry points; the onboarding `metrics_snapshot` legacy-delete tail; the `computing`-janitor cron — all **Phase 106**.
- Tier-3 leverage (107), Tier-4 aggregation/allocator (v1.11), Tier-5 TS second-Sharpe (108).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BB-02 | Composite stitch + CSV finalize route through the shared `derive_basis_series`; composite cash scalars become a cache of a persisted cash series; `_metrics_result_for` deleted; two `periods_per_year` rules collapse to one; venue-source + allocated-capital forks fold upstream; onboarding opens no scalar-without-series window; csv-finalize transactional; series-store fold decided; SC-4. | The `scalar_returns` decoupling (see central answer) makes the cash scalar byte-identical by construction. #5 is safe today (F-1 backstop `job_worker.py:4214-4223` already forces venue-blend == asset_class clock). #6 is largely structural (`combine_native_ledger`/`combine_realized_and_funding` already return byte-identical shape; `denominator_config` already resolved venue-agnostically at branch-outer scope `job_worker.py:2051`). MED-2 fixed by #6. MED-1 fixed by read-side status-gate. |

**SC anchors (from ROADMAP §Phase 105):** SC1 delete `_metrics_result_for` + composite scalar = cache; SC2 one `periods_per_year` convention; SC3 forks upstream of a single derive; SC4 onboarding no scalar-without-series window; SC5 transactional finalize; SC6 byte-identity golden sweep + fold decided + benchmark identity carried.
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Composite stitch → cash scalar | API/Backend (`run_stitch_composite_job`) | Database (`strategy_analytics` / `strategy_analytics_series`) | The `_metrics_result_for` deletion + `derive_basis_series` re-route lives here |
| Per-source scalar-input conditioning (#6) | API/Backend (preparation, upstream of derive) | — | venue-source + denominator + NaN/sparse policy resolved BEFORE the single derive |
| Single-key CSV cash scalar (#2) | API/Backend (`run_csv_strategy_analytics`) | Database | swap the inline `compute_all_metrics` for the shared route |
| Onboarding teaser scalar+series (#4) | API/Backend (`routers/process_key.py`) | Database (`strategy_verifications`, `strategy_analytics_series`) | additive dark series alongside the `metrics_snapshot` scalar; separate store |
| Transactional finalize (SC5) | Database (SECDEF RPC?) + API/Backend | — | atomic series+scalars+mask; DDL decision |
| Series-store fold DECISION (#3) | Database (schema design) | — | tall `daily_returns`+`basis` table; ~15 readers incl. GDPR; decided here, executed 106 |
| Flag gating / cutover | Frontend env + Backend flag | — | flip is 106; 105 ships dark/behind flag |

## Standard Stack

No new packages — internal Python worker refactoring on the existing analytics-service stack. Reuse verbatim:

| Module / Symbol | Location | Role in 105 |
|---|---|---|
| `derive_basis_series` | `services/basis_series.py:124` | ADD `scalar_returns` + `densify_policy` params (SC-4 core); adopt for cash on all 3 surfaces |
| `persist_basis_series` | `services/basis_series.py:198` | single-row authoritative upsert / heal-delete; `_KIND_BY_BASIS["cash_settlement"]` already present (104) |
| `_metrics_result_for` | `services/job_worker.py:4262` | **DELETE** (grep-gated) once composite cash routes through `derive_basis_series` |
| `compute_all_metrics` | `services/metrics.py:398` | untouched (branchless pure kernel) |
| `gap_fill_daily_returns` / `_drop_nonfinite` | `broker_dailies.py:123` / `metrics.py:197` | densifier / sanitizer — the divergence primitives |
| `combine_native_ledger` / `combine_realized_and_funding` | `broker_dailies.py:173` / `:140` | venue-source fork (#6) — already byte-identical shape |
| `parse_returns_denominator_config` / `metrics_day_basis` | `services/allocated_capital.py` | denominator resolution (#6/MED-2) — resolve venue-agnostically |
| `periods_per_year_for_asset_class` | `services/metrics.py:43` | the ONE surviving `periods_per_year` rule (#5) |
| `_COMPOSITE_CRYPTO_VENUES` / `_COMPOSITE_DEGRADE_VENUES` | `job_worker.py:3237/3248` | keep ONLY as unknown-venue/degrade backstop (#5) |
| `upsert_strategy_analytics_series_batch` (RPC) | migration `20260428120919:34` | hardened SECDEF batch upsert; reuse (no new SECDEF unless transactional-finalize needs one) |

**Installation:** none. `npm view` / `pip index` N/A.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** All work reuses in-repo modules; slopcheck/registry verification skipped by design. If the planner later proposes any package, gate it behind `checkpoint:human-verify`.

## The Four Collapses → concrete change + SC-4 guard

### #1 — Route composite cash through `derive_basis_series`; DELETE `_metrics_result_for`
- **Change:** at `job_worker.py:4262-4290`, replace `cash_metrics_result = _metrics_result_for(clipped_cash)` with `derive_basis_series(returns=stitched_cash, scalar_returns=gap_fill_daily_returns(stitched_cash), densify_policy="zero_fill", benchmark_symbol="BTC", …)`; spread `.metrics_json` into the headline AND `metrics_json_by_basis.cash_settlement`; `persist_basis_series(basis="cash_settlement", result=…)`. Delete the closure (grep-gate: `git grep _metrics_result_for` == 0).
- **SC-4 guard:** the composite scalar input is *identical* to `_metrics_result_for`'s (`gap_fill(stitched)`), so byte-identical by construction; golden sweep on a member-guard-NaN composite fixture proves it.
- **Note:** composite already 0.0-fills inter-member gaps in the legacy path, so `densify_policy="zero_fill"` matches — but the persisted **rows** stay sparse (`_drop_nonfinite`, member-guard/inter-member days absent → honest `gap_spans`), which is what the FS-02 coverage mask needs.

### #5 — Collapse the two `periods_per_year` rules
- **Do they agree today?** **YES, and it is enforced.** The composite venue-blend rule (`job_worker.py:4199-4203`) is immediately **backstopped** by the F-1 guard (`:4214-4223`) which **fails PERMANENT** if `periods_per_year_for_asset_class(asset_class) != venue_blend`, and finalize-wizard force-derives `asset_class='crypto'` for composites. So **no live published composite can exist where the two disagree** — collapsing to the single `asset_class` rule changes **no live scalar**.
- **Change:** drop the venue-blend computation + F-1 backstop as the *selector*; use `periods_per_year_for_asset_class(strat_row["asset_class"])` as the one rule. Keep `_COMPOSITE_CRYPTO_VENUES` ONLY as the unknown-venue/degrade backstop (`_COMPOSITE_DEGRADE_VENUES` still degrades all-ccxt / unknown-venue composites out of the stitch).
- **SC-4 guard:** an assertion test that for every existing composite fixture the two rules resolve equal (they must, or the row wouldn't have shipped); golden sweep confirms the scalar is unchanged.

### #6 — Fold venue-source + allocated-capital forks upstream of a single derive
- **State today:** `combine_native_ledger` (deribit) and `combine_realized_and_funding` (ccxt) already return **byte-for-byte the same shape** (gap-filled float Series + meta dict — `broker_dailies.py:182-190`). `denominator_config` is already **parsed at branch-outer scope** (`job_worker.py:2051`) and the Phase-104 cash echo resolves conventions from it post-branch (`:3188-3195`). So #6 is **largely structural**: ensure the fork produces `returns` (+ meta) upstream and feeds ONE `derive_basis_series` call — no venue/denominator `if` remains *inside* the derive path.
- **SC-4 guard:** the derive receives the same `returns` the legacy fork produced → byte-identical. Cover ccxt + deribit + Zavara(allocated) fixtures.

### #4 — Unify onboarding (kill the scalar-without-series window)
- **State today:** the synchronous teaser arm (`routers/process_key.py:864-946`) computes `metrics = adapter.compute_metrics(trades)` and persists an enriched **scalar-only** `metrics_snapshot` into `strategy_verifications` (backs the landing card + 90-day teaser + `matched_strategy_id`/`return_24h`/`equity_curve`) with **no daily series**. The queued arm (onboard/resync) already rides the Phase-104 mechanism.
- **Change (105):** at the teaser compute, ALSO derive+persist a `cash_settlement` daily series via the shared route (additive/dark) so a scalar never exists without its series. The `metrics_snapshot` **store itself stays** until 106 (its DELETE + 3 repoints are the 106 tail).
- **SC-4 posture:** additive/dark, to a **separate store** — no authoritative-factsheet byte-identity coupling. This is the cleanest candidate to carve into **105.1** (see split).

Plus:
### Transactional csv-finalize (SC-5)
- **Gap today:** `run_stitch_composite_job` persist (`job_worker.py:4447-4514`) is a **sequence** — `_reconcile_full_delete()` (delete `csv_daily_returns`) → chunked upserts → headline `strategy_analytics` upsert → `metrics_json_by_basis`. A worker death mid-sequence leaves a partial (deleted dailies / scalar-without-series / stale-row) state. supabase-py (postgrest) has **no cross-`.table()` transaction**.
- **Options:** (a) a single **SECDEF finalize RPC** that writes series+scalars+mask atomically (extends the existing batch-upsert pattern) — **this is DDL** → prod-auto-apply + hardening + migration-reviewer + rls-policy-auditor + test-project MCP catch-up; (b) **ordered idempotent** writes (series+mask via the atomic batch RPC first, scalar flip last, re-derive is authoritative/idempotent via `_reconcile_full_delete`). **Recommendation:** prefer (b) unless the plan finds a real partial-state that ordering can't close; if (a), flag as prod-affecting DDL and budget the catch-up. This is a genuine plan-time decision — surface it in discuss.

## The two 104-carry pre-reqs

### MED-1 — stale-row heal at pre-seam terminal-failure arms
- **Problem:** the `<2-interpretable-days` arm (`job_worker.py:2790-2821`), `_stamp_deribit_analytics_failed` (`:2096`), and NAV-error arms null the scalars (`metrics_json_by_basis=None`, `computation_status='failed'`) and `return` **before** the persist seam → a stale `cash_settlement` (and `mtm_daily_returns`) series row can **outlive** an authoritative-NULL scalar. Dark today; **detonates** when 105 makes the cash reader trust the series row.
- **Two fixes:** (a) **status-gate the cash reader / round-trip** (only trust the series row when `computation_status='complete'`, mirroring the MTM read side); (b) **heal both series rows** at every terminal arm (`persist_basis_series(result=None)` delete).
- **Recommendation: (a) read-side status-gate as PRIMARY.** It is a **single choke point** that covers *all* terminal arms — including future ones — whereas (b) must patch N arms and silently regresses if a new arm is added and one is missed (the exact bug class MED-1 is). Also fixes the pre-existing Phase-103 MTM half. Optionally add (b) heal-deletes as defense-in-depth at the known arms, but do not rely on them as the guarantee.

### MED-2 — venue-agnostic conventions echo (naturally fixed by #6)
- **Problem:** the 104 cash echo resolves `denominator_config` only in the deribit arm (`job_worker.py:2162`); a **ccxt strategy with a non-null override** would echo `geometric/calendar` while its authoritative legacy scalars use `simple/active` (`analytics_runner.py:2304-2316`, venue-agnostic) → the round-trip guard reddens / the collapse reproduces wrong scalars. Zero prod rows today (config is Zavara/Deribit-only).
- **Fix:** #6 already moves denominator resolution upstream/venue-agnostic; **confirm** the cash echo reads `parse_returns_denominator_config(strat_row["returns_denominator_config"])` from the **strategy row regardless of venue** (exactly `analytics_runner.py:2304-2316`). Add a round-trip test with a **ccxt strategy carrying a `returns_denominator_config` override** to prove the guard holds.

**LOW-2:** carry `benchmark_symbol` on the **composite** stitch derive (`job_worker.py:4411` MTM already omits it) so 105's α/β re-derive can identify the benchmark on composite rows. **LOW-3/4:** a `BROKER_DAILIES_VIA_FUNDING=false` rollback orphans dark rows (same class as MED-1 → the status-gate covers it); do NOT rely on the INERT-read grep tripwire as proof of the reader-landing (it misses a reader imported via a constant).

## Series-store fold — DECISION (research only; execute 106)

**Reader inventory (verified this session): 66 files reference `csv_daily_returns`** (`grep -rln`), of which the production (non-test) readers span:
- **Frontend (~12):** `lib/queries.ts`, `lib/factsheet/composite-read-path.ts`, `lib/factsheet/compute.ts`, `lib/strategyGate.ts`, `lib/composite/compositeAttribution.ts`, `lib/gdpr-export-manifest.ts`, `lib/database.types.ts`, `lib/types.ts`, wizard `SyncPreviewStep.tsx`, `discovery/[slug]/[strategyId]/page.tsx`, `factsheet/[id]/v2/page.tsx`, `api/admin/strategy-review/route.ts`, `api/strategies/csv-finalize/route.ts`.
- **Backend (~4):** `analytics_runner.py`, `job_worker.py`, `ingestion/long_fetch.py`, `csv_validator.py`.
- **SQL/RLS/SECDEF:** `persist_csv_daily_returns.sql` (SECDEF), `enforce_csv_daily_returns_owner_coherence.sql` (owner-coherence trigger), per-key axis + allocator-date index migrations, RLS test.
- **GDPR: two export axes** (`gdpr-export.test.ts`, `gdpr-export-per-key-dailies.test.ts`, `gdpr-export-manifest.ts`) — date-range + `allocator_id`-indexed queries.

**Decision: RECOMMEND the tall table SURVIVES** — rename `csv_daily_returns → daily_returns`, add a `basis` column (default `'cash_settlement'`), fold the MTM `mtm_daily_returns` kind IN. A JSONB blob **cannot** serve the `allocator_id`+date-range GDPR/per-key/admin queries or the per-key RLS + owner-coherence trigger. This matches the ROADMAP carry-forward. **105 locks this decision; 106 executes the migration + repoints all readers + RLS/SECDEF.** (No DDL in 105.)

## Architecture Patterns

### System data flow (composite cash, after 105)
```
run_stitch_composite_job
  ├─ fan-out members → combine_native_ledger (deribit) | combine_realized_and_funding (ccxt)   ← #6 fork UPSTREAM
  │        (+ denominator_config resolved venue-agnostically at branch-outer scope; MED-2)
  ├─ stitch_clipped_series → stitched_cash (sparse; inter-member gaps absent, member-guard days NaN)
  ├─ periods_per_year = periods_per_year_for_asset_class(asset_class)        ← #5 ONE rule
  ├─ derive_basis_series(                                                    ← #1 (replaces _metrics_result_for)
  │        returns=stitched_cash,                    # ROWS: _drop_nonfinite → sparse honest
  │        scalar_returns=gap_fill_daily_returns(stitched_cash),  # SCALAR: byte-identical to legacy
  │        densify_policy="zero_fill", benchmark_symbol="BTC", conventions…)
  ├─ headline strategy_analytics == metrics_json_by_basis.cash_settlement  (one compute; no divergence)
  └─ persist (transactional, SC-5): series+scalars+mask atomically or ordered-idempotent
```

### Anti-patterns to avoid
- **Reusing the internal 0.0-gap-fill for cash scalars** → the SC-4 killer for broker guard days AND every weekend user-CSV. Always pass `scalar_returns`.
- **Branching venue/denominator INSIDE the derive** → violates #6; keep the fork upstream, feed one derive.
- **Healing stale rows arm-by-arm as the only guarantee** → MED-1 bug class; status-gate the reader instead.
- **Shipping a transactional-finalize SECDEF without test-project MCP catch-up** → new-milestone migs need catch-up before merge or the RED-guarded SQL tests fail.
- **`Write`-truncating gitignored `.planning` docs** (memory `feedback_gsd_subagent_write_truncates_planning`) — executors use Edit, not Write, on `.planning`.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Sparse rows + scalar cache + gap mask | a parallel composite/cash derive | `derive_basis_series` (+ `scalar_returns`) | it IS the shared route; a fork reintroduces the divergence 105 exists to kill |
| Series row upsert / heal | direct `.table()` writes | `persist_basis_series` → `upsert_strategy_analytics_series_batch` | single-row atomic replace + hardened SECDEF + heal-delete |
| Cash conventions | hardcode 365/geometric/calendar | `periods_per_year_for_asset_class` + `parse_returns_denominator_config` | #597 clock + Zavara override; hardcoding = wrong money numbers |
| periods_per_year selection | keep two rules | the one `asset_class` rule + `_COMPOSITE_CRYPTO_VENUES` backstop | F-1 already forces agreement; two rules = latent divergence |
| Byte-identity proof | manual eyeball | `assert_frame_equal(check_exact=True)` dual-run | precedent `test_native_nav_sc4_identity.py` / `test_cash_basis_series_sc4.py` |

## Runtime State Inventory

> Refactor/re-route phase touching prod persistence. Explicit answers:

| Category | Items | Action |
|---|---|---|
| Stored data | Composite cash SCALARS now sourced from `derive_basis_series` cache (must be byte-identical); `cash_settlement` series row (dark since 104) becomes reader-consumable in 106. `csv_daily_returns` rows unchanged in 105. | SC-4 golden sweep; NO data migration in 105 (fold is 106). |
| Live service config | None — confined to worker code + shared route. `USE_COMPUTE_JOBS_QUEUE`/`process_key_unified_backbone` READ-only (flip is 106). | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | `BROKER_DAILIES_VIA_FUNDING` kill-switch READ-only (its `false` rollback orphans dark rows → covered by MED-1 status-gate). | None. |
| Build artifacts / migrations | 105 ships **no DDL** if transactional-finalize uses ordered-idempotent (option b). If option (a) SECDEF RPC → a migration ships → prod-auto-apply + test-project MCP catch-up required. | Decide finalize shape; if DDL, budget catch-up + migration-reviewer + rls-auditor. |

## Common Pitfalls

### Pitfall 1 — The `derive_basis_series` 0.0-densify diverges from every legacy cash scalar (SC-4 killer)
See the central answer. Fix = pass `scalar_returns` + carry `densify_policy`. **HIGH.**

### Pitfall 2 — Composite member-guard interior NaN
`stitch_clipped_series` preserves a member's DQ-01 guard day as in-index NaN; `_metrics_result_for` breaks on it (F-5 arm), `derive_basis_series` (default) bridges it. The `scalar_returns=gap_fill(stitched)` input reproduces the break. **HIGH.**

### Pitfall 3 — Round-trip guard reddens on broker/user-CSV without the densify tag
The sparse persisted rows don't encode how the scalar was densified. Carry `conventions.densify` so the round-trip/reader rebuilds the exact scalar input. **HIGH (new).**

### Pitfall 4 — Assuming #5 is unsafe / changes a scalar
It is safe: the F-1 backstop (`job_worker.py:4214-4223`) already fails any composite whose venue-blend disagrees with its `asset_class` clock, so no live row diverges. Prove with an equality assertion across existing fixtures. **HIGH.**

### Pitfall 5 — MED-2 ccxt override
A ccxt strategy with a `returns_denominator_config` override must resolve `simple/active` venue-agnostically (not `geometric/calendar`). Add a ccxt-override round-trip fixture. **MEDIUM** (zero prod rows today, but the guard must hold).

### Pitfall 6 — Non-atomic finalize partial state
See SC-5. Ordered-idempotent or a SECDEF RPC. **MEDIUM.**

### Pitfall 7 — Deleting `_metrics_result_for` while a caller remains
Grep-gate the deletion (`git grep _metrics_result_for` == 0) and confirm the MTM arm (already off it since 103) and the F-5 ValueError arm are re-homed onto the `derive_basis_series` ValueError path. **MEDIUM.**

## Code Examples

### Composite cash re-route (replaces `_metrics_result_for`)
```python
# Source pattern: job_worker.py:4262-4290 (delete) + basis_series.py:124 (adopt)
from services.basis_series import derive_basis_series, persist_basis_series
from services.broker_dailies import gap_fill_daily_returns

_cash_basis_result = derive_basis_series(
    stitched_cash,                                   # ROWS: _drop_nonfinite → sparse honest
    benchmark_rets,
    periods_per_year=periods_per_year,               # #5: the one asset_class rule
    cumulative_method=cumulative_method,
    day_basis=day_basis,
    benchmark_symbol="BTC",                          # LOW-2: carry benchmark identity on composite
    scalar_returns=gap_fill_daily_returns(stitched_cash),  # SCALAR: byte-identical to _metrics_result_for
    densify_policy="zero_fill",                      # Pitfall 3: round-trip/reader rebuild key
)
cash_metrics_json = dict(_cash_basis_result.metrics_json)   # headline == by-basis.cash_settlement
# persist series (transactional with scalars — SC-5)
```

### Single-key user-CSV (the broad SC-4 case) — pass the SPARSE series
```python
# Source: analytics_runner.py:2259-2324 — user CSV (api_key_id IS NULL) stays sparse
scalar_input = returns if not _is_broker_sourced else returns.reindex(dense_index)  # NaN-reinstate for broker
result = derive_basis_series(
    returns, benchmark_rets,
    periods_per_year=_periods_per_year, cumulative_method=_cumulative_method, day_basis=_day_basis,
    benchmark_symbol="BTC",
    scalar_returns=scalar_input,
    densify_policy=("broker_nan" if _is_broker_sourced else "sparse"),
)
```

## State of the Art

| Old | Current (105) | Impact |
|---|---|---|
| Composite cash scalar via bespoke `_metrics_result_for` | scalar = cache of persisted `cash_settlement` series via `derive_basis_series(scalar_returns=…)` | last composite-cash bypass deleted; divergence class killed |
| Two `periods_per_year` rules (venue-blend + asset_class) | one asset_class rule; venues only as unknown-venue backstop | F-1 backstop already forced agreement → safe collapse |
| venue/denominator branch inside/around the derive | fork upstream → one derive; MED-2 fixed | dailies-canonical |
| cash scalar could exist without a series (onboarding, terminal arms) | onboarding persists series; reader status-gates stale rows | MED-1 closed |

## Environment Availability

| Dependency | Required by | Available | Fallback |
|---|---|---|---|
| pytest (analytics-service, `--cov-fail-under=80`) | SC-4 dual-run + round-trip | ✓ (`pytest.ini`) | — |
| `strategy_analytics_series` + hardened RPC | cash series persist | ✓ (prod + test proj) | — |
| Supabase MCP (executor) | test-project catch-up | ✗ | Only needed IF transactional-finalize ships DDL (option a). Option (b) needs none. |
| Railway analytics deploy | prod verify | ✓ (post-merge) | dark/behind-flag → no live gate in 105 |

**Blocking with no fallback:** none in 105. **Conditional:** a transactional-finalize SECDEF (option a) makes test-project MCP catch-up a merge prerequisite.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | pytest (analytics-service), `--cov-fail-under=80` |
| Config | `analytics-service/pytest.ini` (`testpaths = tests`) |
| Quick run | `cd analytics-service && python -m pytest tests/test_basis_series.py tests/test_cash_basis_series_sc4.py tests/test_stitch_composite_job.py -x` |
| Full suite | `cd analytics-service && python -m pytest --cov --cov-fail-under=80` |

### Phase Requirements → Test Map
| Behavior | Type | Command | Exists? |
|---|---|---|---|
| Composite cash scalar byte-identical to `_metrics_result_for` (member-guard-NaN fixture) | dual-run | `pytest tests/test_composite_headline_parity.py -x` (extend) | ⚠️ extend |
| Single-key broker CSV byte-identical (guard-day fixture) | dual-run | `pytest tests/test_cash_basis_series_sc4.py -x` | ✅ extend |
| Single-key user-CSV byte-identical (weekend-gap fixture) | dual-run | new `test_cash_basis_series_sc4.py::test_user_csv_weekend` | ❌ Wave 0 |
| #5 two rules resolve equal on every existing composite fixture | unit | `pytest tests/test_stitch_composite_job.py -k periods -x` | ❌ Wave 0 |
| MED-2 ccxt-override round-trip holds | unit | `pytest tests/test_basis_series.py -k denominator -x` | ❌ Wave 0 |
| MED-1 stale row after terminal arm not trusted (status-gate) | unit | new reader-gate test | ❌ Wave 0 |
| `git grep _metrics_result_for` == 0 | grep-gate | CI/plan verification step | ❌ Wave 0 |
| Onboarding persists a series alongside `metrics_snapshot` (#4 / if in 105) | unit | `pytest routers/... ` or `test_process_key` | ❌ Wave 0 |

### Sampling
- **Per commit:** the quick-run set above.
- **Per wave merge:** full analytics suite `--cov-fail-under=80`.
- **Phase gate:** full suite green + `check_exact=True` SC-4 sweep (composite + broker + user-CSV + Zavara) + `_metrics_result_for` grep-gate == 0 before `/gsd:verify-work`. Frontend vitest unaffected (no frontend surface in 105).

### Wave 0 gaps
- [ ] `derive_basis_series` `scalar_returns`+`densify_policy` params + their unit tests (default path byte-invisible for MTM).
- [ ] SC-4 sweep fixtures: composite-member-guard-NaN, broker-guard-day, user-CSV-weekend, Zavara simple/active, ccxt-override.
- [ ] #5 equality assertion across existing composite fixtures.
- [ ] MED-1 reader status-gate test; MED-2 ccxt-override round-trip test.
- [ ] `_metrics_result_for` grep-gate wired into CI/verification.
- No framework install needed.

## Security Domain

> `security_enforcement` absent in config → enabled.

| ASVS | Applies | Control |
|---|---|---|
| V4 Access Control | yes | series/scalar writes stay on service-role-only SECDEF RPC + RLS deny-all; **do not widen**. If a transactional-finalize SECDEF is added, harden (`SET search_path=public,pg_temp` + REVOKE PUBLIC/anon/authenticated + service-role grant) and route through migration-reviewer + rls-policy-auditor. |
| V5 Input Validation | yes | `basis`/`densify_policy`/`kind` are code-controlled constants, not user input; floats via `_safe_float` (postgrest rejects NaN). |
| V6 Cryptography | no | credential path unchanged. |

| Threat | STRIDE | Mitigation |
|---|---|---|
| New loose-search_path SECDEF (transactional finalize) | EoP | avoid if option (b); else harden + review. |
| Prod DDL auto-apply on merge | Tampering/availability | 105 prefers NO DDL; the fold DDL is 106. |
| Stale/leaked cash series row surfaced as a wrong money number | Integrity/info-disclosure | MED-1 read-side status-gate + heal-delete. |
| GDPR export axis breakage on the fold | Info-disclosure/compliance | fold is DECIDE-only in 105; 106 repoints both GDPR axes with tests. |

## Split Recommendation

**Recommend: ONE phase (105) for #1 + #2 + #5 + #6 + transactional finalize + MED-1 + MED-2 + benchmark-identity carry + series-store-fold DECISION; carve onboarding (#4) into 105.1 IF the plan exceeds ~2 waves.**

Rationale:
- **#1 + #2 + #5 + #6 are one conceptual move** bound by a **single SC-4 gate** and a **single `derive_basis_series` change** (the `scalar_returns` decoupling). #6 *feeds* #1's single derive; #5 falls out of #1's composite compute; #2 (user-CSV) is the **broadest** SC-4 blast radius and shares the *exact same* `derive_basis_series` change — the inventory explicitly sequences it "do together with #1." Splitting these half-does the reconciliation and risks two divergent proofs.
- **#4 onboarding is the clean carve** — a *different file* (`routers/process_key.py`), a *different store* (`strategy_verifications.metrics_snapshot`, not the authoritative `strategy_analytics`), and an **additive/dark** write with **no byte-identity coupling** to existing factsheets. It can land in 105.1 without touching the SC-4 core. (The ROADMAP load-note offers "onboarding OR fork-collapse" — fork-collapse (#6) is too coupled to #1 to carve, so **onboarding is the correct carve.**)

**Suggested wave shape for the planner:**
- **Wave 0:** `derive_basis_series` `scalar_returns`+`densify_policy` params + full SC-4 fixture harness (composite/broker/user-CSV/Zavara/ccxt-override) + `_metrics_result_for` grep-gate.
- **Wave 1:** #6 fork-collapse (venue-source + denominator upstream, venue-agnostic → fixes MED-2) feeding a single derive.
- **Wave 2:** #1 composite re-route + `_metrics_result_for` DELETE + #5 collapse + #2 single-key CSV swap + MED-1 read-side status-gate + transactional finalize + benchmark-identity carry + fold DECISION doc.
- **(105.1 if >2 waves):** #4 onboarding sync-arm series persist.

If Wave 2 is too dense at plan-time, promote #2 (single-key CSV) or #4 (onboarding) to the split. Prefer carving #4.

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | The `scalar_returns` decoupling (not a mode flag inside the derive) is the cleanest SC-4 fix | Central answer | If the team prefers a mode flag, still SC-4-safe but couples a branch into the derive (mild #6 tension) |
| A2 | #5 collapse changes no live scalar because the F-1 backstop forces venue-blend == asset_class | Collapse #5 | If a live composite predates the F-1 backstop, a scalar could shift — assertion test on all existing composite fixtures gates this |
| A3 | #6 is largely structural (forks already byte-identical shape; denominator already branch-outer) | Collapse #6 | If a fork path mutates the series differently, an extra normalization is needed |
| A4 | user-CSV single-key (#2) belongs in 105 core (shares the derive change) | Split | If carved to 105.1, two SC-4 proofs of the same change — mild duplication |
| A5 | Transactional finalize can be ordered-idempotent without a new SECDEF (option b) | SC-5 | If a real partial-state resists ordering, option (a) SECDEF ships DDL → test-project catch-up |
| A6 | Onboarding teaser writes only to `strategy_verifications` (separate store, no factsheet byte-identity coupling) | Collapse #4 / split | If the teaser scalar feeds an authoritative factsheet reader, #4 gains an SC-4 coupling and shouldn't carve |
| A7 | MED-1 read-side status-gate is cleaner than N-arm heal-deletes | MED-1 | If the reader can't see `computation_status` at its read point, heal-at-arms is required instead |
| A8 | Series-store fold = tall `daily_returns`+`basis` (not JSONB); executed 106 | Fold decision | ROADMAP-confirmed; low risk |

## Open Questions

1. **Transactional finalize: ordered-idempotent (no DDL) or SECDEF RPC (DDL)?** Recommend ordered-idempotent; confirm no partial-state resists it. If DDL, budget test-project MCP catch-up + migration/rls review. (A5)
2. **Does #4 onboarding land in 105 or 105.1?** Recommend 105.1 carve if >2 waves; confirm the teaser store has no authoritative-factsheet coupling. (A6)
3. **Is any live published composite predating the F-1 backstop where the two `periods_per_year` rules disagree?** Recommend an assertion test across all existing composite fixtures before the collapse. (A2)
4. **Reader status-gate site for MED-1** — confirm the 106 cash reader (and the 105 round-trip guard) can read `computation_status` at the point it trusts a series row. (A7)

## Sources

### Primary (HIGH — code-verified this session)
- `analytics-service/services/basis_series.py:1-256` — `derive_basis_series` densify pipeline, `_KIND_BY_BASIS`, `persist_basis_series`, conventions echo (incl. 104 benchmark key)
- `analytics-service/services/job_worker.py:2040-2170` (venue/denominator fork), `:3188-3216` (104 cash echo), `:4095-4290` (composite periods_per_year + F-1 backstop + `_metrics_result_for`), `:4311-4514` (MTM shared-route arm + non-atomic persist)
- `analytics-service/services/analytics_runner.py:2230-2324` — single-key legacy cash scalar path (broker NaN-reinstate, user-CSV sparse, venue-agnostic denominator)
- `analytics-service/services/broker_dailies.py:123-197` — `gap_fill_daily_returns`, `combine_realized_and_funding`, `combine_native_ledger` (byte-identical shape)
- `analytics-service/services/metrics.py:43,197-201,398-470` — `periods_per_year_for_asset_class`, `_drop_nonfinite`, `compute_all_metrics` conventions
- `analytics-service/services/stitch_composite.py:217-263` — `stitch_clipped_series` (no gap-fill), `_consecutive_spans`
- `analytics-service/routers/process_key.py:854-946` — onboarding teaser scalar-only `metrics_snapshot`
- `grep -rln csv_daily_returns` (66 files) — series-store fold reader inventory
- `.planning/ROADMAP.md:19,108-189` (§Phase 105 + backbone coverage matrix), `.planning/BACKBONE-BYPASS-INVENTORY.md`, `.planning/phases/104-.../104-RESEARCH.md` (SC-4 series-only boundary), `.planning/STATE.md`

### Secondary (MEDIUM)
- Memory: `feedback_dailies_canonical_unified_derive`, `project_unified_backbone_csv_flag_flip` (flag flip exposed 2 latent CSV bugs), `project_test_project_catchup_unmasks_stale_tests`, `reference_db_test_ci_wiring`

## Metadata

**Confidence breakdown:**
- SC-4 divergence math + `scalar_returns` fix: HIGH — every branch read in source
- #5 safety (F-1 backstop forces agreement): HIGH — backstop verified `job_worker.py:4214-4223`
- #6 structural / MED-2 fix: MEDIUM-HIGH — shapes verified; exact fork-move placement is plan-time
- Transactional finalize shape: MEDIUM — a genuine DDL-vs-ordering decision
- Split recommendation: MEDIUM — judgment; coupling analysis is HIGH

**Research date:** 2026-07-14
**Valid until:** ~2026-08-14 (re-confirm `job_worker.py` line numbers before planning — actively edited; the composite region shifted between 104 and now).

## RESEARCH COMPLETE

**Phase:** 105 — Composite → the one CSV finalize route
**Confidence:** HIGH (central SC-4 answer + collapse safety); MEDIUM on transactional-finalize DDL shape and split.

### Key findings
- **The SC-4 answer:** `derive_basis_series`'s internal `_drop_nonfinite → gap_fill(0.0)` diverges from all three legacy cash paths (composite member-guard NaN → bridge; broker guard day → bridge; **user-CSV weekends → 0.0-diluted vol/Sharpe, the broadest blast radius**). Fix = add `scalar_returns` (+ echoed `densify_policy`) so the caller passes the exact legacy-conditioned series; scalar is byte-identical by construction, MTM default path unchanged, derive stays branchless (conditioning moves upstream = collapse #6).
- **#5 is safe today:** the F-1 backstop (`job_worker.py:4214-4223`) already fails any composite whose venue-blend disagrees with its `asset_class` clock — collapsing to the one `asset_class` rule changes no live scalar.
- **#6 is largely structural:** the venue-source forks already return byte-identical shape; `denominator_config` is already branch-outer — and resolving it venue-agnostically **fixes MED-2** by construction.
- **MED-1:** recommend a **read-side status-gate** (single choke point covering all terminal arms) over arm-by-arm heal-deletes.
- **Series-store fold:** 66 reader files incl. 2 GDPR axes + RLS/SECDEF → **tall `daily_returns`+`basis` survives** (not JSONB); DECIDE in 105, EXECUTE 106.

### File created
`.planning/phases/105-composite-the-one-csv-finalize-route/105-RESEARCH.md`

### Split recommendation
**ONE phase for #1+#2+#5+#6 + transactional finalize + MED-1/MED-2 + fold-decision (all bound by the single SC-4 gate and the one `derive_basis_series` change); carve onboarding (#4) into 105.1 if the plan exceeds ~2 waves** — it is an additive/dark write to a separate store (`strategy_verifications.metrics_snapshot`) with no factsheet byte-identity coupling.

### Ready for planning
Research complete. The planner can create PLAN.md files; confirm the transactional-finalize shape (DDL vs ordered-idempotent) and the #4-carve decision at `/gsd:plan-phase` discuss.
