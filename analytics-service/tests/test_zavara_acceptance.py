"""Offline (credentials-free) unit tests for the Finding-6 acceptance helpers in
``scripts/zavara_acceptance.py``. These exercise the CSV-only comparison path — the
uniform-scale fit, arithmetic-cumulative maxDD, single-convention monthly grid, and
the multi-key stitch — WITHOUT any live Deribit crawl."""
from __future__ import annotations

import json
import math

import pytest

from scripts.zavara_acceptance import (
    compare_shipped_to_csv,
    fit_uniform_scale,
    monthly_sums_pct,
    parse_zavara_daily_return_pct,
    stitch_key_outputs,
    stitched_arithmetic_maxdd_pct,
)

# A tiny zavara-shaped CSV (the real column order); cum_return_pct is intentionally
# a DIFFERENT/unreliable basis to prove the parser ignores it.
_CSV = (
    "date,capital,btc_price,daily_pnl_btc,daily_pnl_usd,cum_pnl_usd,nav,"
    "daily_return_pct,cum_return_pct\n"
    "2025-08-03,4000000,114672.0,-0.59,-68229.73,-68229.73,3931770.27,-1.7057,-1.7057\n"
    "2025-08-04,4000000,113991.5,0.90,102592.92,34363.19,4034363.19,2.5648,0.8591\n"
    "2025-08-05,4000000,113000.0,0.60,67800.00,102163.19,4102163.19,1.7173,99.9\n"
    "2025-09-02,4000000,110000.0,-1.00,-110000.0,-7836.81,3992163.19,-2.5766,42.0\n"
)


def test_parse_ignores_cum_column_and_reads_daily_return_pct() -> None:
    parsed = parse_zavara_daily_return_pct(_CSV)
    assert parsed == {
        "2025-08-03": -1.7057,
        "2025-08-04": 2.5648,
        "2025-08-05": 1.7173,
        "2025-09-02": -2.5766,
    }


def test_fit_uniform_scale_identity_is_one_zero_dev() -> None:
    truth = parse_zavara_daily_return_pct(_CSV)
    k, dev = fit_uniform_scale(dict(truth), truth)
    assert k == pytest.approx(1.0, abs=1e-12)
    assert dev == pytest.approx(0.0, abs=1e-12)


def test_fit_uniform_scale_detects_systematic_rescale() -> None:
    """A shipped series that is a UNIFORM 2× of truth fits k≈0.5 with ~0 residual —
    the scale is recovered and the shape still matches (deviation ~0)."""
    truth = parse_zavara_daily_return_pct(_CSV)
    shipped = {d: v * 2.0 for d, v in truth.items()}
    k, dev = fit_uniform_scale(shipped, truth)
    assert k == pytest.approx(0.5, rel=1e-12)
    assert dev == pytest.approx(0.0, abs=1e-9)


def test_fit_uniform_scale_shape_mismatch_inflates_deviation() -> None:
    """A genuine SHAPE mismatch (one day flipped) leaves a large post-scale
    deviation even at the best-fit k — the shape-match guard."""
    truth = parse_zavara_daily_return_pct(_CSV)
    shipped = dict(truth)
    shipped["2025-08-04"] = -truth["2025-08-04"]  # flip one day
    k, dev = fit_uniform_scale(shipped, truth)
    assert dev > 1.0  # percent points — clearly not a shape match


def test_fit_uniform_scale_empty_overlap_is_nan() -> None:
    k, dev = fit_uniform_scale({"2030-01-01": 1.0}, {"2025-08-03": -1.7})
    assert math.isnan(k) and math.isnan(dev)


def test_stitched_arithmetic_maxdd_hand_computed() -> None:
    """cum [2,-1,0,-1] off daily [+2,-3,+1,-1]; peak stays 2 → deepest dd = -3."""
    daily = {
        "2025-01-01": 2.0, "2025-01-02": -3.0,
        "2025-01-03": 1.0, "2025-01-04": -1.0,
    }
    assert stitched_arithmetic_maxdd_pct(daily) == pytest.approx(-3.0)
    # Monotone up → no drawdown.
    assert stitched_arithmetic_maxdd_pct({"2025-01-01": 1.0, "2025-01-02": 2.0}) == 0.0


def test_monthly_sums_are_arithmetic_single_convention() -> None:
    """Monthly cells are Σr per month and SUM to the arithmetic cumulative."""
    truth = parse_zavara_daily_return_pct(_CSV)
    monthly = monthly_sums_pct(truth)
    assert monthly["2025-08"] == pytest.approx(-1.7057 + 2.5648 + 1.7173)
    assert monthly["2025-09"] == pytest.approx(-2.5766)
    assert sum(monthly.values()) == pytest.approx(sum(truth.values()))


def test_compare_bundle_reports_k_maxdd_and_monthly() -> None:
    truth = parse_zavara_daily_return_pct(_CSV)
    cmp = compare_shipped_to_csv(dict(truth), truth)
    assert cmp["scale_k"] == pytest.approx(1.0)
    assert cmp["max_per_day_abs_dev_pct"] == pytest.approx(0.0, abs=1e-12)
    assert cmp["n_common_days"] == 4
    assert cmp["shipped_maxdd_pct"] == pytest.approx(cmp["csv_maxdd_pct"])
    assert cmp["monthly_max_abs_dev_pct"] == pytest.approx(0.0, abs=1e-12)


def test_stitch_keys_combines_nonoverlapping_and_raises_on_overlap() -> None:
    """Sequential subaccounts stitch into ONE series (through the SHARED
    ``services.stitch_composite`` core); the combined maxDD is computed on the whole
    stitched arithmetic-cumulative. An accidental date overlap across keys now RAISES
    ``CompositeOverlapError`` (fail-loud production semantics — the old report-only
    dict-merge is retired; never silently last-write-wins)."""
    from services.stitch_composite import CompositeOverlapError

    key1 = {"2025-08-01": 2.0, "2025-08-02": -3.0}
    key2 = {"2025-09-01": 1.0, "2025-09-02": -1.0}
    res = stitch_key_outputs([key1, key2])
    # Regression: non-overlapping keys stitch IDENTICALLY to the pre-re-point path.
    assert res["n_stitched_days"] == 4
    # cum [2,-1,0,-1] → deepest -3.
    assert res["stitched_maxdd_pct"] == pytest.approx(-3.0)
    assert res["stitched_cumulative_pct"] == pytest.approx(-1.0)
    # An overlap across keys RAISES (mutation-honest: restoring last-write-wins
    # reddens this — the guard delegates to the shared fail-loud core).
    with pytest.raises(CompositeOverlapError):
        stitch_key_outputs([{"2025-08-01": 1.0}, {"2025-08-01": 9.0}])


# ---------------------------------------------------------------------------
# A1 window derivation — the key→window→tranche mapping is CONFIRMED from the
# per-key first/last days themselves, never assumed. Half-open [first_i,
# first_{i+1}) windows; the last window trims to mandate_end+1 (F3). Raw per-key
# day ranges that OVERLAP RAISE (the A1 STOP case) — windows are never forced to
# make the guard pass.
# ---------------------------------------------------------------------------


def test_derive_member_windows_half_open_from_first_days() -> None:
    from scripts.zavara_acceptance import derive_member_windows
    from services.stitch_composite import MemberWindow

    per_key = [
        (1, "2025-08-03", "2025-09-26"),
        (2, "2025-09-27", "2025-12-15"),
        (3, "2025-12-16", "2026-03-28"),
    ]
    windows = derive_member_windows(per_key, mandate_end_exclusive="2026-04-01")
    assert windows == [
        MemberWindow(1, "2025-08-03", "2025-09-27"),
        MemberWindow(2, "2025-09-27", "2025-12-16"),
        MemberWindow(3, "2025-12-16", "2026-04-01"),
    ]


def test_derive_member_windows_sorts_by_first_day() -> None:
    from scripts.zavara_acceptance import derive_member_windows
    from services.stitch_composite import MemberWindow

    # Given out of chronological order → sorted before boundary derivation.
    per_key = [
        (3, "2025-12-16", "2026-03-28"),
        (1, "2025-08-03", "2025-09-26"),
        (2, "2025-09-27", "2025-12-15"),
    ]
    windows = derive_member_windows(per_key, mandate_end_exclusive="2026-04-01")
    assert [w.seq for w in windows] == [1, 2, 3]
    assert windows[0] == MemberWindow(1, "2025-08-03", "2025-09-27")
    assert windows[-1] == MemberWindow(3, "2025-12-16", "2026-04-01")


def test_derive_member_windows_raises_on_overlapping_raw_ranges() -> None:
    """A1 STOP: key1's real data extends ONTO/PAST key2's first day → the raw ranges
    overlap. RAISE — never force a clip window that silently hides the overlap."""
    from scripts.zavara_acceptance import derive_member_windows
    from services.stitch_composite import CompositeOverlapError

    per_key = [
        (1, "2025-08-03", "2025-09-28"),  # last day AFTER key2's first day
        (2, "2025-09-27", "2025-12-15"),
    ]
    with pytest.raises(CompositeOverlapError):
        derive_member_windows(per_key, mandate_end_exclusive="2026-04-01")


def test_derive_member_windows_boundary_day_collision_raises() -> None:
    """key1 has data ON key2's first day exactly → that day belongs to key2's
    half-open window; a shared boundary day is an overlap → RAISE."""
    from scripts.zavara_acceptance import derive_member_windows
    from services.stitch_composite import CompositeOverlapError

    per_key = [
        (1, "2025-08-03", "2025-09-27"),  # last day == key2 first day
        (2, "2025-09-27", "2025-12-15"),
    ]
    with pytest.raises(CompositeOverlapError):
        derive_member_windows(per_key, mandate_end_exclusive="2026-04-01")


def test_derive_member_windows_last_key_trims_post_mandate_not_overlap() -> None:
    """The LAST key's data past mandate_end is an intended F3 trim (April is
    non-corroborable), NOT an overlap — the mandate boundary clips it silently."""
    from scripts.zavara_acceptance import derive_member_windows
    from services.stitch_composite import MemberWindow

    per_key = [(1, "2025-08-03", "2026-04-20")]
    windows = derive_member_windows(per_key, mandate_end_exclusive="2026-04-01")
    assert windows == [MemberWindow(1, "2025-08-03", "2026-04-01")]


# ---------------------------------------------------------------------------
# --stitch-keys in-process fan-out — runs _run per key (stubbed here, no creds),
# derives the A1 windows, clips + stitches through services.stitch_composite,
# gap-fills, computes compute_all_metrics(simple/active/365), and SELF-ASSERTS the
# pinned tolerances (±0.10pp cum / ±0.05pp maxDD). A miss exits NONZERO (L2
# fail-loud) — a caught failure can never read as a green acceptance.
# ---------------------------------------------------------------------------


def _canned_three_key_run() -> object:
    """A stubbed ``_run`` returning canned per-key dense FRACTION maps whose stitched
    Σr = +0.05 (5.0%) and inception-seeded maxDD = −0.06 (−6.0%). Windows: key1
    Aug, key2 late-Sep, key3 mid-Dec — disjoint sequential handoffs."""
    maps = {
        1: {"2025-08-03": 0.10, "2025-08-04": -0.05},
        2: {"2025-09-27": 0.02, "2025-09-28": -0.03},
        3: {"2025-12-16": 0.01},
    }

    async def _fake_run(key_index: int, *, csv_path: object = None) -> dict:
        return {
            "key_index": key_index,
            "shipped_daily_return_fraction": maps[key_index],
        }

    return _fake_run


def test_stitch_keys_mode_stitches_and_self_asserts_pass(monkeypatch: object) -> None:
    import scripts.zavara_acceptance as za

    monkeypatch.setattr(za, "_run", _canned_three_key_run())  # type: ignore[attr-defined]
    # Dense Σr = 0.10-0.05+0.02-0.03+0.01 = 0.05 → 5.0%; cumsum peak 0.10, trough
    # 0.04 → maxDD -0.06 → -6.0% (gap days 0.0-filled, add nothing).
    rc = za.main(
        ["--stitch-keys", "1", "2", "3", "--expect-cum", "5.0", "--expect-maxdd", "-6.0"]
    )
    assert rc == 0


def test_stitch_keys_mode_self_assert_miss_exits_nonzero(monkeypatch: object) -> None:
    import scripts.zavara_acceptance as za

    monkeypatch.setattr(za, "_run", _canned_three_key_run())  # type: ignore[attr-defined]
    # Wrong cum expectation → outside ±0.10pp → fail-loud nonzero.
    rc = za.main(
        ["--stitch-keys", "1", "2", "3", "--expect-cum", "99.0", "--expect-maxdd", "-6.0"]
    )
    assert rc == 1


def test_stitch_keys_mode_defaults_are_zavara_targets(monkeypatch: object) -> None:
    """No --expect flags → the defaults are the Zavara targets (62.66 / −4.13); the
    canned 5.0/−6.0 series MISSES them → nonzero (proves the defaults are wired)."""
    import scripts.zavara_acceptance as za

    monkeypatch.setattr(za, "_run", _canned_three_key_run())  # type: ignore[attr-defined]
    assert za.main(["--stitch-keys", "1", "2", "3"]) == 1


def test_stitch_keys_mode_stops_on_overlapping_key_days(monkeypatch: object) -> None:
    """Overlapping raw per-key days in the live fan-out → CompositeOverlapError →
    main scrubs to the class name and exits nonzero (the A1 STOP, end to end)."""
    import scripts.zavara_acceptance as za

    maps = {
        1: {"2025-08-03": 0.10, "2025-09-27": -0.05},  # key1 onto key2's first day
        2: {"2025-09-27": 0.02},
    }

    async def _fake_run(key_index: int, *, csv_path: object = None) -> dict:
        return {"key_index": key_index, "shipped_daily_return_fraction": maps[key_index]}

    monkeypatch.setattr(za, "_run", _fake_run)  # type: ignore[attr-defined]
    assert za.main(["--stitch-keys", "1", "2"]) == 1


def test_stitch_keys_output_is_leak_safe(
    monkeypatch: object, capsys: object
) -> None:
    """The emitted --stitch-keys doc carries ONLY aggregated %/scalars + dates/day
    counts — no raw balance/mark/secret field ever added (T-86-15)."""
    import scripts.zavara_acceptance as za

    monkeypatch.setattr(za, "_run", _canned_three_key_run())  # type: ignore[attr-defined]
    za.main(
        ["--stitch-keys", "1", "2", "3", "--expect-cum", "5.0", "--expect-maxdd", "-6.0"]
    )
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    doc = json.loads(out)
    allowed = {
        "mode", "per_key", "derived_windows", "coverage_mask",
        "stitched_cumulative_return_pct", "stitched_max_drawdown_pct",
        "n_stitched_days", "n_dense_days", "expect_cum", "expect_maxdd",
        "cum_within_tol", "maxdd_within_tol", "acceptance_pass",
    }
    assert set(doc) <= allowed
    low = out.lower()
    assert "balance" not in low and "secret" not in low


def test_stitch_with_csv_recovers_scale_and_maxdd() -> None:
    """The stitched shipped series vs the CSV: k≈1, tiny deviation, and the combined
    maxDD matches the CSV's — the end-to-end Finding-6 acceptance shape (offline)."""
    truth = parse_zavara_daily_return_pct(_CSV)
    # Split the truth across two "keys" by month (non-overlapping).
    key_aug = {d: v for d, v in truth.items() if d.startswith("2025-08")}
    key_sep = {d: v for d, v in truth.items() if d.startswith("2025-09")}
    res = stitch_key_outputs([key_aug, key_sep], truth)
    assert res["csv_comparison"]["scale_k"] == pytest.approx(1.0)
    assert res["csv_comparison"]["max_per_day_abs_dev_pct"] == pytest.approx(0.0, abs=1e-9)
    assert res["stitched_maxdd_pct"] == pytest.approx(
        res["csv_comparison"]["csv_maxdd_pct"]
    )


# ---------------------------------------------------------------------------
# L2 — the committed acceptance GATE must be fail-loud: a caught money-guard
# exception (metrics_error present) exits NONZERO so it can never be mistaken for
# a green acceptance run.
# ---------------------------------------------------------------------------


def test_l2_metrics_error_exits_nonzero(monkeypatch: object) -> None:
    import scripts.zavara_acceptance as za

    async def _fake_run(key_index: int, *, csv_path: object = None) -> dict:
        return {"key_index": key_index, "metrics_error": "AllocatedCapitalValuationError"}

    monkeypatch.setattr(za, "_run", _fake_run)  # type: ignore[attr-defined]
    assert za.main(["--key-index", "1"]) == 1


def test_l2_clean_run_exits_zero(monkeypatch: object) -> None:
    import scripts.zavara_acceptance as za

    async def _fake_run(key_index: int, *, csv_path: object = None) -> dict:
        return {"key_index": key_index, "shipped_metrics": {"sharpe": 1.0}}

    monkeypatch.setattr(za, "_run", _fake_run)  # type: ignore[attr-defined]
    assert za.main(["--key-index", "1"]) == 0


# ---------------------------------------------------------------------------
# F1 — the harness MUST build the ledger in the SAME spot-exclusion mode the
# worker uses for a config-bearing (allocated) strategy (True). Parity pinned so
# the harness can never silently validate a different mode than production ships.
# ---------------------------------------------------------------------------


def test_f1_harness_builds_ledger_with_worker_spot_mode(monkeypatch: object) -> None:
    import asyncio
    from types import SimpleNamespace

    import scripts.deribit_acceptance as da
    import scripts.zavara_acceptance as za
    import services.exchange as se
    from services.allocated_capital import (
        exclude_spot_extraction_for,
        parse_returns_denominator_config,
    )

    captured: dict = {}

    async def _fake_build(exchange, *, pnl_basis, exclude_spot_extraction=False):
        captured["pnl_basis"] = pnl_basis
        captured["exclude_spot_extraction"] = exclude_spot_extraction
        ledger = SimpleNamespace(native_pnl={}, marks={})
        report = SimpleNamespace(
            pre_coverage_option_days=[], indexable_currencies=frozenset()
        )
        return ledger, report

    async def _fake_close(_ex: object) -> None:
        return None

    monkeypatch.setattr(za, "build_deribit_native_ledger", _fake_build)  # type: ignore[attr-defined]
    monkeypatch.setattr(da, "_build_deribit_exchange", lambda _i: object())  # type: ignore[attr-defined]
    monkeypatch.setattr(se, "aclose_exchange", _fake_close)  # type: ignore[attr-defined]

    asyncio.run(za._run(1))  # type: ignore[attr-defined]

    cfg = parse_returns_denominator_config(za._ZAVARA_DENOMINATOR_CONFIG)  # type: ignore[attr-defined]
    # Parity: the harness passes EXACTLY what the worker derives for this config.
    assert captured["exclude_spot_extraction"] == exclude_spot_extraction_for(cfg)
    assert captured["exclude_spot_extraction"] is True  # the allocated path
    assert captured["pnl_basis"] == cfg.pnl_basis  # cash_settlement
