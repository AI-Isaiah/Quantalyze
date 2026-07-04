"""Cross-language match_key format parity pin (BYB-02 review finding).

Migration 20260704150835_funding_match_key_1h_rekey.sql reconstructs
match_key in SQL via ``to_char(date_trunc('hour', ...),
'YYYY-MM-DD"T"HH24:MI:SS+00:00')``. That literal must stay byte-identical
to what :func:`services.funding_fetch._build_match_key` produces, or a
future format drift on either side silently reintroduces the
duplicate/loss class the migration fixed (same failure shape as the F-4
sweep parity gate — an inlined SQL copy of a runtime predicate must be
pinned, see test_f4_sweep_fixture_parity.py).

Two pins:
1. Python side: _build_match_key output for a known input equals the
   canonical stored format observed in prod.
2. SQL side: the migration file contains the exact to_char format literal
   and the exact ':'-joined key shape, so an edit to either breaks here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from services.funding_fetch import _FUNDING_BUCKET_HOURS, _build_match_key

_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260704150835_funding_match_key_1h_rekey.sql"
)

# The funding_fees.exchange CHECK that STAYS 3-exchange this phase (Phase 68 /
# DRB-02 exclusion) — the SQL mirror of _FUNDING_BUCKET_HOURS excluding deribit.
_FUNDING_CHECK_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260602180000_funding_fees_exchange_check.sql"
)

# The canonical stored format (verified against prod rows 2026-07-04):
# <strategy_uuid>:<exchange>:<SYMBOL>:2026-07-04T08:00:00+00:00
_EXPECTED_KEY = (
    "fc1b4014-da41-49d7-8592-138be5a6fa12:bybit:BTCUSDT:"
    "2026-07-04T08:00:00+00:00"
)

_SQL_FORMAT_LITERAL = "'YYYY-MM-DD\"T\"HH24:MI:SS+00:00'"
# The migration inlines the key expression FOUR times: twice f.-prefixed
# (Step-1 DELETE + its EXISTS) and twice unprefixed (Step-2 SET + WHERE).
# The file is re-run as the post-deploy sweep, so drift in ANY copy makes
# the sweep delete wrong rows or miss duplicates — pin all four.
_SQL_KEY_SHAPE = (
    "strategy_id::text || ':' || exchange || ':' || symbol || ':'"
)
_SQL_KEY_SHAPE_ALIASED = (
    "f.strategy_id::text || ':' || f.exchange || ':' || f.symbol || ':'"
)
_SQL_HOUR_FLOOR = "date_trunc('hour', timestamp AT TIME ZONE 'UTC')"
_SQL_HOUR_FLOOR_ALIASED = "date_trunc('hour', f.timestamp AT TIME ZONE 'UTC')"


class TestMatchKeySqlParity:
    def test_python_side_produces_canonical_format(self) -> None:
        # 08:37:12.5 UTC floors to the 08:00 1h bucket.
        ts = datetime(2026, 7, 4, 8, 37, 12, 500000, tzinfo=timezone.utc)
        key = _build_match_key(
            "fc1b4014-da41-49d7-8592-138be5a6fa12", "bybit", "BTCUSDT", ts
        )
        assert key == _EXPECTED_KEY

    def test_python_side_is_tz_normalizing(self) -> None:
        # A non-UTC tz for the same instant must yield the same key —
        # mirrors the migration's `AT TIME ZONE 'UTC'` normalization.
        from datetime import timedelta, timezone as tz

        plus2 = tz(timedelta(hours=2))
        ts = datetime(2026, 7, 4, 10, 37, 12, tzinfo=plus2)  # == 08:37 UTC
        key = _build_match_key(
            "fc1b4014-da41-49d7-8592-138be5a6fa12", "bybit", "BTCUSDT", ts
        )
        assert key == _EXPECTED_KEY

    def test_migration_pins_the_same_format(self) -> None:
        sql = _MIGRATION.read_text(encoding="utf-8")
        # 4 copies of the to_char literal: DELETE outer + EXISTS + SET + WHERE.
        # A count mismatch means one inlined copy drifted from the others.
        assert sql.count(_SQL_FORMAT_LITERAL) == 4, (
            "migration must carry exactly 4 identical to_char format "
            "literals (DELETE, EXISTS, SET, WHERE) byte-identical to "
            "_build_match_key's strftime output"
        )
        assert sql.count(_SQL_KEY_SHAPE_ALIASED) == 2, (
            "Step-1 DELETE must carry exactly 2 f.-prefixed key shapes "
            "(outer predicate + EXISTS) mirroring _build_match_key"
        )
        # The unaliased shape never matches inside the aliased one (the
        # aliased copy carries 'f.' before every column), so count is exact.
        assert sql.count(_SQL_KEY_SHAPE) == 2, (
            "Step-2 UPDATE must carry exactly 2 unprefixed key shapes "
            "(SET + WHERE) mirroring _build_match_key's f-string"
        )
        assert sql.count(_SQL_HOUR_FLOOR_ALIASED) == 2, (
            "Step-1 hour-floor expression drifted from "
            "_bucket_for_exchange(hours=1) UTC flooring"
        )
        assert sql.count(_SQL_HOUR_FLOOR) == 2, (
            "Step-2 hour-floor expression drifted from "
            "_bucket_for_exchange(hours=1) UTC flooring"
        )


class TestFundingExcludesDeribit:
    """Phase 68 (DRB-02) EXCLUDE-direction pin: the funding surface stays
    3-exchange even though SUPPORTED_EXCHANGES gained 'deribit'.

    BYB-02 (2026-07-04): Deribit funding is continuous — settlements land at
    arbitrary intra-hour timestamps, so a floor-bucket entry in
    _FUNDING_BUCKET_HOURS would silently collapse distinct events (the exact
    loss class the 1h re-key just fixed). Phase 70 flips BOTH sides together
    (the bucket registry AND the funding_fees_exchange_check) via a
    native-id/exact-ts dedup axis — that flip must consciously edit THESE
    failing pins, never drift green.
    """

    def test_funding_bucket_hours_excludes_deribit(self) -> None:
        # Runtime mirror of the SQL exclusion. Phase 70 adds deribit here ONLY
        # together with a native-id/exact-ts dedup axis (never a floor bucket).
        assert "deribit" not in _FUNDING_BUCKET_HOURS, (
            "_FUNDING_BUCKET_HOURS must NOT carry a deribit key — Deribit funding "
            "is continuous (BYB-02); a floor bucket would collapse distinct "
            "settlements. Phase 70 flips this with a native-id/exact-ts axis."
        )

    def test_funding_check_migration_stays_three_exchange(self) -> None:
        # SQL mirror of the same exclusion: the funding_fees_exchange_check
        # migration admits exactly binance/okx/bybit and contains no 'deribit'.
        sql = _FUNDING_CHECK_MIGRATION.read_text(encoding="utf-8")
        assert "deribit" not in sql, (
            "the funding_fees_exchange_check migration must stay 3-exchange "
            "(no 'deribit') until Phase 70 flips it together with "
            "_FUNDING_BUCKET_HOURS."
        )
        for venue in ("binance", "okx", "bybit"):
            assert f"'{venue}'" in sql, (
                f"funding_fees_exchange_check migration must still admit '{venue}'"
            )
