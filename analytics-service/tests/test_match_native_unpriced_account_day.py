"""Phase 235 HOLD-02: the match AUM equals what Holdings counts for a multi-key account.

``_load_holding_portfolio_context`` applies a native-unpriced marker per ACCOUNT, as the
TypeScript reader (``fetchLatestHoldingsPerKey``, ``src/lib/latest-holdings-per-key.ts``)
does: a key's marker day is its READING day (with no rows) when it is strictly after the
key's newest ``asof``, and an account's newest day is the latest of its keys' reading days.
Before this phase a marker removed only its own key's older rows, so when key A carried a
marker for day D and key B of the same account had rows on D-1, B's rows still counted in
the match AUM while Holdings counted nothing for that account.

Every case lives in ``tests/fixtures/native_unpriced_account_day_cases.json`` (HAND-TYPED,
never produced by either implementation) and is replayed here and by
``src/lib/native-unpriced-account-day.parity.test.ts``. The TS reader is the reference.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from routers import match as match_mod
from tests.fake_postgrest import FakeDb

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "native_unpriced_account_day_cases.json").read_text()
)
_ALLOCATOR: str = _SPEC["allocator_id"]


def _db_for(case: dict[str, Any]) -> FakeDb:
    db = FakeDb(
        {
            "api_keys": [
                {
                    "id": k["id"],
                    "user_id": _ALLOCATOR,
                    "exchange": k["exchange"],
                    "venue_account_id": k["venue_account_id"],
                    "venue_server": k["venue_server"],
                    "account_share_kind": k["account_share_kind"],
                    "account_shared_with_api_key_id": k["account_shared_with_api_key_id"],
                }
                for k in case["keys"]
            ],
            "allocator_holdings": [
                {
                    "allocator_id": _ALLOCATOR,
                    "api_key_id": r["key"],
                    "venue": r["venue"],
                    "symbol": r["symbol"],
                    "holding_type": r["holding_type"],
                    "value_usd": r["value_usd"],
                    "mark_price": 100.0,
                    "side": "flat",
                    "unrealized_pnl_usd": None,
                    "asof": r["asof"],
                    "updated_at": r["updated_at"],
                }
                for r in case["rows"]
            ],
            "allocator_equity_derived": [
                {
                    "allocator_id": _ALLOCATOR,
                    "kind": f"native_unpriced:{key}",
                    "payload": {"native_unpriced": True, "asof": day},
                }
                for key, day in case["markers"].items()
            ],
        }
    )
    if case["marker_read_fails"]:
        db.errors["allocator_equity_derived"] = RuntimeError("marker table unavailable (test)")
    return db


@pytest.mark.parametrize("case", _SPEC["cases"], ids=lambda c: c["name"])
def test_match_aum_and_counted_keys_equal_the_shared_table(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, case: dict[str, Any]
) -> None:
    monkeypatch.setattr(match_mod, "get_supabase", lambda: _db_for(case))

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        ctx = match_mod._load_holding_portfolio_context(_ALLOCATOR)

    if case["marker_read_fails"]:
        # A failed marker read keeps today's behaviour: logged at ERROR (reaches Sentry),
        # markers treated as absent, rows counted by their own newest days.
        assert any(
            rec.levelname == "ERROR" and "native-unpriced" in rec.getMessage()
            for rec in caplog.records
        ), f"{case['name']}: the failed marker read was not logged at ERROR"
    # Review WR-02: the context the persisted batch is built from says whether the marker read
    # failed, so the batch can name it instead of silently carrying the kept rows.
    assert ctx["unpriced_check_failed"] is bool(case["marker_read_fails"]), (
        f"{case['name']}: unpriced_check_failed {ctx['unpriced_check_failed']!r} "
        f"!= {case['marker_read_fails']!r}"
    )

    assert ctx["portfolio_aum"] == pytest.approx(case["expected_total_usd"]), (
        f"{case['name']}: portfolio_aum {ctx['portfolio_aum']} != {case['expected_total_usd']}"
    )
    counted = sorted(
        {
            str(row["api_key_id"])
            for bucket in ("holdings_rows_eligible", "holdings_rows_withheld", "holdings_rows_derivative")
            for row in ctx[bucket]
        }
    )
    assert counted == case["expected_counted_keys"], (
        f"{case['name']}: counted keys {counted} != {case['expected_counted_keys']}"
    )
