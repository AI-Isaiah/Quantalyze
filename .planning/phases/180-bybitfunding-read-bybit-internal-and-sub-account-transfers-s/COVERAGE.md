# API Coverage — Bybit v5 (Phase 180 BYBITFUNDING)

> Full coverage by default. Opt-outs are explicit, reasoned decisions. Every row is a Bybit v5 surface this phase reads, or one it deliberately leaves unread; the plan that carries each INTEGRATE row is named in its reason. All reads are GET; this phase writes nothing to Bybit.

| capability | decision | reason |
|---|---|---|
| transaction-log UNIFIED TRANSFER_IN/OUT as the rebuild's Bybit flow source | INTEGRATE | plans 04 and 06, D-01: the Unified edge is the rebuild's only Bybit flow source, 7-day windows, every nextPageCursor page, read before the trades |
| transaction-log UNIFIED TRANSFER_IN/OUT in the probe's Unified-edge recorder | INTEGRATE | plan 03: the probe records the rebuild's own read and derives the gate kinds, the cause and the funding explanation from it |
| transaction-log census of eight transfer-like candidate types | INTEGRATE | plan 02 Task 1, orchestrator reading 3: one aggregate count under its own 600 s bound, evidence for SC-3 only, never a flow and never a gate input |
| deposit query-record (on-chain deposits) | INTEGRATE | plan 01: probe evidence for SC-1, counts, age buckets and a closed state; no longer a rebuild flow source for Bybit |
| deposit query-internal-record (internal off-chain deposits) | INTEGRATE | plan 01: probe evidence for SC-1 |
| withdraw query-record with withdrawType 2 (every withdrawal type) | INTEGRATE | plan 01: probe evidence for SC-1; master key only, a sub key prints not-master |
| transfer query-inter-transfer-list (internal transfers between account types) | INTEGRATE | plan 01: probe evidence for SC-1 |
| transfer query-universal-transfer-list (master and sub-account transfers) | INTEGRATE | plan 01: probe evidence for SC-1; a key without the permission prints its refusal class as the state |
| user query-api isMaster and uta flags | INTEGRATE | plan 01: two booleans read strictly; userID and parentUid are never kept |
| nextPageCursor paging in fetch_ccxt_transfers for every caller | INTEGRATE | plan 05, D-02: the dropped-page fix applies to the live broker-dailies and composite readers too |
| refusal by name when the Unified flow source cannot be read | INTEGRATE | plan 07, D-03: forced rebuild refuses account_flow_source_unreadable and writes nothing; the unforced job fails permanently, never retried (orchestrator reading 2) |
| Earn, staking, bonus and PEF transaction-log types as rebuild flows | OPT-OUT | orchestrator reading 3: not flows in this phase; the census counts them and plan 08 books 180-BYBIT-EARN-FLOWS-UNREAD |
| on-chain deposit and withdrawal records as the rebuild's Bybit flow source | OPT-OUT | D-01: replaced by the Unified edge; reading both would count a FUND deposit and its move into Unified twice |
| Unified-edge flow kinds in the live NAV, composite and broker-dailies readers | OPT-OUT | D-02: deferred to a follow-up phase with its own measurement; plan 08 books 180-BYBIT-LIVE-FLOW-KINDS |
| user query-sub-members list | OPT-OUT | the redaction contract keeps no member id (D-03); the inter-transfer and universal-transfer lists answer the funding question without it |
| deposit query-sub-member-record | OPT-OUT | needs a sub-member id per request, which the probe never holds or prints; each account's own key reads its own deposit records |
| inter-transfer, universal-transfer and withdraw create (write endpoints) | OPT-OUT | read-only phase; the probe's and the record module's static pins forbid every venue write call |
| account contract-transaction-log (classic account log) | OPT-OUT | the rebuild anchors on the Unified account only; the classic log does not describe the Unified edge |
| ccxt fetch_ledger for the transaction log | OPT-OUT | RESEARCH: it sends no accountType, has no until handling and adds two calls; the raw private_get_v5_account_transaction_log call mirrors fetch_funding_bybit |
| FUND wallet and account-coins balance reads | OPT-OUT | the anchor stays on the Unified account; a FUND balance is not part of the rebuilt curve |
