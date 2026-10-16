"""170.1-02 / R-2 — the browser's required-columns table must not drift from the schemas.

``src/lib/csv-required-columns.json`` is what the wizard reads to decide whether
"Check the file format you selected." applies (``csvFormatHintApplies`` in
``src/lib/wizardErrors.ts``). The authority on what a format REQUIRES is
``SCHEMAS`` in ``services/csv_validator.py``. A column listed in the JSON that
the schema does not require (or the reverse) would make the hint fire, or stay
silent, on the wrong files. This test fails on that disagreement, in both
directions.

The JSON is read across the language boundary through ``parents[2]``, the same
way ``test_redact.py`` reads its TS counterpart.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.csv_validator import SCHEMAS

REQUIRED_COLUMNS_JSON = (
    Path(__file__).resolve().parents[2] / "src" / "lib" / "csv-required-columns.json"
)


def _schema_required(fmt: str) -> set[str]:
    return {
        name for name, column in SCHEMAS[fmt].columns.items() if column.required
    }


def _json_table() -> dict[str, list[str]]:
    return json.loads(REQUIRED_COLUMNS_JSON.read_text(encoding="utf-8"))


def test_json_lists_exactly_the_schema_formats():
    assert set(_json_table()) == set(SCHEMAS), (
        "csv-required-columns.json and csv_validator.SCHEMAS name different formats"
    )


def test_json_required_columns_equal_the_schema_required_columns_per_format():
    table = _json_table()
    for fmt in SCHEMAS:
        listed = table[fmt]
        assert len(listed) == len(set(listed)), f"{fmt}: duplicate column in the JSON"
        assert set(listed) == _schema_required(fmt), (
            f"{fmt}: csv-required-columns.json {sorted(listed)} disagrees with the "
            f"schema's required columns {sorted(_schema_required(fmt))}"
        )


def test_every_format_requires_date_because_the_hint_rule_excludes_it():
    # R-2 (founder 2026-10-15): the hint reads "every required column OTHER THAN
    # `date`". That exclusion is only sound while every format requires `date`.
    for fmt in SCHEMAS:
        assert "date" in _schema_required(fmt), f"{fmt} no longer requires `date`"
