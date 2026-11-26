"""The daily poll_positions cohort's venue gate names exactly the venues the poll serves.

Migration 20261126180000 gave enqueue_poll_positions_for_all_strategies() a hand-typed
venue list, ``ak.exchange IN (...)``. run_poll_positions_job calls the ccxt fetch_positions
on the client _make_exchange_client builds, which is a ccxt exchange only for
EXCHANGE_CLASSES (mt5 and sfox get non-ccxt clients), then upserts the rows into
position_snapshots, whose position_snapshots_exchange_check admits fewer venues (no
deribit). So the venues served end to end are EXCHANGE_CLASSES intersected with that CHECK.

If the gate drifts from that set, one direction is loud (jobs end failed_final) and the
other is SILENT: a venue that becomes servable is never enqueued for a positions poll, and
no job, error or log line says so. This pin makes either drift fail here instead.
"""

from __future__ import annotations

import re
from pathlib import Path

from services.exchange import EXCHANGE_CLASSES

# analytics-service/tests/ -> repo root is parents[2].
REPO = Path(__file__).resolve().parents[2]
SNAPSHOT = REPO / "supabase" / "schema" / "functions" / "enqueue_poll_positions_for_all_strategies.sql"
BASELINE = REPO / "supabase" / "schema" / "baseline.sql"

# The venues _make_exchange_client hands a non-ccxt client (no fetch_positions).
NON_CCXT_VENUES = {"mt5", "sfox"}

FIX_HINT = (
    "a venue added to or removed from EXCHANGE_CLASSES or position_snapshots_exchange_check "
    "needs a new forward migration that moves the poll cohort's ak.exchange IN (...) gate with it"
)


def _quoted(text: str) -> set[str]:
    return set(re.findall(r"'([a-z0-9_]+)'", text))


def _cohort_gate_venues() -> set[str]:
    # Comments stripped, so prose naming venues cannot satisfy the read.
    body = re.sub(r"--[^\n]*", "", SNAPSHOT.read_text(encoding="utf-8"))
    gates = re.findall(r"ak\.exchange\s+IN\s*\(([^)]*)\)", body)
    assert len(gates) == 1, f"expected exactly one ak.exchange IN (...) gate in {SNAPSHOT}, found {len(gates)}"
    return _quoted(gates[0])


def _check_venues(constraint: str) -> set[str]:
    line = next(
        (ln for ln in BASELINE.read_text(encoding="utf-8").splitlines() if f'"{constraint}" CHECK' in ln),
        None,
    )
    assert line, f"{constraint} not found in {BASELINE}"
    return _quoted(line)


def test_cohort_gate_is_exchange_classes_that_position_snapshots_accepts() -> None:
    gate = _cohort_gate_venues()
    snapshot_venues = _check_venues("position_snapshots_exchange_check")
    served = set(EXCHANGE_CLASSES) & snapshot_venues
    assert gate == served, (
        f"poll cohort gate {sorted(gate)} != EXCHANGE_CLASSES {sorted(EXCHANGE_CLASSES)} "
        f"intersected with position_snapshots_exchange_check {sorted(snapshot_venues)}: {FIX_HINT}"
    )


def test_cohort_gate_excludes_every_non_ccxt_venue_the_keys_table_admits() -> None:
    gate = _cohort_gate_venues()
    allowed = _check_venues("api_keys_exchange_check")
    assert NON_CCXT_VENUES <= allowed, f"api_keys_exchange_check no longer admits {sorted(NON_CCXT_VENUES)}"
    assert gate <= allowed - NON_CCXT_VENUES, (
        f"poll cohort gate {sorted(gate)} names a venue outside api_keys_exchange_check "
        f"{sorted(allowed)} or a non-ccxt venue {sorted(NON_CCXT_VENUES)}: {FIX_HINT}"
    )
