"""Phase 07 / PURGE-02 — Env-gated live ccxt integration test.

Exercises real Binance/OKX/Bybit read-only API keys against ccxt to validate
pagination boundary behaviour (OKX 3-month trade cap, Binance 90-day deposit
window, Bybit cursor). Default CI skips; developers run locally with
QUANTALYZE_LIVE_CCXT=1 + read-only venue API keys.

Per VOICES-ACCEPTED f5: addresses Voice A + Grok B consensus that mocked
pytest green-lights whatever pagination code exists regardless of real
ccxt boundary behaviour.

How to run locally:
  export QUANTALYZE_LIVE_CCXT=1
  export BINANCE_TEST_API_KEY=... BINANCE_TEST_API_SECRET=...
  export OKX_TEST_API_KEY=... OKX_TEST_API_SECRET=... OKX_TEST_API_PASSPHRASE=...
  export BYBIT_TEST_API_KEY=... BYBIT_TEST_API_SECRET=...
  export QUANTALYZE_TEST_ALLOCATOR_ID=<uuid of a test allocator row>
  export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
  cd analytics-service && pytest tests/test_equity_reconstruction_live.py -v

Each missing per-venue env pair results in that venue's test being skipped
individually. This file commits NO secrets of any kind.
"""
from __future__ import annotations

import os

import pytest

# Module-level guard: skip the whole file if the env flag is not set.
if os.getenv("QUANTALYZE_LIVE_CCXT") != "1":
    pytest.skip(
        "live-ccxt tests require QUANTALYZE_LIVE_CCXT=1",
        allow_module_level=True,
    )


# Per-venue env prefix → credential env var names. Secrets NEVER hardcoded.
VENUE_ENV_PREFIX: dict[str, str] = {
    "binance": "BINANCE_TEST",  # BINANCE_TEST_API_KEY, BINANCE_TEST_API_SECRET
    "okx": "OKX_TEST",          # + OKX_TEST_API_PASSPHRASE
    "bybit": "BYBIT_TEST",
}


def _load_credentials(prefix: str) -> tuple[str | None, str | None, str | None]:
    """Read (api_key, api_secret, passphrase) from env or return (None, None, None)."""
    return (
        os.getenv(f"{prefix}_API_KEY"),
        os.getenv(f"{prefix}_API_SECRET"),
        os.getenv(f"{prefix}_API_PASSPHRASE"),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", ["binance", "okx", "bybit"])
async def test_live_reconstruct_per_venue(venue: str):
    """Run reconstruct_allocator_history against a real read-only key.

    Asserts:
      (a) snapshot rows > 0 for the test allocator,
      (b) no raised exceptions (DONE outcome),
      (c) for OKX: rows span <= 92 days (validates A3 boundary behaviour)
          AND history_depth_months == 3 on every OKX row.

    The test allocator + api_keys rows must exist in the configured test
    Supabase project. Set QUANTALYZE_TEST_ALLOCATOR_ID and provide a
    real key row id via QUANTALYZE_TEST_{VENUE}_KEY_ID so the handler's
    preflight can load it.
    """
    prefix = VENUE_ENV_PREFIX[venue]
    api_key, api_secret, _passphrase = _load_credentials(prefix)
    if not api_key or not api_secret:
        pytest.skip(f"{prefix}_API_KEY / _API_SECRET not set — skipping {venue}")

    allocator_id = os.getenv("QUANTALYZE_TEST_ALLOCATOR_ID")
    api_key_id = os.getenv(f"QUANTALYZE_TEST_{venue.upper()}_KEY_ID")
    if not allocator_id or not api_key_id:
        pytest.skip(
            f"QUANTALYZE_TEST_ALLOCATOR_ID / QUANTALYZE_TEST_{venue.upper()}_KEY_ID not set"
        )

    # Deferred import so the module-level skip guards unset-env environments.
    from services.db import db_execute, get_supabase
    from services.equity_reconstruction import run_reconstruct_allocator_history_job
    from services.job_worker import DispatchOutcome

    supabase = get_supabase()

    # Clear any prior reconstruction so this test exercises a full backfill.
    def _purge():
        return (
            supabase.table("allocator_equity_snapshots")
            .delete()
            .eq("allocator_id", allocator_id)
            .execute()
        )

    await db_execute(_purge)

    job = {
        "id": f"live-reconstruct-{venue}",
        "kind": "reconstruct_allocator_history",
        "api_key_id": api_key_id,
    }
    result = await run_reconstruct_allocator_history_job(job)

    # (b) — no raised exceptions; DONE outcome.
    assert result.outcome == DispatchOutcome.DONE, (
        f"{venue}: reconstruction did not complete cleanly: {result}"
    )

    # (a) — snapshot rows > 0.
    def _count():
        return (
            supabase.table("allocator_equity_snapshots")
            .select("asof, history_depth_months", count="exact")
            .eq("allocator_id", allocator_id)
            .order("asof", desc=False)
            .execute()
        )

    res = await db_execute(_count)
    rows = list(getattr(res, "data", None) or [])
    count = getattr(res, "count", None) or len(rows)
    assert count > 0, (
        f"{venue}: expected >0 rows in allocator_equity_snapshots for test allocator"
    )

    # (c) — OKX-specific: <= ~92 day span + history_depth_months=3.
    if venue == "okx":
        from datetime import date

        asofs = sorted(r["asof"] for r in rows if r.get("asof"))
        if asofs:
            span = (date.fromisoformat(asofs[-1]) - date.fromisoformat(asofs[0])).days
            assert span <= 92, (
                f"OKX span {span} days exceeds A3 boundary (expected <= ~90 days; "
                f"92 allows for boundary fuzziness)"
            )
        for r in rows:
            # coingecko-fallback rows legally carry NULL depth; skip them.
            if r.get("history_depth_months") is None:
                continue
            assert r["history_depth_months"] == 3, (
                f"OKX row {r!r} must carry history_depth_months=3 per f9"
            )
