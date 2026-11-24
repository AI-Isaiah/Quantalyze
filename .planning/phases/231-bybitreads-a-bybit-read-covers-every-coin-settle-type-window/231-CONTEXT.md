# Phase 231: BYBITREADS — a Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

<domain>
## Phase Boundary

From ROADMAP.md `### Phase 231` (quoted, binding): "Every Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name, and the owner's static egress IP is allow-listed by the founder (VREAD-05). Before any fix, a venue-by-path census (coin, settle type, window, flow source) is written, and every row is fixed or decided with a test (PITFALLS Pitfall 3)."

Delivers, per ROADMAP and REQUIREMENTS.md (VREAD-01..05):
- VREAD-01: the derive anchor sums the same stable coins as the current-equity read, through one shared coin-set constant. The narrow pin `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin` is the intended RED-first test, flipped and never deleted.
- VREAD-02: the holdings poll includes USDC-settled and inverse positions and their uPnL.
- VREAD-03: a strategy trade sync that starts more than seven days back returns every execution in its window, or refuses by name.
- VREAD-04: an on-chain deposit is counted exactly once; replace or union is decided on probe evidence, or recorded as undecided if the probe cannot tell the two apart.
- VREAD-05: a FOUNDER action (allow-list the owner's static egress IP, recorded with its date). This phase prepares instructions and evidence only; no agent touches exchange account settings.
- PROOF-01 (ROADMAP SC-5): each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), GREEN, recorded verbatim in the plan SUMMARY. Mocks mirror recorded real payloads, not the parser's field names.

Out of scope: any stitch or composite file as an integration point (research ARCHITECTURE: "No stitch or composite file is an integration point anywhere in this milestone"); the OKX reads (Phase 232); `run_sync_trades_job`'s cursor read and `advance_fetched_cursor` (Phase 232 / 222); Bybit flow kinds beyond the on-chain deposit verdict (Phase 223); Binance (`167.2.1.1-BINANCE-FUTURES-WALLET-UNREAD` stays with its own entry).

</domain>

<decisions>
## Implementation Decisions

### Ordering and the Phase 229 gate
- ROADMAP: "The anchor feeds `key_inputs.anchor_usd` (S1 to S2), so if 229 is still open, the anchor plan waits for it." Measured 2026-11-23: Phase 229 has no plans, no branch and no PR (it depends on 226, which is running). So the VREAD-01 anchor plan is its own plan in the LAST wave, with a blocking precondition "Phase 229 merged to main". It is planned now but not executed while 229 is open, and no SUMMARY is written for it while blocked. The other plans do not wait for it.
- Plan write scopes are listed BY SYMBOL (founder constraint: `exchange.py`, `positions.py` and `bybit_unified_flows.py` are shared with Phases 223 and 232).

### Research first (ROADMAP: "Research first: the census, a counts-only trade-window probe, and the on-chain deposit probe")
- Plan 01 is read-only: the census table, written to the phase dir, one row per Bybit read path by coin, settle type, window and flow source, each row ending in "fix in plan NN" or "decided: <reason>, pinned by <test>".
- The counts-only trade-window probe and the on-chain deposit probe need decrypted keys, which exist only inside the worker (Phase 186 decision 01). They follow the Phase 186 pattern (`analytics-service/scripts/derivegaps_probe.py`: a reviewed script, `ReadOnlyRecordingExchange`, redacted `k1..kN` output, deploy fingerprint, run once on the Railway backfill worker). The temporary worker run is executed by the phase orchestrator, not an executor, and the start command is restored and verified afterwards.
- Zero on-chain rows for the distinguishing case means the VREAD-04 verdict is "undecided" (PITFALLS Pitfall 3), never "replace".

### Decided autonomously
- [Anchor] Q: "Which coin set is the one shared constant?" → Selected: "`services/price_rule.is_stable_value` (STABLECOINS plus STABLECOIN_SPLIT_SUFFIXES), the rule `_price_wallet_totals` (the current-equity read and the Bybit UTA mark) already applies" — a new constant would be a second definition; reusing the existing one is a local import change.
- [Anchor] Q: "Where does the fix live?" → Selected: "A Bybit-only branch in the anchor path (`fetch_account_equity_and_upnl_usd` / the Bybit arm of the balance read) summing every stable coin's wallet figure from `balance['total']`; Binance and the shared `fetch_usdt_balance_with_status` behaviour for other venues stay unchanged. Every other caller of the helper (strategy-sync `fetch_usdt_balance`, `fetch_account_equity_usd`, the composite call at the stitch job) is a census row: fixed by inheritance, or decided with a test" — a venue branch is local and revertible.
- [Anchor] Q: "What does the flipped pin assert?" → Selected: "The derive anchor is still the realized wallet basis: it equals the stable-coin wallet sum (1200 in the pin's own fixture), the wedge stays 0.0, and reconstruct == derive + open uPnL still holds (1450.5)" — a test assertion.
- [Anchor] Q: "Non-stable collateral coins in the derive anchor?" → Selected: "Out of the anchor, as the requirement scopes it to stable coins; a census row decided with a pinning test, and flagged to the founder in the phase report" — scope note, revisitable by a later phase.
- [Positions] Q: "How are USDC-settled and inverse positions read?" → Selected: "Iterate linear settleCoin USDT, linear settleCoin USDC and category inverse, on both the ccxt path and the raw V5 fallback in `_fetch_positions_bybit`; a failed sub-read refuses by name, never returns a silent partial" — request-shape change inside one function.
- [Positions] Q: "Inverse uPnL is coin-denominated; how is it valued in USD?" → Selected: "Converted at the same payload's markPrice (USD per coin), following the existing Deribit inverse pattern in `positions.py`; an unusable mark refuses the row by name" — local conversion rule.
- [Trades] Q: "Fix shape for a start older than seven days?" → Selected: "Decided by the counts-only probe. If it shows truncation (or cannot rule it out), walk [start, now] in 7-day windows with an explicit endTime, as the allocator rebuild's windowed reader and `fetch_all_trades`' closed-pnl walk already do; a window cap hit raises a named data-quality flag and refuses. If the probe disproves it, record that with a test" — request-shape change inside `_fetch_raw_trades_bybit`.
- [Trades] Q: "Execution categories?" → Selected: "Linear only stays, as `_BYBIT_FILL_CATEGORIES` decides (inverse and spot raise by name); a decided census row pinned by the existing tests" — no behaviour change.
- [Deposits] Q: "What is changed if the probe is undecided?" → Selected: "The flow source stays `replace`, the verdict is recorded as undecided with the probe counts, and a test pins that an unpaired on-chain deposit is visible (named) rather than silently booked as P&L, if the reader can see it" — the code stays as it is; only evidence and a test are added.
- [Fixtures] Q: "Test payloads?" → Selected: "Built from recorded real Bybit v5 payload shapes (`tests/` already carries scrubbed UTA wallet-balance and linear position fixtures; add USDC-linear and inverse shapes from Bybit's documented v5 responses), run through the real ccxt 4.5.89 parser where the code uses it" — test-only.

### VREAD-05 (founder action)
- The phase prepares exact instructions and stops for the founder. No agent changes Railway networking or the Bybit key's settings. The address never enters tracked text.

### Claude's Discretion
- Plan split and wave layout, within: plan 01 read-only census and probes; VREAD-02, VREAD-03 and VREAD-04 plans in parallel where their symbol scopes do not overlap; VREAD-01 last and gated on 229. At most 2 executors run at once (founder constraint).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/price_rule.is_stable_value` / `_STABLE_VALUE` and `services/closed_sets.STABLECOINS`: the shared stable-coin rule.
- `services/equity_reconstruction._price_wallet_totals`: the current-equity and Bybit UTA mark wallet pricing (stable coins at 1.0).
- `services/trade_read_store.py` and the closed-pnl walk in `services/exchange.py` (`BYBIT_PNL_WINDOW_MS`): 7-day windowed Bybit reads with an explicit end.
- `services/bybit_unified_flows.py` `fetch_bybit_unified_flows` and `pair_onchain_with_unified`; `scripts/derivegaps_probe.py` Gap 2 records `bybit_onchain_rows`, `bybit_paired_rows`, `bybit_unpaired_onchain_rows`, `bybit_near_miss_rows`.
- `tests/test_upnl_venues.py`: `real_bybit_parse_balance`, `bybit_wallet_balance`, `bybit_coin`, `_fake_bybit`, `BYBIT_LINEAR_POSITIONS`.

### Established Patterns
- Read failures are typed, scrubbed (`scrub_freeform_string`) and logged by class; never a silent partial (186 decision 05 "fail loud, fail alone").
- Data-quality flags via `_record_dq_flag` drained by `get_and_clear_last_dq_flags` (strategy sync).
- Worker-only probes with a redaction contract and a deploy fingerprint (Phase 186).

### Integration Points (census seeds, to be completed by plan 01)
- Anchor: `services/exchange.py` `fetch_usdt_balance_with_status` (L3101), `fetch_account_equity_usd`, `fetch_account_equity_and_upnl_usd` (L3262); callers `services/job_worker.py` derive (`run_derive_broker_dailies_job`, about L8568), strategy sync `fetch_usdt_balance` (about L2178), the stitch composite call (about L12822, composite: no edit this milestone).
- Current-equity read: `services/equity_reconstruction._fetch_current_equity`, `_read_bybit_uta_mark` (Bybit marks, `api_key_nav_marks`).
- Holdings poll: `services/allocator_positions.fetch_allocator_holdings` → `services/positions.fetch_positions` → `_fetch_positions_bybit` (L362, raw fallback asks `{"category": "linear", "settleCoin": "USDT"}`).
- Trades: `services/exchange.py` `_fetch_raw_trades_bybit` (L2768, startTime on the first page, no endTime) via `fetch_raw_trades`, two callers in `job_worker.py` (strategy sync about L2213, reconcile about L15226); derive realized read `fetch_all_trades` (closed-pnl, windowed); funding `fetch_funding_bybit` (`BYBIT_FUNDING_WINDOW_MS`).
- Flows: `fetch_bybit_unified_flows` (derive) and the on-chain reader it replaces (`replace` verdict, 186-04).

</code_context>

<specifics>
## Specific Ideas

PROD readings taken 2026-11-23 (marker query returned the PRODUCTION comment first; counts only, no ids):
- Bybit keys: 1 connected and active (`sync_status` complete, last sync 2026-11-23); 5 more are revoked and disconnected since 2026-08-06 (4 expired, 1 rejected credentials). Research FEATURES.md's "6 active Bybit keys" counts the revoked ones; live exposure is ONE key.
- That key's `derive_broker_dailies` jobs: 2 `failed_final` with an IP error (2026-10-07, 2026-10-08), then 31 `done` on the first attempt from 2026-10-24 through 2026-11-23, no error. `api_key_nav_marks` holds 28 Bybit marks, 2026-10-26 to 2026-11-22.
- So the "Unmatched IP" daily error that `167.1.2.2-BYBIT-STATIC-EGRESS` describes is NOT occurring now. Railway's service config (read-only) does not show whether Static Outbound IPs are on. VREAD-05's founder step therefore becomes a confirmation: what changed around 2026-10-09..10-24 (static IP allow-listed, or the key's IP binding removed) and on what date. The SC-4 record needs the founder's answer.

</specifics>

<deferred>
## Deferred Ideas

- Non-stable collateral (for example BTC held in the Unified account) in the derive anchor: outside VREAD-01's stable-coin scope; flagged in the phase report.
- A start-less (`since_ms=None`) Bybit execution read answers only the last 7 days; record it in the census, and if no caller sends None for a long window, decide it there.

</deferred>

<orchestrator_rulings>
## Rulings after research (2026-11-23, phase orchestrator; reversible technical choices)

These answer 231-RESEARCH.md `## Open Questions` 1-7. None is a founder ruling; each is recorded in the phase report.

- OQ1 Balance helper: **Option A.** A new Bybit stable-wallet helper calling `price_rule.is_stable_value`, used by both `fetch_account_equity_usd` and `fetch_account_equity_and_upnl_usd` for Bybit. `fetch_usdt_balance_with_status` and `fetch_usdt_balance` stay as they are, so `api_keys.account_balance_usdt` and strategy capital stay USDT-named and USDT-valued; that narrowness is a census row decided with a pinning test and reported.
- OQ2 `since_ms=None` for a Bybit execution read: default to a 365-day lookback walked in 7-day windows (matches the closed-pnl and funding readers).
- OQ3 The windowed walk ships whatever the probe says: Bybit documents a start-only request as answering 7 days, and the walk is correct under every documented rule. The probe result is recorded as evidence and sizes the per-window page cap.
- OQ4 Inverse realized P&L (closed-pnl is linear only) and coin-denominated funding: census rows decided with the probe's exposure counts. If the probe shows exposure on the live key, the row is routed by name in the phase report, not fixed here.
- OQ5 `advance_fetched_cursor` (`job_worker.py`, `run_sync_trades_job`) is Phase 232 VREAD-08 / 222 territory: this phase does NOT edit it. The 231 trades plan records the dependency (a refusal currently does not hold the cursor) in its SUMMARY and in the phase report for 232.
- OQ6 Answered by PROD read 2026-11-23: the one live Bybit key is strategy-linked (1 strategy through `strategies.api_key_id`, 0 `strategy_keys` links). In the last 30 days that strategy ran `sync_trades` twice (done, last 2026-11-03), `reconcile_strategy` 30 done, `poll_positions` 20 done, and `sync_funding` 30 `failed_final`, every one `transient` "Handler exceeded timeout" since 2026-09-25. The funding timeout is a Bybit read that never completes: a census row, owner to be named in the phase report (not fixed in this phase unless the census shows it is a window defect inside this phase's symbols).
- OQ7 Per-window page cap: sized from the probe; default 200 pages per window until measured.
- The `trade_read_store` reader named in this CONTEXT's code_context no longer exists (Phase 176); the template is `services/exchange_pagination.walk_paginated`.
- Plan split: research's suggested 01..06 split stands (01 census + VREAD-05 founder doc; 02 probe tooling then orchestrator run; 03 positions and 04 trades in parallel; 05 VREAD-04 record; 06 anchor last, blocked on Phase 229 merged). At most 2 executors at once.
</orchestrator_rulings>

### Decided at the plan 05 checkpoint

- **VREAD-05 (founder, 2026-11-23, relayed by the coordinator):** "Allow-listed worker IP". The founder bound the live Bybit key to the worker's static egress IP at Bybit. It is recorded as given, and no further founder step is needed.
  - The founder gave no date. The date recorded, 2026-10-24, is an upper bound derived from PROD:
    - the derive failed with an IP error on 2026-10-07 and 2026-10-08;
    - every derive since 2026-10-24 is done (31 of 31), with 0 IP errors.
  - The founder may correct the date.
- **VREAD-04:** the verdict is `undecided`, because the measured window has 0 on-chain rows. The action table keeps `replace` and asks the founder nothing.
