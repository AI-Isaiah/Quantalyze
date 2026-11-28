# Phase 256: OKXUNITSWITCH - Pattern Map

**Mapped:** 2026-11-27
**Files analyzed:** 14 (new or modified, grouped)
**Analogs found:** 12 / 14 (2 are partial; see "No Analog Found")

Paths are relative to the repo root and were checked tracked with `git ls-files` where verified (account_unit.py, derivegaps_probe.py). None is a gitignored mirror. Line anchors are by symbol where the file moves often (plan-anchor-verify re-resolves `file:line`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `analytics-service/services/unit_switch.py` (new) | utility (pure leaf) | transform | `analytics-service/services/account_unit.py` | exact (role + purity contract) |
| `analytics-service/tests/test_unit_switch.py` (new) | test | transform | `analytics-service/tests/test_account_unit.py` | exact |
| `analytics-service/services/exchange.py` OKX branch of `fetch_daily_pnl` (modify) | service | request-response (batch bills walk) | itself, lines ~2040-2082 (VREAD-06 census) | exact |
| `analytics-service/tests/test_okx_unit_switch_fetch.py` (new, plus extend `test_okxtrades_ccy.py`) | test | request-response | `analytics-service/tests/test_okxtrades_ccy.py` | exact |
| `analytics-service/services/job_worker.py` derive (key + strategy mode), `_marks_in_series_unit` (modify) | service | batch / transform | MT5 native derive branch in same file (~9217-9548) | role-match |
| `analytics-service/tests/test_okx_unit_switch_derive.py` (new) | test | batch | `test_derive_broker_dailies_dualmode.py`, `test_mt5_derive_branch.py` | role-match |
| `analytics-service/services/native_to_usd.py` (use, no change) | utility | transform | itself, `convert_native_returns_to_usd` | exact |
| `analytics-service/services/analytics_runner.py` (carry `unit_switch` present-only, ~2141-2149, 2325-2330) | service | transform | same lines, `native_unit` carry | exact |
| `analytics-service/services/allocator_equity_compose.py` / key_inputs payload (additive `unit_segments`) | service | transform | `read_native_key_inputs`, `segment_terminals` precedent | role-match |
| `analytics-service/scripts/okxunitswitch_probe.py` (new, founder-gated) | utility (read-only probe) | request-response | `analytics-service/scripts/derivegaps_probe.py` | exact |
| `supabase/migrations/2026112x…_strategy_analytics_unit_segments.sql` (new) + `supabase/tests/…sql` + `src/lib/database.types.ts` | migration | CRUD (additive column) | `supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql`; test: `supabase/tests/test_api_key_nav_marks.sql` | exact (migration), role-match (SQL test) |
| `src/lib/factsheet/unit-segments.ts` + `.test.ts` (new) | utility (isomorphic composer + parser) | transform | `src/lib/factsheet/returns-unit.ts` + `returns-unit.test.ts` | exact |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`, `chart-configs.ts`, `FactsheetView.tsx` (`UnitSwitchDisclosure`), `MetricsColumn.tsx`, OG route, `StrategyTable.tsx` chip, `src/lib/queries.ts` | component / route | request-response (SSR) | `missingSegments` seam in `TimeSeriesChart.tsx`; `UsdDisclosure` in `FactsheetView.tsx`; `withUnit` users | role-match |
| `src/lib/factsheet/fetch-and-build-payload.ts`, `types.ts` (payload `unitSegments`) | service | request-response | same files, `returnsUnit` plumbing (~491, 911-932; types 1021-1027) | exact |

## Pattern Assignments

### `analytics-service/services/unit_switch.py` (pure leaf, transform)

**Analog:** `analytics-service/services/account_unit.py`

**Module contract to copy** (docstring, lines 1-18): "Purity: stdlib + typing ONLY ... This module is a LEAF: it must never import `job_worker`, `mt5_read` or any I/O module ... No logging and no broker text in any exception message." Closed fixed-sentence messages; venue `ccy` is third-party text.

**Imports and code shape** (lines 19-26):
```python
import re
from dataclasses import dataclass

from services.external_flows import USD_FAMILY

_CURRENCY_CODE_RE = re.compile(r"[A-Za-z]{2,10}")

@dataclass(frozen=True, slots=True)
class UnitFloors:
```
Mirror with `@dataclass(frozen=True, slots=True) class UnitSwitch` (coin, switch_day, first_coin_return_day) and `derive_unit_switch(coin_bill_days, end_of_day_holdings, live_share) -> UnitSwitch | str` returning a closed refusal token. Stable test: use `price_rule.is_stable_value` (RESEARCH "Don't Hand-Roll"), never a literal list. Put `COIN_LEAD_TOLERANCE_DAYS = 14` as one module constant. Refusal tokens as a closed tuple in the style of `READ_INCOMPLETE_TOKENS` (`job_worker.py` ~5047-5065): `no_coin_evidence`, `coin_bills_without_majority`, `two_coins`, `switch_back`, `ambiguous_boundary`, `holdings_unavailable`, `bills_precede_majority_beyond_tolerance`, `stable_bill_before_unclear_state`. Normalise clocks first (holdings end-of-day = asof - 1; mark end-of-day = mark_day). Boundary: S = last USD return day, coin base at end of S, first coin return day S+1.

**Segment helpers** go beside `classify_account_currency` in `account_unit.py`; leave that function unchanged.

---

### `analytics-service/tests/test_unit_switch.py` (test, transform)

**Analog:** `analytics-service/tests/test_account_unit.py`

**Header and oracle discipline** (lines 1-30): module docstring "ORACLE DISCIPLINE: every expected number below is a literal written from the decisions, never read back from the module under test", pure-import note, run command line, `from __future__ import annotations`, `pytest`, parametrize on raw inputs:
```python
@pytest.mark.parametrize("raw", ["", "   ", None, 5, ...])
def test_blank_or_non_string_is_blank(raw: object) -> None:
    with pytest.raises(AccountCurrencyBlank):
        classify_account_currency(raw)
```
Fixtures (a)-(g) from RESEARCH "Switch rule": real shape (S = 11-14, first coin return 11-15), differently shaped account, dust coin, switch back, holdings gap, bills-only new key, USDT SELL fee. Each arm carries PROOF-01 (neuter, RED, `cp` back, `cmp`, GREEN).

---

### `analytics-service/services/exchange.py`, OKX branch of `fetch_daily_pnl` (service, request-response)

**Analog:** the same block, `_okx_non_usd_census` through `return []` (lines ~2019-2082). The seam to change:
```python
_ccy = str(bill.get("ccy") or "")
if pnl_val != 0.0 and not is_stable_value(_ccy):
    _okx_non_usd_census[
        _ccy if _OKX_CCY_CODE_RE.match(_ccy)
        else ("blank" if not _ccy else "malformed")
    ] += 1
    continue
ts_raw = bill.get("ts", "")
if ts_raw and ts_raw.isdigit():
    dt = datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc)
    day_key = dt.strftime("%Y-%m-%d")
    daily_totals[day_key] += pnl_val
...
if _okx_non_usd_census:
    _record_dq_flag("daily_pnl_non_usd_okx", True)
    logger.warning("OKX daily P&L refused: ... (census=%s, bills=%d)", dict(_okx_non_usd_census), sum(...))
    return []
```
**Pattern to apply:** keyword-only `unit_switch: UnitSwitch | None = None` on `fetch_daily_pnl` and `fetch_all_trades` (def at ~1868 / ~3658). Default None is byte-identical (refuse). With a switch, a bill whose ccy equals `switch.coin` and whose UTC `day_key` is after the coin base day accumulates into a separate per-day coin total returned on a side channel (a second ContextVar beside `_LAST_DQ_FLAGS`, drained like `get_and_clear_last_dq_flags`), never into `daily_totals`; any other non-stable ccy or a coin bill before S still increments the census and refuses. Keep the census counts-only side channel stamped even on refusal so the derive can call `derive_unit_switch`. `sync_trades` (job_worker ~2394), `routers/cron.py` (~500, `_FETCH_NON_USD_FLAG`), `okx_archive_job.py` (~1664) and `daily_pnl_read_verdict` (~267) pass nothing and keep refusing, each pinned by a test.

---

### `analytics-service/tests/test_okx_unit_switch_fetch.py` (test; also extend `test_okxtrades_ccy.py`)

**Analog:** `analytics-service/tests/test_okxtrades_ccy.py`

**Harness** (lines 46-79):
```python
FLAG = "daily_pnl_non_usd_okx"

async def _read(rows):
    ex.get_and_clear_last_dq_flags()
    out = await fetch_daily_pnl(_Exchange(rows), SINCE_MS)  # type: ignore[arg-type]
    return out, ex.get_and_clear_last_dq_flags()

def _bill(bill_id, ts, ccy, pnl, fee, *, bill_type="2"):
    bill = okx_bill(bill_id, ts, ccy or "USDT", "10000", pnl, bill_type=bill_type, inst_type="SWAP", pnl=pnl, fee=fee)
    ...
```
**Core assertion shape** (lines 83-92): `assert out == []`, `assert flags.get(FLAG) is True`, plus `_fetch_degradation(flags)` reason check. New file: pass `unit_switch=` into the same `_read`; assert BTC bills on/after the base day land in the coin side channel and `out` holds only USDT; assert any other coin, a BTC bill before S, and `unit_switch=None` still refuse. Test comment convention: "Pre-fix: ..." describing the RED state on origin/main.

---

### `analytics-service/services/job_worker.py` derive (service, batch/transform)

**Analog:** the MT5 native derive branch (~9217-9548, key_inputs write ~9535-9548 and ~11053-11069) and `_marks_in_series_unit` (~642-668, apply block ~10282-10310; reason const `_MARK_UNIT_MISMATCH = "mark_unit_mismatch"`). Pattern 1 from RESEARCH: call the NAV/TWR core per segment with its own floors (`reconstruct_nav_and_twr(..., floors=USD_FLOORS)` for USD; BTC row from `_NATIVE_FLOORS["BTC"]` for the coin), never chain across S; convert the coin segment's returns with `convert_native_returns_to_usd(series, "BTC", btc_closes)` (benchmark.read_btc_closes) and concatenate to ONE USD series for the headline columns. Do NOT write `native_unit`. Marks: filter per segment before `_marks_in_series_unit`; stored immutable 'USD' marks inside the coin segment are converted or dropped by name. Refusal tokens join `READ_INCOMPLETE_TOKENS` (~5047-5065) with explicit permanent/transient classification (`_TRANSIENT_REFUSAL_TOKENS`) and `_DAILY_PNL_REFUSAL_ORDER` if realized-read reasons. A derive that succeeds ends `done` so `read_refusal_kept_figures` clears (`mark_compute_job_kept_figures`).

### `analytics-service/tests/test_okx_unit_switch_derive.py` (test)

**Analogs:** `test_derive_broker_dailies_dualmode.py`, `test_mt5_derive_branch.py` (native precedent), `test_derive_last_success_snapshot.py`, `test_nav_marks_derive_apply.py` (helper ~line 168). Required independent invariants: USD plus coin day sets equal the union with no overlap or gap; flat BTC balance and falling price gives BTC return ~0 and a negative USD view (Pitfall 6). Unchanged-reader RED tests (blends, match, simulator, book compose, analytics_runner benchmark pairing, KPI gate) feed the stored row shape (USD whole history, `unit_switch` flag present, `native_unit` absent) through the existing public entry point, never an ImportError RED.

---

### `analytics-service/services/analytics_runner.py` (carry `unit_switch` present-only)

**Analog:** same file, the `native_unit` carry at ~2141-2149 and ~2325-2330 ("carried present-only through the wholesale `data_quality_flags` rebuild"). Add `unit_switch` ({coin, switch_day, first_coin_return_day}) beside it; also copy into `last_success_snapshot` where `native_unit` is. Test beside `test_csv_analytics_runner.py`.

---

### `analytics-service/scripts/okxunitswitch_probe.py` (read-only live bills probe, founder-gated)

**Analog:** `analytics-service/scripts/derivegaps_probe.py` (also `walletoffset_probe.py`). Copy: `ReadOnlyRecordingExchange` view, run the REAL fetch (`fetch_all_trades(view, since_ms=None)`), drain `get_and_clear_last_dq_flags()` inside the same coroutine, deploy-fingerprint check, and the REDACTION CONTRACT ("labels k1..kN, counts, booleans, closed-vocabulary tokens ... No id, amount, venue text or key. The only path to stdout is `emit_record`"). Emit per (UTC day, ccy, instType, subType) bill count, fee sign, pnl-zero boolean, fee/balChg ratio bucket.

---

### Migration `strategy_analytics.unit_segments` (new nullable jsonb)

**Analog:** `supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql` (additive columns on the same table, header comment style: what it is for, writers, why it lives outside `data_quality_flags`, database enforces object-ness only, reader validates). Latest existing migration is `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql`; pick a later timestamp. Constraints: `scripts/lint-migration-data-dependence.mjs` clean (no data-reading DO guard), migration-reviewer and rls-policy-auditor clean, re-base before any CREATE OR REPLACE, regenerate baseline marker in the same commit if re-dumped, and check no column-enumerating grant or view on `strategy_analytics` (assumption A5). Update `src/lib/database.types.ts`.

**SQL test analog:** `supabase/tests/test_api_key_nav_marks.sql` (header: background, numbered arms "LISTED and EXECUTED in this order; each twin's FIRST `TEST FAILED (N)` must name its own arm"; each arm seeds its own users). A new supabase/tests file moves several censuses: `grep -a` them all.

---

### `src/lib/factsheet/unit-segments.ts` + `unit-segments.test.ts` (isomorphic composer)

**Analog:** `src/lib/factsheet/returns-unit.ts` and `returns-unit.test.ts`.

**Conventions** (returns-unit.ts lines 1-35): isomorphic, React-free, "A unit is a parameter, never a literal"; parse untrusted jsonb at the boundary, malformed reads as absent:
```ts
import { formatDay } from "@/lib/utils";
export const RETURNS_UNIT_RE = /^[A-Z]{2,10}$/;
export function parseReturnsUnit(raw: unknown): string | null
export function formatCloseDay(iso: string): string   // the ONE date formatter
```
Reuse `parseReturnsUnit` and `formatCloseDay`; add `parseUnitSwitch(raw)` and the sentence composer ("In USD to 14 Nov, in BTC from 15 Nov", built from derived dates, coin as parameter; exact copy and date format per UI-SPEC Copywriting Contract, which wins). Test file mirrors the `describe("parseReturnsUnit")` + accepts/rejects structure at returns-unit.test.ts lines 1-25.

---

### Presentation surfaces (TS components, SSR)

- **Chart break:** `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` already renders `payload.segmentBoundaries` and gap seams `view.missingSegments` (~344-351, ~451); reuse that seam so no line joins the two units. `chart-configs.ts` `cumulative` gains one opt-in flag in the same gating idiom as `segmentMarkers` / `marksStart`. TimeSeriesChart is editable (UI-SPEC; not in `FROZEN_ISLANDS`).
- **Masthead / KPI note:** `UnitSwitchDisclosure` as sibling of `UsdDisclosure` in `FactsheetView.tsx`; KPI note in `MetricsColumn.tsx` reusing its reason-line class; leverage hold copies `UsdViewLeverageHold` (164.6.6.2.1 D-16 precedent).
- **Payload:** `fetch-and-build-payload.ts` (~491, ~911-932) and `types.ts` (~1021-1027) carry `returnsUnit`; add `unitSegments` from the sidecar and do NOT set `returnsUnit`. Bump the payload cache version in `src/app/factsheet/[id]/v2/page.tsx` (file's own v11 to v12 comment shows the pattern).
- **List/table:** `src/lib/queries.ts` (~606-654; only enumerated scalars out of the private blob, add `unit_switch`), chip in `StrategyTable.tsx` (~1934). Test: `queries.native-unit-ranking.test.ts`.
- **OG / returns routes:** `src/app/api/og/factsheet/[id]/route.tsx` (one note line; CAGR label stays `withUnit("CAGR", null)`), `src/app/api/strategies/[id]/returns/route.ts`.
- Read `DESIGN.md`, UI-SPEC, and `node_modules/next/dist/docs/` first (AGENTS.md); `npm ci` is needed in the worktree before TS tasks.

## Shared Patterns

### Closed-token refusal, never venue text
**Source:** `analytics-service/services/job_worker.py` `READ_INCOMPLETE_TOKENS` (~5047-5065); `exchange.py` `_OKX_CCY_CODE_RE` gating (`_ccy if _OKX_CCY_CODE_RE.match(_ccy) else "blank"/"malformed"`).
**Apply to:** unit_switch.py, fetch change, derive. Counts-only logging; no ids/amounts (public repo).

### Per-test PROOF-01
**Apply to:** every new gate. Back up with `cp <file> <scratchpad>/bak`, neuter, capture RED naming the arm, `cp` back, `cmp` empty, GREEN. Never git checkout/restore/stash on uncommitted work; `grep -a`; pytest only from `analytics-service/`; mypy strict (`make typecheck`) in every analytics task.

### Native-to-USD conversion (one oracle across runtimes)
**Source:** `analytics-service/services/native_to_usd.py` `convert_native_returns_to_usd(series, unit, btc_closes)` (lines 107-132): `unit is None` returns input; `btc_closes is None` returns empty; day 0 dropped; unusable close withholds that day. TS twin `src/lib/factsheet/native-to-usd.ts`; shared fixture `tests/fixtures/native_to_usd_oracle.json`.
**Apply to:** derive coin-segment conversion; used per coin segment only, never on the whole row.

### Whole-history USD row, no `native_unit`
**Apply to:** derive writes, analytics_runner, key_inputs. Unchanged readers (`wealth_returns`, `strategy_matching`, routers `match`/`portfolio`/`simulator`, compose) stay correct because the stored row is plain USD; each gets a RED-on-origin/main test fed the stored row shape.

### Release hygiene (plan 05)
CHANGELOG entry in the same commit as the VERSION bump (VERSION and package.json byte-equal 4-digit; never `npm version`), names closed TODOS entries and deletes them, no skip-CI token or AI trailer anywhere, ship branch changes nothing under `.planning`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Coin side channel (second ContextVar beside `_LAST_DQ_FLAGS` in `exchange.py`) | utility | request-response | Closest is the existing `_LAST_DQ_FLAGS` / `get_and_clear_last_dq_flags` drain; no precedent for a non-flag payload channel. Planner copies the drain idiom. |
| Per-segment mark filtering in `_marks_in_series_unit` | service | transform | Only a whole-key refuse-on-mismatch exists; segment-aware filtering is new (RESEARCH Open Question 1, spike first). |
| Basis-control behavior on a switched row (`basis-context.tsx`, `metricsByBasis`) | component | request-response | UI-SPEC marks it unresolved; planner reads both files before specifying. |

## Metadata

**Analog search scope:** `analytics-service/services`, `analytics-service/tests`, `analytics-service/scripts`, `supabase/migrations`, `supabase/tests`, `src/lib/factsheet`, `src/app/factsheet/[id]/v2`.
**Files read this pass:** account_unit.py (header), native_to_usd.py (converter), exchange.py (OKX block), test_okxtrades_ccy.py, test_account_unit.py, derivegaps_probe.py (header), returns-unit.ts/test, one migration header, one SQL test header. job_worker.py, analytics_runner.py, FactsheetView.tsx and chart files are anchored from RESEARCH reads and by grep only; each plan re-reads before editing.
**Pattern extraction date:** 2026-11-27
