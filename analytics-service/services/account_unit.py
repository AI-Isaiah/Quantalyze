"""The ONE per-currency table of unit-sized thresholds, and the classifier that picks a row.

Phase 164.6.6.2 BTCNATIVE (D-01, D-04, D-06, D-07, D-20). An MT5 account is denominated in
its broker deposit currency. Until this phase every threshold on the MT5 path was a USD
literal ($1000 dust NAV, $100 material equity, $1.00 residual tolerance), so a 0.02 BTC
account was judged as "$0.02" and dust-guarded on every day. The thresholds now live here,
in one table, and the shared NAV/TWR engine takes them as a default-preserving keyword
(``floors=USD_FLOORS``) so every other venue is byte-identical.

Purity: stdlib + typing ONLY, and the single repo import is
``services.external_flows.USD_FAMILY`` (itself a pure leaf). This module is a LEAF: it must
never import ``job_worker``, ``mt5_read`` or any I/O module, because ``mt5_read`` imports it
and a cycle there is forbidden by ``mt5_read``'s own docstring.

No logging and no broker text in any exception message (T-164.6.6.2-02): the terminal's
``account_info().currency`` is third-party text, so the messages here are fixed sentences.
"""
import re
from dataclasses import dataclass

from services.external_flows import USD_FAMILY

# The same code shape ``allocator_positions`` accepts for a broker currency. Anything that
# fails it is not a currency code at all and is refused as malformed, never looked up.
_CURRENCY_CODE_RE = re.compile(r"[A-Za-z]{2,10}")


@dataclass(frozen=True, slots=True)
class UnitFloors:
    """The thresholds that only make sense in one unit. One row per supported unit."""

    # Below this a NAV is too small to be a percentage-return denominator: the day is
    # dust-guarded (NaN), never divided. Also gates the uPnL-wedge materiality ratio.
    dust_nav: float
    # An account at or under this equity is immaterial: no settle wait, no fail-loud.
    material_equity: float
    # Absolute floor of the DQ-02 construction-residual tolerance
    # ``max(residual_abs_tol, 1e-6 * |terminal|)``; the relative band is unitless.
    residual_abs_tol: float


# The USD row, and the ONLY place 1000.0 / 100.0 / 1.00 are written. ``nav_twr.DUST_NAV_FLOOR``
# and the job worker's empty-ledger floor are aliases of this row's fields.
USD_FLOORS = UnitFloors(dust_nav=1000.0, material_equity=100.0, residual_abs_tol=1.00)

# Native-unit rows, keyed by upper-case currency code. Exactly one so far.
_NATIVE_FLOORS: dict[str, UnitFloors] = {
    # BTC. ``dust_nav`` 0.001 is D-20 itself (superseding D-05's 0.01). CONTEXT gives no
    # number for the other two, so they follow ONE rule rather than being chosen: the USD row
    # scaled by D-20's own ratio, 0.001 / 1000 = 1e-6. ``material_equity`` 100 -> 0.0001 BTC and
    # ``residual_abs_tol`` 1.00 -> 1e-6 BTC. (Recorded in the CONTEXT discretion note
    # "Recorded 2026-10-07 after the plan check"; RESEARCH A1/A2's 0.001 / 1e-5 were sized
    # against the superseded 0.01 floor and are not used.)
    "BTC": UnitFloors(dust_nav=0.001, material_equity=0.0001, residual_abs_tol=1e-6),
}


class AccountCurrencyBlank(Exception):
    """The terminal reported no currency (blank, whitespace-only or not a string).

    Distinct from malformed because the caller may treat blank as transient: the terminal
    has not finished reporting, and nothing may be guessed in its place (D-01)."""


class AccountCurrencyMalformed(Exception):
    """The reported currency is not a currency code at all (fails ``[A-Za-z]{2,10}``).

    The message is fixed and never carries the raw text (T-164.6.6.2-02)."""


class AccountCurrencyUnsupported(Exception):
    """A well-formed code we hold no floors for. Carries the validated, upper-cased
    ``code`` so the caller can name it; a code that passed the shape check is safe to echo."""

    def __init__(self, code: str) -> None:
        super().__init__("account currency is not supported")
        self.code = code


@dataclass(frozen=True, slots=True)
class AccountUnit:
    """An account's unit: its code, whether it is a native (non-USD-family) unit, and the
    floors every unit-sized threshold must read."""

    code: str
    native: bool
    floors: UnitFloors


def classify_account_currency(raw: object) -> AccountUnit:
    """Map the terminal-reported currency to an ``AccountUnit``.

    * blank / whitespace-only / non-str      -> ``AccountCurrencyBlank``
    * not ``[A-Za-z]{2,10}`` after the strip -> ``AccountCurrencyMalformed``
    * USD family (USD/USDC/USDT/EURR/DAI)    -> non-native, ``USD_FLOORS``
    * a native table row (BTC)               -> native, that row's floors
    * any other well-formed code             -> ``AccountCurrencyUnsupported(code)``
    """
    if not isinstance(raw, str):
        raise AccountCurrencyBlank("account currency is blank")
    stripped = raw.strip()
    if not stripped:
        raise AccountCurrencyBlank("account currency is blank")
    if _CURRENCY_CODE_RE.fullmatch(stripped) is None:
        raise AccountCurrencyMalformed("account currency is not a currency code")
    code = stripped.upper()
    if code in USD_FAMILY:
        return AccountUnit(code=code, native=False, floors=USD_FLOORS)
    floors = _NATIVE_FLOORS.get(code)
    if floors is not None:
        return AccountUnit(code=code, native=True, floors=floors)
    raise AccountCurrencyUnsupported(code)
