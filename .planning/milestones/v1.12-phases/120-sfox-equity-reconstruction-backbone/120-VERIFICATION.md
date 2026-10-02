---
phase: 120-sfox-equity-reconstruction-backbone
verified: 2026-07-19T02:12:09Z
status: human_needed
score: 4/4 code-complete must-haves verified (SFOX-06 live parity leg human_needed)
overrides_applied: 0
human_verification:
  - test: "SFOX-06 LIVE prod-key ground-truth parity run. After Phase 121 egress IP is verified (== the dedicated static v4, measured from the machine) OR immediately with a NON-whitelisted read-only sFOX key: `export SFOX_GROUND_TRUTH_KEY=<read-only token>` (env only, optional `export SFOX_GROUND_TRUTH_PROXY=<121 egress URL>`), then `cd analytics-service && python -m scripts.sfox_ground_truth > /tmp/sfox_parity.json; echo exit=$?` (or `python -m pytest tests/test_sfox_ground_truth_live.py -q`)."
    expected: "exit 0 → parity holds (or an A2/A3 ambiguity is flagged for founder decision). exit 1 → MATERIAL DIVERGENCE: STOP, the curve must not ship, file the divergence with the evidence JSON. exit 2 → read-only premise violated (revoke the key). exit 3 → key not exported. Then review the evidence `a2_account_balance_semantics` and `a3_inception_convention` residuals to resolve assumptions A2/A3 against real data; if they contradict the shipped `combine_sfox_balance_history` conventions, open a follow-up fix BEFORE Phase 122 badges anything."
    why_human: "Requires a real read-only sFOX credential + (for an IP-whitelisted key) the Phase-121 static egress, neither of which exists in-session. The harness deliberately never fabricates a pass (T-120-19); a skip is documented as NOT a pass. This is the founder's empirical gate — the 118-02 / 119-04 precedent."
---

# Phase 120: SFOX Equity reconstruction + backbone — Verification Report

**Phase Goal:** An ingested sFOX account becomes an `api_verified` daily-return series on the ONE unified backbone (`derive_basis_series`), validated against live account ground truth.
**Verified:** 2026-07-19T02:12:09Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + merged plan truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | sFOX balances/trades reconstruct into daily returns through the ONE unified backbone (`derive_basis_series`) — no parallel metrics path, no sFOX-special derive chain | ✓ VERIFIED | `combine_sfox_balance_history` (broker_dailies.py:230) calls `chain_linked_twr` exactly once (:307), no `derive_basis_series`/`compute_all_metrics`/`reconstruct_native` call in its body; the `elif venue == "sfox"` worker branch (job_worker.py:2626) sets `(returns, meta)` then falls through to the UNCHANGED shared derive/persist. `test_one_path_derive_basis_series_call_sites_unchanged` pins comment-stripped `derive_basis_series(` == 4 (baseline). |
| SC2 | The reconstructed sFOX strategy carries `api_verified` provenance (distinct from csv/self_reported) | ✓ VERIFIED | `trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"` (process_key.py:835) — the free non-csv stamp; `source='sfox'` → `api_verified`. Pinned by test_process_key. |
| SC3 | Degenerate input (empty/<2-day/non-finite) renders an honest empty/gated state — never invented data | ✓ VERIFIED | `combine_sfox_balance_history` returns empty Series on empty/single-point NAV; interior missing day → NaN break (no 0.0-fill); material-balance floor (>$100 & <2 usable NAV days) fails loud permanent (job_worker.py:2739). `SfoxCrawlTruncatedError`/`SfoxFlowValuationError` raise on partial reads / unvaluable flows. All pinned green in test_sfox_reconstruct.py. |
| SC4 (code-complete) | Reconstructed equity validated against an INDEPENDENT economic oracle; material divergence FAILS LOUD (raise, never display) | ✓ VERIFIED | `reconstruct_equity_from_transactions` (sfox_ground_truth.py:155) takes ONLY `transactions`, never reads `usd_value`/balance-history, never calls the module's `combine`/`chain_linked_twr`. `check_parity` raises `ParityDivergenceError` (→ exit 1) on material divergence. Tamper A (inflated usd_value) and Tamper B (hidden deposit) both PROVEN via `pytest.raises(ParityDivergenceError)`. |
| SC4 (live leg) | Validated against a LIVE sFOX account's ground truth | ? HUMAN_NEEDED | Founder-gated on a real read-only key + Phase-121 egress. `test_sfox_ground_truth_live.py` skips with a documented "a skip is NOT a pass" reason. See Human Verification Required. |
| P1-a | `get_adapter('sfox')` resolves an SfoxAdapter (cached); unknown sources still rejected | ✓ VERIFIED | `_make_sfox_adapter` + `_FACTORIES['sfox']` (ingestion/__init__.py); Source Literal + SUPPORTED_SOURCES admit sfox in lockstep. test_ingestion_sfox.py green (registration/cache/parity). |
| P1-b | SfoxAdapter.compute_metrics RAISES (BYB-02 fill-based snapshot blocked); fetch_raw RAISES | ✓ VERIFIED | `compute_metrics` raises NotImplementedError (sfox.py:125/133); `fetch_raw` raises (:108/116). Forces all sfox returns through the broker-dailies ONE-path. |
| P2 | Deposit day books ~0.495% (real PnL) not ~50% (deposit as return) — hand-derived P115 oracle | ✓ VERIFIED | Flow-in-numerator `r_t=(NAV_t−NAV_{t-1}−F_t)/NAV_{t-1}`; oracle literal `0.004950` asserted `abs=1e-12`; anti-pin vs `nav.pct_change()==0.5` asserted to differ by >0.4. |
| P3-worker | Each sfox crawl is `asyncio.wait_for`-bounded; a hang → classified RETRYABLE transient, never a wedged sequential worker (FLIPRETRY-01) | ✓ VERIFIED | Two `asyncio.wait_for(..., timeout=_SFOX_CRAWL_TIMEOUT_S)` wraps (job_worker.py:2652/2660); `asyncio.TimeoutError` → `DispatchResult(error_kind="transient")` with no terminal stamp. `test_sfox_branch_has_two_bounded_crawls` pins ≥2 bounds. |
| P3-guard | The `:2645` fix keeps deribit byte-identical AND stops sfox returns being clobbered by `combine_realized_and_funding` | ✓ VERIFIED | `_NATIVE_RETURNS_VENUES = frozenset({"deribit","sfox"})` (job_worker.py:211); guard `if venue not in _NATIVE_RETURNS_VENUES:` (:2905) excludes both. `test_sfox_native_returns_not_clobbered_by_ccxt_combine` neuters the guard and asserts the ccxt combine raises if reached. Full `test_job_worker_deribit.py` (18 tests) passes unchanged — deribit byte-identical. |
| P3-crypto | sfox is a CRYPTO venue everywhere the canonical closed set is consumed (√365 basis; blend unknown-asset_class bug cannot recur) | ✓ VERIFIED | `CRYPTO_VENUES = frozenset({"deribit","binance","okx","bybit","sfox"})` (closed_sets.py:119, MD-01 single source); excluded from `_COMPOSITE_DEGRADE_VENUES` (honest refusal, no ccxt-reconstruct crash). |
| P4-sanitize | All emitted evidence passes `assert_sanitized`; the Bearer can never reach stdout/stderr | ✓ VERIFIED | Sanitization primitives imported (single line) from `scripts.deribit_ground_truth` (:72); `test_planted_token_makes_assert_sanitized_raise` proves a planted 48-char token → `assert_sanitized` RAISES. |
| P4-A2A3 | A2 (account_balance semantics) and A3 (day-0 convention) unknowns SURFACED as reported residuals — never silently guessed | ✓ VERIFIED | `check_parity` emits `a2_account_balance_semantics` + `a3_inception_convention` residuals and a `requires_founder_decision` flag; cash-only fixture flags without raising. |

**Score:** 4/4 ROADMAP success criteria code-complete; SC4's LIVE empirical leg is the single outstanding human-verification item (founder-gated, not a gap).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/ingestion/sfox.py` | SfoxAdapter, compute_metrics/fetch_raw fail-loud | ✓ VERIFIED | Raises on compute_metrics/fetch_raw; validate via SfoxClient auth read; registered in lockstep. |
| `services/broker_dailies.py::combine_sfox_balance_history` | usd_value+flows → cashflow-neutral TWR via chain_linked_twr | ✓ VERIFIED | Single `chain_linked_twr` reuse (:307); gap-honest NaN breaks; degenerate-honest. |
| `services/sfox_read.py` | bounded crawls + typed-flow extraction | ✓ VERIFIED | `crawl_sfox_balance_history`/`crawl_sfox_transactions` (typed truncation), `sfox_flows_by_day` (fail-loud on unvaluable). |
| `services/job_worker.py` | elif venue=="sfox" branch + preflight/close/native-guard | ✓ VERIFIED | Branch at :2626, `_NATIVE_RETURNS_VENUES` at :211/:2905, wait_for-bounded crawls. |
| `services/closed_sets.py` | CRYPTO_VENUES admits sfox | ✓ VERIFIED | :119, MD-01 single source. |
| `routers/process_key.py` | H-11 onboard/resync admit sfox + api_verified | ✓ VERIFIED | trust_tier stamp :835. |
| `scripts/sfox_ground_truth.py` | P115-independent parity harness, exit 0/1/2/3 | ✓ VERIFIED | Transactions-only oracle, ParityDivergenceError, sanitize reuse. |
| `tests/test_sfox_reconstruct.py` / `test_sfox_ground_truth.py` / `test_sfox_ground_truth_live.py` | oracle/fail-loud/one-path pins + skipIf live | ✓ VERIFIED | All green; live leg skips honestly. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| job_worker sfox branch | broker_dailies | `combine_sfox_balance_history(` | ✓ WIRED | Called at :2761. |
| job_worker sfox branch | shared derive/persist | (returns, meta) fall-through, NO new derive call | ✓ WIRED | derive_basis_series( count unchanged at 4. |
| broker_dailies | nav_twr | `chain_linked_twr(` REUSE | ✓ WIRED | Single call :307, no bespoke loop. |
| exchange.aclose_exchange | SfoxClient.aclose | isinstance chokepoint | ✓ WIRED | SfoxClient routed to bounded aclose. |
| sfox_ground_truth | deribit_ground_truth | REUSED sanitize primitives | ✓ WIRED | single import line :72. |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted sfox suites | `pytest test_sfox_reconstruct test_sfox_ground_truth test_ingestion_sfox -q` | 60 passed | ✓ PASS |
| Live parity leg skips (not faked) | `pytest test_sfox_ground_truth_live.py -q -rs` | 1 skipped ("a skip is NOT a pass") | ✓ PASS |
| Deribit byte-identical regression | `pytest test_job_worker_deribit.py -q` | 18 passed | ✓ PASS |
| Full analytics-service suite | `pytest -q` | 3945 passed, 96 skipped, 0 failed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SFOX-05 | 120-01/02/03 | sFOX → daily returns on the ONE backbone, api_verified, no invented data | ✓ SATISFIED | ONE-path grep-proven, api_verified stamped, degenerate-honest gates all green. |
| SFOX-06 | 120-04 | Reconstructed equity validated vs live ground truth; material divergence fails loud | ⏳ CODE-COMPLETE / live leg NEEDS HUMAN | Independent oracle + tamper-proof fail-loud green offline; live prod-key run founder-gated on Phase 121 egress. |

### Anti-Patterns Found

None. No unreferenced TBD/FIXME/XXX debt markers in the phase's modified files. `fetch_raw`/`compute_metrics` raises are intentional fail-loud tripwires (documented), not stubs. The `asyncio.wait_for` bound lives at the worker seam by design (documented in the crawl docstrings). No hardcoded-empty data flowing to rendering.

### Disconfirmation Pass (Confirmation Bias Counter)

1. **Partial requirement:** SFOX-06's live leg is genuinely unmet — but it is explicitly founder-gated and surfaced as human_needed, not silently claimed complete. Correct classification.
2. **Misleading test check:** `test_sfox_native_returns_not_clobbered_by_ccxt_combine` is NOT a tautology — it patches `combine_realized_and_funding` to raise and asserts the sfox run still reaches DONE, so it fails RED if the `_NATIVE_RETURNS_VENUES` guard is reverted to `!= "deribit"`. Load-bearing.
3. **Error-path coverage:** the crawl-timeout → `transient` and truncation/unvaluable/material-floor → `permanent`+stamp paths are all exercised by the sfox-branch tests (full suite green).

### Human Verification Required

**1. SFOX-06 LIVE prod-key ground-truth parity run** — see frontmatter `human_verification`. Founder-gated on a real read-only sFOX key + (for an IP-whitelisted key) Phase-121 static egress. The committed harness + fixture parity + tamper-proof fail-loud carry the code-complete gate; the empirical live parity is the founder's gate and is honestly recorded human_needed (a skip is NOT a pass).

### Gaps Summary

No gaps. All four ROADMAP success criteria are code-complete and money-math invariants are proven: ONE-path (single `chain_linked_twr` reuse, `derive_basis_series` call sites unchanged at 4), the `_NATIVE_RETURNS_VENUES` clobber-guard keeps deribit byte-identical while protecting sfox's reconstructed TWR, the P115 parity oracle is transactions-only (never reads `usd_value`), tamper fixtures prove fail-loud, `api_verified` is stamped for `source='sfox'`, the worker crawls are `asyncio.wait_for`-bounded (FLIPRETRY-01), and a deposit books its real PnL not the deposit. The single outstanding item is the SFOX-06 LIVE parity run, which is founder-gated (NOT a gap) and correctly held open as human_needed.

---

_Verified: 2026-07-19T02:12:09Z_
_Verifier: Claude (gsd-verifier)_
