"""Plan 155-08 Task 1: flag classification, matrix classification, reannualization
matchers and the tracked-text scanner (MT5-15, SC-5, PARITY-03).

Every expected value is computed from the imported constants; neither the tolerance
literal nor a guard-key literal is written here.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import pytest

from services import mt5_parity_findings as mpf
from services.mt5_parity import (
    BUCKET_LABELS,
    MT5_PARITY_TOLERANCE,
    ratio_3sf,
)
from services.mt5_parity_findings import (
    ANNUALIZATION_MATCH_SIG_FIGS,
    FLAG_CLASSIFICATION,
    MARKS_KEYS,
    Finding,
    classify_account_flags,
    classify_flag,
    classify_matrix,
    matches_reannualization,
    matches_sharpe_reannualization,
    number_findings,
    scan_tracked_text,
)
from services.nav_twr import (
    NAV_TWR_ANNOTATION_KEYS,
    NAV_TWR_GUARD_KEYS,
    NAV_TWR_LEGACY_GUARD_KEYS,
)
from services.parity_diff import REANNUALIZATION_FACTOR

FIXTURES = Path(__file__).parent / "fixtures" / "mt5_parity"
MATRIX_FIXTURE = FIXTURES / "surface_matrix_synthetic.json"
MODULE_SOURCE = Path(mpf.__file__)


def _matrix() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(MATRIX_FIXTURE.read_text(encoding="utf-8"))
    return loaded


def _by_label(findings: tuple[Finding, ...], label: str) -> dict[str, Finding]:
    return {f.subject: f for f in findings if f.account_label == label}


# ----------------------------------------------------------------------- flags


def test_every_imported_guard_key_is_a_defect() -> None:
    for key in (*NAV_TWR_GUARD_KEYS, *NAV_TWR_LEGACY_GUARD_KEYS):
        assert FLAG_CLASSIFICATION[key] == "defect", key
        assert classify_flag(key, True) == "defect", key


def test_every_imported_annotation_key_is_explained() -> None:
    for key in NAV_TWR_ANNOTATION_KEYS:
        assert FLAG_CLASSIFICATION[key] == "explained_acceptable", key


def test_marks_and_method_keys_are_explained_except_the_value_dependent_one() -> None:
    for key in ("marks_since", "marks_covered_from", "marks_trailing_since", "cumulative_method", "native_unit"):
        assert classify_flag(key, "x") == "explained_acceptable", key
    assert "mark_gap_days" in MARKS_KEYS
    assert "mark_gap_days" not in FLAG_CLASSIFICATION


def test_mark_gap_days_is_judged_by_its_value() -> None:
    assert classify_flag("mark_gap_days", []) == "explained_acceptable"
    assert classify_flag("mark_gap_days", ["2026-10-12"]) == "defect"
    # a value of an unexpected shape is never guessed
    assert classify_flag("mark_gap_days", "2026-10-12") == "unknown"
    assert classify_flag("mark_gap_days", None) == "unknown"


def test_an_unseen_key_is_unknown() -> None:
    assert classify_flag("a_key_nobody_wrote_down", True) == "unknown"
    assert classify_flag("", True) == "unknown"


def test_a_warned_row_with_only_annotations_is_an_unknown_finding() -> None:
    row = {
        "computation_status": "complete_with_warnings",
        "computed_at": "2026-11-14 03:00:00.123456+00",
        "data_quality_flags": {NAV_TWR_ANNOTATION_KEYS[0]: True, "marks_since": "2026-11-02"},
    }
    readings, findings = classify_account_flags("SYN-A", row)
    assert [f.subject for f in findings] == ["computation_status"]
    assert findings[0].kind == "flag"
    assert findings[0].bucket == "unknown"
    assert {r.key: r.flag_class for r in readings} == {
        NAV_TWR_ANNOTATION_KEYS[0]: "explained_acceptable",
        "marks_since": "explained_acceptable",
    }
    assert {r.computed_at_minute for r in readings} == {"2026-11-14T03:00Z"}


def test_a_warned_row_with_a_guard_key_names_the_guard_and_not_the_status() -> None:
    guard = NAV_TWR_GUARD_KEYS[0]
    row = {
        "computation_status": "complete_with_warnings",
        "computed_at": "2026-11-14T03:00:00Z",
        "data_quality_flags": {guard: True, "marks_since": "2026-11-02"},
    }
    _, findings = classify_account_flags("SYN-A", row)
    assert [f.subject for f in findings] == [guard]
    assert findings[0].bucket == "defect"


def test_the_legacy_guard_also_satisfies_a_warned_status() -> None:
    legacy = NAV_TWR_LEGACY_GUARD_KEYS[0]
    row = {
        "computation_status": "complete_with_warnings",
        "computed_at": "2026-11-14T03:00:00Z",
        "data_quality_flags": {legacy: True},
    }
    _, findings = classify_account_flags("SYN-A", row)
    assert [f.subject for f in findings] == [legacy]


def test_a_clean_row_has_no_findings_and_explained_readings() -> None:
    row = {
        "computation_status": "complete",
        "computed_at": "2026-11-14T03:00:00Z",
        "data_quality_flags": {"cumulative_method": "geometric", "mark_gap_days": []},
    }
    readings, findings = classify_account_flags("SYN-A", row)
    assert findings == ()
    assert all(r.flag_class == "explained_acceptable" for r in readings)


def test_a_flag_set_that_is_not_an_object_is_a_finding_not_a_pass() -> None:
    row = {"computation_status": "complete", "computed_at": None, "data_quality_flags": ["x"]}
    readings, findings = classify_account_flags("SYN-A", row)
    assert readings == ()
    assert [(f.subject, f.bucket) for f in findings] == [("data_quality_flags", "unknown")]


def test_every_flag_lead_names_its_key_and_leaks_no_digit_run() -> None:
    cases: dict[str, object] = {
        NAV_TWR_GUARD_KEYS[0]: True,
        "mark_gap_days": ["2026-10-12", "2026-10-13"],
        "never_seen_key": 12345678,
    }
    row = {
        "computation_status": "complete_with_warnings",
        "computed_at": "2026-11-14T03:00:00Z",
        "data_quality_flags": cases,
    }
    _, findings = classify_account_flags("SYN-A", row)
    keys = {f.subject for f in findings}
    assert keys == {NAV_TWR_GUARD_KEYS[0], "mark_gap_days", "never_seen_key"}
    for f in findings:
        assert f.subject in f.lead
        assert "digit_run_5" not in scan_tracked_text(f.lead)
        assert "12345678" not in f.lead


def test_the_flag_table_is_built_from_the_imported_tuples_not_restated() -> None:
    source = MODULE_SOURCE.read_text(encoding="utf-8")
    assert "NAV_TWR_GUARD_KEYS" in source
    for key in (*NAV_TWR_GUARD_KEYS, *NAV_TWR_LEGACY_GUARD_KEYS):
        assert key not in source, key


def test_the_module_never_writes_the_tolerance_or_a_planning_path() -> None:
    source = MODULE_SOURCE.read_text(encoding="utf-8")
    assert str(MT5_PARITY_TOLERANCE) not in source
    assert ".planning" not in source
    assert "/" + "Users" + "/" not in source


# -------------------------------------------------------------------- matchers


def test_cagr_reannualization_matches_in_both_directions() -> None:
    a = 0.2
    b = (1 + a) ** (1 / REANNUALIZATION_FACTOR) - 1
    assert matches_reannualization(a, b)
    assert matches_reannualization(b, a)
    assert not matches_reannualization(a, b + MT5_PARITY_TOLERANCE)
    assert not matches_reannualization(a, a)


def test_cagr_matcher_refuses_degenerate_inputs() -> None:
    assert not matches_reannualization(-1.0, 0.2)
    assert not matches_reannualization(0.2, -1.5)
    assert not matches_reannualization(0.0, 0.2)
    assert not matches_reannualization(0.2, 0.0)
    assert not matches_reannualization(math.nan, 0.2)
    assert not matches_reannualization(math.inf, 0.2)


def test_sharpe_reannualization_matches_in_both_directions() -> None:
    s = 1.5
    t = s * math.sqrt(REANNUALIZATION_FACTOR)
    assert matches_sharpe_reannualization(s, t)
    assert matches_sharpe_reannualization(t, s)
    assert not matches_sharpe_reannualization(s, 1.1 * s)
    assert not matches_sharpe_reannualization(s, s)
    assert not matches_sharpe_reannualization(0.0, s)
    assert not matches_sharpe_reannualization(s, 0.0)
    assert not matches_sharpe_reannualization(s, -t)


def test_the_match_precision_is_three_significant_figures() -> None:
    assert ANNUALIZATION_MATCH_SIG_FIGS == 3
    s = 1.5
    just_off = s * math.sqrt(REANNUALIZATION_FACTOR) * 1.02
    assert not matches_sharpe_reannualization(s, just_off)


# ---------------------------------------------------------------------- matrix


def test_matrix_findings_match_the_fixture_design() -> None:
    findings, observations = classify_matrix(_matrix())
    assert _by_label(findings, "SYN-A") == {}
    b = _by_label(findings, "SYN-B")
    assert {k: v.bucket for k, v in b.items()} == {
        "allocations_live_baseline.cumulative_return": "unexplained",
        "scenario_composer_book.sharpe": "annualization_convention",
        "allocations_strategies_panel.state": "unexplained",
        "cross_store": "unexplained",
    }
    assert b["cross_store"].kind == "cross_store"
    assert {f.kind for f in b.values() if f.subject != "cross_store"} == {"surface"}
    c = _by_label(findings, "SYN-C")
    assert {k: v.bucket for k, v in c.items()} == {
        "scenario_composer_route.cagr": "annualization_convention",
        "owner_list_card.sharpe": "unexplained",
    }
    assert len(findings) == 6
    obs = {(o.account_label, o.surface, o.reason) for o in observations}
    assert {o for o in obs if o[0] == "SYN-A"} == {
        ("SYN-A", "share_card", "not_rendered_while_unpublished"),
        ("SYN-A", "factsheet_pdf", "not_rendered_while_unpublished"),
        ("SYN-A", "discovery_card", "not_rendered_while_unpublished"),
    }
    assert ("SYN-B", "scenario_composer_route", "not_compared:unit_view") in obs
    assert {o for o in obs if o[0] == "SYN-B"} == {("SYN-B", "scenario_composer_route", "not_compared:unit_view")}


def test_the_synthetic_gap_is_five_tolerances() -> None:
    cells = {c["surface"]: c for c in _matrix()["accounts"][1]["cells"]}
    gap = abs(
        cells["allocations_live_baseline"]["figures"]["cumulative_return"]
        - cells["factsheet"]["figures"]["cumulative_return"]
    )
    assert gap == pytest.approx(5 * MT5_PARITY_TOLERANCE)


def test_matrix_finding_ids_are_sequential_sorted_and_deterministic() -> None:
    first, _ = classify_matrix(_matrix())
    second, _ = classify_matrix(_matrix())
    assert first == second
    assert [f.id for f in first] == [f"F-155-{i:02d}" for i in range(1, len(first) + 1)]
    keys = [(f.kind, f.account_label, f.subject) for f in first]
    assert keys == sorted(keys)
    assert all(f.bucket in BUCKET_LABELS for f in first)


def test_matrix_leads_name_surfaces_and_never_a_raw_figure() -> None:
    findings, observations = classify_matrix(_matrix())
    for f in findings:
        assert f.lead
        assert scan_tracked_text(f.lead) == (), (f.id, scan_tracked_text(f.lead))
    for o in observations:
        assert scan_tracked_text(o.reason) == ()
    leads = {f.subject: f.lead for f in findings if f.account_label == "SYN-B"}
    assert "TypeError" in leads["allocations_strategies_panel.state"]
    assert "toStrategyRows" in leads["allocations_strategies_panel.state"]
    assert "2 of 40" in leads["cross_store"]
    assert "2026-10-12" in leads["cross_store"]
    assert "factsheet" in leads["allocations_live_baseline.cumulative_return"]
    assert "figure gate disagrees across surfaces" in {
        f.lead for f in findings if f.subject == "owner_list_card.sharpe"
    }.pop()


def test_the_reference_falls_back_to_the_first_value_cell_and_the_lead_says_so() -> None:
    matrix = _matrix()
    syn_b = matrix["accounts"][1]
    for cell in syn_b["cells"]:
        if cell["surface"] == "factsheet":
            cell["state"] = "error"
            cell["reason"] = "NotFound"
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert "factsheet.state" in b
    # the first owner-visible value cell in surface-id order is share_card
    lead = b["scenario_composer_book.sharpe"].lead
    assert "share_card" in lead
    assert "fallback" in lead


def test_a_figure_the_factsheet_lacks_is_still_compared_across_the_other_cells() -> None:
    """One anchor for every figure failed open: with the factsheet gone, a gap on a
    figure the next cell does not carry vanished."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "factsheet":
            cell["state"] = "error"
            cell["reason"] = "NotFound"
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    # share_card carries no cumulative return, so the anchor for that figure is the
    # live baseline (0.25); the three cells that agree with each other are the ones named
    cum = {k for k in b if k.endswith(".cumulative_return")}
    assert cum == {
        "scenario_composer_book.cumulative_return",
        "owner_list_card.cumulative_return",
        "discovery_card.cumulative_return",
    }
    assert "fallback" in b["owner_list_card.cumulative_return"].lead


def test_a_null_gate_state_on_the_first_cell_does_not_hide_a_mixed_gate() -> None:
    matrix = _matrix()
    cells = {c["surface"]: c for c in matrix["accounts"][1]["cells"]}
    cells["factsheet"]["figure_states"]["sharpe"] = None
    cells["owner_list_card"]["figure_states"]["sharpe"] = "withheld"
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert b["owner_list_card.sharpe"].bucket == "unexplained"
    assert "figure gate disagrees across surfaces" in b["owner_list_card.sharpe"].lead
    assert "fallback" in b["owner_list_card.sharpe"].lead


def test_a_warned_status_lead_does_not_claim_no_guard_exists_anywhere() -> None:
    row = {
        "computation_status": "complete_with_warnings",
        "computed_at": "2026-11-14T03:00:00Z",
        "data_quality_flags": {"cumulative_method": "geometric"},
    }
    _, findings = classify_account_flags("SYN-A", row)
    assert "closed guard table" in findings[0].lead


def test_a_value_cell_never_hides_behind_another_surface_sharing_its_state() -> None:
    matrix = _matrix()
    # last_return_date moves on one surface
    for cell in matrix["accounts"][0]["cells"]:
        if cell["surface"] == "allocations_live_baseline":
            cell["figures"]["last_return_date"] = "2026-11-12"
    findings, _ = classify_matrix(matrix)
    a = _by_label(findings, "SYN-A")
    assert list(a) == ["allocations_live_baseline.last_return_date"]
    assert a["allocations_live_baseline.last_return_date"].bucket == "unexplained"
    assert "series ends on a different day" in a["allocations_live_baseline.last_return_date"].lead


def test_a_value_cell_with_no_cumulative_return_beside_a_surface_that_has_one_is_a_finding() -> None:
    """A null on a surface built to carry the figure was skipped silently, so a surface
    that lost its number read as agreeing with the rest."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "owner_list_card":
            cell["figures"]["cumulative_return"] = None
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert [s for s, f in b.items() if "presence" in f.lead] == ["owner_list_card.cumulative_return"]
    assert b["owner_list_card.cumulative_return"].bucket == "unexplained"
    assert "figure presence disagrees across surfaces" in b["owner_list_card.cumulative_return"].lead


def test_a_value_cell_with_no_last_return_date_beside_a_surface_that_has_one_is_a_finding() -> None:
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "scenario_composer_book":
            cell["figures"]["last_return_date"] = None
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert [s for s, f in b.items() if "presence" in f.lead] == ["scenario_composer_book.last_return_date"]
    assert "figure presence disagrees across surfaces" in b["scenario_composer_book.last_return_date"].lead


def _figures_like_the_harness_builds_them(cell: dict[str, Any]) -> None:
    """The panel and the share card as the surfaces test emits them: a value cell whose
    figures NOT built by design stay null, and whose carried figures are shown."""
    cell["state"] = "value"
    cell["figures"].update(cumulative_return=None, last_return_date=None, cagr=None, sharpe=1.5, max_drawdown=-0.05)
    cell["figure_states"].update(cagr=None, sharpe="shown", max_drawdown="shown")
    if cell["surface"] == "share_card":
        cell["figures"]["cagr"] = 0.3
        cell["figure_states"]["cagr"] = "shown"


def test_a_surface_built_without_the_figure_is_not_a_presence_finding() -> None:
    """share_card and the strategies panel are filled from NO_FIGURES for
    cumulative_return and last_return_date, the panel and the live baseline carry no
    cagr: null there is the design."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] in ("share_card", "allocations_strategies_panel"):
            _figures_like_the_harness_builds_them(cell)
        if cell["surface"] == "allocations_live_baseline":
            cell["figures"]["cagr"] = None
            cell["figure_states"]["cagr"] = None
    findings, _ = classify_matrix(matrix)
    assert not [f for f in findings if "presence" in f.lead]


@pytest.mark.parametrize(
    ("surface", "figure"),
    [
        ("owner_list_card", "max_drawdown"),
        ("scenario_composer_book", "max_drawdown"),
        ("owner_list_card", "sharpe"),
        ("owner_list_card", "cagr"),
        ("share_card", "max_drawdown"),
    ],
)
@pytest.mark.parametrize("keep_gate", [True, False])
def test_a_surface_that_drops_a_figure_it_is_built_to_carry_is_a_finding(
    surface: str, figure: str, keep_gate: bool
) -> None:
    """A dash where the factsheet shows a drawdown, Sharpe or CAGR read as agreement,
    because only cumulative_return and last_return_date had a presence rule. The gate
    state is either left as it was or nulled the way the harness emits it for a null
    drawdown; neither may hide the gap."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == surface:
            cell["figures"][figure] = None
            if not keep_gate and figure == "max_drawdown":
                cell["figure_states"][figure] = None
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert [s for s, f in b.items() if "presence" in f.lead] == [f"{surface}.{figure}"]
    assert b[f"{surface}.{figure}"].bucket == "unexplained"


def test_a_figure_the_cells_own_gate_withholds_is_not_a_presence_finding() -> None:
    """Only a `withheld` gate legitimately shows no CAGR or Sharpe; the gate-disagreement
    rule owns that, so presence must not double-report it."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "owner_list_card":
            for figure in ("cagr", "sharpe"):
                cell["figures"][figure] = None
                cell["figure_states"][figure] = "withheld"
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert not [s for s, f in b.items() if "presence" in f.lead]
    assert {"owner_list_card.cagr", "owner_list_card.sharpe"} <= set(b)


def test_a_short_gate_does_not_withhold_a_figure_so_a_dash_under_it_is_a_presence_finding() -> None:
    """src/lib/figure-gate.ts: the window qualifies a figure (short or full) and never
    withholds one. A `short` cell that shows a dash beside a sibling's value is a gap, not
    a legitimate withholding; reading it as agreement is a false parity pass."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "owner_list_card":
            for figure in ("cagr", "sharpe"):
                cell["figures"][figure] = None
                cell["figure_states"][figure] = "short"
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert {s for s, f in b.items() if "presence" in f.lead} == {
        "owner_list_card.cagr", "owner_list_card.sharpe",
    }


@pytest.mark.parametrize("figure", ["cagr", "sharpe"])
@pytest.mark.parametrize("change", ["dropped", "tripled"])
@pytest.mark.parametrize("owner_gate", ["short", None])
def test_with_every_gate_short_a_dropped_or_tripled_cagr_or_sharpe_is_a_finding(
    figure: str, change: str, owner_gate: str | None
) -> None:
    """An account in its first year (60 observations / 90 days up to one year) has `short`
    on every surface, and the figure is still displayed. CAGR and Sharpe parity must run
    there: a surface that drops or triples the figure beside the factsheet is a finding.
    A null (unknown-record) gate on the offending cell still shows the figure, too."""
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        for name in ("cagr", "sharpe"):
            if cell["figure_states"][name] == "shown":
                cell["figure_states"][name] = "short"
        if cell["surface"] == "owner_list_card":
            cell["figure_states"][figure] = owner_gate
            cell["figures"][figure] = None if change == "dropped" else cell["figures"][figure] * 3
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert b[f"owner_list_card.{figure}"].bucket == "unexplained"
    # the baseline finding on the composer book's Sharpe must survive the gate change
    assert "scenario_composer_book.sharpe" in b


def test_an_account_every_surface_withholds_is_an_observation_not_silence() -> None:
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["state"] == "value":
            cell["state"] = "withheld"
    findings, observations = classify_matrix(matrix)
    assert not [f for f in findings if f.account_label == "SYN-B" and f.kind == "surface"
                and "presence" in f.lead]
    assert [
        (o.surface, o.reason) for o in observations if o.account_label == "SYN-B"
        and o.surface == "all_surfaces"
    ] == [("all_surfaces", "withheld:no_surface_shows_a_figure")]
    assert not [o for o in observations if o.account_label == "SYN-A" and o.surface == "all_surfaces"]


def test_max_drawdown_and_unreannualized_cagr_are_unexplained() -> None:
    matrix = _matrix()
    for cell in matrix["accounts"][0]["cells"]:
        if cell["surface"] == "owner_list_card":
            cell["figures"]["max_drawdown"] += 3 * MT5_PARITY_TOLERANCE
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "scenario_composer_book":
            cell["figures"]["cagr"] = 0.5
    findings, _ = classify_matrix(matrix)
    assert _by_label(findings, "SYN-A")["owner_list_card.max_drawdown"].bucket == "unexplained"
    assert _by_label(findings, "SYN-B")["scenario_composer_book.cagr"].bucket == "unexplained"


def test_a_withheld_figure_on_every_owner_visible_value_cell_is_consistent() -> None:
    # SYN-A withholds cagr on every cell that renders it: no finding, by design
    findings, _ = classify_matrix(_matrix())
    assert not [f for f in findings if f.account_label == "SYN-A"]


def test_short_against_shown_is_a_gate_disagreement() -> None:
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "owner_list_card":
            cell["figure_states"]["sharpe"] = "short"
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert b["owner_list_card.sharpe"].bucket == "unexplained"
    assert "figure gate disagrees across surfaces" in b["owner_list_card.sharpe"].lead


def test_a_withheld_state_cell_beside_a_shown_figure_is_not_a_silent_pass() -> None:
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "owner_list_card":
            cell["state"] = "withheld"
            cell["reason"] = "x:no_figures"
            cell["figures"] = {k: None for k in cell["figures"]}
            cell["figure_states"] = {k: None for k in cell["figure_states"]}
    findings, _ = classify_matrix(matrix)
    b = _by_label(findings, "SYN-B")
    assert b["owner_list_card.state"].bucket == "unexplained"


def test_unknown_cell_state_or_visibility_fails_closed() -> None:
    matrix = _matrix()
    matrix["accounts"][0]["cells"][0]["state"] = "mystery"
    with pytest.raises(ValueError, match="SYN-A"):
        classify_matrix(matrix)
    matrix = _matrix()
    matrix["accounts"][0]["cells"][1]["visibility"] = "sometimes"
    with pytest.raises(ValueError, match="share_card"):
        classify_matrix(matrix)
    matrix = _matrix()
    matrix["accounts"][0]["cells"][0]["figure_states"]["cagr"] = "mostly"
    with pytest.raises(ValueError):
        classify_matrix(matrix)
    matrix = _matrix()
    matrix["accounts"][0]["cells"][0]["figures"]["sharpe"] = "3.1"
    with pytest.raises(ValueError):
        classify_matrix(matrix)
    matrix = _matrix()
    matrix["matrix_version"] = 2
    with pytest.raises(ValueError):
        classify_matrix(matrix)


def test_an_account_without_a_label_is_refused() -> None:
    matrix = _matrix()
    matrix["accounts"][0]["label"] = ""
    with pytest.raises(mpf.LabelMissing):
        classify_matrix(matrix)
    matrix = _matrix()
    del matrix["accounts"][1]["label"]
    with pytest.raises(mpf.LabelMissing):
        classify_matrix(matrix)


def test_not_rendered_wins_over_state_so_the_pdf_cell_is_an_observation() -> None:
    _, observations = classify_matrix(_matrix())
    assert any(o.surface == "factsheet_pdf" for o in observations)


def test_not_applicable_is_an_observation_with_its_reason() -> None:
    matrix = _matrix()
    for cell in matrix["accounts"][1]["cells"]:
        if cell["surface"] == "allocations_strategies_panel":
            cell["state"] = "not_applicable"
            cell["reason"] = "not_own_capital"
    findings, observations = classify_matrix(matrix)
    assert "allocations_strategies_panel.state" not in _by_label(findings, "SYN-B")
    assert ("SYN-B", "allocations_strategies_panel", "not_applicable:not_own_capital") in {
        (o.account_label, o.surface, o.reason) for o in observations
    }


def test_cross_store_with_no_difference_is_not_a_finding() -> None:
    matrix = _matrix()
    matrix["accounts"][1]["cross_store"] = {"days_compared": 40, "days_differing": 0, "first_differing_day": None}
    findings, _ = classify_matrix(matrix)
    assert "cross_store" not in _by_label(findings, "SYN-B")


def test_number_findings_is_idempotent_and_orders_by_kind_account_subject() -> None:
    findings, _ = classify_matrix(_matrix())
    shuffled = tuple(reversed(findings))
    assert number_findings(shuffled) == findings
    assert number_findings(number_findings(shuffled)) == findings


# ------------------------------------------------------------- neuter, byte restore


def test_neuter_the_reference_figure_moves_findings_and_the_restore_is_exact(tmp_path: Path) -> None:
    backup = MATRIX_FIXTURE.read_bytes()
    original_sha = hashlib.sha256(backup).hexdigest()
    baseline, _ = classify_matrix(json.loads(backup))
    assert not [f for f in baseline if f.account_label == "SYN-A"]

    copy = tmp_path / "matrix_copy.json"
    neutered = json.loads(backup)
    for cell in neutered["accounts"][0]["cells"]:
        if cell["surface"] == "factsheet":
            cell["figures"]["cumulative_return"] += 2 * MT5_PARITY_TOLERANCE
    copy.write_text(json.dumps(neutered), encoding="utf-8")
    moved, _ = classify_matrix(json.loads(copy.read_bytes()))
    assert [f for f in moved if f.account_label == "SYN-A"], "the neutered copy must produce findings"

    copy.write_bytes(backup)
    assert hashlib.sha256(copy.read_bytes()).hexdigest() == original_sha
    restored, _ = classify_matrix(json.loads(copy.read_bytes()))
    assert restored == baseline
    # the repo fixture itself was never touched
    assert hashlib.sha256(MATRIX_FIXTURE.read_bytes()).hexdigest() == original_sha


# --------------------------------------------------------------------- scanner

_ZERO_UUID = "00000000-0000-4000-8000-0000000000c1"
_HOME = "/" + "Users" + "/" + "someone" + "/" + "repo"


def test_each_scanner_rule_fires_on_one_planted_string() -> None:
    planted = {
        "uuid": "id 12345678-1234-1234-1234-123456789abc here",
        "home_path": "see " + _HOME + " now",
        "digit_run_5": "balance 1234567 total",
        "long_hex": "digest deadbeefdeadbeefdeadbeef end",
        "sig_figs_gt_3": "ratio 1234.5 end",
        "thousands_separated": "amount 1,234 end",
    }
    for rule, text in planted.items():
        hits = scan_tracked_text(text)
        assert rule in hits, (rule, hits)
        for marker in ("12345678-1234", _HOME, "1234567", "deadbeef", "1234.5", "1,234"):
            assert marker not in "".join(hits), "the scanner never returns matched text"
    assert scan_tracked_text("clean prose with a date 2026-11-02 only") == ()


def test_allowed_shapes_do_not_fire() -> None:
    for text in (
        _ZERO_UUID,
        "| SYN-A | 2026-11-02 |",
        "2026-11-02",
        "unmeasured (155.1 reading owns it)",
        "155.2 owns the sign-off, and so does 164.6.6.2.1",
        "computed 2026-11-14T03:00Z",
    ):
        assert scan_tracked_text(text) == (), text


def test_ratio_3sf_output_never_fires_at_any_magnitude() -> None:
    for x in (
        0.00312, 0.000412, -0.000412, 0.0000123, 1e-9, 0.5, 1.0, 12.3, 123.0, 999.0,
        123456.0, 1.5e9, -2.5e-12, 0.1, 100.0, 0.001, 0.00001,
    ):
        rendered = ratio_3sf(x)
        assert scan_tracked_text(f"gap {rendered} end") == (), (x, rendered)


def test_the_zero_uuid_does_not_trip_the_digit_rules_but_a_real_uuid_trips_uuid_only() -> None:
    assert scan_tracked_text(f"row {_ZERO_UUID} done") == ()
    assert scan_tracked_text("row 8b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d done") == ("uuid",)


def test_fixture_profile_runs_only_uuid_and_home_path() -> None:
    text = "amount 1,234 and 1234567 and 1234.5 and deadbeefdeadbeefdeadbeef"
    assert scan_tracked_text(text, "fixture") == ()
    assert scan_tracked_text(text, "record") != ()
    assert scan_tracked_text("x 12345678-1234-1234-1234-123456789abc", "fixture") == ("uuid",)
    assert scan_tracked_text("p " + _HOME, "fixture") == ("home_path",)
    assert scan_tracked_text(_ZERO_UUID, "fixture") == ()


def test_the_scanner_result_is_sorted_rule_names_only() -> None:
    hits = scan_tracked_text("1234567 and 1,234 and 1234.5")
    assert hits == tuple(sorted(hits))
    assert set(hits) <= {
        "uuid", "home_path", "digit_run_5", "long_hex", "sig_figs_gt_3", "thousands_separated",
    }


def test_a_dot_after_a_letter_is_not_a_decimal_point() -> None:
    assert scan_tracked_text("acct.1234567 end") == ("digit_run_5",)


def test_a_decimals_fraction_digits_are_not_a_digit_run() -> None:
    assert scan_tracked_text("ratio 0.000412 end") == ()
    # but a long fraction is still too precise
    assert scan_tracked_text("ratio 0.12345678 end") == ("sig_figs_gt_3",)
    assert scan_tracked_text("ratio 12345.6 end") == ("digit_run_5", "sig_figs_gt_3")
