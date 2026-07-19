"""sFOX ground-truth parity harness (SFOX-06) — the P115-independent economic
oracle behind the ``api_verified`` trust stamp.

WHY: ``api_verified`` is only as strong as the ground-truth check behind it. A
CSV track record is fabricatable; a live-API-anchored parity is not. This harness
validates the RECONSTRUCTED sFOX equity curve — the cashflow-neutral daily-return
series that ``services.broker_dailies.combine_sfox_balance_history`` derives from
``/v1/account/balance/history``'s daily ``usd_value`` — against an ECONOMICALLY
INDEPENDENT oracle reconstructed SOLELY from ``/v1/account/transactions``' running
``account_balance`` anchors + typed deposit/withdraw/credit/charge cashflows. The
two streams are computed by sFOX independently of each other, so a material
divergence between them is evidence that one is corrupt — and the wrong curve
MUST NEVER be displayed (it would be the exact fabrication class ``api_verified``
exists to prevent). Material divergence FAILS LOUD (raise → exit 1).

P115 (the load-bearing invariant): the oracle
(``reconstruct_equity_from_transactions``) reconstructs equity ONLY from the
transactions ledger. Its signature takes the transaction rows and NOTHING else;
its body never reads the balance-history series and never calls the module's own
``combine_sfox_balance_history`` / ``chain_linked_twr``. A self-referential oracle
(one that re-asserts the impl's own transform) would trivially pass — it would
pin the bug, not the economics. Independence is enforced BY CONSTRUCTION and
pinned by the fixture suite (signature scan + comment-stripped source scan).

The two live-data unknowns (RESEARCH A2/A3) are SURFACED as explicit residual
probes in the evidence, never silently guessed:
  * A2 — is the transactions' running ``account_balance`` a USD *cash-only*
    running balance or *total portfolio MTM*? The two reconcile at cashflow
    events but are different economic quantities day-to-day. The harness computes
    residuals under BOTH interpretations and emits them; a cash-only pattern
    (``account_balance`` piecewise-constant between cashflow events) is FLAGGED
    ``requires_founder_decision`` rather than auto-failed.
  * A3 — the day-0 inception convention (``prev0`` = first balance-history point).
    The harness emits the inception residual between the first balance-history
    anchor and the transactions-implied inception capital.

Sanitization: the whitelisted evidence (dates, floats, counts, residuals, flags)
is re-walked by ``sanitize_evidence`` + ``assert_sanitized`` (IMPORTED from the
deribit harness — the SAME primitives, never re-implemented) before any print,
and every error path is scrubbed via ``_redact_secret_values``. The Bearer token
can never reach stdout/stderr.

USAGE
-----
  # After the Phase-121 static egress is verified (for an IP-whitelisted key), or
  # immediately with a non-whitelisted read-only key:
  export SFOX_GROUND_TRUTH_KEY=<read-only sFOX token>   # env only, never a file
  cd analytics-service && python -m scripts.sfox_ground_truth > /tmp/sfox_parity.json
  echo "exit=$?"

Optional: ``SFOX_GROUND_TRUTH_PROXY`` (the Phase-121 static-egress proxy URL) is
threaded into the read-only client when set.

EXIT CODES
----------
  0  success — sanitized parity evidence JSON printed (parity holds, or an
     A2/A3 interpretation ambiguity flagged ``requires_founder_decision``)
  1  FAIL-LOUD: material divergence (the reconstructed curve disagrees with the
     independent oracle) OR any other failure (scrubbed message to stderr)
  2  the read-only structural premise was violated (no data fetched)
  3  missing SFOX_GROUND_TRUTH_KEY env var
"""

from __future__ import annotations

from typing import Any

import pandas as pd

# The ONE reuse of the deribit harness: its sanitization primitives + the
# scope-violation semantics. Never re-implemented here (single definition).
from scripts.deribit_ground_truth import (  # noqa: F401 - ScopeViolationError re-exported for main()
    ScopeViolationError,
    _redact_secret_values,
    assert_sanitized,
    sanitize_evidence,
)
from services.broker_dailies import combine_sfox_balance_history
from services.sfox_read import (
    _FLOW_SIGN,
    _ROTATION_ACTIONS,
    _utc_day_iso,
    sfox_flows_by_day,
)

# ---------------------------------------------------------------------------
# Materiality thresholds (the parity gate). Documented values + rationale.
# ---------------------------------------------------------------------------
# A cross-stream level-change residual is MATERIAL when it exceeds BOTH a
# relative tolerance (0.5% of the prior equity — comfortably above float/rounding
# noise and any legitimate same-day settle timing) AND a $1 absolute floor (so a
# dust-sized account cannot trip the relative test on pennies). Chosen an order of
# magnitude below the tamper magnitudes (a 5% valuation bump / a deposit-sized
# jump) so a real corruption fails loud while clean data passes.
_MATERIALITY_REL: float = 0.005
_MATERIALITY_ABS: float = 1.0

# 2015-01-01T00:00:00Z in epoch-ms — far before any sFOX account could exist, so a
# crawl from here reaches the empirical inception (A1 depth probe).
_DEFAULT_START_MS: int = 1_420_070_400_000


class ParityDivergenceError(RuntimeError):
    """FAIL-LOUD (exit 1): the reconstructed balance-history curve materially
    disagrees with the independent transactions oracle. The wrong curve must
    never be displayed. Carries residual magnitudes only — never a credential,
    never a raw account dump (T-120-16)."""


class ParityInputError(ValueError):
    """A row could not be parsed into a usable number (a non-finite/garbage
    balance point or account_balance). Fail loud, never coerce to 0.0 (which
    would fabricate equity)."""


def _is_material(delta: float, prev: float) -> bool:
    """A change is material iff it exceeds BOTH the relative tolerance and the
    absolute floor. Pure/never-raising."""
    return abs(delta) > max(_MATERIALITY_ABS, _MATERIALITY_REL * abs(prev))


def _coerce_finite(value: Any, *, field: str) -> float:
    """Coerce ``value`` to a finite float or raise ``ParityInputError`` — never a
    silent 0.0 (that would fabricate a balance point)."""
    try:
        out = float(value)
    except (TypeError, ValueError) as exc:
        raise ParityInputError(
            f"sFOX {field} carries no usable numeric value"
        ) from exc
    if out != out or out in (float("inf"), float("-inf")):
        raise ParityInputError(f"sFOX {field} is non-finite")
    return out


def _rows_to_usd_value_series(balance_rows: list[dict]) -> pd.Series:
    """Parse balance-history rows into the daily equity series under test on an
    ascending [us] DatetimeIndex. Fail-loud on a garbage value point; an empty
    read yields an honest empty Series (never a fabricated row)."""
    if not balance_rows:
        return pd.Series(dtype="float64", name="usd_value")
    by_day: dict[str, float] = {}
    for row in balance_rows:
        iso = _utc_day_iso(row.get("timestamp"))
        # Last observation per UTC day wins (end-of-day equity).
        by_day[iso] = _coerce_finite(row.get("usd_value"), field="usd_value point")
    days = sorted(by_day)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit("us")
    return pd.Series([by_day[d] for d in days], index=index, name="usd_value")


# ---------------------------------------------------------------------------
# THE INDEPENDENT ORACLE (P115). Input: the transactions rows and NOTHING else.
# ---------------------------------------------------------------------------
def reconstruct_equity_from_transactions(transactions: list[dict]) -> dict[str, Any]:
    """Reconstruct a cashflow-neutral daily-return path + equity anchors from the
    transactions ledger ALONE — the load-bearing P115-independent oracle.

    The ONLY input is the transaction row list. This function never receives and
    never reads the equity series under test, and never calls the module's own
    combine / chain-linked-TWR transform (a self-referential oracle would pin the
    impl's own formula instead of the economics). It rolls the ledger's OWN
    running end-of-day balance forward and removes typed external cashflows from
    the numerator by hand:

        ``r_t = (B_t - B_{t-1} - F_t) / B_{t-1}``

    where ``B`` is the end-of-day running balance (the last row's balance per UTC
    day) and ``F`` is that day's signed typed cashflow (deposit +, credit +,
    withdraw -, charge -; buy/sell are internal rotations, excluded — the SAME
    sign convention the flow extractor uses, so the deposit is booked once). The
    returns are re-cumulated into an equity index anchored at the first observed
    balance (the transactions-implied inception capital).

    Fail loud (never a silent 0.0): a row whose balance is unparseable raises
    ``ParityInputError``. An empty/one-day ledger yields honest empties.

    Returns a dict of transactions-derived quantities only:
      ``balance_eod`` (Series), ``flows`` (Series), ``returns`` (Series),
      ``equity`` (Series), ``inception_capital`` (float|None),
      ``cashflow_event_days`` (list[str] ISO).
    """
    empty = pd.Series(dtype="float64")
    if not transactions:
        return {
            "balance_eod": empty,
            "flows": pd.Series(dtype="float64", name="flows"),
            "returns": pd.Series(dtype="float64", name="returns"),
            "equity": empty,
            "inception_capital": None,
            "cashflow_event_days": [],
        }

    # 1) End-of-day running balance: the LAST row (max timestamp) per UTC day.
    latest_ts: dict[str, int] = {}
    balance_at: dict[str, float] = {}
    for row in transactions:
        iso = _utc_day_iso(row.get("timestamp"))
        try:
            ts = int(row["timestamp"])
        except (TypeError, ValueError, KeyError) as exc:
            raise ParityInputError(
                "sFOX transaction row missing a usable integer timestamp"
            ) from exc
        if iso not in latest_ts or ts >= latest_ts[iso]:
            latest_ts[iso] = ts
            balance_at[iso] = _coerce_finite(
                row.get("account_balance"), field="account_balance"
            )

    # 2) Typed cashflow per day — the SAME sign map the flow extractor uses.
    flow_at: dict[str, float] = {}
    event_days: set[str] = set()
    for row in transactions:
        action = str(row.get("action", "")).strip().lower()
        if action in _ROTATION_ACTIONS:
            continue
        sign = _FLOW_SIGN.get(action)
        if sign is None:
            # An unrecognized action is surfaced to the flow extractor's fail-loud
            # path in the parity comparison; the oracle skips it for the running
            # balance roll (which is action-agnostic).
            continue
        iso = _utc_day_iso(row.get("timestamp"))
        magnitude = abs(_coerce_finite(row.get("amount"), field="flow amount"))
        flow_at[iso] = flow_at.get(iso, 0.0) + sign * magnitude
        event_days.add(iso)

    days = sorted(balance_at)
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit("us")
    balance_eod = pd.Series([balance_at[d] for d in days], index=idx, name="balance")
    flows = pd.Series(
        [flow_at.get(d, 0.0) for d in days], index=idx, name="flows"
    )

    inception = float(balance_eod.iloc[0]) if len(balance_eod) else None
    returns_vals: list[float] = []
    equity_vals: list[float] = []
    running = inception if inception is not None else 0.0
    for pos, day in enumerate(days):
        if pos == 0:
            returns_vals.append(0.0)  # day-0 anchor (prev0 = inception capital)
            equity_vals.append(1.0)
            continue
        prev = balance_at[days[pos - 1]]
        cur = balance_at[day]
        flow = flow_at.get(day, 0.0)
        if prev == 0.0:
            # No usable denominator — honest break, never a fabricated return.
            returns_vals.append(float("nan"))
            equity_vals.append(equity_vals[-1])
            continue
        r = (cur - prev - flow) / prev
        returns_vals.append(r)
        equity_vals.append(equity_vals[-1] * (1.0 + r))
        running = cur

    _ = running
    return {
        "balance_eod": balance_eod,
        "flows": flows,
        "returns": pd.Series(returns_vals, index=idx, name="returns"),
        "equity": pd.Series(equity_vals, index=idx, name="equity"),
        "inception_capital": inception,
        "cashflow_event_days": sorted(event_days),
    }


# ---------------------------------------------------------------------------
# The cross-stream parity check (has BOTH streams — never conflate with the
# transactions-only oracle above).
# ---------------------------------------------------------------------------
def check_parity(
    balance_rows: list[dict],
    transactions: list[dict],
) -> dict[str, Any]:
    """Validate the reconstructed balance-history curve against the independent
    transactions oracle and build the sanitized-ready evidence dict.

    RAISES ``ParityDivergenceError`` (→ exit 1) on a MATERIAL divergence that is
    NOT explained by the A2 cash-vs-MTM interpretation ambiguity — the wrong
    curve must never be displayed. Where the divergence IS the A2 cash-only
    signature (``account_balance`` piecewise-constant between cashflow events),
    at least one interpretation reconciles → the evidence is FLAGGED
    ``requires_founder_decision`` and the run exits 0 (surfaced, never guessed).
    """
    usd_value = _rows_to_usd_value_series(balance_rows)
    # The flow extractor runs for real (its own fail-loud path on an unvaluable
    # flow propagates — a mis-valued flow silently corrupts the TWR).
    flows_ut, _flow_evidence = sfox_flows_by_day(transactions)
    returns_ut, meta_ut = combine_sfox_balance_history(usd_value, flows_ut)

    oracle = reconstruct_equity_from_transactions(transactions)
    balance_eod: pd.Series = oracle["balance_eod"]
    event_days: set[str] = set(oracle["cashflow_event_days"])

    # Common observed days across the two INDEPENDENT streams.
    common = usd_value.index.intersection(balance_eod.index)
    v = usd_value.reindex(common).sort_index()
    b = balance_eod.reindex(common).sort_index()
    day_iso = [pd.Timestamp(ts).date().isoformat() for ts in v.index]

    # --- cross-stream level-change residual d_t = Δusd_value - Δaccount_balance.
    material_resid_days: list[str] = []
    max_cross_residual = 0.0
    account_balance_moves_off_event = False
    for pos in range(1, len(v)):
        prev_v = float(v.iloc[pos - 1])
        dv = float(v.iloc[pos]) - prev_v
        db = float(b.iloc[pos]) - float(b.iloc[pos - 1])
        resid = dv - db
        max_cross_residual = max(max_cross_residual, abs(resid))
        if _is_material(resid, prev_v):
            material_resid_days.append(day_iso[pos])
        # Does the account_balance stream MOVE on a non-cashflow-event day? A
        # cash-only balance is piecewise-constant between cashflow events; a
        # total-MTM balance moves every day. This is the A2 discriminator.
        if day_iso[pos] not in event_days and _is_material(db, prev_v):
            account_balance_moves_off_event = True

    # --- cumulative reconciliation (normalized equity ratios over the window).
    def _ratio(series: pd.Series) -> float | None:
        if len(series) < 2 or float(series.iloc[0]) == 0.0:
            return None
        return float(series.iloc[-1]) / float(series.iloc[0])

    ratio_v = _ratio(v)
    ratio_b = _ratio(b)
    cumulative_ratio_gap = (
        abs(ratio_v - ratio_b) if ratio_v is not None and ratio_b is not None else None
    )
    cumulative_material = (
        cumulative_ratio_gap is not None and cumulative_ratio_gap > _MATERIALITY_REL
    )

    # --- A2 probe: residuals under BOTH interpretations (emit, never pick).
    total_mtm_residuals = [abs(float(v.iloc[i]) - float(b.iloc[i])) for i in range(len(v))]
    a2_total_mtm_max = max(total_mtm_residuals) if total_mtm_residuals else 0.0
    a2_total_mtm_reconciles = all(
        not _is_material(float(v.iloc[i]) - float(b.iloc[i]), float(v.iloc[i]))
        for i in range(len(v))
    )
    # cash-only: at each cashflow event the balance should step by exactly the
    # typed flow (|Δaccount_balance - F| small); emit the worst event residual.
    a2_cash_only_event_residual = 0.0
    flows_on = oracle["flows"].reindex(common).fillna(0.0)
    for pos in range(1, len(b)):
        if day_iso[pos] in event_days:
            db = float(b.iloc[pos]) - float(b.iloc[pos - 1])
            f = float(flows_on.iloc[pos])
            a2_cash_only_event_residual = max(
                a2_cash_only_event_residual, abs(db - f)
            )

    diverged = bool(material_resid_days) or cumulative_material
    cash_only_signature = (
        diverged and not account_balance_moves_off_event and len(event_days) > 0
    )
    # WR-03: a ZERO-cashflow account (no deposit/withdraw events) whose constant
    # account_balance diverges from a moving usd_value is GENUINELY AMBIGUOUS — the
    # cash-only and total-MTM interpretations are indistinguishable with no cashflow
    # event to reconcile at, so the cash-only signature (which requires
    # ``len(event_days) > 0``) never matches and the divergence would auto-raise on
    # a legitimate no-flow account. Surface it for the founder (exit 0, both residual
    # sets emitted), consistent with the event-bearing cash-only case — never
    # auto-fail. A moving account_balance (``account_balance_moves_off_event``) is
    # the total-MTM shape, which either reconciles (a2_total_mtm) or is a genuine
    # divergence that still fails loud below.
    zero_cashflow_ambiguity = (
        diverged
        and len(event_days) == 0
        and not account_balance_moves_off_event
    )
    if a2_total_mtm_reconciles:
        a2_verdict = "total_mtm_reconciles"
    elif cash_only_signature:
        a2_verdict = "cash_only_pattern_requires_founder"
    elif zero_cashflow_ambiguity:
        a2_verdict = "zero_cashflow_ambiguous_requires_founder"
    else:
        a2_verdict = "indeterminate"

    # --- A3 probe: day-0 inception residual (first balance-history anchor vs the
    # transactions-implied inception capital).
    inception_capital = oracle["inception_capital"]
    first_equity = float(usd_value.iloc[0]) if len(usd_value) else None
    a3_residual = (
        abs(first_equity - inception_capital)
        if first_equity is not None and inception_capital is not None
        else None
    )
    a3_convention_holds = (
        a3_residual is not None
        and inception_capital is not None
        and not _is_material(a3_residual, inception_capital)
    )

    requires_founder_decision = a2_verdict in (
        "cash_only_pattern_requires_founder",
        "zero_cashflow_ambiguous_requires_founder",
    )

    evidence: dict[str, Any] = {
        "run_meta": {
            "balance_history_days": int(len(usd_value)),
            "transactions_days": int(len(balance_eod)),
            "common_days": int(len(common)),
            "cashflow_event_count": int(len(event_days)),
            "materiality_rel": _MATERIALITY_REL,
            "materiality_abs": _MATERIALITY_ABS,
        },
        "parity": {
            "max_cross_stream_residual": round(max_cross_residual, 6),
            "material_divergence_days": material_resid_days,
            "cumulative_ratio_gap": (
                round(cumulative_ratio_gap, 8)
                if cumulative_ratio_gap is not None
                else None
            ),
            "under_test_status_hint": meta_ut.get("computation_status_hint"),
        },
        "a2_account_balance_semantics": {
            "total_mtm_max_residual": round(a2_total_mtm_max, 6),
            "total_mtm_reconciles": bool(a2_total_mtm_reconciles),
            "cash_only_event_max_residual": round(a2_cash_only_event_residual, 6),
            "account_balance_moves_off_event": bool(account_balance_moves_off_event),
            "verdict": a2_verdict,
        },
        "a3_inception_convention": {
            "first_balance_history_anchor": (
                round(first_equity, 6) if first_equity is not None else None
            ),
            "transactions_inception_capital": (
                round(inception_capital, 6) if inception_capital is not None else None
            ),
            "inception_residual": (
                round(a3_residual, 6) if a3_residual is not None else None
            ),
            "prev0_convention_holds": bool(a3_convention_holds),
        },
        "requires_founder_decision": bool(requires_founder_decision),
    }

    if diverged and not cash_only_signature and not zero_cashflow_ambiguity:
        # Material divergence NOT attributable to the A2 ambiguity (neither the
        # event-bearing cash-only signature nor the WR-03 zero-cashflow ambiguity)
        # — fail loud.
        raise ParityDivergenceError(
            "sFOX parity FAIL-LOUD: the reconstructed curve diverges from the "
            "independent transactions oracle beyond materiality "
            f"(max cross-stream residual={max_cross_residual:.4f}, "
            f"material days={len(material_resid_days)}, "
            f"cumulative ratio gap={cumulative_ratio_gap}). The reconstructed "
            "curve must not be displayed."
        )

    return evidence


# ---------------------------------------------------------------------------
# Read orchestration — structural read-only assertion BEFORE any fetch.
# ---------------------------------------------------------------------------
def _assert_read_only(client: Any) -> None:
    """The sFOX read-only premise is STRUCTURAL (no scope endpoint exists): the
    client must be a GET-only ``SfoxClient``. A non-SfoxClient object (a future
    write-capable adapter smuggled in) violates the premise → ``ScopeViolationError``
    (exit 2), mirroring the deribit scope gate — BEFORE any private call."""
    from services.sfox_client import SfoxClient

    if not isinstance(client, SfoxClient):
        raise ScopeViolationError(
            "FAIL-LOUD: sFOX ground-truth requires a read-only SfoxClient "
            f"(got {type(client).__name__}); a write-capable object must never "
            "reach the ground-truth reads."
        )


async def run(
    client: Any,
    *,
    start_ms: int = _DEFAULT_START_MS,
    end_ms: int | None = None,
) -> dict[str, Any]:
    """Structural read-only assert → bounded crawls of balance-history +
    transactions → parity. Raises ``ParityDivergenceError`` on material
    divergence. The caller owns the client lifecycle."""
    import time

    from services.sfox_read import (
        crawl_sfox_balance_history,
        crawl_sfox_transactions,
    )

    _assert_read_only(client)
    edge = end_ms if end_ms is not None else int(time.time() * 1000)
    balance_rows, _earliest = await crawl_sfox_balance_history(client, start_ms, edge)
    transactions = await crawl_sfox_transactions(client, start_ms, edge)
    return check_parity(balance_rows, transactions)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint. Prints ONE sanitized parity-evidence JSON to stdout on
    success. Exit codes: 0 success, 1 divergence/other (scrubbed), 2 scope
    violation, 3 missing creds."""
    import argparse
    import asyncio
    import json
    import os
    import sys

    parser = argparse.ArgumentParser(
        description="sFOX read-only ground-truth parity harness (SFOX-06)."
    )
    parser.add_argument("--start-ms", type=int, default=_DEFAULT_START_MS)
    parser.add_argument("--end-ms", type=int, default=None)
    args = parser.parse_args(argv)

    api_key = os.getenv("SFOX_GROUND_TRUTH_KEY")
    if not api_key:
        print(
            "ERROR: SFOX_GROUND_TRUTH_KEY must be set (env only; the value is "
            "never printed).",
            file=sys.stderr,
        )
        return 3
    proxy = os.getenv("SFOX_GROUND_TRUTH_PROXY") or None

    from services.sfox_client import SFOX_PROD_BASE_URL, SfoxClient

    async def _run() -> dict[str, Any]:
        client = SfoxClient(api_key=api_key, base_url=SFOX_PROD_BASE_URL, proxy=proxy)
        try:
            return await run(client, start_ms=args.start_ms, end_ms=args.end_ms)
        finally:
            await client.aclose()

    try:
        evidence = asyncio.run(_run())
    except ScopeViolationError as exc:
        # The structural premise message carries no secret — print verbatim.
        print(str(exc), file=sys.stderr)
        return 2
    except ParityDivergenceError as exc:
        # Residual magnitudes only — but scrub belt-and-braces before stderr.
        print(
            "FAIL-LOUD: " + _redact_secret_values(str(exc), api_key, proxy),
            file=sys.stderr,
        )
        return 1
    except Exception as exc:  # noqa: BLE001
        print(
            "ERROR: " + _redact_secret_values(str(exc), api_key, proxy),
            file=sys.stderr,
        )
        return 1

    clean = sanitize_evidence(evidence)
    assert_sanitized(clean)
    print(json.dumps(clean, indent=2, default=str))
    return 0


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
