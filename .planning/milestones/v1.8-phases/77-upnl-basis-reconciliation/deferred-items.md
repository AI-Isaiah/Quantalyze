## 77-02 out-of-scope discoveries (do NOT fix here)
- `analytics-service/services/exchange.py:1806` F401 `services.db.db_execute` imported-but-unused (pre-existing, unrelated to 77-02 uPnL reads)
- `analytics-service/services/exchange.py:2818` E402 module-level `import time` not at top (pre-existing)

## 77-03 out-of-scope discoveries (do NOT fix here)
Pre-existing mypy `--strict` errors surfaced by the local venv312 mypy (which is
stricter than CI's pinned mypy — main ships GREEN on these). Identical at HEAD and
in the 77-03 working tree; 77-03 introduces ZERO new mypy errors. All unrelated to
the uPnL wedge / DQ-bridge:
- `analytics-service/services/analytics_runner.py:~2165` `data_quality_flags[_flag] = True`
  literal-required (the P76 `_BROKER_WARN_FLAGS` loop assigns a non-literal key to a
  TypedDict; 77-03 only appended `unrealized_pnl_in_anchor` to the tuple, not the loop body)
- `analytics-service/services/parity_diff.py:117` no-any-return (pre-existing)
- `analytics-service/services/metrics.py:509` `abs(float | None)` arg-type (pre-existing)
