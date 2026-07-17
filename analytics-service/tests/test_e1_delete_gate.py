"""BACKBONE-01 — PERMANENT re-entry gate for the Phase-114 E1 deletion.

This is the Python mirror of the v1.10 JS whole-repo grep-gate (CONSTIT-04
lesson): once the forward cashflow-chaining TWR scalar in
``services.portfolio_metrics`` and the Sharpe/vol helper in ``routers.portfolio``
were absorbed into the unified backbone and DELETED in plan 114-03, they must
NEVER re-enter — as a live symbol OR as a tree-wide textual reference — or CI
fails here. (This gate file deliberately carries NEITHER deletion-target token
as a contiguous literal — the symbol names are built by concatenation below — so
it stays invisible to its own Part-B walk and to the 114-01 caller census.)

Three parts, plus 111-04 self-invalidation-proofing:

  A. Live-symbol gate (comment/string-proof — the PRIMARY gate): ``hasattr``
     assertions on the two survivor modules. Stronger than grep for Python
     because it catches a re-import/alias that a text scan of the def-site would
     miss. The attribute-name strings are built by CONCATENATION so this file
     never trips its own Part-B walk.

  B. Whole-tree token walk: the belt-and-suspenders textual sweep. The sharpe
     token must appear in ZERO scanned files; the twr token may appear ONLY in
     the same-named EquityCurveBuilder METHOD exemption (see below); and no
     single line may carry BOTH ``portfolio_metrics`` and the twr token (blocks a
     re-import/attribute-access re-entry even inside the exempted files). Neuter
     guards (>=100 files, must-visit the two survivor modules) keep a broken/
     over-narrowed walk from passing silently.

  C. KEEP-path proof (BACKBONE-01 clause 3): the cashflow/IRR surface the
     backbone canNOT reproduce (``compute_mwr`` / ``compute_modified_dietz`` /
     ``compute_period_returns``) must still IMPORT *and* FUNCTION post-delete —
     a functional smoke, not an import-only check — and ``routers.process_key``
     (whose L1018 lazy import of ``compute_period_returns`` must survive) must
     still import.

METHOD EXEMPTION (allowed-but-not-required, pinned until Phase 115 / STITCH-02):
    the same-named TWR METHOD on ``services.equity_reconstruction``'s
    ``EquityCurveBuilder`` and its ``tests/test_equity_curve_builder.py`` callers
    are a DIFFERENT symbol — a METHOD that does NOT import ``portfolio_metrics``.
    It is E2
    (allocator equity reconstruction) territory, retired by Phase 115 /
    STITCH-02. The exemption is allowed-but-NOT-required, so the Phase-115
    deletion of that method will NOT break this gate (the walk uses ``<=``, not
    ``==``, against the exemption set).

    The exemption is SYMBOL-SHAPE-scoped, not file-scoped (round-2 finding 2):
    within an exempted file the twr token is allowed ONLY as the bound METHOD.
    Two guards close the false-GREEN hole where a re-implemented module-level free
    ``def`` of the twr symbol inside the exempted file would otherwise pass every
    part: (1) Part A asserts the equity_reconstruction MODULE exposes no twr
    attribute (the method is a CLASS attribute, so a module-level free def/alias
    flips hasattr True); (2) Part B flags any def of the twr symbol that is
    un-indented (module-level) or whose first parameter is not ``self``.

INJECTION-PROVEN: this gate was proven to go RED under a live-token injection
(a scratch ``services/*.py`` reintroducing the twr symbol), then reverted — the
RED/GREEN pair is recorded in the plan 114-03 SUMMARY. The round-2 tightening was
likewise proven RED by appending a module-level free ``def`` of the twr symbol to
services/equity_reconstruction.py (tripping BOTH Part A hasattr and Part B
occurrence-pattern), then reverting. Do NOT weaken any assertion to force green;
a real re-entry MUST fail here.

stdlib + pandas ONLY.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import pandas as pd
import pytest

# Deletion-target symbol names, built by CONCATENATION so this gate file never
# contains the contiguous literal token (and therefore never trips its own
# Part-B tree walk, which matches the contiguous literal).
_TWR_SYMBOL = "compute" + "_twr"
_SHARPE_SYMBOL = "_compute_sharpe" + "_and_vol"

# Detects a DEFINITION of the twr symbol and captures its indentation + first
# parameter. Built from the concatenated symbol via re.escape (so this file's
# on-disk text still never carries the contiguous literal — the pattern only
# forms at runtime). A bound METHOD is indented (inside a class body) with a
# ``self`` first parameter; a module-level free ``def`` re-implementation is
# un-indented and/or takes a non-``self`` first parameter. The Phase-115
# exemption covers ONLY the bound method, so any other def-shape trips RED.
_TWR_DEF_RE = re.compile(
    r"^(?P<indent>[ \t]*)def[ \t]+" + re.escape(_TWR_SYMBOL) + r"[ \t]*\((?P<params>[^)]*)"
)

_GATE_ROOT = Path(__file__).resolve().parents[1]  # tests/ -> analytics-service/

# The twr token is permitted ONLY here (same-named METHOD, Phase-115 scope).
# allowed-but-not-required: the walk asserts ``found <= EXEMPT`` so a future
# STITCH-02 deletion that empties this set stays GREEN.
_EXEMPT_TWR = frozenset({
    "services/equity_reconstruction.py",
    "tests/test_equity_curve_builder.py",
})

# Files that legitimately carry the deletion-target tokens ONLY as
# concatenation-built census/gate constants (never as live symbols) and are
# therefore excluded from the textual walk by name.
_SKIP_FILES = frozenset({
    "tests/test_e1_delete_gate.py",       # this file
    "tests/test_e1_sharpe_twr_parity.py",  # the 114-01 golden-parity oracle
})


# ── Part A — live-symbol gate (primary; comment/string-proof) ────────────────

def test_deleted_symbols_are_not_live_attributes():
    """Neither deletion target may exist as a live attribute on the survivor
    modules. This is stronger than a def-site grep: it also catches a re-import,
    alias, or ``setattr`` re-entry. Both symbols are checked on BOTH modules
    (the twr check on routers.portfolio also proves its legacy import stays
    trimmed)."""
    import services.portfolio_metrics as pm_mod
    import routers.portfolio as port_mod

    assert not hasattr(pm_mod, _TWR_SYMBOL), (
        f"{_TWR_SYMBOL} re-entered services.portfolio_metrics as a live symbol"
    )
    assert not hasattr(pm_mod, _SHARPE_SYMBOL), (
        f"{_SHARPE_SYMBOL} re-entered services.portfolio_metrics as a live symbol"
    )
    assert not hasattr(port_mod, _SHARPE_SYMBOL), (
        f"{_SHARPE_SYMBOL} re-entered routers.portfolio as a live symbol"
    )
    assert not hasattr(port_mod, _TWR_SYMBOL), (
        f"{_TWR_SYMBOL} re-entered routers.portfolio as a live symbol/import"
    )

    # The Phase-115 exemption covers ONLY the bound EquityCurveBuilder METHOD (a
    # CLASS attribute), so the equity_reconstruction MODULE must expose NO twr
    # attribute. A module-level free ``def`` or an alias would make this hasattr
    # True — closing the false-GREEN hole where a re-implemented free function
    # inside the exempted file passed every gate part (round-2 finding 2). This is
    # symbol-level, immune to comment/formatting tricks.
    import services.equity_reconstruction as eqr_mod

    assert not hasattr(eqr_mod, _TWR_SYMBOL), (
        f"{_TWR_SYMBOL} re-entered services.equity_reconstruction as a MODULE-LEVEL "
        "free function/alias — the exemption covers only the bound "
        "EquityCurveBuilder METHOD, not a module-level symbol"
    )


# ── Part B — whole-tree token walk (belt-and-suspenders) ─────────────────────

def test_tree_walk_has_no_reentry_of_deleted_tokens():
    """Textual sweep of every analytics-service *.py: the sharpe token in ZERO
    files, the twr token ONLY in the METHOD exemption, and no line carrying BOTH
    ``portfolio_metrics`` and the twr token. Neuter-guarded per 111-04."""
    scanned = 0
    visited: set[str] = set()
    twr_files: set[str] = set()
    sharpe_files: set[str] = set()
    both_token_lines: list[str] = []
    free_func_defs: list[str] = []

    for py in _GATE_ROOT.rglob("*.py"):
        parts = py.parts
        if ".venv" in parts or "__pycache__" in parts:
            continue
        rel = py.relative_to(_GATE_ROOT).as_posix()
        if rel in _SKIP_FILES:
            continue
        scanned += 1
        visited.add(rel)
        text = py.read_text(encoding="utf-8", errors="ignore")
        if _TWR_SYMBOL in text:
            twr_files.add(rel)
        if _SHARPE_SYMBOL in text:
            sharpe_files.add(rel)
        for line in text.splitlines():
            if "portfolio_metrics" in line and _TWR_SYMBOL in line:
                both_token_lines.append(f"{rel}: {line.strip()}")
            # Occurrence-pattern tightening of the file-scoped exemption
            # (round-2 finding 2): even inside an EXEMPT file the twr token may
            # appear ONLY as the bound METHOD. A def whose signature is
            # un-indented (module-level) OR whose first parameter is not ``self``
            # is a free-function re-implementation and trips RED.
            m = _TWR_DEF_RE.match(line)
            if m is not None:
                first_param = m.group("params").split(",")[0].strip()
                if m.group("indent") == "" or first_param != "self":
                    free_func_defs.append(f"{rel}: {line.strip()}")

    # Neuter-guards (self-invalidation-proof): a broken walk that scans nothing —
    # or an over-narrowed one that skips the two survivor modules — must NOT pass.
    assert scanned >= 100, f"tree walk only scanned {scanned} .py files (expected >=100)"
    assert "services/portfolio_metrics.py" in visited, (
        "walk did not visit services/portfolio_metrics.py — over-narrowed, cannot trust"
    )
    assert "routers/portfolio.py" in visited, (
        "walk did not visit routers/portfolio.py — over-narrowed, cannot trust"
    )

    # The gate proper.
    assert sharpe_files == set(), (
        f"deleted Sharpe/vol helper token re-entered these files: {sorted(sharpe_files)}"
    )
    assert twr_files <= _EXEMPT_TWR, (
        "deleted TWR-scalar token re-entered outside the Phase-115 METHOD "
        f"exemption: {sorted(twr_files - _EXEMPT_TWR)}"
    )
    assert both_token_lines == [], (
        "a line references portfolio_metrics AND the twr token (re-import/attribute "
        f"re-entry): {both_token_lines}"
    )
    assert free_func_defs == [], (
        "a module-level / non-method `def` of the deleted TWR scalar re-entered — "
        "the exemption covers ONLY the bound EquityCurveBuilder method "
        f"(`def <twr>(self`): {free_func_defs}"
    )


# ── Part C — KEEP-path import + functional smoke (BACKBONE-01 clause 3) ───────

def test_kept_cashflow_irr_helpers_import_and_function():
    """The survivor cashflow/IRR surface must still IMPORT and FUNCTION — the
    path the unified backbone cannot reproduce (deposits/withdrawals → IRR /
    Modified Dietz). Functional smoke, not import-only."""
    from services.portfolio_metrics import (
        compute_modified_dietz,
        compute_mwr,
        compute_period_returns,
    )

    # Modified Dietz: 100 -> 110 over 30 days, no flows -> +10%.
    md = compute_modified_dietz(100.0, 110.0, [], 30)
    assert md is not None
    assert md == pytest.approx(0.10, rel=1e-9)

    # Period returns: a 3-day DatetimeIndex series returns all three keys finite.
    idx = pd.date_range("2026-01-01", periods=3, freq="D")
    returns = pd.Series([0.01, -0.02, 0.03], index=idx)
    pr = compute_period_returns(returns)
    assert set(pr) == {"return_24h", "return_mtd", "return_ytd"}
    assert all(v is not None and math.isfinite(v) for v in pr.values())

    # MWR/IRR: one -1000 investment a calendar year before the end date, final
    # value 1100 -> ~+10% annualised.
    mwr = compute_mwr(
        [{"amount": -1000.0, "date": "2025-01-01"}],
        final_value=1100.0,
        end_date="2026-01-01",
    )
    assert mwr is not None
    assert mwr == pytest.approx(0.10, rel=1e-2)


def test_process_key_lazy_import_of_period_returns_survives():
    """routers/process_key.py L1018 lazily imports compute_period_returns from
    portfolio_metrics; importing the module proves that wiring survives the
    delete (a broken import would raise at collection)."""
    import routers.process_key  # noqa: F401

    assert routers.process_key is not None
