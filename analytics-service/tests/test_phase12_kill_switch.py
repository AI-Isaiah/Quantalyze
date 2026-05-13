"""Tests for analytics-service/scripts/phase12_kill_switch.py.

P2021 (opt-IN RUN_KILL_SWITCH + truthy parse):
    The original `SKIP_KILL_SWITCH=1` opt-OUT polarity is wrong — kill-switch
    fires by default, which is dangerous on partial deploys. We invert to
    opt-IN `RUN_KILL_SWITCH` and require a real truthy parse (not literal
    "1" equality, which silently misreads `=true` as "do not run").
    Unknown values fail loud (SystemExit) per CLAUDE.md Rule 12.

P2022 (SQL probe keyed parse + NaN/inf/negative reject):
    The probe SQL now emits key,value pairs (`p999,820000`) so a column
    re-order in the SQL cannot silently shift the parsed p999 to a
    different percentile. NaN/inf/negative values raise rather than
    poisoning the kill-switch decision.

P2024 (atomic cutover via migration 129 RPC):
    `cutover_strategy` no longer SELECTs metrics_json + projects sibling
    payload in Python — it delegates the entire read+strip to the new
    `cutover_strategy_metrics_keys_atomic(p_strategy_id)` Postgres
    function, which locks the row with SELECT ... FOR UPDATE inside the
    function body. Closes the race window vs concurrent analytics_runner
    writes.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts import phase12_kill_switch as ks


# --- P2021: RUN_KILL_SWITCH truthy parse -------------------------------------


class TestParseRunFlag:
    """The truthy parser is the security boundary — anything that looks like
    'yes' must opt in, anything that looks like 'no' must opt out, anything
    else must fail loud rather than silently default."""

    @pytest.mark.parametrize("value", ["true", "TRUE", "True", "yes", "YES", "1", "on", "ON"])
    def test_truthy_values_parse_to_true(self, value: str) -> None:
        assert ks._parse_run_flag(value) is True

    @pytest.mark.parametrize("value", ["false", "FALSE", "False", "no", "NO", "0", "off", "OFF", ""])
    def test_falsy_values_parse_to_false(self, value: str) -> None:
        assert ks._parse_run_flag(value) is False

    @pytest.mark.parametrize("value", ["maybe", "kinda", "2", "truee", "y", "n"])
    def test_unknown_values_raise_systemexit(self, value: str) -> None:
        """CLAUDE.md Rule 12: fail loud. A typo like RUN_KILL_SWITCH=ture must
        not silently fall through to "do nothing" or "run anyway"."""
        with pytest.raises(SystemExit):
            ks._parse_run_flag(value)


class TestMainRunFlagGate:
    """The env-var gate must default to BYPASS (opt-in semantics)."""

    @pytest.mark.asyncio
    async def test_unset_run_kill_switch_bypasses(self, monkeypatch, capsys) -> None:
        """Default behavior: nothing in the environment → skip the cutover.
        This is the polarity inversion from the old SKIP_KILL_SWITCH=1 opt-out."""
        monkeypatch.delenv("RUN_KILL_SWITCH", raising=False)
        monkeypatch.delenv("SKIP_KILL_SWITCH", raising=False)
        rc = await ks.main(cli_p999=900_000.0, cli_count=10)
        assert rc == 0
        captured = capsys.readouterr()
        assert "RUN_KILL_SWITCH" in captured.out
        assert "bypassing" in captured.out.lower()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("falsy", ["false", "0", "no", "", "off"])
    async def test_falsy_run_kill_switch_bypasses(self, monkeypatch, falsy: str, capsys) -> None:
        monkeypatch.setenv("RUN_KILL_SWITCH", falsy)
        rc = await ks.main(cli_p999=900_000.0, cli_count=10)
        assert rc == 0
        captured = capsys.readouterr()
        assert "bypassing" in captured.out.lower()

    @pytest.mark.asyncio
    async def test_garbage_run_kill_switch_fails_loud(self, monkeypatch) -> None:
        """An unrecognized RUN_KILL_SWITCH value must abort with SystemExit,
        not default to either bypass or run."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "maybe")
        with pytest.raises(SystemExit):
            await ks.main(cli_p999=900_000.0, cli_count=10)

    @pytest.mark.asyncio
    async def test_truthy_run_kill_switch_proceeds_below_threshold(self, monkeypatch, capsys) -> None:
        """Truthy gate + p999 below threshold → proceeds past the gate but
        exits early in the threshold check (no DB calls)."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")
        # p999 below threshold short-circuits before any get_supabase() call.
        rc = await ks.main(cli_p999=100_000.0, cli_count=10)
        assert rc == 0
        captured = capsys.readouterr()
        assert "no cutover needed" in captured.out.lower()


# --- P2022: SQL probe parse safety ------------------------------------------


class TestParseProbeValue:
    """The probe parser must reject any non-finite or negative value before
    it can poison the kill-switch decision."""

    @pytest.mark.parametrize("bad", ["nan", "NaN", "NAN", "inf", "Infinity", "-inf", "-Infinity"])
    def test_nan_and_inf_rejected(self, bad: str) -> None:
        with pytest.raises(ValueError):
            ks._parse_probe_value(bad)

    @pytest.mark.parametrize("neg", ["-1", "-1.0", "-0.00001", "-9999999"])
    def test_negative_rejected(self, neg: str) -> None:
        with pytest.raises(ValueError):
            ks._parse_probe_value(neg)

    @pytest.mark.parametrize("good,expected", [("0", 0.0), ("0.0", 0.0), ("123456", 123456.0), ("800000.0", 800000.0)])
    def test_valid_nonneg_finite_accepted(self, good: str, expected: float) -> None:
        assert ks._parse_probe_value(good) == expected


class TestSqlProbeParsing:
    """measure_p999_via_sql now parses key,value rows. Missing keys, bad
    values, or unknown stdout shapes must all raise."""

    def _stub_psql(self, monkeypatch, stdout: str, returncode: int = 0, stderr: str = "") -> None:
        monkeypatch.setenv("DATABASE_URL", "postgresql://stub/x")
        result = MagicMock(returncode=returncode, stdout=stdout, stderr=stderr)
        monkeypatch.setattr("scripts.phase12_kill_switch.subprocess.run", lambda *a, **kw: result)

    def test_keyed_parse_happy_path(self, monkeypatch) -> None:
        self._stub_psql(
            monkeypatch,
            "p50,12345\np95,234567\np99,345678\np999,456789\nmax,567890\ncount,42\n",
        )
        p999, n = ks.measure_p999_via_sql()
        assert p999 == 456789.0
        assert n == 42

    def test_missing_p999_key_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p50,12345\ncount,42\n")
        with pytest.raises(RuntimeError, match="p999"):
            ks.measure_p999_via_sql()

    def test_missing_count_key_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,456789\n")
        with pytest.raises(RuntimeError, match="count"):
            ks.measure_p999_via_sql()

    def test_nan_p999_in_probe_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,nan\ncount,42\n")
        with pytest.raises(ValueError):
            ks.measure_p999_via_sql()

    def test_inf_p999_in_probe_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,inf\ncount,42\n")
        with pytest.raises(ValueError):
            ks.measure_p999_via_sql()

    def test_negative_count_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "p999,500\ncount,-3\n")
        with pytest.raises(ValueError):
            ks.measure_p999_via_sql()

    def test_unknown_stdout_shape_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "absolute,garbage,here,no,commas")
        with pytest.raises(RuntimeError):
            ks.measure_p999_via_sql()

    def test_psql_nonzero_exit_raises(self, monkeypatch) -> None:
        self._stub_psql(monkeypatch, "", returncode=2, stderr="role not found")
        with pytest.raises(RuntimeError, match="role not found"):
            ks.measure_p999_via_sql()

    def test_no_database_url_raises(self, monkeypatch) -> None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            ks.measure_p999_via_sql()


# --- P2024: atomic cutover via RPC ------------------------------------------


class TestCutoverDelegatesToAtomicRpc:
    """The Python side must no longer SELECT metrics_json and project a
    sibling payload — that's a race against analytics_runner writes. The new
    RPC reads + strips inside SELECT ... FOR UPDATE."""

    @pytest.mark.asyncio
    async def test_cutover_calls_atomic_rpc_with_strategy_id_only(self) -> None:
        """The atomic RPC takes ONLY p_strategy_id; the function body
        reads metrics_json itself under FOR UPDATE. Python must not pass
        a client-side payload."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 7})

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            moved = await ks.cutover_strategy("strat-abc")

        assert moved == 7
        mock_supabase.rpc.assert_called_once_with(
            "cutover_strategy_metrics_keys_atomic",
            {"p_strategy_id": "strat-abc"},
        )

    @pytest.mark.asyncio
    async def test_cutover_no_longer_selects_metrics_json(self) -> None:
        """Regression guard: the old code path SELECTed strategy_analytics
        first. The atomic version must not touch .table('strategy_analytics')
        at all from Python — the RPC does the read under lock."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 0})

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            await ks.cutover_strategy("strat-abc")

        mock_supabase.table.assert_not_called()

    @pytest.mark.asyncio
    async def test_cutover_missing_data_returns_zero(self) -> None:
        """If the RPC returns NULL/empty (no row), moved must be 0, not crash."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data=None)

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            moved = await ks.cutover_strategy("strat-abc")
        assert moved == 0

    @pytest.mark.asyncio
    async def test_cutover_does_not_drop_runner_writes(self) -> None:
        """Structural test for the race-window fix.

        Old behavior: Python SELECTed metrics_json, built `sibling_payload`
        from the snapshot, then called an RPC with that payload. Between
        the SELECT and the RPC, analytics_runner could write a NEW
        metrics_json that the cutover snapshot wouldn't observe.

        New behavior: the entire read+strip happens in the function body
        under SELECT ... FOR UPDATE, so concurrent writers either block
        or commit on top of a post-strip state.

        We can't run real concurrency without a live DB. Instead we assert
        the API contract: cutover_strategy makes exactly ONE call into the
        supabase client (the RPC), and that call passes ONLY p_strategy_id.
        Any sibling-payload arg in the call would indicate a regression
        back to the race-prone path."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data={"moved": 3})

        runner_writes: list[str] = []

        async def fake_runner_write() -> None:
            await asyncio.sleep(0)
            runner_writes.append("after_cutover_read")

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            # Interleave a "runner write" with cutover. Python coroutines can
            # only see one ordering of awaits; the point is that cutover's
            # ONLY mutation call is the RPC, with strategy_id only.
            await asyncio.gather(ks.cutover_strategy("strat-abc"), fake_runner_write())

        # The cutover made exactly one RPC call, with no sibling payload.
        assert mock_supabase.rpc.call_count == 1
        rpc_args = mock_supabase.rpc.call_args.args
        assert rpc_args[0] == "cutover_strategy_metrics_keys_atomic"
        assert rpc_args[1] == {"p_strategy_id": "strat-abc"}
        # Most importantly: no client-side metrics_json snapshot was passed in.
        assert "p_kinds" not in rpc_args[1]
        assert "metrics_json" not in rpc_args[1]


# --- Argparse validator ------------------------------------------------------


class TestArgparseValidator:
    """--p999 and --count must reject NaN, inf, and negative values at
    parse time (before the threshold compare can be poisoned)."""

    @pytest.mark.parametrize("bad", ["nan", "inf", "-1", "-1.0"])
    def test_p999_rejects_bad(self, bad: str) -> None:
        with pytest.raises(ValueError):
            ks._nonneg_finite(bad)

    @pytest.mark.parametrize("good,expected", [("0", 0.0), ("123.4", 123.4), ("999999.9", 999999.9)])
    def test_p999_accepts_good(self, good: str, expected: float) -> None:
        assert ks._nonneg_finite(good) == expected


# --- Drift guard: HEAVY_KINDS lives server-side only ------------------------


def test_no_python_heavy_kinds_constant() -> None:
    """Drift guard: after P2024 the v_allowlist lives in migration 129's
    SQL function body alone. A Python HEAVY_KINDS list would invite the
    two to drift. This test fails the moment someone re-adds it."""
    assert not hasattr(ks, "HEAVY_KINDS"), (
        "P2024: HEAVY_KINDS must NOT be defined in Python — single "
        "source of truth lives in supabase/migrations/129_*.sql v_allowlist."
    )
