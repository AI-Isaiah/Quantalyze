# Phase 186: DERIVEGAPS - Pattern Map

**Mapped:** 2026-11-03
**Files analyzed:** 17 (new/modified)
**Analogs found:** 17 / 17 (one with a partial match, the TS note component)

All analog paths below are git-tracked source (checked with `git ls-files`). Cite symbols, not line numbers: the `line` figures in the excerpts are as of 2026-11-03 at the worktree HEAD and will drift (`plan-anchor-verify` re-resolves symbols).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/exchange.py` (caps to module constants, deadline, shared flag reader) | utility (venue read) | request-response, paginated | itself (`fetch_daily_pnl`) + `routers/cron.py::_fetch_degradation` + `services/okx_archive_job.py::_check_live_realized_flags` | exact |
| `analytics-service/services/job_worker.py` `run_derive_broker_dailies_job` (drain + refusal, marker write, Bybit unified flows) | service (job handler) | request-response + CRUD | `okx_archive_job._live_reference` (drain) ; `_record_nav_mark_refusal`/`_clear_nav_mark_refusal` (marker) ; the same function's ccxt flow block (flows) | exact |
| `analytics-service/services/job_worker.py` compose block (`failing_series_ended_keys` replaced by an exit) | service (compose input builder) | transform | the no-capital exit loop in the same block (`departed_end_by_key[_k] = _nc_end`) | exact |
| `analytics-service/services/allocator_equity_derive.py` (`_BLOCKING_REASONS`, legacy token) | model (enum/set) | transform | itself; `legacy_refusals` precedent (183 D-01) | exact |
| `analytics-service/services/allocator_equity_compose.py` (payload list for failing-key exits) | service (pure compose) | transform | `no_capital_exited` list + `_NO_CAPITAL_KEY_EXITED` token | exact |
| `analytics-service/services/funding_fetch.py` (Gap 4, only if SC-1 finds pairs) | service (venue read) | request-response | itself (`fetch_funding_okx` dedup) | exact |
| `analytics-service/scripts/derivegaps_probe.py` (NEW, read-only SC-1 probe) | utility (ops script) | batch / read-only | `analytics-service/scripts/walletoffset_probe.py` + `scripts/bybit_funding_record.py` | exact |
| `analytics-service/tests/test_derive_broker_dailies_dualmode.py` (extend: read_incomplete, unified) | test | request-response | its own `_ccxt_key_derive_with_real_combine` harness | exact |
| `analytics-service/tests/test_derive_allocator_equity_job.py` (extend: sc2 exit tests) | test | transform | its own `_sc2_book` / `_gate_key` / `_run_gate` / `_composed_payload` | exact |
| `analytics-service/tests/test_exchange_harness.py` (cap/deadline tests) | test | request-response | its own `test_okx_*_page_cap_stamps_the_flag` | exact |
| `analytics-service/tests/test_trade_pages.py` (replace the D-02 pin) | test | text pin | itself (`test_no_service_module_calls_the_unified_flows_reader`) | exact |
| `analytics-service/tests/test_funding_fetch.py` (SC-7, gated) | test | request-response | existing funding dedup tests in that file | role-match |
| `analytics-service/tests/test_walletoffset_probe.py`-style `tests/test_derivegaps_probe.py` (NEW) | test | batch | `tests/test_walletoffset_probe.py` | exact |
| `analytics-service/tests/fixtures/derive_refusal_rows.json` + `writer_residual_resolution.json` and their 2 Python and 2 TS parity tests | config/fixture | cross-runtime table | the fixture's own `legacy_refusals` list | exact |
| `src/lib/queries.ts` (`readFailingKeyExits`, legacy mapping kept) | service (SSR reader) | transform | `readUnpricedNativeAccounts` + `untrustworthyRebuildReason` | exact |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (one muted note) | component | request-response (render) | `UnpricedAccountNote` | role-match (new copy, DESIGN.md check) |
| `scripts/accounttruth-census.mjs` (CASE arm kept as legacy) | utility (SQL census) | batch | itself (`untrustworthy_reason` CASE) | exact |

## Pattern Assignments

### `analytics-service/services/exchange.py` (utility, paginated request-response)

**Analog:** itself. Three changes: (a) promote function-local caps to module constants, (b) add a monotonic deadline inside the walks, (c) add ONE shared flag-to-verdict reader next to `get_and_clear_last_dq_flags`.

**Current caps are function-local (a test cannot monkeypatch them)** (`fetch_daily_pnl`):
```python
OKX_BILLS_PAGE_CAP = 100
for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
    ...
    for page in range(OKX_BILLS_PAGE_CAP):
        params: dict[str, str] = {"instType": inst_type, "limit": "100"}
        ...
            if len(data) < 100:
                break
            # NEW-C13-05: detect page-cap exhaustion
            if page == OKX_BILLS_PAGE_CAP - 1:
                _okx_bills_cap_hit = True
...
if _okx_bills_cap_hit:
    logger.warning("OKX %s: bills page cap (%d) hit - ...", inst_type, OKX_BILLS_PAGE_CAP)
    _record_dq_flag("daily_pnl_truncated_okx", True)
```
Same shape for `OKX_ARCHIVE_PAGE_CAP = 100` (archive loop) and, for Bybit:
```python
BYBIT_PNL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000  # 7-day max per request
BYBIT_PNL_PAGE_CAP = 50  # safety net per window
...
bybit_params = {"category": "linear", "limit": 200, "startTime": str(window_start), "endTime": str(window_end)}
...
    if _page == BYBIT_PNL_PAGE_CAP - 1:
        _bybit_cap_hit = True
...
if _bybit_cap_hit:
    _record_dq_flag("daily_pnl_truncated_bybit", True)
```
The deadline must end the walk and set the SAME flag (`daily_pnl_truncated_okx` / `daily_pnl_truncated_bybit`), never raise `TimeoutError` (that loops as a transient with no resume).

**Flag channel (do not change semantics)**: `_LAST_DQ_FLAGS` is a `ContextVar`; reset at `fetch_daily_pnl` entry (`_LAST_DQ_FLAGS.set({})`); `get_and_clear_last_dq_flags()` returns a shallow copy and clears. Error flags set in the outer handler: `daily_pnl_fetch_error` (True) + `daily_pnl_fetch_error_class` (`type(exc).__name__`).

**Shared flag reader: copy the cron reading, add the rate-limit class set from the okx archive job.** Cron (`routers/cron.py::_fetch_degradation`):
```python
_FETCH_ERROR_FLAG = "daily_pnl_fetch_error"
_FETCH_INCOME_FALLBACK_FLAG = "daily_pnl_binance_income_fallback"
_FETCH_TRUNCATED_PREFIX = "daily_pnl_truncated_"
_FETCH_ERROR_CLASS_FLAG = "daily_pnl_fetch_error_class"
_ERROR_CLASS_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")

def _fetch_degradation(flags: dict[str, Any]) -> tuple[list[str], str | None]:
    reasons: list[str] = []
    if flags.get(_FETCH_ERROR_FLAG):
        reasons.append(_FETCH_ERROR_FLAG)
    if flags.get(_FETCH_INCOME_FALLBACK_FLAG):
        reasons.append(_FETCH_INCOME_FALLBACK_FLAG)
    reasons.extend(
        key for key, value in flags.items()
        if key.startswith(_FETCH_TRUNCATED_PREFIX) and value
    )
    error_class = flags.get(_FETCH_ERROR_CLASS_FLAG)
    if not (isinstance(error_class, str) and _ERROR_CLASS_NAME_RE.match(error_class)):
        error_class = None
    return sorted(reasons), error_class
```
Okx archive job (`services/okx_archive_job.py::_check_live_realized_flags`, rate-limit handling):
```python
_RATE_LIMIT_CLASSES: Final[frozenset[str]] = frozenset({"RateLimitExceeded", "DDoSProtection"})
...
if flags.get("daily_pnl_fetch_error"):
    name = flags.get("daily_pnl_fetch_error_class")
    if name in _RATE_LIMIT_CLASSES:
        raise ccxt.RateLimitExceeded("live realized crawl was rate limited")
    label = name if isinstance(name, str) and _CLASS_NAME_RE.fullmatch(name) else _MALFORMED
    raise _Stop("live_fetch_failed", f"class={label}")
if flags.get("daily_pnl_truncated_okx"):
    raise _Stop("live_anchor_unusable", "live_realized=truncated")
```
Do NOT refactor cron or the okx job in this phase; add a parity test over all three readers (RESEARCH anti-pattern: no fourth hand copy).

**Test analog for caps/deadline:** `tests/test_exchange_harness.py` `test_okx_recent_bills_page_cap_stamps_the_flag`:
```python
get_and_clear_last_dq_flags()
exchange = _make_okx_exchange()
pages, counter = self._full_pages("r", "SWAP", _ts(2024, 3, 15, 10))
exchange.private_get_account_bills = AsyncMock(side_effect=pages)
since_ms = int((datetime.now(timezone.utc) - timedelta(days=10)).timestamp() * 1000)
await fetch_daily_pnl(exchange, since_ms)
assert counter["n"] == 100, "the stub must really run the loop to its cap"
assert get_and_clear_last_dq_flags().get("daily_pnl_truncated_okx") is True
```
New tests monkeypatch the new module constants and a fake monotonic clock.

---

### `analytics-service/services/job_worker.py` `run_derive_broker_dailies_job` (service, request-response + CRUD)

**Analog 1 (drain right after the realized read):** `okx_archive_job._live_reference` (above). The call site comment is the rule:
```python
realized = await _within(budget, fetch_all_trades(exchange, since_ms=None), step="live_realized", cap=_BROKER_CRAWL_TIMEOUT_S)
# F2 / WR-03: the fetch swallows every error and returns what it has; the only trace is
# the per-task DQ buffer. Read it NOW, before any other crawl can reset it.
_check_live_realized_flags(get_and_clear_last_dq_flags())
```
**Insert point in the derive** (the ccxt `else:` branch of `run_derive_broker_dailies_job`, inside the `try:` that already has the `except asyncio.TimeoutError` arm and the outer `except ccxt.RateLimitExceeded as exc: await _stamp_429(ctx.supabase, ctx.key_row, exc); raise`):
```python
realized = await asyncio.wait_for(
    fetch_all_trades(ctx.exchange, since_ms=None),
    timeout=_BROKER_CRAWL_TIMEOUT_S,
)
# <-- drain here, BEFORE the venue branch below calls any funding fetch
if venue == "binance":
    funding = await asyncio.wait_for(fetch_funding_binance(ctx.exchange, funding_label, None), timeout=_BROKER_CRAWL_TIMEOUT_S)
elif venue == "okx": ...
elif venue == "bybit": ...
else:
    return DispatchResult(outcome=DispatchOutcome.FAILED, error_message=f"derive_broker_dailies: venue {venue} not supported", error_kind="permanent")
```
Refusal return shape to copy (existing, same function):
```python
return DispatchResult(
    outcome=DispatchOutcome.FAILED,
    error_message="derive_broker_dailies: ...",
    error_kind="transient",   # ErrorKind = Literal["transient", "permanent", "unknown"]
)
```
A rate-limit class must `raise ccxt.RateLimitExceeded(...)` so the existing outer arm stamps 429. Refusal writes NOTHING to `csv_daily_returns`/`key_inputs` (D-05, SC-6). Error message: class name only, never venue text (signed URL risk; use `scrub_freeform_string` for anything freeform).

**Analog 2 (owner-only per-key marker row, no migration):** `_record_nav_mark_refusal` / `_clear_nav_mark_refusal` (new `read_incomplete:<api_key_id>` family modelled on `NAV_MARK_REFUSAL_KIND_PREFIX`). Copy verbatim, changing the prefix constant and token set:
```python
async def _record_nav_mark_refusal(supabase, *, allocator_id, api_key_id, token, day) -> None:
    if token not in MARK_REFUSAL_TOKENS:
        logger.warning("... not recorded (token outside the set)")
        return
    kind = NAV_MARK_REFUSAL_KIND_PREFIX + api_key_id

    def _persist() -> None:
        existing = (supabase.table("allocator_equity_derived").select("payload")
                    .eq("allocator_id", allocator_id).eq("kind", kind).limit(1).execute().data)
        first_seen = day
        if isinstance(existing, list) and existing:
            payload = existing[0].get("payload")
            carried = payload.get("first_seen_day") if isinstance(payload, dict) else None
            if isinstance(carried, str) and carried:
                first_seen = carried
        supabase.table("allocator_equity_derived").upsert(
            {"allocator_id": allocator_id, "kind": kind,
             "payload": {"token": token, "first_seen_day": first_seen, "last_seen_day": day},
             "computed_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="allocator_id,kind",
        ).execute()

    try:
        await db_execute(_persist)
    except Exception as exc:  # noqa: BLE001 - additive; the derive's outcome must not change
        logger.warning("... not recorded (api_key_id=%s, error=%s)", api_key_id, type(exc).__name__)
```
`_clear_*` is `delete().eq("allocator_id", ...).eq("kind", PREFIX + api_key_id)` under the same `try/except` + class-name-only WARNING. `allocator_id` comes from `ctx.key_row["user_id"]` (never the job payload). The marker never goes into `strategy_analytics.data_quality_flags` (publicly readable for a published strategy). The compose loads only `.like("kind", "key_inputs:%")`, so the new family does not collide with the orphan cleanup.

**Analog 3 (Bybit unified flows wiring):** the existing ccxt flow block, same function:
```python
try:
    _deposits = await asyncio.wait_for(fetch_ccxt_transfers(ctx.exchange, "deposits", _flow_since_ms, now_ms), timeout=_BROKER_CRAWL_TIMEOUT_S)
    _withdrawals = await asyncio.wait_for(fetch_ccxt_transfers(ctx.exchange, "withdrawals", _flow_since_ms, now_ms), timeout=_BROKER_CRAWL_TIMEOUT_S)
    _flow_rows = list(_deposits) + list(_withdrawals)
    _price_index = await asyncio.wait_for(_resolve_ccxt_flow_price_index(ctx.exchange, venue, ctx.supabase, _flow_rows), timeout=_BROKER_CRAWL_TIMEOUT_S)
except asyncio.TimeoutError:
    ...  # classified transient, static text, never logger.exception
external_flows = ccxt_rows_to_dated_flows(_flow_rows, venue=venue, price_index=_price_index, instants=_event_flow_instants)
```
For `venue == "bybit"` add `fetch_bybit_unified_flows(ctx.exchange, _flow_since_ms, now_ms)` -> `(deposits, withdrawals)` under the same `asyncio.wait_for(..., timeout=_BROKER_CRAWL_TIMEOUT_S)` and concatenate into `_flow_rows` per the SC-1 REPLACE/UNION/pair-aware verdict. Reader contract (`services/bybit_unified_flows.py`): rows carry exactly `id, type ('deposit'|'withdrawal'), currency (upper), amount (abs, finite), timestamp (int ms), fee (None)`; raises `BybitUnifiedFlowReadError` (already `PERMANENT` in `classify_exception`) rather than return short; propagates venue exceptions unchanged. Import it the same way the worker already imports its error class (one import line). Non-UTA keys: probe `uta` first; fall back to on-chain only or name the key.

**Composite twin:** `run_stitch_composite_job._derive_ccxt_member` repeats the same three reads with no drain and no `wait_for`; decide in planning (RESEARCH Open Question 4): one shared helper for both, or book the composite explicitly.

---

### `analytics-service/services/job_worker.py` compose block (service, transform): failing key leaves the book (D-07)

**Analog:** the no-capital exit loop in the same function (`derive_allocator_equity`), which already feeds `departed_end_by_key`:
```python
anchors_by_key[_k] = _nc_level
null_anchor_reasons.pop(_k, None)
realized_terminal_by_key[_k] = (_nc_end, _nc_level)
departed_end_by_key[_k] = _nc_end
no_capital_exit_by_key[_k] = (_nc_token, _nc_end)
flows_by_key[_k] = [_f for _f in flows_by_key[_k] if _f.utc_day_iso <= _nc_end]
```
**The block to change** (today only counts and later raises the blocking token):
```python
failing_series_ended_keys = 0
_book_last_days = [last_return_day[k] for k in counted_ids if k in last_return_day]
if _book_last_days:
    _book_last_day = max(_book_last_days)
    for _group in account_groups(key_rows):
        _eligible_members = [row for row in _group if row["id"] in eligible_ids]
        if len(_eligible_members) != 1:
            continue
        _member = _eligible_members[0]
        _member_id = _member["id"]
        if _member_id not in counted_ids or _member_id in departed_end_by_key:
            continue
        if working_holder_predicate(_member):
            continue
        _member_last = last_return_day.get(_member_id)
        if _member_last is not None and _member_last < _book_last_day:
            failing_series_ended_keys += 1
```
Change: replace `failing_series_ended_keys += 1` with `departed_end_by_key[_member_id] = _member_last` plus a `(api_key_id, day)` record for naming; extend the `working_holder_predicate(_member)` skip with "and no `read_incomplete` marker for `_member_id`" (a refused-but-working key must exit too, or it is carried flat as benign `stale_mark_carry`). Keep the guard `len(_eligible_members) != 1` (shared groups stay `SHARED_ACCOUNT_NO_WORKING_KEY`'s concern, Open Question 3). Remove `(DegradeReason.FAILING_KEY_SERIES_ENDED, failing_series_ended_keys > 0)` from the `degrade_reasons=[...]` tuple list fed to `compose_allocator_equity`. Counts-only logging (no key id / venue / USD, T-167.1.2-22).

**`COMPOSE_INCOMPLETE` gate to adjust** (`missing_ids` block):
```python
missing_ids = counted_ids - (set(returns_by_key) | key_inputs_ids)
if missing_ids:
    await _persist_refusal(DeriveRefusal.COMPOSE_INCOMPLETE.value)
    ...
    return DispatchResult(outcome=DispatchOutcome.DONE)
```
Exempt only failing OR marked keys with no returns AND no key_inputs; a WORKING key with neither stays missing (self-healing backfill). A failing key WITH key_inputs but no returns keeps today's blocking `dropped_key` (pinned by `test_sc2_failing_key_with_inputs_but_no_returns_raises_no_keyerror`).

---

### `analytics-service/services/allocator_equity_compose.py` (service, pure transform): name the exited keys

**Analog:** the `no_capital_exited` list and benign flag token.
```python
no_capital_exited: list[dict[str, Any]] = [
    {"api_key_id": k, "reason": reason, "day": day}
    for k, (reason, day) in sorted(no_capital_exit.items())
    if k in departed_present
]
if no_capital_exited:
    flag_tokens.add(_NO_CAPITAL_KEY_EXITED)
...
if no_capital_exited:
    # Additive, present only when a no-capital key exited (an older reader never sees it).
    payload["no_capital_exited_keys"] = no_capital_exited
```
Copy as an additive `failing_key_exited_keys` (name is a planner choice) `[{api_key_id, day}]`, sorted by key id, present only when non-empty, with a benign flag token (never a `DegradeReason`), no amounts. Pass it in as a new optional kwarg alongside `benign_flag_tokens=` / `departed_end_by_key=` in the `_compose(...)` call (job_worker, `compose_allocator_equity(returns_by_key, inputs.flows, inputs.anchors, inputs.null_reasons, benign_flag_tokens=[...], degrade_reasons=[...], departed_end_by_key=inputs.departed_end or None, ...)`).

---

### `analytics-service/services/allocator_equity_derive.py` (model, enum/set)

**Analog:** itself.
```python
FAILING_KEY_SERIES_ENDED = "failing_key_series_ended"   # DegradeReason member
_BLOCKING_REASONS: frozenset[DegradeReason] = frozenset({
    DegradeReason.UNCLASSIFIED_ROTATION, ..., DegradeReason.KEY_INPUTS_MISMATCH,
    DegradeReason.FAILING_KEY_SERIES_ENDED,   # <- remove from this set only
    DegradeReason.SHARED_ACCOUNT_FLOWS_DISAGREE, DegradeReason.ACCOUNT_IDENTITY_PENDING,
})
```
Keep the enum member (stored PROD rows carry the token until the next daily derive replaces them); only remove it from `_BLOCKING_REASONS` and update the comment that says "The reader maps it onto that same existing line". `NOT_WORKING_SYNC_STATUSES = frozenset({"revoked", "sign_in_failed", "error"})` and `working_holder_predicate` are reused unchanged.

---

### Cross-runtime token retirement (fixtures + 4 Python/TS tests + census), ONE commit

**Analog:** the `legacy_refusals` precedent in `analytics-service/tests/fixtures/derive_refusal_rows.json` (Phase 183 D-01):
```json
"legacy_refusals": [ {"token": "account_duplicate", "reader_reason": "duplicate_account"} ]
```
asserted by `tests/test_derive_refusal_rows.py` (`TABLE["legacy_refusals"]` must be non-empty; each is not a live `DeriveRefusal` member). Actions: move the `blocking` row for `failing_key_series_ended` to a legacy list; `tests/test_derive_refusal_rows.py::test_the_fixture_has_one_blocking_row_per_blocking_degrade_reason` (`set(tokens) == {r.value for r in _BLOCKING_REASONS}`) then stays green; change the `writer_residual_resolution.json` cell `sc2-failing-key-ends-two-days-early` to `blocking_tokens: []`, trustworthy true, reader `ready`, add a cell for the exit; update `tests/test_writer_residual_parity.py::test_the_cells_are_unique_and_cover_every_derive_side_token` (`assert "failing_key_series_ended" in raised`). Keep the legacy mapping in:
- `src/lib/queries.ts::untrustworthyRebuildReason`:
```ts
if (
  tokens.includes("shared_account_no_working_key") ||
  tokens.includes("failing_key_series_ended")
) {
  return "shared_account_no_working_key";
}
```
- `scripts/accounttruth-census.mjs` `untrustworthy_reason` CASE arm: `OR cv.p -> 'degrade_reasons' @> '["failing_key_series_ended"]'::jsonb THEN 'shared_account_no_working_key'`
- TS twins: `src/lib/queries.test.ts` (the `untrusted([...])` cases), `src/lib/__tests__/writer-residual-parity.test.ts`, `src/lib/__tests__/derive-refusal-rows.test.ts`, `src/__tests__/accounttruth-census.test.ts`.

---

### `src/lib/queries.ts` `readFailingKeyExits` (service, transform) and `AllocationDashboardV2.tsx` note (component)

**Analog:** `readUnpricedNativeAccounts(flags, derivedPayload, apiKeys)` and its call site; `UnpricedAccountNote`.

Reader (defensive read of worker-written JSONB against the OWNER's own key list; drop unknown ids; counts-only console + Sentry log; label = trimmed label else exchange; sorted by label then id):
```ts
function readUnpricedNativeAccounts(flags: unknown, derivedPayload: unknown,
  apiKeys: ReadonlyArray<{ id: string; exchange: string; label?: string | null }>): UnpricedNativeAccount[] {
  if (!Array.isArray(flags) || !flags.includes(NATIVE_UNPRICED_KEY_OMITTED_FLAG)) return [];
  const raw = derivedPayload !== null && typeof derivedPayload === "object"
      ? (derivedPayload as Record<string, unknown>).unpriced_native_keys : undefined;
  const entries: unknown[] = Array.isArray(raw) ? raw : [];
  const byId = new Map(apiKeys.map((k) => [k.id, k]));
  ...
  if (!Array.isArray(raw) || kept < entries.length) {
    const message = `[queries.readUnpricedNativeAccounts] ... received ${entries.length}, kept ${kept}` ...;
    console.error(message);
    captureToSentry(new Error(message), { tags: { op: "readUnpricedNativeAccounts" }, level: "warning" });
  }
  ...
}
```
Call site (only for the curve on screen):
```ts
const unpricedNativeAccounts = readUnpricedNativeAccounts(
  equityHistoryState === "ready" ? payloadFlags : undefined, derivedPayload, apiKeys);
```
Note component: `<UnpricedAccountNote accounts={unpricedNativeAccounts} />` in `AllocationDashboardV2.tsx`; the `<p role="status" data-testid="dashboard-unpriced-account-note" className="mb-3 px-1 text-sm text-text-secondary">` shape, "Muted, not a warning: the total shown is right for the accounts it covers". `no_capital_exited_keys` is read by NO TS code today, so the failing-key exit is the first reader of an exit list. No existing owner line fits ("this key is failing, so the total stops counting it after <day>"): new copy, so a DESIGN.md check first (active voice, name the label and day, say "no longer counted", never "lost"). Test analog: `src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-account.test.tsx` and the `readUnpricedNativeAccounts` cases in `src/lib/queries.test.ts`. Remember `npm ci` in the worktree before TS tasks.

---

### `analytics-service/services/funding_fetch.py` (Gap 4, ONLY if SC-1 finds same-hour pairs)

**Analog:** itself. The in-memory dedup collapsing legs (`fetch_funding_okx`):
```python
# Dedup by match_key (archive + recent may overlap)
seen: set[str] = set()
deduped: list[FundingFeeRow] = []
for row in rows:
    if row["match_key"] in seen:
        continue
    seen.add(row["match_key"])
    deduped.append(row)
```
`_build_match_key` = `f"{strategy_id}:{exchange}:{symbol}:{_bucket_for_exchange(ts, hours=hours)}"` with `_FUNDING_BUCKET_HOURS = {"binance": 1, "okx": 1, "bybit": 1}`. Recommended (RESEARCH): dedup on `billId` (from the row's `raw_data`) falling back to `match_key` when absent; do NOT change `_build_match_key` (that needs a re-key migration, SQL parity pin `tests/test_funding_match_key_sql_parity.py`, a `supabase/migrations/down/` file, modelled on `20260704150835_funding_match_key_1h_rekey.sql`, safe on EMPTY TEST tables). Bybit derive already keeps both legs (no dedup in `fetch_funding_bybit`/`walk_paginated`). RED test: two OKX type-8 bills, same `instId`, same UTC hour, distinct `billId` => 2 rows; same `billId` in recent and archive => 1.

---

### `analytics-service/scripts/derivegaps_probe.py` (NEW, utility, read-only batch)

**Analog:** `analytics-service/scripts/walletoffset_probe.py` (+ `scripts/bybit_funding_record.py` for Bybit evidence: `read_key_info` -> `bybit_is_uta`/`bybit_is_master`, `measure_funding`). Copy: no arguments; labels `k1..kN`; `emit_record` + `assert_sanitized` as the ONLY stdout path ("refuses any key outside the declared records and any value outside the declared vocabulary"); `deploy_fingerprint()` line; select-only DB handle; counted GET-only exchange view with a per-key call ceiling; per-key `asyncio.wait_for`; exit 0/1; run-level failure prints the exception TYPE only; "not measured" is `field-absent`, never 0; logging switched off. Redaction contract: labels, counts, booleans, closed tokens, 3-sig-fig ratios; no id, amount, venue text or key (public repo). Its test: `analytics-service/tests/test_walletoffset_probe.py` conventions (mirror as `tests/test_derivegaps_probe.py`, including a text pin on raw method names being GET-only as `bybit_funding_record` has). Run delivery is an orchestrator checkpoint needing explicit founder approval each run (184 correction); never a dispatched executor.

SC-1 SQL (`g1.sql`/`g2.sql`/`g3.sql`) text lives in 186-RESEARCH.md; it is run from the MAIN checkout after the marker query alone; the file must not start with `--`. Reuse `node scripts/accounttruth-census.mjs --print-sql=c|d|e` for the census labels.

---

### Test patterns

**Derive-job RED tests (`tests/test_derive_broker_dailies_dualmode.py`):** extend `_ccxt_key_derive_with_real_combine(*, venue, realized, deposits, equity)`: it patches `services.job_worker._allocator_key_preflight`, `services.job_worker.fetch_all_trades` (`AsyncMock(return_value=list(realized))`), `services.job_worker.aclose_exchange`, `services.exchange.fetch_account_equity_and_upnl_usd`, the three `services.funding_fetch.fetch_funding_*`, `services.ccxt_flow_fetch.fetch_ccxt_transfers` (side effect by kind), `services.job_worker._resolve_ccxt_flow_price_index`, `services.broker_dailies.combine_realized_and_funding` (a spy over the REAL combine), `services.job_worker.db_execute` (`lambda fn: fn()`). For read_incomplete tests replace `fetch_all_trades` with a side effect that calls `exchange._record_dq_flag("daily_pnl_truncated_okx", True)` then returns rows (proves the drain sees the flag, RESEARCH Pitfall 1). For unified: also patch `fetch_bybit_unified_flows` at the import site the worker uses and assert `seen["external_flows"]` contains the internal TRANSFER_IN with an independent hand-computed TWR oracle. Zero-write assertion pattern (SC-6), copied from `test_nav_error_permanent_key_mode_no_stamp`:
```python
others = [u for u in capture["upserts"]
          if not (u[0] == "allocator_equity_derived"
                  and str(u[1].get("kind", "")).startswith("nav_mark_refusal:"))]
assert others == []   # swap the prefix to "read_incomplete:" for the new family
assert capture["rpc_calls"] == []
```

**Compose RED tests (`tests/test_derive_allocator_equity_job.py`):** extend the sc2 block. Helpers: `_sc2_book(*, a_status, a_days, b_days=None, a_returns=True, alloc=...)` (two single-key accounts A failing/working, B working; anchors 40,000 / 60,000; distinct `venue_account_id`), `_gate_key(key_id, alloc, **extra)`, `_run_gate(fake, alloc)` (patches `services.job_worker.get_supabase`), `_composed_payload(fake)`. Existing test to rewrite: `test_sc2_failing_single_key_ending_early_blocks` (asserts `"failing_key_series_ended" in payload["degrade_reasons"]` and `is_trustworthy is False`; becomes: token absent, trustworthy True, A exits, book return on days after the exit equals B's, payload names A). Regression guards to keep: `..._reaches_the_books_last_day_dilutes_nothing`, `..._working_key_ending_early_raises_only_the_benign_carry`, `..._leaves_the_book_on_purpose_raises_nothing` (uses `_no_capital_book()` / `_compose_no_capital_book(seed)`), `..._recovering_clears_the_token`, `..._with_inputs_but_no_returns_raises_no_keyerror`. Independent oracle (RESEARCH): A flat r=0 through day 3 of 5 and B +1%/day; after exit the book return on days 4-5 must be B's +1.00% (today 0.6% with A diluted).

**Pin replacement (`tests/test_trade_pages.py`):** `test_no_service_module_calls_the_unified_flows_reader` goes RED when the reader is wired (`naming == ["bybit_unified_flows.py"]`; `job_worker.py` mentions limited to importing `BybitUnifiedFlowReadError`). Rewrite as: `job_worker.py` imports the reader exactly once; `broker_dailies.py` and `okx_archive_job.py` still do not name `fetch_bybit_unified_flows` / `bybit_unified_flows` (D-02 still holds for them).

**Honest RED rule:** neuter the new path from a byte backup (never `git checkout/restore/stash` on uncommitted work), see RED, restore.

## Shared Patterns

### Class name only, never venue text
**Source:** `routers/cron.py::_ERROR_CLASS_NAME_RE` (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`), `okx_archive_job._CLASS_NAME_RE`.
**Apply to:** shared flag reader, marker payload, `error_message`, every WARNING in the derive/compose. A ccxt message can carry a signed URL; use `scrub_freeform_string` for anything freeform. No key id / venue id / USD in compose logs (T-167.1.2-22).

### Never fail the derive for an additive note
**Source:** `_record_nav_mark_refusal` / `_clear_nav_mark_refusal` (`try: await db_execute(_fn) except Exception as exc: logger.warning(..., type(exc).__name__)`).
**Apply to:** the `read_incomplete:` marker write and clear.

### Wait-for bound with one shared TimeoutError arm
**Source:** the ccxt equity/trades/funding `try` in `run_derive_broker_dailies_job`: `asyncio.wait_for(..., timeout=_BROKER_CRAWL_TIMEOUT_S)` per crawl, `except asyncio.TimeoutError` -> `DispatchResult(FAILED, error_kind="transient")` with static text, never `logger.exception`; `finally: await aclose_exchange(ctx.exchange)`. The 900 s outer budget (`_DERIVE_OUTER_BUDGET_S`) is shared by all crawls plus a 90 s reserve: size caps from measured seconds-per-page, not from 810 s.
**Apply to:** the Bybit unified-flows call and any new read.

### Never invent data (SC-6)
A refused key writes no rows; an unreachable day is absent, never 0.0. `combine_realized_and_funding(realized_reach_start=...)` is not a substitute for refusing.

### Owner-only per-key state, RLS, no migration
`allocator_equity_derived` (`PRIMARY KEY (allocator_id, kind)`, owner SELECT, `kind` has no CHECK). `allocator_id` always from `ctx.key_row["user_id"]` / `api_keys.user_id`.

### CI gates every analytics-touching task must run
From `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; pytest only from `analytics-service/`; never `importlib.reload`. Main checkout's `analytics-service/.venv/bin/python -m pytest` works with cwd = the worktree's `analytics-service/`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Monotonic deadline inside the OKX/Bybit page walks | utility | paginated | No existing deadline-aware walk in `fetch_daily_pnl`; `walk_paginated` + `ProviderPaginationContract` (`services/exchange_pagination.py`, `page_cap`, `on_ceiling`) is the nearest tested walker (used by `bybit_unified_flows` and `fetch_funding_bybit`) but has no clock. Use RESEARCH Pitfall 2/8 rule: stop early and report the same truncated flag. |
| Reader line for "this key is failing, stops counting after <day>" | component copy | render | `key_not_syncing`, `shared_account_no_working_key`, `UnpricedAccountNote`, `DepartedHistoryNote` do not fit; `no_capital_exited_keys` has no TS reader. Component shape copies `UnpricedAccountNote`; copy text needs a DESIGN.md check. |

## Metadata

**Analog search scope:** `analytics-service/services/`, `routers/`, `scripts/`, `tests/`, `tests/fixtures/`, `src/lib/queries.ts`, `src/app/(dashboard)/allocations/`, `scripts/accounttruth-census.mjs`.
**Files scanned:** about 25 (targeted greps and non-overlapping reads; `job_worker.py` is about 16k lines, read by symbol).
**Pattern extraction date:** 2026-11-03
