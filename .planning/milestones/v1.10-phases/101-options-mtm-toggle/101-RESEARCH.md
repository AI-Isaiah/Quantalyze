# Phase 101: Options MTM Toggle (analytics / pnl_basis) - Research

**Researched:** 2026-07-12
**Domain:** analytics-service worker — Deribit native ledger, `pnl_basis=mark_to_market`, factsheet by-basis persistence
**Confidence:** HIGH (codebase-verified, file:line throughout)

## Summary

**VERDICT: GO — the mark data IS ingested and the MTM math for options already exists and is tested.** This phase is NOT blocked. The exchange's daily fair-value signal for a Deribit options book is carried by `options_settlement_summary` rows (`realized_pl + unrealized_pl`), which are ingested by the existing Deribit txn-log crawl. The Phase-82 `pnl_basis == mark_to_market` code path in `deribit_txn.py` already re-attributes option P&L using that channel and is covered by `test_deribit_txn.py` / `test_zavara_acceptance.py`. `compute_all_metrics` is basis-agnostic (it just consumes a returns Series).

**The real gap MTM-01 must close is a persistence/plumbing gap, not a math gap.** The single-key broker path (`run_derive_broker_dailies_job`) computes exactly ONE basis today — whichever `denominator_config.pnl_basis` selects (default `cash_settlement`) — and never writes a second `metrics_json_by_basis.mark_to_market` object. Only the COMPOSITE stitch job (`run_stitch_composite_job`) currently runs two passes and persists a by-basis object. So for a single-key options book the MTM basis object is simply ABSENT, the client overlays `{}`, and all seven KPIs render "—". Enabling the toggle = teach the single-key derive path to run a SECOND `mark_to_market` pass (mirroring the composite job's dual-pass) and persist `metrics_json_by_basis.mark_to_market`, then relax the single-key MTM-availability gate where the summary channel is present.

**Primary recommendation:** Add an additive `mark_to_market` pass to `run_derive_broker_dailies_job` that calls the SAME `build_deribit_native_ledger(..., pnl_basis="mark_to_market")` / `combine_native_ledger` primitives already used by the composite job, persist it into `metrics_json_by_basis.mark_to_market` alongside the untouched cash object, and gate it on the presence of the `options_settlement_summary` channel (honest degrade-with-reason when absent). Do NOT design any smoothing — the raw MTM curve is the honest output (LOCKED).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **NO smoothing.** The daily mark-to-market curve from the exchange's mark data is the honest output — its volatility is real unrealized risk (the whole point of the MTM view). Do NOT average/smooth/fabricate. `cash_settlement` (realized at settlement) is the smooth one; MTM (economic, daily) is the jumpy one — showing the contrast honestly IS the feature.
- **Reuse the existing `pnl_basis` machinery** (v1.8: `compute_all_metrics` pnl_basis cash_settlement/mark_to_market). Do NOT build new valuation logic.
- **Use the exchange's fair-value `mark_price`** (Deribit publishes a proper mark, NOT last-trade) — the only legitimate "data quality" concern is stale/last-trade jitter, and using `mark_price` addresses it. NO custom smoothing. *(⚠️ See Open Question OQ-1 / Assumption A1: the ingested MTM signal is NOT a `mark_price` field — it is the `options_settlement_summary.realized_pl + unrealized_pl` channel. Substantively this IS the exchange's own daily fair-value/mark decomposition, so the intent holds, but the planner must not instruct anyone to read a `mark_price` column — that field is absent on the settlement rows this project ingests.)*
- **Honest-gate preserved:** if a book genuinely has NO mark data ingested, it still degrades with a reason (disabled-with-reason) — never a fabricated line.
- **SC-4:** `cash_settlement` for every existing strategy stays byte-identical; single-key + composite published metrics unperturbed.

### Claude's Discretion (DELEGATED to Fable/planner)
- How exactly to flip the factsheet toggle-availability gate for options (remove/relax the disabled-with-reason condition where mark data exists) vs where it's genuinely absent.
- Any data-shape/read-path detail the research surfaces.

### Deferred Ideas (OUT OF SCOPE — Phase 102)
- Composite MTM compose + Zavara regression + factsheet UI wiring.
- Composite read-path (`composite-read-path.ts`) integration.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MTM-01 (core) | Factsheet `cash_settlement ↔ mark_to_market` toggle ENABLED for an options-trading strategy: selecting `mark_to_market` recomputes returns from ingested API mark data via existing `pnl_basis=mark_to_market` path; `cash_settlement` byte-identical (SC-4); genuinely-absent mark data → degrade with reason. | Math path EXISTS + tested (`deribit_txn.py` Phase-82, `combine_native_ledger(pnl_basis=)`). Gap = single-key derive persists only one basis (`job_worker.py:2122-2193`, `analytics_runner.py:2389-2411`). Composite dual-pass is the template (`job_worker.py:3690, 3870, 4018-4020`). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Compute the MTM daily-returns series for an options book | API / Backend (analytics-service worker) | Database (persist `metrics_json_by_basis`) | The MTM re-attribution is pure ledger math (`deribit_txn.py`) run in the worker; result persisted to `strategy_analytics.metrics_json_by_basis` |
| Decide MTM availability (gate) | API / Backend (worker stamps `data_quality_flags.mtm_gated_reason` + omits the basis key) | — | Server truth only; no client predicate (`basis-context.tsx:97-98` "Server truth only — no client ledger predicate") |
| Display/toggle basis | Frontend Server (build-payload) + Browser (ephemeral React state) | — | `useBasis()` is component-state-only, overlays persisted scalars (`basis-context.tsx:43-94`) — **Phase 102 scope, not 101** |

## Standard Stack

No new external packages. This is entirely in-repo Python (analytics-service) + existing TS types. **No `## Package Legitimacy Audit` needed — zero external installs.**

### Core (existing, in-repo)
| Module | Purpose | Role in MTM-01 |
|--------|---------|----------------|
| `analytics-service/services/deribit_txn.py` | PURE options-aware ledger core; Phase-82 MTM channel | The MTM math — already implemented + tested. Reuse verbatim. |
| `analytics-service/services/deribit_ingest.py` | Deribit txn-log crawl → `build_deribit_native_ledger`, `NativeLedger`, `CompletenessReport` | Ingests `options_settlement_summary` rows; `deribit_raw_rows_have_option_activity` is the option-activity signal (`:787`) |
| `analytics-service/services/broker_dailies.py` | `combine_native_ledger(...)` | Turns the native ledger + `pnl_basis` into a daily-returns Series + meta |
| `analytics-service/services/allocated_capital.py` | `parse_returns_denominator_config`, `_VALID_PNL_BASES` (`:56`), `metrics_day_basis` | pnl_basis validation + day-basis mapping |
| `analytics-service/services/metrics.py` → `compute_all_metrics` | Basis-agnostic metrics from a returns Series | Called once per basis pass — unchanged |
| `analytics-service/services/job_worker.py` | `run_derive_broker_dailies_job` (single-key, `:1890`), `run_stitch_composite_job` (composite dual-pass, `:2886+`) | **The single-key job is where the second MTM pass must be added** |
| `analytics-service/services/stitch_composite.py` | `mark_to_market_available` gate (`:258-274`), `MemberBasisSignal`, reason constants (`:95-96`) | Composite-level gate; single-key equivalent gate must be authored/relaxed |

## Architecture Patterns

### Data flow (single-key options book → factsheet MTM)
```
Deribit txn-log crawl (build_deribit_native_ledger, deribit_ingest.py)
    │  ingests trade / delivery / settlement / options_settlement_summary rows
    ▼
NativeLedger + CompletenessReport
    │
    ├── pass 1  combine_native_ledger(pnl_basis="cash_settlement")  ── EXISTS TODAY
    │       └── returns_cash ─► csv_daily_returns (charting) + headline metrics_json
    │
    └── pass 2  combine_native_ledger(pnl_basis="mark_to_market")   ── ⚠️ MISSING for single-key
            └── returns_mtm ─► compute_all_metrics ─► metrics_json_by_basis.mark_to_market
                                (gated on options_settlement_summary present; else omit key + stamp reason)
    ▼
strategy_analytics.metrics_json_by_basis = {"cash_settlement": {...}, "mark_to_market": {...}?}
    ▼  (Phase 102 — read side, OUT OF SCOPE here)
page.tsx → build-payload → useBasisMetrics overlay → SegmentedControl toggle
```

### Pattern: the composite job already does the dual pass — copy its shape
`run_stitch_composite_job` (`job_worker.py`) is the working template:
- `cash_result = await _reconstruct_all(cash_pnl_basis, ...)` (`:3690`)
- runs an MTM pass, then `mtm_ok, mtm_reason = mark_to_market_available(member_signals)` (`:3870`)
- persists `metrics_json_by_basis = {"cash_settlement": cash_metrics_json}` and conditionally `["mark_to_market"] = mtm_metrics_json` (`:4018-4020`)
- stamps/drops `merged_flags["mtm_gated_reason"]` (`:4077-4084`)

MTM-01 replicates this two-pass + conditional-key + gate-reason pattern inside the **single-key** `run_derive_broker_dailies_job` (and/or the CSV-analytics finalizer). The single-key derive currently stops at one pass (`job_worker.py:2122-2193`).

### Anti-Patterns to Avoid
- **Do NOT add smoothing / averaging** — LOCKED. The `options_settlement_summary` channel already gives an honest daily session-delta; the whole point is the raw jumpy curve.
- **Do NOT read a `mark_price` column** — settlement rows carry `index_price`, not `mark_price` ("account 3: 218/218 present; `mark_price` absent", `deribit_txn.py:16`). The MTM signal is `options_settlement_summary.realized_pl + unrealized_pl`.
- **Do NOT touch the cash pass** — under `cash_settlement` the entire Phase-82 amendment is dark (`deribit_txn.py:28-34`); keep the two `combine_native_ledger` calls fully independent so SC-4 holds by construction.
- **Do NOT route the single-key headline through the composite path** — they are deliberately separate (`job_worker.py:3160` "DELIBERATELY not refactored").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Options daily MTM valuation | A new smoothing/mark model | `deribit_txn.py` Phase-82 channel via `combine_native_ledger(pnl_basis="mark_to_market")` | Already implemented, tested, fail-loud on incomplete coverage |
| pnl_basis validation | Ad-hoc string checks | `parse_returns_denominator_config` / `_VALID_PNL_BASES` (`allocated_capital.py:56,229`) | Single owner, fail-loud on typo |
| Metrics from a returns series | Custom sharpe/vol/maxdd | `compute_all_metrics` (basis-agnostic) | Already conventions-threaded (asset-class √365/√252) |
| MTM-availability decision | New predicate | `mark_to_market_available` shape (`stitch_composite.py:258`) + `deribit_raw_rows_have_option_activity` (`deribit_ingest.py:787`) | Single-owner honesty gate; closed reason set |

## Runtime State Inventory

Not a rename/refactor phase — but there IS a data-recompute dimension (a re-derive writes to `strategy_analytics`):

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics.metrics_json_by_basis` (jsonb; Phase-85 CHECK allows NULL or object). Single-key options rows currently have NO `mark_to_market` key. | Re-derive writes the new key; additive. `cash_settlement` object + headline scalars must stay byte-identical (SC-4). |
| Live service config | None — no external service config embeds this. | None. |
| OS-registered state | None — worker jobs are queue-driven (`compute_jobs` / `USE_COMPUTE_JOBS_QUEUE`), no OS registration. | None — verified: gate is `derive_broker_dailies` dispatch (`job_worker.py:1499-1502`). |
| Secrets/env vars | None new. `USE_COMPUTE_JOBS_QUEUE=true` already required in prod (from MEMORY). | None. |
| Build artifacts | None. | None. |

**Migration note:** enabling MTM for an existing options strategy requires a RE-DERIVE of that strategy (to populate `metrics_json_by_basis.mark_to_market`). A code edit alone changes only how NEW derives are written; existing rows need a re-run. Plan a re-derive task for the target book(s).

## Common Pitfalls

### Pitfall 1: Pre-rollout straddle FAILS LOUD under mark_to_market
**What goes wrong:** A Deribit option book open across the ~2025-01-12 `options_settlement_summary` rollout has no boundary V₀ anchor → the MTM basis FAILS LOUD (`deribit_txn.py` docstring `:636-650`: "a pre-rollout straddle ... FAILS LOUD under this basis (no boundary-book V₀ anchor is computed; that machinery was removed as an invalid closed form). Use `cash_settlement` for such accounts").
**How to avoid:** The single-key MTM gate must catch this fail-loud and degrade-with-reason (omit the key + stamp a reason) rather than failing the whole derive. Zavara's corroborated window is Aug 2025–Mar 2026 (post-rollout, per MEMORY) so Zavara itself should be fine — but the gate must handle the general case honestly.
**Warning signs:** MTM pass raises inside `combine_native_ledger` / `assert_balance_identity` while the cash pass succeeds.

### Pitfall 2: MTM re-dates premium — it MUST NOT match the cash track
**What goes wrong:** A reviewer sees the MTM curve diverge from Zavara's cash-basis track and calls it a bug. It is BY DESIGN (`deribit_txn.py:636` "By design this does NOT match zavara's cash-basis track (it re-dates premium off the trade day)").
**How to avoid:** The parity/golden test asserts `cash_settlement` byte-identity ONLY; the MTM test asserts a FINITE curve, not equality to cash.

### Pitfall 3: Missing summary in mid-window → fail-loud, not silent zero
**What goes wrong:** If a currency's summary coverage window has a hole, the core fails loud (`deribit_txn.py:1424-1428`).
**How to avoid:** This is the honest-gate behavior — surface as degrade-with-reason at the single-key level; never zero-fill.

### Pitfall 4: Wiping the cash object / headline on the additive write
**What goes wrong:** A full upsert of `metrics_json_by_basis` or headline scalars could perturb `cash_settlement` bytes (SC-4 breach). Note `analytics_runner.py:2403-2406` NULLs `metrics_json_by_basis` when a strategy stops being a composite — the single-key write path must now WRITE the object instead of nulling it for options books.
**How to avoid:** Mirror the composite job's construction: `{"cash_settlement": <unchanged cash object>}` then conditionally add `mark_to_market`. Headline == `cash_settlement` by construction (`job_worker.py:2895, 3805-3826`).

## The Four Load-Bearing Answers (concrete, file:line)

### Q1 — The gate: WHERE is the toggle disable, and what condition disables it for options?
**Two distinct gates:**

1. **Composite gate (exists):** `mark_to_market_available(members)` — `stitch_composite.py:258-274`. Returns `(False, "unsmoothed_options_book")` if `any(m.has_option_activity for m in members)` (`:270`), else `(False, "mtm_basis_unavailable_for_venue")` for non-native venues (`:272`). Reason constants `MTM_REASON_OPTIONS`/`MTM_REASON_VENUE` at `:95-96`. The option-activity signal is `deribit_raw_rows_have_option_activity` (`deribit_ingest.py:787-791`) = presence of an `options_settlement_summary`-typed row. Result → `data_quality_flags.mtm_gated_reason` (`job_worker.py:4082`) → read by `page.tsx:87` → `payload.mtmGate.reason` → `FactsheetView.tsx:1069` `mtmDisabledReasonCopy()` → `SegmentedControl` `disabledReason` (`FactsheetView.tsx:1182`, `SegmentedControl.tsx:10,50`). Copy: `basis-context.tsx:100-108`, `"unsmoothed_options_book"` → *"Mark-to-market disabled: un-smoothed options book (Phase-83 daily-mark smoothing not applied)"*.

2. **Single-key "gate" (implicit — the real MTM-01 target):** There is NO single-key gate function because the single-key derive **never computes an MTM basis at all**. `run_derive_broker_dailies_job` picks ONE `pnl_basis` (`job_worker.py:2122-2126`, default `DEFAULT_PNL_BASIS = cash_settlement`) and runs a single `combine_native_ledger` (`:2189`). The CSV-analytics finalizer writes only the cash headline and NULLs `metrics_json_by_basis` on composite→single transitions (`analytics_runner.py:2389-2411`). So `metrics_json_by_basis.mark_to_market` is ABSENT → client overlays `{}` → seven "—".

**What enabling requires:** (a) add a second `mark_to_market` pass to the single-key path using the SAME primitives; (b) persist it additively into `metrics_json_by_basis.mark_to_market`; (c) author a single-key availability gate (present summary channel + not a pre-rollout straddle → available; else omit key + stamp reason). The `unsmoothed_options_book` reason copy will need revisiting in Phase 102 (it references the now-dropped Phase-83 smoothing framing) — but that's the UI/copy side.

### Q2 — pnl_basis machinery: how is mark_to_market computed, does it handle options or bail?
It **handles options** — it is the options-AWARE path, it does not bail. Under `pnl_basis == mark_to_market` (`deribit_txn.py:28-40, 603-645`):
- option `trade`/`delivery` rows contribute `−commission` only (NOT their premium `change`);
- `options_settlement_summary` rows contribute `realized_pl + unrealized_pl` (a session DELTA — the exchange's own daily MTM decomposition, `:603-614, 1465-1472`);
- gated by a `use_mtm` flag in `txn_rows_to_native_daily`; sets must be disjoint (double-count guard, `:614-628`).
Threaded via `build_deribit_native_ledger(..., pnl_basis=pnl_basis)` (`job_worker.py:2147`) → `combine_native_ledger` (`:2189`). `compute_all_metrics` then consumes the resulting returns Series basis-agnostically (`allocated_capital.py` provides `metrics_day_basis`; `analytics_runner.py:2310-2316`). Consumes: the ingested Deribit txn-log rows (trade/delivery/settlement/`options_settlement_summary`). Covered by `test_deribit_txn.py`, `test_zavara_acceptance.py`, `test_allocated_capital.py`.

### Q3 — Is the mark data ingested? **YES → GO (not blocked).**
The exchange's daily fair-value signal for options = `options_settlement_summary` rows carrying `realized_pl + unrealized_pl` (`deribit_txn.py:603-614`). These are ingested by the standard Deribit txn-log crawl (`build_deribit_native_ledger` / `deribit_ingest.py`), and their presence IS the `has_option_activity` signal (`deribit_ingest.py:778-791`). Stored implicitly as raw ledger rows consumed at derive time (not a separate `mark_price` column). **⚠️ Correction to CONTEXT.md's "mark_price":** settlement rows carry `index_price`, and `mark_price` is explicitly ABSENT on the accounts probed (`deribit_txn.py:16`). The honest MTM signal is the settlement-summary session delta, which is substantively Deribit's own daily mark decomposition — so the intent ("exchange fair-value, not last-trade") holds, but the field name in CONTEXT is wrong. See Assumption A1.
**Honest-gate caveat:** a book with NO `options_settlement_summary` rows (or a pre-2025-01-12-rollout straddle) genuinely has no ingestible MTM → must degrade-with-reason, never fabricate.

### Q4 — SC-4: does enabling MTM change cash_settlement output? **NO — independent.**
Under `cash_settlement` NONE of the Phase-82 amendment runs (`deribit_txn.py:28-34`: "Under `cash_settlement` (the DEFAULT and shipped/Zavara basis) NONE of this runs ... the fee-only reclass / summary channel described here is dark"). The cash pass is a separate `combine_native_ledger(pnl_basis="cash_settlement")` call. The by-basis object is built as `{"cash_settlement": <unchanged>}` + conditional `mark_to_market` (`job_worker.py:4016-4020`), and headline == `cash_settlement` by construction (`:2895, 3805-3826`). Adding the MTM pass is purely additive; cash bytes unchanged by construction.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (analytics) | pytest + pytest-cov, `--cov-fail-under=80` (per CLAUDE.md); tests in `analytics-service/tests/` |
| Framework (TS) | vitest (`vitest.config.ts`, coverage-v8; gate lines 82/stmts 80/fns 74/branches 72) — **Phase 102 read-side only** |
| Quick run (analytics) | `cd analytics-service && pytest tests/test_deribit_txn.py tests/test_allocated_capital.py -x` |
| Full suite (analytics) | `cd analytics-service && pytest --cov --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| MTM-01 (SC-4 parity) | `cash_settlement` returns + headline byte-identical after adding MTM pass | golden/parity | `pytest analytics-service/tests/test_zavara_acceptance.py -x` (extend with a byte-identity assertion on the cash object) | ✅ extend |
| MTM-01 (finite MTM) | single-key options book with summary rows → FINITE `metrics_json_by_basis.mark_to_market` (7 headline scalars finite) | unit/integration | `pytest analytics-service/tests/test_deribit_txn.py -k mark_to_market -x` + new single-key-derive test | ⚠️ Wave 0 (new) |
| MTM-01 (honest gate) | book with NO summary channel / pre-rollout straddle → key OMITTED + reason stamped, cash pass still succeeds | unit | new test | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest analytics-service/tests/test_deribit_txn.py tests/test_allocated_capital.py -x`
- **Per wave merge:** `cd analytics-service && pytest --cov --cov-fail-under=80`
- **Phase gate:** full analytics suite green + Zavara acceptance parity before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] New test: single-key `run_derive_broker_dailies_job` produces `metrics_json_by_basis.mark_to_market` for an options book with summary rows (finite 7-scalar curve). Covers MTM-01.
- [ ] New test: cash-object byte-identity before/after the MTM-pass addition (SC-4). Extend `test_zavara_acceptance.py` or add `test_mtm_single_key_parity.py`.
- [ ] New test: honest-degrade — no summary channel / pre-rollout straddle → key omitted + `mtm_gated_reason` stamped, cash pass unaffected.
- Existing infra (`test_deribit_txn.py`, `test_allocated_capital.py`, `test_zavara_acceptance.py`) covers the underlying MTM math already.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python analytics-service (pytest) | all worker tests | ✓ (in-repo) | repo-pinned | — |
| Deribit txn-log data for target book | live MTM curve | data-dependent | — | Honest degrade-with-reason if summary rows absent |

No new external dependency. Live-Deribit tests skip in CI (per MEMORY: `*_live.py` SKIP in CI); the MTM math tests are network-free pure-core tests (`deribit_txn.py` is I/O-free by design, `:1-7`).

## Security Domain

`security_enforcement` not explicitly false → included, but blast radius is minimal (worker-internal analytics recompute, no new input surface):

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `parse_returns_denominator_config` fail-loud on malformed config (`allocated_capital.py:229`); Deribit rows validated in `deribit_txn.py` (fail-loud on nonzero `change` for summary rows, sign guards) |
| V6 Cryptography | no (worker-only decryption invariant already holds; no new key handling) | — |
| Others (V2/V3/V4) | no | — |

**Standing invariant (from REQUIREMENTS.md):** worker-only decryption (key ciphertext never leaves server) — unaffected; no new SECDEF SQL function introduced (pure recompute + additive jsonb write). If the plan adds ANY SQL function it must route through migration-reviewer + rls-policy-auditor with `search_path` + `REVOKE PUBLIC/anon/authenticated`.

## Project Constraints (from CLAUDE.md / AGENTS.md)
- analytics-service Python suite enforces `--cov-fail-under=80` (blocking).
- TS coverage is a blocking CI gate (lines 82 / stmts 80 / fns 74 / branches 72) — relevant only if Phase-102 touches TS; Phase 101 is Python-only.
- Migrations auto-apply to prod on merge (MEMORY) — this phase should need NONE (additive jsonb into an existing column with an existing Phase-85 CHECK).
- No-invented-data invariant: absent MTM → "—" / omitted key, never a fabricated line.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The ingested MTM signal is `options_settlement_summary.realized_pl + unrealized_pl`, NOT a `mark_price` field (CONTEXT.md says "mark_price"). | Q3 / User Constraints | LOW risk to feasibility (verified in code the summary channel exists + is the MTM path). Risk is only that the planner/discuss propagate the wrong field name — flagged loudly. Verified `[VERIFIED: deribit_txn.py:16,603-614]`. |
| A2 | Zavara's book is entirely post-2025-01-12 rollout (so it won't hit the pre-rollout-straddle fail-loud). | Pitfall 1 | MEDIUM — if Zavara has pre-rollout option activity, its single-key MTM would fail-loud and must degrade-with-reason. Zavara corroboration window Aug2025–Mar2026 (MEMORY) suggests post-rollout, but the FULL history start date was not confirmed in this session. Planner should verify the book's earliest `options_settlement_summary` date, or rely on the honest-gate to handle it. |
| A3 | The single-key derive is the correct insertion point for the second pass (vs. a new dedicated job). | Architecture Patterns | LOW — mirrors the composite job's own dual-pass; delegated to Fable per CONTEXT. |

## Open Questions

1. **OQ-1 — `mark_price` vs settlement-summary channel (field-name correction).**
   - What we know: The MTM math consumes `options_settlement_summary.realized_pl + unrealized_pl`; `mark_price` is absent on settlement rows (`deribit_txn.py:16`).
   - What's unclear: whether CONTEXT.md's "mark_price" language implies the user expects a per-instrument fair-value mark series (which this project does NOT ingest for options — it uses the summary session-delta).
   - Recommendation: Adopt the summary-channel (existing, tested) as THE MTM source; note to discuss-phase that "mark_price" was imprecise. No blocker.

2. **OQ-2 — single-key gate placement + reason copy.**
   - What we know: the composite gate + `unsmoothed_options_book` copy still reference the dropped Phase-83 "smoothing" framing (`basis-context.tsx:103`).
   - What's unclear: whether Phase 101 updates the reason copy or leaves UI/copy entirely to Phase 102.
   - Recommendation: Phase 101 stamps a machine reason (e.g., a `mtm_unavailable`/pre-rollout reason) at the worker level; the human-facing copy re-word is Phase-102 UI scope.

3. **OQ-3 — re-derive scope.**
   - What we know: existing single-key options rows need a re-derive to populate the new key.
   - Recommendation: include an explicit re-derive task for the target Deribit book(s) in the plan; verify `cash_settlement` byte-identity post-re-derive.

## Sources

### Primary (HIGH confidence — codebase, this session)
- `analytics-service/services/deribit_txn.py:1-40, 603-650, 1240-1472` — Phase-82 MTM channel, field semantics, pre-rollout limitation
- `analytics-service/services/job_worker.py:1499-1502, 1890-2193, 2886-2933, 3690, 3870, 4016-4084` — single-key vs composite derive; dual-pass template
- `analytics-service/services/stitch_composite.py:43-96, 258-274` — `mark_to_market_available` gate + reason constants
- `analytics-service/services/deribit_ingest.py:776-791, 1598-1664` — summary-channel ingestion + option-activity signal
- `analytics-service/services/allocated_capital.py:56, 198-360` — pnl_basis validation, day-basis mapping
- `analytics-service/services/analytics_runner.py:2280-2411` — single-key CSV finalizer (cash-only write, by-basis NULL-on-transition)
- `src/app/factsheet/[id]/v2/basis-context.tsx:29-108`, `basis-metrics.ts:18-94`, `types.ts:480-497`, `FactsheetView.tsx:1069,1182` — read-side toggle (Phase-102 consumer)

### Secondary (project memory / CLAUDE.md)
- MEMORY: v1.8 allocated-capital, `returns_denominator_config`, √365 broker; v1.9 composite path; `USE_COMPUTE_JOBS_QUEUE=true` prod

## Metadata
**Confidence breakdown:**
- Mark-data ingested (GO/blocked): HIGH — verified the summary channel + ingestion + tests
- pnl_basis MTM math: HIGH — implemented + covered by existing tests
- Single-key persistence gap: HIGH — traced both single-key and composite write paths
- Pre-rollout straddle limitation: HIGH (documented in code); Zavara's exposure to it: MEDIUM (A2)

**Research date:** 2026-07-12
**Valid until:** ~30 days (stable in-repo analytics core)

## RESEARCH COMPLETE

**GO (not blocked): mark data IS ingested** (Deribit `options_settlement_summary.realized_pl + unrealized_pl` channel) and the `pnl_basis=mark_to_market` options math already exists + is tested; the only gap is that the single-key derive path persists just the cash basis — MTM-01 = add an additive second `mark_to_market` pass (mirroring the composite dual-pass) + single-key honest-gate, with `cash_settlement` byte-identical by construction (SC-4). ⚠️ CONTEXT's "mark_price" is imprecise — the ingested signal is the settlement-summary session-delta, not a `mark_price` field.
