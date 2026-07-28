---
phase: 70
slug: trades-ingestion-dailies-risky
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-04
revised: 2026-07-05
---

# Phase 70 — Validation Strategy (RISKY)

> REVISED 2026-07-05 to the LOCKED ledger design (`analytics-service/docs/deribit-ingestion-design.md`).
> Backbone changed from "reconstruct realized P&L from fills + separate funding stream" to a
> **transaction-log cash-delta ledger summed by UTC day (funding-inclusive)**. This phase has a HARD
> CI-vs-live split — read it carefully.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) |
| **Config file** | `analytics-service/pyproject.toml` / `pytest.ini` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_deribit_ingest.py tests/test_deribit_txn.py tests/test_broker_dailies.py tests/test_ingestion_deribit.py -q` (targeted; the full local suite segfaults on Py3.14 pandas ABI — use file lists) |
| **Full suite authority** | CI (Py3.12) — the `python` job on the PR |
| **Estimated runtime** | ~seconds (targeted) / CI for full |

> NO SQL migration + NO frontend parity test this phase: the prior `funding_fees_exchange_check` flip
> is DROPPED. Deribit funding is bundled inside the ledger settlement cash delta (single sum), never
> persisted to `funding_fees`, so no CHECK flip and no TS FundingFee/FUNDING_EXCHANGES change are needed
> (they correctly stay 3-exchange). No auto-apply-to-prod migration → no migration-reviewer/rls-auditor gate.

---

## CI-runnable (synthetic fixtures) vs LIVE-only (skipIf-gated) — THE critical split

**CI-runnable synthetic fixtures cover ALL correctness logic:**
- Inverse coin→USD sign fixtures (short + long, hand-computed; ledger sign trusted) — DRB-06 (70-02)
- Cash-bearing single-sum: funding-inclusive settlement counted ONCE, no separate funding line, proven-to-fail under a double-count — DRB-07/D-10 (70-02)
- Informational types (transfer/deposit/withdrawal/reward) excluded; unknown-cash-type fails loud — DRB-05/07 (70-02)
- Options/deliveries enter dailies via their settlement/delivery cash delta, never perp fill math — DRB-05 (70-02)
- Ledger paginator: continuation→null, count=250, ~1 req/s pacing + 10028 exponential backoff (injected clock) — DRB-04 (70-03)
- Truncation-fail-loud: 10028 budget exhausted → LedgerTruncatedError (never a partial ledger) — DRB-04/D-14 (70-03)
- Re-anchored D-02 gate: `assert_ledger_complete` fails loud on any incomplete scope×currency (ledger completeness, NOT fill-count reconciliation) — DRB-04/D-02 (70-03)
- Per-scope auth resolution (exchange_token/subject_id; subaccount_id refused on read-only keys); a scope that can't be authed fails loud — DRB-04 (70-03)
- id-cursor trades fetch: start_id advance + continue-while-full (has_more unreliable) + historical=true + FillRow exchange_fill_id=trade_id — DRB-04 (70-04)
- reconcile_fill_count ADVISORY only (never raises); known totals documented non-reconciling per Wave-0 — DRB-04 (70-04)
- Deribit ONE-path: ledger realized + EMPTY funding → `combine_realized_and_funding` → `compute_all_metrics` same shape as bybit/okx; upsert_funding_rows never called — DRB-07/DRB-08 (70-05)
- Ledger-completeness gate fail-loud before upsert (LedgerCompletenessError/LedgerTruncatedError → job FAILED, no partial track record) — DRB-08/D-02 (70-05)
- Deribit **USD-equity anchor** shape (revert-proof: coin/non-USD base → red) — DRB-08/D-06 (70-05)
- Source-registry widening + read-only-gated DeribitAdapter; `compute_metrics` fails loud (fills are zero-PnL, A3 — returns are ledger-backed) — DRB-08/D-13 (70-06)

**NOT CI-runnable (live / `skipIf(!HAS_LIVE_DB or !DERIBIT creds)`):**
- The actual multi-year ledger crawl reaching continuation=null across all scopes × currencies (live worker run, recorded as evidence) — 70-01 (Wave-0) + 70-05 (live gate)
- Fill-count cross-check against 18,778 / 21,014 / 61,248 (ADVISORY evidence only — NOT a gate) — 70-04 live
- The A1–A3 probes (Wave 0) — 70-01

---

## Wave 0 — COMPLETE (recorded evidence, do not re-run)

`analytics-service/docs/evidence/p70-wave0-deribit-subaccount-probe.json` records:
- **A1 POSITIVE:** settlement rows carry event-time `index_price` (acct3 218/218; `mark_price` absent) → inverse coin→USD uses the row's own index_price. Conversion source LOCKED.
- **A2 (design-corrected):** subaccounts reachable, but `subaccount_id` is REFUSED (-32602 "Not allowed") on the read-only LTP keys → per-scope auth via `public/exchange_token` (subject_id) / per-sub keys (70-03; provisioning Phase 72).
- **A3 POSITIVE:** `type=trade` rows carry ZERO cashflow; realized cash lives in settlement + delivery; funding is booked INSIDE settlement → NO separate funding stream (drops the prior funding-dedup + funding_fees-flip plans).
- **BLOCKING_FINDING:** the known fill totals reconcile to NO API surface → the D-02 honesty gate re-anchors on LEDGER COMPLETENESS; fill counts become an advisory cross-check only.

---

## Per-Task Verification Map (revised 6-plan set)

*Every correctness criterion has a CI-runnable synthetic fixture; the ledger crawl completeness + A1–A3 are live-gated evidence.*

| Plan / Task | Requirement | Test Type | Automated command | CI-runnable? | Status |
|-------------|-------------|-----------|-------------------|--------------|--------|
| 70-01 (Wave-0 probe) | DRB-04/06/07 evidence | live/checkpoint | recorded in the evidence JSON | ❌ live | ✅ done |
| 70-02 T1 (coin→USD + classify) | DRB-06 | pytest unit (hand-computed) | `pytest tests/test_deribit_txn.py -q` | ✅ | ⬜ pending |
| 70-02 T2 (cash-bearing single-sum, EVIDENCE-pinned sets {trade,settlement,delivery}, unobserved-type fail-loud, options-as-cashflow) | DRB-05/DRB-07 | pytest unit | `pytest tests/test_deribit_txn.py tests/test_deribit_ground_truth.py -q` | ✅ | ⬜ pending |
| 70-03 T1 (ledger paginator: continuation/pace/backoff/truncation + scope auth) | DRB-04 | pytest unit (injected clock) | `pytest tests/test_deribit_ingest.py -q` | ✅ | ⬜ pending |
| 70-03 T2 (ledger producer + assert_ledger_complete = re-anchored D-02) | DRB-04/D-02/DRB-07 | pytest unit (synthetic scope×currency) | `pytest tests/test_deribit_ingest.py -q` | ✅ | ⬜ pending |
| 70-03 (live ledger completeness) | DRB-04 | live/skipIf | Railway worker crawl to continuation=null | ❌ live | ⬜ pending |
| 70-04 T1 (id-cursor fill fetch + FillRow) | DRB-04 | pytest unit | `pytest tests/test_deribit_ingest.py -q` | ✅ | ⬜ pending |
| 70-04 T2 (fetch_raw_trades branch + advisory reconcile_fill_count) | DRB-04 | pytest unit | `pytest tests/test_deribit_ingest.py -q` | ✅ | ⬜ pending |
| 70-04 (live fill-count cross-check) | DRB-04 | live/skipIf (advisory) | Railway worker vs known totals | ❌ live | ⬜ pending |
| 70-05 T1 (job_worker deribit ONE-path: ledger realized + empty funding + ledger-completeness gate) | DRB-07/DRB-08/D-02/D-08 | pytest unit | `pytest tests/test_broker_dailies.py -k deribit -q` | ✅ | ⬜ pending |
| 70-05 T1 (deribit USD-equity anchor shape) | DRB-08/D-06 | pytest unit (revert-proof) | `pytest tests/test_broker_dailies.py -k equity_anchor -q` | ✅ | ⬜ pending |
| 70-05 T2 (one-path shape parity) | DRB-08 | pytest integration (synthetic) | `pytest tests/test_broker_dailies.py -k deribit_one_path -q` | ✅ | ⬜ pending |
| 70-05 (live reconciliation) | DRB-04/DRB-08 | live/skipIf | Railway worker ledger crawl (evidence) | ❌ live | ⬜ pending |
| 70-06 T1 (DeribitAdapter: read-only gate + fills fetch + compute_metrics fail-loud) | DRB-08/D-13 | pytest unit + mypy --strict | `pytest tests/test_ingestion_deribit.py -q` | ✅ | ⬜ pending |
| 70-06 T2 (registry widening) | DRB-08/D-13 | pytest unit | `pytest tests/test_ingestion_deribit.py -q` | ✅ | ⬜ pending |

---

## Requirement Coverage (all 5 remain covered)

| Requirement | Covered by |
|-------------|------------|
| DRB-04 (full history, verified against known counts) | 70-03 (ledger completeness gate = the re-anchored "verified" criterion) + 70-04 (id-cursor fill fetch + advisory count cross-check) |
| DRB-05 (classification; options via txn-log, never perp math) | 70-02 |
| DRB-06 (inverse coin→USD event-time, sign-correct, hand-computed) | 70-02 |
| DRB-07 (funding ingested, no double-count) | 70-02 (funding-inclusive settlement counted once) + 70-03 (ledger single sum) + 70-05 (empty funding_rows, no funding_fees write) |
| DRB-08 (the ONE compute path) | 70-05 (job_worker ledger ONE-path) + 70-06 (Source widening + adapter) |

---

## Validation Sign-Off

- [x] Every correctness path has a CI-runnable synthetic fixture (every task carries a fast `<automated>` pytest verify)
- [x] Wave-0 live probe recorded (A1/A2/A3 resolved) — design LOCKED against the evidence JSON
- [ ] The re-anchored D-02 gate (`assert_ledger_complete`) fails loud on any incomplete ledger crawl
- [ ] The ledger paginator fails loud on 10028 truncation (never partial)
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set

**Approval:** pending
</content>
