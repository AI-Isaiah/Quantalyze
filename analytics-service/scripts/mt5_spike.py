"""MT5 feasibility spike harness (MT5SPIKE-01) — four-leg go/no-go over the live
unknowns, secret-safe and read-only by construction.

WHY: Phase 134 is the v1.15 milestone go/no-go gate. Four fuzzy unknowns decide
whether live MT5 investor-login sync is viable at all:

  1. unattended_login   — can the Wine gateway auto-login N times with NO human
                          dialog-dismissal? (Pitfall 6; the CORE go/no-go)
  2. read_only_proof    — does order_check + account_info().trade_allowed give a
                          reliable investor-vs-master read-only signal WITHOUT
                          ever touching the trade path? (Pitfall 4; [ASSUMED])
  3. deal_reconstruction — is history_deals_get viable (None != () honesty, field
                          presence, DEAL_TYPE_BALANCE flows, history depth)?
  4. server_time_offset — what is the broker-server-time vs UTC offset? (Pitfall 5)

This harness turns those four into a structured, secret-safe, per-leg
GO/NO-GO/INCONCLUSIVE report the founder produces in one command. It drives the
SAME `services.mt5_client.Mt5Client` contract that phases 135/136 use, so the
live run ALSO validates that contract against a real bridge.

The four LIVE proof legs are human_needed — they need founder demo credentials +
a running gmag11 v2.3 gateway (installed/gated by plan 134-03's human-verify
checkpoint). This module + its offline tests prove the report-assembly, verdict,
exit-code, secret-hygiene, and NO-trade-path logic against an injected fake
client; NOTHING here claims a live leg passed.

The forbidden trade call is referred to WITHOUT call parentheses throughout so
the structural grep gate stays clean; this harness never wraps it.

SECURITY (hard constraint):
  * Prerequisite: `mt5linux==1.0.3` installed (gated by the plan 134-03
    supply-chain human-verify checkpoint) + a running
    `gmag11/MetaTrader5-Docker` v2.3 gateway.
  * The gateway speaks rpyc classic / SlaveService — an UNAUTHENTICATED
    arbitrary-remote-code channel. It MUST be reachable ONLY over a PRIVATE
    network (Railway internal / WireGuard / SSH tunnel), NEVER a public port.
    This constraint carries forward as a Phase 139 provisioning requirement.
  * Credentials arrive via ENV ONLY — never argv, never a tracked file. Every
    stderr line is redacted by value first; the whole report passes
    sanitize_evidence + assert_sanitized before it reaches stdout.

USAGE
-----
  export MT5_SPIKE_LOGIN=<broker account login (int)>
  export MT5_SPIKE_INVESTOR_PASSWORD=<investor (read-only) password>
  export MT5_SPIKE_SERVER=<exact broker server string>
  export MT5_SPIKE_HOST=<gateway private host/ip>
  export MT5_SPIKE_PORT=<gateway rpyc port>       # 18812 constructor default vs
                                                   # 8001 common image map — verify
                                                   # per container
  # optional:
  export MT5_SPIKE_MASTER_PASSWORD=<master pw>     # enables leg-2 master compare
  export MT5_SPIKE_CYCLES=10                        # leg-1 login repetitions
  export MT5_SPIKE_HISTORY_DAYS=90                  # leg-3 window
  export MT5_SPIKE_SYMBOL=EURUSD                    # leg-2 order_check probe symbol
  cd analytics-service && python -m scripts.mt5_spike > /tmp/mt5_spike_report.json
  echo "exit=$?"

  # Phase 155.1 SERVERCLOCK: only the tick leg (one login, no other leg):
  cd analytics-service && python -m scripts.mt5_spike --leg tick

EXIT CODES
----------
  0  success — sanitized go/no-go JSON printed to stdout
  2  read-only premise violated (ScopeViolationError)
  3  missing required MT5_SPIKE_* env vars
  1  any other failure (scrubbed message to stderr)
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

# The ONE reuse of the deribit harness: its single-definition sanitization
# primitives + scope-violation semantics (sfox_ground_truth precedent). Never
# re-implemented here.
from scripts.deribit_ground_truth import (  # noqa: F401 - ScopeViolationError re-exported for main()
    ScopeViolationError,
    _redact_secret_values,
    assert_sanitized,
    sanitize_evidence,
)
from services.mt5_client import Mt5Client, Mt5ClientError

# MT5 order-request constants (numeric, well-known). The leg-2 probe is an
# order_check ONLY — it validates margin/funds and does NOT place an order.
_TRADE_ACTION_DEAL = 1  # immediate market execution request shape
_ORDER_TYPE_BUY = 0
_ORDER_FILLING_IOC = 1

# DEAL_TYPE_BALANCE == 2: an external deposit/withdrawal flow, never a return.
_DEAL_TYPE_BALANCE = 2

_REQUIRED_ENV = (
    "MT5_SPIKE_LOGIN",
    "MT5_SPIKE_INVESTOR_PASSWORD",
    "MT5_SPIKE_SERVER",
    "MT5_SPIKE_HOST",
    "MT5_SPIKE_PORT",
)

_VERDICTS = {"GO", "NO-GO", "INCONCLUSIVE"}

_ESCAPE_HATCH = (
    "Leg 1 NO-GO: unattended Wine auto-login is not reliable enough for a cron "
    "worker. Pivot the milestone to a native Windows VPS running the official "
    "MetaTrader5 wheel behind the IDENTICAL Mt5Client contract (only the gateway "
    "host swaps — no adapter code changes). Recorded, never papered over."
)


def _make_redactor(
    login: Any, investor_pw: str | None, master_pw: str | None, server: str | None
) -> Callable[[Any], str]:
    """Return a by-value redactor closing over the credential values. Every
    captured error string is scrubbed of these literals BEFORE it enters the
    report (belt to the report-wide assert_sanitized in main)."""
    secrets = (str(login), investor_pw, master_pw, server)

    def redact(text: Any) -> str:
        return _redact_secret_values(str(text), *secrets)

    return redact


def _probe_request(symbol: str) -> dict:
    """A minimal market-order-shaped request for order_check (PROBE ONLY — never
    submitted). order_check validates margin/funds and does not place an order."""
    return {
        "action": _TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": 0.01,
        "type": _ORDER_TYPE_BUY,
        "type_filling": _ORDER_FILLING_IOC,
    }


def _safe_close(client: Any) -> None:
    if client is None:
        return
    try:
        client.close()
    except Exception:  # noqa: BLE001 - a teardown error must never mask the leg result
        pass


def _leg1_unattended_login(
    factory: Callable[..., Any],
    host: str,
    port: int,
    login: int,
    investor_pw: str,
    server: str,
    cycles: int,
    redact: Callable[[Any], str],
) -> dict:
    """N fresh login->account_info->close cycles with no human dialog-dismissal.
    GO iff every cycle succeeds; INCONCLUSIVE >= 0.8; NO-GO below (+ escape hatch)."""
    per_cycle: list[dict] = []
    successes = 0
    for i in range(cycles):
        client = None
        try:
            client = factory(host, port)
            client.login(login, investor_pw, server)
            client.account_info()
            per_cycle.append({"cycle": i, "ok": True})
            successes += 1
        except Mt5ClientError as exc:
            per_cycle.append({"cycle": i, "ok": False, "code": exc.code})
        except Exception as exc:  # noqa: BLE001 - record any failure, redacted
            per_cycle.append({"cycle": i, "ok": False, "code": None, "detail": redact(exc)})
        finally:
            _safe_close(client)

    rate = (successes / cycles) if cycles else 0.0
    if rate >= 1.0:
        verdict = "GO"
    elif rate >= 0.8:
        verdict = "INCONCLUSIVE"
    else:
        verdict = "NO-GO"

    leg = {
        "cycles_run": cycles,
        "successes": successes,
        "success_rate": rate,
        "per_cycle": per_cycle,
        "verdict": verdict,
    }
    if verdict == "NO-GO":
        leg["escape_hatch"] = _ESCAPE_HATCH
    return leg


def _leg2_read_only_proof(
    factory: Callable[..., Any],
    host: str,
    port: int,
    login: int,
    investor_pw: str,
    master_pw: str | None,
    server: str,
    symbol: str,
    redact: Callable[[Any], str],
) -> dict:
    """order_check + account_info().trade_allowed on the investor login (and the
    master login if provided). The trade path is NEVER touched. The distinguishing
    retcode is [ASSUMED] until this leg runs live; Phase 135 encodes the real rule."""

    def probe(password: str) -> dict:
        client = None
        try:
            client = factory(host, port)
            client.login(login, password, server)
            info = client.account_info()
            check = client.order_check(_probe_request(symbol))
            return {
                "retcode": check.get("retcode"),
                "comment": check.get("comment"),
                "trade_allowed": info.get("trade_allowed"),
            }
        except Mt5ClientError as exc:
            return {"error": {"code": exc.code, "message": redact(exc)}}
        except Exception as exc:  # noqa: BLE001
            return {"error": {"code": None, "message": redact(exc)}}
        finally:
            _safe_close(client)

    leg: dict[str, Any] = {"investor": probe(investor_pw)}
    if master_pw:
        leg["master"] = probe(master_pw)
        leg["partial"] = False
    else:
        leg["partial"] = True

    leg["assumed_note"] = (
        "The exact investor-vs-master distinguishing retcode is [ASSUMED] until "
        "this leg runs live; Phase 135 encodes the real rule from the COMBINATION "
        "of the order_check retcode/comment + account_info().trade_allowed. The "
        "trade path is never touched (harness-enforced)."
    )

    trade_allowed = leg["investor"].get("trade_allowed")
    # A server-enforced read-only account (trade_allowed False) is the strongest
    # positive signal -> GO. Otherwise the order_check retcode rule is [ASSUMED],
    # so the founder must confirm live -> INCONCLUSIVE.
    leg["verdict"] = "GO" if trade_allowed is False else "INCONCLUSIVE"
    return leg


def _leg3_deal_reconstruction(
    factory: Callable[..., Any],
    host: str,
    port: int,
    login: int,
    investor_pw: str,
    server: str,
    history_days: int,
    utc_now: datetime,
    redact: Callable[[Any], str],
) -> tuple[list[dict], dict]:
    """history_deals_get over the window. An error is recorded as an ERROR
    observation with its code — NEVER coerced to 'zero deals' (the None != ()
    honesty that motivates this whole source). Returns (deals, leg_report)."""
    client = None
    try:
        client = factory(host, port)
        client.login(login, investor_pw, server)
        from_ts = utc_now - timedelta(days=history_days)
        deals = client.history_deals_get(from_ts, utc_now)
    except Mt5ClientError as exc:
        return [], {
            "observation": "error",
            "deal_count": 0,
            "error": {"code": exc.code, "message": redact(exc)},
            "verdict": "INCONCLUSIVE",
        }
    except Exception as exc:  # noqa: BLE001
        return [], {
            "observation": "error",
            "deal_count": 0,
            "error": {"code": None, "message": redact(exc)},
            "verdict": "INCONCLUSIVE",
        }
    finally:
        _safe_close(client)

    if not deals:
        return [], {
            "observation": "honest_empty",
            "deal_count": 0,
            "earliest_time": None,
            "latest_time": None,
            "verdict": "INCONCLUSIVE",
        }

    fields = ("profit", "swap", "commission", "fee", "type", "time", "time_msc")
    field_presence = {f: all(f in d for d in deals) for f in fields}
    times = [d.get("time") for d in deals if isinstance(d.get("time"), (int, float))]
    has_balance = any(d.get("type") == _DEAL_TYPE_BALANCE for d in deals)
    core_present = all(field_presence[f] for f in ("profit", "swap", "commission", "fee"))

    leg = {
        "observation": "populated",
        "deal_count": len(deals),
        "earliest_time": min(times) if times else None,
        "latest_time": max(times) if times else None,
        "field_presence": field_presence,
        "has_balance_deal": has_balance,
        "verdict": "GO" if core_present else "INCONCLUSIVE",
    }
    return deals, leg


def _leg4_server_time_offset(deals: list[dict], utc_now: datetime) -> dict:
    """Compare the most-recent deal's RAW server-time epoch vs utc_now -> a
    candidate offset rounded to the nearest 30 minutes (broker offsets are
    whole/half hours). A deal-derived offset is an ESTIMATE, not ground truth:
    founder_confirmation_required is always true, so this leg never reads GO."""
    base = {
        "founder_confirmation_required": True,
        "note": (
            "Deal-derived offset is an estimate. Confirm against the terminal's "
            "displayed server clock (VNC) and note DST behavior. The client "
            "returns raw server-time epochs VERBATIM; the ONE normalize-to-UTC "
            "seam is Phase 136's combine_mt5_deal_ledger, which subtracts the "
            "recorded offset before UTC day-bucketing."
        ),
    }
    times = [d.get("time") for d in deals if isinstance(d.get("time"), (int, float))]
    if not times:
        return {
            **base,
            "candidate_offset_minutes": None,
            "verdict": "INCONCLUSIVE",
            "note": "No deals available to derive a server-time offset. " + base["note"],
        }

    latest = max(times)
    offset_minutes = (latest - utc_now.timestamp()) / 60.0
    candidate = int(round(offset_minutes / 30.0) * 30)
    # `offset_minutes` = true_offset − deal_age: a deal is stamped server-local
    # (server_time-as-epoch = true_utc + offset), so `latest − now = offset −
    # age`. It equals the real offset ONLY when the latest deal is fresh
    # (age≈0). On a stale last deal (a closed book, a weekend, an idle account)
    # the age term dominates and pushes the estimate out of range — a 16.5h-old
    # deal on a UTC+3 server reads as −810min, not +180. Age can't be separated
    # from offset with a single deal, but real broker offsets sit within ±13h of
    # UTC (mirrors `_MT5_MAX_SERVER_UTC_OFFSET_S = 13 * 3600` in
    # services/mt5_read.py — the offset bound, NOT the wider
    # `_MT5_DEAL_FETCH_MARGIN_S` 24h fetch margin), so
    # a candidate beyond that is stale-deal noise, not signal — emit no candidate
    # rather than a red herring the founder has to reason away.
    MAX_PLAUSIBLE_OFFSET_MIN = 13 * 60
    if abs(candidate) > MAX_PLAUSIBLE_OFFSET_MIN:
        return {
            **base,
            "latest_deal_time_epoch": latest,
            "candidate_offset_minutes": None,
            "raw_offset_minutes": int(round(offset_minutes)),
            "verdict": "INCONCLUSIVE",
            "note": (
                "Deal-derived offset is out of the plausible ±13h range — the "
                "latest deal is stale, so its age dominates the server↔UTC skew "
                "and the estimate is meaningless. Confirm from a LIVE tick on a "
                "trading day or the terminal's VNC clock. " + str(base["note"])
            ),
        }
    return {
        **base,
        "latest_deal_time_epoch": latest,
        "candidate_offset_minutes": candidate,
        "verdict": "INCONCLUSIVE",
    }


def _overall_verdict(report: dict) -> str:
    verdicts = [
        report[leg]["verdict"]
        for leg in (
            "unattended_login",
            "read_only_proof",
            "deal_reconstruction",
            "server_time_offset",
        )
    ]
    if "NO-GO" in verdicts:
        return "NO-GO"
    if "INCONCLUSIVE" in verdicts:
        return "INCONCLUSIVE"
    return "GO"


def run_spike(
    env: dict,
    *,
    client_factory: Callable[..., Any],
    utc_now: datetime | None = None,
) -> dict:
    """Drive the four spike legs through the injected ``client_factory`` and
    assemble a per-leg + overall GO/NO-GO report.

    ``client_factory(host, port)`` returns an Mt5Client-shaped object — the
    injectable seam that keeps the offline tests network-free (no mt5linux, no
    live terminal). ``utc_now`` is injectable for leg-4 determinism.
    """
    login = int(env["MT5_SPIKE_LOGIN"])
    investor_pw = env["MT5_SPIKE_INVESTOR_PASSWORD"]
    server = env["MT5_SPIKE_SERVER"]
    host = env["MT5_SPIKE_HOST"]
    port = int(env["MT5_SPIKE_PORT"])
    master_pw = env.get("MT5_SPIKE_MASTER_PASSWORD") or None
    cycles = int(env.get("MT5_SPIKE_CYCLES") or 10)
    history_days = int(env.get("MT5_SPIKE_HISTORY_DAYS") or 90)
    symbol = env.get("MT5_SPIKE_SYMBOL") or "EURUSD"

    if utc_now is None:
        utc_now = datetime.now(timezone.utc)

    redact = _make_redactor(login, investor_pw, master_pw, server)

    report: dict[str, Any] = {}
    report["unattended_login"] = _leg1_unattended_login(
        client_factory, host, port, login, investor_pw, server, cycles, redact
    )
    report["read_only_proof"] = _leg2_read_only_proof(
        client_factory, host, port, login, investor_pw, master_pw, server, symbol, redact
    )
    deals, leg3 = _leg3_deal_reconstruction(
        client_factory, host, port, login, investor_pw, server, history_days, utc_now, redact
    )
    report["deal_reconstruction"] = leg3
    report["server_time_offset"] = _leg4_server_time_offset(deals, utc_now)
    report["verdict"] = _overall_verdict(report)
    return report


# -- Phase 155.1 SERVERCLOCK: the tick leg (`--leg tick`) -----------------------
#
# WHY: 155.1 admits ONE narrow tick-time method on Mt5Client (D-D), and its design
# (symbol set, rounding, freshness bound) waits on five live facts this leg
# measures (155.1-CONTEXT.md `<spike>`):
#   1. does the tick read answer for visible Market Watch symbols, and for a deal
#      symbol that is NOT visible, without symbol_select;
#   2. can the visible set be listed read-only;
#   3. is tick time in the deal `time` encoding (broker wall clock as if UTC);
#   4. how many symbols an investor session's Market Watch holds;
#   5. how old the newest tick is.
#
# Mt5Client forbids `symbol_info_tick` by construction (the contract test's
# forbidden list), so this leg logs in THROUGH Mt5Client and then reads the raw
# terminal handle the client holds. That bypass is confined to this supervised,
# founder-run spike; it is not a pattern for product code.
#
# OUTPUT HYGIENE: counts, offsets, ages, booleans and verdicts only. Symbol names
# stay in memory and never enter the report; raw exceptions are reported by TYPE
# name and terminal error CODE only, never by message.

_TICK_DEAL_DAYS = 30
_TICK_MAX_SYMBOLS = 200
_TICK_ROUND_S = 900
_TICK_FRESH_S = 120.0
_BROKER_DST_OFFSETS_S = frozenset({7200, 10800})
_MAX_PLAUSIBLE_OFFSET_S = 13 * 3600


def _raw_terminal(client: Any) -> Any:
    """The raw mt5linux handle behind a logged-in Mt5Client (spike-only bypass)."""
    return client._mt5  # noqa: SLF001 - see the tick-leg header


def _last_error_code(raw: Any) -> int | None:
    try:
        err = raw.last_error()
        return int(err[0])
    except Exception:  # noqa: BLE001 - a diagnostic read must never mask the leg
        return None


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _read_tick_times(raw: Any, name: str) -> tuple[int, int] | None:
    """(time, time_msc) of one symbol's last tick, or None when the terminal has
    no tick for it. Reads ONLY the two time fields; prices are never touched."""
    tick = raw.symbol_info_tick(name)
    if tick is None:
        return None
    return int(tick.time), int(tick.time_msc)


def _leg_tick(
    factory: Callable[..., Any],
    host: str,
    port: int,
    login: int,
    investor_pw: str,
    server: str,
    utc_now_fn: Callable[[], datetime],
    redact: Callable[[Any], str],
    raw_of: Callable[[Any], Any],
) -> dict[str, Any]:
    from services.mt5_server_clock import server_clock_for_rule

    client = None
    try:
        client = factory(host, port)
        client.login(login, investor_pw, server)
        raw = raw_of(client)

        # Item 2 + 4: the read-only listing and the Market Watch count.
        t0 = time.monotonic()
        try:
            symbols = raw.symbols_get()
        except Exception as exc:  # noqa: BLE001
            return {
                "listing": {
                    "observation": "error",
                    "error_type": type(exc).__name__,
                    "last_error_code": _last_error_code(raw),
                },
                "verdict": "INCONCLUSIVE",
                "verdict_reasons": ["symbol listing raised"],
            }
        if symbols is None:
            return {
                "listing": {"observation": "none", "last_error_code": _last_error_code(raw)},
                "verdict": "INCONCLUSIVE",
                "verdict_reasons": ["symbol listing returned None"],
            }
        visible = [str(s.name) for s in symbols if bool(s.visible)]
        listing = {
            "observation": "ok",
            "symbols_total": len(symbols),
            "visible_count": len(visible),
            "elapsed_s": round(time.monotonic() - t0, 3),
        }
        asked = visible[:_TICK_MAX_SYMBOLS]

        # Item 1 (visible) + 3 + 5: tick times for the visible set.
        t1 = time.monotonic()
        times: list[tuple[int, int]] = []
        none_count = 0
        error_types: set[str] = set()
        for name in asked:
            try:
                got = _read_tick_times(raw, name)
            except Exception as exc:  # noqa: BLE001
                error_types.add(type(exc).__name__)
                continue
            if got is None:
                none_count += 1
            else:
                times.append(got)
        now = utc_now_fn()
        visible_ticks = {
            "asked": len(asked),
            "skipped_over_cap": len(visible) - len(asked),
            "answered": len(times),
            "none": none_count,
            "errors": len(asked) - len(times) - none_count,
            "error_types": sorted(error_types),
            "elapsed_s": round(time.monotonic() - t1, 3),
            "time_matches_time_msc": (
                all(t == tm // 1000 for t, tm in times) if times else None
            ),
        }

        # Item 1 (non-visible): one deal symbol outside Market Watch, no symbol_select.
        deals = client.history_deals_get(now - timedelta(days=_TICK_DEAL_DAYS), now)
        deal_symbols = {
            str(d["symbol"]) for d in deals if isinstance(d.get("symbol"), str) and d["symbol"]
        }
        visible_set = set(visible)
        hidden = sorted(deal_symbols - visible_set)
        nonvisible: dict[str, Any] = {
            "deal_window_days": _TICK_DEAL_DAYS,
            "deal_count": len(deals),
            "deal_symbols": len(deal_symbols),
            "deal_symbols_visible": len(deal_symbols & visible_set),
        }
        if not deals:
            nonvisible["observation"] = "no_deals"
        elif not hidden:
            nonvisible["observation"] = "no_candidate"
        else:
            try:
                got = _read_tick_times(raw, hidden[0])
                nonvisible["observation"] = "none" if got is None else "answered"
                if got is None:
                    nonvisible["last_error_code"] = _last_error_code(raw)
            except Exception as exc:  # noqa: BLE001
                nonvisible["observation"] = "error"
                nonvisible["error_type"] = type(exc).__name__
                nonvisible["last_error_code"] = _last_error_code(raw)

        report: dict[str, Any] = {
            "listing": listing,
            "visible_ticks": visible_ticks,
            "nonvisible_deal_symbol": nonvisible,
        }
        reasons: list[str] = []
        if not times:
            if asked and not error_types:
                report["verdict"] = "NO-GO"
                reasons.append("no visible symbol answered the tick read")
            else:
                report["verdict"] = "INCONCLUSIVE"
                reasons.append(
                    "Market Watch is empty" if not asked else "tick reads raised"
                )
            report["verdict_reasons"] = reasons
            return report

        # Item 3 + 5: offset, encoding, freshness.
        now_s = now.timestamp()
        newest_ms = max(tm for _, tm in times)
        newest_wall_s = newest_ms / 1000.0
        raw_offset_s = newest_wall_s - now_s
        rounded = int(round(raw_offset_s / _TICK_ROUND_S) * _TICK_ROUND_S)
        expected = {
            rule: server_clock_for_rule(rule).instant_offset_s(int(newest_wall_s))
            for rule in ("eu", "us")
        }
        if rounded in _BROKER_DST_OFFSETS_S:
            encoding = "broker_wall_clock"
        elif rounded == 0:
            encoding = "utc"
        else:
            encoding = "inconclusive"
        age_vs_rule = {
            rule: (round(exp - raw_offset_s, 3) if exp is not None else None)
            for rule, exp in expected.items()
        }
        lags = [newest_ms / 1000.0 - tm / 1000.0 for _, tm in times]
        report["offset"] = {
            "raw_offset_s": round(raw_offset_s, 3),
            "rounded_offset_s": rounded,
            "rounding_s": _TICK_ROUND_S,
            "residual_s": round(rounded - raw_offset_s, 3),
            "plausible": abs(rounded) <= _MAX_PLAUSIBLE_OFFSET_S,
            "encoding": encoding,
            "expected_offset_s": expected,
            "matches_rule": {rule: exp == rounded for rule, exp in expected.items()},
        }
        report["freshness"] = {
            "newest_tick_age_s_vs_rule": age_vs_rule,
            "lag_behind_newest_s": {
                "median": _median(lags),
                "max": round(max(lags), 3),
            },
            "symbols_within_60s_of_newest": sum(1 for x in lags if x <= 60),
            "symbols_within_900s_of_newest": sum(1 for x in lags if x <= 900),
        }

        # Item 3, deal side: a past deal in the same encoding is never later than
        # the server clock's newest tick. Necessary, not sufficient: the real
        # proof is criterion 5's near-midnight deal read in the 155.2 session.
        deal_times = [
            (int(d["time"]), d.get("time_msc"))
            for d in deals
            if isinstance(d.get("time"), (int, float))
        ]
        if deal_times:
            latest_t = max(t for t, _ in deal_times)
            report["deal_encoding"] = {
                "latest_deal_minus_newest_tick_s": round(latest_t - newest_wall_s, 3),
                "latest_deal_minus_utc_now_s": round(latest_t - now_s, 3),
                "deal_time_matches_time_msc": all(
                    t == int(tm) // 1000 for t, tm in deal_times if isinstance(tm, (int, float))
                ),
                "consistent": latest_t <= newest_wall_s + 1,
            }
        else:
            report["deal_encoding"] = {"observation": "no_deals", "consistent": None}

        fresh = all(a is not None and abs(a) <= _TICK_FRESH_S for a in age_vs_rule.values())
        if encoding != "broker_wall_clock":
            reasons.append(f"tick encoding {encoding}")
        if not fresh:
            reasons.append(f"newest tick older than {_TICK_FRESH_S:.0f}s (closed market or break?)")
        if report["deal_encoding"].get("consistent") is False:
            reasons.append("latest deal is later than the newest tick")
        report["verdict"] = "GO" if not reasons else "INCONCLUSIVE"
        report["verdict_reasons"] = reasons
        return report
    except Mt5ClientError as exc:
        return {
            "observation": "error",
            "error": {"code": exc.code, "message": redact(exc)},
            "verdict": "INCONCLUSIVE",
            "verdict_reasons": ["Mt5Client raised"],
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "observation": "error",
            "error": {"code": None, "type": type(exc).__name__},
            "verdict": "INCONCLUSIVE",
            "verdict_reasons": ["unexpected error"],
        }
    finally:
        _safe_close(client)


def run_tick_spike(
    env: dict[str, str],
    *,
    client_factory: Callable[..., Any],
    utc_now_fn: Callable[[], datetime] | None = None,
    raw_of: Callable[[Any], Any] = _raw_terminal,
) -> dict[str, Any]:
    """Run ONLY the 155.1 tick leg: one login, read-only, no other leg."""
    login = int(env["MT5_SPIKE_LOGIN"])
    investor_pw = env["MT5_SPIKE_INVESTOR_PASSWORD"]
    server = env["MT5_SPIKE_SERVER"]
    redact = _make_redactor(login, investor_pw, None, server)
    leg = _leg_tick(
        client_factory,
        env["MT5_SPIKE_HOST"],
        int(env["MT5_SPIKE_PORT"]),
        login,
        investor_pw,
        server,
        utc_now_fn or (lambda: datetime.now(timezone.utc)),
        redact,
        raw_of,
    )
    return {"server_clock_tick": leg, "verdict": leg["verdict"]}


def _default_client_factory(host: str, port: int) -> Mt5Client:
    """Construct the real read-only Mt5Client (the SAME contract 135/136 use).
    mt5linux is imported lazily inside the client's transport, so this factory
    only needs the package at LIVE run time — not in the offline tests."""
    return Mt5Client(host, port)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint. Prints ONE sanitized go/no-go JSON object to stdout.

    Exit codes: 0 success, 2 scope violation, 3 missing env vars, 1 other.
    """
    import argparse
    import json
    import os
    import sys

    parser = argparse.ArgumentParser(
        description="MT5 feasibility spike — four-leg go/no-go harness (MT5SPIKE-01)."
    )
    parser.add_argument(
        "--leg",
        choices=("all", "tick"),
        default="all",
        help="'tick' runs ONLY the Phase 155.1 server-clock tick leg (one login).",
    )
    args = parser.parse_args(argv)

    missing = [name for name in _REQUIRED_ENV if not os.getenv(name)]
    if missing:
        print(
            "ERROR: missing required env vars: "
            + ", ".join(missing)
            + " (env only; values are never printed).",
            file=sys.stderr,
        )
        return 3

    env = {k: v for k, v in os.environ.items() if k.startswith("MT5_SPIKE_")}
    login = os.getenv("MT5_SPIKE_LOGIN")
    investor_pw = os.getenv("MT5_SPIKE_INVESTOR_PASSWORD")
    master_pw = os.getenv("MT5_SPIKE_MASTER_PASSWORD")
    server = os.getenv("MT5_SPIKE_SERVER")

    try:
        if args.leg == "tick":
            report = run_tick_spike(env, client_factory=_default_client_factory)
        else:
            report = run_spike(env, client_factory=_default_client_factory)
    except ScopeViolationError as exc:
        # Scope strings are not secrets — print the fail-loud reason verbatim.
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(
            "ERROR: " + _redact_secret_values(str(exc), login, investor_pw, master_pw, server),
            file=sys.stderr,
        )
        return 1

    clean = sanitize_evidence(report)
    assert_sanitized(clean)
    print(json.dumps(clean, indent=2, default=str))
    return 0


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
