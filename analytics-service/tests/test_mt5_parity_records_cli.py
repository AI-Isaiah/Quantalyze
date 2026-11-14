"""Plan 155-08 Task 2: the census and findings renderers and the records CLI
(PARITY-03, PARITY-04, success criterion 5).

The CLI is called in-process. Runbook paths resolve from this file, so the tests run
from ``analytics-service/`` and from CI alike.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from scripts.mt5_parity_records import main
from services import mt5_parity_findings as mpf
from services.mt5_parity import MT5_INCEPTION_IDENTITY_BAND, MT5_PARITY_TOLERANCE
from services.mt5_parity_capture import load_bundle, seal_capture
from services.mt5_parity_findings import (
    LabelMissing,
    render_census_markdown,
    render_findings_markdown,
    scan_tracked_text,
)

SERVICE_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = SERVICE_ROOT / "tests" / "fixtures" / "mt5_parity"
RUNBOOK = SERVICE_ROOT.parent / "docs" / "runbooks" / "mt5-parity"
CENSUS = FIXTURES / "census_synthetic.json"
MATRIX = FIXTURES / "surface_matrix_synthetic.json"
BUNDLE = FIXTURES / "capture_synthetic.json"


def _census() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(CENSUS.read_text(encoding="utf-8"))
    return loaded


def _render(doc: dict[str, Any] | None = None) -> str:
    d = doc or _census()
    return render_census_markdown(d["census_accounts"], d["census_edges"], d["labels"])


def _unsealed_census_run_dir(tmp_path: Path, doc: dict[str, Any] | None = None) -> Path:
    d = doc or _census()
    run = tmp_path / "run"
    (run / "raw").mkdir(parents=True)
    (run / "raw" / "census-accounts.json").write_text(json.dumps(d["census_accounts"]), encoding="utf-8")
    (run / "raw" / "census-edges.json").write_text(json.dumps(d["census_edges"]), encoding="utf-8")
    (run / "labels.json").write_text(json.dumps(d["labels"]), encoding="utf-8")
    return run


def _sealed_census_run_dir(tmp_path: Path, doc: dict[str, Any] | None = None) -> Path:
    """A run directory whose census files and labels are SEALED (the capture bundle's
    own slices ride along, because the seal refuses a bundle without them)."""
    d = doc or _census()
    run = load_bundle(BUNDLE, tmp_path / "run")
    (run / "raw" / "census-accounts.json").write_text(json.dumps(d["census_accounts"]), encoding="utf-8")
    (run / "raw" / "census-edges.json").write_text(json.dumps(d["census_edges"]), encoding="utf-8")
    (run / "labels.json").write_text(json.dumps(d["labels"]), encoding="utf-8")
    seal_capture(run)
    return run


def _manifest_digest(run: Path) -> str:
    return (run / "sealed" / "manifest.json.sha256").read_text(encoding="ascii").strip()


def _findings_run_dir(
    tmp_path: Path, matrix: dict[str, Any], *, digest: str | None = None, bind: bool = True
) -> Path:
    """A sealed run directory plus a surface matrix. ``bind`` stamps the matrix with
    the sealed manifest's digest (what the surface harness writes); ``digest`` overrides it."""
    run = load_bundle(BUNDLE, tmp_path / "frun")
    seal_capture(run)
    if bind:
        matrix = {**matrix, "capture_manifest_sha256": digest or _manifest_digest(run)}
    (run / "derived").mkdir()
    (run / "derived" / "surface-matrix.json").write_text(json.dumps(matrix), encoding="utf-8")
    return run


def _syn_a_matrix(planted: bool = True) -> dict[str, Any]:
    full: dict[str, Any] = json.loads(MATRIX.read_text(encoding="utf-8"))
    matrix = copy.deepcopy(full)
    matrix["accounts"] = [full["accounts"][0]]
    if planted:
        for cell in matrix["accounts"][0]["cells"]:
            if cell["surface"] == "allocations_live_baseline":
                cell["figures"]["cumulative_return"] += 2 * MT5_PARITY_TOLERANCE
    return matrix


# --------------------------------------------------------------- census renderer


def test_census_has_one_row_per_label_and_omits_the_excluded_ordinal() -> None:
    text = _render()
    rows = [ln for ln in text.splitlines() if ln.startswith("| SYN-")]
    labels = [ln.split("|")[1].strip() for ln in rows]
    assert labels.count("SYN-A") == 2 and labels.count("SYN-B") == 3  # account row + edge rows
    assert "EUR" not in text, "the excluded ordinal's row never renders"
    account_rows = [ln for ln in rows if "unpublished" in ln or "published" in ln]
    assert len(account_rows) == 2


def test_census_account_row_fields() -> None:
    text = _render()
    a = next(ln for ln in text.splitlines() if ln.startswith("| SYN-A") and "cumulative_method" in ln)
    for expected in (
        "USD",
        "unpublished: not rendered on published-only surfaces",
        "2026-11-02",
        "| yes |",
        "2026-11-14T03:00Z",
        "cumulative_method, marks_since",
        "unmeasured (155.1 reading owns it)",
        "0.0004 (within band)",
        " 39 ",
        " 10 ",
    ):
        assert expected in a, expected
    b = next(ln for ln in text.splitlines() if ln.startswith("| SYN-B") and "cumulative_method" in ln)
    assert "BTC, native unit marked" in b
    assert "| no |" in b
    assert "0.0234 (outside band)" in b
    assert "complete_with_warnings" in b
    assert "mark_gap_days" in b


def test_a_null_account_currency_renders_not_available() -> None:
    doc = _census()
    doc["census_accounts"][0]["account_currency"] = None
    row = next(ln for ln in _render(doc).splitlines() if ln.startswith("| SYN-A") and "cumulative_method" in ln)
    assert row.split("|")[2].strip() == "n/a"
    doc["census_accounts"][0]["account_currency"] = "USDTUSDT"
    _render(doc)
    doc["census_accounts"][0]["account_currency"] = "usd"
    with pytest.raises(ValueError):
        _render(doc)


def test_the_identity_band_judgement_reads_the_imported_band() -> None:
    doc = _census()
    for row in doc["census_accounts"]:
        if row["key_ordinal"] == "k1":
            row["identity_ratio"] = MT5_INCEPTION_IDENTITY_BAND  # inclusive, as the engine's leg
    assert "(within band)" in next(
        ln for ln in _render(doc).splitlines() if ln.startswith("| SYN-A") and "cumulative_method" in ln
    )
    for row in doc["census_accounts"]:
        if row["key_ordinal"] == "k1":
            row["identity_ratio"] = None
    assert "not measurable" in _render(doc)


def test_edges_table_judges_the_weekend_window_from_the_instant() -> None:
    text = _render()
    a_edge = next(ln for ln in text.splitlines() if ln.startswith("| SYN-A | 2026-11-06"))
    assert a_edge.endswith("| attested |")
    assert "0.00312" in a_edge and "0.0833" in a_edge
    b_edge = next(ln for ln in text.splitlines() if ln.startswith("| SYN-B | 2026-11-06"))
    assert b_edge.endswith("| outside weekend window |")
    assert "-0.000412" in b_edge
    no_mark = next(ln for ln in text.splitlines() if ln.startswith("| SYN-B | 2026-11-13"))
    assert no_mark.endswith("| no mark |")


def test_footer_states_the_examined_counts() -> None:
    assert _render().rstrip().endswith("keys_examined: 3; rows_examined: 4")


def test_census_output_passes_the_record_scan() -> None:
    assert scan_tracked_text(_render(), "record") == ()


def test_an_ordinal_with_no_label_is_refused() -> None:
    doc = _census()
    del doc["labels"]["k2"]
    with pytest.raises(LabelMissing):
        _render(doc)
    doc = _census()
    doc["census_edges"].append({"key_ordinal": "k9", "friday": None})
    with pytest.raises(LabelMissing):
        _render(doc)


def test_a_truncated_census_is_refused() -> None:
    doc = _census()
    doc["census_accounts"] = [r for r in doc["census_accounts"] if r["key_ordinal"] != "all"]
    with pytest.raises(ValueError, match="all"):
        _render(doc)
    doc = _census()
    doc["census_accounts"] = [r for r in doc["census_accounts"] if r["key_ordinal"] != "k1"]
    with pytest.raises(ValueError, match="does not match"):
        _render(doc)


def test_a_real_server_name_is_never_rendered() -> None:
    doc = _census()
    doc["census_accounts"][0]["server"] = "Broker-Live-7"
    with pytest.raises(ValueError, match="server"):
        _render(doc)


def test_cells_are_coerced_never_echoed() -> None:
    doc = _census()
    doc["census_accounts"][0]["record_observations"] = "not a number"
    with pytest.raises(ValueError):
        _render(doc)
    doc = _census()
    doc["census_accounts"][0]["computed_at"] = "2026-11-14 03:00:00"  # no offset
    with pytest.raises(Exception, match="offset"):
        _render(doc)
    doc = _census()
    doc["census_accounts"][0]["flag_keys"] = ["a key with spaces and 123456789"]
    with pytest.raises(ValueError):
        _render(doc)


# --------------------------------------------------------------- findings renderer


def test_findings_render_is_a_proposal_and_passes_the_scan() -> None:
    findings, observations = mpf.classify_matrix(json.loads(MATRIX.read_text(encoding="utf-8")))
    text = render_findings_markdown(findings, observations, (), "synthetic")
    assert "PROPOSAL" in text
    assert "SYNTHETIC INPUT" in text
    assert all(f.id in text for f in findings)
    assert scan_tracked_text(text, "record") == ()
    with pytest.raises(ValueError):
        render_findings_markdown(findings, observations, (), "live")


# ------------------------------------------------------------------------- the CLI


def test_cli_census_writes_the_record(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    run = _sealed_census_run_dir(tmp_path)
    out = tmp_path / "census.md"
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 0
    assert out.read_text(encoding="utf-8") == _render()
    assert capsys.readouterr().err == ""


def test_cli_census_refuses_a_missing_label_with_exit_2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    doc = _census()
    del doc["labels"]["k3"]  # an ordinal the bundle does not carry, so the seal accepts it
    run = _sealed_census_run_dir(tmp_path, doc)
    out = tmp_path / "census.md"
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "LabelMissing" in capsys.readouterr().err
    assert not out.exists()


def test_cli_census_writes_nothing_when_the_rendering_leaks(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    doc = _census()
    doc["census_accounts"][0]["record_span_days"] = 1234567
    run = _sealed_census_run_dir(tmp_path, doc)
    out = tmp_path / "census.md"
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 1
    err = capsys.readouterr().err
    assert "digit_run_5" in err and "1234567" not in err
    assert not out.exists()


def test_cli_census_renders_the_sealed_copy_not_a_raw_file_edited_after_sealing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A raw census row edited after sealing used to reach the tracked record. The
    seal binds the verified copy, so the record is built from that and nothing else."""
    run = _sealed_census_run_dir(tmp_path)
    rows = json.loads((run / "raw" / "census-accounts.json").read_text(encoding="utf-8"))
    rows[0]["record_span_days"] = 77
    (run / "raw" / "census-accounts.json").write_text(json.dumps(rows), encoding="utf-8")
    raw_labels = json.loads((run / "labels.json").read_text(encoding="utf-8"))
    raw_labels["k1"] = "SYN-Z"
    (run / "labels.json").write_text(json.dumps(raw_labels), encoding="utf-8")
    out = tmp_path / "census.md"
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 0
    assert out.read_text(encoding="utf-8") == _render()
    assert "SYN-Z" not in out.read_text(encoding="utf-8")
    assert capsys.readouterr().err == ""


def test_cli_census_refuses_a_sealed_census_file_that_no_longer_matches_its_digest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run = _sealed_census_run_dir(tmp_path)
    target = run / "sealed" / "census-accounts.json"
    backup = target.read_bytes()  # byte backup, never git
    target.write_bytes(backup.replace(b"k1", b"k9", 1))
    out = tmp_path / "census.md"
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "CaptureRefused" in capsys.readouterr().err
    assert not out.exists()
    target.write_bytes(backup)
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 0


def test_cli_census_refuses_a_run_directory_that_was_never_sealed(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run = _unsealed_census_run_dir(tmp_path)
    out = tmp_path / "census.md"
    assert main(["census", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "CaptureRefused" in capsys.readouterr().err
    assert not out.exists()


def test_cli_findings_refuses_a_matrix_that_carries_no_manifest_digest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run = _findings_run_dir(tmp_path, _syn_a_matrix(), bind=False)
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 2
    err = capsys.readouterr().err
    assert "MatrixMismatch" in err and "capture_manifest_sha256" in err
    assert not out.exists()


def test_cli_findings_refuses_a_matrix_built_from_another_capture_with_the_same_labels(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The matrix of an earlier capture carries the same labels but another manifest
    digest. Label equality alone classified it against the new capture."""
    older = tmp_path / "older"
    older.mkdir()
    data = json.loads(BUNDLE.read_text(encoding="utf-8"))
    data["raw"]["capture-marks.json"][0]["slice_rows"][0]["nav_usd"] += 1
    changed = older / "bundle.json"
    changed.write_text(json.dumps(data), encoding="utf-8")
    other_run = load_bundle(changed, older / "run")
    seal_capture(other_run)
    stale = _manifest_digest(other_run)

    run = _findings_run_dir(tmp_path, _syn_a_matrix(), digest=stale)
    assert _manifest_digest(run) != stale  # vacuity guard: the captures really differ
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "MatrixMismatch" in capsys.readouterr().err
    assert not out.exists()


def test_cli_findings_on_a_planted_divergence(tmp_path: Path) -> None:
    run = _findings_run_dir(tmp_path, _syn_a_matrix())
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert "F-155-01 [surface] SYN-A allocations_live_baseline.cumulative_return, bucket unexplained" in text
    assert "- cumulative_method: explained_acceptable" in text
    assert "- marks_since: explained_acceptable" in text
    assert "SYN-A share_card: not_rendered_while_unpublished" in text
    assert "SYNTHETIC INPUT" in text
    assert scan_tracked_text(text, "record") == ()


def test_cli_findings_refuses_a_synthetic_capture_beside_a_real_mode_matrix(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Provenance rides with the capture: a synthetic capture judged against a matrix that
    says `real` would be rendered as a real record."""
    run = _findings_run_dir(tmp_path, {**_syn_a_matrix(), "mode": "real"})
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "mixed provenance" in capsys.readouterr().err
    assert not out.exists()


def test_cli_findings_refuses_a_real_capture_beside_a_synthetic_mode_matrix(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The mirror: a real run dir (no provenance marker) with a matrix labelled synthetic
    would be rendered as a harmless synthetic record."""
    run = load_bundle(BUNDLE, tmp_path / "frun")
    (run / "provenance.json").unlink()  # a real run dir carries no marker
    seal_capture(run)
    matrix = {**_syn_a_matrix(), "capture_manifest_sha256": _manifest_digest(run)}
    assert matrix["mode"] == "synthetic"  # vacuity guard
    (run / "derived").mkdir()
    (run / "derived" / "surface-matrix.json").write_text(json.dumps(matrix), encoding="utf-8")
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "mixed provenance" in capsys.readouterr().err
    assert not out.exists()


def test_cli_findings_refuses_a_matrix_with_an_extra_account(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    matrix = _syn_a_matrix()
    extra = copy.deepcopy(matrix["accounts"][0])
    extra["label"] = "SYN-Z"
    matrix["accounts"].append(extra)
    run = _findings_run_dir(tmp_path, matrix)
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "MatrixMismatch" in capsys.readouterr().err
    assert not out.exists()


def test_cli_findings_refuses_a_missing_matrix(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run = load_bundle(BUNDLE, tmp_path / "frun")
    seal_capture(run)
    out = tmp_path / "findings.md"
    assert main(["findings", "--run-dir", str(run), "--out", str(out)]) == 2
    assert "surface-matrix.json" in capsys.readouterr().err


def test_cli_seal_and_its_refusal(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    run = load_bundle(BUNDLE, tmp_path / "srun")
    assert main(["seal", "--run-dir", str(run)]) == 0
    assert (run / "sealed" / "manifest.json").exists()
    (run / "raw" / "bind-after.json").unlink()
    assert main(["seal", "--run-dir", str(run)]) == 2
    assert "CaptureRefused" in capsys.readouterr().err


def test_cli_scan_exit_codes_and_output(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    clean = tmp_path / "census.md"
    clean.write_text(_render(), encoding="utf-8")
    assert main(["scan", str(clean)]) == 0
    assert capsys.readouterr().out == "scanned: 1 file(s), skipped for suffix: 0\n"

    leaking = tmp_path / "leak.md"
    leaking.write_text(_render() + "\namount 4,321,987 here\n", encoding="utf-8")
    assert main(["scan", str(leaking)]) == 1
    out = capsys.readouterr().out
    assert f"{leaking}: thousands_separated" in out
    assert "scanned: 1 file(s)" in out
    assert "4,321,987" not in out

    assert main(["scan", str(tmp_path / "missing.md")]) == 2
    assert "FileNotFoundError" in capsys.readouterr().err


def test_cli_scan_over_zero_files_exits_2_and_says_how_many_were_skipped(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A scan over zero files used to exit 0, so a mistyped directory or a renamed
    suffix read as a clean record. Nothing scanned proves nothing."""
    empty = tmp_path / "empty"
    empty.mkdir()
    assert main(["scan", str(empty)]) == 2
    assert "no file to scan" in capsys.readouterr().err

    (empty / "only.txt").write_text("1234567", encoding="utf-8")
    assert main(["scan", str(empty)]) == 2
    assert "1 file(s) skipped for suffix" in capsys.readouterr().err


def test_cli_scan_recurses_over_md_json_and_sql_only(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "a.json").write_text('{"n": 1234567}', encoding="utf-8")
    (tmp_path / "sub" / "b.txt").write_text("1234567", encoding="utf-8")
    assert main(["scan", str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "a.json: digit_run_5" in out and "b.txt" not in out
    assert "scanned: 1 file(s), skipped for suffix: 1" in out


def test_cli_scan_fixture_profile_passes_the_committed_fixtures_and_runbooks(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["scan", "--profile", "fixture", str(FIXTURES), str(RUNBOOK)]) == 0
    out = capsys.readouterr().out
    assert out.startswith("scanned: ") and out.count("\n") == 1
    assert not out.startswith("scanned: 0 ")


def test_cli_scan_fixture_profile_still_refuses_an_id(tmp_path: Path) -> None:
    bad = tmp_path / "f.json"
    bad.write_text('{"id": "8b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d"}', encoding="utf-8")
    assert main(["scan", "--profile", "fixture", str(bad)]) == 1


def test_cli_render_ordinal_wraps_the_committed_statement(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["render-ordinal", str(RUNBOOK / "capture-marks.sql"), "k2"]) == 0
    text = capsys.readouterr().out.strip()
    assert text.startswith("SELECT")
    assert text.endswith("WHERE q.key_ordinal = 'k2';")
    assert text.count(";") == 1


def test_cli_render_ordinal_refuses_a_bad_ordinal(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["render-ordinal", str(RUNBOOK / "capture-marks.sql"), "k2'; DROP"]) == 2
    assert "ValueError" in capsys.readouterr().err


def test_no_planning_path_is_read_or_written_by_the_records_code() -> None:
    script = (SERVICE_ROOT / "scripts" / "mt5_parity_records.py").read_text(encoding="utf-8")
    assert "phases/155" not in script
    assert ".planning" not in script
    for module in sorted((SERVICE_ROOT / "services").glob("mt5_parity*.py")):
        assert ".planning" not in module.read_text(encoding="utf-8"), module.name
