"""Deribit acceptance-verification harness (v1.7 Phase 72, SC-2) — read-only.

WHY (SC-2 / D-2 acceptance anchor): P70 built the txn-log ledger backbone and
P71 wired it into the CSV daily-returns pipeline. Before an onboarded Deribit LTP
strategy is trusted as a factsheet, SC-2 requires an INDEPENDENT re-crawl of the
live exchange ledger that reconciles exchange truth against the persisted
factsheet — proving the onboarding wrote an HONEST track record, not a silently
partial one.

The D-2 acceptance anchor is COMPLETENESS + RECONCILE + SIGNS, never a fill-count
reconciliation:

  1. ledger_completeness — the fresh crawl reached ``continuation=null`` for every
     expected scope × currency (``assert_ledger_complete`` — the re-anchored D-02
     honesty gate). A truncated/dropped-scope crawl fails loud.
  2. factsheet_status   — the persisted ``strategy_analytics.computation_status``
     is a success state (``complete`` / ``complete_with_warnings``), naming any DQ
     flag (csv_source / balance_error / heuristic_capital_used).
  3. date_coverage      — the observed ledger active-date range OVERLAPS the
     expected onboarding window (anchor-to-today: the exact edges may drift, so
     overlap — not equality — is the honest bound).
  4. daily_reconcile    — the set of settlement-bearing UTC days from the FRESH
     ledger crawl equals the set of dates persisted in ``csv_daily_returns`` (no
     dropped/injected day). This is the funding→settlement reconcile surrogate:
     Deribit funding is realized INSIDE settlement ``change`` — there is NO
     separate funding stream (``services/deribit_txn.py:35-39``), so a per-day
     structural reconcile is the correct funding-inclusive check.
  5. inverse_signs      — every inverse (BTC/ETH) raw row's converted USD
     preserves the ledger ``change`` sign (D-07/D-08: sign trusted verbatim,
     converted at the row's OWN event-time index_price — never re-derived from
     position side). Pinned by the fixture unit test; see the LIVE-driver note.

The fill counts (18,778 / 21,014 / 61,248) are ADVISORY ONLY — the Wave-0
BLOCKING_FINDING proved they reconcile to NO API surface (P70), so this harness
LOGS the return-row count and NEVER gates on it.

READ-ONLY by construction (zero INSERT/UPDATE/UPSERT/DELETE): it re-crawls the
exchange and SELECTs the persisted rows, then prints a per-account PASS/FAIL
report. Runs later via ``railway ssh`` (orchestrator-only — executor subagents
have no railway auth / Supabase MCP), mirroring ``scripts/bybit_reconcile.py``.

USAGE
-----
  railway ssh "cd /app && python -m scripts.deribit_acceptance \\
    --account <strategy_uuid>:1:LTP056:2025-08-01:2025-09-30 \\
    --account <strategy_uuid>:2:LTP072:2025-08-01:2025-09-30"
  # or, equivalently, a JSON config of the same fields:
  railway ssh "cd /app && python -m scripts.deribit_acceptance --config accounts.json"

Per account the ``KEY_INDEX`` selects the read-only creds env pair
``DERIBIT_CLIENT_ID_{N}`` / ``DERIBIT_CLIENT_SECRET_{N}`` (never printed).

EXIT CODES
----------
  0  every account passed every gate check.
  1  at least one gate check FAILED (fail loud — the factsheet is not accepted).
  2  usage / env error (missing SUPABASE_URL / SUPABASE_SERVICE_KEY / creds; no
     secrets printed on any path).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from services.deribit_ingest import (
    LedgerCompletenessError,
    _crawl_deribit_ledger,
    assert_ledger_complete,
    build_deribit_native_ledger,
)
from services.deribit_txn import (
    _INVERSE_CURRENCIES,
    _NATIVE_OPTIONS_SUMMARY_TYPES,
    classify_instrument,
    txn_change_to_usd,
)

# Cap on how many symmetric-difference dates / sign-mismatch rows a Check detail
# names — enough to triage, bounded so a wholesale mismatch cannot flood the log.
_MAX_NAMED = 10

# Persisted factsheet states that count as a successful computation.
_OK_STATUSES: frozenset[str] = frozenset({"complete", "complete_with_warnings"})

# DQ flags worth surfacing in the factsheet-status detail (advisory context — a
# success state with a flag still passes; the flag is named, never gated on).
_NAMED_DQ_FLAGS: tuple[str, ...] = (
    "csv_source",
    "balance_error",
    "heuristic_capital_used",
)


# ===========================================================================
# PURE CORE — dataclasses + pure check functions. NO network, NO Supabase.
# Every check returns a Check and fails LOUD with a naming detail (Rule 12).
# ===========================================================================


@dataclass(frozen=True)
class Check:
    """One acceptance gate result: a stable name, a pass/fail, a naming detail."""

    name: str
    passed: bool
    detail: str


@dataclass
class AccountAcceptance:
    """The per-account verdict: gate ``checks`` (all must pass) plus ``advisory``
    context that is LOGGED but never gated (e.g. the return/fill counts, which
    reconcile to no API surface — P70)."""

    strategy_id: str
    label: str
    checks: list[Check]
    advisory: dict[str, object] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)


def _sign(value: float) -> int:
    """Signum: +1 / -1 / 0 (0.0 maps to 0)."""
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _fmt_dates(dates: Sequence[date]) -> str:
    """Comma-join up to ``_MAX_NAMED`` ISO dates, marking any overflow."""
    shown = [d.isoformat() for d in dates[:_MAX_NAMED]]
    if len(dates) > _MAX_NAMED:
        shown.append(f"... (+{len(dates) - _MAX_NAMED} more)")
    return ", ".join(shown)


def check_factsheet_status(
    computation_status: str, data_quality_flags: Mapping[str, Any]
) -> Check:
    """Pass iff the persisted computation_status is a success state. Names the
    status and any csv_source / balance_error / heuristic_capital_used DQ flag
    present — a ``failed`` / ``pending`` / ``computing`` factsheet fails loud."""
    status = str(computation_status or "")
    present = {
        flag: data_quality_flags.get(flag)
        for flag in _NAMED_DQ_FLAGS
        if data_quality_flags.get(flag) is not None
    }
    flag_detail = f"; dq_flags={present}" if present else ""
    passed = status in _OK_STATUSES
    if passed:
        detail = f"computation_status={status!r}{flag_detail}"
    else:
        detail = (
            f"computation_status={status!r} is not a success state "
            f"{sorted(_OK_STATUSES)}{flag_detail}"
        )
    return Check("factsheet_status", passed, detail)


def check_date_coverage(
    active_dates: Sequence[date], window_start: date, window_end: date
) -> Check:
    """Pass iff the observed ledger active-date range OVERLAPS the expected
    onboarding window (``min(active) <= window_end AND max(active) >=
    window_start``). Empty active_dates fails loud — a factsheet with no observed
    ledger day cannot cover any window."""
    if not active_dates:
        return Check(
            "date_coverage",
            False,
            "no active ledger dates observed; expected coverage overlapping "
            f"[{window_start}..{window_end}]",
        )
    lo = min(active_dates)
    hi = max(active_dates)
    overlaps = lo <= window_end and hi >= window_start
    detail = f"observed [{lo}..{hi}] vs expected [{window_start}..{window_end}]"
    if not overlaps:
        detail = "DISJOINT: " + detail
    return Check("date_coverage", overlaps, detail)


def check_daily_reconcile(
    ledger_nonzero_dates: set[date],
    persisted_nonzero_dates: set[date],
    *,
    zero_day_delta: int = 0,
) -> Check:
    """Funding→settlement reconcile GATED on the NONZERO-P&L days — the days that
    carry real realized cash. These must match EXACTLY between the fresh ledger
    crawl and the persisted ``csv_daily_returns``. Deribit funding is realized
    inside settlement ``change`` (no separate funding stream —
    ``services/deribit_txn.py:35-39``), so per-nonzero-day equality is the correct
    funding-inclusive reconcile.

    ``zero_day_delta`` = the count of ZERO-value days that differ between the two
    crawls. Zero-cash days are emitted for a settlement/fee day that nets to 0.0;
    which quiet zero-days a crawl emits varies harmlessly across crawl generations
    (`end_ms=now` boundary, pagination) and carries NO P&L. So a zero-day set
    difference is reported ADVISORY-ONLY, never gates — matching the D-2 anchor
    (real cash reconciliation), not cosmetic bookkeeping. Names the nonzero
    symmetric-difference dates."""
    dropped = sorted(ledger_nonzero_dates - persisted_nonzero_dates)
    injected = sorted(persisted_nonzero_dates - ledger_nonzero_dates)
    zero_note = (
        f" [{zero_day_delta} cosmetic zero-value day(s) differ — advisory, not gated]"
        if zero_day_delta
        else ""
    )
    if not dropped and not injected:
        return Check(
            "daily_reconcile",
            True,
            f"{len(ledger_nonzero_dates)} nonzero-P&L day(s) reconcile exactly"
            + zero_note,
        )
    parts: list[str] = []
    if dropped:
        parts.append(
            f"{len(dropped)} nonzero day(s) in fresh ledger but NOT persisted "
            f"(dropped): {_fmt_dates(dropped)}"
        )
    if injected:
        parts.append(
            f"{len(injected)} nonzero day(s) persisted but NOT in fresh ledger "
            f"(injected): {_fmt_dates(injected)}"
        )
    return Check("daily_reconcile", False, "; ".join(parts) + zero_note)


def check_perp_only_eligibility(rows: Sequence[Mapping[str, Any]]) -> Check:
    """Phase 82 SC-4 eligibility gate for a byte-identity CONTROL key: a key used
    to prove perp-only factsheets are UNCHANGED post-options-fix must carry ZERO
    historical option ``trade``/``delivery`` rows AND ZERO
    ``options_settlement_summary`` rows over full history.

    A key that ever traded ONE option carries summary/delivery rows whose native
    P&L LEGITIMATELY changes post-fix (coverage-gated re-attribution) — using it
    as a byte-identity control would be a FALSE red. This check counts both and
    passes iff 0/0, naming the counts so the Task-7 run log records eligibility
    per key BEFORE the byte-identity comparison is trusted."""
    option_rows = 0
    summary_rows = 0
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", ""))
        if row_type in _NATIVE_OPTIONS_SUMMARY_TYPES:
            summary_rows += 1
        elif row_type in ("trade", "delivery"):
            if classify_instrument(str(row.get("instrument_name", ""))) == "option":
                option_rows += 1
    if option_rows == 0 and summary_rows == 0:
        return Check(
            "perp_only_eligibility",
            True,
            "0 option trade/delivery rows, 0 options_settlement_summary rows — "
            "eligible as a byte-identity control key",
        )
    return Check(
        "perp_only_eligibility",
        False,
        f"{option_rows} option trade/delivery row(s) and {summary_rows} "
        "options_settlement_summary row(s) present — this key's native P&L "
        "LEGITIMATELY moves post-fix (coverage-gated re-attribution); it is NOT a "
        "valid byte-identity control (Task 4 plan-check finding)",
    )


def check_inverse_signs(rows: Sequence[Mapping[str, Any]]) -> Check:
    """For every raw txn row whose currency is inverse (BTC/ETH), assert that its
    converted USD preserves the ledger ``change`` sign — pinning D-07/D-08: the
    ``change`` sign is trusted verbatim and the coin delta is valued at the row's
    OWN event-time index_price (never re-derived from position side). An inverse
    row that cannot be converted (no event-time index and no same-day fallback)
    is itself a fail — an unverifiable sign is not a trusted one. No inverse rows
    present → pass with ``"no inverse rows"``."""
    inverse_rows = [
        row
        for row in rows
        if str(row.get("currency", "")).upper() in _INVERSE_CURRENCIES
    ]
    if not inverse_rows:
        return Check("inverse_signs", True, "no inverse rows")
    mismatches: list[str] = []
    for row in inverse_rows:
        change = float(row.get("change", 0.0) or 0.0)
        try:
            usd = txn_change_to_usd(row)
        except ValueError as exc:
            mismatches.append(f"id={row.get('id')!r}: unconvertible inverse row ({exc})")
            continue
        if _sign(usd) != _sign(change):
            mismatches.append(
                f"id={row.get('id')!r}: change sign {_sign(change)} "
                f"but converted USD sign {_sign(usd)} (change={change}, usd={usd})"
            )
    if mismatches:
        capped = mismatches[:_MAX_NAMED]
        overflow = (
            f" ... (+{len(mismatches) - _MAX_NAMED} more)"
            if len(mismatches) > _MAX_NAMED
            else ""
        )
        return Check(
            "inverse_signs",
            False,
            f"{len(mismatches)}/{len(inverse_rows)} inverse row(s) failed the "
            f"sign invariant: " + "; ".join(capped) + overflow,
        )
    return Check(
        "inverse_signs",
        True,
        f"{len(inverse_rows)} inverse row(s), all signs preserved",
    )


def summarize_fills(total_return_rows: int) -> dict[str, object]:
    """ADVISORY return-row count. The literal LTP fill totals (18,778 / 21,014 /
    61,248) reconcile to NO API surface (P70 BLOCKING_FINDING), so this is logged,
    NEVER a gate."""
    return {"return_rows": int(total_return_rows)}


# ===========================================================================
# THIN LIVE DRIVER — argparse + exchange re-crawl + Supabase read. Not unit-
# tested beyond a smoke import of the pure functions above.
# ===========================================================================


@dataclass(frozen=True)
class AccountSpec:
    """One account to verify: onboarded strategy + creds index + expected
    window."""

    strategy_id: str
    key_index: int
    label: str
    window_start: date
    window_end: date


def _parse_account_spec(raw: str) -> AccountSpec:
    """Parse ``STRATEGY_ID:KEY_INDEX:LABEL:WINDOW_START:WINDOW_END`` (UUID, label,
    and ISO dates carry no colons, so a plain 5-way split is unambiguous)."""
    parts = raw.split(":")
    if len(parts) != 5:
        raise ValueError(
            "--account must be STRATEGY_ID:KEY_INDEX:LABEL:WINDOW_START:"
            f"WINDOW_END (5 colon-separated fields), got {raw!r}"
        )
    sid, idx, label, start, end = parts
    return AccountSpec(
        strategy_id=sid,
        key_index=int(idx),
        label=label,
        window_start=date.fromisoformat(start),
        window_end=date.fromisoformat(end),
    )


def _load_account_specs(args: argparse.Namespace) -> list[AccountSpec]:
    """Build the account list from ``--account`` tuples or a ``--config`` JSON
    array of ``{strategy_id, key_index, label, window_start, window_end}``."""
    specs: list[AccountSpec] = []
    if args.config:
        with open(args.config, encoding="utf-8") as fh:
            entries = json.load(fh)
        for entry in entries:
            specs.append(
                AccountSpec(
                    strategy_id=str(entry["strategy_id"]),
                    key_index=int(entry["key_index"]),
                    label=str(entry["label"]),
                    window_start=date.fromisoformat(str(entry["window_start"])),
                    window_end=date.fromisoformat(str(entry["window_end"])),
                )
            )
    for raw in args.account or []:
        specs.append(_parse_account_spec(raw))
    return specs


def _build_deribit_exchange(key_index: int) -> Any:
    """Build an async ccxt Deribit exchange from the read-only creds env pair for
    ``key_index`` — mirrors ``services.exchange.create_exchange`` (async_support,
    apiKey/secret, enableRateLimit) exactly. The secret is passed to ccxt only,
    never printed."""
    from services.exchange import create_exchange

    client_id = os.getenv(f"DERIBIT_CLIENT_ID_{key_index}", "")
    client_secret = os.getenv(f"DERIBIT_CLIENT_SECRET_{key_index}", "")
    if not client_id or not client_secret:
        raise RuntimeError(
            f"DERIBIT_CLIENT_ID_{key_index} and DERIBIT_CLIENT_SECRET_{key_index} "
            "are required"
        )
    return create_exchange("deribit", client_id, client_secret)


def _records_active_dates(records: Sequence[Mapping[str, Any]]) -> list[date]:
    """The sorted set of UTC calendar days present in the daily_pnl records
    (their ``timestamp`` is ISO8601 UTC at 00:00:00 — see
    ``txn_rows_to_daily_records``)."""
    days = {
        date.fromisoformat(str(rec["timestamp"])[:10])
        for rec in records
        if rec.get("timestamp")
    }
    return sorted(days)


def _records_dates_by_value(
    records: Sequence[Mapping[str, Any]],
) -> tuple[set[date], set[date]]:
    """Split the daily_pnl record days into ``(nonzero_days, zero_days)`` by their
    ``price`` (abs USD magnitude; 0.0 = a settlement/fee day that netted to zero).
    Nonzero days are the real realized-cash days the reconcile gates on; zero days
    are cosmetic and reconciled advisory-only."""
    nonzero: set[date] = set()
    zero: set[date] = set()
    for rec in records:
        ts = rec.get("timestamp")
        if not ts:
            continue
        day = date.fromisoformat(str(ts)[:10])
        (nonzero if float(rec.get("price", 0.0) or 0.0) != 0.0 else zero).add(day)
    # A day with both a nonzero and a (separate) zero record counts as nonzero.
    return nonzero, zero - nonzero


def _ledger_nonzero_dates(native_ledger: Any) -> set[date]:
    """The fresh nonzero-P&L UTC-day set under the FULL production ledger — the
    cash + daily-MTM ``native_pnl`` that ``job_worker`` persists to
    ``csv_daily_returns`` via ``build_deribit_native_ledger``
    (``services/deribit_ingest.py``). A day is nonzero iff ANY currency's native
    pnl for that day is nonzero.

    Supersedes the pre-Phase-83 CASH-ONLY basis (``txn_rows_to_native_daily``,
    Phase-83 C2): Phase 83 REDISTRIBUTES option session P&L across held days via the
    ΔMTM channel, which the adapter merges into ``native_pnl`` (NOT
    ``txn_rows_to_native_daily``). An interior held day where the option book moved
    (ΔMTM) but NO cash row landed is a real persisted nonzero day; the cash-only
    basis omitted it, so ``check_daily_reconcile`` "inject"-failed a CORRECT
    held-options ledger (e.g. Phoenix, whose options carry interior held days
    between open and expiry). This basis is exactly what production persists —
    the money gates (balance-identity guard + §5 closure) are untouched."""
    out: set[date] = set()
    for series in native_ledger.native_pnl.values():
        for ts, value in series.items():
            if float(value) != 0.0:
                out.add(ts.date())
    return out


def _load_persisted(
    supabase: Any, strategy_id: str
) -> tuple[str, dict[str, Any], set[date], set[date]]:
    """Read the persisted factsheet state for ``strategy_id``:
    ``(computation_status, data_quality_flags, nonzero_csv_dates, zero_csv_dates)``
    — the csv dates split by ``daily_return`` so the reconcile gates on the
    real realized-cash (nonzero) days and treats zero days advisory-only."""
    from services.db import paginated_select, rows

    sa = rows(
        supabase.table("strategy_analytics")
        .select("computation_status, data_quality_flags")
        .eq("strategy_id", strategy_id)
        .execute()
    )
    status = str(sa[0].get("computation_status", "")) if sa else ""
    raw_flags = sa[0].get("data_quality_flags") if sa else None
    flags: dict[str, Any] = raw_flags if isinstance(raw_flags, dict) else {}

    daily = paginated_select(
        supabase.table("csv_daily_returns")
        .select("date, daily_return")
        .eq("strategy_id", strategy_id),
        order_by=(("date", False),),
        truncation_hint=f"deribit_acceptance csv_daily_returns sid={strategy_id}",
    )
    nonzero: set[date] = set()
    zero: set[date] = set()
    for r in daily:
        if not r.get("date"):
            continue
        day = date.fromisoformat(str(r["date"])[:10])
        (nonzero if float(r.get("daily_return", 0.0) or 0.0) != 0.0 else zero).add(day)
    return status, flags, nonzero, zero


async def verify_account(spec: AccountSpec, supabase: Any) -> AccountAcceptance:
    """Re-crawl the live ledger for one account and assemble its acceptance."""
    from services.exchange import aclose_exchange

    checks: list[Check] = []
    exchange = _build_deribit_exchange(spec.key_index)
    try:
        # Task 5: crawl ONCE via the shared producer so the fresh basis is derived
        # over the SAME raw rows two ways — the NATIVE production formula
        # (txn_rows_to_native_daily, the daily_reconcile money gate) and the legacy
        # USD daily_pnl records (kept for the advisory fills / date-coverage basis).
        records, raw_rows, _indexable, completeness = await _crawl_deribit_ledger(
            exchange, None
        )
        # Phase 83 C2: the daily_reconcile basis MUST be the FULL production ledger
        # (cash + daily-MTM), NOT the cash-only channel — an interior held day where
        # the option book moved (ΔMTM) with no cash row is a real persisted nonzero
        # day. Re-crawl via the production adapter so the harness gates on exactly
        # what job_worker persists. (Second crawl of the same immutable txn-log; an
        # offline acceptance script — correctness over the extra round-trip.)
        native_ledger, _ledger_report = await build_deribit_native_ledger(
            exchange, None
        )
    finally:
        await aclose_exchange(exchange)

    # 1. Ledger completeness — the re-anchored D-02 honesty gate.
    try:
        assert_ledger_complete(completeness)
        checks.append(
            Check(
                "ledger_completeness",
                True,
                "every expected scope×currency reached continuation=null",
            )
        )
    except LedgerCompletenessError as exc:
        checks.append(Check("ledger_completeness", False, str(exc)))

    active_dates = _records_active_dates(records)
    # Task 5 + Phase 83 C2: the gated nonzero-P&L days come from the FULL production
    # ledger (cash + daily-MTM — exactly what job_worker persists), NOT the cash-only
    # channel and NOT the legacy USD daily_pnl records production no longer runs. The
    # USD records still supply the ADVISORY cosmetic zero-day basis.
    ledger_nonzero = _ledger_nonzero_dates(native_ledger)
    _usd_nonzero, ledger_zero = _records_dates_by_value(records)
    status, flags, persisted_nonzero, persisted_zero = _load_persisted(
        supabase, spec.strategy_id
    )
    zero_day_delta = len(ledger_zero ^ persisted_zero)

    # 2-4. Factsheet status, date coverage, daily reconcile (gated on nonzero
    # realized-cash days; cosmetic zero-day differences are advisory-only).
    checks.append(check_factsheet_status(status, flags))
    checks.append(
        check_date_coverage(active_dates, spec.window_start, spec.window_end)
    )
    checks.append(
        check_daily_reconcile(
            ledger_nonzero, persisted_nonzero, zero_day_delta=zero_day_delta
        )
    )

    # 5. Inverse signs — Task 5 now crawls via _crawl_deribit_ledger, which
    # EXPOSES the raw currency+change rows (no re-implementation), so the
    # D-07/D-08 sign invariant runs LIVE against the real txn_change_to_usd rather
    # than only in the fixture unit test.
    checks.append(check_inverse_signs(raw_rows))

    # 6. Perp-only eligibility (Phase 82 SC-4): a byte-identity control key must
    # carry ZERO option/summary rows; record it as ADVISORY so an options account
    # is not gate-failed here (it legitimately moves), while a key intended as a
    # perp-only control surfaces its eligibility in the run log.
    advisory: dict[str, object] = summarize_fills(completeness.total_return_rows)
    _eligibility = check_perp_only_eligibility(raw_rows)
    advisory["perp_only_eligibility"] = _eligibility.detail
    advisory["net_external_flow_usd"] = completeness.net_external_flow_usd
    advisory["saw_unvalued_inverse_flow"] = completeness.saw_unvalued_inverse_flow

    return AccountAcceptance(
        strategy_id=spec.strategy_id,
        label=spec.label,
        checks=checks,
        advisory=advisory,
    )


def _format_report(acc: AccountAcceptance) -> str:
    """Render a per-account PASS/FAIL report table."""
    verdict = "PASS" if acc.passed else "FAIL"
    lines = [
        f"=== {acc.label} ({acc.strategy_id}) — {verdict} ===",
    ]
    for chk in acc.checks:
        mark = "PASS" if chk.passed else "FAIL"
        lines.append(f"  [{mark}] {chk.name}: {chk.detail}")
    lines.append(f"  advisory: {acc.advisory}")
    return "\n".join(lines)


async def _run(specs: Sequence[AccountSpec], supabase: Any) -> int:
    """Verify every account sequentially; return the process exit code."""
    all_passed = True
    for spec in specs:
        acc = await verify_account(spec, supabase)
        print(_format_report(acc))
        all_passed = all_passed and acc.passed
    return 0 if all_passed else 1


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deribit acceptance-verification harness (SC-2)."
    )
    parser.add_argument(
        "--account",
        action="append",
        metavar="STRATEGY_ID:KEY_INDEX:LABEL:WINDOW_START:WINDOW_END",
        help="Repeatable. e.g. <uuid>:1:LTP056:2025-08-01:2025-09-30",
    )
    parser.add_argument(
        "--config",
        metavar="PATH",
        help="JSON array of {strategy_id,key_index,label,window_start,window_end}.",
    )
    args = parser.parse_args()

    try:
        specs = _load_account_specs(args)
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: bad account spec: {exc}", file=sys.stderr)
        sys.exit(2)
    if not specs:
        print("ERROR: no accounts given (use --account or --config).", file=sys.stderr)
        sys.exit(2)

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print(
            "ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY are required.",
            file=sys.stderr,
        )
        sys.exit(2)

    from supabase import create_client

    supabase = create_client(url, key)
    sys.exit(asyncio.run(_run(specs, supabase)))


if __name__ == "__main__":
    main()
