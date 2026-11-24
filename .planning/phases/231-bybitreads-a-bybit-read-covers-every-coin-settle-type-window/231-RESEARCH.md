# Phase 231: BYBITREADS - Research

**Researched:** 2026-11-23
**Domain:** Bybit V5 read paths in `analytics-service/` (balance anchor, positions, execution list, flows), ccxt 4.5.89, counts-only worker probes
**Confidence:** HIGH on code-path facts and ccxt behaviour (read and run this session); MEDIUM on Bybit venue semantics (small-model doc extraction, tagged `[CITED]`); LOW where tagged `[ASSUMED]`

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary (ROADMAP `### Phase 231`, quoted, binding):** "Every Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name, and the owner's static egress IP is allow-listed by the founder (VREAD-05). Before any fix, a venue-by-path census (coin, settle type, window, flow source) is written, and every row is fixed or decided with a test (PITFALLS Pitfall 3)."

Delivers (VREAD-01..05): VREAD-01 the derive anchor sums the same stable coins as the current-equity read, through one shared coin-set constant (the narrow pin `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin` is the intended RED-first test, flipped and never deleted); VREAD-02 the holdings poll includes USDC-settled and inverse positions and their uPnL; VREAD-03 a strategy trade sync that starts more than seven days back returns every execution in its window, or refuses by name; VREAD-04 an on-chain deposit is counted exactly once, replace or union decided on probe evidence or recorded as undecided if the probe cannot tell them apart; VREAD-05 a FOUNDER action (allow-list the owner's static egress IP, recorded with its date; this phase prepares instructions and evidence only; no agent touches exchange account settings); PROOF-01 (ROADMAP SC-5) each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), GREEN, recorded verbatim in the plan SUMMARY; mocks mirror recorded real payloads, not the parser's field names.

**Out of scope:** any stitch or composite file as an integration point; the OKX reads (Phase 232); `run_sync_trades_job`'s cursor read and `advance_fetched_cursor` (Phase 232 / 222); Bybit flow kinds beyond the on-chain deposit verdict (Phase 223); Binance (`167.2.1.1-BINANCE-FUTURES-WALLET-UNREAD` stays with its own entry).

**Ordering and the Phase 229 gate:** "The anchor feeds `key_inputs.anchor_usd` (S1 to S2), so if 229 is still open, the anchor plan waits for it." Measured 2026-11-23: Phase 229 has no plans, no branch and no PR (it depends on 226, which is running). So the VREAD-01 anchor plan is its own plan in the LAST wave, with a blocking precondition "Phase 229 merged to main". It is planned now but not executed while 229 is open, and no SUMMARY is written for it while blocked. The other plans do not wait for it. Plan write scopes are listed BY SYMBOL (founder constraint: `exchange.py`, `positions.py` and `bybit_unified_flows.py` are shared with Phases 223 and 232).

**Research first:** Plan 01 is read-only: the census table, written to the phase dir, one row per Bybit read path by coin, settle type, window and flow source, each row ending in "fix in plan NN" or "decided: <reason>, pinned by <test>". The counts-only trade-window probe and the on-chain deposit probe need decrypted keys, which exist only inside the worker (Phase 186 D-01). They follow the Phase 186 pattern (`analytics-service/scripts/derivegaps_probe.py`: a reviewed script, `ReadOnlyRecordingExchange`, redacted `k1..kN` output, deploy fingerprint, run once on the Railway backfill worker). The temporary worker run is executed by the phase orchestrator, not an executor, and the start command is restored and verified afterwards. Zero on-chain rows for the distinguishing case means the VREAD-04 verdict is "undecided" (PITFALLS Pitfall 3), never "replace".

**Decided autonomously (CONTEXT):**
- [Anchor] Shared constant = `services/price_rule.is_stable_value` (STABLECOINS plus STABLECOIN_SPLIT_SUFFIXES), the rule `_price_wallet_totals` already applies.
- [Anchor] Fix lives in "A Bybit-only branch in the anchor path (`fetch_account_equity_and_upnl_usd` / the Bybit arm of the balance read) summing every stable coin's wallet figure from `balance['total']`; Binance and the shared `fetch_usdt_balance_with_status` behaviour for other venues stay unchanged. Every other caller of the helper (strategy-sync `fetch_usdt_balance`, `fetch_account_equity_usd`, the composite call at the stitch job) is a census row: fixed by inheritance, or decided with a test."
- [Anchor] The flipped pin asserts: derive anchor equals the stable-coin wallet sum (1200 in the pin's own fixture), wedge stays 0.0, reconstruct == derive + open uPnL still holds (1450.5).
- [Anchor] Non-stable collateral coins stay OUT of the anchor; a census row decided with a pinning test, flagged to the founder in the phase report.
- [Positions] Iterate linear settleCoin USDT, linear settleCoin USDC and category inverse, on both the ccxt path and the raw V5 fallback in `_fetch_positions_bybit`; a failed sub-read refuses by name, never returns a silent partial. Inverse uPnL (coin-denominated) is converted at the same payload's markPrice (USD per coin), following the existing Deribit inverse pattern in `positions.py`; an unusable mark refuses the row by name.
- [Trades] Fix shape decided by the counts-only probe. If it shows truncation (or cannot rule it out), walk [start, now] in 7-day windows with an explicit endTime; a window cap hit raises a named data-quality flag and refuses. If the probe disproves it, record that with a test. Execution categories: linear only stays (`_BYBIT_FILL_CATEGORIES`); a decided census row pinned by the existing tests.
- [Deposits] If the probe is undecided: flow source stays `replace`, verdict recorded as undecided with the probe counts, and a test pins that an unpaired on-chain deposit is visible (named) rather than silently booked as P&L, if the reader can see it.
- [Fixtures] Built from recorded real Bybit v5 payload shapes, run through the real ccxt 4.5.89 parser where the code uses it.
- VREAD-05: the phase prepares exact instructions and stops for the founder. No agent changes Railway networking or the Bybit key's settings. The address never enters tracked text.

PROD readings taken 2026-11-23 (CONTEXT): 1 Bybit key connected and active; 5 more revoked/disconnected since 2026-08-06 (research FEATURES.md's "6 active Bybit keys" counts the revoked ones; live exposure is ONE key). That key's `derive_broker_dailies`: 2 `failed_final` with an IP error (2026-10-07, 2026-10-08), then 31 `done` on the first attempt from 2026-10-24 through 2026-11-23. The "Unmatched IP" daily error is NOT occurring now; Railway's read-only service config does not show whether Static Outbound IPs are on. VREAD-05 therefore becomes a confirmation: what changed around 2026-10-09..10-24 and on what date.

### Claude's Discretion
Plan split and wave layout, within: plan 01 read-only census and probes; VREAD-02, VREAD-03 and VREAD-04 plans in parallel where their symbol scopes do not overlap; VREAD-01 last and gated on 229. At most 2 executors run at once (founder constraint).

### Deferred Ideas (OUT OF SCOPE)
- Non-stable collateral (for example BTC held in the Unified account) in the derive anchor: outside VREAD-01's stable-coin scope; flagged in the phase report.
- A start-less (`since_ms=None`) Bybit execution read answers only the last 7 days; record it in the census, and if no caller sends None for a long window, decide it there. **(Research finding F3 below: a caller DOES send None for a long window, so this deferral's own condition is not met. Raised as Open Question 2.)**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VREAD-01 | Derive anchor sums the same stable coins as the current-equity read, one shared constant | Census C01-C06; "VREAD-01 design"; ccxt `parse_balance` verified; blast radius and every moving test listed |
| VREAD-02 | Holdings poll includes USDC-settled and inverse positions and their uPnL | Census C09-C13; ccxt request shapes executed on 4.5.89; real-market parser run; symbol and unit traps found |
| VREAD-03 | Trade sync starting > 7 days back returns every execution or refuses by name | Census C14-C17; `walk_paginated` reuse; cursor-advance interplay (F4); probe design |
| VREAD-04 | On-chain deposit counted exactly once; replace/union by evidence or undecided | Census C20-C23; what 186-04 recorded; decision rule; no reader can name an unpaired deposit today (F6) |
| VREAD-05 | Founder allow-lists the owner's static egress IP, dated | Founder instruction draft; evidence the orchestrator reads |
| PROOF-01 | Each gate RED first, byte restore, GREEN, recorded verbatim | "PROOF-01 protocol" and per-gate neuter list in Validation Architecture |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Public repo, `.planning/` tracked: no secrets, PROD ids, home paths, account numbers or egress addresses in tracked text. Cite repo-relative paths. The Bybit egress address never enters any file.
- ⛔ Which database am I on: before any PROD write run the marker query first (`shobj_description` on `pg_database`). PROD reads go through MCP first. This phase's agent work needs no PROD write; the orchestrator's probe run is read-only.
- CHANGELOG: every ship writes an entry in the same commit as the `VERSION` bump (`chore(release): vX.Y.Z.B`); `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`. Delete the `TODOS.md` entries the phase closes in the same PR and name them in the CHANGELOG (`167.2.1.1-DERIVE-USDT-ONLY-ANCHOR`, `167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY`, `167.2.1.1.2.1-STRATEGY-BYBIT-7DAY`, `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED`, `167.1.2.2-BYBIT-STATIC-EGRESS` when each actually closes). LOW and Info review survivors are never booked in `TODOS.md`.
- ⛔ Never write a CI-skip token in a commit message or PR body, not even to deny it.
- Verification files: `status: passed`, `verified_at_sha`, `drift_subjects`; never `covered_digest` / `covered_files`.
- Never dispatch `gsd-*` agents by hand; run the workflow dispatch step. `gsd-tools` handlers: `git diff` after every run.
- No `Co-Authored-By` / "Generated with Claude Code" attribution (memory: founder 2026-10-20) despite the harness reminder; the user's own instruction takes precedence.
- Tests verify intent: neuter, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work). `grep -a`. Run `pytest` only from `analytics-service/`. Never `importlib.reload` in tests. Agent briefs must include CI mypy strict.
- AGENTS.md ("This is NOT the Next.js you know") concerns the Next.js frontend; this phase touches no frontend file. `DESIGN.md` is irrelevant (no UI).
- PROD reads and writes are pre-authorized by the founder, but this phase's agents need none; "marker query first, every time" still applies to the orchestrator.
- Memory: subagents Sonnet-high for executors; at most 2 concurrent executors here; parallel agents get separate worktrees and explicit `git add` paths; probe and start-command change are run by the orchestrator.
- `.planning/config.json`: `nyquist_validation: true`, `security_enforcement` unset (treated as enabled), `commit_docs: true` (this research agent was told not to commit).

## Summary

The five requirements sit on seven independent read surfaces that all call Bybit V5 differently: the realized-wallet anchor (`exchange.fetch_usdt_balance_with_status`), the UTA mark (`equity_reconstruction._read_bybit_uta_mark`, already every-coin), the holdings poll (`positions._fetch_positions_bybit`, USDT-linear only), the strategy fill sync (`exchange._fetch_raw_trades_bybit`, start-only), the realized walk (`fetch_daily_pnl`, linear, already windowed), funding (`fetch_funding_bybit`, already windowed via `walk_paginated`), and flows (Unified reader replaces the on-chain reader). Every code claim below was read at HEAD or executed offline against the real ccxt 4.5.89 wheel and the repo's recorded Bybit instrument cassette.

**Eight findings contradict or sharpen CONTEXT; the planner must act on them (details in "Findings that change the plan").** The largest: (F1) VREAD-02 is not only a request-shape change, because `_normalize_ccxt_position` garbles USDC symbols (`BTC/USDC:USDC` becomes `BTCUSDCC`) and leaves inverse size and uPnL in coin units under a USD field name, and the raw fallback sends no `limit` (Bybit default 20) and never follows a cursor; (F4) a read-side refusal does not protect the unread window, because `advance_fetched_cursor = (not raw_fills) or (...)` treats a raised fetch like an empty one and advances the cursor to now, and that gate is Phase 232/222's file; (F2) the "allocator rebuild's windowed reader" was deleted by Phase 176, so the template is `walk_paginated` (already used by funding and Unified flows) plus the closed-pnl walk.

**Primary recommendation:** Build every windowed or categorized Bybit read on the existing `services/exchange_pagination.walk_paginated` contract, put the stable-coin sum for the anchor in one new Bybit helper that calls `price_rule.is_stable_value` and is routed from BOTH `fetch_account_equity_usd` and `fetch_account_equity_and_upnl_usd`, fix the VREAD-02 symbol and unit traps in the same plan as the request shape, ship a new counts-only probe (`scripts/bybitreads_probe.py`) that measures the VENUE's behaviour (not our function) before the trade and deposit verdicts, and treat the cursor-advance gate as a recorded cross-phase dependency on 232.

## Findings that change the plan (read first)

| # | Finding | Evidence | Consequence for planning |
|---|---------|----------|--------------------------|
| F1 | VREAD-02 has THREE defects, not one. (a) request shape (USDT-linear only); (b) `_normalize_ccxt_position` mangles non-USDT symbols and keeps coin units for inverse; (c) the raw fallback sends no `limit` (Bybit default 20) and never follows `nextPageCursor`; the ccxt path reads one page of 200 | Ran the repo's own `_normalize_ccxt_position` on ccxt-shaped rows: `BTC/USDC:USDC` -> `BTCUSDCC`, `BTC/USD:BTC` -> `BTCUSD:BTC` (a colon fails `HOLDING_REF_RE` in `src/app/api/allocator/scenario/commit/route.ts:87`), `size_usd` and `unrealized_pnl` pass through in coin units. Ran ccxt 4.5.89 `parse_position` on the real recorded BTCUSD inverse market: `contracts` 100 (USD contracts), `notional` 0.00166667 (coin), `unrealizedPnl` as sent. Fallback call at `services/positions.py:372-374` sends only `{"category","settleCoin"}` | VREAD-02 plan must fix symbol, units, limit/cursor and request shape together, with tests per field |
| F2 | The "allocator rebuild windowed reader (`trade_read_store`)" CONTEXT names no longer exists. Phase 176 deleted the reader (`git show 6c919f4f7^:analytics-service/services/equity_reconstruction.py` has `_read_bybit_window`, `_BYBIT_TRADE_WINDOW_MS`, `BYBIT_TRADE_TERMINUS_DAYS = 730`); `services/trade_read_store.py` survives only as a store, and its sole production importer is `main_worker.py:1335` (`purge_expired`) | `grep -rn trade_read_store` over services/routers | Template for VREAD-03 is `services/exchange_pagination.walk_paginated` (`window_max_days=7`, `default_lookback_days`, `on_ceiling="raise"`), as `fetch_funding_bybit` and `fetch_bybit_unified_flows` already use it. The deleted code is useful only as lineage for the two-year start limit |
| F3 | `since_ms=None` IS reachable for a long window. `run_sync_trades_job` passes `fills_since_ms = None` when `last_fetched_trade_timestamp` and the daily high-water are both NULL (`services/job_worker.py:2207-2211`). Bybit answers a start-less request with only the last 7 days | job_worker.py read; Bybit execution-list doc `[CITED]` | CONTEXT's Deferred condition ("if no caller sends None for a long window") is not met. Open Question 2: default Bybit None to a 365-day lookback like `fetch_daily_pnl` (`exchange.py:1952-1956`) and `BYBIT_FUNDING_DEFAULT_LOOKBACK_DAYS` |
| F4 | A refusal raised from `_fetch_raw_trades_bybit` does NOT hold the window. `advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)` (`services/job_worker.py:2655`); when the fetch raises, `raw_fills` is still `[]`, so the cursor advances to now | Read job_worker.py:2102, 2213, 2236-2266, 2352, 2655 | Make the windowed read COMPLETE by construction (the real fix) and treat the named refusal as the rare cap-hit path. Record a dependency: Phase 232 (VREAD-08) / 222 must gate that line on `not phase2_failed`. VREAD-03's plan must not edit `run_sync_trades_job` |
| F5 | VREAD-01's blast radius reaches the mark: the derive passes its own anchor as `usdt_wallet_usd=equity` into `build_mark_read` (`services/job_worker.py:8958-8965`), which refuses `wallet_basis_mismatch` when the mark's all-asset wallet differs from it by more than max(1 USD, 0.5%) (`services/nav_marks.py:373-390`). Today a Bybit key holding USDC is refused daily; after VREAD-01 it is admitted (BTC collateral stays refused by name) | nav_marks.py read; `tests/test_nav_marks_l4_read.py:866-935` | A new test must pin both: USDC account admitted, BTC account still `wallet_basis_mismatch`. Marks start being written for such accounts: a user-visible change to report |
| F6 | No reader can name an unpaired on-chain deposit at HEAD. The per-key derive's Bybit arm never calls `fetch_ccxt_transfers` (`services/job_worker.py:8773-8809`, pinned by `tests/test_derive_broker_dailies_dualmode.py:3276` `assert_not_awaited`). CONTEXT's "if the reader can see it" resolves to "it cannot". A deposit that reaches the Unified wallet WITHOUT a Unified TRANSFER row would enter NAV with no flow and book as a return spike (the repo's own test shows the spike: `tests/test_derive_broker_dailies_dualmode.py:3270-3273`) | Bybit enum doc: the UTA transaction log has TRANSFER_IN/TRANSFER_OUT and no DEPOSIT type `[CITED]`; the deposit-record response has no account-type field `[CITED]` | VREAD-04's deliverable under "undecided" is evidence plus a pin of the current `replace` behaviour; do not invent a reader to name it |
| F7 | `fetch_account_equity_usd` (2-tuple) and `fetch_account_equity_and_upnl_usd` (4-tuple) both end in `fetch_usdt_balance_with_status` for Bybit. A branch in only one leaves them disagreeing. Also `tests/test_exchange.py:5852-5870` (`test_bybit_binance_wedge_zero`) patches `services.exchange.fetch_usdt_balance_with_status` for Bybit and will move | exchange.py:3237-3301 read | Route both entry points to one Bybit helper; split that test per venue (flip, never delete) |
| F8 | The local environment is not CI: local ccxt is 4.5.64 (pin and CI are 4.5.89), local Python 3.14.3 (CI 3.12), local mypy 2.0.0 (CI `mypy==2.4.0`). The ccxt functions this phase depends on are semantically identical across the two versions (diffed: only typing and a `load_markets` guard differ) and the request shapes were re-run on the 4.5.89 wheel, but PROOF-01 runs should use the 4.5.89 wheel or CI | `analytics-service/requirements.txt:33`, `requirements-dev.txt:53`, `.github/workflows/ci.yml:5655-5657` | Executors: do not trust a green local mypy as the CI gate; run the exact CI command and prefer a venv with `requirements.txt` + `requirements-dev.txt` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Derive anchor (stable-coin wallet sum) | API / Backend (analytics worker, `services/exchange.py`) | Database (`key_inputs.anchor_usd` written by the derive, read by S2) | Pure venue read; the stored anchor is the S1 to S2 contract |
| Holdings poll (positions, uPnL) | API / Backend (`services/positions.py`, `services/allocator_positions.py`) | Database (`allocator_holdings`, `position_snapshots`) | Normalisation (units, symbol) must happen before persistence; the browser only displays |
| Strategy fill sync window walk | API / Backend (`services/exchange.py`) | Database (`trades` upsert, `api_keys.last_fetched_trade_timestamp`) | The window is a venue-request concern; the cursor gate lives in `run_sync_trades_job` (232/222) |
| Flow source choice (replace/union) | API / Backend (`run_derive_broker_dailies_job` Bybit arm) | none | Decided by probe evidence; no tier change |
| Counts-only probes | Worker host (backfill service, decrypted keys) | Railway deploy (temporary start command) | Keys decrypt only inside the worker (Phase 186 D-01) |
| Egress allow-list | Founder (Railway service networking + Bybit key settings) | none | Agents must not touch exchange account settings |

## Standard Stack

No new external package is needed. Everything below is already pinned or in the repo.

### Core
| Library / module | Version | Purpose | Why standard |
|---|---|---|---|
| `ccxt` | 4.5.89 (`analytics-service/requirements.txt:33`) | Bybit REST, `parse_balance`, `fetch_positions`, `parse_position` | Already the venue client; request shapes verified on the 4.5.89 wheel |
| `services/exchange_pagination.py` (`walk_paginated`, `ProviderPaginationContract`, `PageRequest`, `PageResult`) | in-repo | The ONE windowed-and-cursor driver (7-day windows with +1 ms boundary, ceiling raise or flag) | `fetch_funding_bybit` and `fetch_bybit_unified_flows` already use it; hand-rolling a third loop is what produced NEW-C30-01 |
| `services/price_rule.is_stable_value` | in-repo | The single stable-value rule (`_STABLE_VALUE = STABLECOINS | STABLECOIN_SPLIT_SUFFIXES`) | The rule `_price_wallet_totals` already applies |
| `scripts/derivegaps_probe.ReadOnlyRecordingExchange`, `emit_record`, `assert_sanitized` pattern | in-repo | GET-only, counted, redacted probe harness | Phase 186's reviewed pattern |

### Supporting
| Library | Purpose | When to use |
|---|---|---|
| `pytest` (`<9.2`), `pytest-asyncio` (asyncio_mode=auto), `pytest-cov`, `pytest-xdist` | Test runner (`analytics-service/pytest.ini`, `requirements-dev.txt:43-51`) | All VREAD tests |
| `mypy==2.4.0` (`requirements-dev.txt:53`) | CI strict gate | Every analytics-touching plan |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Shared `walk_paginated` for the execution list | A hand-written window loop copied from the deleted `_read_bybit_window` | The deleted loop handled same-millisecond segment continuation (READCEILING); it is 150+ lines. Start from `walk_paginated`; add the segment logic only if the probe shows a window above the page ceiling |
| A new Bybit stable-wallet helper (recommended, Option A) | A Bybit arm inside `fetch_usdt_balance_with_status` (Option B) | B changes `api_keys.account_balance_usdt` (a column named USDT) and strategy capital for every non-anchor caller; A leaves them byte-identical. See "VREAD-01 design" |

**Installation:** none. **Version verification:** `grep -n '^ccxt' analytics-service/requirements.txt` gives `ccxt==4.5.89`; `pip download ccxt==4.5.89 --no-deps` succeeded in this session and the wheel's `bybit.py` was read and run.

## Package Legitimacy Audit

This phase installs no external package. Nothing to gate; `gsd-tools query package-legitimacy check` was not run because there are no candidate names. No package was recommended from WebSearch or training data.

**Packages removed due to SLOP verdict:** none. **Packages flagged SUS:** none.

## Architecture Patterns

### System Architecture Diagram

```
                         Bybit V5 (REST, GET only for every read in this phase)
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ /v5/account/wallet-balance   /v5/position/list   /v5/execution/list              │
   │ /v5/position/closed-pnl      /v5/account/transaction-log   /v5/asset/*-record    │
   └───────┬───────────────┬──────────────┬──────────────┬───────────────┬────────────┘
           │               │              │              │               │
   fetch_balance()   positions.py     _fetch_raw_    fetch_daily_pnl  fetch_bybit_unified_flows
   (ccxt parse:      _fetch_positions  trades_bybit   (7d windows,     (7d windows, TRANSFER_IN/OUT)
    total=wallet)    _bybit            (start only)   linear)          fetch_ccxt_transfers (on-chain,
           │               │              │              │            composite only, 30d windows)
           ▼               ▼              ▼              ▼               │
  ┌─────────────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────────┐   │
  │ ANCHOR (VREAD-01)│ │ HOLDINGS     │ │ SYNC FILLS │ │ DERIVE realized│  │
  │ fetch_account_   │ │ (VREAD-02)   │ │ (VREAD-03) │ │ + funding      │◄─┘ flows -> F_t term
  │ equity_(and_upnl)│ │ rows: spot   │ │ run_sync_  │ │ run_derive_    │
  │ _usd -> derive   │ │ (every coin) │ │ trades_job │ │ broker_dailies │
  │ equity -> key_   │ │ + derivative │ │ cursor gate│ └───────────────┘
  │ inputs.anchor_usd│ │ (uPnL)       │ │ = 232/222  │
  └───────┬──────────┘ └──────┬───────┘ └─────┬──────┘
          │ usdt_wallet_usd    │               │
          ▼                    ▼               ▼
   build_mark_read      allocator_holdings   trades (dedup index)
   (wallet_basis_       position_snapshots   api_keys.last_fetched_trade_timestamp
    mismatch, F5)

   Counts-only probe (scripts/bybitreads_probe.py): same exchange view, GET only, redacted k1..kN.
```

### Recommended Project Structure (write scopes BY SYMBOL)
```
analytics-service/
├── services/exchange.py        # VREAD-01: new Bybit stable-wallet helper + dispatch in fetch_account_equity_usd /
│                               #            fetch_account_equity_and_upnl_usd   (symbols only)
│                               # VREAD-03: _fetch_raw_trades_bybit (+ one named error class, one contract)
├── services/positions.py       # VREAD-02: _fetch_positions_bybit, _parse_bybit_v5_positions,
│                               #            _normalize_ccxt_position (Bybit arm only), _bybit_ccxt_has_critical_fields
├── services/bybit_unified_flows.py   # VREAD-04: NO code change expected (evidence + pins only)
├── scripts/bybitreads_probe.py       # NEW: counts-only probe (plan 02)
└── tests/                             # flip/extend existing files; new test_bybitreads_probe.py
```
Anything in `run_sync_trades_job`, `advance_fetched_cursor`, `run_stitch_composite_job`, OKX branches or flow kinds is OUT.

### Pattern 1: one contract, one walker (VREAD-03)
**What:** declare a `ProviderPaginationContract` for the execution list and let `walk_paginated` tile `[start, now]`.
**When:** any Bybit read whose request carries a 7-day cap.
**Example (derived from the repo's own contract in `services/bybit_unified_flows.py:201-212`; Bybit limits `[CITED]` below):**
```python
# Source: services/bybit_unified_flows.py (contract shape), services/exchange_pagination.py (driver)
contract = ProviderPaginationContract(
    fetcher="fetch_raw_trades_bybit",
    page_cap=100,                 # per window; 100 rows a page => 10,000 fills a window
    on_ceiling="raise",           # a window above the ceiling refuses by name
    stop_on_short_page=False,     # Bybit is cursor-authoritative
    stuck_cursor_is_stop=True,    # the legacy loop stops on a repeated cursor
    window_max_days=7,            # endTime - startTime <= 7 days
    default_lookback_days=None,   # decided in Open Question 2 (365 recommended)
    ceiling_exc=BybitTradeWindowIncomplete,   # new named error, static text, no venue text
    ceiling_label="BYBIT_EXECUTION_PAGE_CAP",
)
# params per page: {"category":"linear","limit":"100","startTime":str(req.window_start),
#                   "endTime":str(req.window_end)} + cursor
```
Note `walk_paginated._windows` yields `w_end = min(w_start + 7d, now_ms)` and `w_start = w_end + 1`: exactly 7 days between bounds, allowed by "endTime - startTime <= 7 days" `[CITED]`. Dedupe by `execId` after the walk (the unified-flows reader does the same with `seen`); the `trades` unique index already absorbs duplicates.

### Pattern 2: venue-by-path census as the plan-01 deliverable
The census table below is ready to paste into `231-CENSUS.md`; every row ends in a disposition. Rows marked "decided" carry the existing test that pins them, or a NEW test the named plan must add.

### Anti-Patterns to Avoid
- **Pinning a mock written from the parser's own field names.** Build ccxt markets from the recorded cassette (see Code Examples) and parse real-shaped rows through `exchange.parse_position`.
- **A refusal that only raises.** See F4: raising from the reader does not hold the cursor.
- **A second stable-coin set.** A literal `{"USDT","USDC"}` in the anchor is the defect class this phase removes.
- **Editing `run_sync_trades_job`, composite files, OKX branches** (out of scope; shared with 222/232).
- **Putting an address, key id, amount or PROD id in any tracked text, including probe records and SUMMARY blocks.**

## The census (ready table for `231-CENSUS.md`)

Axes: **C**oin, **S**ettle type / category, **W**indow, **F**low source. "Plan" names the plan the planner should create (suggested numbering in "Suggested plan split"). `[V]` = read this session with `Read`; `[R]` = executed offline.

| # | Path (file:symbol) | Axis | Coverage today | Gap | Disposition |
|---|---|---|---|---|---|
| C01 | `services/exchange.py:3101` `fetch_usdt_balance_with_status`, via `fetch_account_equity_and_upnl_usd` (`:3262`); called by the derive at `services/job_worker.py:8568` | C | `balance["total"]["USDT"]` only (`:3139`); ccxt `total` is each coin's `walletBalance` [V][R] | USDC, DAI, FDUSD, USDE... wallet balances never enter the anchor | **Fix in plan VREAD-01 (anchor, last wave)** |
| C02 | `services/exchange.py:3237` `fetch_account_equity_usd` (2-tuple); only production caller `scripts/bybit_reconcile.py:651` | C | same helper as C01 | would diverge from C01 unless routed identically (F7) | **Fix in plan VREAD-01** (same Bybit helper) |
| C03 | `services/job_worker.py:12822` composite call `fetch_account_equity_and_upnl_usd(ctx.exchange, venue)` | C | same as C01 | none beyond C01 | **Fixed by inheritance of C01; no composite file edit.** Pinned by the VREAD-01 unit test on the shared function. Composite flows stay on-chain (223), unchanged |
| C04 | `scripts/derivegaps_probe.py:842` (probe equity read) | C | same as C01 | tooling only | Inherits; no edit |
| C05 | `fetch_usdt_balance(exchange)` callers: `services/job_worker.py:2178` (strategy sync), `routers/cron.py:1055`, `routers/exchange.py:2023`, `routers/portfolio.py:2600`; all write `api_keys.account_balance_usdt` or feed `trades_to_daily_returns(account_balance=)` | C | USDT only | A Bybit account with USDC collateral has its initial-capital input understated | **Decided (recommended Option A): USDT by the column's own name; pinned by a NEW `tests/test_exchange.py` case: a mixed USDT+USDC real-parsed Bybit balance through `fetch_usdt_balance` returns the USDT figure.** Founder-visible: report the remaining narrowness. Alternative Option B in "VREAD-01 design" |
| C06 | `services/equity_reconstruction.py:1024` `_read_bybit_uta_mark` + `:634` `_price_wallet_totals` (the Bybit mark) | C | every held asset priced: stable at 1.0 via `is_stable_value`, others via `fetch_ticker`; borrow, isolated margin, UTA 1.0 refused by name [V] | none | **Decided: no gap.** Pinned by `tests/test_nav_marks_bybit_uta.py`: `test_uta_total_is_the_bybit_mark`, `test_non_usdt_collateral_beyond_tolerance_stays_refused_by_name`, `test_a_stablecoin_only_account_needs_no_ticker` |
| C07 | `services/equity_reconstruction.py:815` `_fetch_current_equity` Bybit arm | C, S | sums every coin and adds `exchange.fetch_positions()` uPnL (USDT-linear default, one page of 200) | In production Bybit no longer reaches it: `read_marked_equity_usd` routes Bybit to `_read_bybit_uta_mark` (`:1410-1412`); it survives as the test oracle and for Binance | **Decided: not reached for Bybit in production; pinned by `tests/test_nav_marks_bybit_uta.py::test_forced_rebuild_path_keeps_its_perp_upl_check` and `::test_the_derive_stores_the_uta_total_and_makes_no_positions_call`, and by `tests/test_upnl_venues.py` oracle tests.** Note in the census that its `fetch_positions()` is USDT-linear |
| C08 | Holdings spot rows `allocator_positions._fetch_spot_rows` / `_extract_bybit_unified_walletbalances` (`:392`) | C | every coin with `walletBalance > 0` of the UNIFIED row | none | **Decided: no gap.** Pinned by `tests/test_upnl_venues.py::test_holdings_bybit_spot_row_is_wallet_balance_and_derivative_row_carries_upnl` |
| C09 | `services/positions.py:362` `_fetch_positions_bybit`, ccxt call `exchange.fetch_positions()` | S | ccxt sends `settleCoin=USDT, category=linear, limit=200` [R] | USDC-settled linear and inverse positions missing, so their uPnL is missing from AUM (spot + derivative uPnL) | **Fix in plan VREAD-02** |
| C10 | same function, raw fallback `private_get_v5_position_list({"category":"linear","settleCoin":"USDT"})` (`:372-374`) | S | USDT-linear, NO `limit` (venue default 20 `[CITED]`), NO cursor | silent truncation above 20 positions; same settle gap as C09 | **Fix in plan VREAD-02** (limit 200, follow `nextPageCursor`, three requests) |
| C11 | ccxt page ceiling: `fetch_positions` sends `limit=200` and does not page by default [V][R] | W | one page | a book of 200 or more rows may be truncated; `services/equity_reconstruction.py:600-613` already treats `>= _POSITIONS_PAGE_LIMIT` as unprovable for the forced path | **Fix in plan VREAD-02:** refuse by name when any category returns a full page (or page with `paginate`) |
| C12 | second `positions.fetch_positions` caller: `run_poll_positions_job` (`services/job_worker.py:14665`) writing `position_snapshots` (conflict key strategy_id, snapshot_date, symbol, side) | S | USDT-linear | inherits C09-C13; adds 2 reads per poll | **Fixed by inheritance of VREAD-02;** test: the poll job's output for a USDC row carries the corrected symbol and USD fields |
| C13 | `services/positions.py:233` `_normalize_ccxt_position` and `:50` `_parse_bybit_v5_positions` | C, S | symbol strip handles `:USDT` and `:USD` only; `size_usd` = ccxt `notional`; `unrealized_pnl` passes through | USDC symbol garbled, inverse symbol keeps a colon, inverse `size_usd`/uPnL are coin units; raw parser is category-blind | **Fix in plan VREAD-02** (see "VREAD-02 design") |
| C14 | `services/exchange.py:2768` `_fetch_raw_trades_bybit` | W | `startTime` on the first page only, no `endTime`, cursor pages carry no start, `PAGE_CAP = 100` pages total, `limit` 100 | a start older than 7 days may read only start..start+7d and end on an empty cursor, silently | **Fix in plan VREAD-03 if the probe shows truncation or is undecided; if the probe disproves it, record that with a test.** The windowed walk is correct either way and is the recommended default |
| C15a | `fetch_raw_trades` caller 1: strategy sync `services/job_worker.py:2213` (`fills_since_ms` from cursor, else daily high-water, else None) | W | see C14 and C16 | start can be old (stale cursor) or None | **Fix in plan VREAD-03**; the cursor gate is NOT edited (F4) |
| C15b | caller 2: `run_reconcile_strategy_job` (`services/job_worker.py:15226`, `since = now - 24h`) | W | one 24 h read | none (under 7 days) | **Decided: a 24 h start is one window; pinned by a NEW VREAD-03 test asserting exactly one `execution_list` request for a 24 h start** |
| C16 | `since_ms=None` into `_fetch_raw_trades_bybit` (no `startTime`) | W | venue returns last 7 days [CITED] | a first sync reaches 7 days, not history (F3) | **Open Question 2; recommended: fix in plan VREAD-03 with a 365-day default**, flipping `tests/test_exchange.py::TestClusterIBybitPageCapTruncationFlag::test_bybit_page_cap_records_dq_flag` and the two other `since_ms=None` Bybit cursor tests deliberately |
| C17 | `_BYBIT_FILL_CATEGORIES = frozenset({"linear"})` (`services/exchange.py:468`) | S | linear only; inverse and spot raise `ValueError` with DQ flag `bybit_unsupported_category`. Linear includes USDC perps/futures: the recorded cassette lists `BTCPERP` (settleCoin USDC) under `category=linear` [R] | inverse and spot fills are not read | **Decided:** pinned by `tests/test_exchange.py::TestClusterIC1301BybitCategoryGuard` (`test_default_category_linear_passes`, `test_inverse_category_rejected_with_dq_flag`, `test_spot_category_rejected_with_dq_flag`). Inverse fills need a contractSize rescale (documented in the constant's comment) |
| C18 | `fetch_daily_pnl` Bybit branch (`services/exchange.py:1872-2011`) | S, W | closed-pnl `category=linear` (USDT and USDC perps), 7-day windows with explicit `endTime`, +1 ms boundary, 365-day default when `since_ms=None`, per-window page cap 200, deadline flag | inverse realized P&L is never read (derive silently has none) | **Window: decided, pinned by `tests/test_exchange.py::TestBybitDailyPnlStartTimePagination`. Inverse: DECISION NEEDED (D4)**, evidence from the probe's `inverse_closed_pnl_rows_30d` and the 167.2.1.1 reading (k6: `non_usdt_coins_present` false, 2026-10-22) |
| C19 | `fetch_funding_bybit` (`services/funding_fetch.py:652`) | S, C, W | categories `linear` and `inverse`, `walk_paginated`, 7-day windows, 365-day default | `funding_rows_to_daily_pnl_records` (`services/broker_dailies.py:184`) sums `row["amount"]` at face value with no currency check, so an inverse (coin) funding row is added as USD | **Window: decided, pinned by `tests/test_funding_fetch.py::TestC3001BybitSevenDayWindowWalking::test_since_ms_none_defaults_to_365_day_lookback`. Currency: D4** (same decision as C18). USDC funding is face-value correct |
| C20 | `fetch_bybit_unified_flows` (`services/bybit_unified_flows.py:144`) | F, W | TRANSFER_IN and TRANSFER_OUT only, UNIFIED account, 7-day windows, 50 rows a page, page cap 200 raising `BybitUnifiedFlowReadError` | other transaction types (Earn, bonus) are not flows (documented limitation); owned by Phase 223 | **Decided here; kinds owned by 223.** Pinned by `tests/test_bybit_unified_flows.py::test_the_unified_read_asks_both_types_over_tiled_seven_day_windows` and `::test_a_window_past_the_page_cap_raises` |
| C21 | `fetch_ccxt_transfers` Bybit branch (`services/ccxt_flow_fetch.py`) | F, W | on-chain deposit/withdraw records, 30-day windows, cursor, `TransferPageStalled` on a stalled cursor; read for Bybit only by the composite | composite is out of scope | **Decided: out of scope (composite; 223).** The probe reuses it read-only |
| C22 | `pair_onchain_with_unified` (pure) | F | pairs by currency, absolute amount (fee-aware for withdrawals), order and a 30-day window | probe-only caller | **Decided; pinned by `tests/test_bybit_unified_flows.py` pairing tests (355-527)** |
| C23 | flow-source choice, derive Bybit arm `services/job_worker.py:8773-8809` | F | `replace`: Unified rows only; on-chain never read | undecided on evidence (186-04: 0 on-chain rows) | **VREAD-04: evidence plan; verdict from the probe; stays `replace`** unless the probe shows unpaired on-chain deposits. Pinned by `tests/test_derive_broker_dailies_dualmode.py::TestBybitUnifiedFlowSource::test_unified_rows_replace_the_on_chain_reads_and_count_once` |
| C24 | `services/exchange.py:3412` `fetch_mark_prices` Bybit branch | S | `category=linear` tickers only | **no production caller** (callers: a docstring in `equity_reconstruction.py:1468` and tests only) | **Decided: dead for production; pinned by `tests/test_exchange.py` (the PR #181 take-2 Bybit WARNING test near `:3696-3780`) and `tests/test_fetch_mark_prices.py`** |
| C25 | `scripts/bybit_upnl_probe.py` positions read `{"category":"linear","settleCoin":"USDT"}` | S | tooling | tooling only | **Decided: leave;** pinned by `tests/test_bybit_upnl_probe.py:318` |
| C26 | `services/okx_archive_job.py:1674` equity call | n/a | OKX only | not Bybit | not a Bybit row |

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| 7-day windows with cursor and ceiling | a new while-loop for the execution list | `walk_paginated` + `ProviderPaginationContract` | the +1 ms boundary, the ceiling raise and the bimodal stop discipline are already encoded and tested (`tests/test_exchange_pagination.py`) |
| Stable-coin rule | a literal coin set in the anchor | `price_rule.is_stable_value` | one definition; a test monkeypatches `price_rule._STABLE_VALUE` to prove both reads follow it |
| Read-only probe harness | a new recording client | `ReadOnlyRecordingExchange`, `ReadOnlySupabase`, `eligible_key_predicate`, `_make_exchange_client`, `emit_record` pattern | reviewed in 186; resolves `private_get_*`, `privateGet*`, `fetch_balance`, the two pure ccxt helpers |
| Deposit/Unified pairing | a second matching rule | `pair_onchain_with_unified` | one rule shared with the probe, by 186-03's design |
| Symbol/unit handling for inverse | trusting ccxt `notional`/`unrealizedPnl` | the raw `info` fields, as `_normalize_deribit_position` does | coin-denominated; the Deribit branch is the in-repo precedent |
| Error text in logs | `str(exc)` | `scrub_freeform_string`, exception class only | NEW-C13-10: ccxt error text can carry the request signature |

**Key insight:** this phase is a census of a class, not four bug fixes. The recurring failure is fixing the one coin or venue the evidence names and leaving a sibling path on the old rule, so every code change needs a sibling-path test.

## Per-requirement design

### VREAD-01: the derive anchor (plan in the LAST wave, blocked on Phase 229 merged)

**What the anchor reads today.** `fetch_account_equity_and_upnl_usd` for Bybit returns `(equity, balance_error, 0.0, False)` from `fetch_usdt_balance_with_status`, which does `balance.get("total", {}).get("USDT", 0)` and returns it only when `> 0` (`services/exchange.py:3139-3141` [V]). ccxt 4.5.89 `bybit.parse_balance` sets each coin's `account['total']` from the coin's `walletBalance` (`coinEntry` loop in `parse_balance`; code key from `safe_currency_code(coin)`), so `balance["total"]` is `{coin: walletBalance}` for every coin of the UNIFIED/CONTRACT/SPOT row [V: read in the 4.5.89 wheel; the 4.5.64 and 4.5.89 `parse_balance` differ only in typing and a `code is not None` guard]. The repo's own pin proves it (`tests/test_upnl_venues.py:187-209`).

**`is_stable_value`** (`services/price_rule.py:99-101` [V]): `return asset.upper() in _STABLE_VALUE`, with `_STABLE_VALUE: Final[frozenset[str]] = STABLECOINS | STABLECOIN_SPLIT_SUFFIXES` (`price_rule.py:82` [V]). Verbatim members: `STABLECOINS = frozenset({"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"})` and `STABLECOIN_SPLIT_SUFFIXES = frozenset({"USDE", "PYUSD", "USDB"})` (`services/closed_sets.py:255-264` [V]). `_price_wallet_totals` already applies it and prices every other coin by `fetch_ticker` (`services/equity_reconstruction.py:634-710` [V]).

**Recommended helper (Option A).** One new module-level function in `services/exchange.py`, say `fetch_bybit_stable_wallet_with_status(exchange) -> tuple[float | None, bool]`, mirroring `fetch_usdt_balance_with_status`'s contract exactly (`(float, False)` positive; `(None, False)` zero/absent; `(None, True)` read failure or malformed shape), summing every coin for which `is_stable_value(coin)` is true and `qty > 0`. Dispatch it from BOTH `fetch_account_equity_usd` and `fetch_account_equity_and_upnl_usd` when `venue == "bybit"`. Keep the wedge a hard-coded `0.0`, `upnl_unreadable` `False`. Do not import `services.job_worker` (cycle risk); importing `services.price_rule` is safe (it imports only `services.closed_sets`).
- Mirror the mark path on non-positive coins: `_price_wallet_totals` skips `q <= 0`; a stable coin with a negative `walletBalance` (spot borrow) must not reduce the anchor silently. (The mark already refuses `borrow_present`.)
- Fail loud on a malformed STABLE coin quantity (the existing helper treats a malformed USDT as an error read); do not parse non-stable coins at all, so a garbled BTC cannot fail the anchor.

**Option B (not recommended):** put the same sum inside `fetch_usdt_balance_with_status` behind `exchange.id == "bybit"`. CONTEXT allows it ("the Bybit arm of the balance read") and it leaves `test_bybit_binance_wedge_zero` valid, but it also changes every `fetch_usdt_balance` caller: `api_keys.account_balance_usdt` (a column named USDT, written by `routers/cron.py:1235`, `routers/exchange.py:2045`, `services/job_worker.py` sync epilogue) and strategy `trades_to_daily_returns(account_balance=)` capital. That moves stored strategy figures for any Bybit key holding USDC, beyond "the anchor". Put the choice to the founder (Open Question 1); the recommendation is A with census row C05 recorded as decided.

**The pin flips, it is not deleted.** In `tests/test_upnl_venues.py:383-406` keep the fixture (`bybit_coin("USDT","1000","250.5")`, `bybit_coin("USDC","200","0")`, `BYBIT_LINEAR_POSITIONS`) and change the assertions to: `derive == 1200.0`, `_wedge == 0.0`, `_err is False`, `reconstruct == pytest.approx(1450.5, abs=1e-9)`, and add `reconstruct == pytest.approx(derive + 250.5, abs=1e-9)`. Rename it (`..._derive_and_reconstruct_sum_the_same_stable_coins`) and keep the old name's TODOS id in the docstring. RED-first: run the flipped test on today's code; the first failure must be `derive == 1200.0` reading 1000.0.

**Every test that moves or must be added (grepped across `analytics-service/tests`):**
| Test | Why it moves |
|---|---|
| `tests/test_upnl_venues.py::test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin` | the intended flip |
| `tests/test_exchange.py:5852` `test_bybit_binance_wedge_zero` | patches `fetch_usdt_balance_with_status` for the `bybit` iteration; under Option A split it per venue (Bybit half patches the new helper). Flip, never delete |
| `tests/test_nav_marks_l4_read.py:866-935` (`test_the_dry_run_sequence_reaches_the_verdict_the_derive_stores`, `{"USDT":1000,"BTC":0.1}` case) | stays green (BTC is not stable) and is the F5 pin that non-stable collateral is still `wallet_basis_mismatch`; ADD a USDC case that is now admitted |
| NEW: shared-constant proof | `monkeypatch.setattr(services.price_rule, "_STABLE_VALUE", <set plus a synthetic code>)`, then show BOTH the new anchor and `_price_wallet_totals` include it; RED if the helper hard-codes `{"USDT","USDC"}` |
| NEW: error and edge arms | `fetch_balance` raises -> `(None, True)` with the class-only log; malformed stable quantity -> `(None, True)`; all stable zero -> `(None, False)`; negative stable coin skipped; non-stable coin ignored; Binance unchanged (`tests/test_upnl_venues_binance.py` stays green) |
| Callers that patch the helper whole (`test_job_worker_flipretry.py`, `test_derive_broker_dailies_dualmode.py`, `test_stitch_composite_job.py`, `test_okx_archive_apply.py`, ...) | unaffected |

**Why it waits for 229.** `key_inputs.anchor_usd` is the S1 to S2 contract (`ARCHITECTURE.md` seam table); 229 changes the same contract's reader (`read_writer_basis`). Write the plan now; mark its first task `checkpoint:decision` "Phase 229 merged to main" and write no SUMMARY while blocked.

### VREAD-02: the holdings poll

**Request shapes (executed offline on the ccxt 4.5.89 wheel, `request` recorded by a fake `privateGetV5PositionList`):**
| Call | Request sent to Bybit |
|---|---|
| `fetch_positions()` | `{"settleCoin":"USDT","limit":200,"category":"linear"}` |
| `fetch_positions(None, {"settleCoin":"USDC"})` | `{"settleCoin":"USDC","limit":200,"category":"linear"}` |
| `fetch_positions(None, {"subType":"inverse"})` | `{"category":"inverse","limit":200}` (no settleCoin; the doc says an inverse query without a symbol returns all open inverse positions `[CITED]`) |
| raw `private_get_v5_position_list(...)` | what we send is exactly the params; `limit` must be added (`[1,200]`, default 20 `[CITED]`) and `nextPageCursor` followed |

ccxt does not page by default and a full 200-row answer cannot be told apart from a truncated one (`services/equity_reconstruction.py:598-613` already reasons this way for the forced path). Refuse by name when any ccxt category answers 200 or more rows, or pass `{"paginate": True}` (ccxt `fetch_paginated_call_cursor`, cursor key `nextPageCursor`); choose one and test it.

**Per-field output spec, all four parser cases (the trap the planner must close).** Fields produced by `_normalize_ccxt_position` / `_parse_bybit_v5_positions` (`services/positions.py:50-102`, `:233-272` [V]):
| Output field | linear USDT (today) | linear USDC | inverse |
|---|---|---|---|
| `symbol` | strip `/`, `:USDT`, `:USD` of the ccxt symbol | use the raw id `info["symbol"]` (e.g. `BTCPERP`): stripping gives `BTCUSDCC` [R] | use `info["symbol"]` (e.g. `BTCUSD`): stripping leaves `BTCUSD:BTC`, whose colon fails `HOLDING_REF_RE` [R] |
| `size_base` | `contracts * contractSize` (base qty) | same | base-coin qty = `size_usd / mark` (ccxt `contracts` is USD contracts here, `contractSize` 1 [R]) |
| `size_usd` | ccxt `notional` (USDT value) | ccxt `notional` (USDC value, treated as USD, the stable rule) | `notional_coin * mark` (ccxt `notional` is coin: `size*contractSize/markPrice` [V]); raw path: `float(positionValue) * mark` |
| `entry_price`, `mark_price` | as today | as today | USD per coin, as today |
| `unrealized_pnl` | as today | as today (USDC counted as USD) | `coin_upnl * mark`; `None` stays `None` (the reported-vs-absent rule, `reported_pnl`) |
Rows keep stored keys for USDT unchanged (do NOT re-derive `BTCUSDT-27DEC24` style dated symbols; the ccxt and raw paths already differ there and orphaning `allocator_holdings` rows is a data-migration decision, per the comment at `allocator_positions.py:1371-1374`). An inverse row whose mark is `None`, non-finite or `<= 0` raises a typed named error (static text); `_normalize_ccxt_positions` keeps Bybit fail-loud (only Deribit skips per position, `positions.py:297-331`).

**How a failed sub-read surfaces.** Each of the three requests is awaited without a swallow, so an exception propagates. `fetch_allocator_holdings` already turns a retryable derivative-side failure into partial success with the fixed copy `DERIVATIVE_FETCH_FAILED_NOTE` and keeps spot rows; a permanent one re-raises (`services/allocator_positions.py:1747-1801` [V]). `run_poll_positions_job` (strategy snapshots) fails the job. That meets "refuses by name, never a silent partial": no category's rows ship if another category failed. Risk (Pitfall 6): a key that cannot read `category=inverse` would lose ALL derivative rows daily; the probe's per-category `read_state` is the evidence before merge.

**Fixtures from recorded real shapes.** `tests/cassettes/bybit/happy.yaml` is a recorded Bybit session. Its `instruments-info` replies for `category=linear` (652 symbols, including `BTCPERP` with `settleCoin` USDC) and `category=inverse` (26 symbols, including `BTCUSD`, `settleCoin` BTC) build REAL ccxt markets offline (Code Examples). Position rows themselves are Bybit-documented shapes with typed arithmetic beside them (the cassette holds no position-list reply; the same is true of the existing `BYBIT_V5_RAW_RESPONSE`).

### VREAD-03: the strategy trade sync window

**Venue semantics `[CITED: Bybit v5 execution/list doc]`:** `limit` is `[1,100]`, default 50; neither time bound passed returns 7 days; only `startTime` returns startTime..startTime+7 days; only `endTime` returns endTime-7 days..endTime; if both are passed `endTime - startTime <= 7 days`; categories `linear, inverse, spot, option`. The doc page does not state retention; its navigation label reads "Get Trade History (2 years)". A start older than two years is rejected (retCode 10001), measured on PROD 2026-10-23 per the deleted rebuild's comment (`git show 6c919f4f7^:analytics-service/services/equity_reconstruction.py`, lines 121-125 [V via git]). The cursor: the current loop sends `startTime` only on the first page and follows `nextPageCursor` until it is empty, so whether the cursor continues past start+7d is exactly what the probe measures; the doc is silent.

**Today's callers and starts.** (1) strategy sync, `services/job_worker.py:2207-2213`: cursor, else high-water, else `None`; the fetch applies `OVERLAP_WINDOW_MS = 3_600_000` (`exchange.py:628`) before the venue call. (2) reconcile, `:15226`, `now - 24h`. The whole-job fallthrough: a successful complete read advances the cursor to now.

**Fix (recommended; probe-independent because it is correct under every venue semantic):** replace the single cursor loop by `walk_paginated` per Pattern 1, keep `limit=100`, dedupe by `execId`, keep the existing per-fill validation block verbatim (the `_finite_positive_decimal`, `execTime`, fee, maker handling at `exchange.py:2813-2898` is out of the change), and on a window that hits its page cap raise `BybitTradeWindowIncomplete` (a new class beside the call, static text: no counts, no symbols, no venue text). Also guard the two-year start: refuse by name with `ccxt.BadRequest`-class text (the deleted rebuild refused, never clamped, so the replay's opening balance cannot be wrong).

**Sizing the per-window page cap is a real planning input.** The 186-04 probe measured 44 closed-pnl pages (about 4,400 closes) in the one PROD key's busiest 7-day window. A close generally has more than one execution, so a busy week can exceed 100 execution pages (10,000 fills), which is today's TOTAL ceiling and silently truncates with a flag. The probe records the deepest 7-day window's page count; set the cap from that measurement (186's own precedent: 50 had 12% headroom and was raised to 200). Segment continuation by time (the deleted `_read_bybit_window`) is the fallback if one window cannot fit; do not rebuild it unless the probe shows the need.

**Do not edit** `run_sync_trades_job` (F4). The complete windowed read makes the refusal rare; the dependency "232/222 gate `advance_fetched_cursor` on `not phase2_failed`" goes in the plan SUMMARY and on the Phase 232 hand-off.

### VREAD-04: the on-chain deposit

**What 186 measured.** Probe record from 186-04 (run on the backfill worker, one measured Bybit key, UTA): `bybit_onchain_rows` 0, `bybit_unified_rows` 6, `bybit_paired_rows` 0, `bybit_unpaired_onchain_rows` 0, `bybit_pairing_unreadable_rows` 0, `bybit_near_miss_rows` 0; `g2-flow-verdict: replace (no on-chain rows on PROD)`. With zero on-chain rows replace and union give identical flows, so the verdict rested on no evidence (the TODOS entry says so).

**Where `replace` is implemented.** `services/job_worker.py:8773-8809`: for `venue == "bybit"` the derive awaits only `fetch_bybit_unified_flows(ctx.exchange, _flow_since_ms, now_ms)`; `fetch_ccxt_transfers` is never called (pinned by `...::TestBybitUnifiedFlowSource::test_unified_rows_replace_the_on_chain_reads_and_count_once` with `seen["mocks"]["transfers"].assert_not_awaited()`). The composite, which this milestone does not touch, still reads on-chain rows only (`job_worker.py:12829+`).

**What an unpaired on-chain deposit does today.** Nothing, because no code path sees it (F6). The distortion exists only if a deposit reaches the Unified wallet WITHOUT a Unified TRANSFER_IN row: NAV rises, the flow term `F_t` carries nothing, and the day books as a return (`tests/test_derive_broker_dailies_dualmode.py:3270-3273` asserts "the spike a missing flow makes" at `>= 0.4`). Whether Bybit logs a direct on-chain credit to a Unified wallet as `TRANSFER_IN` is not in the docs: the UTA transaction-log enum has `TRANSFER_IN` ("Assets that transferred into Unified wallet") and no deposit type `[CITED]`, and the deposit-record response carries no account-type field `[CITED]`. That is why only data can decide it.

**Decision rule (what the probe may conclude, per key and in the summary):**
| Observation (window `now-729d..now`, or the venue's refusal recorded as a state) | Verdict token | Action |
|---|---|---|
| `onchain_deposits + onchain_withdrawals == 0` (no distinguishing row) | `undecided` | Keep `replace`. Record counts. This is a valid close of VREAD-04 ("recorded as undecided") |
| on-chain rows > 0 and `unpaired_onchain_* == 0` and `unreadable == 0` | `replace_supported` | Record; keep `replace`; delete the TODOS entry |
| on-chain rows > 0, some unpaired, `near_miss_rows > 0` | `undecided_near_miss` | Do not decide on counts; founder question with the counts |
| on-chain rows > 0, unpaired > 0, `near_miss_rows == 0` | `unpaired_present` | **Do not switch to union on counts alone**: an unpaired deposit may be parked in the Funding account and never have reached the Unified wallet, where dropping it is correct. Founder question with counts; optional discriminator (Funding-account coin balance covering the unpaired amount, `[ASSUMED]` endpoint) |
The planner should expect `undecided` (one live key, zero on-chain rows on 2026-11-03) and design the plan so that outcome closes the requirement cleanly: SUMMARY carries the counts, the TODOS entry is deleted in the ship PR with the verdict named in the CHANGELOG, and the existing replace pin stays.

### VREAD-05: founder instructions (draft; the address never enters tracked text)

Evidence first (CONTEXT): 2 `failed_final` IP errors (2026-10-07/08), then 31 consecutive `done` first-attempt derives 2026-10-24..2026-11-23, no error. So the step is a confirmation as much as an action.

1. In Railway, for each of the two services `quantalyze-analytics-backfill` and `quantalyze-analytics`: Settings tab, Networking section, toggle "Enable Static IPs", read the IPv4 addresses shown for the service's region, then redeploy the service. Pro plan required; Railway documents three addresses per service with traffic balanced across them, region-bound (they change if the service moves region), and redeploy before traffic uses them `[CITED: docs.railway.com/networking/static-outbound-ips]`.
2. In Bybit, API management, the connected key, edit the IP restriction and add EVERY address Railway showed for both services. Keep the existing entries until step 3 passes. `[ASSUMED]` that Bybit accepts that many entries and that saving does not rotate the secret.
3. Confirmation: the orchestrator reads, counts only, after the next scheduled derive: the key's `derive_broker_dailies` status for the day after the change reads `done` with `attempts = 1`. A green Railway toggle without a `done` derive is not a close (TODOS gate).
4. Tell the orchestrator, in one message: (a) which of "static IPs enabled and allow-listed", "the key's IP restriction was removed", "neither / do not know" happened between 2026-10-09 and 2026-10-24, (b) the DATE, (c) whether the allow-list still holds only the old entry. The orchestrator records the date and the choice (not the addresses) in the plan SUMMARY and deletes `167.1.2.2-BYBIT-STATIC-EGRESS` from `TODOS.md` in the ship PR.
5. Follow-up, not this phase: `/security#egress-ips` (`src/app/(marketing)/security/page.tsx:602`) says no static egress exists; Phase 201 U-29/A-12 holds the instruction to replace it with the address list from a server-only source. Do that only if the founder wants the address published.

## Counts-only probe design (`analytics-service/scripts/bybitreads_probe.py`)

**Why a new, smaller script and not a re-run of `derivegaps_probe`.** Re-running `derivegaps_probe` as-is works (its Gap 2 section `measure_bybit_flows` emits `bybit_onchain_rows`, `bybit_paired_rows`, `bybit_unpaired_onchain_rows`, `bybit_near_miss_rows`, and `unified_*`), but the one Bybit key's non-realized read took 413 s and its realized read 269 s (186-04), it covers OKX and Binance keys, its window is `flow_retention_floor("bybit")` = 365 days (`services/nav_twr.py:125`), and it never reads executions or positions. VREAD-03 needs a new measurement; VREAD-04 benefits from a wider window. A sibling script reusing `ReadOnlyRecordingExchange`, `emit_record`'s validation pattern, `ReadOnlySupabase`, `eligible_key_predicate`, `read_key_info`, `fetch_ccxt_transfers`, `fetch_bybit_unified_flows` and `pair_onchain_with_unified` is smaller and faster to review.

**Measure the venue, not our function.** The probe ships BEFORE the fix, and after the fix `_fetch_raw_trades_bybit` is the windowed read, so a probe that calls it would stop measuring the legacy behaviour. Issue the legacy request shape and the windowed shape directly through the recording view (`private_get_v5_execution_list`).

Per eligible Bybit key, label `k1..kN`:
| Section | Reads (GET only, in memory) | Printed fields (counts, booleans, closed tokens, 3-sig-fig seconds, age buckets) |
|---|---|---|
| A. Trades window (VREAD-03) | start = fixed `now - 22d` (three full 7-day windows plus a stub): (a) legacy shape (`startTime` first page, cursor pages, no `endTime`), page ceiling 100; (b) windowed shape, 7-day windows with `endTime`, cursor per window, `limit` 100; (c) start-less (neither bound) | `legacy_rows`, `legacy_pages`, `legacy_end` (`empty_cursor`, `empty_page`, `page_cap`, `stuck`), `windowed_rows`, `windowed_pages_max_in_window`, `rows_after_first_week` (windowed rows with `execTime > start+7d`), `cursor_continues_past_7d` (legacy newest `execTime > start+7d`), `startless_rows` vs `last7d_windowed_rows`, **`informative`** (= `rows_after_first_week > 0`), verdict token `truncated` / `not_truncated` / `undecided` (undecided when not informative; mirrors 186's `bybit_limit_probe_informative` discipline) |
| B. Deposits (VREAD-04) | real `fetch_ccxt_transfers` (deposits, withdrawals) and `fetch_bybit_unified_flows` over `now-729d..now`; `pair_onchain_with_unified` | `onchain_deposits`, `onchain_withdrawals`, `unified_in`, `unified_out`, `paired_*`, `unpaired_onchain_*`, `near_miss_rows`, `unreadable_rows`, read states (`complete`, `failed`, `reader_error`), verdict token per the decision table |
| C. Exposure counts (census evidence) | `fetch_balance` totals; `private_get_v5_position_list` for linear USDT, linear USDC, inverse (limit 200); `private_get_v5_position_closed_pnl` `category=inverse` over 30 days | `stable_non_usdt_present`, `nonstable_present` (via `is_stable_value`), `positions_open_{linear_usdt,linear_usdc,inverse}`, per-category `read_state` (`ok`, `refused`), `inverse_closed_pnl_rows_30d` |
Output contract: copy `emit_record`'s refusal of unknown keys and out-of-vocabulary values and the `assert_sanitized` re-check; `field-absent` for not measured, never 0; no amount, id, symbol or timestamp finer than the run date; logging disabled; exception TYPE only on stderr. Own `deploy_fingerprint()` (e.g. `bybitreads <EXIT_OK> <EXIT_FAILED> <len(KEY_RECORD_KEYS)> <len(SUMMARY_RECORD_KEYS)> <len(VERDICTS)>`) and exit codes 0/1 as in `derivegaps_probe`. Call ceiling per key about 1,000 (A about 500, B about 300, C about 50).

**Run protocol (orchestrator, not an executor), as 186-04 did it.** After the probe PR merges and Railway deploys the merge commit: obtain the founder's explicit approval for the start-command change in that session (186-04's rule: "a probe or a start-command change needs explicit approval each time" `[CITED: 186-04-PLAN.md]`); compute `deploy_fingerprint()` at the reviewed commit; set a temporary `sh -c` start command on the backfill worker that prints `IMPORT231 <fingerprint>`, runs `python -m scripts.bybitreads_probe` in the background, prints `probe-exit: $?`, then `exec`s `python -m main_worker`; redeploy from source; compare the printed fingerprint; read the records from the service log (Railway parses JSON stdout into attributes; 186-04 rebuilt each record by decoding the attributes, sorting keys, compact separators); immediately restore the original start command and redeploy; confirm the normal startup line and no `IMPORT231` / `probe-exit:` line; record `worker-restored: yes`. Never `railway ssh`. Never record an address, key id, amount or home path.

**PROD key linkage (Open Question 6).** The live Bybit key is the derive/allocator key. Whether a strategy uses a Bybit key at all is not knowable from code; strategies reach keys through `strategies.api_key_id` and `strategy_keys` members (`supabase/schema/baseline.sql:7414` comment `[CITED]`). A counts-only read (marker query first): count of `strategies` rows whose key is an active, connected, non-revoked Bybit key. If zero, the strategy sync path has no live Bybit exposure today, which lowers urgency but not the fix (the wizard can attach one tomorrow).

## Suggested plan split (within CONTEXT's discretion; at most 2 executors at once)

| Plan | Wave | Scope (by symbol) | Notes |
|---|---|---|---|
| 231-01 | 1 | `231-CENSUS.md` (this table re-verified at HEAD) and `231-FOUNDER-VREAD05.md` | read-only; no code; resolve Open Questions 1-5 with the founder before wave 2 |
| 231-02 | 1 (parallel with 01) | `scripts/bybitreads_probe.py`, `tests/test_bybitreads_probe.py` | tooling PR; then ORCHESTRATOR run (checkpoint:human-action for the start-command approval) -> `231-PROBE-RESULT.md` |
| 231-03 | 2 | `positions.py`: `_fetch_positions_bybit`, `_parse_bybit_v5_positions`, `_normalize_ccxt_position` (Bybit arm), new typed error; `tests/test_positions.py`, `tests/test_upnl_venues.py::_fake_bybit` | VREAD-02 |
| 231-04 | 2 (parallel with 03; disjoint symbols) | `exchange.py`: `_fetch_raw_trades_bybit`, one error class, one contract; `tests/test_exchange.py` | VREAD-03; cap sizing from the probe result if available |
| 231-05 | 3 | VREAD-04 verdict record + pins; no service code unless the probe shows `unpaired_present` | docs and tests only |
| 231-06 | last | `exchange.py`: new Bybit stable-wallet helper + the two dispatches; `tests/test_upnl_venues.py`, `tests/test_exchange.py` | VREAD-01; first task blocks on "Phase 229 merged to main"; no SUMMARY while blocked |
| (checkpoint) | end | VREAD-05 founder answer and date | `checkpoint:human-action`; SUMMARY states PASS only after the answer is recorded |

Plans 03/04 and 06 all edit `exchange.py` or `test_exchange.py`/`test_upnl_venues.py`: separate worktrees, explicit `git add` paths, and symbol-level write scopes in each plan's frontmatter because 223 and 232 also edit `exchange.py`, `positions.py`, `bybit_unified_flows.py`.

## Common Pitfalls

### Pitfall 1: mock fan-out turns three category reads into triplicated rows
**What goes wrong:** the existing tests stub `exchange.fetch_positions.return_value = [...]` (an `AsyncMock` returns the same list on every call) and `private_get_v5_position_list.assert_awaited_once()`. With three category calls each returns the same list, so row counts triple and `assert_awaited_once` fails.
**Where:** `tests/test_positions.py` `TestFetchPositionsBybitHappy::test_bybit_ccxt_complete`, `TestFetchPositionsBybitFallback::test_bybit_fallback_to_v5`, `TestBybitV5ReportedPnl::test_ccxt_none_still_routes_to_v5_and_v5_zero_is_a_real_zero`; `tests/test_upnl_venues.py::_fake_bybit` (one `AsyncMock` list for every call; `test_holdings_bybit_spot_row_is_wallet_balance_and_derivative_row_carries_upnl` asserts exactly one derivative row); any `tests/test_allocator_positions.py` Bybit case.
**How to avoid:** make `_fake_bybit` dispatch on `params` (`settleCoin`, `subType`) and flip, never delete, the assertions to "one call per category".

### Pitfall 2: a flat account costs 6 calls per poll
The fallback trigger is `if raw_positions and _bybit_ccxt_has_critical_fields(raw_positions)`, so an EMPTY ccxt list also takes the raw path (`positions.py:367-375`). With three categories a flat account makes three ccxt plus three raw calls. Keep the behaviour (out of scope to change) but state the count in the plan and rate-limit review.

### Pitfall 3: a refusal that does not hold the cursor (F4)
Raising from the reader leaves `raw_fills == []`, `advance_fetched_cursor` becomes `True`, and `last_fetched_trade_timestamp` moves to now (`job_worker.py:2655`), so the unread window is never re-read from the cursor. The windowed read is the protection; the cursor gate is a Phase 232/222 dependency. Pin only what this phase owns: the reader raises a named error on a cap hit.

### Pitfall 4: tests that pass `since_ms=None` into the Bybit reader
`tests/test_exchange.py::TestFetchRawTrades::test_fetch_raw_trades_bybit_cursor` (`:1101`, `await_count == 2`), `::TestG12BPaginationGuards::test_fetch_raw_trades_bybit_stuck_cursor_terminates` (`:2063`, `await_count < 100`) and `::TestClusterIBybitPageCapTruncationFlag::test_bybit_page_cap_records_dq_flag` (`:5051`, 100 pages, flag `sync_truncated_bybit_pages == 100`) all call with no start. A 365-day default (Open Question 2) turns each into 53 windows and exhausts a `side_effect=[page1, page2]` mock. Flip them deliberately (explicit start, or a window-aware fake), recording the old and new expectation, per PITFALLS Pitfall 3.

### Pitfall 5: a fake that shares the bug
A fake `execution_list` that echoes whatever params our code sends proves nothing. Build the fake from the venue's documented rule: filter rows to `[startTime, min(endTime, startTime+7d)]` (or `[start, start+7d]` when only a start is sent, or the last 7 days when neither), refuse `endTime - startTime > 7d`, and serve `nextPageCursor` per page of 100. Then the legacy code is RED because the fake models the venue, not the parser.

### Pitfall 6: refusing on a sub-read can regress a working key
A key whose `category=inverse` position list is refused (an exchange error class) would lose every derivative row under "refuse by name". The probe's section C `read_state` per category is the evidence; if any live key reads `refused`, bring the founder the choice (refuse versus a named, counted partial) before merge. Funding already graceful-skips inverse on `BadRequest`/`PermissionDenied` (`funding_fetch.py:705-735`); do not copy that for positions without the decision.

### Pitfall 7: window-ceiling sizing against real volume
See VREAD-03 sizing. A cap of 100 pages per window may be below a busy week of fills (closed-pnl alone reached 44 pages). Size from the probe; a cap hit raises, never truncates silently.

### Pitfall 8: venue text in logs and refusals
ccxt error text can carry the HMAC signature. Log the exception class and `scrub_freeform_string(str(e))` (NEW-C13-10); error classes raised here carry static text. `phase2_error_message = str(e)[:200]` is written to `strategy_analytics.data_quality_flags`, so the named error's text must be safe to store.

## Code Examples

### The stable-coin wallet sum (shape; adapt names to the plan)
```python
# Source: contract of services/exchange.py:3101 (fetch_usdt_balance_with_status), rule of
# services/price_rule.py:99-101 (is_stable_value), non-positive skip of
# services/equity_reconstruction.py:634-710 (_price_wallet_totals)
from services.price_rule import is_stable_value

async def fetch_bybit_stable_wallet_with_status(exchange: ccxt.Exchange) -> tuple[float | None, bool]:
    try:
        balance = await exchange.fetch_balance()
    except Exception as e:  # NEW-C13-10: class + scrubbed text only
        logger.warning("Could not fetch account balance: exc_class=%s scrubbed=%s",
                       type(e).__name__, scrub_freeform_string(str(e)))
        return None, True
    try:
        totals = balance.get("total", {})
        if not isinstance(totals, dict):
            raise TypeError("balance total is not a mapping")
        stable = 0.0
        for coin, qty in totals.items():
            if qty is None or not is_stable_value(str(coin)):
                continue
            wallet = float(qty)          # a malformed STABLE quantity is an error read
            if wallet > 0:
                stable += wallet
    except (TypeError, ValueError, AttributeError) as e:
        logger.error("Malformed balance response shape: exc_class=%s scrubbed=%s",
                     type(e).__name__, scrub_freeform_string(str(e)))
        return None, True
    return (stable, False) if stable > 0 else (None, False)
```

### Real ccxt markets offline from the recorded cassette (the fixture builder; run on the 4.5.89 wheel in this session)
```python
# Source: analytics-service/tests/cassettes/bybit/happy.yaml (instruments-info replies, category=linear and inverse)
# Output observed: linear BTCUSDT -> BTC/USDT:USDT; linear BTCPERP -> BTC/USDC:USDC; inverse BTCUSD -> BTC/USD:BTC
by_cat = {}  # {"linear": <decoded reply>, "inverse": <decoded reply>} from happy.yaml, skipping status=PreLaunch uris
ex = ccxt_async.bybit({})
async def fake_public(params):
    return {"result": {"list": [], "category": params["category"]}} if params.get("status") == "PreLaunch" else by_cat[params["category"]]
ex.publicGetV5MarketInstrumentsInfo = fake_public
markets = []
for cat in ("linear", "inverse"):
    markets += await ex.fetch_future_markets({"category": cat})
ex.set_markets(markets)
parsed = ex.parse_position({"symbol": "BTCUSD", "side": "Buy", "size": "100", "positionValue": "0.00166667",
                            "avgPrice": "57495", "markPrice": "60000", "unrealisedPnl": "0.00007", "positionIdx": 0})
# observed: contracts 100.0, contractSize 1.0, notional 0.001666..., markPrice 60000.0, unrealizedPnl 7e-05
```

### A fake `execution_list` built from the venue's rule (RED-first for VREAD-03)
```python
# Source: Bybit v5 execution/list doc [CITED] - modelled on the venue, not on our params
SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000
async def execution_list(params, rows, now_ms):          # rows: fills with int execTime, ascending
    start, end = params.get("startTime"), params.get("endTime")
    if start is None and end is None:
        lo, hi = now_ms - SEVEN_DAYS_MS, now_ms
    elif end is None:
        lo, hi = int(start), int(start) + SEVEN_DAYS_MS
    elif start is None:
        lo, hi = int(end) - SEVEN_DAYS_MS, int(end)
    else:
        lo, hi = int(start), int(end)
        assert hi - lo <= SEVEN_DAYS_MS, "venue refuses a span over 7 days"
    window = [r for r in rows if lo <= r["execTime"] <= hi]
    page, cursor = serve_pages(window, limit=int(params["limit"]), cursor=params.get("cursor"))  # 100 per page
    return {"result": {"list": page, "nextPageCursor": cursor}}
```
Assert on fills with ids spread across 22 days: legacy code returns only the first 7 days (RED: the assertion names the first missing `execId`); the windowed read returns all.

### Inverse conversion (the Deribit precedent applied)
```python
# Source: services/positions.py:178-196 (_normalize_deribit_position coin->USD at a rate); ccxt 4.5.89
# bybit.parse_position (notional = size*contractSize/markPrice for inverse markets)
mark = usable_price(raw_mark)                     # services.price_rule.usable_price; None -> refuse the row
if mark is None:
    raise BybitPositionUnpriced("inverse position has no usable mark")   # static text
size_usd = coin_notional * mark                   # ccxt notional, or float(positionValue) on the raw path
unrealized_usd = None if coin_upnl is None else coin_upnl * mark
```

## State of the Art

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| Allocator rebuild read executions in 7-day windows (`_read_bybit_window`) | Reader deleted; flows, funding and closed-pnl use `walk_paginated` / the closed-pnl loop | Phase 176 (`6c919f4f7`) | VREAD-03 mirrors `walk_paginated`, not the deleted code |
| Reconstruct anchor read every coin plus positions | Bybit mark reads the UTA totals (`_read_bybit_uta_mark`); `_fetch_current_equity` is the test oracle and the Binance path | Phase 167.2.1.1.1 plan 18 | "The current-equity read" for Bybit in production is `_price_wallet_totals` through the UTA mark |
| On-chain deposit reader for Bybit flows | Unified TRANSFER reader, `replace` | Phase 186 D-02 | no on-chain read in the per-key derive |

**Deprecated/outdated claims in CONTEXT:** "the allocator rebuild windowed reader (`trade_read_store`)" (F2). The reconstruct anchor "sums every stable coin" is true of `_price_wallet_totals` for STABLE coins but it also prices non-stable coins; VREAD-01 deliberately sums only the stable set.

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Inverse `unrealisedPnl` is denominated in the settle coin (BTC for BTCUSD). The position doc is silent on units; the ccxt formula (notional = size/markPrice) implies coin notional. My payload in the offline parse was synthetic | VREAD-02 | inverse uPnL converted at the wrong scale; the fixture must come from a Bybit-documented example or a real reply |
| A2 | Deposit-record retention is not documented (no 2-year figure); a 729-day on-chain read may return an error | Probe B | probe records `failed`; verdict stays `undecided` |
| A3 | Bybit accepts three or more IPs per key and editing the allow-list does not rotate the secret | VREAD-05 | founder must re-enter a secret; add one address at a time |
| A4 | A Bybit first sync (`since=None`) should reach 365 days, matching `fetch_daily_pnl` and funding | VREAD-03 / OQ2 | founder may prefer to refuse or keep 7 days |
| A5 | A UTA key can read `category=inverse` and `settleCoin=USDC` position lists without a permission error | VREAD-02 | refusal would drop all derivative rows; probe section C measures it |
| A6 | Execution-list retention is two years (nav label only; PROD retCode 10001 measured in 2026-10 by the deleted code's comment) | VREAD-03 | a start between 2 and 3 years behaves differently; refusal guard covers it |
| A7 | Whether the live PROD key is linked to a strategy is unknown from code | VREAD-03 | urgency only |
| A8 | An optional Funding-account coin-balance endpoint can discriminate "parked in Funding" from "credited to Unified" | VREAD-04 | optional field only |
| A9 | Bybit position-list `size` for inverse is in USD contracts (ccxt's formula treats it so) | VREAD-02 | `size_usd` cross-check test would expose a wrong unit on a real reply |

## Open Questions (RESOLVED)

Resolved 2026-11-23 by the phase orchestrator: each question below is answered in `231-CONTEXT.md` `<orchestrator_rulings>`, OQ1 to OQ7.

1. **Option A or B for the balance helper? (founder-visible)**
   - Known: A leaves `api_keys.account_balance_usdt` and strategy initial capital USDT-only for Bybit; B changes both. CONTEXT allows either.
   - Recommendation: A, C05 recorded as decided with the remaining narrowness reported.
2. **`since_ms=None` for a Bybit first sync.**
   - Known: reachable (F3); the venue answers 7 days. Options: default 365 days (recommended; matches closed-pnl and funding), refuse by name, or keep and record.
3. **If the probe disproves truncation, still ship the windowed walk?**
   - Known: the walk is correct under every venue rule and costs more calls only for old starts. CONTEXT says "record that with a test". Recommendation: record the disproof AND keep the walk only if the founder wants it; the minimal alternative is the test plus the census row.
4. **Inverse realized P&L and inverse/coin funding (D4).**
   - Known: closed-pnl is `category=linear` only; funding sums coin amounts as USD (`funding_rows_to_daily_pnl_records`, no currency check). The one live key held no non-USDT coin on 2026-10-22 (167.2.1.1 VERIFICATION, k6). Options: decide + pin with the probe's exposure counts (recommended), refuse by name when exposure exists, or convert.
5. **Who adds `not phase2_failed` to `advance_fetched_cursor`?**
   - Known: Phase 232 VREAD-08 and 222 own that line. Recommendation: record the dependency in the 231-04 SUMMARY and the 232 hand-off; do not edit it here.
6. **Is the live PROD Bybit key strategy-linked?** Counts-only read by the orchestrator (marker query first); not needed to plan.
7. **Execution window page cap.** Size from probe section A `windowed_pages_max_in_window` (default 200 until measured).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Python | pytest, mypy | ✓ local 3.14.3 | CI uses 3.12 (`ci.yml:5655-5657`) | prefer a 3.12 venv |
| ccxt | every Bybit parse | ✓ local 4.5.64 (pin 4.5.89) | 4.5.89 wheel downloaded and run this session | `pip download ccxt==4.5.89 --no-deps`, `PYTHONPATH` to the extracted wheel for PROOF-01 runs, or CI |
| pytest | all tests | ✓ 9.0.2 (`requirements-dev.txt`: `pytest<9.2`) | `tests/test_upnl_venues.py`: 10 passed locally | none needed |
| mypy | CI gate | ✓ local 2.0.0, but CI pins `mypy==2.4.0` | version mismatch | run the CI command in a venv from `requirements-dev.txt` |
| Local-stack DB lane | live-DB tests | not needed for these unit tests; the full CI suite uses it | | targeted `pytest` files only |
| Bybit / Railway access | probe, VREAD-05 | agents: none; orchestrator: Railway MCP/CLI for the start-command wrapper | | founder-gated; no live exchange call in any executor |

**Missing with no fallback:** none for planning. **With fallback:** local ccxt/mypy/Python versions (above).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (<9.2) with pytest-asyncio `asyncio_mode = auto`, xdist, cov (`analytics-service/pytest.ini`, `requirements-dev.txt`) |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_upnl_venues.py tests/test_positions.py -q -p no:cacheprovider` |
| Full suite command (CI, `ci.yml:5894`) | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| Type gate (CI, `ci.yml:5715`) | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|--------------|
| VREAD-01 | derive anchor == stable-coin sum (1200), wedge 0.0, reconstruct == derive + uPnL (1450.5) | unit (real `parse_balance`) | `pytest tests/test_upnl_venues.py -q -p no:cacheprovider -k coin_coverage` | exists (flip); ✅ |
| VREAD-01 | one shared constant (monkeypatch `price_rule._STABLE_VALUE`) | unit | `pytest tests/test_upnl_venues.py -q -k shared_stable_set` | ❌ Wave 0 |
| VREAD-01 | error/malformed/zero/negative/non-stable arms; Binance unchanged | unit | `pytest tests/test_exchange.py tests/test_upnl_venues_binance.py -q -k "stable_wallet or wedge_zero"` | partly ❌ |
| VREAD-01 | USDC mark admitted, BTC still `wallet_basis_mismatch` | unit | `pytest tests/test_nav_marks_l4_read.py -q` | ❌ add case |
| VREAD-02 | three category requests sent (settleCoin USDT, USDC, inverse) on ccxt and raw paths, with limit 200 and cursor | unit | `pytest tests/test_positions.py -q -k "bybit and (usdc or inverse or category)"` | ❌ Wave 0 |
| VREAD-02 | symbol (`BTCPERP`, `BTCUSD`), USD fields, uPnL at mark, unusable mark refuses; real markets from cassette | unit (real `parse_position`) | `pytest tests/test_positions.py -q -k "inverse or usdc"` | ❌ Wave 0 |
| VREAD-02 | failed sub-read propagates; holdings arm yields `DERIVATIVE_FETCH_FAILED_NOTE` | unit | `pytest tests/test_allocator_positions.py tests/test_upnl_venues.py -q -k bybit` | partly exists |
| VREAD-03 | start 22 days back returns all fills; legacy code RED; 24 h start = one window; cap hit raises named error; `None` default; two-year guard | unit (venue-rule fake) | `pytest tests/test_exchange.py -q -k "bybit and (window or seven_day or cap)"` | ❌ Wave 0 |
| VREAD-04 | `replace` pinned; pairing rule pinned; verdict table function | unit | `pytest tests/test_derive_broker_dailies_dualmode.py tests/test_bybit_unified_flows.py -q -k "unified or pair"` | exists ✅ |
| VREAD-04/03 | probe vocabulary, redaction, read-only view, fingerprint | unit | `pytest tests/test_bybitreads_probe.py -q` | ❌ Wave 0 |
| VREAD-05 | founder answer + date recorded; derive `done` after | manual (orchestrator counts-only read) | n/a (checkpoint:human-action) | manual-only, justified: exchange settings and Railway networking are founder-only |
| PROOF-01 | each gate RED/GREEN protocol recorded | manual protocol | see below | n/a |

### Sampling Rate
- Per task commit: the one new/flipped test file, `-q -p no:cacheprovider`.
- Per wave merge: `tests/test_exchange.py tests/test_positions.py tests/test_upnl_venues.py tests/test_nav_marks_bybit_uta.py tests/test_nav_marks_l4_read.py tests/test_allocator_positions.py tests/test_derivegaps_probe.py` plus the CI mypy command.
- Phase gate: the CI full-suite command green, bound to the head SHA with the expected check count (CLAUDE.md "CI gate integrity").

### Wave 0 Gaps
- [ ] `tests/test_bybitreads_probe.py` (probe harness, vocabulary, redaction, read-only guard, fingerprint)
- [ ] a shared offline real-market fixture helper (cassette to ccxt markets) used by `tests/test_positions.py` and `tests/test_upnl_venues.py`
- [ ] `_fake_bybit` made params-aware (Pitfall 1)
- [ ] a venue-rule `execution_list` fake (Pitfall 5)
- [ ] No framework install needed.

### PROOF-01 protocol and per-gate neuter (pytest has no mutation machinery; the recorded proof IS the gate)
Protocol (PITFALLS C.1): write the gate against the fixed behaviour and run it on today's code (RED, named first failure); `cp` the file under test to a scratch path, apply the smallest edit re-introducing the defect, run the gate (RED with the expected arm FIRST), `cp` back and `cmp` against the backup, run again (GREEN), and paste the neuter edit, command, RED line and GREEN line into the plan SUMMARY. Never `git checkout`, `restore` or `stash` on uncommitted work.
| Gate | Neuter | Expected first RED |
|---|---|---|
| VREAD-01 flipped pin | helper sums only `"USDT"` | `derive == 1200.0` reads `1000.0` |
| shared constant | helper uses a literal `{"USDT","USDC"}` | the monkeypatched synthetic stable coin is missing from the anchor |
| VREAD-02 request shape | drop the USDC and inverse calls | the USDC/inverse row-count assertion |
| VREAD-02 units | return ccxt `notional` / `unrealizedPnl` unconverted | the inverse `size_usd`/uPnL USD assertion |
| VREAD-02 symbol | restore the plain strip | `BTCPERP` expected, `BTCUSDCC` seen |
| VREAD-02 fallback | drop `limit` / cursor | the 21-position (two raw pages) assertion |
| VREAD-03 window | send `startTime` only | the venue-rule fake returns 7 days; first missing `execId` named |
| VREAD-03 cap | cap hit returns silently | `BybitTradeWindowIncomplete` not raised |
| probe | remove a redaction check | the planted-amount output test |

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2/V3/V4 Auth, session, access | no new surface | the probe decrypts keys inside the worker only (Phase 186 D-01); no new endpoint |
| V5 Input Validation | yes | validate every venue payload field before arithmetic (`usable_price`, finite checks, typed refusals); never trust ccxt unified fields for inverse |
| V6 Cryptography | no | keys decrypted by existing `decrypt_credentials`/`get_kek`; nothing new |
| V7 Error handling and logging | yes | class-only or `scrub_freeform_string` logs; static-text named errors; `phase2_error_message[:200]` is stored, so no venue text |
| V8 Data protection | yes | public repo: no addresses, ids, amounts, home paths in probe output, SUMMARY or census |
| V13 API/DoS | yes | per-key call ceilings in the probe; three position reads per poll multiply load, so check Bybit rate limits |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Probe output leaks an amount or id | Information disclosure | `emit_record` closed vocabulary + `assert_sanitized`, tests that plant sentinels |
| Probe issues a write | Tampering | `ReadOnlyRecordingExchange` GET-only view; text pin over the probe for write verbs, as 186-03 did |
| Temporary start command leaves the worker broken | Denial of service | background probe then `exec` of the normal start; restore first; verify normal startup |
| Venue error text in logs carries a signature | Information disclosure | scrub, class only |
| Egress address committed | Information disclosure | address stays in the Railway dashboard and the Bybit key settings only |

## Sources

### Primary (HIGH: read or executed this session)
- `analytics-service/services/exchange.py` (balance helpers 3081-3301, `_fetch_raw_trades_bybit` 2768-2938, `fetch_daily_pnl` Bybit 1872-2011, `fetch_mark_prices` 3316-3445), `services/positions.py`, `services/equity_reconstruction.py` (600-1145), `services/allocator_positions.py` (spot/derivative arms 392-470, 832-872, 1700-1801), `services/bybit_unified_flows.py`, `services/exchange_pagination.py`, `services/ccxt_flow_fetch.py`, `services/funding_fetch.py` (windows, contract), `services/price_rule.py`, `services/closed_sets.py`, `services/nav_marks.py` (`build_mark_read`), `services/job_worker.py` (anchor 8535-8640, flows 8729-8836, cursor 2207-2266 and 2652-2700, composite 12795-12870, poll 14654-14688, reconcile 15200-15310)
- `analytics-service/tests/test_upnl_venues.py`, `tests/test_positions.py`, `tests/test_exchange.py` (named classes), `tests/test_derive_broker_dailies_dualmode.py:3270-3300`, `tests/test_nav_marks_bybit_uta.py`, `tests/test_nav_marks_l4_read.py:866-935`, `tests/cassettes/bybit/happy.yaml`
- ccxt 4.5.89 wheel (`pip download`; `bybit.py` `parse_balance`, `fetch_positions`, `parse_position`, `get_bybit_type`), request shapes and `parse_position` on real recorded markets executed offline; installed 4.5.64 diffed against it
- `analytics-service/scripts/derivegaps_probe.py`, `scripts/bybit_upnl_probe.py`; Phase 186 SUMMARYs 186-03 and 186-04 and 186-04-PLAN under `.planning/milestones/v1.20-phases/186-derivegaps-*`; 167.2.1.1 VERIFICATION post-deploy record; `.planning/research/v1.22/{ARCHITECTURE,PITFALLS,STACK}.md`; `.github/workflows/ci.yml:5551-5894`; deleted rebuild reader via `git show 6c919f4f7^`

### Secondary (MEDIUM: official documentation fetched through a summarising model; treat as `[CITED]`, not `[VERIFIED]`)
- Bybit v5 docs: execution list (`/docs/v5/order/execution`), position list (`/docs/v5/position`), account transaction log (`/docs/v5/account/transaction-log`), enum page (`/docs/v5/enum`, `type(uta-translog)`, `depositStatus`), deposit record (`/docs/v5/asset/deposit/deposit-record`)
- Railway docs: `docs.railway.com/networking/static-outbound-ips`, `docs.railway.com/networking/outbound-networking`

### Tertiary (LOW)
- Railway Station community posts surfaced by one search (not relied on)
- `gsd-tools classify-confidence` was not run: no research-plan seam was used because every fact came from repo reads, offline execution, or the doc fetches above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new package; reuse is from repo reads
- Architecture / census: HIGH for code paths (read at HEAD); MEDIUM for the dispositions that depend on probe evidence
- Venue semantics: MEDIUM (`[CITED]`), inverse units LOW (A1, A9)
- Pitfalls: HIGH where executed (symbol garble, cursor gate, mock fan-out), MEDIUM elsewhere

**Research date:** 2026-11-23
**Valid until:** 2026-12-23 for code facts (30 days), and until Phase 223/232 or 229 merge for the symbol-level write scopes; re-measure at HEAD before acting (memory rule: ledger claims are claims).

