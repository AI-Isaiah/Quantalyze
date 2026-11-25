---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 06
subsystem: analytics-service Bybit derive anchor (VREAD-01)
tags: [bybit, anchor, vread-01, proof-01, stable-coins]

requires:
  - phase: 231
    provides: 231-CENSUS.md rows C01..C05, plans 01 to 05
  - phase: 229
    provides: the key_inputs.anchor_usd reader contract (merged to origin/main, see Task 1 gate)
provides:
  - "services/exchange.py::fetch_bybit_stable_wallet_with_status, routed from fetch_account_equity_usd and fetch_account_equity_and_upnl_usd for venue bybit"
  - "the flipped pin test_coin_coverage_bybit_derive_and_reconstruct_sum_the_same_stable_coins and the shared-constant proof"
affects: [ship PR for phase 231]

actuals:
  tokens: 21000
  tasks: 2
  commits: 3
plan_head_before: 340dcf45adcb83e16ce80542595fe6d9b021aad2
plan_head_after: 0fc482b3f797884488ba4371782aea67e2887324

key-files:
  created: []
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_upnl_venues.py
    - analytics-service/tests/test_exchange.py
    - analytics-service/tests/test_nav_marks_l4_read.py

key-decisions:
  - "Ruling OQ1 Option A: a new Bybit helper; fetch_usdt_balance_with_status and fetch_usdt_balance stay byte-identical"
  - "Stable membership only through price_rule.is_stable_value, called per coin at call time"
  - "Non-stable collateral stays out of the anchor and is never parsed"

requirements-completed: [VREAD-01, PROOF-01]

status: complete
completed: 2026-11-24
---

# Phase 231 Plan 06: VREAD-01 Bybit derive anchor sums every stable coin

closes-todos: 167.2.1.1-DERIVE-USDT-ONLY-ANCHOR (VREAD-01)

BASE: 340dcf45adcb83e16ce80542595fe6d9b021aad2 (merge of origin/main at 2761b04be into the phase branch; tree byte-identical to origin/main).

One-liner: the Bybit derive anchor now sums the wallet balance of every stable coin through the one shared rule `services.price_rule.is_stable_value`, the rule the mark already applies, so a USDT plus USDC account has anchor 1200.0 instead of 1000.0 and becomes markable.

## Task 1 gate

Task 1 (checkpoint:human-action, the Phase 229 gate) belonged to the orchestrator and was resolved by it. Evidence, verbatim from the dispatch:

- The plan's automated verify regex `^chore\(release\): v[0-9.]+ — Phase 229 ` found NO commit (SHA empty), so the literal command did NOT print `GATE_229_OK`. Cause: Phase 229 landed with the subject `v0.133.69.0 — Phase 229 MT5DERIVE2: an MT5 key's return chain keeps every day it should (#1328)`, which has no `chore(release):` prefix.
- Substance check run instead: `git merge-base --is-ancestor 2761b04be94904d07f56e560515dfcc9dbf4c25a HEAD` succeeded on the phase branch. The phase branch was merged with origin/main at 2761b04be as merge commit 340dcf45a, whose tree is byte-identical to origin/main.
- Re-base symbol re-check at 340dcf45a (orchestrator): `fetch_usdt_balance_with_status`, `fetch_account_equity_usd`, `fetch_account_equity_and_upnl_usd` (Bybit tail still `fetch_usdt_balance_with_status` + `0.0, False`), `price_rule._STABLE_VALUE` / `is_stable_value`, and the pin's fixture (USDT 1000 / uPnL 250.5, USDC 200, asserts derive == 1000.0) all match the plan. The callers of the two anchor functions are unchanged from census C01..C04 (derive, composite, derivegaps probe, bybit_reconcile script). No new Bybit caller writes account_balance_usdt.

I re-read the same symbols at the base before editing and found no mismatch.

## What changed

- `services/exchange.py`: `fetch_bybit_stable_wallet_with_status(exchange) -> tuple[float | None, bool]`, the exact three-state contract of `fetch_usdt_balance_with_status`. Per coin it calls `is_stable_value(str(coin))` at call time (no coin literal, no frozenset bound at import). A `venue == "bybit"` arm in `fetch_account_equity_usd` and in `fetch_account_equity_and_upnl_usd` (wedge hard-coded 0.0, `upnl_unreadable` False). Docstrings updated.
- Tests: the pin flipped and renamed (never deleted), `test_shared_stable_set_drives_the_anchor_and_the_mark`, `test_bybit_stable_wallet_arms` (12 parametrized arms), `test_bybit_two_tuple_and_four_tuple_anchor_agree`, `test_fetch_usdt_balance_stays_usdt_on_a_mixed_stable_bybit_balance`, `test_bybit_anchor_is_independent_of_coin_order`, `test_non_stable_collateral_stays_out_of_the_bybit_anchor`, `test_a_stable_mixed_bybit_account_is_markable_while_binance_keeps_the_usdt_basis`, and `test_bybit_binance_wedge_zero` (name kept) patching the right helper per venue.
- The renamed pin's docstring names the old test and cites `VREAD-01` and "closed by Phase 231"; neither it nor the section comment cites the TODOS id (`grep -acF` of the id in `tests/test_upnl_venues.py` = 0). TODOS.md and CHANGELOG.md untouched; the ship PR owns them.

## User-visible change

A Bybit key holding USDC (or another stable coin) beside USDT now stores a larger `key_inputs.anchor_usd` (the sum of every stable coin's wallet balance) and starts receiving daily marks. Before, such an account's all-asset mark wallet differed from the USDT-only anchor by more than the tolerance and was refused every day as `wallet_basis_mismatch` (RESEARCH F5). No figure's annualization is touched.

## OQ1 narrowness (ruling Option A, census C05)

`fetch_usdt_balance` (strategy sync, cron, exchange and portfolio routers) is unchanged and still returns the USDT figure on a mixed USDT plus USDC Bybit balance, pinned by `test_fetch_usdt_balance_stays_usdt_on_a_mixed_stable_bybit_balance`. So `api_keys.account_balance_usdt` and strategy initial capital do NOT move; only the derive anchor widened. A Bybit account holding USDC collateral still has its strategy-capital input understated; this is reported, not widened.

## Deferred item, flag to the founder

Non-stable collateral (for example BTC held in the Unified account) is NOT in the anchor (CONTEXT Deferred Ideas). The mark still refuses a BTC-collateral account as `wallet_basis_mismatch`, pinned by the existing `mixed-basis` case (both venues) and by `test_non_stable_collateral_stays_out_of_the_bybit_anchor`. Pricing non-stable coins into the anchor needs a ticker read and a decision on the realized basis; it is not done here.

## PROOF-01

`$PY` is the CI-pinned interpreter of the phase worktree's `analytics-service/.venv` (ccxt 4.5.89, mypy 2.4.0), `$SCRATCH` is the scratch directory `.../scratchpad/p231-06`, outside the repo. All commands run from the worktree's `analytics-service/`.

### Flipped pin RED on pre-fix code (before implementing)

```
$PY -m pytest "tests/test_upnl_venues.py::test_coin_coverage_bybit_derive_and_reconstruct_sum_the_same_stable_coins" "tests/test_upnl_venues.py::test_shared_stable_set_drives_the_anchor_and_the_mark" -q -p no:cacheprovider
E       AssertionError: derive must sum every stable coin (1000 + 200), got 1000.0; ccxt 4.5.89: VREAD-01, closed by Phase 231; the derive anchor and the current-equity read sum the same stable coins through price_rule.is_stable_value
E       assert 1000.0 == 1200.0
E       AssertionError: the anchor must include the coin the shared set adds, got 1000.0
E       assert 1000.0 == 1050.0
FAILED tests/test_upnl_venues.py::test_coin_coverage_bybit_derive_and_reconstruct_sum_the_same_stable_coins
FAILED tests/test_upnl_venues.py::test_shared_stable_set_drives_the_anchor_and_the_mark
2 failed in 52.09s
```

After the implementation (commit 34c1b4756) both passed: `2 passed in 32.49s`.

### Block 1: helper sums only the coin named USDT (first RED is the flipped pin)

```
cp services/exchange.py $SCRATCH/exchange.py.bak && cmp services/exchange.py $SCRATCH/exchange.py.bak && echo BACKUP_OK
BACKUP_OK
neuter edit (services/exchange.py, inside fetch_bybit_stable_wallet_with_status):
-            if not is_stable_value(str(coin)):
+            if str(coin) != "USDT":
$PY -m pytest "tests/test_upnl_venues.py::test_coin_coverage_bybit_derive_and_reconstruct_sum_the_same_stable_coins" "tests/test_upnl_venues.py::test_shared_stable_set_drives_the_anchor_and_the_mark" -q -p no:cacheprovider
E       AssertionError: derive must sum every stable coin (1000 + 200), got 1000.0; ccxt 4.5.89: VREAD-01, closed by Phase 231; the derive anchor and the current-equity read sum the same stable coins through price_rule.is_stable_value
E       assert 1000.0 == 1200.0
E       AssertionError: the anchor must include the coin the shared set adds, got 1000.0
E       assert 1000.0 == 1050.0
FAILED tests/test_upnl_venues.py::test_coin_coverage_bybit_derive_and_reconstruct_sum_the_same_stable_coins
FAILED tests/test_upnl_venues.py::test_shared_stable_set_drives_the_anchor_and_the_mark
2 failed in 17.18s
cp $SCRATCH/exchange.py.bak services/exchange.py && cmp services/exchange.py $SCRATCH/exchange.py.bak && echo "CMP_OK restored 1"
CMP_OK restored 1
(same pytest command)
2 passed in 18.01s
```

### Block 2: helper tests membership against a literal USDT and USDC set (first RED is the shared-constant test)

```
neuter edit (same line, same backup $SCRATCH/exchange.py.bak, restored and cmp-verified first):
-            if not is_stable_value(str(coin)):
+            if str(coin).upper() not in {"USDT", "USDC"}:
$PY -m pytest "tests/test_upnl_venues.py::test_shared_stable_set_drives_the_anchor_and_the_mark" "tests/test_upnl_venues.py::test_coin_coverage_bybit_derive_and_reconstruct_sum_the_same_stable_coins" -q -p no:cacheprovider
E       AssertionError: the anchor must include the coin the shared set adds, got 1000.0
E       assert 1000.0 == 1050.0
FAILED tests/test_upnl_venues.py::test_shared_stable_set_drives_the_anchor_and_the_mark
1 failed, 1 passed in 18.74s
cp $SCRATCH/exchange.py.bak services/exchange.py && cmp services/exchange.py $SCRATCH/exchange.py.bak && echo "CMP_OK restored 2"
CMP_OK restored 2
(same pytest command)
2 passed in 16.65s
```

(One stray invocation with a non-existent placeholder test path ran between the edit and this RED and printed `no tests ran`; it is not the RED record.)

### Extra, not a PROOF-01 block: the coin-order test can fail

```
neuter: stable_sum = math.fsum(stable_qtys)  ->  a left-to-right `+=` loop (byte backup $SCRATCH/exchange.py.bak3)
$PY -m pytest "tests/test_upnl_venues.py::test_bybit_anchor_is_independent_of_coin_order" -q -p no:cacheprovider
E       AssertionError: anchor depends on coin order: [0.6000000000000001, 0.6, 0.6]
E       assert 0.6000000000000001 == 0.6
1 failed in 9.82s
cp $SCRATCH/exchange.py.bak3 services/exchange.py && cmp services/exchange.py $SCRATCH/exchange.py.bak3 && echo CMP_OK_3
CMP_OK_3
```

## Verification

- Plan verify, Task 2 (tracer) on the committed bytes before Task 3: both node ids `2 passed`, id count 0.
- Plan verify 1 (six files): `481 passed, 54 warnings` (run on the final committed tree).
- Plan verify 2 (the seven new node ids plus the flipped pin and the shared test): all pass (`18 passed` in the targeted run); `--collect-only` collects 19 tests and exits clean.
- CI mypy (`$PY -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, mypy 2.4.0): `Success: no issues found in 143 source files`.
- Full analytics suite (`$PY -m pytest -q -p no:cacheprovider -n auto`): `15875 passed, 93 skipped, 1194 warnings in 400.46s (0:06:40)`. No failure, so no test outside the plan's list needed a fix. The 93 skips are existing skips, not introduced by this plan.
- Byte identity at BASE: `git diff -U0 $BASE HEAD -- analytics-service/services/exchange.py` (saved to `$SCRATCH/p06.diff`) has the hunks: `import math`, `import is_stable_value`, the new helper, and the three edits in the two equity functions. The hunk header `@@ -3287,0 +3290,68 @@ async def fetch_usdt_balance_with_status(` names that function only as git's context label; it is a pure insertion after the function's closing lines. Extracting both `fetch_usdt_balance` and `fetch_usdt_balance_with_status` from BASE and HEAD and comparing: `BYTE_IDENTICAL` for both.
- `node scripts/verify-plan-anchors.mjs <this plan>`: `claims: 14 checked`, `OK`.

## Deviations from Plan

None of Rules 1 to 3 triggered a fix to existing code. Decisions beyond the plan's wording, listed for review:

1. `import math` added to `services/exchange.py` (the plan's write scope said one import). Used for `math.isfinite` and `math.fsum`.
2. A non-finite stable quantity (NaN, inf) returns `(None, True)` like a malformed one, rather than being silently skipped or summed as inf.
3. `math.fsum` instead of `sum`, so the anchor is exactly order-independent (Python's builtin `sum` on floats is already compensated on 3.12+, so a plain `sum` would not have shown the order effect).
4. A `None` stable quantity is skipped (matches `_price_wallet_totals` and the old helper's falsy handling); a decision, not in the plan text.
5. `test_exchange.py` imports the fixtures `bybit_coin`, `bybit_wallet_balance`, `real_bybit_parse_balance` from `tests.test_upnl_venues` to build real-parsed balances.
6. The module docstring of `test_upnl_venues.py` (coin coverage bullet) was updated to match the flip.
7. The coin-order test's first quantities (1000.1, 0.2, 0.3) did not actually differ under a naive sum, so they were replaced by 0.1, 0.2, 0.3 in an extra commit (0fc482b3f) after the advisor review; the extra neuter above proves it discriminates.

## Notes for the orchestrator

- `analytics-service/tests/test_nav_marks_bybit_uta.py:187` and `test_nav_marks_l4_read.py` prose, and the `usdt_wallet_usd` parameter name, still say the Bybit anchor is a USDT-only read. That prose is now stale for Bybit; outside this plan's write scope, not edited.
- Task 1's literal verify regex does not match Phase 229's release subject (see Task 1 gate); no change needed to this plan, but the plan text's `chore(release):` prefix assumption is wrong for 229.

## Known Stubs

None.

## Threat Flags

None. T-231-14 (stable membership only through `is_stable_value`, malformed stable quantity fails loud, negatives skipped, non-stable never parsed, shared-constant test proven able to fail) and T-231-15 (class plus scrubbed text only, the arms test asserts `deadbeef` never reaches the log) are mitigated and pinned.

## Self-Check: PASSED

- Files exist: `analytics-service/services/exchange.py` (`async def fetch_bybit_stable_wallet_with_status`), the four test files.
- Commits are ancestors of HEAD: 34c1b4756, 32aa7406d, 0fc482b3f.
- `commits: 3` measured with `git rev-list --count 340dcf45a..0fc482b3f` (the SUMMARY commit follows and is not counted).
