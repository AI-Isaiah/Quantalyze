"""The CSV rule family, enumerated by EXECUTION (Phase 215 SC-7a, D-161-01).

``services/ingestion/csv_adapter.py`` turns the first failing rule of a CSV
validation into the wire ``error_code``::

    error_code=first_rule.upper() if first_rule else "CSV_VALIDATION_FAILED"

That emitter is dynamic, so the TypeScript vocabulary guard
(``src/lib/seam-venue-vocabulary.invariant.test.ts``) could not see the family
(its DECLARED BLIND SPOT, D-161-01). The decision was to enumerate the family and
make a new rule red by name. This module is the INDEPENDENT half of that pair: the
vitest half scans the validator's source text, this half runs it.

Three derivations, none reading the expected value out of the code under test:

1. the custom ``pa.Check(..., error=...)`` names, read off ``SCHEMAS`` after
   import;
2. the pandera built-in check names (``column_in_dataframe``, ``not_nullable``,
   ``coerce_dtype(...)``, ``dtype(...)``), which appear in NO source literal and
   are only knowable by running ``schema.validate(lazy=True)`` on frames built to
   break each schema, then reading ``failure_cases["check"]`` the way
   ``validate_csv`` reads it;
3. the bespoke ``"rule": "<lit>"`` dict literals, found by an ``ast`` walk of
   ``csv_validator.py``.

The wire code is the rule name upper-cased by ``str.upper()``, exactly as the
adapter does. A built-in that carries an argument, ``coerce_dtype('float64')``,
becomes ``COERCE_DTYPE('FLOAT64')`` on the wire; this oracle keys on the
argument-stripped name, the same collapse ``csvRuleKey`` in ``wizardErrors.ts``
applies for labels.

``EXPECTED_FAMILY`` is hand-typed. A new rule that is not added to it, with a
decision about its disposition on the TypeScript side, fails
``test_the_executed_family_equals_the_hand_typed_family`` and names the code.

The two info flags are not members: ``auto_normalized_percent_form`` and
``date_format_normalized`` ride in the envelope as flags and are never the
``errors[0]`` that becomes the wire code. Both are asserted to be present in the
source, so the exclusion cannot go stale silently.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pandas as pd
import pytest
from pandera.errors import SchemaErrors

from services.csv_validator import SCHEMAS

_SERVICE_ROOT = Path(__file__).resolve().parents[1]
_VALIDATOR_SOURCE = _SERVICE_ROOT / "services" / "csv_validator.py"
_ADAPTER_SOURCE = _SERVICE_ROOT / "services" / "ingestion" / "csv_adapter.py"

# The two flags that ride beside the errors and are never the first error.
INFO_FLAG_RULES = frozenset(
    {"AUTO_NORMALIZED_PERCENT_FORM", "DATE_FORMAT_NORMALIZED"}
)

CUSTOM_CHECKS = frozenset(
    {
        "CURRENCY_USD_OR_BLANK",
        "DAILY_RETURN_LOWER_BOUND",
        "MONOTONIC_DATES",
        "NAV_NON_ZERO",
        "QTY_PRICE_POSITIVE",
    }
)
PANDERA_BUILTINS = frozenset(
    {"COLUMN_IN_DATAFRAME", "NOT_NULLABLE", "COERCE_DTYPE", "DTYPE"}
)
BESPOKE_RULES = frozenset(
    {
        "DAILY_RETURNS_CONSTANT",
        "DAILY_SHARPE_SENTINEL",
        "DAILY_RETURN_DOLLAR_FORM_SENTINEL",
        "DATE_FORMAT_AMBIGUOUS",
        "PARSE_ERROR",
        "EMPTY",
        "TOO_MANY_ROWS",
    }
)
# What the adapter emits when the error list is empty.
ADAPTER_FALLBACK = frozenset({"CSV_VALIDATION_FAILED"})

EXPECTED_FAMILY = CUSTOM_CHECKS | PANDERA_BUILTINS | BESPOKE_RULES | ADAPTER_FALLBACK

# 5 custom + 4 built-in + 7 bespoke + 1 fallback, measured at 08451cfcc.
FAMILY_FLOOR = 17


def _key(name: str) -> str:
    """The rule name as ``csv_adapter`` upper-cases it, argument stripped."""
    return re.sub(r"\(.*\)$", "", name).upper()


def _custom_check_names() -> set[str]:
    names: set[str] = set()
    for schema in SCHEMAS.values():
        for column in schema.columns.values():
            for check in column.checks:
                if check.error:
                    names.add(_key(str(check.error)))
    return names


def _executed_failure_check_names() -> set[str]:
    """Every check name pandera reports when each schema is broken on purpose."""
    broken_frames = {
        "daily_returns": [
            pd.DataFrame({"x": [1]}),
            pd.DataFrame({"date": [None, "2024-01-01"], "daily_return": [0.1, None]}),
            pd.DataFrame({"date": ["garbage", "2024-01-01"], "daily_return": ["abc", 0.1]}),
            pd.DataFrame(
                {
                    "date": ["2024-01-02", "2024-01-01"],
                    "daily_return": [-500.0, 0.1],
                    "currency": ["EUR", "USD"],
                }
            ),
        ],
        "daily_nav": [
            pd.DataFrame({"x": [1]}),
            pd.DataFrame({"date": [None, "2024-01-01"], "nav": [1.0, None]}),
            pd.DataFrame({"date": ["garbage", "2024-01-01"], "nav": ["abc", 1.0]}),
            pd.DataFrame(
                {
                    "date": ["2024-01-02", "2024-01-01"],
                    "nav": [0.0, 1.0],
                    "currency": ["EUR", "USD"],
                }
            ),
        ],
        "trades": [
            pd.DataFrame({"x": [1]}),
            pd.DataFrame(
                {
                    "date": [None, "2024-01-01"],
                    "side": [None, "buy"],
                    "qty": [1.0, None],
                    "price": [1.0, 1.0],
                    "symbol": ["A", "B"],
                    "currency": ["USD", "USD"],
                }
            ),
            pd.DataFrame(
                {
                    "date": ["garbage", "2024-01-01"],
                    "side": ["buy", "buy"],
                    "qty": ["abc", 1.0],
                    "price": [0.0, -1.0],
                    "symbol": ["A", "B"],
                    "currency": ["EUR", "USD"],
                }
            ),
        ],
    }
    # A new format gets a broken frame here or this fails loud.
    assert set(broken_frames) == set(SCHEMAS), (
        f"SCHEMAS has formats {sorted(SCHEMAS)} but this oracle builds broken "
        f"frames for {sorted(broken_frames)}"
    )
    names: set[str] = set()
    for fmt, frames in broken_frames.items():
        for frame in frames:
            with pytest.raises(SchemaErrors) as caught:
                SCHEMAS[fmt].validate(frame, lazy=True)
            for check in caught.value.failure_cases["check"].tolist():
                names.add(_key(str(check)))
    return names


def _bespoke_rule_literals() -> set[str]:
    """``"rule": "<lit>"`` dict entries anywhere in csv_validator.py."""
    tree = ast.parse(_VALIDATOR_SOURCE.read_text())
    found: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if (
                isinstance(key, ast.Constant)
                and key.value == "rule"
                and isinstance(value, ast.Constant)
                and isinstance(value.value, str)
            ):
                found.add(_key(value.value))
    return found


def test_the_custom_check_names_are_the_five_hand_typed_ones():
    assert _custom_check_names() == CUSTOM_CHECKS


def test_running_the_schemas_surfaces_every_custom_check_and_every_builtin():
    # Execution sees the custom checks too, so a custom check that stopped
    # firing under a broken frame is caught here, not only a missing built-in.
    executed = _executed_failure_check_names()
    assert executed == CUSTOM_CHECKS | PANDERA_BUILTINS, (
        f"unexpected: {sorted(executed - (CUSTOM_CHECKS | PANDERA_BUILTINS))}; "
        f"missing: {sorted((CUSTOM_CHECKS | PANDERA_BUILTINS) - executed)}"
    )


def test_the_bespoke_rule_literals_are_the_seven_errors_plus_the_two_info_flags():
    assert _bespoke_rule_literals() == BESPOKE_RULES | INFO_FLAG_RULES


def test_the_adapter_still_falls_back_to_the_hand_typed_code():
    source = _ADAPTER_SOURCE.read_text()
    for code in ADAPTER_FALLBACK:
        assert f'"{code}"' in source, (
            f"csv_adapter no longer emits {code}; the fallback member is stale"
        )
    assert "first_rule.upper()" in source, (
        "csv_adapter no longer upper-cases the first rule; the wire-code "
        "derivation this oracle models has changed"
    )


def test_the_executed_family_equals_the_hand_typed_family():
    derived = (
        _custom_check_names()
        | _executed_failure_check_names()
        | (_bespoke_rule_literals() - INFO_FLAG_RULES)
        | ADAPTER_FALLBACK
    )
    assert derived == EXPECTED_FAMILY, (
        f"a rule is in the validator and not in EXPECTED_FAMILY: "
        f"{sorted(derived - EXPECTED_FAMILY)}; "
        f"a hand-typed rule the validator no longer produces: "
        f"{sorted(EXPECTED_FAMILY - derived)}. A new rule needs a disposition in "
        f"seam-venue-vocabulary.invariant.test.ts (a CSV_RULE_LABELS key or a "
        f"CSV_RULE_FAMILY_EXEMPTIONS entry) as well as a row here."
    )


def test_the_family_is_not_vacuous():
    assert len(EXPECTED_FAMILY) >= FAMILY_FLOOR
    assert len(_bespoke_rule_literals() | _custom_check_names()) >= 12


def _every_schema_check_wire_name() -> dict[str, str]:
    """Wire name of EVERY check across SCHEMAS, keyed ``"<format>.<column>:<check.name>"``.

    ``csv_validator`` reports a failed check as ``failure_cases["check"]``, which pandera sets to
    ``check.error`` when one is given and to ``check.name`` otherwise. So a check with no
    ``error=`` surfaces under its bare pandera name (``greater_than``, ``<lambda>``) and, unless
    that name is in the family, no frame in this module need ever violate it to notice."""
    wire: dict[str, str] = {}
    for fmt, schema in SCHEMAS.items():
        columns = {"<schema>": schema.checks} | {n: c.checks for n, c in schema.columns.items()}
        for column, checks in columns.items():
            for check in checks:
                name = str(check.error) if check.error else str(check.name)
                wire[f"{fmt}.{column}:{check.name}"] = _key(name)
    return wire


def test_every_schema_check_maps_into_the_expected_family():
    # Closes the blind spot where a pa.Check added WITHOUT error= and violated by no broken
    # frame above is in neither the custom-name nor the executed-name derivation.
    wire = _every_schema_check_wire_name()
    assert len(wire) >= 10, f"read only {len(wire)} checks off SCHEMAS; the walk is broken"
    outside = {k: v for k, v in sorted(wire.items()) if v not in EXPECTED_FAMILY}
    assert not outside, (
        f"checks whose wire rule is not in EXPECTED_FAMILY (give the check an error= name, "
        f"then add it to the family and the TypeScript guard): {outside}"
    )


# The one emitter whose rule value is not a literal: the pandera loop reports
# ``"rule": rule_name`` with ``rule_name = str(row.get("check", "unknown"))``. Its values are
# exactly the check names the two tests above pin, so it is accepted BY NAME and counted.
DYNAMIC_RULE_EMITTER_NAME = "rule_name"


def non_constant_rule_sites(source: str) -> list[tuple[int, str]]:
    """``(line, source text)`` of every ``"rule": <v>`` dict entry and ``rule=<v>`` keyword in
    ``source`` whose value is not a constant string."""
    sites: list[tuple[int, str]] = []

    def check(value: ast.AST) -> None:
        if not (isinstance(value, ast.Constant) and isinstance(value.value, str)):
            sites.append((value.lineno, ast.unparse(value)))

    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == "rule":
                    check(value)
        elif isinstance(node, ast.Call):
            for keyword in node.keywords:
                if keyword.arg == "rule":
                    check(keyword.value)
    return sorted(sites)


@pytest.mark.parametrize(
    "snippet",
    [
        'errors.append({"rule": name})\n',
        'errors.append({"rule": f"x_{n}"})\n',
        'err = make(rule=compute())\n',
        'err = {"rule": None}\n',
        'err = {"rule": "a" + "b"}\n',
    ],
)
def test_non_constant_rule_scan_fires_on_every_non_literal_form(snippet: str):
    assert non_constant_rule_sites(snippet), snippet


@pytest.mark.parametrize(
    "snippet",
    ['err = {"rule": "parse_error"}\n', 'err = make(rule="empty")\n', 'err = {"other": name}\n'],
)
def test_non_constant_rule_scan_ignores_literals_and_other_keys(snippet: str):
    assert non_constant_rule_sites(snippet) == [], snippet


def test_every_validator_rule_is_a_literal_except_the_one_pandera_emitter():
    # A non-literal rule is invisible to _bespoke_rule_literals() and to the TypeScript regex
    # scan, so it must fail here instead of being skipped.
    sites = non_constant_rule_sites(_VALIDATOR_SOURCE.read_text())
    unexpected = [s for s in sites if s[1] != DYNAMIC_RULE_EMITTER_NAME]
    assert not unexpected, (
        f"csv_validator.py emits a rule that is not a constant string at (line, source): "
        f"{unexpected}. The family oracle cannot enumerate it; use a literal, or pin it here "
        f"with a test that covers every value it can take."
    )
    assert len(sites) == 1, (
        f"expected exactly one pandera-sourced '{DYNAMIC_RULE_EMITTER_NAME}' emitter, found "
        f"{sites}; the exemption above is stale or the emitter moved"
    )
