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

Phase 179 OKXBILLSCHAIN additions, all additive and default-off so every Phase 172 caller is
untouched:

- ``okx_bill`` takes ``sub_type``, ``mgn_mode`` and ``pos_bal_chg`` and ``okx_detail`` takes
  ``u_time``; the venue key is added only when the value is given.
- ``okx_bills_updated_in_order`` builds bills whose ``bal`` chain holds in the GIVEN list
  order (the balance-update order), with explicit ids and timestamps, so a test can make
  ``billId`` order or ``ts`` order disagree with it (ties, inversions).
- ``OkxBalanceSequence`` answers the balance GET differently per call (before and after a walk).
- ``okx_subtypes_payload`` is the ``/account/subtypes`` reply, nested or flat.
- ``OkxBillsArchive`` honours a ``type`` and an ``instType`` query parameter and can hide a
  type from a query that does not name it (``hide_type``).

Phase 184 WALLETOFFSET addition, additive and default-off like the ones above:

- ``okx_bill`` takes ``pnl`` and ``fee``; a bill carries each key only when the value is given,
  so the bills the P&L probe sums can be built without touching any earlier caller.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
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
    sub_type: str = "",
    mgn_mode: str = "",
    pos_bal_chg: str = "",
    pnl: str = "",
    fee: str = "",
) -> dict[str, str]:
    """One bill with the OKX v5 field names the oracle reads, every value a string.

    ``subType``, ``mgnMode`` and ``posBalChg`` are present only when given."""
    bill = {
        "billId": str(bill_id),
        "ts": str(ts),
        "ccy": ccy,
        "bal": bal,
        "balChg": bal_chg,
        "type": bill_type,
        "instType": inst_type,
    }
    for key, value in (("subType", sub_type), ("mgnMode", mgn_mode), ("posBalChg", pos_bal_chg)):
        if value:
            bill[key] = value
    # Phase 184: the ``pnl`` and ``fee`` keys are set only when given, so no earlier bill changes.
    for key, value in (("pnl", pnl), ("fee", fee)):
        if value:
            bill[key] = value
    return bill


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


def okx_bills_updated_in_order(
    ccy: str,
    opening: str,
    changes: Sequence[str],
    *,
    ids: Sequence[int],
    stamps: Sequence[int],
    bill_type: str = "2",
    inst_type: str = "SPOT",
) -> list[dict[str, str]]:
    """Bills whose ``bal`` chain holds in the order GIVEN (the balance-update order).

    Unlike ``okx_bill_chain`` the ids and timestamps are explicit, so a test can hand in ids
    or stamps that disagree with the update order: a tie on one stamp, or a pair whose ``billId``
    order is the reverse of the order the balance was updated in. The running balance is a
    ``Decimal`` so the chain has no float residue.
    """
    assert len(ids) == len(stamps) == len(changes)
    running = Decimal(opening)
    out: list[dict[str, str]] = []
    for bill_id, stamp, change in zip(ids, stamps, changes):
        running += Decimal(change)
        out.append(
            okx_bill(
                bill_id, stamp, ccy, format(running, "f"), change, bill_type=bill_type, inst_type=inst_type
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
    u_time: str | None = None,
) -> dict[str, str]:
    """One ``details[]`` entry of the balance reply (``eq`` defaults to the cash balance).

    ``uTime`` is present only when given."""
    detail = {
        "ccy": ccy,
        "cashBal": cash_bal,
        "eq": cash_bal if eq is None else eq,
        "eqUsd": eq_usd,
        "stgyEq": stgy_eq,
        "upl": upl,
    }
    if u_time is not None:
        detail["uTime"] = u_time
    return detail


def okx_balance_payload(
    total_eq: str, details: Iterable[dict[str, str]], *, upl: str = "0"
) -> dict[str, Any]:
    """The raw ``private_get_account_balance`` reply."""
    return {
        "code": "0",
        "data": [{"totalEq": total_eq, "upl": upl, "details": list(details)}],
    }


class OkxBalanceSequence:
    """An async callable answering the balance GET differently on each call.

    ``await seq()`` returns the i-th payload on the i-th call and repeats the last one, so a
    test can give the read before a walk and the read after it different cash balances.
    ``calls`` counts the reads."""

    def __init__(self, payloads: Sequence[Any]) -> None:
        assert payloads, "a sequence needs at least one payload"
        self.payloads = list(payloads)
        self.calls = 0

    async def __call__(self, params: dict[str, str] | None = None) -> Any:
        payload = self.payloads[min(self.calls, len(self.payloads) - 1)]
        self.calls += 1
        return payload


def okx_subtypes_payload(types: Mapping[str, Sequence[str]], *, flat: bool = False) -> dict[str, Any]:
    """The raw ``GET /api/v5/account/subtypes`` reply for ``{type: [subType, ...]}``.

    Nested (the live shape): one entry per type with ``subTypeDetails`` of
    ``{subType, subTypeDesc}``. ``flat=True``: one ``{type, subType}`` entry per pair, the
    other shape the job's parser accepts. An empty mapping gives an empty data list."""
    data: list[dict[str, Any]] = []
    for bill_type, sub_types in types.items():
        if flat:
            data.extend({"type": bill_type, "subType": sub} for sub in sub_types)
        else:
            data.append(
                {
                    "type": bill_type,
                    "typeDesc": f"synthetic type {bill_type}",
                    "subTypeDetails": [
                        {"subType": sub, "subTypeDesc": f"synthetic subtype {sub}"} for sub in sub_types
                    ],
                }
            )
    return {"code": "0", "data": data}


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

    Phase 179: a ``type`` or ``instType`` parameter keeps only the rows whose field equals it,
    and ``hide_type`` models a venue whose unfiltered query omits some types: a hidden type is
    served only to a query that names it with ``type=``.
    """

    def __init__(
        self,
        rows: Iterable[dict[str, str]],
        *,
        ignore_after: bool = False,
        empty_after_cursor: bool = False,
        oldest_first: bool = False,
        oldest_first_with_begin: bool = False,
        hide_type: frozenset[str] = frozenset(),
    ) -> None:
        self.hide_type = hide_type
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
        if "type" in params:
            rows = [r for r in rows if r["type"] == params["type"]]
        else:
            rows = [r for r in rows if r["type"] not in self.hide_type]
        if "instType" in params:
            rows = [r for r in rows if r["instType"] == params["instType"]]
        if "after" in params and not self.ignore_after:
            rows = [r for r in rows if int(r["billId"]) < int(params["after"])]
        if "after" in params and self.empty_after_cursor:
            rows = []
        ascending = self.oldest_first or (self.oldest_first_with_begin and "begin" in params)
        rows = sorted(rows, key=lambda r: int(r["billId"]), reverse=not ascending)
        limit = int(params.get("limit", "100"))
        return {"code": "0", "data": [dict(r) for r in rows[:limit]]}
