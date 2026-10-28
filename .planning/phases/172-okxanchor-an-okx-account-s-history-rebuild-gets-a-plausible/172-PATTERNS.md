# Phase 172: OKXANCHOR - Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 7 (4 modified, 2 new, 1 rewritten test)
**Analogs found:** 7 / 7
All paths are under `analytics-service/` and git-tracked (verified with `git ls-files` for the probe, `services/exchange.py`, `tests/_trade_pages.py`). Line numbers are as of 2026-10-27 at the worktree HEAD; re-grep by symbol at plan time.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/allocator_history_probe.py` (modify: new keys, advisory second pass) | utility (read-only diagnostic) | batch / transform | itself: `ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS`, `_account_record`, `_read_member` | exact |
| `tests/test_allocator_history_probe.py` (extend) | test | request-response | itself: `test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary`, `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens`, static-pin tests | exact |
| `services/exchange.py` (add raw-balance row reader + bills-archive opening reducer/walk) | service (venue I/O) | request-response, paged | `fetch_okx_total_equity_and_upl_usd` + `_okx_bills_fetch_with_backoff` | exact |
| `services/equity_reconstruction.py` (OKX-only branch in the anchor block) | service | transform | the existing anchor block and `_BYBIT_UPNL_TOLERANCE_*` comparator | exact |
| `tests/test_okx_anchor_oracle.py` (new) | test | request-response | `test_reconstruct_force_rebuild.py` terminus test + `_okx_exchange` + `VenueTradeBook` | role-match |
| `tests/test_ana_recon_audit.py::test_c01_03...` (rewrite or delete) | test | n/a | `test_forced_rebuild_refuses_an_implausible_anchor_offset` (real-arm pin) | exact |
| pure comparator (`opening_agrees`) and bills reducer (`per_ccy_opening`) | utility (pure) | transform | `max(_BYBIT_UPNL_TOLERANCE_USD, REL * abs(wallet))` at `equity_reconstruction.py:3977-3979` | role-match |

## Pattern Assignments

### `scripts/allocator_history_probe.py` (utility, batch)

**Analog:** the same file. Adding a key is a THREE-PLACE edit (RESEARCH Pitfall 7): tuple, validator dict, default record. Missing any one makes `_check_keys`/`validate_record` raise, and `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` compares `set(ACCOUNT_RECORD_KEYS) == set(_account_record(...))`.

**Key whitelist** (lines 126-154): flat tuple of string keys, `"record", "account", "run_date", ..., "transfers_older_365d"`. Append new keys at the end.

**Validator vocabulary** (lines 179-203, reuse, do not invent):
```python
def _is_count(x): return isinstance(x, int) and not isinstance(x, bool) and x >= 0
def _is_count_or_absent(x): return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)
def _is_sig3_float(x): return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x
def _is_ratio(x):
    if isinstance(x, str): return x == FIELD_ABSENT
    return _is_sig3_float(x)
def _is_one_of(allowed): return lambda x: isinstance(x, str) and x in allowed
```
Mapping for the proposed keys: ratios (`anchor_over_replay`, `non_stable_share`, `upl_over_anchor`, `implied_opening_over_anchor`, `bills_opening_over_anchor`, `opening_residual_over_anchor`, `bal_over_cashbal`, `bot_equity_share`, `bills_transfer_net_over_anchor`) use `_is_ratio`; counts (`flip_from_flat_closes`, `negative_qty_assets`, `flow_events_in_window`, `skipped_symbols_count`, `hedge_mode_fills`) use `_is_count` (or `_is_count_or_absent` when unmeasurable); bools (`breakdown_truncated`) use `_is_bool`; tokens (`replay_final_sign`, `opening_check`, `opening_unavailable_reason`) use `_is_one_of((...))`.

**Validators entry shape** (lines 205-233):
```python
_ACCOUNT_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    ...
    "max_rel_diff": _is_ratio,
    "days_incomplete": _is_count,
    "transfers_older_365d": _is_count,
}
```

**Default record** (lines 649-679): `_account_record` builds a dict of defaults then `{**record, **values}`. Defaults for ratios are `FIELD_ABSENT` (as `max_rel_diff`), for counts `0`, for tokens the neutral token (`"none"`, as `member_refusal`).

**Core pattern to extend** (`_read_member`, line 544): currently `er._fetch_and_price_window(client, venue, supabase, window_start, end_date, require_anchor=True)`. RESEARCH step 1: catch `ForcedRebuildRefusedError` with `reason == "anchor_skipped_implausible"`, run an advisory pass (no `require_anchor`) with a FRESH `_TradeRecorder` (Pitfall 8), then one raw `private_get_account_balance()` GET and the oracle read. Selection-time refusals are already mapped via `except er.ForcedRebuildRefusedError as exc: return _account_record(label, run_date, selection=exc.reason)` (in `_probe_account`).

**Redaction rules:** `sig3` returns the STRING `"non-finite"` for inf/NaN, which `_is_ratio` rejects, so guard every denominator (`L <= 0`, `A <= 0`) and emit `FIELD_ABSENT`. The only stdout path is `emit_record` -> `validate_record` -> `assert_sanitized`.

**Naming trap (Pitfall 10):** the source pin regexes `\b(create_order|cancel_order|withdraw|transfer)\(`; name helpers `transfers_net_...`, never `net_transfer(`.

---

### `tests/test_allocator_history_probe.py` (test, extend)

**Analog:** same file.

**Vocabulary/redaction pattern** (lines 834-885): build a control record, assert each bad value raises `ValueError`, and that the message names the key and never the value:
```python
rec = hp._account_record("a1", "2026-10-23", trades_read=12, window_days=90)
assert json.loads(hp.emit_record(rec))["trades_read"] == 12  # control
with pytest.raises(ValueError):
    hp.emit_record(dict(rec, max_rel_diff=0.123456))  # a float not rounded to 3 figures
with pytest.raises(ValueError):
    hp.emit_record(dict(rec, trades_read=True))       # True where a count is declared
...
with pytest.raises(ValueError) as exc:
    hp.emit_record(dict(rec, failure_class="boom 4321.5"))
assert "4321.5" not in str(exc.value)
```
Add one arm per new key type (unrounded ratio, `"non-finite"`, bool-as-count, out-of-set token, negative count). Keep the neuter-and-restore discipline (N6).

**Key-set parity pin** (lines 888-894): `assert set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))`. Stays green only if all three places moved.

**Static pins the new probe code must satisfy** (lines 786-799):
```python
for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
    assert write not in _PROBE_SRC, write
assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", _PROBE_SRC)
assert "private_get_trade_fills_history(" in _PROBE_SRC
assert not re.search(r"\bprivate_(post|put|delete)_", _PROBE_SRC)
```
New venue calls: `private_get_*` only (balance, bills-archive). Also still pinned (lines 802-830): only the two tables, every `supabase` parameter typed `ReadOnlySupabase`.

**End-to-end harness:** `_Services` (line 229) and `_StubVenue` (line 193) supply the venue stub; `_okx_only_book()` (line 502) and `_okx_two_pass_reader(services)` (line 487) are the OKX fixtures to extend with raw balance / bills-archive replies. An anchor-refusal member test exists at `test_an_anchor_refusal_is_a_member_refusal_token_and_fails_the_run` (line 1195): copy its shape for the new advisory pass.

---

### `services/exchange.py` (service, request-response)

**Analog:** `fetch_okx_total_equity_and_upl_usd` (lines 3015-3061) and `fetch_okx_total_equity_usd` (3064). RESEARCH Open Question 4: add a SIBLING reader returning the whole `data[0]` row (so `totalEq` and `details[]` come from ONE response) and keep the existing function a thin delegate, exactly as `fetch_okx_total_equity_usd` already delegates:
```python
async def fetch_okx_total_equity_usd(exchange):
    eq, _upl, _unreadable = await fetch_okx_total_equity_and_upl_usd(exchange)
    return eq
```

**Raw balance read + error handling** (lines 3040-3061):
```python
try:
    raw = await exchange.private_get_account_balance()
except Exception as e:  # noqa: BLE001
    logger.warning(
        "OKX raw account balance fetch failed: exc_class=%s scrubbed=%s",
        type(e).__name__, scrub_freeform_string(str(e)),
    )
    return None, 0.0, False
data = (raw or {}).get("data") or []
if not data or not isinstance(data, list):
    return None, 0.0, False
row = data[0] if isinstance(data[0], dict) else {}
```
Note: this swallows all exceptions into "unreadable". For the ORACLE, RESEARCH Pitfall 3 says the opposite: `RateLimitExceeded`/network errors must PROPAGATE (only structural gaps are "unavailable"). Do not copy the blanket `except Exception` into the bills walk.

**Bills page fetch with 429 backoff** (lines 1378-1410): `_okx_bills_fetch_with_backoff(exchange, method_name, params, *, label, page)` retries only `ccxt.RateLimitExceeded`/`ccxt.DDoSProtection`, re-raises everything else. Call it with `method_name="private_get_account_bills_archive"`, params `{"begin": str(T0), "limit": "100"}`, paging `after=<oldest billId>`. Do not re-implement the retry loop.

**Finite-number parsing:** `_finite_float(value, *, label)` (line 373) or `Decimal`; never bare `float()` on venue strings. The existing `fetch_okx_total_equity_and_upl_usd` uses bare `float(raw_eq)`; the oracle should use the stricter helper (bool/NaN/inf rejected).

**Page ceiling idiom:** `_TRADE_PASS_PAGE_CEILING` in the trade walk; hitting the ceiling means "unavailable", never a partial answer.

**Existing bills loop to NOT reuse** (lines ~1449-1475, 1597-1614): it drops `bal`/`balChg`/`ccy` and filters `instType` on every call, which excludes blank-`instType` transfers.

---

### `services/equity_reconstruction.py` (anchor block, transform)

**Analog:** the block itself, lines 3578-3692.

**Trigger to keep as the cheap first gate** (lines 3582-3593):
```python
if rows and anchor is not None:
    last_value = float(rows[-1].get("value_usd") or 0.0)
    offset = anchor - last_value
    _implausible_anchor = (
        last_value > 0
        and abs(offset) > 5.0 * abs(last_value)
    )
```
Arm order (3607+): `if hit_terminus:` / `elif anchor_partial_symbols:` / `elif _unreliable_replay:` / `elif _implausible_anchor:` / anchoring `else`. The OKX branch goes INSIDE the implausible arm: oracle agrees -> fall to the anchoring path; disagrees or unavailable -> keep setting `_anchor_skipped_implausible`. The forced-path mapping (lines 3675-3688) needs NO change and the vocabulary stays closed at 15 tokens:
```python
elif _anchor_skipped_implausible:
    _refusal = "anchor_skipped_implausible"
...
if _refusal is not None:
    raise ForcedRebuildRefusedError(_refusal)
```
The raise-site scan test pins that the double-quoted literals passed to `ForcedRebuildRefusedError(` or assigned to `_refusal =` EQUAL the closed set; do not add a literal.

**Tolerance comparator precedent** (lines 3774-3775, 3977-3979, 4142):
```python
_BYBIT_UPNL_TOLERANCE_USD: Final[float] = 1.0
_BYBIT_UPNL_TOLERANCE_REL: Final[float] = 0.005
...
max(_BYBIT_UPNL_TOLERANCE_USD, _BYBIT_UPNL_TOLERANCE_REL * abs(_wallet_total))
```
Mirror as `OPENING_TOLERANCE_USD = 1.0` and `OPENING_TOLERANCE_REL` (set from a4's measured residual, constant comment carries date and measurement). Keep the comparator a PURE function so the boundary is unit-testable.

**Unforced path stays unchanged** (RESEARCH OQ1): OKX unforced starts 730 days back, hits the terminus arm first (`BACKFILL_CAP_DAYS` vs `OKX_TRADE_TERMINUS_DAYS`), ships unanchored. A test must pin that the unforced OKX path makes NO bills call.

---

### `tests/test_okx_anchor_oracle.py` (NEW, test)

**Analog:** `tests/test_reconstruct_force_rebuild.py`.

**Helpers to import/reuse:**
- `_freeze_now_at(monkeypatch, instant)` (line 104): patches `er.datetime` with a `_FakeDatetime` whose `now(tz)` returns `instant`.
- `_first_call_trades(trades)` (line 626): `AsyncMock(side_effect=_fetch)` answering `trades` on the first call and `[]` afterwards.
- `_okx_exchange()` (line 641): Bybit-shaped mock with `exchange.id = "okx"` and one BTC buy nine days back:
```python
exchange = await _bybit_exchange()
exchange.id = "okx"
exchange.fetch_my_trades = _first_call_trades(
    [_make_trade(_trade_ts(), "BTC/USDT", "buy", 50000.0, 1.0)]
)
return exchange
```
- `tests/_trade_pages.VenueTradeBook` (line 145): in-memory trade list as `AsyncMock(side_effect=...)`, reads `exchange.id` at call time, models OKX's `until` backward walk; calls recorded on `.calls`. Use it where multi-page OKX reads matter.

**Forced-window call shape** (the terminus test, lines 652-690): freeze now six hours after midnight so the 89-day window is inside the terminus at any time of day, then:
```python
_freeze_now_at(monkeypatch, END_DATE + timedelta(hours=6))
fake = _MarkerFake()
end = END_DATE.date()
rows, hit_terminus, _telemetry = await er._fetch_and_price_window(
    await _okx_exchange(), "okx", fake, end - timedelta(days=89), end,
    require_anchor=True,
)
```
Refusal assertion shape: `with pytest.raises(er.ForcedRebuildRefusedError) as excinfo: ...; assert excinfo.value.reason == "..."`.

**Critical difference:** the terminus test patches `services.exchange.fetch_okx_total_equity_usd` with `AsyncMock(return_value=1250.5)`. For this phase do NOT patch it; set `exchange.private_get_account_balance` and `exchange.private_get_account_bills_archive` EXPLICITLY with dict payloads (Pitfall 2: an unset method on `AsyncMock()` returns a MagicMock), so the real raw readers run. The replay must end small and positive (a BTC buy marked up a little) so `A / L > 6`.

**Cases (each a separate test):** agree (anchors, `rows[-1]["value_usd"] == pytest.approx(anchor)`), disagree, boundary at exactly the tolerance, unavailable variants (empty, unproven reach, chain break, unpriced currency, page ceiling, non-dict reply), `RateLimitExceeded` propagates, unforced OKX makes no bills call. Run mutations N1-N6 (neuter, see RED, restore from a byte backup).

---

### `tests/test_ana_recon_audit.py::test_c01_03_implausible_offset_skips_anchor` (rewrite or delete)

**Defect (lines 65-101):** monkeypatches `services.equity_reconstruction._fetch_and_price_window` (the function under test) with a fake of mismatched signature, then asserts a locally restated copy of the formula on literals 1000 and 50000:
```python
implausible = last_value > 0 and abs(offset) > 5.0 * abs(last_value)
assert implausible, ...
```
No production line runs, so it cannot fail. Replace it with, or point it at, the real-arm pin below.

**Real-arm analog:** `test_forced_rebuild_refuses_an_implausible_anchor_offset` (`test_reconstruct_force_rebuild.py:711-725`), Bybit-shaped, goes through `_assert_forced_rebuild_refused(monkeypatch, exchange, "anchor_skipped_implausible")`:
```python
payload = bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "100000", "250.5")])
exchange = await _bybit_exchange()
exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
exchange.fetch_my_trades = _first_call_trades(
    [_make_trade(_trade_ts(), "BTC/USDT", "buy", 40000.0, 1.0)]
)
await _assert_forced_rebuild_refused(monkeypatch, exchange, "anchor_skipped_implausible")
```
It must stay green as the cross-venue regression pin.

---

## Shared Patterns

### Closed refusal vocabulary (15 tokens)
**Source:** `services/equity_reconstruction.py` (`FORCED_REBUILD_ANCHOR_REASONS` 6 + `FORCED_REBUILD_ACCOUNT_REASONS` 9, lines ~2188-2210); pinned by `test_forced_rebuild_refusal_reasons_are_a_closed_set` (`tests/test_reconstruct_force_rebuild.py:727`). **Apply to:** every file. Add no token. The probe derives `_SELECTION_TOKENS`/`_REFUSAL_TOKENS` from the same set (probe line 123-124), so a new token silently widens the probe too.

### Probe emitter as the only stdout path
**Source:** `scripts/allocator_history_probe.py:257-281` (`validate_record`, `emit_record`). **Apply to:** all new diagnostic output. Counts, booleans, closed tokens and 3-significant-figure ratios only (`sig3`, `FIELD_ABSENT` from `scripts.bybit_upnl_probe`); no id, amount or date finer than the run date (public repo).

### Venue read errors
**Source:** `_okx_bills_fetch_with_backoff` (exchange.py:1378) and `scrub_freeform_string` logging at exchange.py:3043. **Apply to:** oracle code. Transient 429/network errors propagate to the crawl's existing classification and `_stamp_429`; only structural gaps are "unavailable"; log exception class plus scrubbed text only.

### Money parsing
**Source:** `_finite_float` (exchange.py:373). **Apply to:** raw balance `details[]` and bills `bal`/`balChg`; reject bool/NaN/inf; non-dict or non-list replies mean unavailable, never zero.

### Currency sets
**Source:** `services/closed_sets.py:237-239` `STABLECOINS`. **Apply to:** oracle USD conversion and the probe's non-stable share. One definition shared with the replay.

### CI gates for analytics briefs
mypy verbatim from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. pytest only from `analytics-service/`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| bills-archive walk (`bal`/`balChg` per currency, chain check, reach proof) | service | paged request-response | The live JSON walks drop `bal`/`balChg`/`ccy` and filter `instType`. Closest idea: `verify_bal_chain` in `services/okx_archive_classify.py:353-358` (quarter-file machinery, not directly reusable) and `ARCHIVE_USD_FAMILY` at `:70`. Use RESEARCH Pattern 2 algorithm. |
| operator probe run on the Railway backfill worker | process | n/a | No committed script; TRADEPAGES plan 06 precedent only (`167.2.1.1.2.1-06-SUMMARY.md`), founder-approved start-command change. |

## Metadata

**Analog search scope:** `analytics-service/scripts/`, `analytics-service/services/`, `analytics-service/tests/`
**Files read for excerpts:** allocator_history_probe.py, test_allocator_history_probe.py, test_reconstruct_force_rebuild.py, test_ana_recon_audit.py, tests/_trade_pages.py, exchange.py, equity_reconstruction.py (targeted ranges)
**Pattern extraction date:** 2026-10-27
