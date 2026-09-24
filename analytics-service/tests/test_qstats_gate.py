"""Phase 166 (D-14 / D-07, SC-2 / SC-3): the quantstats AST gate over every production module.

WHAT THIS REPLACES, AND WHY
---------------------------
Phase 159's RANK-05 region gate
(``test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics``) scanned
the SOURCE LINES of ``compute_all_metrics`` for ``qs.stats.<name>(`` and accepted a
line that contained the TEXT ``prepare_returns=False``. It reported clean over the
exact surface that was still open: it could not see the ``getattr(qs.stats, name)``
dispatch in ``compute_qstats_scalars``, it could not see ``_rolling_alpha_beta``'s
``rolling_greeks`` call (a different function), and it trusted keyword text that
``cvar`` proves is a lie (``cvar`` advertises ``prepare_returns=`` and does not
forward it). That gate is deleted in the same commit that lands this one, so there
is never a commit with no gate.

This gate walks the AST of EVERY production ``*.py`` under ``analytics-service/``
(``tests/``, virtualenvs and caches excluded) with the single scanner in
``tests/qstats_gate.py``. The scanner, its rules and its allowlists are documented
there. Plan 166-08 proves it able to fail at every call shape (needles, behavioural
preparer-spy pins for every ``KWARG_PROVEN`` leaf, real-file neuter drills).

ANTI-VACUITY (carried over from the old gate's docblock)
--------------------------------------------------------
``violations == []`` is ALSO what an empty scan produces. A rename, a moved module,
or a walk that stopped reading files would leave the gate judging NOTHING and
reporting a clean pass, which is a test that cannot fail. So the scan COUNTS the
quantstats nodes it examined and the importer modules it found, and both are
asserted: the gate is only meaningful while it is looking at the calls.
"""

from __future__ import annotations

from tests.qstats_gate import (
    COVERED_MODULES,
    EXEMPT,
    IMPORT_SHAPES,
    KWARG_PROVEN,
    SERVICE_ROOT,
    scan_tree,
)


def test_qstats_gate_real_corpus_is_clean() -> None:
    """Every quantstats node in every production module is closed or exempt."""
    violations, _census, _nodes, _importers = scan_tree(SERVICE_ROOT)
    assert violations == [], (
        "quantstats nodes that are not a kwarg-closed allowlisted leaf, not the "
        "exempt drawdown_details, or that reach quantstats outside a covered "
        "module (the RANK-05 price guess is reopened at each of these):\n"
        + "\n".join(
            f"  {v.module}:{v.function}:{v.qs_name}:{v.lineno} [{v.shape}] {v.reason}"
            for v in violations
        )
    )


def test_qstats_gate_real_corpus_is_not_blind() -> None:
    """The scan must actually be looking at the quantstats calls it judges."""
    violations, census, nodes, importers = scan_tree(SERVICE_ROOT)
    assert nodes > 0, (
        "the scan found no quantstats node at all: blind, not clean. Zero nodes "
        "means the walk stopped reading services/metrics.py (rename, moved "
        "module, broken exclusion filter) and the gate is watching an empty room."
    )
    assert importers == COVERED_MODULES, (
        f"modules found importing quantstats {sorted(importers)} != COVERED_MODULES "
        f"{sorted(COVERED_MODULES)}: blind, not clean. A covered module the walk "
        "no longer finds is a module the gate no longer judges."
    )
    node_violations = [v for v in violations if v.shape not in IMPORT_SHAPES]
    assert len(census) + len(node_violations) == nodes, (
        f"{nodes} quantstats nodes scanned but {len(census)} census rows and "
        f"{len(node_violations)} node violations: a node was examined and "
        "neither passed nor failed"
    )


def test_qstats_gate_kwarg_allowlist_is_not_stale() -> None:
    """KWARG_PROVEN is exactly the leaves the code calls, minus the exemption.

    A leaf that stays allowlisted after its last call site is removed is a
    standing permission nobody is using, and the next site that reaches for it
    inherits a proof made for a different call. Equality, not containment.
    """
    _violations, census, _nodes, _importers = scan_tree(SERVICE_ROOT)
    called = {row.qs_name for row in census}
    assert set(EXEMPT) <= called, (
        f"exempt name(s) {sorted(set(EXEMPT) - called)} are no longer called; "
        "delete the exemption and its pin"
    )
    assert KWARG_PROVEN == frozenset(called - set(EXEMPT)), (
        f"KWARG_PROVEN {sorted(KWARG_PROVEN)} != leaves actually called "
        f"{sorted(called - set(EXEMPT))}"
    )
    assert not (KWARG_PROVEN & set(EXEMPT)), "a name cannot be both proven and exempt"
