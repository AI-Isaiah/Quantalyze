---
phase: 128-deribitfix-deribit-correction-classification-evidence-based
reviewed: 2026-07-19T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/deribit_txn.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/tests/test_deribit_txn.py
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 128: Code Review Report

**Reviewed:** 2026-07-19
**Depth:** deep (cross-file money-path trace)
**Files Reviewed:** 3
**Status:** issues_found (0 blocker / 1 warning / 1 info)

## Summary

Reviewed the `correction` per-row classification change on the deribit money path.
The core mechanism is sound and, on the checked axes, correct:

- **Consistency USD vs native — VERIFIED.** The single gate `correction_is_trading`
  is applied at every site that sums or plans realized cash, and the two paths
  agree on which corrections count:
  - USD aggregator `txn_rows_to_daily_records` (`deribit_txn.py:1207-1214`) via `_row_is_cash_bearing`
  - Native aggregator `txn_rows_to_native_daily` (`deribit_txn.py:1787-1794`) via `_row_is_native_cash_bearing`
  - Index planner `inverse_days_needing_index` (`deribit_txn.py:989`) via `_row_is_cash_bearing`
  - Reconcile reference `assert_balance_identity` (`deribit_txn.py:1512`) via `_row_is_native_cash_bearing`
  - Ingest C2 floor `total_return_rows` (`deribit_ingest.py:1112-1125`) via `correction_is_trading`
  I grepped the whole `services/` tree for other `type`-based realized-cash
  dispatch; the only additional type filters (`deribit_txn.py:1317/1356/1398`) are
  options-summary/`trade`/`delivery` scoped and correctly do not touch `correction`.
  Downstream consumers (`allocated_capital.py`, `broker_dailies.py`, `job_worker.py`)
  consume the aggregator OUTPUT and inherit the gate — no independent reclassification.
- **Fail-loud placement — VERIFIED.** In both aggregators the
  `correction and not correction_is_trading` branch runs BEFORE the
  `_row_is_*_cash_bearing` sum branch. A non-trading correction with nonzero
  `change` hits `assert_correction_classifiable` (raises); zero-change is
  `continue`d (never summed). Never falls through to a silent sum or silent skip.
- **Call order safety — VERIFIED.** `txn_rows_to_native_daily` (`deribit_ingest.py:1815`)
  runs before `assert_balance_identity` (`deribit_ingest.py:1889`), so a non-trading
  nonzero correction fails at the aggregator before reaching the guard's silent
  `continue` at `deribit_txn.py:1512`.
- **Double-count — VERIFIED.** `correction` is absent from `_EXTERNAL_FLOW_TYPES`,
  so `deribit_dated_external_flows_usd` never picks it up (not in F_t) and the
  anchor `initial = equity_today − Σrealized` does not subtract it. It enters
  Σrealized exactly once. No path counts it twice.
- **Reason match is None-safe/lowered — VERIFIED.** `_correction_reason_raw`
  (`deribit_txn.py:652-658`) defends against missing/None/non-Mapping `info`, and
  the match is on `.lower()`.
- **Zero-change corrections — VERIFIED harmlessly ignored** on both paths.
- **Test oracle — VERIFIED hand-derived + RED-proof both directions.** USD
  `483.7655` and native `0.00967531 BTC` are hand-summed ledger economics, not
  `txn_change_to_usd` asserted back (P115-compliant). Neuter→False reddens the
  cash-bearing tests; neuter→True (blanket) reddens the capital/unrecognized
  fail-loud tests.
- **Disjointness asserts — VERIFIED still valid** (`correction` is in no static set).

One money-safety robustness gap remains in the reason matcher (WR-01) with a
directly-related test blind spot (IN-01).

## Warnings

### WR-01: Substring allow-list has no capital-reason denylist — a capital correction whose reason contains a trading substring is silently summed into realized PnL

**File:** `analytics-service/services/deribit_txn.py:635-668`

**Issue:** `correction_is_trading` returns True if ANY trading keyword appears as a
substring ANYWHERE in the lowered reason, with no capital-keyword check taking
precedence. This is the exact failure the phase is designed to prevent — a
capital-flavored correction miscounted as trading performance — reachable when a
capital reason merely *contains* a trading token:

- `"transfer to funding account correction"` contains `"funding"` → classified
  trading → the `change` is **silently summed into realized PnL** (no fail-loud),
  even though `"transfer"` signals a capital movement. This is the precise
  collision called out in the review focus.
- `"withdrawal fee correction"` contains `"fee"`; `"deposit interest correction"`
  contains `"interest"` → both classified trading despite capital-flavored reasons.
- `"mark"` (`:647`) is the loosest token: it substring-matches `market`,
  `benchmark`, `earmarked`, `watermark`, `remark`. `"earmarked withdrawal
  correction"` → matches `mark` → trading.

Because the fail-loud (`assert_correction_classifiable`) is defined purely as the
negation of `correction_is_trading`, any false-positive here doesn't just
misroute — it **disables the money guard for that row** and books capital as
performance, corrupting the daily curve and the performance-vs-capital split.

The trigger is speculative (the only observed correction reason is the funding
one, correctly classified; and Deribit's known capital ops — deposit/withdrawal/
transfer — carry their own dedicated `type`s, not `correction`), and the founder
explicitly accepted broad substring matching for wording robustness. Hence WARNING,
not BLOCKER. But this is a money path and the corruption is silent, so
defense-in-depth is warranted: the guard's whole premise is "never silently count
a capital adjustment as trading performance," and a capital word in the reason is
the strongest available capital signal — it should dominate, not be overridden by a
co-occurring trading substring.

**Fix:** Check a capital denylist FIRST and fail loud regardless of any trading
substring, and tighten the loosest token to a word boundary:

```python
_CORRECTION_CAPITAL_REASON_KEYWORDS: tuple[str, ...] = (
    "deposit", "withdraw", "transfer", "wallet",
)

def correction_is_trading(row: Mapping[str, Any]) -> bool:
    reason = _correction_reason_raw(row).lower()
    # Capital signal DOMINATES: a deposit/withdrawal/transfer/wallet reason is
    # never trading, even if it also contains a trading token (e.g. "transfer to
    # funding account"). Falls through to fail-loud.
    if any(kw in reason for kw in _CORRECTION_CAPITAL_REASON_KEYWORDS):
        return False
    return any(kw in reason for kw in _CORRECTION_TRADING_REASON_KEYWORDS)
```

Optionally drop or word-boundary-anchor `"mark"` (e.g. match `" mark "` / `"mark-"`
or use `"marking"`) since it is the highest false-positive-rate token.

## Info

### IN-01: Capital-reason regression test only covers reasons with NO trading-substring collision — gives false confidence that all capital reasons fail loud

**File:** `analytics-service/tests/test_deribit_txn.py:568-587`

**Issue:** `test_correction_capital_reason_fails_loud` parametrizes over
`"transfer correction"`, `"deposit adjustment"`, `"withdrawal reversal"`,
`"wallet balance correction"` — all of which lack any trading substring, so they
pass trivially under the current matcher. The suite therefore asserts "capital
corrections fail loud" while never exercising the one capital shape that does NOT
fail loud (WR-01): a capital reason that also contains a trading token. This is the
same test-blindness pattern flagged in the P115 money-oracle lesson — the guard
looks fully covered but the dangerous case is untested.

**Fix:** Add a case that would currently (incorrectly) pass classification, so it
reddens until WR-01 is fixed and then pins the fix:

```python
@pytest.mark.parametrize("capital_reason", [
    "transfer correction", "deposit adjustment", "withdrawal reversal",
    "wallet balance correction",
    "transfer to funding account correction",  # capital reason w/ trading token
    "withdrawal fee correction",                # ditto ("fee")
])
def test_correction_capital_reason_fails_loud(capital_reason: str) -> None:
    ...
```

---

_Reviewed: 2026-07-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
