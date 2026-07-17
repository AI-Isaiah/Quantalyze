"""E2 allocator ground-truth harness (Phase 115, STITCH) — read-only acceptance.

WHY: Phase 115 rebuilt the allocator $-equity curve on a CASH basis (the
``services.allocator_equity_derive`` core: per-key backward $-replay from a
terminal anchor + the unified real/seam cashflow ledger). The fixture oracles
(``tests/test_e2_parity_oracle.py``) prove internal correctness, but the ONE
thing a hermetic fixture cannot prove is ANCHOR CONSISTENCY against reality: does
the derived terminal equity — reconstructed from the account's persisted
``csv_daily_returns`` + its persisted per-key anchors — agree with the account's
CURRENT live venue equity within a same-day tolerance? This committed one-off
answers exactly that, for a real read-only allocator exchange key.

It is the ``deribit_ground_truth.py`` pattern, re-pointed at the E2 core:
  * credentials arrive via Railway env ONLY (never a tracked file / argv);
  * the key's read-only scope is PROVEN before any data fetch (fail loud);
  * the live equity is read with the EXISTING exchange helpers (no new fetcher);
  * the derived terminal is computed with the ``allocator_equity_derive`` core
    over service-role READ-ONLY ``csv_daily_returns`` + the persisted anchors;
  * a SINGLE sanitized JSON is emitted to stdout;
  * the script NEVER writes any table (read-only by construction).

WHAT THE GATE IS (and is NOT) — RESEARCH §6 / Landmine L4
--------------------------------------------------------
The gate is anchor-consistency + internal-consistency (already proven by the
oracle) + seam pins + match-score byte-parity. It is DELIBERATELY NOT byte-parity
vs the legacy ``allocator_equity_snapshots`` store: that store is MARK-basis, the
new derivation is CASH-basis, so a curve-shape gate would fail honestly and
permanently. For a ccxt allocator this script therefore records the
old-store-vs-new divergence as documented EVIDENCE only, explicitly labelled
``non_gating`` with the mark-vs-cash reason. For a deribit-only allocator there is
NO legacy curve at all (the carve-out wrote nothing) — the new path is the
first-ever curve and the gate there is anchor + internal consistency alone.

FIXTURE GATES CARRY THE PHASE
-----------------------------
This live run requires a founder-provisioned read-only exchange key. When the env
creds are ABSENT the script exits NON-ZERO with an explicit SKIP reason and the
Phase-115 fixture gates (the oracle, the seam ledger, the equity-curve layer, the
match golden, the E1 delete-gate) still carry the phase (RESEARCH Environment
Availability). A missing key is a PENDING-founder-env state, never a phase blocker.

USAGE
-----
  # From the running prod worker's egress (the authoritative run):
  railway ssh "cd /app && python -m scripts.e2_allocator_ground_truth \\
    --exchange okx \\
    --allocator-id <allocator_uuid> \\
    --member <strategy_uuid>:120000 \\
    --member <strategy_uuid_2>:80000"

  # Members may also be supplied as a JSON config of the same fields:
  railway ssh "cd /app && python -m scripts.e2_allocator_ground_truth \\
    --exchange okx --allocator-id <uuid> --config members.json"
  # members.json: [{"strategy_id": "<uuid>", "anchor_usd": 120000}, ...]

Credentials arrive via Railway env ONLY (never printed, never argv):
  E2_GROUND_TRUTH_API_KEY / E2_GROUND_TRUTH_API_SECRET
  E2_GROUND_TRUTH_PASSPHRASE   (optional — OKX-family keys)

RUNBOOK
-------
1. Founder provisions a READ-ONLY exchange key for the allocator account and sets
   E2_GROUND_TRUTH_API_KEY / E2_GROUND_TRUTH_API_SECRET (+ _PASSPHRASE on OKX) on
   the Railway worker via service variables (rotate after the run).
2. The persisted per-key anchor is that key's terminal equity as persisted at the
   last sync (``allocator_holdings.value_usd`` for the member). Supply it per
   ``--member <strategy_id>:<anchor_usd>`` — the allocator→key→anchor RESOLVER is
   Phase-115.1 worker-side code and is deliberately NOT duplicated here (this
   harness stays a thin, dependency-light acceptance probe, mirroring how
   ``deribit_acceptance.py`` takes explicit account descriptors).
3. Confirm ``railway deployment list`` is green (flaky-main silently skips deploys).
4. Run the USAGE command; redirect stdout to a sanitized evidence JSON and read
   ``anchor_consistency.within_same_day_tolerance``.

EXIT CODES
----------
  0  success — sanitized JSON printed
  2  FAIL-LOUD: key scope exceeds read-only, OR read-only scope not provable
  3  SKIP: missing E2_GROUND_TRUTH_* env creds / missing account spec / missing
     SUPABASE service-role config (pending-founder-env — fixture gates carry)
  1  any other failure (scrubbed message to stderr)
"""

from __future__ import annotations

from typing import Any

# The sanitization boundary is defined ONCE in the deribit harness; reuse it so
# this script cannot drift from the proven scrub/deny-key/assert contract.
from scripts.deribit_ground_truth import assert_sanitized, sanitize_evidence

# The L4 cite carried verbatim into the non-gating evidence block.
MARK_VS_CASH_REASON: str = (
    "non-gating: the legacy allocator_equity_snapshots store is MARK-basis while "
    "the Phase-115 derivation is CASH-basis (RESEARCH Landmine L4); a curve-shape "
    "parity gate would fail honestly and permanently, so old-vs-new divergence is "
    "recorded as evidence only, never asserted."
)

# Default same-trading-day drift band for anchor-consistency (2%). The persisted
# anchor is the last-sync terminal equity; a same-day live read should land inside
# this band. Overridable via --same-day-drift-tol.
DEFAULT_SAME_DAY_DRIFT_TOL: float = 0.02


class ScopeViolationError(RuntimeError):
    """Raised when the key scope exceeds read-only (exit code 2)."""


class GroundTruthSkip(RuntimeError):
    """Raised on a pending-founder-env skip (exit code 3) — never a phase blocker."""


# ---------------------------------------------------------------------------
# Pure helpers (I/O-free; unit-reasonable, import-light).
# ---------------------------------------------------------------------------


def parse_members(items: list[str]) -> list[tuple[str, float]]:
    """Parse ``--member`` descriptors of the form ``strategy_id:anchor_usd``.

    The anchor is the member key's persisted terminal equity (the last-sync
    ``value_usd``). A member WITHOUT an anchor fails loud (we never fabricate a
    base — the whole point of the run is to check the persisted anchor).
    """
    members: list[tuple[str, float]] = []
    for raw in items:
        if ":" not in raw:
            raise GroundTruthSkip(
                "each --member must be 'strategy_id:anchor_usd' (the persisted "
                "per-key terminal equity); missing anchor is a fabrication risk"
            )
        strategy_id, _, anchor_str = raw.rpartition(":")
        try:
            anchor = float(anchor_str)
        except ValueError as exc:
            raise GroundTruthSkip(
                f"--member anchor is not numeric for strategy (id withheld): {exc}"
            ) from None
        members.append((strategy_id.strip(), anchor))
    return members


def compute_anchor_consistency(
    derived_terminal: float, live_equity: float, tol: float
) -> dict[str, Any]:
    """The anchor-consistency verdict — drift as a PCT + a bool (T-115-11: the
    verdict never needs raw USD; the raw figures live only in the founder-run
    sanitized JSON, never in a log). Non-positive derived terminal fails loud."""
    if not (derived_terminal > 0.0):
        raise GroundTruthSkip(
            "derived terminal equity is non-positive — cannot form a drift ratio "
            "(the persisted anchors or csv_daily_returns are incomplete)"
        )
    drift_pct = (live_equity - derived_terminal) / derived_terminal
    return {
        "derived_terminal": float(derived_terminal),
        "live_equity": float(live_equity),
        "drift_pct": float(drift_pct),
        "within_same_day_tolerance": bool(abs(drift_pct) <= tol),
        "tolerance": float(tol),
    }


def derive_terminal_equity(
    series_by_key: dict[str, Any], anchors_by_key: dict[str, float]
) -> tuple[float, dict[str, Any]]:
    """Run the ``allocator_equity_derive`` CORE over the persisted per-key series
    + anchors and return ``(derived_terminal, flags)``.

    Uses ONLY the pure core (backward $-replay per key + the common-window sum) —
    no store, no snapshots, no legacy TWR-scalar helper (additive-only). Fails
    loud if the summed curve is honest-empty (never fabricates a terminal)."""
    from services.allocator_equity_derive import (
        allocator_equity_curve,
        replay_key_equity,
    )

    per_key = {
        sid: replay_key_equity(series, [], anchors_by_key.get(sid))
        for sid, series in series_by_key.items()
    }
    curve = allocator_equity_curve(per_key)
    if curve.equity is None:
        raise GroundTruthSkip(
            "derived allocator $-curve is honest-empty over the persisted anchors "
            f"(flags={curve.flags}) — nothing to reconcile against live equity"
        )
    terminal = float(curve.equity.iloc[-1])
    return terminal, dict(curve.flags)


# ---------------------------------------------------------------------------
# I/O layer — read-only fetch + service-role read (lazy imports keep the pure
# layer above network-free and cheap to import).
# ---------------------------------------------------------------------------


def _load_persisted_series(strategy_id: str) -> Any:
    """Service-role READ-ONLY load of a member key's persisted daily-return series
    from ``csv_daily_returns`` (paginated, date-asc — the exact analytics_runner
    read shape). Returns a pandas Series indexed by ISO-day strings, or None on an
    empty series."""
    import pandas as pd

    from services.db import get_supabase, paginated_select

    supabase = get_supabase()
    data = paginated_select(
        supabase.table("csv_daily_returns")
        .select("date, daily_return")
        .eq("strategy_id", strategy_id),
        order_by=(("date", False),),
        truncation_hint=f"csv_daily_returns strategy_id={strategy_id}",
    )
    if not data:
        return None
    idx = [str(r["date"]) for r in data]
    values = [float(r["daily_return"]) for r in data]
    return pd.Series(values, index=idx, name=strategy_id)


def _old_store_evidence(allocator_id: str | None, derived_terminal: float) -> dict[str, Any]:
    """Read the LEGACY ``allocator_equity_snapshots`` store READ-ONLY and record
    old-vs-new divergence as EVIDENCE (never a gate — T-115-11 / L4).

    Sums the latest snapshot's per-symbol ``breakdown`` for an old-store terminal
    and reports the divergence vs the new cash-basis derived terminal. A missing
    allocator id or an empty store is a benign non-gating skip (the deribit-only
    case has no store at all)."""
    if not allocator_id:
        return {"non_gating": True, "skipped": "no --allocator-id supplied",
                "reason": MARK_VS_CASH_REASON}
    from services.db import get_supabase, rows

    supabase = get_supabase()
    snaps = rows(
        supabase.table("allocator_equity_snapshots")
        .select("asof, breakdown")
        .eq("allocator_id", allocator_id)
        .order("asof", desc=True)
        .limit(1)
        .execute()
    )
    if not snaps:
        return {"non_gating": True, "skipped": "no legacy store rows (deribit-only "
                "carve-out or never-computed allocator)", "reason": MARK_VS_CASH_REASON}
    breakdown = snaps[0].get("breakdown") or {}
    old_terminal = 0.0
    if isinstance(breakdown, dict):
        for value in breakdown.values():
            try:
                old_terminal += float(value)
            except (TypeError, ValueError):
                continue
    divergence_pct = (
        (derived_terminal - old_terminal) / old_terminal if old_terminal else None
    )
    return {
        "non_gating": True,
        "old_store_terminal": float(old_terminal),
        "new_cash_terminal": float(derived_terminal),
        "divergence_pct": (float(divergence_pct) if divergence_pct is not None else None),
        "reason": MARK_VS_CASH_REASON,
    }


async def _fetch_live_equity(exchange_name: str, ex: Any) -> float:
    """Read the account's CURRENT live equity with the EXISTING exchange helpers
    (never a new fetcher). OKX unified accounts use the raw totalEq path (ccxt
    ``fetch_balance`` raises on OKX in 4.5.x); every other venue uses the shared
    ``fetch_usdt_balance_with_status`` total. Fails loud on an unreadable balance."""
    from services.exchange import (
        fetch_okx_total_equity_and_upl_usd,
        fetch_usdt_balance_with_status,
    )

    if exchange_name == "okx":
        equity, _upl, _unreadable = await fetch_okx_total_equity_and_upl_usd(ex)
        if equity is None or not (equity > 0.0):
            raise GroundTruthSkip("live OKX total equity unreadable / non-positive")
        return float(equity)

    balance, balance_error = await fetch_usdt_balance_with_status(ex)
    if balance_error or balance is None or not (balance > 0.0):
        raise GroundTruthSkip(
            f"live {exchange_name} equity unreadable / non-positive "
            f"(balance_error={balance_error})"
        )
    return float(balance)


async def run(
    exchange_name: str,
    api_key: str,
    api_secret: str,
    passphrase: str | None,
    members: list[tuple[str, float]],
    allocator_id: str | None,
    same_day_drift_tol: float,
) -> dict[str, Any]:
    """Prove read-only scope, read live equity + persisted series, derive the
    terminal with the core, and return a (pre-sanitization) evidence dict.

    Raises ScopeViolationError if the key scope is not provably read-only (BEFORE
    any data fetch). Raises GroundTruthSkip on any partial/incomplete read. The
    caller sanitizes the returned dict."""
    from datetime import datetime, timezone

    from services.exchange import aclose_exchange, create_exchange
    from services.key_permissions import detect_permissions

    evidence: dict[str, Any] = {
        "run_meta": {
            "utc": datetime.now(timezone.utc).isoformat(),
            "exchange": exchange_name,
            "member_count": len(members),
            "has_allocator_id": bool(allocator_id),
        },
    }

    ex: Any = create_exchange(exchange_name, api_key, api_secret, passphrase)
    try:
        # 1. Read-only scope gate — FAIL LOUD before ANY data fetch (T-115-12).
        perms = await detect_permissions(ex)
        evidence["scope"] = {
            "read": bool(perms.get("read")),
            "trade": bool(perms.get("trade")),
            "withdraw": bool(perms.get("withdraw")),
            "probe_error": bool(perms.get("probe_error")),
        }
        if perms.get("probe_error"):
            raise ScopeViolationError(
                "FAIL-LOUD: could not PROVE read-only scope (permission probe "
                "errored) — refusing to fetch account data with an unverified key"
            )
        if perms.get("trade") or perms.get("withdraw"):
            raise ScopeViolationError(
                "FAIL-LOUD: key scope exceeds read-only "
                f"(trade={perms.get('trade')}, withdraw={perms.get('withdraw')})"
            )

        # 2. Live current equity (existing helpers only).
        live_equity = await _fetch_live_equity(exchange_name, ex)
    finally:
        await aclose_exchange(ex)

    # 3. Persisted per-key series (service-role READ-ONLY) + anchors.
    series_by_key: dict[str, Any] = {}
    anchors_by_key: dict[str, float] = {}
    missing: list[str] = []
    for strategy_id, anchor in members:
        series = _load_persisted_series(strategy_id)
        if series is None or len(series) == 0:
            missing.append(strategy_id)
            continue
        series_by_key[strategy_id] = series
        anchors_by_key[strategy_id] = anchor
    if missing:
        # Fail loud on a partial read — a dropped member silently understates the
        # allocator terminal (repudiation risk T-115-13). Ids withheld from stderr.
        raise GroundTruthSkip(
            f"{len(missing)} of {len(members)} member(s) have no persisted "
            "csv_daily_returns — refusing a partial reconcile"
        )

    # 4. Derive the terminal with the core (no store / snapshots / legacy TWR helper).
    derived_terminal, flags = derive_terminal_equity(series_by_key, anchors_by_key)
    evidence["derive_flags"] = flags

    # 5. Anchor-consistency verdict + non-gating old-store evidence.
    evidence["anchor_consistency"] = compute_anchor_consistency(
        derived_terminal, live_equity, same_day_drift_tol
    )
    evidence["old_store_evidence"] = _old_store_evidence(allocator_id, derived_terminal)
    return evidence


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint. Prints ONE sanitized JSON object to stdout on success.

    Exit codes: 0 success, 2 scope violation, 3 skip (pending-founder-env), 1 other.
    """
    import argparse
    import asyncio
    import json
    import os
    import sys

    from services.redact import scrub_freeform_string

    parser = argparse.ArgumentParser(
        description="E2 allocator read-only ground-truth harness (Phase 115)."
    )
    parser.add_argument("--exchange", required=True)
    parser.add_argument("--allocator-id", default=None)
    parser.add_argument("--member", action="append", default=[])
    parser.add_argument("--config", default=None, help="JSON list of members")
    parser.add_argument(
        "--same-day-drift-tol", type=float, default=DEFAULT_SAME_DAY_DRIFT_TOL
    )
    args = parser.parse_args(argv)

    api_key = os.getenv("E2_GROUND_TRUTH_API_KEY")
    api_secret = os.getenv("E2_GROUND_TRUTH_API_SECRET")
    passphrase = os.getenv("E2_GROUND_TRUTH_PASSPHRASE") or None
    if not api_key or not api_secret:
        print(
            "SKIP: E2_GROUND_TRUTH_API_KEY and E2_GROUND_TRUTH_API_SECRET must be "
            "set (Railway env only; values never printed). Pending founder env — "
            "the Phase-115 fixture gates carry the phase.",
            file=sys.stderr,
        )
        return 3

    try:
        member_items = list(args.member)
        if args.config:
            with open(args.config, encoding="utf-8") as handle:
                for entry in json.load(handle):
                    member_items.append(
                        f"{entry['strategy_id']}:{entry['anchor_usd']}"
                    )
        members = parse_members(member_items)
        if not members:
            raise GroundTruthSkip(
                "no members supplied (--member strategy_id:anchor_usd / --config)"
            )
    except GroundTruthSkip as exc:
        print(f"SKIP: {exc}", file=sys.stderr)
        return 3
    except Exception as exc:  # noqa: BLE001
        print("ERROR: " + str(scrub_freeform_string(str(exc))), file=sys.stderr)
        return 1

    try:
        evidence = asyncio.run(
            run(
                args.exchange,
                api_key,
                api_secret,
                passphrase,
                members,
                args.allocator_id,
                args.same_day_drift_tol,
            )
        )
    except ScopeViolationError as exc:
        # Scope verdicts are not secrets — print the fail-loud reason verbatim.
        print(str(exc), file=sys.stderr)
        return 2
    except GroundTruthSkip as exc:
        print(f"SKIP: {exc}", file=sys.stderr)
        return 3
    except Exception as exc:  # noqa: BLE001
        print("ERROR: " + str(scrub_freeform_string(str(exc))), file=sys.stderr)
        return 1

    clean = sanitize_evidence(evidence)
    assert_sanitized(clean)
    print(json.dumps(clean, indent=2, default=str))
    return 0


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
