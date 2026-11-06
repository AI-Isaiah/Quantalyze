# Phase 180: BYBITFUNDING - Research

**Researched:** 2026-10-28
**Domain:** Bybit v5 money-movement reads (Unified transaction log, asset transfer/deposit/withdraw record endpoints) feeding the allocator history rebuild and the read-only history probe (ccxt 4.5.88, Python 3.12, `analytics-service/`)
**Confidence:** HIGH on the code seams and the Bybit request shapes; MEDIUM on Bybit behaviour the vendor docs do not state (sort order, how a direct-to-Unified deposit is labelled, classic-account behaviour, retention of the asset endpoints)

Provenance tags used below: `[VERIFIED: file:lines]` = file opened this session, values quoted verbatim; `[CITED: url]` = official Bybit/ccxt documentation fetched this session; `[ASSUMED]` = not verified, needs confirmation. ccxt source was read from the **4.5.88** package (the repo pin, `analytics-service/requirements.txt`: `ccxt==4.5.88`), obtained from a local package cache, not from the 4.5.64 copy in the system site-packages and not from the 4.5.85 copy in the main checkout's venv (tests run against 4.5.85 locally; CI installs 4.5.88). Paths in this file are repo-relative on purpose (public repo, no home paths).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried (not re-asked)**
- Phase 173 D-02: a per-kind count of 0 older than 365 days keeps that kind `unmeasured`; corroboration evidence never opens the gate. The gate reads `ok` only when BOTH a deposit kind and a withdrawal kind older than 365 days are at least 1 (TRADEPAGES gate wording, REVIEW-3 WR-07).
- Phase 173 D-03: the operator step runs the full probe; no transfers-only mode.
- Phase 173 D-05: the summary gate counts readable accounts and lists refused ones.
- UPNLVENUES PD-H / PD-I: a forced rebuild writes only an anchored curve, otherwise refuses by name and writes nothing.
- OKXANCHOR 172: the forced-refusal vocabulary is a closed, pinned set; the probe's redaction contract (labels, counts, booleans, closed tokens, 3-significant-figure ratios, no id/amount/timestamp finer than the run date) stays.
- ROADMAP SC-3: nothing is rebuilt over a shut gate; the founder decides a6's rebuild after the post-deploy probe.

**D-01 - Flow source: the Unified edge.** Founder 2026-10-28, AskUserQuestion: "Unified edge (Recommended)". Option shown: "Read Unified's transaction log TRANSFER_IN/TRANSFER_OUT as the rebuild's Bybit flow source; deposit endpoints stay in the probe as evidence of where the money came from." The rebuild's Bybit flow source is `GET /v5/account/transaction-log` with `accountType=UNIFIED`, types `TRANSFER_IN` and `TRANSFER_OUT` (7-day max window, 50-row page, `nextPageCursor`, documented depth 2 years). Reason: the rebuild anchors on the Unified account only (`_read_bybit_uta_mark`, `services/equity_reconstruction.py`; `allocator_positions.py` prefers the UNIFIED row), so the flows that move its balance are those crossing the Unified edge; this cannot double-count a deposit to FUND plus its FUND->UNIFIED move. The on-chain deposit, internal (off-chain) deposit, withdrawal (`withdrawType=2`), inter-transfer and universal-transfer endpoints are read by the probe as evidence (counts and tokens only) of how the money reached the account (SC-1). **Flagged discretion item:** whether Earn subscribe/redeem and similar transfer-like transaction-log types (for example `ONCHAINEARN_*`, `FLEXIBLE_STAKING_*`, `BONUS_TRANSFER_*`) count as flows is left to research and planning; the choice and its evidence must be written into the plan, not assumed.

**D-02 - Scope: page fix everywhere, new kinds in the rebuild only.** Founder 2026-10-28, AskUserQuestion: "Page fix everywhere, kinds in rebuild (Recommended)". Option shown: "Fix the dropped-page bug at the root for every caller (Bybit's nextPageCursor); add the new flow kinds only to the rebuild/history job and the probe; live NAV/derive kinds booked as a follow-up with its own measurement."
- `fetch_ccxt_transfers` (`services/ccxt_flow_fetch.py`) pages Bybit with `nextPageCursor` for every caller, so no window drops rows past a 50-row page.
- The new flow kinds (D-01) reach `_fetch_and_price_window` (forced rebuild and the reconstruct job) and the probe only. The live NAV / composite derive and broker-dailies Bybit readers keep their current kinds; adding kinds there is booked as a follow-up phase with its own measurement (orchestrator books it).

**D-03 - Key access: refuse by name.** Founder 2026-10-28, AskUserQuestion: "Refuse by name (Recommended)". Option shown: "Per-source unreadable token + master/sub flag in the probe (no ids); rebuild refuses with a new closed reason; gate stays unmeasured with that cause."
- The probe records, per source, a closed token for a source the key cannot read, and a master/sub boolean from `/v5/user/query-api` (`isMaster`), never an id.
- The rebuild refuses with a new closed refusal reason when its flow source cannot be read; never a silent 0 (WR-04: only `NotSupported` is swallowed).
- The gate stays `unmeasured` with that named cause.

**D-04 - Deploys: one phase, one deploy.** Founder 2026-10-28, AskUserQuestion: "One phase, one deploy (Recommended)". Option shown: "Wave 1 probe per-source counts, wave 2 rebuild read with RED tests on the on-chain-only read and on a dropped page, then one approved post-deploy probe of a6 and the founder's rebuild decision."
- Wave 1: the probe's per-source counts (SC-1).
- Wave 2: the rebuild's read, with tests that go RED on the on-chain-only read and on a dropped page (SC-2).
- Operator wave: one founder-approved post-deploy full probe of a6, the gate recorded, then the founder's rebuild decision (SC-3). Operator steps are checkpoint tasks for the orchestrator, never for a dispatched executor.

**Note shown to the founder (recorded):** The existing gate needs BOTH a deposit and a withdrawal older than 365 days. If a6 never moved money out more than a year ago, the gate cannot read `ok` even with a complete read; it then stays `unmeasured` with that named cause, which SC-3 allows.

### Claude's Discretion
- Exact record-field and token names within the probe's vocabulary and redaction contract.
- How the Unified `TRANSFER_IN` / `TRANSFER_OUT` rows map onto the gate's deposit / withdrawal kinds (documented in the plan).
- The Earn / transfer-like types question above (flagged).
- Whether the Bybit cursor paging reuses `walk_paginated` (`services/exchange_pagination.py`) or ccxt's cursor parameter.

### Deferred Ideas (OUT OF SCOPE)
- Adding the new Bybit flow kinds to the live NAV / composite derive and broker-dailies readers, with its own measurement (D-02); orchestrator books the follow-up phase.
- Rebuilding a6: decided by the founder after the post-deploy probe (SC-3), not before.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement ids (ROADMAP: `Requirements: TBD`; phase-local SC ids).

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Read-only measurement (counts and tokens only) names how a6 was funded, per kind and age bucket | Sections "Probe design", "Call budget"; per-source endpoint table; closed vocabulary rules |
| SC-2 | The rebuild's transfer read covers every kind that funds a6 and every page of a window, with a test RED on the on-chain-only read and on a dropped page | Sections "Unified edge read", "Page fix", "Validation Architecture" |
| SC-3 | Post-deploy probe re-reads a6; gate `ok` or `unmeasured` with a named cause; founder decides rebuild | Operator wave only (not for executors); "Gate cause" design |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (project `CLAUDE.md`, `AGENTS.md`, user memory):
- **CI mypy line, verbatim:** `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, run from `analytics-service/` [VERIFIED: .github/workflows/ci.yml:5585]. Every analytics-touching brief and pre-push check carries it.
- **pytest only from `analytics-service/`** (never from the repo root); CI runs `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` [VERIFIED: ci.yml:5743]. Use `grep -a`.
- **Ruff is NOT a CI gate here** [VERIFIED: `grep -c ruff` returns 0 for `analytics-service/pyproject.toml` and `.github/workflows/ci.yml`]. Do not invent a ruff verify step; run it only if a plan wants a style check.
- **Gates that protect data integrity must be able to fail:** neuter, see RED, restore from a **byte backup** (never `git checkout`/`restore`/`stash` on uncommitted work). Money-math oracles are independent invariants.
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry and bumps `VERSION` and `package.json` as byte-equal 4-digit strings in the release commit (`chore(release): vX.Y.Z.B`); never run `npm version`; never write a CI skip token anywhere (commit message, PR body, even to deny it).
- **Ship branch changes nothing under `.planning/`** (check before push).
- **Public repo with tracked `.planning/`:** no secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence.
- **No AI authorship attribution** in commits (no Co-Authored-By / Claude-Session / "Generated with" lines).
- **Banned packages:** none of `react-native-international-phone-number`, `react-native-country-select` are involved; this phase installs no package.
- **PROD:** reads and writes are authorized by the founder, but this phase's executors never touch PROD/TEST/Railway; the post-deploy probe is an orchestrator-run operator step.
- **Cite by symbol, not by line number, in durable prose** (CLAUDE.md `[164.7-CITATION-DRIFT-01]`). Line numbers below are for this session's verification only; plans should anchor on the symbols named beside them (`plan-anchor-verify` re-resolves `file:line` anchors in PLAN.md).
- **Agent gates include mypy** (user memory): put the CI mypy line in every executor brief.

## Summary

The rebuild's Bybit flow source today is `fetch_ccxt_transfers` on `fetch_deposits` / `fetch_withdrawals`: on-chain only, 30-day windows, `inner_cursor = max_ts + 1`, and it never reads `nextPageCursor`. a6 read **0 deposits and 0 withdrawals at every age** with 203467 trades [VERIFIED: 173-03-SUMMARY.md a6 record: `"deposits_in_window":0`, `"withdrawals_older_365d":0`, `"trades_read":203467`, `"read_elapsed_s":1050`, `"failure_class":"none"`], so it was funded by a route the on-chain endpoints do not show. D-01 moves the rebuild's Bybit source to the Unified wallet's own transaction log (`TRANSFER_IN` / `TRANSFER_OUT`), which is exactly the set of events that change the balance the rebuild anchors on, and which cannot double-count an on-chain deposit plus its FUND->UNIFIED move **provided the on-chain read is no longer fed to the replay for Bybit** (replace, do not add).

Everything needed already exists in the repo and is reusable without new packages: `walk_paginated` + `ProviderPaginationContract` (inst-type fan-out = the two log types, 7-day windows with the +1 ms boundary, cursor-authoritative stop, loud ceiling) is exactly what `funding_fetch.fetch_funding_bybit` already does against the **same endpoint** with `type=SETTLEMENT`; the probe's `_TradeRecorder` / `transfers_of_kind` / `bybit_transfers_verdict` can take the Unified rows through the existing `("deposits"|"withdrawals", id, ts)` tuple, so the gate function and its 173 fields need no change of shape; the probe's closed-vocabulary machinery (`_ACCOUNT_VALIDATORS`, `_check_keys`, `assert_sanitized`) and the `FAILURE_CLASSES` / `classify_failure` allow-list give per-source unreadable tokens for free. The page fix is a small change inside the Bybit branch of `fetch_ccxt_transfers`: ccxt 4.5.88 already injects `nextPageCursor` into the `info` of one row of every Bybit page (`add_pagination_cursor_to_result`), which is the same mechanism `_next_page_cursor` in `equity_reconstruction.py` reads for trades.

Four things the plan must get right: (1) the replay must receive **only** Unified `TRANSFER_IN/OUT` rows for Bybit (the old on-chain pair is removed from that branch); (2) the new closed refusal reason is raised in `_fetch_and_price_window` only when `require_anchor` is true and only for the permanent ccxt classes (`AuthenticationError`, `PermissionDenied`, `BadRequest`, the same tuple `classify_exception` calls permanent), while transient errors keep bubbling; (3) the Earn / bonus / PEF types are **not** read as flows in this phase (each type costs 105 more calls; the list is open-ended and the replay has no model for the receipt side), and the plan must say so as a stated limitation with a probe-side census as the evidence for the follow-up; (4) the call budget: flows add roughly 210 calls (about 90 s) against the 450 s of headroom a6 left, so the Bybit flow read should run **before** the trade crawl so a timeout can never lose it.

**Primary recommendation:** Add `services/bybit_unified_flows.py` (one `walk_paginated` walk over `type in (TRANSFER_IN, TRANSFER_OUT)`, 7-day windows, raw `private_get_v5_account_transaction_log`, rows normalised to ccxt-transfer shape); in `_fetch_and_price_window` use it **instead of** `fetch_ccxt_transfers` for `venue == "bybit"`, read **before** trades, raise the new `account_flow_source_unreadable` refusal on permanent venue errors when `require_anchor`; fix `fetch_ccxt_transfers`'s Bybit branch to follow `info["nextPageCursor"]`; extend the probe with per-source evidence reads (own bounds, after the member snapshot) and code-derived `bybit_transfers_cause`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read Bybit Unified `TRANSFER_IN/OUT` rows (7-day windows, cursor paging) | Analytics worker (`services/`) | Venue (Bybit REST GET) | I/O fetch module, same tier as `ccxt_flow_fetch.py` and `funding_fetch.py` |
| Normalise log rows to ccxt-transfer shape, sign and dedup | Analytics worker (pure function inside the fetch module) | - | Pure transform; replay reads `currency` / `amount` / `timestamp` only |
| Bybit cursor paging in `fetch_ccxt_transfers` (all callers) | Analytics worker | Venue | Shared fetch seam used by rebuild, NAV derive, composite derive, probe |
| Replay of deposits/withdrawals into per-day equity | Analytics worker (`_compute_daily_equity`, pure) | - | Unchanged; consumes the rows |
| New closed refusal reason | Analytics worker (`equity_reconstruction.py`) | Database audit (message text only, no SQL pin) | Raised in `_fetch_and_price_window`, recorded by `_forced_refusal_result`; no TS/SQL census of the set exists |
| Per-source evidence counts, `isMaster`, gate cause | Probe script (`scripts/allocator_history_probe.py`) | Venue (GET only) | Read-only measurement; closed vocabulary; printed on the worker only |
| Founder decision on a6's rebuild (SC-3) | Operator (orchestrator checkpoint) | - | Not for executors |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | 4.5.88 (pinned) [VERIFIED: analytics-service/requirements.txt:33 `ccxt==4.5.88`] | Bybit client; raw `private_get_v5_*` methods | Already the repo's venue client; every endpoint needed exists as a method (below) |
| `services.exchange_pagination.walk_paginated` | in repo | Window walk + inst-type fan-out + cursor page loop + ceiling | Funding already runs the same endpoint through it |
| pytest / pytest-asyncio (`asyncio_mode = auto`) | repo dev pins | Tests | `analytics-service/pytest.ini` |

No package is installed or added by this phase, so the Package Legitimacy Gate was not run (nothing to audit). ccxt is the existing pin.

### Raw ccxt methods needed (all GET; names verified in the 4.5.88 package, `ccxt/abstract/bybit.py`)
| Endpoint | ccxt method | ccxt `cost` (x `rateLimit` 20 ms) | Rows key | Id field | Time field |
|----------|-------------|-----------------------------------|----------|----------|------------|
| `/v5/account/transaction-log` | `private_get_v5_account_transaction_log` | 1.66 | `list` | `id` | `transactionTime` |
| `/v5/asset/deposit/query-record` (on-chain) | `private_get_v5_asset_deposit_query_record` | 10 | `rows` | `id` | `successAt` |
| `/v5/asset/deposit/query-internal-record` | `private_get_v5_asset_deposit_query_internal_record` | 5 | `rows` | `id` | `createdTime` |
| `/v5/asset/withdraw/query-record` | `private_get_v5_asset_withdraw_query_record` | 10 | `rows` | `withdrawId` | `createTime` |
| `/v5/asset/transfer/query-inter-transfer-list` | `private_get_v5_asset_transfer_query_inter_transfer_list` | 50 | `list` | `transferId` | `timestamp` |
| `/v5/asset/transfer/query-universal-transfer-list` | `private_get_v5_asset_transfer_query_universal_transfer_list` | 25 | `list` | `transferId` | `timestamp` |
| `/v5/user/query-api` | `private_get_v5_user_query_api` | 5 | `result` | - | - |

Sources: ccxt rows [VERIFIED: ccxt 4.5.88 `async_support/bybit.py` api table `'v5/account/transaction-log': {'cost': 1.66},  # 30/s = 50 / 30`, `'v5/asset/transfer/query-inter-transfer-list': {'cost': 50},  # 1/s`, `'v5/asset/transfer/query-universal-transfer-list': {'cost': 25},  # 2/s`, `'v5/asset/deposit/query-internal-record': {'cost': 5},`, `'rateLimit': 20,`; `abstract/bybit.py:186 private_get_v5_asset_deposit_query_internal_record = ... ('v5/asset/deposit/query-internal-record', 'private', 'GET', {'cost': 5})`]. Row keys, id and time fields [CITED: https://bybit-exchange.github.io/docs/v5/asset/deposit/deposit-record (fields include `id` "Unique ID", `successAt`); .../deposit/internal-deposit-record (`rows`, `id`, `createdTime`, `fromMemberId`); .../asset/withdraw/withdraw-record (`withdrawId`, `createTime`, `withdrawType`); .../asset/transfer/inter-transfer-list and .../unitransfer-list (`list`, `transferId`, `timestamp`, `status`)]. `enableRateLimit` is on for every ccxt client the repo builds [VERIFIED: services/exchange.py:857 `"enableRateLimit": True,`], so raw `private_get_*` calls are throttled by the `cost` column without any extra sleep.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `private_get_v5_account_transaction_log` | ccxt `fetch_ledger` | `fetch_ledger` calls `is_unified_enabled()` (two extra GETs, cached), sends no `accountType`, has no `until` handling (`handle_until_option` is absent from it) and branches to the deprecated contract log for non-UTA. Raw call mirrors `funding_fetch` and keeps the cursor in `result.nextPageCursor`. **Use raw.** |
| `fetch_deposits` for the on-chain page fix | raw `private_get_v5_asset_deposit_query_record` | Raw removes the ccxt `data[0]` cursor-injection and `since` filter dependence, but breaks the many test doubles that set `exchange.fetch_deposits` and the probe's recorder. **Keep `fetch_deposits` + read the cursor from `info`** (same proven mechanism as the trade walk). |

**Version verification:** `pip show ccxt` (system) reports 4.5.64; the main checkout venv imports 4.5.85; the 4.5.88 package was read from a local package cache (`__version__ = '4.5.88'`). Bybit method bodies relied on here (`fetch_deposits`, `parse_transaction`, `add_pagination_cursor_to_result`) were read in 4.5.88 itself.

## Architecture Patterns

### System Architecture Diagram

```
 forced rebuild / reconstruct job                     probe (worker, read-only)
 _fetch_and_price_window(exchange, "bybit", ...)       _probe_member(...)
        |                                                   |
        | 0. age guard (start >= now-730d) else           |  client = _make_exchange_client
        |    BadRequest (existing disposition)            |  _TradeRecorder(client)  [wraps fetch_my_trades,
        v                                                 |    fetch_deposits/withdrawals (non-Bybit rebuild path),
 1. fetch_bybit_unified_flows(exchange, start_ms, now)    |    AND private_get_v5_account_transaction_log]
    walk_paginated: types {TRANSFER_IN, TRANSFER_OUT}     |        |
      x 7-day windows (105) x cursor pages (50 rows)      |        v
      GET /v5/account/transaction-log accountType=UNIFIED |  _read_member -> _fetch_and_price_window (above)
        |                                                 |        |  snapshot calls / transfers / elapsed
        |-- PermissionDenied/Auth/BadRequest + require_anchor      v
        |      -> ForcedRebuildRefusedError("account_flow_source_unreadable")   side measurement (own bounds):
        |-- RateLimit/Network/other -> bubble (transient)  |   query-api -> isMaster, uta (booleans)
        v                                                 |   on-chain deposits | internal deposits |
 2. deposits = IN rows, withdrawals = OUT rows            |   withdrawals(type=2) | inter | universal
    (ccxt-transfer shape; NO fetch_deposits/withdrawals   |   each -> count / older_365d / oldest bucket /
     for Bybit)                                           |   state token (closed)
        v                                                 |        v
 3. trades (existing 7-day crawl, resumable store)        |  _account_record(...) -> emit_record (whitelist
 4. OHLCV, replay (_compute_daily_equity), anchor,        |  + assert_sanitized) -> stdout
    refusal ladder (unchanged)                            |  bybit_transfers_verdict(Unified IN/OUT old counts)
                                                          |  bybit_transfers_cause (code-derived)

 Other callers of fetch_ccxt_transfers (job_worker NAV + composite derives, probe tests): same
 function, Bybit branch now cursor-paged; kinds unchanged (D-02).
```

### Recommended Project Structure
```
analytics-service/
├── services/
│   ├── bybit_unified_flows.py     # NEW: Unified-edge flow read (walk_paginated), row normaliser, type constants
│   ├── ccxt_flow_fetch.py         # EDIT: Bybit branch follows info["nextPageCursor"]
│   └── equity_reconstruction.py   # EDIT: Bybit branch of _fetch_and_price_window; new token in FORCED_REBUILD_ACCOUNT_REASONS
├── scripts/allocator_history_probe.py   # EDIT: recorder, evidence sources, new fields, cause
└── tests/
    ├── _trade_pages.py            # EDIT: add a Bybit transfer/log book double next to VenueTradeBook
    ├── test_bybit_unified_flows.py        # NEW
    ├── test_ccxt_flow_fetch.py            # EDIT: cursor/page RED tests
    ├── test_allocator_history_probe.py    # EDIT
    ├── test_reconstruct_force_rebuild.py  # EDIT: token-set pin 16 -> 17
    └── test_bybit_two_year_window.py      # EDIT: `len(...) == 16` -> 17
```

### Q1 - How to read `/v5/account/transaction-log` over 729 days

**Request shape** [CITED: https://bybit-exchange.github.io/docs/v5/account/transaction-log]: all parameters optional; `accountType` "Set to `UNIFIED`"; `type` "Transaction log type" (a single string, one value per request); `startTime` / `endTime` ms; "If neither time is given, the default range is the last 24 hours. If only startTime is given, 24 hours after it. If only endTime, 24 hours before it. If both are given, the span can be at most 7 days"; `limit` 1-50 default 20; `cursor` = the previous `nextPageCursor`; "The endpoint supports up to 2 years of data"; rate limit 25/s per UID (lowered from 50 on 2026-05-21 [CITED: https://bybit-exchange.github.io/docs/changelog/v5]); the page states **no sort order** and says nothing about classic or UTA 1.0.

**Reuse:** `walk_paginated` is the right driver and `fetch_funding_bybit` is the template (same endpoint, `type=SETTLEMENT`). The contract that carries over [VERIFIED: services/funding_fetch.py:796-814]:
```
    contract = ProviderPaginationContract(
        fetcher="fetch_funding_bybit",
        page_cap=MAX_PAGES,
        on_ceiling="raise",
        ceiling_exc=FundingFetchCeilingExceeded,
        ceiling_label="MAX_PAGES",
        ...
        stop_on_short_page=False,
        ...
        stuck_cursor_is_stop=False,
        ...
        inst_types=("linear", "inverse"),
        gated_inst_types=frozenset(),
        window_max_days=7,  # NEW-C30-01: Bybit caps each request at 7 days
```
For flows the fan-out key is the log `type`: `inst_types=("TRANSFER_IN", "TRANSFER_OUT")` [the two enum values: CITED https://bybit-exchange.github.io/docs/v5/enum, `type(uta-translog)`: "TRANSFER_IN" = "Assets that transferred into Unified wallet", "TRANSFER_OUT" = "Assets that transferred out from Unified wallet"]. The driver's window rule is `next_start = prev_end + 1` with `w_end = min(w_start + window_ms, now_ms)` [VERIFIED: services/exchange_pagination.py `_windows`: `w_end = min(w_start + window_ms, now_ms)` / `w_start = w_end + 1`], the same 7-day span funding already sends to this endpoint. The funding callback's page-shape validation (non-dict response, non-dict `result`, non-list `list` all raise) and its `scrub_freeform_string` logging are the pattern to copy; its row picking order `for key in ("funding", "change", "cashFlow")` is **not** reusable (Bybit sends `""` for unused numeric fields, so `val is not None` would pick an empty `funding`): for transfers read `change`, else `cashFlow`, and treat `""` / `None` / non-finite as absent [VERIFIED: ccxt `fetch_ledger` sample in `async_support/bybit.py` shows `"funding": "",` and `"fee": "0.00000000",` on the same row].

**Params per request** (strings, as funding sends them [VERIFIED: funding_fetch.py:659-667]): `accountType=UNIFIED`, `type=<TRANSFER_IN|TRANSFER_OUT>`, `limit="50"`, `startTime=str(w_start)`, `endTime=str(w_end)`, plus `cursor` when set. No `category` (transfers carry none) [ASSUMED: omitting `category` does not exclude rows with an empty category; it is optional in the docs, but no live call was made].

**Row -> transfer shape.** `change` = "cashFlow + funding - fee" and `cashFlow` = "Cash movement from closing positions, USDC Perp or futures settlement, or transfers" [CITED: transaction-log page]. The sign of a `TRANSFER_IN` / `TRANSFER_OUT` row is **not stated** [ASSUMED: positive in, negative out]. Design: `amount = abs(float(change or cashFlow))`, `type = "deposit"` for `TRANSFER_IN` and `"withdrawal"` for `TRANSFER_OUT` (direction from the requested type, never from the sign); count rows whose sign contradicts the type (probe evidence field) and treat a row with no parseable amount, currency, id or `transactionTime` as an unreadable source (refuse), never a dropped row. Output keys the consumers read: replay reads `currency` (falls back to `code`), `amount`, `timestamp` [VERIFIED: equity_reconstruction.py:1819-1828 `sym = (ev.get("currency") or ev.get("code") or "").upper()` / `amt = float(ev.get("amount") or 0.0)` / `quantities[sym] = quantities.get(sym, 0.0) + amt` for a deposit and `- amt` for a withdrawal]; `ccxt_rows_to_dated_flows` (for the later live-derive follow-up) additionally reads `type` in {`deposit`,`withdrawal`}, `id`, `fee` [VERIFIED: services/ccxt_flows.py `if kind == "deposit": sign = 1.0` / `elif kind == "withdrawal": sign = -1.0`]. Do **not** put a key named `kind` on the row: the replay builds events as `{"kind": "deposit", **d}` [VERIFIED: equity_reconstruction.py:1548] so a `kind` key would overwrite it.

**Non-UTA key.** ccxt maps retCode `'10020': PermissionDenied,  # {"retCode":10020,"retMsg":"your account is not a unified margin account, please update your account"...` [VERIFIED: ccxt 4.5.88 bybit.py exceptions table] and `'10005': PermissionDenied`, `'10003'/'10004'/'10007': AuthenticationError`, `'10001': BadRequest`, `'10006': RateLimitExceeded`. What the transaction-log endpoint returns for a classic account is not documented [ASSUMED: one of those]. The account-mode page says classic mode "is now unavailable" and the UTA-log endpoint "applies to UTA 2.0" [CITED: https://bybit-exchange.github.io/docs/v5/acct-mode, via summary], so classic accounts are an edge case; the probe records `uta` from `/v5/user/query-api` (`uta`: `0` regular, `1` UTA [CITED: https://bybit-exchange.github.io/docs/v5/user/apikey-info]) as a boolean so a non-UTA a6 is visible. UTA 1.0's inverse book sits in a separate CONTRACT account the Unified totals do not contain [VERIFIED: equity_reconstruction.py `_read_bybit_uta_mark` docstring: "under UTA 1.0 the inverse book sits in a separate ``CONTRACT`` account that the UNIFIED totals do not contain"], which is consistent with anchoring on Unified only.

**Call count.** 729 days + time of day, in 7-day windows, is **105 windows** per type (104 full windows cover 728 days; the remainder is the 105th) -> **210 calls** before paging; sparse transfers add almost no pages.

### Q2 (flagged) - Other log types that move money across the Unified edge

The enum has 69 `type(uta-translog)` values [CITED: https://bybit-exchange.github.io/docs/v5/enum]. Those that cross the Unified boundary without a market trade, from the descriptions:
- **Transfer:** `TRANSFER_IN`, `TRANSFER_OUT` (the D-01 pair).
- **Earn / staking / products** (value leaves or returns to the wallet while remaining the user's asset): `FLEXIBLE_STAKING_SUBSCRIPTION` / `_REDEMPTION` / `_REFUND`, `FIXED_STAKING_SUBSCRIPTION` / `_REFUND`, `ONCHAINEARN_SUBSCRIPTION` ("tranfer out for on chain earn") / `_REDEMPTION` ("tranfer in for on chain earn") / `_REFUND`, `STRUCTURE_PRODUCT_SUBSCRIPTION` / `_REFUND`, `CLASSIC_WEALTH_MANAGEMENT_SUBSCRIPTION`, `PREMIMUM_WEALTH_MANAGEMENT_SUBSCRIPTION` / `_REFUND` (sic), `LIQUIDITY_MINING_SUBSCRIPTION` / `_REFUND`, `PWM_SUBSCRIPTION` / `_REFUND`, `BYUSDT_MINT` / `_REDEMPTION`, `FIXED_SAVING_PRINCIPAL_REDEMPTION`, and (changelog) `DEFI_INVESTMENT_SUBSCRIPTION` / `_REFUND` / `_REDEMPTION` [CITED: changelog 2025-07-16].
- **Account moves with no description:** `PEF_TRANSFER_IN`, `PEF_TRANSFER_OUT`, `BONUS_TRANSFER_IN`, `BONUS_TRANSFER_OUT`.
- **Not flows (income or P&L-like):** `BONUS` ("Bonus claimed"), `BONUS_RECOLLECT`, `AIRDROP`, `FEE_REFUND`, `INTEREST`, `SETTLEMENT`, `DELIVERY`, `LIQUIDATION`, `ADL`, `TRADE`, `CURRENCY_BUY/SELL`, borrow/repay types, `PEF_PROFIT_SHARE`.
- **Custody / loans / institution loan types** (`CUSTODY_*`, `LOANS_*`, `*_INS_LOAN`): business lines a retail key does not use [ASSUMED].
- Types are added over time (changelog: 2025-06-24, 2025-07-16, 2025-09-15, 2025-10-23, 2026-08-11) [CITED], so any fixed list is open-ended.

**Recommendation (prescriptive):**
1. The rebuild reads **`TRANSFER_IN` and `TRANSFER_OUT` only** (the D-01 literal), as a module constant in `services/bybit_unified_flows.py` so a follow-up can extend it in one place.
2. The Earn / staking / products / PEF / bonus-transfer types are **not flows in this phase.** Evidence: (a) `type` is a single value per request, so each added type costs 105 more calls (about 45 s); 25 types is about 2600 calls, roughly 20 minutes, which alone exceeds the 450 s of crawl headroom; (b) the list is open-ended; (c) reading the log without a type filter would also read every `TRADE` row (a6 has 203467 trades) and double the crawl; (d) bonus, airdrop, fee refund, interest are income, not flows. Write the limitation into the plan in these words: by D-01's own edge logic an Earn subscription is a flow out of the Unified wallet, so an account that used Earn gets a replay whose level is off by the staked amount while it is staked; the anchor offset spreads that difference, and the 5x implausibility bound is the only backstop.
3. **Probe-side census (recommended, planner may cut):** one aggregate count `bybit_other_transfer_like_rows` over a closed tuple of the highest-signal candidates (`ONCHAINEARN_SUBSCRIPTION`, `ONCHAINEARN_REDEMPTION`, `FLEXIBLE_STAKING_SUBSCRIPTION`, `FLEXIBLE_STAKING_REDEMPTION`, `BONUS_TRANSFER_IN`, `BONUS_TRANSFER_OUT`, `PEF_TRANSFER_IN`, `PEF_TRANSFER_OUT`), run as a side measurement after the member snapshot with its own bound (8 x 105 = 840 calls, about 6 minutes). A non-zero count is the evidence for the follow-up phase and a reason for the founder to hold a6's rebuild at SC-3. It never feeds the gate.

### Q3 - Page fix (`fetch_ccxt_transfers`)

**The bug, verbatim.** [VERIFIED: services/ccxt_flow_fetch.py:114-116 and 137-142]
```
                page = await fetcher(
                    None, inner_cursor, page_limit, {"until": window_end}
                )
...
            max_ts = max(
                (int(r.get("timestamp") or 0) for r in page), default=inner_cursor
            )
            if max_ts <= inner_cursor or max_ts >= window_end:
                break
            inner_cursor = max_ts + 1
```
ccxt sorts every parsed transaction list **ascending** by timestamp [VERIFIED: ccxt 4.5.88 `base/exchange.py` `parse_transactions`: `result = self.sort_by(result, 'timestamp')`], so `max_ts` is the newest row of the page. If Bybit returns a window newest-first (the repo's own trade walk assumes the cursor sits on the newest row [VERIFIED: equity_reconstruction.py:709-717 `_next_page_cursor` docstring: "the newest row of the page, after ccxt's ascending re-sort"]; the docs state no order), page 1 holds the newest 50 rows, `inner_cursor = newest + 1`, the next call returns nothing, and every older row of the window is dropped. This is `173-RESEARCH` A6, still unproven live [ASSUMED: newest-first for the deposit/withdraw record endpoints]. The fix is correct under either order.

**Where ccxt puts the cursor** [VERIFIED: ccxt 4.5.88 `async_support/bybit.py`]:
```
    def add_pagination_cursor_to_result(self, response: dict) -> list[object]:
        result = self.safe_dict(response, 'result', {})
        data = self.safe_list_n(result, ['list', 'rows', 'data', 'dataList'], [])
        paginationCursor = self.safe_string_2(result, 'nextPageCursor', 'cursor')
        dataLength = len(data)
        if (paginationCursor is not None) and (dataLength > 0):
            first = data[0]
            first['nextPageCursor'] = paginationCursor
```
`fetch_deposits` / `fetch_withdrawals` call it, then `parse_transactions`, and `parse_transaction` returns `'info': transaction` and `'id': self.safe_string_2(transaction, 'id', 'withdrawId')`. So the cursor is on `info["nextPageCursor"]` of exactly one returned row, found by scanning (the existing helper scans). `params["cursor"]` is passed through `self.extend(requestUntil, paramsUntil)`, and `until` becomes `endTime` via `handle_until_option` [VERIFIED: same file, `fetch_deposits` body].

**Design (Bybit branch only; Binance/OKX stay byte-identical):**
- Window loop as today; inside a window: first call without `cursor`, then `params={"until": window_end, "cursor": <cursor>}` while a cursor is returned; stop on no cursor or empty page. Request `limit` 50 for Bybit (docs `[1, 50]`; the current 500 is evidently tolerated since a6 finished with `failure_class` `none`, but 50 is the documented value [ASSUMED: tolerated by clamping]).
- Cursor helper: a small private function in `ccxt_flow_fetch.py` equivalent to `_next_page_cursor` (do not import `equity_reconstruction`: it imports this module [VERIFIED: equity_reconstruction.py:58 `from services.ccxt_flow_fetch import _rate_limit_sleep, fetch_ccxt_transfers`]).
- A **repeated cursor** is a stall: raise (loud), do not break silently. A page ceiling keeps the existing loud warning path.
- Keep the id dedup. Deposit rows now document an `id` ("Unique ID" [CITED: deposit-record page]); the old A3 worry (the ccxt sample comment shows no `id`) is therefore weaker but still unverified live. Rows without an id stay as they are today (no key is invented).
- ccxt's `since` filter (`filter_by_since_limit`: keeps rows with `timestamp >= since`) can drop the one row carrying the cursor only if that row's `successAt`/`createTime` is missing or below `since`; if a non-empty raw page loses its cursor row, the walk ends silently. Mitigation: none needed for the proven trade walk, which shares the mechanism; a test should pin that a page with a cursor on its newest row continues.

**Callers and what the fix changes** (D-02 "every caller"; all go through the same function, the Bybit branch is keyed on `exchange.id == "bybit"`):
| Caller | Venue(s) | Effect of the page fix |
|--------|----------|------------------------|
| `equity_reconstruction._fetch_and_price_window` (forced rebuild, reconstruct job) | Bybit now uses the Unified read instead (below); non-Bybit unchanged | none for Bybit after the branch change; unchanged for others |
| `job_worker` NAV derive (`fetch_ccxt_transfers(ctx.exchange, "deposits", _flow_since_ms, now_ms)` ~7342, wrapped in `asyncio.wait_for`) | ccxt venues incl. Bybit | busy Bybit keys (>50 on-chain transfers in a 30-day window) now return all rows, so the live derive's flow list grows; **intended and visible in live NAV/TWR** - the SUMMARY must say so |
| `job_worker` composite derive (~10800) | ccxt venues incl. Bybit | same |
| `okx_archive_job` (~1693) | OKX only | none |
| `broker_dailies` | docs only (flows are threaded by job_worker) | none |
| probe | via the rebuild | none (probe no longer sees on-chain rows from the rebuild's own read for Bybit) |

**RED tests (design).**
1. *Dropped page, on-chain:* a Bybit double (`id == "bybit"`) whose `fetch_deposits(code, since, limit, params)` serves a window of 120 rows **newest-first, 50 per page**, honours `params["until"]` and `params["cursor"]` (opaque offset), returns the rows ascending (as ccxt would) and puts `info["nextPageCursor"]` on the newest returned row while more remain. Assert all 120 ids come back and exactly 3 calls were made for that window. On the unfixed code this returns 50 -> RED (neuter proof: restore the `max_ts + 1` advance for the Bybit branch). Existing doubles are ascending (`_make_capped_transfer_fetcher` returns `matching[:cap]` sorted ascending) and model Bybit wrongly; keep them for OKX/Binance and add the newest-first double for Bybit [VERIFIED: tests/test_exchange_pagination.py `_make_capped_transfer_fetcher`].
2. *Stuck cursor:* the double repeats the cursor -> the call raises (not a truncated list).
3. *Unified dropped page:* the same shape against `private_get_v5_account_transaction_log` (`{"retCode": 0, "result": {"list": [...], "nextPageCursor": "..."}}`), 120 `TRANSFER_IN` rows in one 7-day window -> 120 rows; neuter by ignoring `nextPageCursor` -> 50 -> RED.
4. *On-chain-only read:* see Q4.

### Q4 - Scope fence and double counting in `_fetch_and_price_window`

Current code [VERIFIED: services/equity_reconstruction.py:4141-4150]:
```
    transfers_since_ms = start_ms
    if hit_terminus:
        okx_terminus_ms = now_ms - OKX_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000
        transfers_since_ms = max(start_ms, okx_terminus_ms)
    deposits = await fetch_ccxt_transfers(
        exchange, "deposits", transfers_since_ms, now_ms
    )
    withdrawals = await fetch_ccxt_transfers(
        exchange, "withdrawals", transfers_since_ms, now_ms
    )
```
`hit_terminus` is OKX-only (`_fetch_trades_with_pagination` returns `False` for Bybit: `return await _fetch_bybit_trades(exchange, since_ms, now_ms), False`), so for Bybit the transfer start is `start_ms`, 729 days back at UTC midnight.

**Design:** an explicit Bybit branch (`venue.lower() == "bybit"`) that builds `deposits` / `withdrawals` **only** from the Unified read and calls neither `fetch_deposits` nor `fetch_withdrawals`. This is the double-count answer: with the Unified edge as the source, an on-chain deposit to FUND is not a Unified balance change until the FUND->UNIFIED move, which is itself the `TRANSFER_IN` row. Feeding both would add the money twice (the replay adds every deposit's `amount` to `quantities`). Confirmed: the replay is a pure quantity ledger and has no notion of "already counted". Non-stable coins: the symbol set is built from the flow rows (`for lst in (deposits, withdrawals): ... if s and s not in STABLECOINS: symbols.add(s)` [VERIFIED: equity_reconstruction.py:4158-4162]) and priced by `_fetch_ohlcv_daily(exchange, f"{sym}/USDT", ...)` with the CoinGecko fallback, so Unified `TRANSFER_IN` of a non-stable coin is priced exactly as an on-chain one was.

**Scope fence:** only `_fetch_and_price_window` changes. The live NAV / composite derives and `broker_dailies` keep `fetch_ccxt_transfers` kinds (D-02). The probe imports `er._fetch_and_price_window`, so it sees the change automatically.

**RED test for the on-chain-only read.** Build a Bybit exchange double (`id = "bybit"`) whose `fetch_deposits` returns one on-chain deposit and whose `private_get_v5_account_transaction_log` returns one `TRANSFER_IN` of a different coin/amount/id; spy on `_compute_daily_equity` (pattern: `tests/test_trade_pages.py` replaces `er._compute_daily_equity` with a spy that records its `trades_in` argument; record `deposits` and `withdrawals` too). Assert `deposits` is exactly the Unified row (and the on-chain row is absent), `withdrawals` is the Unified `TRANSFER_OUT` row, the log was requested with `accountType` `UNIFIED` and both types over tiled 7-day windows, and `fetch_deposits` / `fetch_withdrawals` were never awaited. Reverting the Bybit branch to `fetch_ccxt_transfers` makes the first assertion fail -> RED. Many existing Bybit doubles are `AsyncMock()` objects with only `fetch_deposits`/`fetch_withdrawals` set (e.g. `tests/test_trade_pages.py` sets `exchange.fetch_deposits = AsyncMock(return_value=[])`); `AsyncMock().private_get_v5_account_transaction_log` returns a non-dict, which the new reader must (correctly) reject, so those doubles need a shared empty-log helper (Wave 0 gap).

### Q5 - New closed refusal reason, and distinguishing permanent from transient

**Current sets** [VERIFIED: services/equity_reconstruction.py:2576-2592]:
```
FORCED_REBUILD_ACCOUNT_REASONS: Final[frozenset[str]] = frozenset(
    {
        "account_state_unreadable",
        "account_identity_pending",
        "account_key_venue_unsupported",
        "account_key_not_working",
        "account_key_read_failed",
        "account_key_no_rows",
        "account_sum_empty",
        "account_keys_changed",
        "history_days_unreproduced",
        "account_key_read_stalled",
    }
)
FORCED_REBUILD_REFUSAL_REASONS: Final[frozenset[str]] = (
    FORCED_REBUILD_ANCHOR_REASONS | FORCED_REBUILD_ACCOUNT_REASONS
)
```
Add one token to the **account** set. Proposed name: `account_flow_source_unreadable` (lower_snake, the raise-site scan regex is `[a-z_]+`). It makes the set 17.

**Where it is raised.** In `_fetch_and_price_window`, around the Unified read only, with `require_anchor` true:
```
try:
    deposits, withdrawals = await fetch_bybit_unified_flows(exchange, start_ms, now_ms)
except (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest, <malformed/stall error>):
    if require_anchor:
        raise ForcedRebuildRefusedError("account_flow_source_unreadable") from None
    raise
```
The tuple is `classify_exception`'s permanent set [VERIFIED: services/job_worker.py:1265-1269 `if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest)): return ("permanent", str(exc)[:500])`]; `NetworkError` / `RequestTimeout` / `RateLimitExceeded` are transient there and must keep bubbling (the whole-account crawl turns them into `_AccountCrawlRetryableError`, and `_crawl_account_key` stamps a 429 on `RateLimitExceeded` [VERIFIED: equity_reconstruction.py:6217-6219]). `ForcedRebuildRefusedError` is caught before the generic arm and `_forced_refusal_result` records it with static text [VERIFIED: equity_reconstruction.py:6642-6650]. The literal must appear as `ForcedRebuildRefusedError("account_flow_source_unreadable")` because the raise-site scan reads source text: `raised = set(re.findall(r'ForcedRebuildRefusedError\(\s*"([a-z_]+)"\s*\)', source))` [VERIFIED: tests/test_reconstruct_force_rebuild.py raise-site equality].

**Keep the 730-day age guard outside the wrapped call.** `_fetch_bybit_trades` raises `ccxt.BadRequest` before any request when `since_ms < now_ms - BYBIT_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000` [VERIFIED: equity_reconstruction.py:894-907]. If the flow read runs first (below), apply the same guard before it and outside the `try`, so a crawl begun after UTC rollover keeps its existing disposition (`account_key_read_failed` through the gather converter) rather than being mislabelled as an unreadable flow source. Whether the transaction log has the same 730-day bound is [ASSUMED] (docs say "up to 2 years").

**Unforced path.** `ForcedRebuildRefusedError` is "raised ONLY on the forced path" and the unforced reconstruct job catches it in the same dedicated arm, so the new raise is gated on `require_anchor`; unforced, the venue exception propagates to the generic classifier (permanent -> job fails, nothing written). This changes the first-backfill behaviour for a Bybit key whose Unified log cannot be read (it used to proceed on the on-chain read). See Open Question 2.

**Token pins to move together** (the closed-vocabulary rule), found by grep of `analytics-service/`, `src/`, `supabase/`, `scripts/`, `docs/`, `.github/`:
- `tests/test_reconstruct_force_rebuild.py`: the `account` frozenset literal, `assert len(anchor) + len(account) == 16`, the raise-site equality scan.
- `tests/test_bybit_two_year_window.py`: `assert len(er.FORCED_REBUILD_REFUSAL_REASONS) == 16` (and its docstring).
- `tests/test_allocator_history_probe.py`: derived (`_SELECTION_TOKENS` / `_REFUSAL_TOKENS` are built from `er.FORCED_REBUILD_REFUSAL_REASONS` [VERIFIED: probe lines 193-194]); the existing test emits every token, so no edit is required, only a docstring note.
- `docs/runbooks/marksource-okx-history-correction.md` B'3 lists the tokens by name and says "15 tokens" (already stale at 16): add the new token to the "record only, no re-run" list (it clears only when key permissions change) and fix the count.
- No TypeScript, SQL or CI census of the set exists [VERIFIED: grep of `src`, `supabase`, `scripts`, `.github` for the other tokens found only the SQL RPC's own `history_days_unreproduced` raise, which is not a vocabulary pin].

**Probe tokens and booleans (D-03).** `/v5/user/query-api` already feeds `account_identity` and `key_permissions` [VERIFIED: services/account_identity.py `raw = await exchange.private_get_v5_user_query_api()`]. The probe makes its own call and keeps only two booleans: `isMaster` ("If this api key belongs to master account or not" [CITED: apikey-info page]) and `uta` (`0`/`1`). Read them strictly (`is True` / `is False` / else `field-absent`); never store `userID` or `parentUid`. Per-source state uses the existing allow-list: `scripts.bybit_upnl_probe.FAILURE_CLASSES` = `none, AuthenticationError, PermissionDenied, RateLimitExceeded, RequestTimeout, NetworkError, BadRequest, ExchangeError, EmptyResponse, Timeout, other` and `classify_failure(exc)` (never reads the message) [VERIFIED: scripts/bybit_upnl_probe.py:100-112 and 487-510]. Master-only sources (withdraw-record: "Can query by the master UID's api key only" [CITED: withdraw-record page]) are skipped with an explicit `not-master` state when `isMaster` is `False`, not called and mislabelled.

### Q6 - Probe wave 1: per-source counts, fields, recorder, gate mapping

**What the rebuild's own read records.** `_TradeRecorder` wraps `fetch_my_trades`, `fetch_deposits`, `fetch_withdrawals` and stores `(kind, id, timestamp)` tuples with `kind` in `{"deposits","withdrawals"}` [VERIFIED: scripts/allocator_history_probe.py:640-655]. After this phase the Bybit rebuild no longer calls `fetch_deposits`, so the recorder must also wrap `client.private_get_v5_account_transaction_log`: for calls whose `type` param is `TRANSFER_IN` / `TRANSFER_OUT` append `("deposits"|"withdrawals", row["id"], int(row["transactionTime"]))` for each raw `result.list` row (ids and stamps stay in memory), leaving every other call (e.g. the funding SETTLEMENT read, if ever on this client) untouched and handing the answer back unchanged. Everything downstream (`transfers_older_than`, `transfers_of_kind`, `oldest_transfer_ms`, the 173 fields `deposits_older_365d`, `withdrawals_older_365d`, `deposits_in_window`, `withdrawals_in_window`, the three oldest-age buckets, the two fill-before booleans, and `bybit_transfers_gate`) then describes the **Unified edge**. **The gate function is unchanged:** `bybit_transfers_verdict` returns `ok` only when `deposits_old >= 1 and withdrawals_old >= 1` [VERIFIED: allocator_history_probe.py:908-912 `if bybit_members < 1 or window_days != er.BYBIT_TRADE_TERMINUS_DAYS: return "not-applicable"` / `if deposits_old >= 1 and withdrawals_old >= 1: return "ok"` / `return "unmeasured"`]. Mapping: `TRANSFER_IN` -> deposit kind, `TRANSFER_OUT` -> withdrawal kind; the carried rule (BOTH older than 365 days) is untouched. The docstrings of these fields (probe header and `_probe_account` comments saying "on-chain only") must be rewritten to say "Unified edge" and carry a lineage note that 173's 2026-10-28 reading was on-chain.

**Evidence sources (not the rebuild's read; probe only).** Five GET sources read after the member snapshot, same pattern as `_okx_order_reading` (a side measurement that never changes a member's outcome, recorded by allow-listed class):
| Source id | Endpoint | Window | Status filter for "counted" | Master-only |
|-----------|----------|--------|------------------------------|-------------|
| `onchain_dep` | deposit/query-record | 30 days | `status == 3` ("3: ok" in ccxt's map) | no |
| `internal_dep` | deposit/query-internal-record | 30 days | `status == 2` (1 processing, 2 success, 3 failed [CITED]) | no |
| `withdraw_all` | withdraw/query-record with `withdrawType=2` ("all") | 30 days | `status` success | **yes** |
| `inter_xfer` | transfer/query-inter-transfer-list | 7 days | `SUCCESS` | no |
| `universal_xfer` | transfer/query-universal-transfer-list | 7 days | `SUCCESS` | key needs `SubMemberTransfer` (master) / `SubMemberTransferList` (sub) [CITED] |
Windows: "endTime - startTime should be less than 30 days" for the three record endpoints, "maximum allowed range is 7 days" for the two transfer lists [CITED: respective pages]. Use `walk_paginated` with `inst_types=()` and `window_max_days` 30 or 7, cursor-authoritative, `on_ceiling="flag"`/`"raise"` (a flag must surface as a state token, never silently complete).

**Proposed record fields** (names avoid the deny substrings `secret`, `token`, `api_key`, `apikey`, `password`, which `assert_sanitized` rejects in KEYS [VERIFIED: scripts/deribit_ground_truth.py:334-340 `_DENY_KEY_SUBSTRINGS = ("secret","token","api_key","apikey","password")`], and any string value of 40+ chars of `[A-Za-z0-9+/=_-]` [VERIFIED: same file `_LONG_TOKEN_RE = re.compile(r"[A-Za-z0-9+/=_-]{40,}")`]; keep every closed value under 40 characters). For each source id `S` in {`onchain_dep`,`internal_dep`,`withdraw_all`,`inter_xfer`,`universal_xfer`}:
- `bybit_S_rows` (count, distinct ids, in window), `bybit_S_older_365d` (count), `bybit_S_oldest_age_bucket` (the existing `_WINDOW_AGE_BUCKETS`), `bybit_S_state` (closed: `not-run`, `read`, `not-master`, plus the `FAILURE_CLASSES` minus `none`).
- Unified edge: `bybit_unified_state` (derived from the member's outcome: `read`, `refused`, or a failure class), `bybit_unified_sign_mismatch_rows` (count), and the existing 173 per-kind fields carry its counts.
- `bybit_is_master`, `bybit_is_uta` (`_is_bool_or_absent`).
- Optional census: `bybit_other_transfer_like_rows` (count or `field-absent`).
- Code-derived `bybit_funding_explained`: `explained` when Unified `TRANSFER_IN` rows >= 1; `unexplained` when the member read trades but no source shows a funding row; `unmeasured` otherwise; `not-applicable` for non-Bybit. SC-1's "a source still unnamed" is the `unexplained` case.
- Code-derived `bybit_transfers_cause`, next to the gate (D-03 "gate stays unmeasured with that named cause"): `none` (gate ok), `no_deposit_older_365d`, `no_withdrawal_older_365d`, `neither_older_365d`, `flow_source_unreadable` (member refused with the new token or the Unified state is a failure class), `read_incomplete` (member failed/truncated/timed out), `not-applicable`. The summary's roll-up stays as is; the cause is per account.
Adding fields means editing `ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS` and `_account_record` defaults together (`test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` asserts `set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))`). Non-Bybit accounts carry defaults (`0`, `none`, `not-run`, `field-absent`).

**Probe pins that bite** [VERIFIED: tests/test_allocator_history_probe.py]: `test_the_probe_source_calls_no_venue_write` forbids `\b(create_order|cancel_order|withdraw|transfer)\(` anywhere in the probe source (so no helper may be spelled `withdraw(` / `transfer(`; names such as `_read_withdraw_all` are fine) and `private_(post|put|delete)_`; `test_every_rebuild_name_the_probe_reads_is_declared` requires every `er.<name>` the probe reads to be in `DEPLOYED_ER_NAMES`, sorted (import the new module's constants directly, not through `er`); `test_the_probe_names_only_the_two_tables_it_reads`.

**Redaction.** Only counts, booleans, buckets, closed tokens leave the process; no id, amount, timestamp finer than the run date, `userID`, `parentUid`, `fromMemberId`. `emit_record` validates against the declared vocabulary then `assert_sanitized`. A test must assert a fake id planted in a stub row never appears in `captured.out + captured.err` (the existing pattern: `assert "fake-transfer" not in captured.out + captured.err`).

### Q7 - Time budget, call counts, rate limits

Measured: a6 `trade_calls` 2160, `read_elapsed_s` 1050 [VERIFIED: 173-03-SUMMARY.md a6 record], `_RECONSTRUCT_CRAWL_TIMEOUT_S` default 1500 [VERIFIED: equity_reconstruction.py:179-181 `float(os.getenv("RECONSTRUCT_CRAWL_TIMEOUT_S", "1500"))`], so headroom is about 450 s; the 1050 s already includes the old transfer pair, OHLCV and the anchor. Derived per-call latency about 0.4 s (2160 calls / 1050 s less ccxt throttle) [ASSUMED estimate].

| Read | Calls | Throttle per call (cost x 20 ms) | Est. wall time |
|------|-------|----------------------------------|----------------|
| Unified TRANSFER_IN + OUT, 105 windows x 2 | 210 | 33 ms | about 90 s |
| (removed) on-chain deposits + withdrawals, 25 windows x 2 | -50 | 200 ms | about -30 s |
| Probe: on-chain deposits | 25 | 200 ms | about 15 s |
| Probe: internal deposits | 25 | 100 ms | about 13 s |
| Probe: withdrawals type 2 | 25 | 200 ms | about 15 s |
| Probe: inter-transfers | 105 | **1000 ms** (`cost` 50; UID limit 60/min [CITED rate-limit page]) | about 150 s |
| Probe: universal transfers | 105 | 500 ms (UID limit 5/s) | about 95 s |
| Probe: candidate census (optional) | 840 | 33 ms | about 6 min |

UID limits [CITED: https://bybit-exchange.github.io/docs/v5/rate-limit]: transaction-log (UNIFIED) 25/s, inter-transfer list 60 req/min, universal list 5/s, deposit query-record 100 req/min, internal deposit 300/s, withdraw query-record 300 req/min, `query-api` 10/s; IP 600 per 5 s; a UID breach is retCode 10006 ("Too many visits!"), which ccxt raises as `RateLimitExceeded` (transient). The walks are sequential, so latency keeps the real rate well below every limit; the ccxt throttle is already tighter than the documented limits for the asset endpoints. Note ccxt 4.5.88 still budgets transaction-log at 30/s while Bybit lowered it to 25/s on 2026-05-21; irrelevant at about 2 calls/s.

**Keeping the flows from being lost to a timeout.** The hard bound is one `asyncio.wait_for(..., _RECONSTRUCT_CRAWL_TIMEOUT_S)` around the whole `_fetch_and_price_window`; the soft claim budget `_TRADE_READ_CLAIM_BUDGET_S` (900 s default [VERIFIED: equity_reconstruction.py `budget = 900.0 if raw is None else float(raw)`]) is only checked before storable trade windows, and only for runs under a trade-read scope (the probe has none). Recommendation, with evidence:
1. **Read the Bybit flows before the trade crawl** (inside the Bybit branch). Cost: about +90 s per claim in the job path (the flows are re-read each claim; the trade windows are stored, the flows are not) and they count against the soft claim budget. Gain: a missing permission is found in seconds instead of after a 17-minute trade crawl; the flows are immune to a slow trade crawl; and the flow read starts about 17 minutes earlier relative to the Bybit two-year depth edge (the oldest window's age grows with elapsed time; a crawl crossing UTC midnight is already refused, and the probe runs "no later than 23:30 UTC" per 173).
2. Keep the existing order only if the plan prefers zero reordering: with the measured numbers the post-trade read still fits (1050 s + about 60 s net), but any account slower than about 1400 s would lose it. T1 is the recommendation; the choice is a planner decision (Open Question 5).
3. The probe's evidence sources run **after** the member snapshot, outside the 1500 s bound, each under its own `asyncio.wait_for` (suggest a per-source constant around 420 s, total under about 25 minutes with the census); a source that times out is recorded `Timeout`, never a count of 0. They need a client, so they run on the success, refusal and truncated arms and are skipped for the generic failure arm (a hung venue), as `_okx_order_reading` is.

### Q8 - CI gates and exact verify commands

Run from `analytics-service/` (main checkout's `.venv` has `pytest`/`mypy`; a worktree has none of its own):
```bash
# type gate, verbatim from CI
mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
# focused
pytest tests/test_ccxt_flow_fetch.py tests/test_exchange_pagination.py tests/test_bybit_unified_flows.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py tests/test_bybit_two_year_window.py tests/test_trade_pages.py tests/test_reconstruct_whole_account.py tests/test_trade_read_resume.py -q
# CI form (coverage floor 80)
pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80
# probe self-checks that live in the corpus
pytest tests/test_allocator_history_probe.py -q -k "vocabulary or declared or forbidden or venue_write or two_tables"
```
Sanity run this session: `pytest tests/test_ccxt_flow_fetch.py tests/test_exchange_pagination.py -q -x` -> `21 passed` (main checkout venv, ccxt 4.5.85). A full-corpus sweep for Bybit doubles that need the log method: `grep -ln 'id = "bybit"' tests/*.py` (files: test_trade_pages, test_bybit_two_year_window, test_reconstruct_force_rebuild, test_reconstruct_whole_account, test_trade_read_resume, test_allocator_positions, test_upnl_venues, test_marksource_cross_curve, and the venue-level tests that never reach `_fetch_and_price_window`). Pins that enumerate probe vocabularies or refusal reasons: the three test files in Q5 plus the probe's own `set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record(...))`; `SUMMARY_RECORD_KEYS` is unchanged unless a summary field is added.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Window walk + type fan-out + cursor page loop + ceiling for the Unified log and the evidence endpoints | A new loop | `walk_paginated` + `ProviderPaginationContract` | Funding already runs this endpoint through it; boundary +1 ms, ceiling and stop discipline are tested there |
| Failure classification for probe tokens | New exception mapping | `bybit_upnl_probe.classify_failure` / `FAILURE_CLASSES` | Closed allow-list that never reads venue text |
| Permanent-vs-transient decision | A new tuple | the `classify_exception` permanent set (`AuthenticationError`, `PermissionDenied`, `BadRequest`) | One definition; the whole-account converter already uses it |
| Redaction | Ad hoc scrubbing | `emit_record` + `_ACCOUNT_VALIDATORS` + `assert_sanitized` | The only path to stdout |
| Bybit cursor extraction for ccxt `fetch_*` pages | A second parser | the `info["nextPageCursor"]` scan (copy of `_next_page_cursor`) | Same ccxt mechanism as the proven trade walk |
| Throttling | `asyncio.sleep` | ccxt `enableRateLimit` (on) with the api table `cost`s | Already tighter than the documented UID limits |

**Key insight:** every hard part (paging discipline, closed vocabularies, redaction, the gate) already exists; the phase is about routing Bybit's flow source to the right edge and keeping the failure modes loud.

## Runtime State Inventory

Not a rename/refactor phase; omitted. (The phase changes read behaviour only. Stored `allocator_equity_snapshots` rows are not rewritten; SC-3 forbids a rebuild over a shut gate.)

## Common Pitfalls

### Pitfall 1: Feeding both the on-chain deposits and the Unified `TRANSFER_IN` to the replay
**What goes wrong:** a FUND deposit plus its FUND->UNIFIED move is added twice; the curve level is off by the deposit, and the 5x anchor bound or a silent offset hides it.
**How to avoid:** the Bybit branch of `_fetch_and_price_window` reads only the Unified rows; the RED test asserts the on-chain row is absent from the `_compute_daily_equity` input.
**Warning signs:** `fetch_deposits` awaited on a Bybit exchange in the rebuild path.

### Pitfall 2: Direct-to-Unified deposits and withdrawals may not be `TRANSFER_IN/OUT`
**What goes wrong:** Bybit lets a deposit land directly in the Unified account and `withdraw` accept `accountType` `UTA` [CITED: ccxt `withdraw` docstring `:param str [params.accountType]: 'UTA', 'FUND', 'FUND,UTA', and 'SPOT (for classic accounts only)`]. The docs list no deposit or withdrawal type in the Unified log enum, and the 2026-08-11 `displayType` field ("consistent with the UI display") suggests the UI labels differ from `type`. If those events are not `TRANSFER_IN/OUT`, the Unified edge read misses them. **Unverifiable offline** [ASSUMED either way].
**How to avoid:** the probe records the on-chain deposit/withdrawal counts beside the Unified counts; a derived disagreement flag (`on-chain rows present, Unified rows zero`) feeds `bybit_transfers_cause` and the founder's SC-3 decision. a6's own on-chain rows were 0 at every age, so a6 is not exposed to this; other Bybit accounts could be.

### Pitfall 3: `""` in numeric fields
**What goes wrong:** copying funding's `val is not None` picks `funding == ""` on a transfer row. **How to avoid:** treat empty string as absent; read `change`, then `cashFlow`; parse with a finite check.

### Pitfall 4: A `kind` key on a flow row
**What goes wrong:** the replay builds `{"kind": "deposit", **d}`, so a `kind` key in the row overwrites the event kind. **How to avoid:** never emit one.

### Pitfall 5: Test doubles that model Bybit ascending
**What goes wrong:** `_make_capped_transfer_fetcher` returns `matching[:cap]` ascending, which is not how a newest-first venue behaves, so the old bug never showed. **How to avoid:** the Bybit double must be newest-first with a cursor.

### Pitfall 6: `AsyncMock` exchanges and the new log method
**What goes wrong:** about a dozen existing Bybit tests build `AsyncMock()` with `id = "bybit"` and only deposit/withdraw fetchers; `private_get_v5_account_transaction_log` returns a MagicMock and the strict shape check refuses. **How to avoid:** one shared helper that installs an empty log response; run the whole corpus once early (Wave 0).

### Pitfall 7: Closed-set literal not seen by the scan
**What goes wrong:** raising the new token through a variable fails `raised == set(FORCED_REBUILD_REFUSAL_REASONS)`. **How to avoid:** pass the literal to `ForcedRebuildRefusedError(` at the raise site.

### Pitfall 8: Probe record keys that look like secrets
**What goes wrong:** a key containing `token` is rejected by `assert_sanitized` at run time, on the worker, after a 20-minute read. **How to avoid:** a unit test emits a fully populated record through `emit_record`, and field names avoid the five deny substrings.

### Pitfall 9: Statuses
**What goes wrong:** `fetch_ccxt_transfers` counts every row it is handed, including pending or failed deposits and withdrawals (no status filter) [VERIFIED by reading the module: no `status` use]. Pre-existing, outside D-02. The new evidence counts filter to success states; the Unified log rows are completed facts and carry no status.

### Pitfall 10: The 5x bound and the Earn limitation
**What goes wrong:** see Q2. **How to avoid:** state the limitation in the plan; census in the probe; founder holds a6's rebuild at SC-3 if the census is non-zero.

## Code Examples

Proposed skeletons (not in the repo yet). Names of existing symbols are as quoted above.

### Unified flow walk (shape only)
```python
# services/bybit_unified_flows.py  (proposed)
# Source for params and response shape: https://bybit-exchange.github.io/docs/v5/account/transaction-log
UNIFIED_FLOW_TYPES: Final[tuple[str, ...]] = ("TRANSFER_IN", "TRANSFER_OUT")
_KIND_OF_TYPE: Final[dict[str, str]] = {"TRANSFER_IN": "deposit", "TRANSFER_OUT": "withdrawal"}

async def fetch_bybit_unified_flows(exchange, since_ms, now_ms):
    async def _fetch_page(req: PageRequest) -> PageResult[dict[str, Any]]:
        params = {
            "accountType": "UNIFIED",
            "type": req.inst_type or "",
            "limit": "50",
            "startTime": str(req.window_start),
            "endTime": str(req.window_end),
        }
        if req.cursor:
            params["cursor"] = req.cursor
        result = await exchange.private_get_v5_account_transaction_log(params)  # raises propagate
        # validate dict -> result dict -> list list (raise on a non-dict / non-list, as funding does)
        items = result["result"]["list"]
        rows = [_normalise(item, req.inst_type) for item in items]  # raises on an unparseable row
        return PageResult(
            rows=rows,
            next_cursor=result["result"].get("nextPageCursor", "") or "",
            is_full_page=len(items) >= 50,
            is_empty=(not items),
        )

    contract = ProviderPaginationContract(
        fetcher="fetch_bybit_unified_flows",
        page_cap=200,
        on_ceiling="raise",
        stop_on_short_page=False,       # cursor-authoritative, like funding
        stuck_cursor_is_stop=False,     # a repeated cursor exhausts to the ceiling and raises
        inst_types=UNIFIED_FLOW_TYPES,
        window_max_days=7,
    )
    walk = await walk_paginated(contract, since_ms=since_ms, now_ms=now_ms, fetch_page=_fetch_page)
    deposits = [r for r in walk.rows if r["type"] == "deposit"]
    withdrawals = [r for r in walk.rows if r["type"] == "withdrawal"]
    return _dedup_by_id(deposits), _dedup_by_id(withdrawals)
```
Page-size and cursor mirror `fetch_funding_bybit` (`BYBIT_PAGE_SIZE = 50`, `MAX_PAGES = 200` [VERIFIED: funding_fetch.py:65,70]).

### Bybit cursor-following branch (shape only)
```python
# services/ccxt_flow_fetch.py, Bybit branch inside the window loop (proposed)
cursor: str | None = None
for _ in range(_BYBIT_WINDOW_PAGES):
    params = {"until": window_end}
    if cursor:
        params["cursor"] = cursor
    page = await fetcher(None, window_start, 50, params)
    ...                       # extend with id dedup, as today
    nxt = _bybit_next_cursor(page)   # scans row["info"]["nextPageCursor"]
    if not page or not nxt:
        break
    if nxt == cursor:
        raise <stall error>   # never a silent break
    cursor = nxt
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| On-chain deposit/withdraw record as the Bybit flow source | Unified wallet transaction log `TRANSFER_IN/OUT` | this phase (D-01) | Captures FUND->UNIFIED and sub-account moves |
| Transaction-log rate limit 50/s | 25/s | 2026-05-21 [CITED: changelog] | irrelevant at sequential speeds |
| Log row has no UI label | `displayType` added | 2026-08-11 [CITED: changelog] | possible handle for classifying UI "Deposit" rows; values undocumented |
| ccxt `fetch_ledger` for the v5 log | raw `private_get_v5_account_transaction_log` | n/a | fewer calls, `until` support |

**Deprecated/outdated:** classic account mode ("now unavailable" [CITED: acct-mode page]); `unified` field of query-api ("Deprecated"); `/v5/account/contract-transaction-log` (ccxt marks it deprecated; its docs page returned 404 when fetched).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deposit/withdraw record endpoints return a window newest-first (so the current `max_ts + 1` walk drops older rows) | Q3 | Low: the cursor fix is correct under either order; only the "bug is live" claim changes |
| A2 | `TRANSFER_IN` rows have positive `change`/`cashFlow`, `TRANSFER_OUT` negative | Q1 | Direction is taken from the requested type, so only the sign-mismatch evidence field is affected |
| A3 | Omitting `category` does not exclude transfer rows | Q1 | The read returns nothing and a6 stays "unexplained"; first live probe shows it (counts) |
| A4 | A deposit made directly to Unified and a withdrawal made from `accountType` UTA appear as `TRANSFER_IN/OUT` | Pitfall 2 | Rebuild misses those flows; the probe's disagreement flag exposes it; a6 not exposed (0 on-chain rows) |
| A5 | The transaction log has the same 730-day start bound as the execution list | Q5 | A crossing-midnight crawl could 10001 on the first window; mitigated by reading flows first and sharing the guard |
| A6 | Non-UTA keys get a PermissionDenied/BadRequest from the log | Q1 | Mapped to the new refusal either way |
| A7 | `limit=500` is tolerated by the record endpoints (clamped); 50 is the documented value | Q3 | Sending 50 removes the dependency |
| A8 | Per-call latency about 0.4 s and the wall-time estimates | Q7 | Budget conclusion holds with a 2x error (flows 180 s < 450 s) |
| A9 | Custody/loan/institution types are irrelevant to a retail key | Q2 | The census would not see them; they would be a follow-up |
| A10 | The asset endpoints serve history beyond 365 days (none states retention) | Q6 | Evidence counts read 0 older than 365 days; gate stays `unmeasured`, which SC-3 allows |

## Open Questions (RESOLVED)

1. **Earn / staking / PEF / bonus-transfer types are not flows in this phase (flagged discretion item).**
   - Known: each type costs 105 calls; the list is open-ended; the replay cannot model the receipt side.
   - Unclear: whether a6 used Earn at all.
   - Recommendation: exclude, state the limitation, add the probe census; **surface the consequence to the founder in the plan** (it can bias a6's level while the money was staked).
   - RESOLVED: orchestrator reading 3, not flows in this phase. Plan 02 Task 1 adds the census (`bybit_other_transfer_like_rows`, 600 s bound), plan 02 Task 2 and plan 04 Task 3 state the limitation, plan 08 Task 2 puts a non-zero census to the founder as a reason to hold, and plan 08 Task 3 books `180-BYBIT-EARN-FLOWS-UNREAD`.
2. **Unforced reconstruct for a Bybit key whose Unified log cannot be read (settled as an orchestrator reading of D-01 and D-03, not a founder decision).** The forced rebuild refuses by name (D-03). The unforced job has no refusal channel; recommendation: let the permanent venue error fail the job (nothing written, WR-04 "never a silent 0"), accepting that a Bybit key lacking the needed permission no longer gets the old on-chain-only first backfill. Alternative: fall back to the on-chain read for the unforced path. There are no clients, so the recommendation is to fail loud.
   - RESOLVED: orchestrator ruling 2, fail loud as a permanent error with nothing written and no on-chain fallback; only the forced path uses the new refusal token. Plan 07 Task 1 (the forced token) and plan 07 Task 2 (`classify_exception` makes `BybitUnifiedFlowReadError` permanent; transient ccxt classes still retry).
3. **Direct-to-Unified deposits/withdrawals labelling (A4)** cannot be settled offline; the post-deploy probe is the instrument. If the probe flags on-chain rows without Unified rows for an account, that account's rebuild must stay held. Founder decision at SC-3.
   - RESOLVED: plan 03 Task 2 derives `bybit_funding_explained` `off_edge` (an evidence source shows money arriving that the Unified edge does not); plan 08 Task 1 step 11 makes it a `sc2-met: no` STOP and plan 08 Task 2 recommends hold; the founder decides at SC-3.
4. **Sort order of the log and of the record endpoints, and `displayType` values** are undocumented; no plan step depends on them (cursor-authoritative walks, direction from `type`).
   - RESOLVED: plan 04 walks cursor-authoritatively and takes the direction from `type`, never from a sign or an order; plan 01 reads every evidence window newest first and counts distinct ids, so neither depends on a sort order.
5. **Planner decision: flows before trades (recommended) vs after.** Evidence above. Either needs a call-order test.
   - RESOLVED: orchestrator ruling 1, flows before trades. Plan 06 Task 1 (`test_the_bybit_flows_are_read_before_the_trades`, mutation m3) and its stated per-claim cost.
6. **Planner decision: include the candidate census** (about 6 more probe minutes, one aggregate count). Recommended.
   - RESOLVED: included, plan 02 Task 1, under its own `CENSUS_TIMEOUT_S` (600 s), orchestrator reading 3.
7. **Operator timing:** the full probe now takes about 1050 s (trades) + about 90 s (flows) + about 5 minutes of evidence reads (+ about 6 with the census); start no later than 23:30 UTC less that total so the evidence windows do not cross the two-year edge (a crossing is recorded as `BadRequest` state, not a wrong count).
   - RESOLVED: plan 08 hard constraints, start between 00:30 and 21:30 UTC (worst case about 70 minutes for a6: the 1500 s crawl bound plus five sources at up to 420 s and the census at up to 600 s); the same window applies to a forced rebuild in plan 08 Task 3.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 + `.venv` with pytest, mypy (main checkout) | tests, type gate | yes | 3.12.13, ccxt 4.5.85 | CI installs 4.5.88 |
| ccxt 4.5.88 source | reading signatures | yes (local package cache) | 4.5.88 | - |
| Bybit API reachability | live probe | **no** from this machine (only the backfill worker's egress IP is allowed [173-RESEARCH]) | - | operator wave runs on the worker |
| Bybit credentials | probe | not read, not needed for executors | - | - |
| Supabase / PROD / TEST / Railway | none in waves 1-2 | not touched | - | - |

**Missing with no fallback:** none for planning and executor waves. Live behaviour (A1-A5) can only be observed by the post-deploy probe.

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest, `asyncio_mode = auto`, `pythonpath = .` [VERIFIED: analytics-service/pytest.ini] |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (mypy, coverage) |
| Quick run command | `pytest tests/test_ccxt_flow_fetch.py tests/test_bybit_unified_flows.py tests/test_allocator_history_probe.py -q` (from `analytics-service/`) |
| Full suite command | `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` plus the CI mypy line |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? | Fails when (neuter) |
|-----|----------|-----------|-------------------|--------------|---------------------|
| SC-2 | Bybit `fetch_ccxt_transfers` returns all 120 rows of a newest-first, 50-per-page window and makes 3 calls | unit | `pytest tests/test_ccxt_flow_fetch.py -k bybit_pages -q` | Wave 0 (new test in existing file) | restore `inner_cursor = max_ts + 1` for Bybit -> 50 rows |
| SC-2 | A repeated cursor raises, never truncates | unit | same file `-k stuck` | Wave 0 | replace the raise with `break` |
| SC-2 | Unified read returns all 120 `TRANSFER_IN` rows across pages | unit | `pytest tests/test_bybit_unified_flows.py -k pages -q` | Wave 0 | ignore `nextPageCursor` |
| SC-2 | Request shape: `accountType=UNIFIED`, both types, 7-day tiling from start to now, `limit` 50 | unit | `... -k request_shape` | Wave 0 | send one type / widen a window / drop `endTime` |
| SC-2 | Rebuild feeds the replay only the Unified rows (on-chain row absent) | unit | `pytest tests/test_trade_pages.py -k unified_flows -q` (or new file) | Wave 0 | revert the Bybit branch to `fetch_ccxt_transfers` |
| SC-2 | Row normaliser: `""` fields, sign vs type, missing id/amount/currency/time refuses | unit | `... -k normalise` | Wave 0 | read `funding` first / take sign as direction |
| D-03 | Permanent venue error + `require_anchor` -> `account_flow_source_unreadable`; transient bubbles; unforced re-raises | unit | `pytest tests/test_reconstruct_force_rebuild.py -k flow_source -q` | Wave 0 | widen the except to all `Exception` / drop the `require_anchor` gate |
| D-03 | Token set is 17, raise-site equality, probe vocabulary accepts the token | unit | `pytest tests/test_reconstruct_force_rebuild.py tests/test_bybit_two_year_window.py tests/test_allocator_history_probe.py -q -k "refusal or vocabulary or two_year"` | edits to existing | remove the literal raise site |
| SC-1 | Recorder maps `TRANSFER_IN/OUT` log rows to deposits/withdrawals; gate unchanged | unit | `pytest tests/test_allocator_history_probe.py -k unified -q` | Wave 0 | map both types to one kind |
| SC-1 | Each evidence source: count, older-365d, oldest bucket, state; master-only skipped as `not-master`; failure class recorded | unit | `... -k evidence_source` | Wave 0 | count failed statuses / swallow errors as 0 |
| SC-1 | Redaction: planted ids, member ids, UIDs never in stdout/stderr; record accepted by `emit_record` | unit | `... -k redaction` | Wave 0 | print a raw field |
| SC-1 | `bybit_transfers_cause` and `bybit_funding_explained` derivations | unit (pure) | `... -k cause` | Wave 0 | return `none` when only one kind is old |
| SC-1 | Static pins: no venue write, only GET `private_get_*`, `DEPLOYED_ER_NAMES` sorted | unit | `... -k "venue_write or declared"` | exists | add a write call |
| SC-1 | Evidence reads run after the snapshot, under their own bound, and a timeout is a state token | unit | `... -k evidence_bound` | Wave 0 | run inside `_read_member` |
| Time budget | If flows-first: call order test (log requested before the first `fetch_my_trades`) | unit | `pytest tests/test_trade_pages.py -k flows_before_trades -q` | Wave 0 | reorder |
| SC-3 | Post-deploy probe reading, gate or named cause, founder decision | operator checkpoint | n/a (orchestrator, not an executor task) | n/a | n/a |

How each RED proof is run (data-integrity gates, project rule): copy the file to a byte backup, apply the neuter, run the named test and see it RED, restore from the byte backup, run GREEN; never `git checkout`/`restore`/`stash` on uncommitted work.

### Sampling Rate
- **Per task commit:** the focused pytest set for the touched file + the CI mypy line.
- **Per wave merge:** all nine files in Q8's focused command, then the full corpus once at the end of wave 2 (the `AsyncMock` Bybit doubles are the likely breakage).
- **Phase gate:** CI form of pytest with coverage >= 80, mypy clean, then ship.

### Wave 0 Gaps
- [ ] `tests/_trade_pages.py`: a Bybit transfer/log book double (newest-first, 50/page, opaque cursor, `until`/`startTime`/`endTime`, `type` filter) and an "empty log" installer for `AsyncMock` Bybit exchanges.
- [ ] `tests/test_bybit_unified_flows.py` (new).
- [ ] Edits: `tests/test_ccxt_flow_fetch.py`, `tests/test_exchange_pagination.py` (keep ascending doubles for OKX/Binance), `tests/test_allocator_history_probe.py`, `tests/test_reconstruct_force_rebuild.py`, `tests/test_bybit_two_year_window.py`, `tests/test_trade_pages.py`.
- [ ] Framework install: none.

## Security Domain

(`security_enforcement` is absent from `.planning/config.json`, so it is enabled.)

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new login surface) | existing key decrypt path (`decrypt_credentials`, worker only) |
| V3 Session Management | no | - |
| V4 Access Control | yes | read-only keys; every new venue call is a GET; static pin forbids POST/PUT/DELETE and `withdraw(`/`transfer(` names in the probe; `ReadOnlySupabase` |
| V5 Input Validation | yes | validate venue response shape (dict, `result` dict, `list` list) and row fields; refuse on malformed rows; closed vocabularies in the probe |
| V6 Cryptography | no new use | no hand-rolled crypto |
| V7 Error handling / logging | yes | exception CLASS only, `scrub_freeform_string` for any logged venue text; ccxt messages can embed a signed URL |
| V8 Data protection | yes | probe prints counts/booleans/closed tokens only; no `userID`, `parentUid`, `fromMemberId`, amounts, transfer ids; `assert_sanitized` |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Venue error text carrying a request signature leaks into logs/audit | Information disclosure | class-only logging; static refusal text; `_forced_refusal_result` attaches no venue text |
| Public repo leak of ids/amounts through probe output pasted into `.planning` | Information disclosure | whitelist emitter, deny-key and long-token checks, ids kept in memory |
| A write endpoint reachable from the probe | Tampering | GET-only methods, static source pin |
| Silent truncation of money flows | Tampering / data integrity | cursor-authoritative walks, ceiling raises, malformed row refuses, never a swallowed 0 |
| A `ccxt` message-bearing exception crossing the redaction boundary | Information disclosure | `classify_failure` allow-list |

## Sources

### Primary (HIGH confidence)
- Repo files read this session (verbatim quotes above): `analytics-service/services/ccxt_flow_fetch.py`, `services/equity_reconstruction.py` (transfers read, replay, refusal sets, trade walk, crawl converters), `services/funding_fetch.py`, `services/exchange_pagination.py`, `services/ccxt_flows.py`, `services/exchange.py`, `services/job_worker.py` (`classify_exception`, transfer callers), `services/account_identity.py`, `services/key_permissions.py`, `scripts/allocator_history_probe.py`, `scripts/bybit_upnl_probe.py`, `scripts/deribit_ground_truth.py`, the named tests, `.github/workflows/ci.yml`.
- ccxt 4.5.88 package source: `async_support/bybit.py` (`fetch_deposits`, `fetch_withdrawals`, `parse_transaction`, `add_pagination_cursor_to_result`, `fetch_ledger`, `is_unified_enabled`, exceptions table, api costs), `base/exchange.py` (`parse_transactions`, `filter_by_since_limit`, `handle_until_option`), `abstract/bybit.py`.
- Bybit v5 docs fetched: https://bybit-exchange.github.io/docs/v5/account/transaction-log ; https://bybit-exchange.github.io/docs/v5/enum ; https://bybit-exchange.github.io/docs/v5/asset/deposit/deposit-record ; https://bybit-exchange.github.io/docs/v5/asset/deposit/internal-deposit-record ; https://bybit-exchange.github.io/docs/v5/asset/withdraw/withdraw-record ; https://bybit-exchange.github.io/docs/v5/asset/transfer/inter-transfer-list ; https://bybit-exchange.github.io/docs/v5/asset/transfer/unitransfer-list ; https://bybit-exchange.github.io/docs/v5/user/apikey-info ; https://bybit-exchange.github.io/docs/v5/rate-limit ; https://bybit-exchange.github.io/docs/v5/acct-mode (summary only).
- Phase artifacts: `.planning/phases/173-*/173-03-SUMMARY.md` (a6 record), `173-RESEARCH.md` (Pitfalls 3 and 6, A6, A7, Open Question 2).

### Secondary (MEDIUM confidence)
- https://bybit-exchange.github.io/docs/changelog/v5 : first 100000 of about 207000 characters read (transaction-log entries 2025-04-24 to 2026-08-11 found; older entries not read).
- A web search for how a direct-to-Unified deposit is labelled found nothing authoritative (results did not answer it).

### Tertiary (LOW confidence)
- The contract-transaction-log docs page returned 404; nothing relies on it.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new package; every ccxt method verified in the pinned version.
- Architecture: HIGH for seams (read in source); MEDIUM for Bybit behaviours the docs leave open (A1-A5).
- Pitfalls: HIGH for code/test mechanics; MEDIUM for the Bybit data-integrity notes.
- Call budget: MEDIUM - derived from one measured run, not from a timed Unified read.

**Research date:** 2026-10-28
**Valid until:** 2026-11-27 for the repo seams (the preceding phases moved these files daily; re-resolve symbols at plan time); Bybit doc facts about 30 days.
