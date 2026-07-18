"""Phase 115.1 (E2 display-repoint) Wave-1 — the FOUR P115 carry-in wiring pins.

These are REGRESSION-FIRST RED pins for the worker-side compose step that plan 03
implements as ``services.allocator_equity_compose.compose_allocator_equity``. The
module does NOT exist yet — every pin here imports it INSIDE the test body so each
pin reddens with a clean ``ModuleNotFoundError`` naming the missing symbol (not a
file-level collection error), and turns GREEN when plan 03 lands the compose step
that honors the carry-ins.

The four carry-ins (CONTEXT.md §The FOUR P115 carry-ins, proven by the P115 red
teams) each map to one pin below. They are asserted against the frozen core's
DOCUMENTED contract (``services/allocator_equity_derive.py`` is READ-ONLY reference
here — never edited) and the phase-wide display-row payload contract
(115.1-01-PLAN.md <interfaces>):

    compose_allocator_equity(
        returns_by_key: dict[str, pd.Series],
        flows_by_key:   dict[str, list[ExternalFlow]],
        anchors_by_key: dict[str, float | None],
    ) -> dict   # the display-row payload:
        {
          "curve": [{"date": "YYYY-MM-DD", "equity_usd": float}],
          "flags": [...], "degrade_reasons": [...],
          "is_trustworthy": bool,
          "scalars": {"mwr": float|None, "dietz": float|None, "computable": bool},
          "inputs": {"n_keys": int, "anchor_asof": "YYYY-MM-DD", "composed_at": "ISO"},
        }

Each assertion is MUTATION-FALSIFIABLE: it fails if the carry-in is NOT wired (the
comment on each pin states the exact neuter that reddens it). NO importorskip / xfail
markers — these are honest RED pins; the wave gate proves RED explicitly.

Network-free: every value is hand-derivable from the ``e2_fixtures`` builders (which
already encode the STITCH scenarios) plus the tiny local offset-window builder below.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from services.allocator_equity_compose import compose_allocator_equity
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError
from tests.e2_fixtures import WINDOW_START, make_per_key_returns

# ---------------------------------------------------------------------------
# Local offset-window builders (per the CONVENTION in e2_fixtures.py: later test
# files add their OWN LOCAL fixtures rather than editing the frozen shared module).
# Every per-key series is DENSE calendar-daily (broker_dailies.py:124-137 shape),
# so coverage segments == window segments and the segment-wise blend is EXACT.
# ---------------------------------------------------------------------------

_DAILY = 0.004  # constant benign daily return; sign is immaterial to the carry-in


def _iso(d: date) -> str:
    return d.isoformat()


def _key_from(offset_days: int, n_days: int, key_id: str, daily: float = _DAILY):
    """A dense per-key series starting ``offset_days`` after WINDOW_START."""
    start = WINDOW_START + timedelta(days=offset_days)
    return make_per_key_returns(key_id, start, n_days, daily=daily)


def _all_days(*series: pd.Series) -> set[str]:
    """The union of every ISO-day label present across the given return series."""
    days: set[str] = set()
    for s in series:
        days.update(str(d) for d in s.index)
    return days


def _curve_dates(payload: dict) -> list[str]:
    return [pt["date"] for pt in payload["curve"]]


# ---------------------------------------------------------------------------
# Carry-in #1 + #4 — segment-wise blend / exclusive-only EXCLUSIVE_FILL
# ---------------------------------------------------------------------------


def test_carryin_1_4_segmentwise_blend_no_exclusive_fill_on_offset_windows() -> None:
    """Two keys with OFFSET dense windows (A: d0..d9, B: d3..d9) + anchors for both.

    Carry-in #1 (segment-wise blend) feeds ``blend_concurrent_returns`` one Segment
    at a time via ``segment_coverage``, so A's EXCLUSIVE lead days (d0..d2, where B is
    not yet held) are a single-key passthrough at weight 1.0 — NOT 0-filled at full
    weight. Carry-in #4 therefore makes ``exclusive_fill_days == 0`` STRUCTURALLY, so
    ``EXCLUSIVE_FILL`` is absent and the clean fixture reads ``is_trustworthy=True``.

    MUTATION-FALSIFIABLE: the CURRENT raw-union feeding of ``blend_concurrent_returns``
    0-fills A's exclusive lead at full weight → ``exclusive_fill_days > 0`` →
    ``DegradeReason.EXCLUSIVE_FILL`` (BLOCKING) → this pin reddens (is_trustworthy=False
    and the ``exclusive_fill`` token present).
    """
    from services.allocator_equity_compose import compose_allocator_equity

    key_a = _key_from(0, 10, "key-A")   # d0..d9
    key_b = _key_from(3, 7, "key-B")    # d3..d9 (offset — absent lead d0..d2)
    returns_by_key = {"key-A": key_a, "key-B": key_b}
    flows_by_key: dict[str, list[ExternalFlow]] = {"key-A": [], "key-B": []}
    anchors_by_key = {"key-A": 100_000.0, "key-B": 50_000.0}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)

    assert "exclusive_fill" not in payload["degrade_reasons"], (
        "segment-wise blend must NOT 0-fill A's exclusive lead at full weight — "
        f"EXCLUSIVE_FILL leaked into degrade_reasons: {payload['degrade_reasons']!r}"
    )
    assert payload["is_trustworthy"] is True, (
        "a clean two-key offset-window allocator must read is_trustworthy=True once "
        "EXCLUSIVE_FILL is exclusive-only (carry-in #4); got "
        f"is_trustworthy={payload['is_trustworthy']!r}, reasons="
        f"{payload['degrade_reasons']!r}"
    )
    # No invented data: every curve day is a real return day across the two keys.
    assert set(_curve_dates(payload)) <= _all_days(key_a, key_b)


# ---------------------------------------------------------------------------
# Carry-in #2 — shared seam list (curve & ledger cannot disagree)
# ---------------------------------------------------------------------------


def test_carryin_2_shared_seam_list_curve_ledger_agree() -> None:
    """A rotation fixture — key A ends (d0..d4), key B starts later (d10..d14), a
    genuine Seam with gap days d5..d9 between the windows.

    The compose result must be internally consistent:
      * the seam GAP days (d5..d9) are ABSENT from ``curve`` — the allocator curve
        spans the UNION of the anchored keys' ACTUAL day indices, never invents a
        level on a day no key traded (no fabricated data); AND
      * ``scalars.computable`` is True — proving ``returns_by_key`` was threaded into
        ``build_allocator_ledger`` alongside the SAME seam list passed to
        ``allocator_equity_curve`` (carry-in #2). Omitting the returns forces
        ``computable=False`` (allocator_equity_derive.py:1026-1029), which reddens.
    """
    from services.allocator_equity_compose import compose_allocator_equity

    key_a = _key_from(0, 5, "key-A")     # d0..d4
    key_b = _key_from(10, 5, "key-B")    # d10..d14 (gap d5..d9)
    returns_by_key = {"key-A": key_a, "key-B": key_b}
    flows_by_key: dict[str, list[ExternalFlow]] = {"key-A": [], "key-B": []}
    anchors_by_key = {"key-A": 60_000.0, "key-B": 40_000.0}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)

    gap_days = {
        _iso(WINDOW_START + timedelta(days=off)) for off in range(5, 10)
    }
    curve_days = set(_curve_dates(payload))
    assert curve_days.isdisjoint(gap_days), (
        "no invented data: seam gap days must be ABSENT from the curve; leaked "
        f"{sorted(curve_days & gap_days)!r}"
    )
    assert curve_days <= _all_days(key_a, key_b)
    assert payload["scalars"]["computable"] is True, (
        "scalars.computable must be True — proving returns_by_key was passed to "
        "build_allocator_ledger with the shared seam list (carry-in #2); got "
        f"scalars={payload['scalars']!r}"
    )


# ---------------------------------------------------------------------------
# The MEDIUM-6 stray-key trap — drop unanchored keys BEFORE segment_coverage
# ---------------------------------------------------------------------------


def test_unanchored_key_dropped_before_segmentation_no_raise() -> None:
    """Three keys with returns but only TWO anchors (the third anchor is None).

    Carry-in TRAP (CONTEXT.md): unanchored keys MUST be dropped BEFORE
    ``segment_coverage`` runs. If segmentation runs over the full RETURNS key-set
    (including the unanchored key) and the resulting seam list is then passed to
    ``allocator_equity_curve`` (whose anchored set excludes it), the MEDIUM-6
    stray-key guard raises ``NavReconstructionError`` (allocator_equity_derive.py:
    857-878). Correct wiring drops-then-segments, so compose does NOT raise, the
    dropped key surfaces via ``degrade_reasons`` (DROPPED_KEY), and the curve covers
    only the anchored keys.

    MUTATION-FALSIFIABLE: segment over the returns key-set before dropping → this pin
    reddens with a NavReconstructionError (the stray-key double-count guard).
    """
    from services.allocator_equity_compose import compose_allocator_equity

    key_a = _key_from(0, 10, "key-A")    # d0..d9 (anchored)
    key_b = _key_from(0, 10, "key-B")    # concurrent (anchored)
    key_c = _key_from(2, 6, "key-C")     # d2..d7 (NO anchor → must be dropped)
    returns_by_key = {"key-A": key_a, "key-B": key_b, "key-C": key_c}
    flows_by_key: dict[str, list[ExternalFlow]] = {
        "key-A": [],
        "key-B": [],
        "key-C": [],
    }
    anchors_by_key = {"key-A": 100_000.0, "key-B": 50_000.0, "key-C": None}

    # Correct order does not raise (an incorrect order raises NavReconstructionError).
    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)

    assert "dropped_key" in payload["degrade_reasons"], (
        "the unanchored key must be reported via DROPPED_KEY in degrade_reasons; got "
        f"{payload['degrade_reasons']!r}"
    )
    # Curve covers only the anchored keys (A + B share a window; C is dropped).
    assert set(_curve_dates(payload)) <= _all_days(key_a, key_b)


def test_anchored_key_with_no_returns_is_dropped_not_silently_omitted() -> None:
    """B3 (WR-01, 115.1-close): a key with a REAL anchor but NO return series must
    be recorded as DROPPED_KEY (blocking → untrustworthy), never silently omitted.

    The pre-fix reconciliation iterated ``returns_by_key`` ONLY for both the
    anchored and the dropped set, so a key present in ``anchors_by_key`` (real
    capital) but absent from ``returns_by_key`` fell into NEITHER list: it was not
    summed into the $-equity total AND raised no DROPPED_KEY/NO_ANCHOR reason, so
    ``is_trustworthy`` stayed True on a curve that UNDERSTATES real capital.

    MUTATION-FALSIFIABLE: reconcile over ``returns_by_key`` only (drop the union
    with anchored ``anchors_by_key``) → is_trustworthy flips back to True and
    DROPPED_KEY vanishes → this pin reddens.
    """
    from services.allocator_equity_compose import compose_allocator_equity

    key_a = _key_from(0, 10, "key-A")  # anchored AND has returns
    returns_by_key = {"key-A": key_a}  # key-B has NO return series at all
    flows_by_key: dict[str, list[ExternalFlow]] = {"key-A": [], "key-B": []}
    # key-B carries a real anchor (live capital) but no per-key returns row.
    anchors_by_key = {"key-A": 100_000.0, "key-B": 50_000.0}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)

    assert "dropped_key" in payload["degrade_reasons"], (
        "an anchored key with no return series must be reported via DROPPED_KEY; "
        f"got {payload['degrade_reasons']!r}"
    )
    assert payload["is_trustworthy"] is False, (
        "a curve that omits a real anchored key's capital must NOT be trustworthy; "
        f"got degrade_reasons={payload['degrade_reasons']!r}"
    )
    # The curve is still computed over the key that DOES have a series (A) — the
    # feature degrades honestly (untrustworthy), it does not blank.
    assert _curve_dates(payload), "the anchored-with-returns key still yields a curve"


# ---------------------------------------------------------------------------
# F1a×F3/M2 seam — a NULL-anchor key ALSO absent from returns_by_key. Without the
# fourth reconciliation bucket it falls into none of the three B3 buckets → it is
# silently omitted → a trustworthy partial curve over the rest. Gated on the
# epilogue's anchor_null_reason: 'dust' → omit (materiality); else / MISSING token
# → DROPPED_KEY (degrade to legacy).
# ---------------------------------------------------------------------------


def _healthy_A_returns() -> pd.Series:
    return _key_from(0, 10, "key-A")


def test_null_anchor_no_returns_nondust_key_degrades_not_silently_omitted() -> None:
    """The EXACT red-team RED: a healthy key-A + an idle key-B with a NULL anchor
    (real-capital read failure) AND no return series must make the composed curve
    UNTRUSTWORTHY (DROPPED_KEY), NOT a trustworthy curve over A only.

    MUTATION-FALSIFIABLE: drop the fourth bucket (or treat every reason as dust) →
    key-B is silently omitted → is_trustworthy flips back to True → RED.
    """
    key_a = _healthy_A_returns()
    returns_by_key = {"key-A": key_a}  # key-B has NO returns
    flows_by_key: dict[str, list[ExternalFlow]] = {"key-A": [], "key-B": []}
    anchors_by_key = {"key-A": 10_000.0, "key-B": None}

    for reason in ("balance_error", "nonpositive", "nonfinite", "flow_drop"):
        payload = compose_allocator_equity(
            returns_by_key, flows_by_key, anchors_by_key,
            {"key-B": reason},
        )
        assert payload["is_trustworthy"] is False, (
            f"a null-anchor idle key ({reason}) must degrade the allocator; "
            f"got degrade_reasons={payload['degrade_reasons']!r}"
        )
        assert "dropped_key" in payload["degrade_reasons"], (
            f"reason={reason} must emit DROPPED_KEY; got {payload['degrade_reasons']!r}"
        )


def test_null_anchor_no_returns_missing_token_defaults_to_degrade() -> None:
    """A null-anchor idle key WITHOUT a reason token (a legacy/pre-fix key_inputs
    row) must default to the SAFE side (non-dust) → DROPPED_KEY → legacy. A missing
    token must never silently pass as trustworthy."""
    from services.allocator_equity_compose import compose_allocator_equity as _c

    key_a = _healthy_A_returns()
    payload = _c(
        {"key-A": key_a},
        {"key-A": [], "key-B": []},
        {"key-A": 10_000.0, "key-B": None},
        None,  # no reasons map at all → missing token for key-B
    )
    assert payload["is_trustworthy"] is False, (
        "a missing anchor_null_reason must default to degrade (safe), not trustworthy"
    )
    assert "dropped_key" in payload["degrade_reasons"]


def test_null_anchor_no_returns_dust_key_silently_omitted() -> None:
    """A DUST null-anchor idle key absent from returns must be SILENTLY OMITTED — a
    dust key must not pin the whole allocator to legacy forever (materiality, the
    same reason M2 nulls a dust anchor). The rest composes TRUSTWORTHY."""
    key_a = _healthy_A_returns()
    payload = compose_allocator_equity(
        {"key-A": key_a},
        {"key-A": [], "key-B": []},
        {"key-A": 10_000.0, "key-B": None},
        {"key-B": "dust"},
    )
    assert payload["is_trustworthy"] is True, (
        f"a dust null-anchor key must be omitted, not degrade; "
        f"got degrade_reasons={payload['degrade_reasons']!r}"
    )
    assert payload["degrade_reasons"] == [], (
        f"a dust omit must raise NO degrade reason; got {payload['degrade_reasons']!r}"
    )
    # The curve still composes over the healthy key-A.
    assert _curve_dates(payload)


# ---------------------------------------------------------------------------
# Carry-in #3 — ISO-string day-index boundary
# ---------------------------------------------------------------------------


def test_carryin_3_datetimeindex_rejected_iso_string_accepted() -> None:
    """The worker MUST supply ``YYYY-MM-DD`` string day indices, never a raw
    ``DatetimeIndex`` (which stringifies to ``'YYYY-MM-DD 00:00:00'`` and would
    SILENTLY MISALIGN flow days vs return days in the core's ``set(r)|set(fbd)``
    union). The frozen core's ``_assert_iso_day_index`` fails loud at its boundary;
    compose must let that ``NavReconstructionError`` propagate.

    MUTATION-FALSIFIABLE: a compose that coerces / silently accepts a DatetimeIndex
    (dropping the boundary assertion) makes the ``pytest.raises`` block fail.
    """
    from services.allocator_equity_compose import compose_allocator_equity

    n = 6
    days_dt = pd.DatetimeIndex(
        [WINDOW_START + timedelta(days=i) for i in range(n)]
    )
    bad = pd.Series([_DAILY] * n, index=days_dt, name="key-A")
    with pytest.raises(NavReconstructionError):
        compose_allocator_equity(
            {"key-A": bad}, {"key-A": []}, {"key-A": 100_000.0}
        )

    # The ISO-string sibling of the SAME series composes without raising.
    good = _key_from(0, n, "key-A")
    payload = compose_allocator_equity(
        {"key-A": good}, {"key-A": []}, {"key-A": 100_000.0}
    )
    assert "curve" in payload and isinstance(payload["curve"], list)


# ---------------------------------------------------------------------------
# Counter-pin — the NAIVE raw-union wiring measurably fails (mutation oracle)
# ---------------------------------------------------------------------------


def test_naive_rawunion_blend_reddens_exclusive_fill_offset_windows() -> None:
    """The SAME offset-window fixture as carry-in #1/#4, but fed RAW (the whole union
    of both keys) into ``blend_concurrent_returns`` — the pre-115.1 wiring compose
    replaces. On the union days d0..d2 key-B has no row, so it is 0-filled at FULL
    weight: ``exclusive_fill_days > 0`` → ``DegradeReason.EXCLUSIVE_FILL`` (BLOCKING)
    → ``is_trustworthy`` is False.

    This is the mutation oracle for carry-in #1/#4: it documents that the segment-wise
    feeding in ``compose_allocator_equity`` — NOT the raw union — is what earns the
    clean fixture ``is_trustworthy=True`` above. If a future edit collapsed compose
    back to a single raw-union blend, THIS is the failure it would reproduce (no
    monkeypatching of compose internals required).
    """
    from services.allocator_equity_derive import (
        DegradeReason,
        blend_concurrent_returns,
    )

    key_a = _key_from(0, 10, "key-A")   # d0..d9
    key_b = _key_from(3, 7, "key-B")    # d3..d9 (exclusive lead d0..d2)
    # Raw union — exactly what the pre-115.1 blend received (NOT segment-sliced).
    series_by_key = {"key-A": key_a, "key-B": key_b}
    weights_by_key = {"key-A": 100_000.0 / 150_000.0, "key-B": 50_000.0 / 150_000.0}

    result = blend_concurrent_returns(series_by_key, weights_by_key)

    assert result.flags["exclusive_fill_days"] == 3, (
        "the raw union 0-fills key-B on its 3 exclusive lead days (d0..d2) at full "
        f"weight; got exclusive_fill_days={result.flags.get('exclusive_fill_days')!r}"
    )
    assert DegradeReason.EXCLUSIVE_FILL in result.degrade_reasons
    assert result.is_trustworthy is False, (
        "the naive raw-union blend is BLOCKING (EXCLUSIVE_FILL) — proving the "
        "segment-wise compose wiring is what earns is_trustworthy=True"
    )
