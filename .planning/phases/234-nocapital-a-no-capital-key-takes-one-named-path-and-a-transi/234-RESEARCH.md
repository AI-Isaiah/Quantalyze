# Phase 234: NOCAPITAL - Research

**Researched:** 2026-11-24
**Domain:** Allocator book compose (seam S2), Python only, no migration
**Confidence:** HIGH on code behaviour (every claim below was read in this session or reproduced by a throwaway probe); MEDIUM on the PROD gate, which is unmeasured until the SQL below is run.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
Copied from `234-CONTEXT.md` `## Implementation Decisions` (the planner must open that file for the full text; the load-bearing lines are):

- **Founder ruling (2026-11-24, on 233 DERIBITTRUTH Q2, "233 does not touch S2"):** `_reconstruct_key_equity` in `allocator_equity_derive.py` counts a flow as `out_of_window_flow` when it is dated on a left-out tail day that the derive stated (`key_inputs.tiny_base_days`) after the key's last stored return. That flow belongs to a stated day, not to a day outside the window. 234 owns the fix as part of S2. Measured at HEAD: no function named `_reconstruct_key_equity` exists; the count lives in `replay_key_equity` (`out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)`). Scope is exactly the ruling: a flow dated after the key's last stored return day, on a day listed in that key's stored `tiny_base_days`, is not counted. A flow before the first return day, or after the last return day on a day not stated, keeps counting. No other gate moves. `tiny_base_days` reaches the replay through a new optional keyword argument on `replay_key_equity`, default none.
- **NOCAP-01:** a candidate that cannot be confirmed falls back to `dropped_key`; the no-capital exit requires proof not derived from the live read. On a full-history venue (`FULL_HISTORY_VENUES` holds `mt5`) the level the stored flows and stored day P&L reach from inception must be at or below `DUST_NAV_FLOOR`; exact formula is research's (below). Where no independent proof exists the candidate is refused and named. A stored terminal below `-DUST_NAV_FLOOR` is not an exit: refused and named. Gate: two live MT5 exits (both `nonpositive`, exit day 2026-10-09, terminal 0.00) must be measured read-only; if either would flip it goes to the founder before execution.
- **NOCAP-02:** while at least one candidate is in play, any `Exception` (not only `NavReconstructionError`) from the candidate apply loop or the compose reverts once to the inputs exactly as stored (`no_capital_stored`), exception class logged, counts and class only. If the stored-input compose raises too, today's path runs unchanged. `BaseException` that is not `Exception` is never caught.
- **NOCAP-03:** one benign counts-only payload field, working name `no_capital_exit_refused`, a per-reason count over a closed reason set; no key id, venue id, day or USD. Never in `degrade_reasons`, never changes `is_trustworthy`. A run with no fallback writes no such field. It must also reach a refusal record written after a fallback (for example `compose_empty_blocked`), or the planner records why it cannot. The compose writes its own reasons; the job adds the reasons only it can see.
- **NOCAP-04:** a refused candidate leaves the payload equal to the no-candidate payload except for the NOCAP-03 field (the exception is stated in the test). A candidate whose interior hole lacks its stored segment terminals falls back without adding `key_inputs_mismatch`.
- **PROOF-01:** each gate goes RED on pre-fix code or a neutered copy with its named arm first, is restored from a byte backup (`cp` back, `cmp`), goes GREEN, recorded verbatim in the plan SUMMARY.
- Tests live in `analytics-service/tests/test_allocator_equity_no_capital_exit.py`, `test_derive_allocator_equity_job.py`, plus the replay tests. One PR, planner's call on plan count. 155.2 freeze: merge before 155.2 plan 12's recapture or after plan 14, never between.

### Claude's Discretion
- The exact formula for the MT5 independent proof, within the constraint above, once research has read the MT5 writer.
- Token spellings of the NOCAP-03 reason set (the planner's); where the field lives (`payload["inputs"]` or flags, the planner picks the one the existing no-capital names use).

### Deferred Ideas (OUT OF SCOPE)
None. Out of scope per CONTEXT.md: the derive writer (`run_derive_broker_dailies_job`, seam S1) including the MT5 balance read itself, any TS reader or UI change, any migration (if one appears, stop and tell the coordinator).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOCAP-01 | A funded MT5 key whose stored terminal reads zero is never dropped as no-capital | MT5 terminal is the live balance (circular). Proof = sum of the key's own stored writer-basis flows and day P&L (deals-derived). Probe 1 shows pre-fix code exits such a key trustworthy, so PROOF-01 can go RED. See "NOCAP-01". |
| NOCAP-02 | Any exception from a candidate leaves the previous row intact across retries | Apply loop (`job_worker.py` 17746-17813) and compose try (18183-18217) catch nothing but `NavReconstructionError`; an escaped exception is `classify_exception` -> `unknown` (retried). See "NOCAP-02". |
| NOCAP-03 | Every fallback stores a counted payload field naming why | Field in `payload["inputs"]`; compose and job each contribute; `refusal_payload` gets one optional kwarg. See "NOCAP-03". |
| NOCAP-04 | A refused candidate leaves no residue reason | Reproduced (probe 2): a candidate with missing segment terminals does NOT fall back; it exits named with `key_inputs_mismatch` added. Fix must force the fallback. See "NOCAP-04". |
| (ruling) | A flow on a stated tail day after the last return is not `out_of_window_flow` | Count at `allocator_equity_derive.py` 1498; thread `tiny_base_days` job -> compose -> replay. See "Out-of-window". |
</phase_requirements>

## Summary

All four NOCAP defects and the out-of-window ruling are confined to three files (`job_worker.py` `run_derive_allocator_equity_job`, `allocator_equity_compose.py` `compose_allocator_equity`, `allocator_equity_derive.py` `replay_key_equity` plus two new small readers/constants). No schema, TS reader or SQL reader needs to change: a repo grep of `src`, `supabase`, `scripts` for the no-capital field names and for any strict `inputs` validation found nothing, and the TS reader (`trustworthyDerivedCurve`, `extractTrustworthyDerivedSeries`, `untrustworthyRebuildReason`, `derivedPayloadRejection` in `src/lib/queries.ts` 4100-4260, 4300-4360) reads only `is_trustworthy`, `version`, `curve`, `returns` and `degrade_reasons` and ignores everything else.

Two findings change what the planner builds. (1) NOCAP-04 is not "drop a reason": a candidate with missing segment terminals does not fall back at all today, it exits (named, unsplit) while the book carries `key_inputs_mismatch`; the fix must make such a candidate fall back. (2) For NOCAP-01 the only independent evidence on an MT5 row is the key's OWN stored writer basis (`composed_flows`, `composed_day_pnl`), built from the deal ledger and never from the balance read; a row with no basis has no proof and is refused. Four existing MT5 candidate tests carry no basis and will flip from "exits" to "dropped" by design; they need re-fixturing.

**Primary recommendation:** Add one pure helper `_no_capital_ledger_level(basis)` (sum of own-row composed flows plus composed day P&L) and require `level <= DUST_NAV_FLOOR` for candidates on `LEDGER_PROOF_VENUES = {"mt5"}`; wrap exactly the apply loop and the compose call in `except Exception` with a restore-and-recompose; thread one counts dict (`no_capital_exit_refused`, closed reason set) from compose and job into `payload["inputs"]` and into `refusal_payload`; make a candidate with missing segment terminals fall back inside the compose before the reason is added; thread `tiny_base_days_by_key` job -> compose -> `replay_key_equity(stated_tail_days=...)`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| No-capital candidate selection, independent proof, D-10 bound | Worker job (`run_derive_allocator_equity_job`) | - | Only the job sees venue (`key_rows` exchange), stored rows and the writer basis |
| In-compose fall-back and its reasons | Pure compose (`compose_allocator_equity`) | Job (adds job-only reasons) | The compose owns replay refusal, blocking reasons, hole terminals |
| Exception revert (apply loop + compose) | Worker job | - | Owns `no_capital_stored` and the upsert |
| Counts-only payload field | Compose writes its reasons into `payload["inputs"]`; job merges its own | `refusal_payload` for refusal rows | Existing counts-only precedent is `payload["inputs"]` |
| Out-of-window count | `replay_key_equity` | Job reads `tiny_base_days`; compose passes it through | Count lives in the replay; the stored list is read by the job |
| Display of any of this | none in this phase | - | No TS/UI change (out of scope) |

## Standard Stack

Existing code only. No new packages are installed by this phase.

| Item | Version / location | Purpose |
|------|--------------------|---------|
| pytest + pytest-asyncio | `analytics-service/pytest.ini` (`asyncio_mode = auto`) | All gates |
| mypy strict | CI pin `mypy==2.4.0` (`requirements-dev.txt:53`); local `python3 -m mypy` is 2.0.0 | Type gate |
| pandas | local 3.0.1 | Series in replay/compose |

**Package Legitimacy Audit:** not applicable, no external package is installed (the `gsd-tools query package-legitimacy` seam was not run for that reason).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `python3` with pandas | every test | yes | Python 3.14.3 locally; CI uses 3.12 (`ci.yml:5682`) | none needed |
| ccxt | imported by `job_worker.py` | yes | local 4.5.64; repo pin and CI 4.5.89 (`requirements.in:29`) | note only; the allocator tests do not exercise ccxt |
| `pytest` on PATH | invocation | present but its interpreter lacks pandas | - | **Use `python3 -m pytest`** (verified: 28 passed in 39 s for the two compose files; 30 passed, 129 deselected in 37 s for `-k no_capital` in the job file) |
| PROD read access | NOCAP-01 gate | not available to this agent | - | orchestrator runs the SQL below via MCP |

## Architecture Patterns

### System flow (allocator book compose, the part this phase touches)

```
key_inputs rows + csv_daily_returns (DB)
        |
        v
job: read loop (17348-17447) -> per-key maps (flows, anchors, null reasons, realized terminal,
        |                        dropped pnl, writer_basis_raw, + NEW tiny_base_days_by_key)
        v
job: candidate selection (17526-17541)  --refuse--> NOCAP-03 counts (funded_terminal, negative_terminal, no_stored_terminal)
        v
job: stored snapshot no_capital_stored (17733-17744)
        v
job: apply loop (17746-17813)  [NEW: ledger proof] [D-10 bound]  --refuse--> counts
        |  (any Exception -> restore from snapshot, count candidate_exception)
        v
job: failing-key exits, no-history rule, eligible-set reconcile (17824-18042)  (DB calls here keep bubbling)
        v
job: _compose(primary) (18183)
        |-- NavReconstructionError + candidates -> revert, recompose stored   (count compose_refused)
        |-- NEW: other Exception + candidates   -> revert, recompose stored   (count candidate_exception)
        v
compose_allocator_equity:  segment loop -> candidate with missing terminals FALLS BACK (NEW)
                           replay_key_equity(..., stated_tail_days=NEW) -> fell_back (refused / blocking)
                           payload["inputs"]["no_capital_exit_refused"] (NEW, only when non-empty)
        v
job: merge job counts + compose counts -> payload["inputs"] ; empty curve -> _persist_refusal(..., no_capital_exit_refused=NEW) ; else upsert
```

### Recommended structure
No new modules. New names live beside their siblings:
- `allocator_equity_derive.py`: `LEDGER_PROOF_VENUES` (beside `FULL_HISTORY_VENUES`, line 1144), `NO_CAPITAL_REFUSAL_REASONS` closed set (beside `DeriveRefusal`), `read_tiny_base_days(payload)` (beside `read_dropped_day_pnl`, 1722), optional kwarg on `refusal_payload` (243), optional kwarg `stated_tail_days` on `replay_key_equity` (1285).
- `job_worker.py`: pure helper `_no_capital_ledger_level` beside `_no_capital_exit_consumes_only_dust` (16685).
- `allocator_equity_compose.py`: new optional parameter `tiny_base_days_by_key` on `compose_allocator_equity` (427).

### Anti-Patterns to Avoid
- **Do not add a `DegradeReason` or `DeriveRefusal` member.** `test_derive_refusal_rows.py` pins `set(tokens) == {m.value for m in DeriveRefusal}` and one blocking row per `_BLOCKING_REASONS` member against `tests/fixtures/derive_refusal_rows.json`, which the TS reader test and the census test also read. A new member means three runtimes change. The counts field is benign and is neither.
- **Do not catch `BaseException`** and do not widen the catch beyond the apply loop and the compose call: the DB calls between them (orphan delete `db_execute(_delete_orphan)`, 17957-17963; the markers re-read 18305) must keep bubbling as transient.
- **Do not restate DUST_NAV_FLOOR.** Import it (`from services.nav_twr import DUST_NAV_FLOOR` is already in scope at 16788).
- **Do not write the legacy snapshots table name or a stamp call in new code** (AST/grep suites over `job_worker.py`: `test_legacy_table_not_named.py`, `test_stamp_io_exhaustive.py`, `test_derive_silent_failure_f1_f4_f7.py`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-day basis parsing | A new JSON reader | `read_writer_basis` (1852) already gives `{day: amount}` for flows and P&L; the loop stores it in `writer_basis_raw` | Same malformed-row refusals as every other basis consumer |
| Day-list parsing | Ad-hoc `json` handling | `read_tiny_base_days` modelled on `read_dropped_day_pnl`, validating with `date.fromisoformat` | One strictness convention |
| Refusal record | A second payload builder | `refusal_payload(token, composed_at=, extra_reasons=)` with one optional kwarg | The fixture test pins its shape |
| "Is the book trustworthy" | A new predicate | `_is_trustworthy`, `blocking_degrade_tokens` | Existing closed set |

## NOCAP-01: the independent proof (questions 1 and 2)

### What the MT5 key-mode writer stores (read this session)

| Stored field (key_inputs) | MT5 USD key | Source in code | Independent of the live balance read? |
|---|---|---|---|
| `realized_terminal_usd` / `_day` | `_mt5_equity - (_mt5_equity - _mt5_balance)`, day = last NAV day | `job_worker.py:8515-8518`: `_realized_terminal = (_day_pnl_usd.index[-1], _mt5_equity - (_mt5_equity - _mt5_balance),)` | NO. It is the live balance. A2 (`_nc_terminal[1] <= DUST_NAV_FLOOR`, 17539) is circular for MT5. |
| `composed_day_pnl` (`{utc_day_iso, pnl_usd}`) | `mt5_day_pnl(deals)` | `job_worker.py:8508-8511` stores `_day_pnl_usd = mt5_day_pnl(_mt5_deals, ...)`; `broker_dailies.py:1103-1125` returns the unioned per-day deal cash effect (`profit + swap + commission + fee`) | YES. Deals only. |
| `composed_flows` (`{utc_day_iso, flow_usd}`) | `_flows_to_daily_usd(external_flows)` | `job_worker.py:8665-8678`; `external_flows` come from classified BALANCE/CREDIT/BONUS deals (8625-8668) | YES. Deals only. |
| `flows` (event-time `usd_signed`) | same deals | 8665-8668 | YES, but there is no day P&L beside it |
| `dropped_day_pnl` | only the days the TWR dropped | `dropped_day_pnl_payload` | Partial (not a full ledger) |
| `returns` (csv_daily_returns) | chain-linked from levels rolled back from the live balance | `broker_dailies.py:955-967`, `982-1100` (`terminal_nav = account_equity - (account_equity - account_balance)`) | NO |

The basis is stored only when `venue in WRITER_BASIS_VENUES and _composed_flows_usd is not None and _basis_day_pnl is not None and not _basis_day_pnl.empty and _realized_terminal is not None` (`job_worker.py:10294-10300`). `WRITER_BASIS_VENUES: Final[frozenset[str]] = frozenset({"deribit", "mt5"})` (`job_worker.py:374`). A timed MT5 key with no basis stores `writer_basis_withheld` instead (10321-10336) and already blocks the book as `key_inputs_mismatch`.

### The identity and the formula

The writer's NAV rolls backward `L_{t-1} = L_t - F_t - P_t` from the terminal, so over the whole stored basis `sum(F_t + P_t) = terminal - prev0`, where `prev0` is the writer's level before its first NAV day. For an MT5 key `prev0` is deals-derived, and on a full-history ledger it is about 0 (`FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5"})`, `allocator_equity_derive.py:1144`; comment at 1132-1143: `history_deals_get` is a full-history fetch, epoch 0 to now). Because the USD-key day P&L is the deal ledger and not a roll from the balance, `sum(composed_flows) + sum(composed_day_pnl)` is the balance the DEALS imply, independent of what `account_info` said today.

**Formula (use it):**

```
ledger_level = sum(flow_usd for composed_flows) + sum(pnl_usd for composed_day_pnl)     # own row, all stored days
confirmed    = ledger_level <= DUST_NAV_FLOOR                                          # 100.0, mirrors A2's "<="
```
Requirements around it: (a) it applies only when the key's exchange is in `LEDGER_PROOF_VENUES = frozenset({"mt5"})`; (b) it needs the key's OWN row basis, `writer_basis_raw.get(key)`, not the stitched basis in `writer_basis_by_key` (a stitched kept key's own row is the right operand because every MT5 login reads the full history of the account, so its own `prev0` is about 0; the joined basis would mix members); (c) no own basis means no proof, so refuse (reason `ledger_basis_absent`); (d) a non-finite sum is refused the same way. The lower side is not added to the condition: a ledger that disagrees with the terminal from below is also caught downstream, because an MT5 key is in `full_history_keys` (`job_worker.py:18137-18141`) and the replay's zero-start check flags a non-zero `prev0` as `inception_unreconciled` (blocking) whenever an opening flow run exists, which makes the candidate fall back in the compose. State this limit in the helper's docstring.

`DUST_NAV_FLOOR`: `USD_FLOORS = UnitFloors(dust_nav=100.0, material_equity=100.0, residual_abs_tol=1.00)` (`services/account_unit.py:47`), `DUST_NAV_FLOOR = USD_FLOORS.dust_nav` (`services/nav_twr.py:70`).

**Native BTC MT5 keys:** `_native_key_usd_writer_basis` (`job_worker.py:4905-4962`) builds `composed_day_pnl = level_day_pnl(usd_levels, composed_flows, prev0=prev0_usd)`, a level identity, so `sum(F + P) = L_T_usd - prev0_usd` by construction, with `prev0_native = native_levels[first] - pnl_by_day[first] - flow[first]` (4951-4954). Algebra from that code (derived here, not run): with a transient-zero terminal `N_T = 0` the sum equals the deals-implied native balance priced at the first close, so it still discriminates; for a small non-zero `N_T` it adds a bounded `N_T * (c_T - c0)` term. A holed key gets no composed basis (token `interior_hole`, `WRITER_BASIS_WITHHELD_TOKENS`, 1884-1903), so it is refused (`ledger_basis_absent`). `[ASSUMED]`: that the two PROD MT5 exits are USD keys; the SQL below reports `native_unit_key` to settle it.

**Marked rows:** from `marks_since` on, the composed P&L is `apply_marks`' mark identity (`job_worker.py:9907-9927`), so independence stops there. It can never matter for a candidate: a stored mark is refused as `nonpositive` or `dust` (`services/nav_marks.py:388-390`: `if nav_usd <= 0.0: return "nonpositive"` / `if abs(nav_usd) <= DUST_NAV_FLOOR: return "dust"`), so a marked key's terminal (the last mark, 9860) is above the floor and A2 already refuses it as `funded_terminal`.

### Every venue where a candidate can arise (answer to "enumerate")

A candidate needs `anchor_usd` NULL with reason in `_NO_CAPITAL_ANCHOR_REASONS: frozenset[str] = frozenset({"dust", "nonpositive"})` (`services/equity_reconstruction.py:591`), a return day, and a stored realized terminal.

| Venue | Can it be a candidate? | Is the stored terminal the live read? | Independent proof today |
|---|---|---|---|
| mt5 (USD and BTC-native) | yes | yes (balance, 8515-8518) | none -> **this phase adds it** |
| deribit | yes | terminal rolled from the live native equity (`native_nav.py:794-816`) | **yes, at write time**: `native_realized_terminal` reads `_native_nav_levels`, which runs `_assert_inception_reconciled` before returning a level (`native_nav.py:660-675`; gate raises for `full_history` ledgers, 931-963). A refused derive writes neither returns nor inputs (comment `job_worker.py:17837-17839`). Recommendation: leave Deribit unchanged. |
| okx, bybit, binance | no | `_ccxt_terminal_usd` is stored only when `float(equity) > DUST_NAV_FLOOR` and the terminal is positive (`job_worker.py:9396-9413`), but a `dust`/`nonpositive` anchor means equity is at or below the floor | the two conditions cannot hold in one row |
| sfox | no (`_nc_terminal is None`, refused by the existing "no stored terminal" arm) | no terminal stored (comment 9394-9395) | n/a |
| any marked key | no | last stored mark, always above the floor | n/a |

### PROD gate (question 2): the read-only SQL for the orchestrator

Run the marker query FIRST, as its own call, and confirm it names PRODUCTION. PROD reads go through MCP, one query per call, never chained (memory: founder 2026-11-06). Then run the single statement below. It reads `allocator_equity_derived` only, outputs aggregates grouped by venue (no key id, no allocator id, no email), and reports an absent basis and an absent row as their own outcomes, never as a pass.

```sql
-- 0. marker (run alone, first)
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

```sql
-- 1. NOCAP-01 gate: do the live no-capital exits pass the proposed ledger proof?
--    Threshold 100.0 = DUST_NAV_FLOOR (services/account_unit.py USD_FLOORS.dust_nav).
WITH exits AS (
  SELECT ec.allocator_id,
         e.elem ->> 'api_key_id' AS api_key_id,
         e.elem ->> 'reason'     AS reason
  FROM allocator_equity_derived ec
  CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(ec.payload -> 'no_capital_exited_keys') = 'array'
              THEN ec.payload -> 'no_capital_exited_keys' ELSE '[]'::jsonb END
       ) AS e(elem)
  WHERE ec.kind = 'equity_curve'
),
joined AS (
  SELECT x.reason, ki.payload AS p
  FROM exits x
  LEFT JOIN allocator_equity_derived ki
         ON ki.allocator_id = x.allocator_id
        AND ki.kind = 'key_inputs:' || x.api_key_id
),
m AS (
  SELECT coalesce(p ->> 'venue', 'row_absent')              AS venue,
         reason,
         (p ->> 'native_unit') IS NOT NULL                   AS native_unit_key,
         coalesce(jsonb_typeof(p -> 'composed_flows') = 'array'
                  AND jsonb_typeof(p -> 'composed_day_pnl') = 'array', false) AS has_basis,
         (p ->> 'realized_terminal_usd')::numeric            AS terminal_usd,
         CASE WHEN jsonb_typeof(p -> 'composed_flows') = 'array' THEN
              (SELECT coalesce(sum((r ->> 'flow_usd')::numeric), 0)
                 FROM jsonb_array_elements(p -> 'composed_flows') r) END AS sum_flows,
         CASE WHEN jsonb_typeof(p -> 'composed_day_pnl') = 'array' THEN
              (SELECT coalesce(sum((r ->> 'pnl_usd')::numeric), 0)
                 FROM jsonb_array_elements(p -> 'composed_day_pnl') r) END AS sum_pnl
  FROM joined
),
v AS (
  SELECT *,
         sum_flows + sum_pnl AS ledger_level,
         CASE WHEN venue = 'row_absent'               THEN 'key_inputs_row_absent'
              WHEN NOT has_basis                      THEN 'no_ledger_basis'
              WHEN sum_flows + sum_pnl <= 100.0       THEN 'pass'
              ELSE 'refuse_ledger_funded' END          AS outcome
  FROM m
)
SELECT venue, reason, native_unit_key, outcome,
       count(*)                                  AS n_exits,
       min(terminal_usd)                         AS terminal_min,
       max(terminal_usd)                         AS terminal_max,
       min(ledger_level)                         AS ledger_level_min,
       max(ledger_level)                         AS ledger_level_max,
       max(abs(ledger_level - terminal_usd))     AS max_gap_to_terminal
FROM v
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;
```

How to read it: the founder's two MT5 exits appear as `venue = mt5, reason = nonpositive`. **`pass`** for both (`n_exits = 2`, `ledger_level_max <= 100`, small `max_gap_to_terminal`) means no user-visible change and execution proceeds. **`no_ledger_basis` or `key_inputs_row_absent`** means those keys would flip from exited to `dropped_key` under the new rule: that goes to the founder before execution (CONTEXT.md gate). **`refuse_ledger_funded`** means the ledger says the account holds money while the live read said empty: also a founder question, and it is the transient-zero failure the phase exists to catch. Any `deribit` rows are informational only (Deribit is not gated, see the venue table); the same column shows what a Deribit extension would flip if the founder ever wants it. `max_gap_to_terminal` near 0 is the expected `prev0 = 0` identity.

### RED fixture is feasible (probe 1, run this session)

A scratchpad script importing the existing fixture builders (`_nc_assemble`, `_nc_payload`, `_compose_no_capital_book`) built an MT5 candidate: `anchor_null_reason` `nonpositive`, stored terminal 0.0 on day 4, own basis flows `{d1: +80000, d4: -20000}` (ledger sum 60000, funded), returns flat on days 1-3. On unmodified code it exits and the book reads trustworthy: `trust=True`, `exited=[{'api_key_id': 'key-C', 'reason': 'nonpositive', 'day': '2026-06-08'}]`, curve `[120000.0, 120000.0, 120000.0, 100000.0, 100000.0]`. The same shape without a basis exits identically. So the obvious funded-ledger fixture is NOT pre-refused by the replay or by D-10, and PROOF-01 can go RED. A shape that is only a flat funded account (deposit on day 1, nothing else, terminal 0) IS already refused by the replay (all-zero levels, "non-positive reconstructed equity"), so do not use it. The withdrawal on the terminal day after the last return (A3 shape) is what lets the candidate pass D-10 and the replay; keep that shape and make the ledger sum large.

### Tests that flip by design (re-fixture, do not weaken)

These MT5 candidates carry no `composed_*` basis (`_nc_payload` without `basis_pnl`) and exit today; with the proof they become `dropped_key`. Each needs a hand-derived basis whose sum is at or below the floor and consistent with the stored levels (the writer identity `L_{t-1} = L_t - F_t - P_t` with `prev0 = 0`, so `sum(F + P)` equals the terminal):
- `test_no_capital_exit_mt5_nonpositive_key_emptied_by_a_final_withdrawal` (`test_derive_allocator_equity_job.py:4198`): needs a +20000 deposit on the first day and the -20000 withdrawal.
- `test_no_capital_exit_mt5_dust_key_with_a_small_positive_terminal` (4226): levels 4000, 800, 80 => basis `F={d1: 4000}`, `P={d1: 0, d2: -3200, d3: -720}`, sum 80.
- `test_no_capital_exit_a3_mt5_withdrawal_after_last_return` via `_nc_mt5_withdrawal_book` (4180, 4280): +20000 deposit first day, -20000 on day 4.
- `test_no_capital_exit_two_candidates_each_leave_on_their_own_day` (4759; the MT5 key D at 4780): same as D above.
Tests that stay dropped regardless (verdict unchanged, but reason counts change): 4504-4521 (deposit after the terminal day), 4606-4633 (inception residual). Adding a basis to a fixture moves the replay into writer mode, so re-derive the expected curve by hand, never copy the program's output (money-math oracle rule).

## NOCAP-02: exceptions (question 3)

### Where a non-`NavReconstructionError` can escape while candidates are in play

| Region | Lines (`job_worker.py`) | Catch today | Candidate-related raise sources |
|---|---|---|---|
| Apply loop | 17746-17813 | none | `datetime.fromisoformat(...)` in `_no_capital_exit_consumes_only_dust` (16724-16728), map lookups (`flows_by_key[_k]`, `dropped_pnl_by_key[_k]`, `returns_by_key[_k]`, `last_return_day[_k]`), `float(...loc[...])` at 17807, `validate_flow_shape` is not called here. Any future edit in the helpers. |
| Between loop and compose | 17824-18042 | n/a | DB reads/writes (`db_execute(_delete_orphan)`, 17957-17963): NOT the rule's, must keep bubbling |
| Compose call | 18183-18217 | `except NavReconstructionError` only | the whole of `compose_allocator_equity` (pure) |
| Second (stored) compose | 18214-18217 | `NavReconstructionError` -> `_compose_refused` | unchanged by this phase |

The apply loop mutates the primary maps in place (`anchors_by_key`, `null_anchor_reasons`, `realized_terminal_by_key`, `departed_end_by_key`, `no_capital_exit_by_key`, and rebinds entries of `flows_by_key`, `dropped_pnl_by_key`, `writer_basis_by_key`; it never mutates a value in place). `no_capital_stored` holds shallow copies taken BEFORE the loop (17735-17744). So a mid-loop exception is undone by `clear()` + `update(stored)` for each of the eight maps and `no_capital_exit_by_key.clear()`. Do this before the failing-key section (17824), which edits both the primary and the stored copy (17880-17882).

### How the dispatcher treats an escaped exception (for the retry test)

`dispatch` wraps the handler in `except Exception` (`job_worker.py:18688-18696`), calls `classify_exception`, and returns `DispatchResult(outcome=FAILED, error_kind=...)`. `classify_exception` ends with `return ("unknown", str(exc)[:500])` for `RuntimeError, ValueError, KeyError, ...` (1469-1470); `ErrorKind = Literal["transient", "permanent", "unknown"]` (294) and the module docstring (line 28) says `everything else -> unknown (retried by default)`. So today a candidate's `KeyError` ends the job `FAILED/unknown`, it is retried, the upsert at 18344 is never reached, and the previous `equity_curve` row stays stale on every attempt. `BaseException` that is not `Exception` (asyncio cancellation) is not caught by `dispatch` or by the new arms.

### Shape of the fix

```python
# apply loop: wrap, restore on Exception
try:
    for _k in sorted(no_capital_candidates):
        ...  # existing body unchanged
except Exception as _nc_exc:  # noqa: BLE001 - NOCAP-02: any candidate fault reverts to stored inputs
    _restore_stored(no_capital_stored)          # clear()+update() of the eight maps, no_capital_exit_by_key.clear()
    job_refused["candidate_exception"] += len(no_capital_candidates)
    logger.warning("derive_allocator_equity: %s while applying %d no-capital candidate(s) for allocator %s - reverted to %s",
                   type(_nc_exc).__name__, len(no_capital_candidates), allocator_id, DegradeReason.DROPPED_KEY.value)

# compose: NavReconstructionError arm unchanged; add a sibling arm
except Exception as exc:  # noqa: BLE001
    if no_capital_stored is None or not no_capital_exit_by_key:
        raise
    ... same revert + recompose(no_capital_stored), count candidate_exception ...
```
Keep the existing `except NavReconstructionError` arm first (it keeps today's `_compose_refused` when no candidate is in play). The repo convention is a trailing `# noqa: BLE001` on a broad catch (80 `except Exception` in `job_worker.py`, 62 carry it); no lint step enforces it (no ruff/flake8/pylint in `ci.yml` or `pyproject.toml`, grep returned nothing), but match it. The log carries the class name and counts only.

### Test design

- Inject the fault where a real candidate path would raise: `patch("services.job_worker._no_capital_exit_consumes_only_dust", side_effect=KeyError(...))` for the apply loop (a module-level function resolved at call time), and a compose wrapper that raises `ValueError` only when `kwargs.get("no_capital_exit_by_key")` is truthy (the pattern at `test_derive_allocator_equity_job.py:4677-4681`). Seed a stale `equity_curve` row first (as 4684-4688 does).
- "Across a retry": run the job twice against the same `_FakeSupabase` and assert both runs are `DONE`, both upserts are the no-candidate payload, and no `equity_curve` delete happened. To show retry classification, also drive `dispatch(job)` (it needs `get_supabase` patched): pre-fix `dispatch` returns `FAILED` with `error_kind == "unknown"` on every attempt and `fake.upserts` has no `equity_curve` upsert; post-fix it is `DONE`.
- Negative control: a candidate-free book where the compose raises `ValueError` must still raise (the arm only handles candidates); a `BaseException` subclass raised by the compose must propagate.

## NOCAP-03: the counts field (question 4)

### Where the writes are

- The compose payload: `payload["inputs"]` is `{"n_keys", "anchor_asof", "composed_at"}` (`allocator_equity_compose.py:1156-1160`). The job adds counts-only keys there after the compose: `departed_history_unavailable_keys` and friends (`job_worker.py:18226`), `departed_writer_basis_unchecked_keys` (18238), `writer_basis_missing_members` and `writer_basis_stitched_members` (18243-18244). That is the existing counts-only home, so put the new field at `payload["inputs"]["no_capital_exit_refused"]`, a `{reason: count}` dict with keys in sorted order. No flag token and no `degrade_reasons` entry (`flags` is a sorted token list, `degrade_reasons` feeds `is_trustworthy`).
- The refusal record: `refusal_payload` (`allocator_equity_derive.py:243-279`) returns a fixed `inputs: {"n_keys": 0, "anchor_asof": None, "composed_at": composed_at}`. It CAN carry an extra field: add `no_capital_exit_refused: Mapping[str, int] | None = None` and write `inputs["no_capital_exit_refused"]` only when non-empty, so the default call is byte-identical and `test_refusal_payload_is_the_fixture_row` keeps passing. `_persist_refusal` (`job_worker.py:16794-16820`) forwards it.
- The refusal path that follows a fallback is the empty-curve branch (18269-18292): a sole candidate that falls back leaves no curve, and `_blocking == ["dropped_key"]` with a candidate that has returns routes to `compose_empty_blocked` with `extra_reasons=_blocking`. This is the common shape (a user with one emptied key), so the field MUST reach it: read the merged counts (compose's `payload["inputs"].get(...)` plus the job's) and pass them to `_persist_refusal`.
- Do NOT carry it on `_compose_refused` (18162-18181) after a failed stored recompose: no fallback result exists there and the refusal is a structural input fault that is not the rule's (CONTEXT: "today's path runs unchanged"). Record that reason in the plan.

### Closed reason set (spellings are the planner's; these are proposals)

Define `NO_CAPITAL_REFUSAL_REASONS: Final[frozenset[str]]` in `allocator_equity_derive.py`; every writer asserts membership (an unknown token is a code bug, loud).

| Token | Writer | Route |
|---|---|---|
| `funded_terminal` | job, selection (17528-17541) | stored terminal above `DUST_NAV_FLOOR` (A2) |
| `negative_terminal` | job, selection | stored terminal below `-DUST_NAV_FLOOR` (NOCAP-01); applies to every venue |
| `no_stored_terminal` | job, selection | `_nc_terminal is None` (optional, see Open Question 4) |
| `ledger_basis_absent` | job, apply loop | MT5, no own basis |
| `ledger_level_funded` | job, apply loop | MT5, ledger level above the floor |
| `consumes_more_than_dust` | job, apply loop | D-10 refusal (17776) |
| `replay_refused` | compose | `NavReconstructionError` from the candidate's replay (838-843) |
| `blocking_reason` | compose | replay returned a blocking reason or no series (844-849) |
| `segment_terminals_missing` | compose | NOCAP-04 forced fallback |
| `compose_refused` | job | whole-compose refusal reverted (18196-18217) |
| `candidate_exception` | job | NOCAP-02 revert (apply loop or compose) |

Selection must count a refusal only for a key that would otherwise be a candidate: anchor NULL, token in `_NO_CAPITAL_ANCHOR_REASONS`, a return day, not in `departed_end_by_key` (17528-17532) and then fail on the terminal. Count per key, not per unit (the compose's `fell_back` list is already per owner key).

### Readers and tests that a new field could break

- TS: nothing reads the no-capital fields or enumerates `inputs` keys (a `grep -a` of `src`, `supabase`, `scripts` and `docs` for the field names hit only the Python files and the prose runbook `docs/runbooks/deribitwedge-rebaseline-readings.md`; that is a grep reading, not proof beyond it, and the reader code itself was read in `src/lib/queries.ts`). The census (`scripts/accounttruth-census.mjs`) reads `is_trustworthy` and version only. `seam-*` tests under `src/lib/` do not scan `job_worker.py`, `allocator_equity_compose.py` or `allocator_equity_derive.py` (their `analytics-service` references are routers, `db.py`, ingestion adapters, `error_contract.py`).
- Python: no test asserts the whole `inputs` dict (`grep` found only `["inputs"]["n_keys"]` and the two `departed_writer_basis_unchecked_keys` assertions).
- **Tests that break by design under NOCAP-03:** the two whole-payload equality tests `assert _without_clock(payload) == _without_clock(_compose(_today(kwargs)))` at `test_allocator_equity_no_capital_exit.py:240` and `:260`. They must pop `no_capital_exit_refused` from `payload["inputs"]` before comparing (the exception CONTEXT states). No other test compares a fallback payload to a no-candidate payload (`_without_clock(` and `_today(` have no other users).
- Tests that read job_worker source and are unaffected by this phase if the rules above are followed: `tiny-base-literal-pin.test.ts` (regex on the writer lines `_key_inputs_payload["tiny_base_days"] = _tiny_listed`, untouched), `test_stamp_io_exhaustive.py`, `test_derive_silent_failure_f1_f4_f7.py`, `test_legacy_table_not_named.py`. The read-side literal `"tiny_base_days"` in the new reader is not pinned by the TS pin; optional hardening is a Python test that the reader's key equals the writer's.

## NOCAP-04: the residue, reproduced (question 5)

Probe 2 (scratchpad, run this session, helpers `_hole_candidate_book` / `_today` / `_without_clock` from `test_allocator_equity_no_capital_exit.py` with `segment_terminals_by_key = {}`):

1. Candidate whose interior hole has no stored segment terminals: it does NOT fall back. Result `trust=False`, `degrade_reasons=['classified_rotation', 'key_inputs_mismatch', 'window_truncated']`, `exited=[{'api_key_id': 'B', 'reason': 'nonpositive', 'day': '2026-06-09'}]`, flags include `no_capital_key_exited`. The no-candidate payload for the same inputs: `degrade_reasons=['dropped_key', 'no_anchor']`, `flags=['sole_key']`. Not equal.
2. Same book with the last segment also blocking (realized terminal on a day that is not its last return day): the candidate falls back and keeps the residue: `degrade_reasons=['dropped_key', 'key_inputs_mismatch', 'no_anchor']` against today's `['dropped_key', 'no_anchor']`. Not equal.

Cause: the segment loop adds `reasons.add(DegradeReason.KEY_INPUTS_MISMATCH)` (`allocator_equity_compose.py:739-751`) before any replay, for the key regardless of candidacy, then `continue`s and composes it unsplit. `no_capital_exit` is only built later (814) and nothing in that branch puts the owner in `fell_back`. The no-candidate payload has no such reason because an unanchored key never enters `anchored_keys`, so the loop never sees it.

**Fix (must force the fallback; dropping the reason alone would let an unsplit holed key exit as trustworthy).** Hoist `no_capital_exit = dict(no_capital_exit_by_key or {})` above the segment loop. In the missing-terminals branch: if `k in no_capital_exit`, add `k` to a local `segment_refused` set, do NOT add `KEY_INPUTS_MISMATCH`, do not emit the mismatch log, `continue`; otherwise keep today's behaviour exactly (a non-candidate still adds the reason). In the replay loop (823-849), before calling `replay_key_equity`, `if owner in segment_refused: fell_back.append(owner); counts["segment_terminals_missing"] += 1; continue`. The existing `for owner in fell_back` cleanup (851-870) removes the key's units (`parent` maps the unsplit key to itself), so the payload becomes the no-candidate payload.

Test: build `_hole_candidate_book(last_terminal=(DAYS[3], 600.0))` with `segment_terminals_by_key = {}`, compose it, compose `_today(kwargs)`, pop `no_capital_exit_refused` from the candidate payload's `inputs`, assert `_without_clock(a) == _without_clock(b)`, and assert `no_capital_exit_refused == {"segment_terminals_missing": 1}`. Also keep `test_hole_segment_of_a_key_that_is_not_a_candidate_still_raises` and add the sibling "non-candidate with missing terminals still adds `key_inputs_mismatch`". Add the probe-2b shape (blocking last segment) as a second equality case. Remember `composed_at` differs per call, which `_without_clock` already blanks.

## Out-of-window (question 6)

- Written: key-mode derive stores `_key_inputs_payload["tiny_base_days"] = _tiny_listed` (`job_worker.py:10207-10209`), present-only, an ascending unique list of ISO day strings from `tiny_base_day_list` (`services/tiny_base.py:99-121`), which raises `ValueError` on a non-canonical day. Real shape from 233's diagnosis (`git show 5ce61e219:.planning/debug/deribit-stale-returns.md`): one Deribit key lists a contiguous tail 2026-10-27 through 2026-11-23 plus two earlier ranges inside its history; its 2026-11-09 flow of about +3 USD sits on a listed tail day past the last return (2026-10-26); the realized terminal is on 2026-11-23.
- Read today: the job's read loop never reads it (17348-17447); the TS side reads it for display (`readTinyBaseDays`), unrelated.
- What the count reads: `replay_key_equity` assigns `fbd = _flows_by_day(flows)` (1441) and, in writer mode only, REASSIGNS `fbd = w_flows` (1477, the writer's composed flows) before the count; `ret_days = sorted(r)` are the STORED RETURN days, never the writer P&L days. So `out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)` (1498) counts event-time flows outside the return window in legacy mode and writer flows outside it in writer mode. The Deribit case is writer mode: the tail flow is a writer flow with `fd > hi`.
- **Change:** new keyword `stated_tail_days: Collection[str] | None = None` (the CONTEXT calls the ruling's input `tiny_base_days`; the planner may name the kwarg `tiny_base_days` to match). Replace the count with `sum(1 for fd in fbd if fd < lo or (fd > hi and fd not in stated))`, subtract `len(opening_run)` as before. `fd < lo` and an unstated `fd > hi` still count; nothing about `history_reaches_inception` changes. The exemption is not venue-gated (the list is stored for any venue that stated it).
- Reader: add `read_tiny_base_days(payload) -> frozenset[str]` beside `read_dropped_day_pnl`. Recommendation (a design call, flagged in Assumptions): make it TOLERANT, returning empty on anything malformed and logging a count-only warning, because the list only RELAXES a gate; a malformed list leaving today's behaviour is the safe direction, while the house strict style would send the whole allocator compose to `_permanent_corrupt_input` over a relaxer.
- Job: collect `tiny_base_days_by_key[api_key_id]` in the key-inputs loop for counted keys (17424-17447) and, for consistency, departed keys (17359-17391). Do not read it for stitch sources: a stitched kept key's series ends where the kept member's series ends (`stitch_shared_account`: "the last member owns every day from its own first day on", `allocator_equity_derive.py:703-758`), so the tail days beyond `hi` belong to the kept member's own list.
- Compose: new optional parameter `tiny_base_days_by_key: Mapping[str, Collection[str]] | None = None`, passed as `stated_tail_days=tiny_base_days_by_key.get(k)` at the one production call (828-837). Segment units `k#hole0` have no entry (only the unit carrying the key's own id gets the list), which is correct because an earlier segment cannot have a day past its own end.
- Callers of `replay_key_equity`: one production call (`allocator_equity_compose.py:828`); everything else is tests (`test_allocator_equity_dropped_day_pnl.py`, `_emptied_stretch`, `_inception`, `_realized_basis`, `_returns`, `_self_check`, `_writer_basis`, `test_derive_allocator_equity_job.py`, `test_e2_equity_curve_layer.py`, `test_e2_parity_oracle.py`, `test_e2_seam_ledger.py`, `test_nav_marks_apply.py`, `test_tiny_base_marks.py`). A defaulted keyword leaves them all unchanged.
- Tests (template: `test_post_window_flow_keeps_out_of_window_flow_even_with_a_clean_opening`, `test_allocator_equity_inception.py:209-228`): (1) same book with `stated_tail_days={_iso(_N_WINDOW)}` gives no `out_of_window_flow`, `flags` has no `out_of_window_flows`; (2) the day not stated still counts; (3) a flow BEFORE the first return day listed in `stated_tail_days` still counts (scope is the tail only); (4) a listed day that is not after `hi` is irrelevant; (5) job-level: a counted key row with `tiny_base_days` containing the tail flow day composes trustworthy, and with the list removed carries `out_of_window_flow` (this one is the threading arm).

## Common Pitfalls

### Pitfall 1: an unprovable fixture
**What goes wrong:** a funded-ledger MT5 fixture that the replay or D-10 already refuses cannot go RED.
**How to avoid:** use probe 1's shape (withdrawal on the terminal day after the last return, deposit on the first return day so no opening run exists, ledger sum 60000); never a flat funded account.

### Pitfall 2: restoring only part of the state
**What goes wrong:** the apply loop edits eight structures; restoring a subset leaves `no_capital_exit_by_key` or `departed_end_by_key` populated and the primary compose still treats the key as a candidate.
**How to avoid:** restore all eight from `no_capital_stored` and clear `no_capital_exit_by_key`; assert in the test that the first compose call carries no `no_capital_exit_by_key`.

### Pitfall 3: counting a refusal for a key that was never a candidate
**What goes wrong:** a plain failing key with a `balance_error` token would be counted `funded_terminal`.
**How to avoid:** count only after the token, returns, not-departed and terminal-present tests pass (see the selection note above).

### Pitfall 4: byte-equality that includes the wall clock
**What goes wrong:** `inputs.composed_at` differs per call. **How to avoid:** `_without_clock` (already in the test file).

### Pitfall 5: the stored-input compose is not a clean slate
**What goes wrong:** after the revert the stored compose still receives the failing-key exits and the no-history pops (both applied to both inputs, 17880-17882, 18007-18013). That is intended; do not "restore" those.

## Code Examples

```python
# NOCAP-01 helper, beside _no_capital_exit_consumes_only_dust (pure over stored numbers)
def _no_capital_ledger_level(basis: tuple[Mapping[str, float], Mapping[str, float]] | None) -> float | None:
    """Sum of the key's OWN stored writer-basis flows and day P&L (deal-ledger derived, never the
    balance read). ``None`` = no proof (no basis, or non-finite)."""
    if basis is None:
        return None
    total = sum(basis[0].values()) + sum(basis[1].values())
    return total if math.isfinite(total) else None
```
```python
# apply loop, before D-10
_nc_venue = str(rows_by_id[_k].get("exchange") or "").strip().lower()
if _nc_venue in LEDGER_PROOF_VENUES:
    _ledger = _no_capital_ledger_level(writer_basis_raw.get(_k))
    if _ledger is None:
        job_refused["ledger_basis_absent"] += 1; continue
    if _ledger > DUST_NAV_FLOOR:
        job_refused["ledger_level_funded"] += 1; continue
```
(Both snippets are shape illustrations, not verified code. Check at implementation time that `math` is imported in `job_worker.py` and that `rows_by_id[_k]` exists for every candidate; it does, since a candidate comes from a `key_inputs` row whose key is in `rows_by_id`, 17352.)

## State of the Art

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| A2 trusts the stored terminal | A2 plus independent ledger proof for MT5 | this phase | a transient zero cannot exit a funded key |
| `except NavReconstructionError` only | any `Exception` with candidates in play | this phase | row never stale across retries |
| fallback = log line | fallback = counted payload field | this phase | a regression in the rule is visible in data |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The two PROD MT5 exits carry a composed basis and pass the proof (unmeasured; SQL gate decides) | NOCAP-01 | If not, two keys flip to `dropped_key`: founder question before execution |
| A2 | The two PROD MT5 exits are USD keys, not BTC-native | NOCAP-01 | The BTC-native sum has the extra bounded term; the SQL's `native_unit_key` column settles it |
| A3 | Every PROD MT5 key's ledger reaches inception (`prev0` about 0); source is the code comment at `allocator_equity_derive.py:1132-1143` and `broker_dailies.py:971-977`, not measured | NOCAP-01 | A truncated ledger shifts the sum; the replay's zero-start check is the second guard when an opening run exists |
| A4 | Leave Deribit ungated because the §5 inception gate already proves its terminal at write time | NOCAP-01 | Founder may want uniformity; the SQL reports Deribit rows so the flip is measurable |
| A5 | A tolerant `tiny_base_days` reader is better than a strict one | Out-of-window | Strict style would permanent-fail a book over a relaxer; tolerant style hides a corrupt list behind a warning |
| A6 | Reason spellings and the `no_stored_terminal` reason | NOCAP-03 | Cosmetic; closed set is test-pinned either way |
| A7 | Algebra for the native-BTC basis sum (derived from `job_worker.py:4949-4962`, not run) | NOCAP-01 | Only matters if a PROD exit is native |

## Open Questions

1. **PROD gate outcome.** What we know: formula and SQL. Unclear: whether both MT5 exits carry a basis. Recommendation: orchestrator runs the SQL before plan 02 executes; on anything but `pass` for both, stop and ask the founder.
2. **Lower bound on the ledger level.** The locked wording is "at or below". Recommendation: keep one-sided, rely on the replay's zero-start check for the other side, and say so in the helper's docstring. Discuss if the founder wants `abs(...)`.
3. **Deribit.** Recommendation: unchanged (A4). Decide with the SQL's Deribit rows in hand.
4. **`no_stored_terminal` as a reason.** A key with no terminal is a route to `dropped_key` not in CONTEXT's list. Recommendation: include it so the closed set covers every route CONTEXT names "every route".
5. **Departed keys and `tiny_base_days`.** Recommendation: read them (same replay). Cheap and consistent; flagged because the ruling speaks of "the key".

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest with pytest-asyncio (`asyncio_mode = auto`), `analytics-service/pytest.ini` |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_no_capital_exit.py tests/test_allocator_equity_inception.py -q -p no:cacheprovider` (measured 28 passed, 39 s) |
| Job subset | `cd analytics-service && python3 -m pytest tests/test_derive_allocator_equity_job.py -k no_capital -q -p no:cacheprovider` (measured 30 passed, 129 deselected, 37 s) |
| Full suite | CI step: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (`ci.yml:5919`), run from `analytics-service/`; locally prefix `python3 -m` and confirm xdist is installed |
| Type gate | `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (`ci.yml:5740`; CI pins mypy 2.4.0, local is 2.0.0) |

### Phase Requirements to Test Map
| Req | Behavior | Test type | Where | Exists |
|---|---|---|---|---|
| NOCAP-01 | funded-ledger MT5 candidate falls back, empty-ledger one exits | job-level | `test_derive_allocator_equity_job.py` (new, beside 4198-4297) | Wave 0 |
| NOCAP-01 | no basis -> refused; negative terminal below `-DUST_NAV_FLOOR` refused; non-MT5 venues unchanged | job-level | same | Wave 0 |
| NOCAP-01 | `LEDGER_PROOF_VENUES == {"mt5"}` pin, `_no_capital_ledger_level` pure cases | unit | `test_allocator_equity_inception.py` style pin / job file | Wave 0 |
| NOCAP-02 | apply-loop `KeyError` and compose `ValueError` revert, across two runs, and via `dispatch` | job-level | job file (beside 4656) | Wave 0 |
| NOCAP-02 | no-candidate compose error still raises; `BaseException` propagates | job-level | job file | Wave 0 |
| NOCAP-03 | field present with exact counts per reason, absent on a clean run, reaches `compose_empty_blocked`, never in `degrade_reasons`, unknown token rejected | compose + job | no_capital_exit file + job file | Wave 0 |
| NOCAP-03 | `refusal_payload` default byte-identical | unit | `test_derive_refusal_rows.py` (existing, must stay green) | exists |
| NOCAP-04 | equality with the no-candidate payload after popping the field (both shapes) | compose | `test_allocator_equity_no_capital_exit.py` (beside 217-279) | Wave 0 |
| ruling | stated tail day not counted; unstated, pre-window and non-tail still counted | replay + compose + job | `test_allocator_equity_inception.py` (beside 209) + job file | Wave 0 |

### Sampling Rate
- Per task commit: the quick command (about 40 s) plus the job `-k no_capital` subset (about 40 s).
- Per wave merge: the whole of `tests/test_allocator_equity_*.py`, `tests/test_e2_*.py`, `tests/test_derive_allocator_equity_job.py`, `tests/test_derive_refusal_rows.py`, plus the strict mypy command.
- Phase gate: full CI-equivalent suite green and mypy strict clean before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] Re-fixture the four MT5 candidate tests listed above (basis with sum at or below the floor, hand-derived).
- [ ] New fixtures: funded-ledger MT5 candidate (probe 1 shape), no-basis MT5 candidate, negative-terminal candidate, missing-terminals hole candidate, stated-tail-day replay book.
- [ ] Pop-the-field helper for the two equality tests at `test_allocator_equity_no_capital_exit.py:240`, `:260`.
- [ ] No framework install needed.

### PROOF-01: the arm to neuter for each gate (RED first, restore with `cp` from a byte backup, `cmp`, GREEN)

Back up each touched source file with `cp` to the scratchpad before neutering; restore with `cp` and verify with `cmp` (never `git checkout`/`stash` on uncommitted work).

| Gate | Neuter this arm | Expected RED |
|---|---|---|
| NOCAP-01 funded MT5 | make `_no_capital_ledger_level`'s caller skip the `_ledger > DUST_NAV_FLOOR` refusal (or return `0.0`) | funded-ledger test sees the key exit, `no_capital_exited_keys` present, `is_trustworthy` True |
| NOCAP-01 no basis | remove the `ledger_basis_absent` refusal | no-basis MT5 key exits |
| NOCAP-01 negative terminal | remove the `< -DUST_NAV_FLOOR` refusal at selection | negative-terminal candidate is composed |
| NOCAP-02 apply loop | delete the apply-loop `except Exception` (or narrow it to `NavReconstructionError`) | `KeyError` escapes `run_derive_allocator_equity_job`; via `dispatch`, `FAILED`/`unknown`, no upsert |
| NOCAP-02 compose | delete the sibling `except Exception` arm | compose `ValueError` escapes; stale row retained |
| NOCAP-03 | skip the writes into `payload["inputs"]` (compose) / the job merge, one arm per reason; and drop the kwarg pass-through to `_persist_refusal` | field absent on fallback payload; absent on `compose_empty_blocked` record |
| NOCAP-04 | restore the unconditional `reasons.add(DegradeReason.KEY_INPUTS_MISMATCH)` for candidates (delete the `segment_refused` branch) | equality test red naming `key_inputs_mismatch` and `no_capital_key_exited` |
| Out-of-window (replay) | drop the `and fd not in stated` clause | tail-day test red: `out_of_window_flow` present |
| Out-of-window (threading) | stop passing `tiny_base_days_by_key` in `_compose` / the compose's pass to the replay | job-level test red |

Whole-tree suites a change here can trip: `test_derive_refusal_rows.py` (refusal fixture and closed sets), the two equality tests above, the AST/grep scanners over `job_worker.py` named under Anti-Patterns, `scripts/verify-plan-anchors.mjs` (the `plan-anchor-verify` CI job re-resolves every `file:line` and named symbol a pending PLAN.md asserts, so cite symbols or re-verify lines at plan time), and the ship-time rules (`VERSION` and `package.json` byte-equal 4-digit strings, a CHANGELOG entry, delete the four closed `TODOS.md` entries in the same PR and name them in the CHANGELOG). The `seam-*` and `*invariant*` TS suites do not read the three S2 files. Not run in this session: the full job-file suite (only the `-k no_capital` subset was timed).

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2/V3/V4 | no | worker-internal compose, no new surface |
| V5 Input Validation | yes | the key_inputs row is worker-written but untrusted: validate days with `date.fromisoformat`, never echo a stored string, closed reason set |
| V7 Error handling / logging | yes | counts and exception class only; no key id, day or USD in any log or payload (T-167.1.2-22, T-166.3.1-34) |
| V6 Cryptography | no | none |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Stored value echoed into logs/payload | Information disclosure | counts and closed tokens only; test that logs contain no key id, day, amount |
| Malformed `tiny_base_days` poisons the book | Denial of service | tolerant reader (A5) |
| Broad `except` hides a real bug | Repudiation | catch only with candidates in play, log the class, re-raise from the stored recompose |

## Project Constraints (from CLAUDE.md)

Directives that bind this phase: public repo, no PROD ids, emails, account numbers or home paths in tracked text (this file and the plans); always `grep -a`; pytest only from `analytics-service/`; `python3 -m pytest` is the working invocation here; mypy strict is part of every analytics-touching check (memory: agent gates include mypy); never `importlib.reload` in tests; neuter-restore with `cp`/`cmp`, never `git checkout`/`stash`; every ship writes a CHANGELOG entry before the push in the same commit as the VERSION bump, and deletes the closed `TODOS.md` entries in the same PR; no skip-CI trailer tokens anywhere (not even to deny them); no AI authorship trailers; PROD reads via MCP only, marker query first, one query per call; 155.2 freeze (re-check `155.2-12-SUMMARY.md` on origin/main at push time: local `origin/main` at the time of reading lists 155.2-10, -15, -16, -17 summaries and no -12); Phase 229's `read_writer_basis` edit is already on this checkout (`read_writer_basis_withheld`, `returns_stamp_*` present), so the dependency holds; `AGENTS.md` ("this is not the Next.js you know") is irrelevant to a Python-only phase.

## Sources

### Primary (HIGH confidence, files read this session)
- `analytics-service/services/job_worker.py`: 294, 374, 562, 1253-1470, 4083-4113, 4905-4962, 8380-8680, 9396-9413, 9515-9580, 9840-9930, 10020-10420, 16640-16820, 17346-18360, 18601-18700
- `analytics-service/services/allocator_equity_compose.py`: 427-1172
- `analytics-service/services/allocator_equity_derive.py`: 90-330, 703-758, 1132-1150, 1285-1700, 1698-2011
- `analytics-service/services/broker_dailies.py`: 724-1125; `services/nav_marks.py`: 95-115, 372-395; `services/native_nav.py`: 660-690, 794-816, 931-970; `services/tiny_base.py`: 99-142; `services/account_unit.py`: 47; `services/nav_twr.py`: 60-75; `services/equity_reconstruction.py`: 589-591
- `src/lib/queries.ts`: 4100-4260, 4300-4360 (TS reader, lenient)
- Tests read: `test_allocator_equity_no_capital_exit.py` (whole), `test_derive_allocator_equity_job.py` 3914-4410, 4640-4760, `test_allocator_equity_inception.py` 30-304, `test_derive_refusal_rows.py` 1-80, `tiny-base-literal-pin.test.ts`
- Probes (scratchpad, run against the working tree, not committed): probe 1 (funded MT5 transient zero exits trustworthy pre-fix), probe 2 (missing-terminals candidate exits with `key_inputs_mismatch`; blocking last segment keeps the residue)
- `git show 5ce61e219:.planning/debug/deribit-stale-returns.md` (233's evidence for the ruling)

### Secondary / not used
- No web or Context7 lookups: the phase is internal code; the research-plan seam was not needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependency)
- Architecture and fix shapes: HIGH (code read, two behaviours reproduced)
- PROD gate: MEDIUM until the SQL runs
- Pitfalls: HIGH

**Research date:** 2026-11-24
**Valid until:** 2026-12-01 (S2 files move with phases 229/233/235; re-measure line anchors at plan time)

## PROD gate result (orchestrator, 2026-11-24)

Marker query run first, alone (names PRODUCTION). The gate SQL above (with a `payload_keys` column added) returned one row: `venue=mt5, reason=nonpositive, native_unit_key=false, outcome=pass, n_exits=2, terminal 0.0..0.0, ledger_level -1.6e-11, max_gap 1.6e-11`. Both live MT5 exits carry `composed_flows` and `composed_day_pnl` and pass the ledger proof. No founder question is needed; execution proceeds.
