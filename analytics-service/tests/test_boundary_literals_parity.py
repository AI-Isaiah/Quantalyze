"""Deribit key-boundary parity pins — the pytest mirror of the vitest
``check-zod-db-check-parity.test.ts`` matrix (Phase 68 / DRB-02).

Both directions, one closed set encoded three ways (TS ↔ pydantic ↔ SQL):

* CONTAIN direction — every KEY-SAVING boundary Literal admits ``"deribit"``
  (``VerifyStrategyRequest.exchange`` / ``debug_key_flow.Broker`` /
  ``adapter.Source``), and the four widened SQL CHECK constraints in the
  ``20260704200446_deribit_exchange_boundary_checks.sql`` migration each admit
  it too. If a future edit drops deribit from any one encoding, the key-save
  boundary desyncs (TS admits what pydantic/DB reject → 422/23514) and this
  file goes red.

* EXCLUDE direction — the FUNDING / INGESTION-REGISTRY surfaces deliberately
  DO NOT admit deribit this phase. ``SUPPORTED_SOURCES`` and the
  ``process_key`` per-flow sets stay 3-exchange until Phase 70 wires ingestion;
  the ``_FUNDING_BUCKET_HOURS`` / funding-CHECK exclusion is pinned in the
  sibling ``test_funding_match_key_sql_parity.py``. Each exclusion carries a
  Phase-70/71 flip comment so the flip is a conscious edit to a failing test,
  never silent drift.

This file is intentionally I/O-free and constructs NO pandas objects (the local
Py3.14 pandas-tslibs ABI segfaults at DataFrame construction, not at these pure
``typing.get_args`` / ``Path.read_text`` reads); CI is the full-suite authority.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from models.schemas import VerifyStrategyRequest
from routers.debug_key_flow import Broker
from services.ingestion import SUPPORTED_SOURCES
from services.ingestion.adapter import Source

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BOUNDARY_MIGRATION = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260704200446_deribit_exchange_boundary_checks.sql"
)
# Phase 119 (SFOX-04) — the sfox constraint-widen migration cloning the deribit
# precedent above. Pinned the same way (byte-parity read of the ADD CONSTRAINT
# CHECK bodies) so a future drop of sfox from any of the four boundary CHECKs
# reds this test.
_SFOX_BOUNDARY_MIGRATION = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260718182056_sfox_exchange_boundary_checks.sql"
)
_PROCESS_KEY = (
    Path(__file__).resolve().parents[1] / "routers" / "process_key.py"
)

# The canonical 5-value key-save allowlist — the pydantic mirror of the TS
# SUPPORTED_EXCHANGES single source of truth. Phase 119 (SFOX-04) added 'sfox'.
# Drift on either side breaks the set-equality pin below.
_KEY_SAVE_EXCHANGES = {"binance", "okx", "bybit", "deribit", "sfox"}

# The four canonical `<table>_<column>_check` constraint names the Phase 68
# migration widens (LOAD-BEARING: the vitest resolveColumnCheck resolves these
# named ADD CONSTRAINTs first — see check-zod-db-check-parity.test.ts).
_WIDENED_CONSTRAINTS = (
    "api_keys_exchange_check",
    "compute_jobs_exchange_check",
    "strategies_source_check",
    "strategy_verifications_source_check",
)


class TestPydanticLiteralsContainDeribit:
    """CONTAIN direction — the three key-saving pydantic Literals admit deribit."""

    def test_verify_request_exchange_literal_contains_deribit(self) -> None:
        args = get_args(VerifyStrategyRequest.model_fields["exchange"].annotation)
        assert "deribit" in args, (
            "VerifyStrategyRequest.exchange Literal must admit 'deribit' — it is "
            "the pydantic key-verify boundary mirroring TS SUPPORTED_EXCHANGES."
        )

    def test_verify_request_exchange_is_exactly_the_key_save_set(self) -> None:
        # Set-equality (not just membership): a drop-one/add-one swap that netted
        # a stray value past a membership check fails here. Mirrors the vitest
        # SoT set-equality assertion.
        args = set(get_args(VerifyStrategyRequest.model_fields["exchange"].annotation))
        assert args == _KEY_SAVE_EXCHANGES, (
            f"VerifyStrategyRequest.exchange drifted from the key-save allowlist: "
            f"{sorted(args)} != {sorted(_KEY_SAVE_EXCHANGES)}"
        )

    def test_broker_literal_contains_deribit(self) -> None:
        assert "deribit" in get_args(Broker), (
            "debug_key_flow.Broker Literal must admit 'deribit'."
        )

    def test_source_literal_contains_deribit(self) -> None:
        # Source also carries 'csv' (upload path) — membership pin, not set-equality.
        assert "deribit" in get_args(Source), (
            "ingestion.adapter.Source Literal must admit 'deribit' (OQ2: widened "
            "for type-consistency at the key-save boundary)."
        )

    def test_verify_request_exchange_literal_contains_sfox(self) -> None:
        args = get_args(VerifyStrategyRequest.model_fields["exchange"].annotation)
        assert "sfox" in args, (
            "VerifyStrategyRequest.exchange Literal must admit 'sfox' (Phase 119 "
            "SFOX-04) — the pydantic key-verify boundary mirroring TS SUPPORTED_EXCHANGES."
        )

    def test_broker_literal_contains_sfox(self) -> None:
        assert "sfox" in get_args(Broker), (
            "debug_key_flow.Broker Literal must admit 'sfox' (Phase 119 SFOX-04)."
        )

    def test_source_literal_excludes_sfox_until_phase_120(self) -> None:
        # Phase 119 SFOX-04 does NOT add 'sfox' to the ingestion Source Literal:
        # Source is pinned EQUAL to SUPPORTED_SOURCES/_FACTORIES by
        # test_source_literal_and_registry_agree, and the sfox ingestion factory
        # is Phase 120. Widening the Literal ahead of the registry would break
        # that invariant. The key-save EXCHANGE boundary (VerifyStrategyRequest.
        # exchange, Broker, the 4 SQL CHECKs) is a distinct concern and DOES
        # admit 'sfox' this phase. 'sfox' joins Source + registry together in 120.
        assert "sfox" not in get_args(Source), (
            "ingestion.adapter.Source must NOT admit 'sfox' until Phase 120 ships "
            "the sfox ingestion factory (keeps Source == SUPPORTED_SOURCES parity)."
        )


class TestMigrationWidensEveryKeyBoundaryCheck:
    """CONTAIN direction — the SQL last-line-of-defense admits deribit too.

    Byte-parity pin (per 68-CONTEXT): read the migration file and assert each of
    the four canonical ADD CONSTRAINTs appears exactly once and its paired CHECK
    IN-list admits 'deribit'. This is the pytest mirror of the vitest matrix's
    resolveColumnCheck resolution.
    """

    def test_migration_file_exists(self) -> None:
        assert _BOUNDARY_MIGRATION.is_file(), (
            f"Phase 68 boundary migration missing: {_BOUNDARY_MIGRATION}"
        )

    def test_each_widened_constraint_admits_deribit_exactly_once(self) -> None:
        sql = _BOUNDARY_MIGRATION.read_text(encoding="utf-8")
        for name in _WIDENED_CONSTRAINTS:
            # Exactly one ADD CONSTRAINT per name (the DROP + DO-block conname
            # references use different substrings, so this count is exact).
            add_count = sql.count(f"ADD CONSTRAINT {name}")
            assert add_count == 1, (
                f"expected exactly 1 'ADD CONSTRAINT {name}' in the Phase 68 "
                f"migration, found {add_count}"
            )
            # The paired CHECK (...) IN-list must contain 'deribit'.
            m = re.search(
                rf"ADD CONSTRAINT {name}\s+CHECK\s*\((.*?)\)\s*;",
                sql,
                re.DOTALL,
            )
            assert m is not None, (
                f"could not locate the CHECK body for {name} in the migration"
            )
            assert "'deribit'" in m.group(1), (
                f"{name} CHECK must admit 'deribit' but its IN-list does not: "
                f"{m.group(1).strip()}"
            )


class TestSfoxMigrationWidensEveryKeyBoundaryCheck:
    """Phase 119 (SFOX-04) — the sfox constraint-widen migration admits 'sfox'
    at each of the four canonical key-save boundary CHECKs. Mirrors the deribit
    migration-parity pattern above against the new migration file.
    """

    def test_sfox_migration_file_exists(self) -> None:
        assert _SFOX_BOUNDARY_MIGRATION.is_file(), (
            f"Phase 119 sfox boundary migration missing: {_SFOX_BOUNDARY_MIGRATION}"
        )

    def test_each_widened_constraint_admits_sfox_exactly_once(self) -> None:
        sql = _SFOX_BOUNDARY_MIGRATION.read_text(encoding="utf-8")
        for name in _WIDENED_CONSTRAINTS:
            add_count = sql.count(f"ADD CONSTRAINT {name}")
            assert add_count == 1, (
                f"expected exactly 1 'ADD CONSTRAINT {name}' in the Phase 119 "
                f"sfox migration, found {add_count}"
            )
            m = re.search(
                rf"ADD CONSTRAINT {name}\s+CHECK\s*\((.*?)\)\s*;",
                sql,
                re.DOTALL,
            )
            assert m is not None, (
                f"could not locate the CHECK body for {name} in the sfox migration"
            )
            assert "'sfox'" in m.group(1), (
                f"{name} CHECK must admit 'sfox' but its IN-list does not: "
                f"{m.group(1).strip()}"
            )


class TestIngestionSurfacesExcludeDeribit:
    """Deribit ingestion-surface pins.

    Phase 70 (DRB-08, 70-06) wires the ingestion CAPABILITY: the runtime
    registry gate (SUPPORTED_SOURCES) now ADMITS deribit so get_adapter
    resolves a DeribitAdapter. Phase 72 wires LTP onboarding: the process_key
    per-flow allow-sets admit deribit to the QUEUED flows (onboard, resync)
    only, and still reject it on the synchronous fill-based flows (teaser,
    internal_report) whose compute_metrics raises for deribit, and on csv.
    Flipping either pin requires editing it consciously — not drift.
    """

    def test_supported_sources_includes_deribit(self) -> None:
        # Phase 70 (DRB-08, 70-06) flipped this: the ingestion registry now
        # admits deribit (get_adapter("deribit") resolves a DeribitAdapter).
        # This is the ingestion CAPABILITY only — onboarding orchestration is
        # Phase 72, and the process_key per-flow sets below stay deribit-free.
        assert "deribit" in SUPPORTED_SOURCES, (
            "Phase 70 wires deribit ingestion — SUPPORTED_SOURCES must admit it."
        )

    def test_process_key_flow_sets_admit_deribit_only_on_queued_flows(self) -> None:
        # process_key's per-flow allow-sets are a method-local dict literal (not
        # importable), so pin them via source-text read (68-PATTERNS idiom).
        # Phase 72 wires deribit onboarding: it is admitted to the QUEUED flows
        # (onboard, resync) that route through the broker-dailies ledger, and
        # stays OUT of the synchronous fill-based flows (teaser, internal_report,
        # whose compute_metrics raises for deribit) and csv.
        source = _PROCESS_KEY.read_text(encoding="utf-8")
        m = re.search(
            r"valid: dict\[str, set\[str\]\] = \{.*?\n        \}",
            source,
            re.DOTALL,
        )
        assert m is not None, (
            "could not locate the process_key per-flow allow-set dict — the "
            "pin's anchor drifted; re-anchor before trusting this pin."
        )
        block = m.group(0)

        def _flow_members(flow: str) -> str:
            fm = re.search(rf'"{flow}":\s*\{{([^}}]*)\}}', block)
            assert fm is not None, (
                f"flow '{flow}' not found in the process_key allow-set dict — "
                "the pin's anchor drifted."
            )
            return fm.group(1)

        for flow in ("onboard", "resync"):
            assert "deribit" in _flow_members(flow), (
                f"Phase 72 wires deribit onboarding — the queued '{flow}' flow "
                "must admit 'deribit' (it routes through the ledger)."
            )
        for flow in ("teaser", "internal_report", "csv"):
            assert "deribit" not in _flow_members(flow), (
                f"'deribit' must stay OUT of the '{flow}' flow — the synchronous "
                "fill-based compute_metrics raises for deribit by design."
            )
