---
phase: 67
plan: 67-04
status: complete
completed: 2026-07-04
requirement: BYB-01
evidence: analytics-service/docs/evidence/byb01-bybit-reconcile-2026-07-04.json (PR #578)
---

# 67-04 SUMMARY — BYB-01 live Bybit reconciliation

## Outcome

**BYB-01 CLOSED with clean funding parity.** Five reconciliation runs against the
live Bybit key ***61a0 (Momentum Sphinx, 180d window), each surfacing and fixing
a real defect before the clean run:

| Run | Finding | Fix |
|-----|---------|-----|
| 1 | `api_keys.strategy_id` doesn't exist — strategy resolution inverted | PR #574 (v0.37.0.1): resolve via `strategies.api_key_id`, exactly-one guard, source-pin regression test |
| 2 | db_count=1000 exactly ×2 = PostgREST default-limit truncation; exchange fills 0 = Bybit ~7d retention | PR #575 (v0.37.0.2): `paginated_select` on all DB loaders; `BYBIT_EXECUTION_RETENTION_DAYS=7` window clamp + report fields |
| 3 | Funding 12,920 buckets missing: sync used the TRADES cursor so the 365d backfill never fired | PR #576 (v0.37.0.3): funding-own cursor (`max(funding_fees.timestamp) − 2d`); anchor-aware dailies gate |
| 4 | **BYB-02 (new critical):** 8h match_key bucket collapsed Bybit's dynamic 1h/4h cadences — >50% of funding rows silently dropped (~$32k/180d), identical bucket-key sets with $67k of absolute per-day drift | PR #577 (v0.37.1.0): `_FUNDING_BUCKET_HOURS` bybit/okx 8→1; collision-proof re-key migration `20260704150835`; TS `buildFundingMatchKey` third-copy parity fix; 365d re-backfill (37,334 rows) |
| 5 | **CLEAN (funding)** — evidence committed | PR #578 (v0.37.1.1) |

## Run-5 acceptance (2026-07-04T16:47Z)

- **Funding: CLEAN** — 37,334 buckets exchange == DB, 0 missing, 0 extra, 0 days beyond 1e-9.
- **Dailies: 163/164 days byte-exact at 1e-9.** Single dirty day = run date itself
  (stored derived 16:32Z, recomputed 16:47Z; anchor-to-today partial day moves
  intraday). Timing artifact, not a discrepancy.
- **Fills: db=0 documented artifact** — Bybit ~7d execution retention (#563) +
  API-key strategies don't persist raw fills until trades ingestion (phase 70).

## Ops performed (prod, user-approved)

- 365d funding backfill ×2 (pre-fix run under 8h keys, post-fix run under 1h keys;
  `railway ssh` with base64 script transfer — stdin piping to `railway ssh` HANGS,
  documented gotcha).
- Re-key migration auto-applied on merge; post-deploy sweep condition verified
  clean (0 legacy-keyed rows, no deploy-gap strays).
- `derive_broker_dailies` job enqueued (key-mode, high) to refresh stored dailies
  post-backfill; last prior derive was 2026-06-25 (geo-block staleness, egress
  fixed 2026-07-04).

## Carry-forward

- Phase 70 (trades ingestion) closes the fills db=0 gap.
- Deribit funding must NOT register in `_FUNDING_BUCKET_HOURS` (continuous
  funding — needs native-id/exact-ts dedup axis + `funding_fees_exchange_check`
  update). Guard comment in code; red-team finding.
- OKX funding rows stopped 2026-06-05 (separate staleness, all on-grid, no loss
  observed) — worth a look when OKX strategies matter.
