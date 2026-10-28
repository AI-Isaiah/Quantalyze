"""OKX raw account-balance and bills-archive fakes (Phase 172 OKXANCHOR).

A helper module, never collected as tests (no ``test_`` functions). The opening-balance
oracle reads two raw OKX v5 endpoints through ccxt's implicit methods, so its tests need
replies in the venue's own shape, not an ``AsyncMock()`` that answers every unset method
with a ``MagicMock``:

- ``GET /api/v5/account/balance``: ``{"code": "0", "data": [{"totalEq", "upl", "details": [...]}]}``.
- ``GET /api/v5/account/bills-archive``: bills newest first (by ``billId``), filtered by
  ``begin``/``end`` on ``ts`` and by ``after`` (records earlier than that bill id), at most
  ``limit`` rows (the venue's maximum is 100). Three switches model a venue that does NOT
  behave so: a walk cut short, and an oldest-first order (always, or only when ``begin`` is
  sent).

Every number is a string, as OKX sends it. Every value is synthetic.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from decimal import Decimal
from typing import Any


def okx_bill(
    bill_id: int,
    ts: int,
    ccy: str,
    bal: str,
    bal_chg: str,
    *,
    bill_type: str = "2",
    inst_type: str = "SPOT",
) -> dict[str, str]:
    """One bill with the OKX v5 field names the oracle reads, every value a string."""
    return {
        "billId": str(bill_id),
        "ts": str(ts),
        "ccy": ccy,
        "bal": bal,
        "balChg": bal_chg,
        "type": bill_type,
        "instType": inst_type,
    }


def okx_bill_chain(
    ccy: str,
    opening: str,
    changes: Sequence[str],
    *,
    first_id: int,
    first_ts: int,
    step_ms: int = 60_000,
    bill_type: str = "2",
    inst_type: str = "SPOT",
) -> list[dict[str, str]]:
    """Bills of one currency whose ``bal`` chain holds exactly.

    Each ``bal`` is the opening plus the running sum of the changes up to and including
    that bill, computed in ``Decimal`` so the chain has no float residue. Ids and
    timestamps rise together, as on the venue.
    """
    running = Decimal(opening)
    out: list[dict[str, str]] = []
    for i, change in enumerate(changes):
        running += Decimal(change)
        out.append(
            okx_bill(
                first_id + i,
                first_ts + i * step_ms,
                ccy,
                format(running, "f"),
                change,
                bill_type=bill_type,
                inst_type=inst_type,
            )
        )
    return out


def okx_detail(
    ccy: str,
    cash_bal: str,
    *,
    eq: str | None = None,
    eq_usd: str = "0",
    stgy_eq: str = "0",
    upl: str = "0",
) -> dict[str, str]:
    """One ``details[]`` entry of the balance reply (``eq`` defaults to the cash balance)."""
    return {
        "ccy": ccy,
        "cashBal": cash_bal,
        "eq": cash_bal if eq is None else eq,
        "eqUsd": eq_usd,
        "stgyEq": stgy_eq,
        "upl": upl,
    }


def okx_balance_payload(
    total_eq: str, details: Iterable[dict[str, str]], *, upl: str = "0"
) -> dict[str, Any]:
    """The raw ``private_get_account_balance`` reply."""
    return {
        "code": "0",
        "data": [{"totalEq": total_eq, "upl": upl, "details": list(details)}],
    }


class OkxBillsArchive:
    """An async callable answering like ``GET /api/v5/account/bills-archive``.

    Called as ``await archive(params)`` (the shape ccxt's implicit method takes). Rows are
    filtered by ``begin`` (``ts >= begin``) and ``end`` (``ts <= end``) when given (whether
    the venue's bounds are inclusive is undocumented; inclusive is assumed, RESEARCH A4), by
    ``after`` (``billId < after``) when given, sorted by integer ``billId`` newest first and
    cut to ``limit``. ``calls`` keeps a copy of every params dict; ``effect``, when set, is
    raised on every call. ``ignore_after=True`` makes the fake ignore the ``after`` cursor,
    which models a venue that serves the same page again (a stalled cursor).

    ``empty_after_cursor=True`` answers an empty page to every call that carries ``after``:
    the second page of a walk comes back empty, so a walk that treats the first empty page as
    the end has read only the first page. ``oldest_first=True`` serves ascending by ``billId``
    (so ``after=<page minimum>`` finds nothing); ``oldest_first_with_begin=True`` does so only
    when ``begin`` is sent, the shape a ``begin``-bounded query could take.
    """

    def __init__(
        self,
        rows: Iterable[dict[str, str]],
        *,
        ignore_after: bool = False,
        empty_after_cursor: bool = False,
        oldest_first: bool = False,
        oldest_first_with_begin: bool = False,
    ) -> None:
        self.ignore_after = ignore_after
        self.empty_after_cursor = empty_after_cursor
        self.oldest_first = oldest_first
        self.oldest_first_with_begin = oldest_first_with_begin
        self.rows: list[dict[str, str]] = [dict(r) for r in rows]
        self.calls: list[dict[str, str]] = []
        self.effect: BaseException | None = None

    async def __call__(self, params: dict[str, str]) -> dict[str, Any]:
        self.calls.append(dict(params))
        if self.effect is not None:
            raise self.effect
        rows = self.rows
        if "begin" in params:
            rows = [r for r in rows if int(r["ts"]) >= int(params["begin"])]
        if "end" in params:
            rows = [r for r in rows if int(r["ts"]) <= int(params["end"])]
        if "after" in params and not self.ignore_after:
            rows = [r for r in rows if int(r["billId"]) < int(params["after"])]
        if "after" in params and self.empty_after_cursor:
            rows = []
        ascending = self.oldest_first or (self.oldest_first_with_begin and "begin" in params)
        rows = sorted(rows, key=lambda r: int(r["billId"]), reverse=not ascending)
        limit = int(params.get("limit", "100"))
        return {"code": "0", "data": [dict(r) for r in rows[:limit]]}
