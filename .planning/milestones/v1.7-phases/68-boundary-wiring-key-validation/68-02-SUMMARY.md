---
phase: 68
plan: 68-02
status: complete
completed: 2026-07-04
requirement: DRB-03
commits: [547969b4, db497d94]
---

# 68-02 SUMMARY — Deribit scope validation (DRB-03)

## Outcome
Deribit key validation admits only correctly-scoped read-only keys with honest per-scope errors.

- Relocated `_WRITE_SCOPE_SUFFIXES` + `scope_is_read_only` from `scripts/deribit_ground_truth.py` into `services/key_permissions.py` (single definition; script re-imports). No re-implementation of the gate.
- `detect_deribit_permissions`: reads `public/auth` `result.scope`; rejects any write grant naming the token; requires `account:read` AND `trade:read` by name (suffix/prefix-tolerant per A1); fail-CLOSED + credential redaction on exception. Registered `"deribit"` in `_DISPATCH` (key_permissions.py:251).
- `validate_key_permissions` (exchange.py): deribit scope precheck runs **before** `fetch_balance` (SC3 — a key missing `account:read` would otherwise die in the generic PERMISSION_DENIED branch since ccxt `fetch_balance()` itself needs that scope). Additive `MISSING_SCOPE`/`scope_detail` error surface; siblings byte-unchanged.
- Additive widening via `dict[str, object]` alias (not TypedDict — TypedDict breaks mypy --strict on the frozen sibling `return dict(_FAIL_CLOSED)`; verified empirically, within the plan's "or equivalent alias" allowance).

## Guards (fail-without-fix)
- `test_missing_account_read_named_and_bypasses_fetch_balance` — asserts `fetch_balance_calls == 0` on rejection (SC3 ordering).
- `test_wiring_guard_deleting_dispatch_disables_rejection` — `monkeypatch.delitem(_DISPATCH, "deribit")` flips write-scope rejection to None, proving the dispatch entry is the invocation.

## Verification
- `pytest test_deribit_scope_validation.py test_deribit_ground_truth.py` → 38 passed (15 new + 23 harness green after relocation).
- `pytest test_exchange.py` → 158; `test_key_permissions.py` → 25.
- `mypy --strict services/key_permissions.py services/exchange.py` → clean.

## Carry-forward
- A1: exact live Deribit scope string is 67-03-blocked; suffix-match tolerant now, re-verify at Phase 72 acceptance (flagged in code comments).
