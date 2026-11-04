"""The Bybit flow read for the allocator history rebuild: money crossing the Unified wallet's edge.

WHY (Phase 180 D-01, founder 2026-10-28, "Unified edge (Recommended)"): "The rebuild's Bybit flow
source is `GET /v5/account/transaction-log` with `accountType=UNIFIED`, types `TRANSFER_IN` and
`TRANSFER_OUT` (7-day max window, 50-row page, `nextPageCursor`, documented depth 2 years)."
The reason, verbatim: the rebuild anchors on the Unified account only (`_read_bybit_uta_mark`,
`services/equity_reconstruction.py`; `allocator_positions.py` prefers the UNIFIED row), so the
flows that move its balance are those crossing the Unified edge; this cannot double-count a
deposit to FUND plus its FUND-to-UNIFIED move.

The rebuild must use these rows INSTEAD of the on-chain deposit and withdrawal reads, never beside
them: an on-chain deposit to FUND plus the FUND-to-UNIFIED move would otherwise count twice.

Vendor facts (`GET /v5/account/transaction-log`, read 2026-10-28): `accountType` "UNIFIED"; `type`
is ONE value per request; `startTime` / `endTime` in ms, "If both are given, the span can be at most
7 days"; `limit` 1 to 50; `cursor` is the previous `nextPageCursor`; "The endpoint supports up to 2
years of data". No sort order is documented. A row carries `id`, `type`, `currency`,
`transactionTime` (string ms), `change` ("cashFlow + funding - fee"), `cashFlow`, and `""` in the
numeric fields it does not use (`"funding": ""` on a transfer row). The sign of a transfer row is
not documented, so the direction comes from the REQUESTED type and `amount` is the absolute value.

Output rows carry exactly `id` (str), `type` (`deposit` or `withdrawal`), `currency` (upper case),
`amount` (a finite float), `timestamp` (int ms) and `fee` (None): the shape the replay reads. There
is never a key named `kind` (the replay builds its events as `{"kind": "deposit", **row}`, so a
`kind` key on the row would overwrite the event kind) and never the raw `info`.

WR-04 discipline: this module never swallows a venue exception. Every one propagates as the same
object; the forced refusal for the permanent classes is decided by the caller. It never returns a
short list: a malformed answer, an unreadable row, a row of another type, a cursor that does not
advance on a page that returned rows, and a window past `UNIFIED_FLOW_PAGE_CAP` each raise
`BybitUnifiedFlowReadError`. An empty page ends its window naturally.

Scope: since Phase 186 (D-02, founder 2026-11-01) the per-key derive reads this for Bybit; the
archive job and the composite (unless 186-04 recorded `q-composite: include`) keep their kinds.

Limitation (orchestrator reading 3, an orchestrator reading and not a founder decision):
`UNIFIED_FLOW_TYPES` is `TRANSFER_IN` and `TRANSFER_OUT` only. Earn, staking, bonus-transfer and PEF
types are not flows in this phase. By D-01's own edge logic an Earn subscription is a flow out of the Unified wallet, so an account
that used Earn gets a replay whose level is off by the staked amount while it is staked; the anchor offset spreads that difference, and
the 5x implausibility bound is the only backstop. Each further type would cost about 105 more requests over two years,
and the type list grows over time; the probe's census (`scripts/bybit_funding_record.py`) counts
the candidates so the founder sees whether an account used them. `UNIFIED_FLOW_TYPES` is the one
place a follow-up extends.

Pairing (Phase 186 plan 03): `pair_onchain_with_unified` is the one rule for deciding that an
on-chain deposit or withdrawal row and a Unified TRANSFER row are the same money. It is shared by
the SC-1 probe (`scripts/derivegaps_probe.py`, whose overlap count decides REPLACE against UNION
for D-02) and by any pair-aware Bybit flow source, so the two cannot drift. It is pure. Plan 186-10
implemented the source 186-04 recorded (`g2-flow-final: replace`), so the derive does not call it;
only the probe does.

Rate limiting: no `asyncio.sleep`; ccxt's `enableRateLimit` throttles raw calls by the API table's
cost.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping, Sequence
from typing import Any, Final, NamedTuple

from services.exchange_pagination import (
    PageRequest,
    PageResult,
    ProviderPaginationContract,
    walk_paginated,
)

logger = logging.getLogger("quantalyze.analytics.bybit_unified_flows")

UNIFIED_FLOW_TYPES: Final[tuple[str, ...]] = ("TRANSFER_IN", "TRANSFER_OUT")
_KIND_OF_TYPE: Final[dict[str, str]] = {
    "TRANSFER_IN": "deposit",
    "TRANSFER_OUT": "withdrawal",
}
BYBIT_LOG_PAGE_SIZE: Final[int] = 50
# Read at call time, so a test can lower it.
UNIFIED_FLOW_PAGE_CAP: int = 200


class BybitUnifiedFlowReadError(RuntimeError):
    """The Unified flow read could not be completed truthfully: a malformed answer, an unreadable
    row, a stalled cursor or the page ceiling. The text never carries venue text."""


def _refuse(log_type: str, what: str) -> BybitUnifiedFlowReadError:
    return BybitUnifiedFlowReadError(f"Bybit Unified {log_type} flow read refused: {what}")


def _amount_of(row: Mapping[str, Any], log_type: str) -> float:
    """``change``, else ``cashFlow`` (``""`` and None are absent), as a finite absolute value.
    ``funding`` is never read: a transfer row carries ``"funding": ""``."""
    for field_name in ("change", "cashFlow"):
        raw = row.get(field_name)
        if raw is None or raw == "":
            continue
        if isinstance(raw, bool):
            raise _refuse(log_type, f"{field_name} is not a number")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise _refuse(log_type, f"{field_name} is not a number") from None
        if not math.isfinite(value):
            raise _refuse(log_type, f"{field_name} is not finite")
        return abs(value)
    raise _refuse(log_type, "the row carries no change or cashFlow")


def normalise_unified_flow_row(item: Mapping[str, Any], log_type: str) -> dict[str, Any]:
    """One transaction-log row of the requested ``log_type`` as a ccxt-transfer-shaped flow.

    The direction comes ONLY from ``log_type``; the sign of the row is never read for it. An
    unreadable row refuses the whole read, a row is never dropped."""
    if not isinstance(item, Mapping):
        raise _refuse(log_type, "a row is not an object")
    if item.get("type") != log_type:
        raise _refuse(log_type, "a row of another type came back")
    row_id = item.get("id")
    if isinstance(row_id, bool) or not isinstance(row_id, (str, int)) or row_id == "":
        raise _refuse(log_type, "a row has no usable id")
    stamp = item.get("transactionTime")
    if isinstance(stamp, bool):
        raise _refuse(log_type, "a row has no usable transactionTime")
    if isinstance(stamp, int):
        stamp_ms = stamp
    elif isinstance(stamp, str) and stamp.isascii() and stamp.isdigit():
        stamp_ms = int(stamp)
    else:
        raise _refuse(log_type, "a row has no usable transactionTime")
    currency = item.get("currency")
    if not isinstance(currency, str) or not currency:
        raise _refuse(log_type, "a row has no usable currency")
    return {
        "id": str(row_id),
        "type": _KIND_OF_TYPE[log_type],
        "currency": currency.upper(),
        "amount": _amount_of(item, log_type),
        "timestamp": stamp_ms,
        "fee": None,
    }


async def fetch_bybit_unified_flows(
    exchange: Any, since_ms: int, now_ms: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Every Unified ``TRANSFER_IN`` / ``TRANSFER_OUT`` row in ``[since_ms, now_ms]``, as
    ``(deposits, withdrawals)``: 7-day windows tiled with the +1 ms boundary, 50 rows a page, every
    page by ``nextPageCursor``. Raises ``BybitUnifiedFlowReadError`` rather than return less than
    the venue holds; every venue exception propagates unchanged."""

    async def _fetch_page(req: PageRequest) -> PageResult[dict[str, Any]]:
        log_type = str(req.inst_type)
        params: dict[str, str] = {
            "accountType": "UNIFIED",
            "type": log_type,
            "limit": str(BYBIT_LOG_PAGE_SIZE),
            "startTime": str(req.window_start),
            "endTime": str(req.window_end),
        }
        if req.cursor:
            params["cursor"] = req.cursor
        try:
            answer = await exchange.private_get_v5_account_transaction_log(params)
        except Exception as exc:
            # The exception CLASS only: the venue's text is never logged here (the
            # crawl path's rule), and a scrub does not scrub free text.
            logger.warning(
                "Bybit Unified flow read failed type=%s window=[%s,%s]: exc_class=%s",
                log_type, req.window_start, req.window_end, type(exc).__name__,
            )
            raise

        if not isinstance(answer, dict):
            raise _refuse(log_type, "the answer is not an object")
        inner = answer.get("result")
        if not isinstance(inner, dict):
            raise _refuse(log_type, "the answer has no result object")
        items = inner.get("list")
        if not isinstance(items, list):
            raise _refuse(log_type, "the result has no list")
        next_cursor = inner.get("nextPageCursor")
        if next_cursor is None:
            next_cursor = ""
        if not isinstance(next_cursor, str):
            raise _refuse(log_type, "the cursor is not a string")

        rows = [normalise_unified_flow_row(item, log_type) for item in items]
        if items and next_cursor and next_cursor == req.cursor:
            raise _refuse(
                log_type,
                f"the cursor did not advance in window [{req.window_start},{req.window_end}]",
            )
        return PageResult(
            rows=rows,
            next_cursor=next_cursor,
            is_full_page=len(items) >= BYBIT_LOG_PAGE_SIZE,
            is_empty=not items,
        )

    contract = ProviderPaginationContract(
        fetcher="fetch_bybit_unified_flows",
        page_cap=UNIFIED_FLOW_PAGE_CAP,
        on_ceiling="raise",
        stop_on_short_page=False,
        stuck_cursor_is_stop=False,
        inst_types=UNIFIED_FLOW_TYPES,
        gated_inst_types=frozenset(),
        window_max_days=7,
        ceiling_exc=BybitUnifiedFlowReadError,
        ceiling_label="UNIFIED_FLOW_PAGE_CAP",
    )
    walked = await walk_paginated(
        contract, since_ms=since_ms, now_ms=now_ms, fetch_page=_fetch_page
    )

    # Windows do not overlap, so a repeated id means the venue served a row twice: count it once.
    seen: set[tuple[str, str]] = set()
    deposits: list[dict[str, Any]] = []
    withdrawals: list[dict[str, Any]] = []
    for row in walked.rows:
        key = (row["type"], row["id"])
        if key in seen:
            continue
        seen.add(key)
        (deposits if row["type"] == "deposit" else withdrawals).append(row)
    return deposits, withdrawals


#: A deposit reaches the Unified wallet within this long after it lands on chain, and a Unified
#: transfer-out reaches the chain within this long. 30 days is Bybit's own deposit-record window.
PAIRING_WINDOW_MS: Final[int] = 30 * 24 * 3600 * 1000


class FlowPairing(NamedTuple):
    """The result of pairing on-chain rows with Unified rows. ``matched_deposit_ids`` and
    ``matched_withdrawal_ids`` hold the ids of the paired on-chain rows, one set per side because a
    deposit id and a withdrawal id are different id spaces, in memory only, for a pair-aware derive.
    ``unreadable_rows`` counts rows (either side) the rule cannot read, which can pair with nothing.
    ``near_miss_rows`` counts unpaired on-chain rows that have an unused Unified row of the same
    currency inside the window whose amount differs, so zero pairs can be told apart from an
    overlap the rule could not see. A probe prints the counts and nothing else."""

    paired_deposits: int
    paired_withdrawals: int
    unpaired_onchain_deposits: int
    unpaired_onchain_withdrawals: int
    matched_deposit_ids: frozenset[str]
    matched_withdrawal_ids: frozenset[str]
    unreadable_rows: int
    near_miss_rows: int


def _pair_view(row: Mapping[str, Any]) -> tuple[str, float, int] | None:
    """(currency upper-cased, absolute amount, ms timestamp), or None when the row is unreadable.
    An unreadable row can pair with nothing; it is counted unpaired, never raised on."""
    currency = row.get("currency")
    amount = row.get("amount")
    stamp = row.get("timestamp")
    if not isinstance(currency, str) or not currency:
        return None
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount):
        return None
    if isinstance(stamp, bool) or not isinstance(stamp, int):
        return None
    return currency.upper(), abs(float(amount)), stamp


def _same_currency_fee(row: Mapping[str, Any], currency: str) -> float:
    """The row's fee when it is in ``currency`` and readable, else 0.0. A withdrawal debits the
    account ``amount + fee`` (``ccxt_flows._fee_usd``), so its Unified transfer-out may carry the fee."""
    fee = row.get("fee")
    if not isinstance(fee, Mapping):
        return 0.0
    cost = fee.get("cost")
    fee_currency = fee.get("currency")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost):
        return 0.0
    if not isinstance(fee_currency, str) or fee_currency.upper() != currency:
        return 0.0
    return abs(float(cost))


def _pair_side(
    onchain: Sequence[Mapping[str, Any]],
    unified: Sequence[Mapping[str, Any]],
    *,
    onchain_after_unified: bool,
    window_ms: int,
) -> tuple[int, set[str], int, int]:
    """A maximum-cardinality matching of the on-chain rows to the Unified rows, found by Kuhn's
    augmenting paths over the on-chain rows in time order. An on-chain row has an edge to a Unified
    row of the same currency, in range, whose amount equals its amount or, for a withdrawal with a
    same-currency fee, its amount plus the fee. A row tries its exact edges before its fee edges,
    each earliest first, so a tie between matchings of equal size prefers exact pairs. Returns the
    number paired, the ids of the paired on-chain rows (a row with no id counts as paired but has no
    id to report), the number of unreadable rows on both sides, and the number of unpaired on-chain
    rows with an unused same-currency Unified row in range whose amount differs (a near miss)."""
    unreadable = 0
    pool: list[tuple[str, float, int]] = []
    for row in unified:
        view = _pair_view(row)
        if view is None:
            unreadable += 1
        else:
            pool.append(view)
    pool.sort(key=lambda item: item[2])
    chain: list[tuple[tuple[str, float, int], Any, float]] = []
    for row in onchain:
        view = _pair_view(row)
        if view is None:
            unreadable += 1
        else:
            fee = _same_currency_fee(row, view[0]) if onchain_after_unified else 0.0
            chain.append((view, row.get("id"), fee))
    chain.sort(key=lambda item: item[0][2])

    def _edges(item: tuple[tuple[str, float, int], Any, float]) -> list[int]:
        (currency, amount, stamp), _row_id, fee = item
        in_range = [
            slot for slot, (u_currency, _u_amount, u_stamp) in enumerate(pool)
            if u_currency == currency
            and 0 <= ((stamp - u_stamp) if onchain_after_unified else (u_stamp - stamp)) <= window_ms
        ]
        wanted = [amount] if fee <= 0.0 else [amount, amount + fee]
        return [
            slot for target in wanted for slot in in_range
            if math.isclose(target, pool[slot][1], rel_tol=1e-9, abs_tol=1e-9)
        ]

    edges = [_edges(item) for item in chain]
    owner: dict[int, int] = {}

    def _augment(row_index: int, seen: set[int]) -> bool:
        for slot in edges[row_index]:
            if slot in seen:
                continue
            seen.add(slot)
            if slot not in owner or _augment(owner[slot], seen):
                owner[slot] = row_index
                return True
        return False

    for row_index in range(len(chain)):
        _augment(row_index, set())
    used = [slot in owner for slot in range(len(pool))]
    paired_rows = set(owner.values())
    paired = len(paired_rows)
    matched = {
        str(chain[i][1]) for i in paired_rows if chain[i][1] is not None
    }
    left = [item for i, item in enumerate(chain) if i not in paired_rows]
    near_miss = 0
    for (currency, _amount, stamp), _row_id, _fee in left:
        for slot, (u_currency, _u_amount, u_stamp) in enumerate(pool):
            gap = (stamp - u_stamp) if onchain_after_unified else (u_stamp - stamp)
            if not used[slot] and u_currency == currency and 0 <= gap <= window_ms:
                near_miss += 1
                break
    return paired, matched, unreadable, near_miss


def pair_onchain_with_unified(
    onchain_deposits: Sequence[Mapping[str, Any]],
    onchain_withdrawals: Sequence[Mapping[str, Any]],
    unified_deposits: Sequence[Mapping[str, Any]],
    unified_withdrawals: Sequence[Mapping[str, Any]],
    *,
    window_ms: int = PAIRING_WINDOW_MS,
) -> FlowPairing:
    """Which on-chain rows are the same money as a Unified TRANSFER row.

    Deposits: the Unified row is at or after the on-chain row and within ``window_ms`` (money lands
    on chain, then moves into Unified). Withdrawals: the on-chain row is at or after the Unified
    row and within ``window_ms`` (money leaves Unified, then leaves the venue). Equal means the
    same currency (upper-cased) and the same absolute amount to ``math.isclose`` with
    ``rel_tol=abs_tol=1e-9``; a withdrawal also pairs when the Unified amount equals its amount
    plus its same-currency fee. A maximum-cardinality matching per currency (exact amounts preferred
    on a tie); each Unified row pairs at most one on-chain row. Pure: no I/O, no logging."""
    paired_d, matched_d, unreadable_d, near_d = _pair_side(
        onchain_deposits, unified_deposits,
        onchain_after_unified=False, window_ms=window_ms,
    )
    paired_w, matched_w, unreadable_w, near_w = _pair_side(
        onchain_withdrawals, unified_withdrawals,
        onchain_after_unified=True, window_ms=window_ms,
    )
    return FlowPairing(
        paired_deposits=paired_d,
        paired_withdrawals=paired_w,
        unpaired_onchain_deposits=len(onchain_deposits) - paired_d,
        unpaired_onchain_withdrawals=len(onchain_withdrawals) - paired_w,
        matched_deposit_ids=frozenset(matched_d),
        matched_withdrawal_ids=frozenset(matched_w),
        unreadable_rows=unreadable_d + unreadable_w,
        near_miss_rows=near_d + near_w,
    )
