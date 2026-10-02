# Phase 80: Deribit Native Adapter + Production Switch (RISKY, GATING) — Research

**Researched:** 2026-07-10
**Domain:** analytics-service Deribit native-unit NAV reconstruction; production-switch wiring; live ship-gate validation
**Confidence:** HIGH (all claims verified against current `origin/main` source + local test runs)

---

## Summary

This is a **validation/refresh** research pass over an already-deeply-planned phase. The single most consequential finding overturns the framing of the existing CONTEXT and plans:

> **The entire autonomous code scope of Phase 80 (80-01, 80-02, 80-03, and SI-02/SC-6) has ALREADY LANDED on `main`** — not through the GSD Phase-80 workflow, but as part of **PR #598 (`eb8e357e`, `v0.38.2.0`, "v1.8 Deribit native-unit reconstruction + Zavara verification", merged 2026-07-09)**, which post-dates the 2026-07-08 CONTEXT by one day and rewrote all five target files.

Concretely, `txn_rows_to_native_daily`, `build_deribit_native_ledger`, `combine_native_ledger`, the `(day,ccy)`-keyed native flows, the typed-error job-path route, the App-A-#6 wedge refusal, the SI-02 `failed_final`-bounce fix (migration + regression test), and the SC-4 dual-run identity suite against the REAL adapter **all exist and are GREEN** in the current tree. I ran the SC-4 suite (23 passed) and the native-core/broker-dailies/golden-parity suites (90 passed) locally against the CI-pinned `.venv` (Python 3.12.13).

What **genuinely remains** for Phase 80 is the **80-04 LIVE, human-gated work only**: the three real Deribit keys re-derived against live DB + live Deribit crawl, inception-tolerance **calibration** (constants are still at their untuned defaults), the golden parity panel over real keys, and the founder sign-off (incl. LTP068 / ACC-02 close-out). The `native_nav` core is untouched-and-complete exactly as the CONTEXT's D1 asserted.

**Primary recommendation:** Re-plan Phase 80 around the CURRENT reality — treat 80-01/80-02/80-03/SI-02 as **LANDED (verify-not-build)**, and make the phase's real deliverable the **80-04 live gate suite** (gates i-real-key / ii / iii). Every line anchor in the CONTEXT and the 80-0x plans is stale and MUST be re-derived (table below). Do not re-implement functions that already exist — that would fork a shipped, tested invariant (violates locked decision D2 / Rule 3 surgical-changes).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim, still binding)
1. **SC-4 byte-identity is the merge gate** — a USD-native Deribit account's stored dailies MUST be bit-identical old-vs-new (`check_exact=True` series AND byte-equal meta) for the real USD-native key(s), not just synthetic fixtures.
2. **Zero core edits** — `native_nav.py` is not touched for arithmetic/logic. CARVE-OUT: 80-04 (gate ii) may edit the tolerance constants only. If a bug is found IN the core, STOP and escalate.
3. **No per-account dispatch flag** — all Deribit accounts (USD-native included) take the native path; §4 identity licenses it (route-by-data-availability).
4. **TDD discipline** — every behavioral task RED→GREEN with an explicit mutation-honesty neuter.
5. **Guards lifted VERBATIM** — the native siblings copy the type-partition and `change` guards word-for-word so the two paths cannot drift.
6. **Leak discipline** — no raw NAV/balance/flow/quantity in any log or exception; errors carry codes/counts/ratios only.
7. **Marks are NEVER forward-filled or interpolated** (§3.3); balances carry forward, marks do not.
8. **SI-02 lands BEFORE the live re-derivations** so a status bounce during re-runs cannot launder the `complete_with_warnings` gate-iii must observe.

### Ship Gates (hard; merge blocked until all three green)
- **(i) SC-4 identity** (80-03 T3) — dual-run bit-exact for the all-USD-family fixture matrix AND the real USD-native key's stored dailies.
- **(ii) §5 inception** (80-04) — all 3 real keys reconcile to pre-history ≈0 within live-tuned tolerance; loosening requires evidence.
- **(iii) Golden parity + founder** (80-04) — no UNEXPLAINED delta; no USD-native account moved; coin-account movement (incl. LTP068) founder-signed. Absorbs ACC-02 + v1.7 close-out.

### Claude's Discretion
- Inception-tolerance **values** (gate ii) — calibrated against the real keys; tightening expected, loosening requires documented evidence (the `FLOW_DOM_RATIO` precedent).

### Deferred Ideas (OUT OF SCOPE — Phase 81)
- `build_ccxt_native_ledger` (Bybit/OKX/Binance), per-venue routing, `full_history=False` retention-capped path.
- Retirement of the USD-space `reconstruct_nav_and_twr` orchestration.
- `ccxt_flows.py` stays 2-arg.
- The Deribit txn-log `balance` field as a rolled-balance cross-check (candidate hardening after 80).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Current Status (verified 2026-07-10) |
|----|-------------|--------------------------------------|
| NAT-04 (SC-1) | `build_deribit_native_ledger` from existing parts | **LANDED** in #598 — `deribit_ingest.py:1725`; siblings `txn_rows_to_native_daily` (`deribit_txn.py:1501`), 4-field `(day,ccy)` flows present |
| NAT-05 (SC-2) | Deribit job path through `combine_native_ledger`, no per-account flag, typed disposition, App-A-#6 wedge | **LANDED** in #598 — `broker_dailies.py:168`; job path wired `job_worker.py:2008-2273`; wedge refusal via core |
| SC-4 (SC-3, gate i) | Dual-run identity suite vs REAL adapter | **LANDED + GREEN** — `tests/test_native_nav_sc4_identity.py` (23 passed locally). Real-**key** stored-dailies check is the LIVE remainder |
| INCEPT-01 (SC-4, gate ii) | Inception gate green on 3 real keys; tolerances live-tuned | **PENDING (live)** — code paths present; constants still at defaults (untuned) |
| ACC-03 (SC-5, gate iii) | Golden parity + 3-key re-derivation + founder sign-off incl. LTP068 | **PENDING (live)** — parity primitives present + `test_ltp068_shape_flow_moved` green; live 3-key run + sign-off remain |
| SI-02 (SC-6) | `failed_final`-bounce launder closed with regression, BEFORE live re-runs | **LANDED** — migration `20260708120000_sync_status_failed_final_bounce.sql` + regression Part 4 in `test_sync_status_preserves_warnings.sql` |
</phase_requirements>

---

## Headline Finding — Phase-80 code scope already shipped via #598

**Evidence (git + filesystem, 2026-07-10):**

| Deliverable | Planned in | Actual location | Origin commit |
|-------------|-----------|-----------------|---------------|
| `txn_rows_to_native_daily` → `dict[str, dict[str, float]]` | 80-01 T1 | `deribit_txn.py:1501` | `eb8e357e` (#598) |
| `(day,ccy)`-keyed 4-field native flows | 80-01 T2 | `deribit_txn.py` (`deribit_dated_external_flows_usd:895`, native producer present) | `eb8e357e` |
| SI-02 launder fix + regression | 80-01 T3 | `supabase/migrations/20260708120000_*.sql` + `supabase/tests/test_sync_status_preserves_warnings.sql` (Part 4) | `eb8e357e` |
| `build_deribit_native_ledger` | 80-02 | `deribit_ingest.py:1725` | `eb8e357e` |
| native anchors / wedge / marks planner | 80-02 | `fetch_deribit_native_account_state:1346`, dense mark fill (`80-04` comments in-file) | `eb8e357e` |
| `combine_native_ledger` | 80-03 T1 | `broker_dailies.py:168` | `eb8e357e` |
| job-path route + typed disposition | 80-03 T2 | `job_worker.py:2008-2273` | `eb8e357e` |
| SC-4 dual-run vs REAL adapter | 80-03 T3 | `tests/test_native_nav_sc4_identity.py` | `eb8e357e` |

**Notably, the D9 execution-time decision was honored by #598:** `txn_rows_to_native_daily` returns `dict[str, dict[str, float]]` (uppercase-ccy → {utc_day_iso: native Σchange}), NOT `pd.Series` — the pandas-pure guard in `deribit_txn.py` is preserved, dict→Series conversion happens downstream in the adapter. The CONTEXT's D9 rationale was implemented exactly.

**Local test evidence (CI-pinned `.venv`, Python 3.12.13):**
- `tests/test_native_nav_sc4_identity.py` → **23 passed** (incl. `test_dual_run_bit_exact_real_adapter`, `test_dust_account_excluded_from_identity` [D8], `test_inverse_perp_only_ledger_byte_identical_real_adapter`).
- `tests/test_native_nav.py tests/test_broker_dailies.py tests/test_golden_parity.py` → **90 passed** (incl. `test_ltp068_shape_flow_moved`, `test_deribit_one_path_shape`).

**Implication:** the planner MUST NOT emit build tasks for these — they exist, are tested, and re-implementing forks a shipped invariant (violates D2 "zero core edits / verbatim-reuse" and Rule 3). The correct posture is **verify-not-build**.

---

## Per-SC Validation (VALID / NEEDS-UPDATE / NEW-RISK)

### SC-1 (NAT-04) — `build_deribit_native_ledger` from existing parts
**Verdict: NEEDS-UPDATE (already-landed; re-plan as verification).**
- Approach in CONTEXT is architecturally correct and was IMPLEMENTED in #598. No design change needed.
- `txn_rows_to_native_daily` (`deribit_txn.py:1501`) return type = `dict[str, dict[str, float]]` (matches D9). Guards lifted verbatim (the docstring itself asserts this, plus the `swap` HIGH-1 reclassification into `_NATIVE_CASH_BEARING_TYPES`).
- **NEW-RISK (HIGH-1 `swap` reclassification):** #598 introduced a native-only reclassification of `swap` from INFORMATIONAL → native-CASH_BEARING (`_NATIVE_CASH_BEARING_TYPES`, `deribit_txn.py:~583`). This is NOT in the original CONTEXT's "guards lifted VERBATIM" (locked decision #5) — it is a deliberate DIVERGENCE from verbatim, justified in-code ("else the per-bucket backward roll cannot close"). The planner/verifier must treat this as a sanctioned exception to D#5, and gate-i/gate-iii must confirm it does not perturb USD-native byte-identity (a `swap` inside the coalesced USD bucket must be a no-op — there is a test `test_same_family_swap_is_noop_in_coalesced_usd_bucket`, green).

### SC-2 (NAT-05) — job path through `combine_native_ledger`, no per-account flag
**Verdict: NEEDS-UPDATE (already-landed) + NEW-RISK (Zavara denominator_config coupling).**
- Production switch is WIRED: `job_worker.py:2008` `if venue == "deribit":` builds the native ledger (`build_deribit_native_ledger:2145`), calls `combine_native_ledger:2188`, dispositions `NavReconstructionError` PERMANENT (`:2273`). No per-account flag — confirms D3.
- **NEW-RISK (out-of-CONTEXT coupling):** `combine_native_ledger` gained a `denominator_config: ReturnsDenominatorConfig | None` parameter (`broker_dailies.py:171`) wiring the **Zavara v1.8 allocated-capital** path (`allocated_capital_returns_and_metrics`). When present it DELIBERATELY BYPASSES `reconstruct_native_nav_and_twr` and the §5 inception gate. The in-code "COUPLING INVARIANT (Bug B)" warns the ledger's `exclude_spot_extraction` must equal `(denominator_config is not None)` or allocated returns leak/drop spot extraction. **This means gate (ii)'s "all 3 real keys reconcile" claim does NOT apply to a Zavara-config'd account** (it bypasses inception by design). The planner must confirm which of the 3 real keys (if any) carries a `returns_denominator_config` and carve it out of the inception-gate assertion accordingly. This coupling did not exist when the CONTEXT was written.
- App-A-#6 wedge refusal: enforced by the core via `terminal_upnl_native`; adapter reads native `session_upl` through `fetch_deribit_native_account_state` (`deribit_ingest.py:1346`). VALID as designed.

### SC-3 (gate i) — SC-4 dual-run vs the REAL adapter
**Verdict: VALID as-written; synthetic-through-real-adapter tier is GREEN; real-KEY tier is the live remainder.**
- `test_native_nav_sc4_identity.py` exercises the REAL `build_deribit_native_ledger` seam with synthetic Deribit stubs (`test_dual_run_bit_exact_real_adapter`, `check_exact=True` + `check_names=False`), the D8 dust exclusion, and an anchor-composition pin (`test_anchor_composition_pin_real_adapter`). All green.
- The CONTEXT's stronger clause — "the real USD-native key's stored dailies old-vs-new byte-identical" — is a LIVE-DB assertion (80-04 T3 completeness enumeration) that has NOT been executed. This is genuine remaining work.
- **D8 remains correctly scoped:** dust-bearing "USD-native" keys are parity-panel MOVED cases, not gate-i failures; the runtime backstop is the completeness enumeration (all Deribit-venue accounts == audited set), NOT the 3-key panel or inception gate. Unchanged and still valid.

### SC-4 (gate ii) — INCEPT-01 on 3 real keys, tolerances live-tuned
**Verdict: VALID approach; genuinely PENDING (live) + NEW-RISK (tolerance surface expanded).**
- Constants unchanged from defaults: `INCEPTION_ABS_TOL_USD = 1.00`, `INCEPTION_REL_TOL = 1e-4` (`native_nav.py:178/180`) — NOT yet calibrated against real keys. The tuning is the sanctioned INCEPT-01 job (D2 carve-out).
- **NEW-RISK / NEEDS-UPDATE (third tolerance knob):** #598 added a **per-currency NATIVE dust floor** constant (`native_nav.py:184+`, "80-04 INCEPT-01, calibrated against the real Deribit production key") beyond the two constants the CONTEXT D2 carve-out sanctioned editing. The carve-out text names only `INCEPTION_ABS_TOL_USD` / `INCEPTION_REL_TOL` at `:178-180`; the calibration surface is now THREE knobs. The planner must widen D2's carve-out to include this per-currency native dust floor, and gate-ii evidence must justify ITS value too (in-code comment says its green "is NOT claimed here" — i.e., still pending live calibration).
- `mig-038` "any `failed_final` → failed" retry-poison (D7 defect (1)) remains a WATCH item during 80-04 live re-runs — unchanged.

### SC-5 (gate iii) — golden parity + founder sign-off incl. LTP068
**Verdict: VALID; primitives GREEN; live 3-key run + sign-off PENDING.**
- Parity primitives all present and green: `parity_diff.classify_delta` (`services/parity_diff.py:158`), `golden_parity.gate_account` (`scripts/golden_parity.py:141`), oracle fixtures (`tests/fixtures/golden_parity/oracle_input.json` + `oracle_pre73_expected.json`), `scripts/deribit_acceptance.py`. Note the fixture names are `oracle_input.json` / `oracle_pre73_expected.json` — the CONTEXT's generic `oracle_*.json` citation resolves to these.
- `test_ltp068_shape_flow_moved` is green — the LTP068 "flow moved" shape is already asserted in the golden-parity suite.
- **Reassuring NEW finding (annualization is BELOW the parity layer):** the golden parity compares **daily-returns Series** (`old_anchor_to_today_returns` → returns; `classify_delta` on returns), NOT annualized headline metrics. #597's crypto-√365 annualization is applied downstream inside `compute_all_metrics(..., periods_per_year=...)` and is therefore ORTHOGONAL to the parity gate — the frozen pre-73 oracle does not need re-baking for #597. See NEW-RISK block below for the one caveat.
- Remaining: the LIVE 3-key re-derivation + founder sign-off (human, `autonomous:false`). Genuine work.

### SC-6 (SI-02) — `failed_final`-bounce launder closed BEFORE live re-runs
**Verdict: VALID; LANDED.**
- Fix is RUNNER-OWNED and single-source as D7 required: the analytics runner re-asserts the warned marker idempotently (`computation_warned` sticky column; job_worker clears it on terminal failure at `job_worker.py:~2054`).
- NEW migration `supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql` exists; the regression is `supabase/tests/test_sync_status_preserves_warnings.sql` **Part 4** (lines 205-278), which asserts branch (b) writes `failed`, does NOT destroy the runner-owned `computation_warned` marker, and that a sibling `failed_final→done` recovery WITHOUT an analytics re-run does not launder `complete_with_warnings` (defect (2) stays closed).
- **NEEDS-UPDATE (anchor):** the CONTEXT cites only the pre-existing migration `20260707120000`; the actual bounce fix landed in a NEW migration `20260708120000`. The planner should reference both, and confirm the CI SQL-test gate runs `test_sync_status_preserves_warnings.sql` Part 4.
- **NEW-RISK (#597/Phase-84 status-promotion collision — checked, NONE found):** #597 and Phase-84 threaded `asset_class` through the analytics path, NOT the runner's flag→status promotion policy. The SI-02 fix is runner-owned in `job_worker.py`/`analytics_runner.py`; asset_class lives in `metrics.py`/`compute_all_metrics`. No collision with the runner-owned `computation_warned` sticky column. VALID.

---

## Anchor Drift Table (CONTEXT / plan HINTS → CURRENT `main`)

> #598 inserted the entire native-adapter body, shifting every downstream anchor down. **Every line number in the CONTEXT and the 80-0x plans is stale.** Re-derive at execution via `grep -n` (the CONTEXT already flags anchors as HINTS — this table is the corrected map).

| Symbol | CONTEXT hint | CURRENT (verified 2026-07-10) | File |
|--------|-------------|-------------------------------|------|
| `reconstruct_native_nav_and_twr(ledger, *, indexable_currencies, venue="")` | (signature) | **:579** — signature EXACT, no drift | `services/native_nav.py` |
| `NativeLedger` | :n/a | **:207** | `services/native_nav.py` |
| `classify_currency` | :n/a | **:55** | `services/native_nav.py` |
| `UnmarkableCurrencyError` / `InceptionReconciliationError` | :n/a | **:105 / :137** | `services/native_nav.py` |
| `NavReconstructionError` (parent) | (implied native_nav) | **`nav_twr.py:178`** (NOT in native_nav) | `services/nav_twr.py` |
| `INCEPTION_ABS_TOL_USD` / `INCEPTION_REL_TOL` | :178-180 | **:178 / :180** — no drift; still defaults | `services/native_nav.py` |
| per-currency native dust floor (NEW) | (absent) | **:184+** — NEW third tolerance knob | `services/native_nav.py` |
| `_code_carries_value` (`usd_signed` gate) | :263-268 | **:268** (usd_signed test :283) | `services/native_nav.py` |
| `_bucket_flow_qty` (`flow_quantity_missing`) | :323-327 | **:323** (refusal :344) | `services/native_nav.py` |
| `txn_rows_to_native_daily` (NEW deliverable) | (to build, 80-01) | **:1501** — ALREADY EXISTS | `services/deribit_txn.py` |
| `txn_rows_to_daily_records` | :698 | **:1014** | `services/deribit_txn.py` |
| `deribit_dated_external_flows_usd` | :601 | **:895** | `services/deribit_txn.py` |
| `inverse_days_needing_index` | :n/a | **:828** | `services/deribit_txn.py` |
| `txn_change_to_usd` | :n/a | **:391** | `services/deribit_txn.py` |
| `deribit_equity_to_usd` | (deribit_txn:261) | **:455** | `services/deribit_txn.py` |
| `_row_utc_day` | :n/a | **:698** | `services/deribit_txn.py` |
| `LedgerValuationError` | :58-61 | **:80** | `services/deribit_txn.py` |
| `_INVERSE_CURRENCIES` / `_LINEAR_CURRENCIES` | :111 / :99 | **:133 / :121** | `services/deribit_txn.py` |
| `CASH_BEARING_TYPES` / `INFORMATIONAL_TYPES` | :333/:341/:361 | **:527 / :535** (+ `_NATIVE_CASH_BEARING_TYPES` / `_NATIVE_INFORMATIONAL_TYPES` :583 NEW) | `services/deribit_txn.py` |
| `build_deribit_native_ledger` (NEW deliverable) | (to build, 80-02) | **:1725** — ALREADY EXISTS | `services/deribit_ingest.py` |
| `fetch_deribit_native_account_state` (NEW, D5 one-read) | (anticipated) | **:1346** — ALREADY EXISTS | `services/deribit_ingest.py` |
| `fetch_deribit_account_equity_and_upnl_usd` | :853 (per-summary :888-919) | **:1485** | `services/deribit_ingest.py` |
| `fetch_deribit_settlement_index` | :433 | **:482** | `services/deribit_ingest.py` |
| `assert_ledger_complete` | :943 | **:1903** | `services/deribit_ingest.py` |
| `CompletenessReport` | :512 | **:721** | `services/deribit_ingest.py` |
| `build_deribit_indexable_currencies` | :546 | **:779** | `services/deribit_ingest.py` |
| `fetch_deribit_ledger_daily_records` | :606 | **:1101** | `services/deribit_ingest.py` |
| `enumerate_currencies` | :270 | **:319** | `services/deribit_ingest.py` |
| `_deribit_session_upl_to_usd` (wedge silent-zero) | :844-846 (or :764-766) | **:1233** | `services/deribit_ingest.py` |
| `combine_native_ledger` (NEW deliverable) | (to build, 80-03) | **:168** (`denominator_config` param NEW) | `services/broker_dailies.py` |
| `gap_fill_daily_returns` | :118 | **:123** | `services/broker_dailies.py` |
| `combine_realized_and_funding` | :130 / :135 | **:135** | `services/broker_dailies.py` |
| Deribit job branch | :2001-2284 | **:2008** (`if venue == "deribit":`) → native build :2145, combine :2188, disposition :2273 | `services/job_worker.py` |
| SI-02 warned-marker clear | (bridge) | **`job_worker.py:~2054`** `computation_warned=False` on terminal fail | `services/job_worker.py` |
| `parity_diff.classify_delta` | :158 | **:158** — no drift | `services/parity_diff.py` |
| `golden_parity.gate_account` | :141 | **:141** — no drift | `scripts/golden_parity.py` |
| oracle fixtures | `oracle_*.json` | **`oracle_input.json` + `oracle_pre73_expected.json`** | `tests/fixtures/golden_parity/` |
| SI-02 migration | `20260707120000` | + NEW **`20260708120000_sync_status_failed_final_bounce.sql`** | `supabase/migrations/` |

---

## Runtime State Inventory (this is a production-switch phase — live state matters)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | Existing `strategy_analytics` / stored dailies for ALL Deribit-venue accounts (the 3 real keys + any coin-margined). The production switch re-derives these on next run. Old-vs-new byte-identity asserted only for genuinely all-USD-family accounts (D8). | 80-04 T3 live re-derivation + completeness enumeration (all Deribit accounts audited, zero un-audited); real-key SC-4 shadow for USD-family keys. **Data migration = re-compute, not schema.** |
| **Live service config** | `strategies.returns_denominator_config` jsonb (Zavara allocated-capital, mig `20260709120000` from v1.8). A key carrying this BYPASSES the inception gate by design (NEW-RISK above). | Enumerate which real key(s) carry it; carve out of gate-ii assertion. |
| **OS-registered state** | None — analytics runs on Railway worker, no OS-registered Deribit state. | None. |
| **Secrets/env vars** | Deribit API keys + `SUPABASE_SERVICE_KEY` (Railway analytics worker env). Native switch does NOT change key names/scopes. NEVER print. | None (code path unchanged). |
| **Build artifacts** | None — pure `.py` + SQL migration; no compiled/egg artifacts introduced. | None. |
| **Runner status state** | `strategy_analytics.computation_warned` sticky column (SI-02) + migrations `20260707120000` / `20260708120000`. mig-038 "any `failed_final`→failed" poison is a live WATCH during 80-04 re-runs (D7 defect (1)). | Confirm SI-02 landed BEFORE any live re-run (it has); WATCH mig-038 during re-runs. |

---

## New Risks Introduced by Intervening Ships (Jul 8 → Jul 10)

1. **#598 landed the autonomous scope out-of-band (HIGH impact on plan validity).** 80-01/02/03 + SI-02 are DONE. Re-planning them as build-tasks would re-implement shipped, tested code — forbidden by D2 and Rule 3. Re-plan as verify-not-build.
2. **`swap` reclassification breaks strict "verbatim guards" (D#5).** #598 reclassified `swap` INFORMATIONAL→native-CASH_BEARING (`_NATIVE_CASH_BEARING_TYPES`). Sanctioned in-code but a documented divergence from the locked "verbatim" decision. Gate must confirm USD-bucket no-op (test green).
3. **Zavara `denominator_config` coupling in `combine_native_ledger` (gate-ii scope).** A `returns_denominator_config`-carrying key bypasses `reconstruct_native_nav_and_twr` + the §5 inception gate. Gate-ii "all 3 real keys reconcile" must exclude any such key. Coupling-invariant (Bug B) requires `exclude_spot_extraction == (denominator_config is not None)`.
4. **Third tolerance knob (per-currency native dust floor, `native_nav.py:184+`).** D2's carve-out names only two constants; calibration surface is now three. Widen the carve-out; gate-ii evidence must justify all three.
5. **#597 crypto-√365 annualization — checked, ORTHOGONAL (LOW/no risk).** Applied downstream in `compute_all_metrics(..., periods_per_year=...)` via `periods_per_year_for_asset_class` (`metrics.py:43`); the native path only changes the returns SOURCE, and golden parity compares daily-returns (below annualization). No oracle re-bake needed. **Caveat to verify at gate iii:** confirm the Deribit strategies' `asset_class` is set to `'crypto'` so the LIVE headline Sharpe/vol annualize on √365 — a MISSING/`'traditional'` asset_class would silently annualize Deribit on √252 (a real metric bug, but NOT a parity-gate bug; check it explicitly during the live founder review).
6. **Node 20→22 — irrelevant to this phase.** Frontend-only toolchain bump; the analytics-service is Python 3.12 (CI-pinned). No interaction.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Python 3.12 venv (`analytics-service/.venv`) | all `<verify>` | ✓ | 3.12.13 | CI-pinned uv venv (do NOT use for mypy — B-mypy drift class) |
| pytest | test suites | ✓ | (in `.venv`; note: no `--no-file-parallelism` flag — use `-p no:cacheprovider`; `pytest.ini` present) | — |
| Live Supabase (prod) | 80-04 T3 completeness enumeration + real-key SC-4 | ✗ (human-run) | — | none — `autonomous:false` human gate |
| Live Deribit API (3 real keys) | 80-04 gate ii/iii re-crawl (`scripts/deribit_acceptance.py`) | ✗ (human-run, secrets) | — | none — human gate |
| slopcheck / new packages | — | n/a | — | **No new packages this phase** — pure edits to existing modules |

**Note:** `python3.12` is not on PATH; the interpreter is `analytics-service/.venv/bin/python` (Python 3.12.13). System default `python3` is 3.14.3 — do NOT use it. The `$PY312` convention in CONTEXT resolves to the `.venv`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`analytics-service/pytest.ini`) + SQL tests (`supabase/tests/*.sql`, pgTAP-style RAISE EXCEPTION) |
| Quick run command | `.venv/bin/python -m pytest tests/test_native_nav_sc4_identity.py -q -p no:cacheprovider` |
| Full native suite | `.venv/bin/python -m pytest tests/test_native_nav.py tests/test_broker_dailies.py tests/test_golden_parity.py tests/test_deribit_acceptance.py -q -p no:cacheprovider` |

### Phase Requirements → Test Map
| Req | Behavior | Automated Command | Exists? |
|-----|----------|-------------------|---------|
| SC-3 gate i | dual-run bit-exact vs real adapter | `pytest tests/test_native_nav_sc4_identity.py::test_dual_run_bit_exact_real_adapter` | ✅ green |
| D8 | dust account excluded from identity | `pytest tests/test_native_nav_sc4_identity.py::test_dust_account_excluded_from_identity` | ✅ green |
| SC-5 gate iii | LTP068 flow moved | `pytest tests/test_golden_parity.py::test_ltp068_shape_flow_moved` | ✅ green |
| SC-6 SI-02 | failed_final-bounce launder closed | `supabase/tests/test_sync_status_preserves_warnings.sql` Part 4 (SQL CI gate) | ✅ present |
| SC-4 gate ii | inception on 3 real keys | `scripts/deribit_acceptance.py` (LIVE, human-run) | ⚠️ harness present; live run PENDING |
| SC-2 | job one-path shape | `pytest tests/test_broker_dailies.py::test_deribit_one_path_shape` | ✅ green |

### Wave 0 Gaps
- None for the AUTONOMOUS tier — the SC-4/native/parity suites exist and pass (23 + 90 local).
- The LIVE tier (gate ii/iii real-key re-derivation, tolerance calibration, founder sign-off) is inherently human-gated (`autonomous:false`) — not an automatable Wave-0 gap, but the phase's actual remaining deliverable.

---

## Security Domain

| ASVS Category | Applies | Standard Control (current codebase) |
|---------------|---------|-------------------------------------|
| V5 Input Validation | yes | Deribit txn-log `change` absent/null/blank → `LedgerValuationError` fail-loud (lifted verbatim into native sibling) |
| V6 Cryptography | no | No crypto changes; Deribit key handling unchanged |
| V7 Error Handling / Logging | yes | **Leak discipline (D6):** no raw NAV/balance/flow/quantity in logs or exceptions — errors carry codes/counts/ratios only. `scrub_freeform_string` on the analytics-failed stamp (`job_worker.py`). `parity_diff` returns Series/booleans only, never serialized dollar figures (T-78-01). |

| Threat Pattern | STRIDE | Mitigation (present) |
|----------------|--------|---------------------|
| Sensitive financial value leak via exception/log | Information Disclosure | code-only errors; `scrub_freeform_string`; leak grep-guards (SI-01 precedent) |
| Silent status launder hiding data-quality warning | Repudiation/Tampering | SI-02 runner-owned sticky `computation_warned` + regression Part 4 |
| Secret exposure (Deribit keys / SERVICE_KEY) | Information Disclosure | keys in Railway env only; never in code/logs — do NOT print during 80-04 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 3 real Deribit keys' `asset_class` is set to `'crypto'` (so √365 annualization applies live) | New Risk #5 | Live headline Sharpe/vol annualize on √252 — a metric bug surfacing only at the live founder review; verify at gate iii |
| A2 | At most one of the 3 real keys carries `returns_denominator_config` (Zavara) | SC-2 NEW-RISK, gate ii | If more carry it, more keys are inception-gate-exempt than the planner expects; enumerate live before asserting gate ii |
| A3 | #598's landed native code is what CI runs on `main` (local `.venv` == CI-pinned) | Headline finding | Local greens (23+90) may diverge from CI if `.venv` drifted; confirm via CI check-run on the phase branch (gh api check-runs, not /status) |
| A4 | mig-038 "any failed_final→failed" poison is still un-fixed (WATCH-only) | Runtime State | If it fires during a live re-run it could permanently fail an otherwise-recoverable key; watch `railway` logs during 80-04 |

**All other claims in this document are VERIFIED against current source (grep -n) or CITED to a local test run.**

---

## Open Questions

1. **Should Phase 80 be re-scoped to 80-04-only, or formally closed with a thin verification wave?**
   - Known: 80-01/02/03/SI-02 landed + green in #598; only the live gates remain.
   - Unclear: whether the GSD ledger expects a code-delta per wave (there is none for 80-01/02/03).
   - Recommendation: re-plan as (a) a thin "verify-landed" wave that asserts the anchors + runs the existing suites as the merge evidence for gates i(synthetic)/SC-6, then (b) the human-gated 80-04 live wave (gates i-real-key / ii / iii). Do NOT re-emit build tasks.

2. **Does the per-currency native dust floor need its own documented calibration evidence at gate ii?**
   - Known: it exists (`native_nav.py:184+`) and is uncalibrated ("green NOT claimed here").
   - Recommendation: extend D2's carve-out to 3 constants; require gate-ii evidence for the dust floor too.

3. **Which real key(s) are Zavara-`denominator_config` and thus inception-exempt?**
   - Resolve live during 80-04 T-setup before asserting "all 3 keys reconcile."

---

## Sources

### Primary (HIGH confidence — current source, this session)
- `services/native_nav.py`, `services/deribit_txn.py`, `services/deribit_ingest.py`, `services/broker_dailies.py`, `services/job_worker.py`, `services/metrics.py`, `services/parity_diff.py`, `scripts/golden_parity.py` — read + `grep -n` at 2026-07-10.
- `git log -S` provenance: all Phase-80 deliverables trace to `eb8e357e` (PR #598, `v0.38.2.0`, 2026-07-09).
- Local test runs (CI-pinned `.venv`, Python 3.12.13): `test_native_nav_sc4_identity.py` 23 passed; `test_native_nav.py`+`test_broker_dailies.py`+`test_golden_parity.py` 90 passed.
- `supabase/migrations/20260707120000_*.sql`, `20260708120000_sync_status_failed_final_bounce.sql`, `supabase/tests/test_sync_status_preserves_warnings.sql` (Part 4).

### Context (planning inputs)
- `.planning/phases/80-.../80-CONTEXT.md` (2026-07-08), `80-01..80-04-PLAN.md`, `.planning/v1.9-ROADMAP.md` §Phase 80.

---

## Metadata

**Confidence breakdown:**
- Landed-scope finding (#598): HIGH — git provenance + running tests.
- Anchor drift table: HIGH — every line re-derived via `grep -n` this session.
- New risks (swap reclass / denominator_config / dust floor / #597 orthogonality): HIGH — read directly in source + docstrings.
- Live-gate status (ii/iii pending): HIGH — constants still at defaults; in-code comments explicitly disclaim "green NOT claimed here."

**Research date:** 2026-07-10
**Valid until:** 2026-07-17 (fast-moving — the codebase shipped 3 feature PRs in the 2 days before this pass; re-verify anchors if any commit touches the five target files before planning).
