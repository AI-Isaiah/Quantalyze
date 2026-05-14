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
from unittest.mock import MagicMock, patch

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

    @pytest.mark.parametrize("value", ["  true  ", "\ttrue\n", " yes", "false ", "\t0\t"])
    def test_whitespace_around_value_is_stripped(self, value: str) -> None:
        """Env files / heredocs commonly inject trailing whitespace. The
        parser strips outer whitespace before case-folding — pin this so a
        future refactor that drops .strip() turns CI into a SystemExit."""
        # Whether each value is truthy/falsy is set by the inner token; this
        # asserts only that no SystemExit is raised (i.e. the strip is wired).
        ks._parse_run_flag(value)

    @pytest.mark.parametrize("value", ["   ", "\t\t", ""])
    def test_whitespace_only_is_falsy(self, value: str) -> None:
        """Whitespace-only normalizes to "" which is in _FALSY — parse to False."""
        assert ks._parse_run_flag(value) is False


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

    @pytest.mark.parametrize("neg_zero", ["-0", "-0.0", "-0.000"])
    def test_negative_zero_normalized_to_positive_zero(self, neg_zero: str) -> None:
        """Python's float("-0") returns -0.0, which compares equal to 0 but
        leaks a sign bit through to downstream math. Normalize to +0.0 so
        the "negative rejected" guarantee holds strictly."""
        val = ks._parse_probe_value(neg_zero)
        assert val == 0.0
        # math.copysign distinguishes +0.0 from -0.0 where == does not.
        import math
        assert math.copysign(1.0, val) > 0, f"expected +0.0, got -0.0 for {neg_zero!r}"


class TestNonnegFiniteInt:
    """argparse `--count` validator: integer-valued or reject (no silent
    truncation of `3.7` → `3`)."""

    @pytest.mark.parametrize("good,expected", [("0", 0), ("1", 1), ("42", 42), ("100.0", 100)])
    def test_integer_valued_accepted(self, good: str, expected: int) -> None:
        assert ks._nonneg_finite_int(good) == expected

    @pytest.mark.parametrize("bad", ["3.7", "0.5", "1.0001", "99.9"])
    def test_non_integer_rejected(self, bad: str) -> None:
        with pytest.raises(ValueError, match="integer-valued"):
            ks._nonneg_finite_int(bad)

    @pytest.mark.parametrize("bad", ["-1", "nan", "inf"])
    def test_nonneg_finite_invariants_preserved(self, bad: str) -> None:
        with pytest.raises(ValueError):
            ks._nonneg_finite_int(bad)


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

    def test_zero_count_raises_empty_table_diagnostic(self, monkeypatch) -> None:
        """An empty strategy_analytics table yields count=0 and NULL→empty-
        string percentiles. Without the explicit count==0 guard, the p999
        parse below would raise a generic 'empty probe value' error and the
        operator could not tell 'wrong DB' apart from 'kill-switch broken'."""
        self._stub_psql(monkeypatch, "p999,\ncount,0\n")
        with pytest.raises(RuntimeError, match="strategy_count=0"):
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
    @pytest.mark.parametrize(
        "bad_payload",
        [None, [], [{"moved": 7}], {}, {"other": 1}, "moved"],
        ids=["none", "empty_list", "wrapped_list", "empty_dict", "wrong_key", "string"],
    )
    async def test_cutover_fails_loud_on_unexpected_rpc_shape(self, bad_payload) -> None:
        """Migration 129 returns jsonb_build_object('moved', N) — a scalar
        JSONB dict. Anything else (None, list, dict-without-'moved', etc.)
        indicates the migration was rolled back or the wire shape changed.
        The helper must raise, NOT silently return 0 (which would log
        "moved 0 keys" as if the cutover succeeded)."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_supabase.rpc.return_value = mock_rpc_chain
        mock_rpc_chain.execute.return_value = MagicMock(data=bad_payload)

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(RuntimeError, match="unexpected shape"):
                await ks.cutover_strategy("strat-abc")

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


# --- Cutover loop per-strategy try/except + audit log -----------------------


class TestCutoverLoopPartialFailure:
    """If one strategy's RPC raises mid-loop, the surviving rows must still
    enqueue, the audit log must still be written (the mutations that DID
    land must be recoverable), and main() must return non-zero."""

    @pytest.mark.asyncio
    async def test_per_strategy_failure_continues_logs_returns_nonzero(
        self, monkeypatch, capsys, tmp_path
    ) -> None:
        # Redirect the TODOS audit log to a temp file so we can assert on it.
        todos_path = tmp_path / "TODOS.md"
        todos_path.write_text("# existing content\n")
        monkeypatch.setattr(ks, "TODOS_PATH", todos_path)
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        # Cutover succeeds for sids 0 and 2, fails for sid 1.
        async def fake_cutover(sid: str) -> int:
            if sid == "strat-1":
                raise RuntimeError("simulated mid-loop RPC failure")
            return 5
        monkeypatch.setattr(ks, "cutover_strategy", fake_cutover)

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(
            data=[{"strategy_id": f"strat-{i}"} for i in range(3)],
        )
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            rc = await ks.main(cli_p999=900_000.0, cli_count=3)

        captured = capsys.readouterr()
        # Mid-loop failure is surfaced.
        assert "simulated mid-loop RPC failure" in captured.out
        # Loop did NOT abort — strat-2 still processed AFTER strat-1's failure.
        assert "strat-2: moved 5 keys" in captured.out
        # Status reflects partial completion.
        assert "PARTIAL" in captured.out
        assert "2/3" in captured.out  # 2 succeeded out of 3
        # Audit log was written even though the loop had a failure.
        log = todos_path.read_text()
        assert "Kill-switch triggered" in log
        assert "1 failed" in log
        # Non-zero exit code when any strategy fails.
        assert rc == 1

    @pytest.mark.asyncio
    async def test_strategy_select_none_data_raises(self, monkeypatch) -> None:
        """If the strategy_analytics select returns rows.data=None, the
        loop must NOT silently iterate over [] and log "moved 0 keys
        across 0 strategies" (Rule 12 — fail loud)."""
        monkeypatch.setenv("RUN_KILL_SWITCH", "true")

        mock_supabase = MagicMock()
        select_chain = MagicMock()
        select_chain.execute.return_value = MagicMock(data=None)
        mock_supabase.table.return_value.select.return_value = select_chain

        with patch("scripts.phase12_kill_switch.get_supabase", return_value=mock_supabase):
            with pytest.raises(RuntimeError, match="strategy_analytics select returned None"):
                await ks.main(cli_p999=900_000.0, cli_count=3)


# --- asyncio.to_thread wrapping of blocking subprocess ---------------------


class TestMeasureP999OffloadsSubprocess:
    """measure_p999() is async; the fallback path must offload the blocking
    psql subprocess to a worker thread so the event loop stays live for
    any concurrently-awaiting coroutine."""

    @pytest.mark.asyncio
    async def test_subprocess_runs_in_thread_executor(self, monkeypatch) -> None:
        captured: dict[str, object] = {}

        def fake_via_sql() -> tuple[float, int]:
            import threading
            captured["thread_name"] = threading.current_thread().name
            return (123.0, 4)

        monkeypatch.setattr(ks, "measure_p999_via_sql", fake_via_sql)
        p999, n = await ks.measure_p999(cli_p999=None, cli_count=None)
        assert (p999, n) == (123.0, 4)
        # Anything other than the MainThread proves to_thread offloaded it.
        assert captured["thread_name"] != "MainThread", (
            "measure_p999_via_sql must run on a worker thread, not the event-loop thread"
        )
