"""155.2 G5-1: the parity harness refuses a label whose key is not the Report's account.

Why: the label MM3 was bound to a key that is a second key on MM2's account. Gate A then
compared MM2's books with MM3's terminal Report and recorded two failures
(F-155.2-01, F-155.2-02) that were never a parity question: the two sides were different
accounts (155.2-RECHECK-2026-11-23.md, addendum Task A). A mis-bound label must be RED by
NAME (``oracle_account_mismatch``), never bucketed ``unexplained`` and never a pass, and
the logins that prove the mismatch must never be printed or written.

Synthetic only: the logins below are made-up strings; no real amount, login, id or server.
"""

from __future__ import annotations

import codecs
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from scripts.mt5_parity_run import main
from services.mt5_parity import ORACLE_ACCOUNT_MISMATCH, PASSING_BUCKETS, UNEXPLAINED
from services.mt5_parity_report import report_account_matches

SERVICE_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = SERVICE_ROOT / "tests" / "fixtures" / "mt5_parity"
BUNDLE = FIXTURES / "capture_synthetic.json"
WORKSHEET = FIXTURES / "worksheet_synthetic.json"
REPORT = FIXTURES / "report_synthetic.utf16le.html"
RUN_DAY = "2026-11-16"

# A distinctive synthetic login, so a leak of it anywhere is findable by substring.
SYN_LOGIN = "SYNLOGIN-QZX-7"
ACCOUNT_CELL = '<th colspan="2">Account:</th><td colspan="12">0</td>'


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _report_with_account(tmp_path: Path, cell_text: str) -> Path:
    raw = REPORT.read_bytes()
    assert raw.startswith(codecs.BOM_UTF16_LE)
    text = raw[2:].decode("utf-16-le")
    assert text.count(ACCOUNT_CELL) == 1  # anti-vacuity: the header row is really replaced
    text = text.replace(
        ACCOUNT_CELL, f'<th colspan="2">Account:</th><td colspan="12">{cell_text}</td>'
    )
    out = tmp_path / "report.html"
    out.write_bytes(codecs.BOM_UTF16_LE + text.encode("utf-16-le"))
    return out


def _worksheet_bound_to(tmp_path: Path, report: Path) -> Path:
    data = json.loads(WORKSHEET.read_text(encoding="utf-8"))
    sha = hashlib.sha256(report.read_bytes()).hexdigest()
    hits = 0
    for reading in data["accounts"]["SYN-A"]["readings"]:
        if reading["id"] == "all_history_report_sha256":
            reading["value"] = sha
            hits += 1
    assert hits == 1
    out = tmp_path / "worksheet.json"
    out.write_text(json.dumps(data), encoding="utf-8")
    return out


def _bundle_with_key(tmp_path: Path, **fields: Any) -> Path:
    data = json.loads(BUNDLE.read_text(encoding="utf-8"))
    for row in data["raw"]["capture-keymap.json"]:
        if row["key_ordinal"] == "k1":
            for element in row["slice_rows"]:
                element.update(fields)
    out = tmp_path / "bundle.json"
    out.write_text(json.dumps(data), encoding="utf-8")
    return out


def _run(
    tmp_path: Path, *, bundle: Path = BUNDLE, worksheet: Path = WORKSHEET, report: Path = REPORT
) -> tuple[int, dict[str, Any], str]:
    code = main([
        "verdict",
        "--capture-bundle", str(bundle),
        "--worksheet", str(worksheet),
        "--report", str(report),
        "--account", "SYN-A",
        "--run-day", RUN_DAY,
        "--out-json", str(tmp_path / "verdict.json"),
        "--out-md", str(tmp_path / "verdict.md"),
    ])
    as_json = json.loads((tmp_path / "verdict.json").read_text(encoding="utf-8"))
    markdown = (tmp_path / "verdict.md").read_text(encoding="utf-8")
    return code, as_json, markdown


def _assert_refused_by_name(as_json: dict[str, Any], markdown: str, why: str) -> None:
    accounts = as_json["accounts"]
    assert [a["gate"] for a in accounts] == ["A", "B"]  # both gates present, both RED
    for account in accounts:
        assert account["bucket"] == ORACLE_ACCOUNT_MISMATCH
        assert account["bucket"] != UNEXPLAINED
        assert account["reason"] == f"{ORACLE_ACCOUNT_MISMATCH}:{why}"
        assert account["passed"] is False
        assert account["legs"] == []  # nothing compared: the sides are different accounts
    assert as_json["final_green"] is False
    assert markdown.count(f"- bucket: {ORACLE_ACCOUNT_MISMATCH}") == 2


def test_the_mismatch_bucket_never_passes() -> None:
    assert ORACLE_ACCOUNT_MISMATCH not in PASSING_BUCKETS


def test_a_key_marked_as_a_second_key_on_another_account_is_refused_by_name(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The MM3 case: the product's identity stamper had already recorded the key as a
    duplicate of another key's account. Its Gate A must not run at all."""
    bundle = _bundle_with_key(tmp_path, account_shared=True, venue_account_sha256=None)
    code, as_json, markdown = _run(tmp_path, bundle=bundle)
    assert code != 0
    _assert_refused_by_name(as_json, markdown, "account_shared")
    assert "not the Report's account" in capsys.readouterr().err


def test_a_report_whose_header_login_is_not_the_keys_login_is_refused_without_leaking_either(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The key's captured hash is of a different login than the Report header's. The
    verdict must say so by name, and the Report's login must appear nowhere it writes."""
    report = _report_with_account(tmp_path, f"{SYN_LOGIN} (USD, Synthetic-Srv, real, Hedge)")
    worksheet = _worksheet_bound_to(tmp_path, report)
    code, as_json, markdown = _run(tmp_path, worksheet=worksheet, report=report)
    out = capsys.readouterr()
    assert code != 0
    _assert_refused_by_name(as_json, markdown, "login_differs")
    for surface in (out.out, out.err, json.dumps(as_json), markdown):
        assert SYN_LOGIN not in surface
        assert _sha(SYN_LOGIN) not in surface


def test_a_key_with_no_login_hash_fails_closed(tmp_path: Path) -> None:
    """An unverified binding is not a bound one: no captured hash is RED, never a pass."""
    bundle = _bundle_with_key(tmp_path, account_shared=False, venue_account_sha256=None)
    code, as_json, markdown = _run(tmp_path, bundle=bundle)
    assert code != 0
    _assert_refused_by_name(as_json, markdown, "account_identity_absent")


def test_the_matching_login_with_trailing_header_detail_passes_the_binding(tmp_path: Path) -> None:
    """Control: the same synthetic login on both sides, in the real Report's cell shape
    (login, then currency, server and mode in parentheses), reaches the comparison."""
    report = _report_with_account(tmp_path, f"  {SYN_LOGIN} (USD, Synthetic-Srv, real, Hedge)")
    worksheet = _worksheet_bound_to(tmp_path, report)
    bundle = _bundle_with_key(tmp_path, account_shared=False, venue_account_sha256=_sha(SYN_LOGIN))
    code, as_json, _markdown = _run(tmp_path, bundle=bundle, worksheet=worksheet, report=report)
    assert code == 0
    assert all(a["bucket"] != ORACLE_ACCOUNT_MISMATCH for a in as_json["accounts"])
    assert all(a["passed"] for a in as_json["accounts"])


@pytest.mark.parametrize(
    ("cell", "digest", "expected"),
    [
        (SYN_LOGIN, _sha(SYN_LOGIN), True),
        (f"{SYN_LOGIN}(USD)", _sha(SYN_LOGIN), True),
        (f"{SYN_LOGIN}0 (USD)", _sha(SYN_LOGIN), False),  # a prefix is not the login
        ("007", _sha("7"), False),  # text, never int(): 007 is not 7
        ("", _sha(SYN_LOGIN), None),  # no readable login: not comparable
        (SYN_LOGIN, None, None),  # no captured hash: not comparable
    ],
)
def test_report_account_matches_compares_the_login_text(
    tmp_path: Path, cell: str, digest: str | None, expected: bool | None
) -> None:
    report = _report_with_account(tmp_path, cell)
    assert report_account_matches(report.read_bytes(), digest) is expected
