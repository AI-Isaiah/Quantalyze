# Phase 180: BYBITFUNDING — read Bybit internal and sub-account transfers so a6's funding is explained and the Bybit transfer-depth gate can be measured - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The allocator history probe and the rebuild read a Bybit account's money moving in and out beyond on-chain deposits and withdrawals, so a6's funding is explained and `bybit_transfers_gate` can be measured before any Bybit history rebuild (ROADMAP Phase 180 SC-1..SC-3).

Starting state (Phase 173 plan 03, deployed probe 2026-10-28, counts only): a6 (Bybit, 730-day window) read in full, 203467 trades; `bybit-transfers-kinds: a6 deposits=0 withdrawals=0 gate=unmeasured`; oldest fill 180 to 364 days old. The rebuild's transfer read is on-chain only and may drop rows past a 50-row page (TODOS `173-BYBIT-TRANSFERS-ON-CHAIN-ONLY`).

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- Phase 173 D-02: a per-kind count of 0 older than 365 days keeps that kind `unmeasured`; corroboration evidence never opens the gate. The gate reads `ok` only when BOTH a deposit kind and a withdrawal kind older than 365 days are at least 1 (TRADEPAGES gate wording, REVIEW-3 WR-07).
- Phase 173 D-03: the operator step runs the full probe; no transfers-only mode.
- Phase 173 D-05: the summary gate counts readable accounts and lists refused ones.
- UPNLVENUES PD-H / PD-I: a forced rebuild writes only an anchored curve, otherwise refuses by name and writes nothing.
- OKXANCHOR 172: the forced-refusal vocabulary is a closed, pinned set; the probe's redaction contract (labels, counts, booleans, closed tokens, 3-significant-figure ratios, no id/amount/timestamp finer than the run date) stays.
- ROADMAP SC-3: nothing is rebuilt over a shut gate; the founder decides a6's rebuild after the post-deploy probe.

### D-01 — Flow source: the Unified edge
Founder 2026-10-28, AskUserQuestion: "Unified edge (Recommended)".
Option shown: "Read Unified's transaction log TRANSFER_IN/TRANSFER_OUT as the rebuild's Bybit flow source; deposit endpoints stay in the probe as evidence of where the money came from."
The rebuild's Bybit flow source is `GET /v5/account/transaction-log` with `accountType=UNIFIED`, types `TRANSFER_IN` and `TRANSFER_OUT` (7-day max window, 50-row page, `nextPageCursor`, documented depth 2 years). Reason: the rebuild anchors on the Unified account only (`_read_bybit_uta_mark`, `services/equity_reconstruction.py`; `allocator_positions.py` prefers the UNIFIED row), so the flows that move its balance are those crossing the Unified edge; this cannot double-count a deposit to FUND plus its FUND→UNIFIED move. The on-chain deposit, internal (off-chain) deposit, withdrawal (`withdrawType=2`), inter-transfer and universal-transfer endpoints are read by the probe as evidence (counts and tokens only) of how the money reached the account (SC-1).
**Flagged discretion item:** whether Earn subscribe/redeem and similar transfer-like transaction-log types (for example `ONCHAINEARN_*`, `FLEXIBLE_STAKING_*`, `BONUS_TRANSFER_*`) count as flows is left to research and planning; the choice and its evidence must be written into the plan, not assumed.

### D-02 — Scope: page fix everywhere, new kinds in the rebuild only
Founder 2026-10-28, AskUserQuestion: "Page fix everywhere, kinds in rebuild (Recommended)".
Option shown: "Fix the dropped-page bug at the root for every caller (Bybit's nextPageCursor); add the new flow kinds only to the rebuild/history job and the probe; live NAV/derive kinds booked as a follow-up with its own measurement."
- `fetch_ccxt_transfers` (`services/ccxt_flow_fetch.py`) pages Bybit with `nextPageCursor` for every caller, so no window drops rows past a 50-row page.
- The new flow kinds (D-01) reach `_fetch_and_price_window` (forced rebuild and the reconstruct job) and the probe only. The live NAV / composite derive and broker-dailies Bybit readers keep their current kinds; adding kinds there is booked as a follow-up phase with its own measurement (orchestrator books it).

### D-03 — Key access: refuse by name
Founder 2026-10-28, AskUserQuestion: "Refuse by name (Recommended)".
Option shown: "Per-source unreadable token + master/sub flag in the probe (no ids); rebuild refuses with a new closed reason; gate stays unmeasured with that cause."
- The probe records, per source, a closed token for a source the key cannot read, and a master/sub boolean from `/v5/user/query-api` (`isMaster`), never an id.
- The rebuild refuses with a new closed refusal reason when its flow source cannot be read; never a silent 0 (WR-04: only `NotSupported` is swallowed).
- The gate stays `unmeasured` with that named cause.

### D-04 — Deploys: one phase, one deploy
Founder 2026-10-28, AskUserQuestion: "One phase, one deploy (Recommended)".
Option shown: "Wave 1 probe per-source counts, wave 2 rebuild read with RED tests on the on-chain-only read and on a dropped page, then one approved post-deploy probe of a6 and the founder's rebuild decision."
- Wave 1: the probe's per-source counts (SC-1).
- Wave 2: the rebuild's read, with tests that go RED on the on-chain-only read and on a dropped page (SC-2).
- Operator wave: one founder-approved post-deploy full probe of a6, the gate recorded, then the founder's rebuild decision (SC-3). Operator steps are checkpoint tasks for the orchestrator, never for a dispatched executor.

### Note shown to the founder (recorded)
The existing gate needs BOTH a deposit and a withdrawal older than 365 days. If a6 never moved money out more than a year ago, the gate cannot read `ok` even with a complete read; it then stays `unmeasured` with that named cause, which SC-3 allows.

### Claude's Discretion
- Exact record-field and token names within the probe's vocabulary and redaction contract.
- How the Unified `TRANSFER_IN` / `TRANSFER_OUT` rows map onto the gate's deposit / withdrawal kinds (documented in the plan).
- The Earn / transfer-like types question above (flagged).
- Whether the Bybit cursor paging reuses `walk_paginated` (`services/exchange_pagination.py`) or ccxt's cursor parameter.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/ccxt_flow_fetch.py` `fetch_ccxt_transfers`: the shared transfer read (30-day Bybit windows, `inner_cursor = max_ts + 1`, ignores `nextPageCursor`).
- `analytics-service/services/funding_fetch.py` Bybit funding read: `private_get_v5_account_transaction_log` with `type=SETTLEMENT`, 7-day windows and cursor through `walk_paginated` (`services/exchange_pagination.py`).
- `analytics-service/services/key_permissions.py` `detect_bybit_permissions`: reads `/v5/user/query-api` (`readOnly`, `permissions`).
- `analytics-service/scripts/allocator_history_probe.py`: `_TradeRecorder` (wraps `fetch_deposits` / `fetch_withdrawals`), `transfers_of_kind`, `oldest_transfer_ms`, `bybit_transfers_verdict`, record vocabularies and `assert_sanitized`.
- `analytics-service/services/equity_reconstruction.py` `_fetch_and_price_window` (transfers read after trades), `FORCED_REBUILD_REFUSAL_REASONS`, `_read_bybit_uta_mark`.

### Callers of the shared transfer read
- `equity_reconstruction._fetch_and_price_window` (forced rebuild and `run_reconstruct_allocator_history_job`), `job_worker` NAV/composite derives, `broker_dailies`, `okx_archive_job`, and the probe.

### Risk for the planner: time budget
a6's read took 1048 s of `_RECONSTRUCT_CRAWL_TIMEOUT_S` 1500 s on 2026-10-28, and transfers are fetched after the trades. Two years of a 7-day-window source is at least about 105 calls per type before paging. A plan that adds reads must budget for this so a timeout cannot lose the transfers.

</code_context>

<specifics>
## Specific Ideas

Bybit v5 endpoints (official docs, read 2026-10-28):
- `GET /v5/account/transaction-log` (https://bybit-exchange.github.io/docs/v5/account/transaction-log): `accountType=UNIFIED`, `type` enum includes `TRANSFER_IN` / `TRANSFER_OUT` (https://bybit-exchange.github.io/docs/v5/enum); range at most 7 days (24 h default); limit 1-50; cursor; "up to 2 years worth of data".
- `GET /v5/asset/deposit/query-record`: on-chain deposits; under 30 days; limit 50; cursor.
- `GET /v5/asset/deposit/query-internal-record`: off-chain deposits; 30 days max; limit 50; cursor; master or sub key.
- `GET /v5/asset/withdraw/query-record`: `withdrawType` 0 on-chain (default), 1 off-chain, 2 all; under 30 days; limit 50; cursor; master UID key only.
- `GET /v5/asset/transfer/query-inter-transfer-list`: account-type moves within one UID; 7 days max; limit 50 (default 20); cursor.
- `GET /v5/asset/transfer/query-universal-transfer-list`: master/sub moves; 7 days max; limit 50; cursor; master key needs `SubMemberTransfer`, sub key `SubMemberTransferList`.
- `GET /v5/user/query-api`: `readOnly`, `isMaster`, `parentUid`, `permissions.Wallet`.
None of the asset endpoints states a retention period.

</specifics>

<canonical_refs>
## Canonical References
- ROADMAP Phase 180 and its SC-1..SC-3.
- TODOS `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED`, `173-BYBIT-TRANSFERS-ON-CHAIN-ONLY`, `173-BYBIT-HISTORY-REBUILD-HELD`.
- `.planning/phases/173-*/173-CONTEXT.md`, `173-RESEARCH.md` (Pitfall 3, Pitfall 6, A6, A7, Open Question 2), `173-03-SUMMARY.md`, `173-VERIFICATION.md`.
</canonical_refs>

<deferred>
## Deferred Ideas
- Adding the new Bybit flow kinds to the live NAV / composite derive and broker-dailies readers, with its own measurement (D-02); orchestrator books the follow-up phase.
- Rebuilding a6: decided by the founder after the post-deploy probe (SC-3), not before.
</deferred>
