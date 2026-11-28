---
phase: "256"
slug: "okxunitswitch-an-okx-account-that-moves-from-usdt-into-a-coi"
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-27"
verdict: SECURED
block_on: high
audited_head: "9ed5cfce3"
---

# Phase 256 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verified by gsd-security-auditor at ASVS L1 (presence of each mitigation at the cited location), with an end-to-end trace of the `key_binding`, closed-token and `ccy`-gate paths. Range audited: `ac12c1e36..9ed5cfce3` over `analytics-service`, `src`, `supabase`. Line numbers are as of head `9ed5cfce3`; cite by symbol if they drift.
> `asvs_level` 1 and `block_on` high are the GSD manifest defaults (`.planning/config.json` has no security keys). Implementation files were read only. This file was written by the audit at the caller's request; the caller owns committing it.

**Verdict: SECURED.** 30 of 31 threats closed; 1 open and non-blocking (T-256-17, medium, below `block_on: high`). Nothing at or above the block threshold is open, so `threats_open: 0`.

Evidence run at the audited head: unit-switch Python suites (5 files) 203 passed; vitest `unit-segments`, `queries.unit-switch`, `unit-switch-readers`, OG route, returns route and public-cache-key tests 135 passed; `node scripts/lint-migration-data-dependence.mjs` 0 NEW. The worktree stayed clean.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| OKX API to worker | bill `ccy`, amounts and balance `details` are third-party text | venue currency codes, amounts |
| stored holdings and closes to builder | stored holdings decide the switch day; `benchmark_prices` closes price each day | symbols, USD values, daily closes |
| worker (service_role) to `strategy_analytics` / `allocator_equity_derived` | the worker writes the flag, the sidecar and the key payload that public pages and owner books read | `unit_switch`, `unit_segments`, `key_inputs` |
| anon / authenticated to `strategy_analytics` | readers reach the new column through the existing RLS | derived returns, switch days |
| database jsonb to SSR payload, OG card, API | stored flag scalars and segments render on public surfaces | coin code, ISO days, return points |
| merge to PROD | migrations auto-apply to TEST then PROD with no human stop | DDL |
| PROD read to tracked text | results of a production read could leak ids or amounts into a public repo | counts, switch days |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation / evidence | Status |
|-----------|----------|-----------|----------|-------------|-----------------------|--------|
| T-256-01 | Tampering | coin code | medium | mitigate | `unit_switch.py:53` `_COIN_CODE_RE = [A-Z]{2,10}`, `fullmatch` at `:320`; `PRICED_SWITCH_COINS = {"BTC"}` `:79` so only a priced coin can switch; refusals are the closed `UNIT_SWITCH_REFUSALS` `:83`; the module has no logger | closed |
| T-256-02 | Information disclosure | test fixtures | medium | mitigate | UUID scan of every added line (tests, src, supabase/tests) and every file in the phase dir: only repeated-digit or `...0256` synthetic ids; no home path; the PROD project ref is absent from the diff and the phase dir | closed |
| T-256-03 | Tampering (integrity) | switch day | high | mitigate | `ambiguous_boundary` `unit_switch.py:361`; an undated coin bill refuses (`exchange.py:1961` `_okx_book_switched_coin` returns False); `split_daily_pnl_at_switch` `:382` puts each day in exactly one unit; boundary oracle and disjoint-union tests green | closed |
| T-256-04 | Information disclosure | `unit_segments` column | medium | mitigate | the phase migration has no POLICY/GRANT/REVOKE statement; `analytics_read` (published or owner) and both deny policies unchanged (`baseline.sql:18313-18323`); apply-time verify DO block re-checks the three policies by name (migration `:168-172`); SQL gate arm 5a (`test_strategy_analytics_unit_segments.sql:211-224`, RED-UNDER `DROP POLICY` twin) and arm 5b (`:227-239`, RED-UNDER `CREATE POLICY` twin) | closed |
| T-256-05 | Tampering | `unit_segments` writes | medium | mitigate | `analytics_insert_deny` / `analytics_update_deny` (`baseline.sql:18313,18323`); object CHECK `strategy_analytics_unit_segments_object_chk` (migration `:93-94`); no client-side writer of `unit_segments` in `src` (single reader `fetch-and-build-payload.ts:324,1112`); the worker is the only writer | closed |
| T-256-06 | Denial of service | PROD deploy | high | mitigate | `SET LOCAL lock_timeout = '3s'` inside BEGIN/COMMIT (migration `:74`); the verify DO block reads only `information_schema`, `pg_constraint`, `pg_policies`, and the data-dependence lint reports 0 NEW; two-PR order held: PR-1 commit `f7c80fb7a` is an ancestor of main and its `supabase-migrate` push run concluded success (TEST then PROD apply) | closed |
| T-256-07 | Information disclosure | new fetch log lines | medium | mitigate | the one new fetch log `exchange.py:2013` carries the resolved coin (BTC only) and two counts; every ccy kept goes through `_OKX_CCY_CODE_RE.fullmatch` (`:2212`, `:4067`, `:4097`; regex `:307`); a blank or malformed code sets `_okx_coin_code_unusable` and refuses fail-closed; no other new log in transforms, broker_dailies, compose or runner | closed |
| T-256-08 | Tampering (integrity) | `daily_pnl` records | high | mitigate | coin bills `continue` before `daily_totals` (`exchange.py:2212-2218`); the resolver gets `stable_by_day` as a read-only copy; gate A test green | closed |
| T-256-09 | Elevation of privilege | other fetch callers | high | mitigate | `unit_switch` defaults to `None` (`exchange.py:2024`, `:3833`); the only caller passing it is `job_worker.py:10182`, and the resolver is built only when `venue == "okx"` (`:6835`); AST call-site pin `test_only_the_derive_may_pass_unit_switch` green | closed |
| T-256-10 | Tampering (integrity) | headline series | high | mitigate | `_usable_close` (`unit_switch.py:373`) and `_usable_closes` (`native_to_usd.py:93`) reject non-finite and non-positive; a missing close names its day in `unpriced_days`, never a neighbour's close (`unit_switch_series.py:232-238`) | closed |
| T-256-11 | Tampering (integrity) | boundary | high | mitigate | `unit_switch_series.py:387` raises on overlapping USD and coin days, with the before/after-S guards at `:241-245`; gate B green | closed |
| T-256-12 | Repudiation | engine defaults | medium | mitigate | `transforms.py:96` `floors: UnitFloors = USD_FLOORS`, forwarded at `:234` and `:281`; existing suites unedited; gate C | closed |
| T-256-13 | Tampering | `parseUnitSwitch` / `parseUnitSegments` | medium | mitigate | unit via `RETURNS_UNIT_RE = /^[A-Z]{2,10}$/` (`returns-unit.ts:24`), strict calendar days (`parseIsoDay`), adjacency, `isFiniteNumber`; every deviation returns null (USD render); runner carry `_validated_unit_switch` (`analytics_runner.py:1449`, used `:2369`) drops extra keys and revalidates | closed |
| T-256-14 | Spoofing (content) | masthead text | low | mitigate | no `dangerouslySetInnerHTML` / `innerHTML` in any changed non-test src file; copy composed only by the `unitSwitch*` composers over validated values | closed |
| T-256-15 | Information disclosure | payload | low | accept | AR-256-01 | closed |
| T-256-16 | Tampering (integrity) | `csv_daily_returns` | high | mitigate | the switched headline is all USD (`job_worker.py` combine site sets `returns, meta = _booked.headline`); `native_unit` is written only for `_mt5_unit.native` (`:12802`); tracer-equality and gate A tests green | closed |
| T-256-17 | Information disclosure | logs and job messages | medium | mitigate | MET for job messages, stamps and markers: detail rides only if in `_UNIT_SWITCH_DETAIL_TOKENS` (`job_worker.py:5139`), enforced in `_refuse_incomplete_read` (`:6599`); `test_the_message_carries_a_closed_token_and_never_the_error_text` (`test_okx_unit_switch_derive.py:675`). NOT MET for logs: five new `logger.warning` calls carry `label=%s` bound to `funding_label`, the internal strategy id or api key id (see R-01) | open (non-blocking) |
| T-256-18 | Denial of service | refusal classification | medium | mitigate | `_UNIT_SWITCH_TRANSIENT_TOKENS` (`job_worker.py:5127`) = holdings, closes, marks and stored-returns reads plus `switch_anchor_unpriced`; every call site derives `permanent=` from it (`:10161`, `:10240`, `:10252`, `:10812`, `:10820`); `stored_segments_malformed` is permanent (SF3-02) | closed |
| T-256-19 | Tampering | stale sidecar | medium | mitigate | the strategy prestamp always writes `"unit_segments": _unit_segments_record` (`job_worker.py:12953`), None when unswitched, so an earlier record cannot survive; `data_quality_flags` is replaced wholesale in the same upsert; gate C green | closed |
| T-256-20 | Tampering (integrity) | cumulative chart | high | mitigate | `chart-configs.ts:495` `resolveUnitSwitchChart`: each segment compounded from 1.00 by `compoundNative` in its own unit, drawn as separate series, comparator cut at S, rebase never crosses S; gate A and vertex tests green | closed |
| T-256-21 | Tampering (integrity) | leverage | medium | mitigate | `FactsheetView.tsx:363` `UnitSwitchLeverageHold` shadows `LeverageContext` at 1x when `payload.unitSwitch != null`; `switchHeld` `:3077`; gate B green | closed |
| T-256-22 | Spoofing (content) | SVG text | low | mitigate | unit codes come only from the validated parser and render as React text nodes inside `<text>` / `<title>` in `TimeSeriesChart.tsx` | closed |
| T-256-23 | Information disclosure | list select | medium | mitigate | `queries.ts:665` adds exactly six `->`/`->>` scalar aliases (three closed fields and their `last_success_` twins), never the blob or the `unit_switch` object; `shapeStoredAnalytics` deletes the six and re-adds only the three that pass `parseUnitSwitch` (`:1081-1087`); exact-set pin test green; no wildcard embed outside the owner-scoped `getMyStrategies` | closed |
| T-256-24 | Tampering | chip / OG text | low | mitigate | the OG route parses through `parseUnitSwitch` before `unitSwitchOgNote` (`route.tsx:353`); the returns route does the same (`route.ts:603-620`); malformed renders nothing | closed |
| T-256-25 | Tampering (cache) | OG cache | medium | mitigate | `page.tsx:420-424` `switchKey` adds `&us=<coin.day.day>` from the parsed switch to the OG URL; it is the only builder of that URL in `src` (grep of `api/og/factsheet` and `OG_CARD_VERSION`); payload cache key bumped to `factsheet-v2-payload-v30` (`:349`); page cache-key test green | closed |
| T-256-26 | Tampering (integrity) | `key_inputs` payload | high | mitigate | `_switched_key_usd` (`job_worker.py:5802`) prices every coin-day figure through `_convert_native_key_to_usd` at that day's stored close; gate A green | closed |
| T-256-27 | Tampering (integrity) | readers | high | mitigate | the switched key's `_native_usd_inputs` holds only `priced_through`, `unpriced_days`, `segment_terminals` (`job_worker.py:10834-10843`), no `native_unit`; `read_native_key_inputs` (`allocator_equity_compose.py:147`) still raises on a malformed field; gate B green | closed |
| T-256-28 | Tampering (integrity) | allocator book | medium | mitigate | unpriced coin days and the USD level before each hole are named via `unpriced_days` / `segment_terminals` (`hole_segment_ends`), validated strictly by the compose reader (ISO days, positive finite non-bool levels, no duplicates); gate C green | closed |
| T-256-29 | Information disclosure | SUMMARY / VERIFICATION | high | mitigate | the SC-5 procedure in `256-10-SUMMARY.md` prints counts, booleans and the two switch days only; the UUID grep over all phase markdown returns nothing; no project ref, home path or amount present | closed |
| T-256-30 | Tampering | wrong database | high | mitigate | the same procedure's step 1 is the marker query verbatim and stops unless it names PRODUCTION, read-only, MCP first; this phase ran no PROD query (SC-5 stays a post-deploy step) | closed |
| T-256-SC | Tampering | npm/pip/cargo installs (plans 01-10) | high | accept | AR-256-02; verified: no `package-lock.json`, requirements or pyproject change in the range; `package.json` differs by the version string only | closed |

*Status: closed / open (non-blocking). Only open threats at or above `block_on` count toward `threats_open`.*

### Open, below the block threshold

| Ref | Threat | Severity | Finding |
|-----|--------|----------|---------|
| R-01 | T-256-17 | medium | Five new `logger.warning` calls in `job_worker.py` (stored record unreadable, stored-returns read failed, holdings read failed, holdings rows skipped, marks read failed) carry `label=%s` bound to `funding_label`, which is the internal strategy id or, in key mode, the api key id. Otherwise they log class names and counts, never venue text or an amount, and the unreadable-record line logs key names and a type, not values. This is the pre-existing convention of the function (18 `label=%s` sites before the phase, 23 now; the variable's own comment calls it a log-only key), so the fix is a decision: accept it as an operator-log label, or drop the label from these five lines. Not accepted here, because the register wording and the audit brief say no ids in logs. |

---

## Focus checks

**`key_binding` (R3-01), every writer and reader.**
- One writer, `_unit_segments_payload` (`job_worker.py:6190`): `"key_binding": _key_binding(api_key_id)` (`:6270`, SHA-256 hex of the key id, `:6182`) and no `api_key_id` field. Called from exactly two sites: key mode into `allocator_equity_derived.payload` (`:11872`) and strategy mode into the `strategy_analytics` prestamp (`:12853`).
- One Python reader, `_read_stored_unit_segments`: compares digests (`:6737`); a record with no `key_binding`, or another key's, is treated as "derive from scratch", never trusted.
- `test_the_stored_record_never_carries_the_raw_key_id` (both modes) asserts the raw id is not in `json.dumps(stored)` and `api_key_id` is not a key; it passes.
- Anon-readable surfaces: the TS side reads `unit_segments` in one place (explicit column list, `fetch-and-build-payload.ts:324`) and `parseUnitSegments` builds a fresh view, so `key_binding` is never forwarded. A quote-aware search of `baseline.sql` (`SETOF`, `to_jsonb(`, `row_to_json(`, `%ROWTYPE`, `"sa".*` and `a.*`) finds no function returning a whole `strategy_analytics` row (the one `SETOF`/`pa.*` hit is `portfolio_analytics`). Key mode's copy lives in `allocator_equity_derived`, which has an owner-only SELECT policy and no anon policy (`baseline.sql:18247`).

**`ccy` gating.** A venue `ccy` reaches a kept value only after `_OKX_CCY_CODE_RE.fullmatch` (bills `exchange.py:2212`, equity share `:4067`, price `:4097`), then `[A-Z]{2,10}` and membership in `PRICED_SWITCH_COINS` in `derive_unit_switch`; a stored record's coin is re-checked by `re.fullmatch(r"[A-Z]{2,10}", ...)` in `_stored_unit_switch`. TS repeats it with `RETURNS_UNIT_RE`.

**Closed token sets.** `_UNIT_SWITCH_DETAIL_TOKENS` is the only path by which text reaches a stamp detail or a job `error_message`; a token outside the set is dropped before use. The log line in `_refuse_incomplete_read` uses the same filtered text.

**RLS unchanged.** The phase migration contains no CREATE/ALTER/DROP POLICY, GRANT or REVOKE. The other migration in the diff range (`20261127130000_cron_destinations_exact`, Phase 242) and the Phase 252 `deribit_txn.py` change belong to other phases and were not audited here.

---

## Accepted Risks Log

No accepted-risks log existed for this phase before this audit; the two entries below were created by it from the PLAN dispositions and are pending the orchestrator's confirmation.

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-256-01 | T-256-15 | `unit_switch` (coin code and two ISO days) and `unit_segments` (derived return points and day lists) are derived returns, readable under `analytics_read` for a published strategy exactly like `returns_series`. An anon reader also sees the unsalted `key_binding` digest of a random UUID, which cannot be inverted but confirms a guess for someone who already holds a key id; key ids are not anon-exposed (Phase 170.6.1.1). | plan disposition (256-05-PLAN), recorded by this audit | 2026-11-27 |
| AR-256-02 | T-256-SC | No plan installs a package; RESEARCH records no new package; verified by diff. | plan disposition (all ten PLANs), recorded by this audit | 2026-11-27 |

---

## Unregistered flags

All ten SUMMARY `## Threat Flags` sections say "None". Surface that appeared in review rounds after the plans were written and has no register entry of its own, each verified above as covered by the threat named: the `key_binding` digest (R2-05 / R3-01; T-256-04, AR-256-01, focus check), the `withheld_days` list (ISO days only; T-256-13, AR-256-01), and the `us=` OG query value (T-256-25). Consider adding `key_binding` as its own threat row if this register is reused.

## Other observations (not threats)

- The owner-only wildcard embed in `getMyStrategies` returns the whole `strategy_analytics` row, `unit_segments` included, to its owner. Owner data to its owner; no cross-tenant path.
- `256-10-SUMMARY.md` records SC-7 (the migration-reviewer and rls-policy-auditor verdicts for plan 02) as not supplied, and SC-5 as a pending post-deploy read. This audit gives independent evidence for the RLS half (no policy statement, verify block and arms 5a/5b present) but does not replace those two reviewers.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-27 | 31 | 30 | 1 (medium, non-blocking) | gsd-security-auditor, ASVS L1 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed (the one open threat is below `block_on: high`)

**threats_open:** 0
