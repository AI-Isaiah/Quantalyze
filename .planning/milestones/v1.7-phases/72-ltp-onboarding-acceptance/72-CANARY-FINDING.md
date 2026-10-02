# P72 Canary Finding — Deribit onboarding is unwired (P70 deferred it here)

**How found:** /qa live onboarding canary on prod (quantalyze.xyz), admin@quantalyze.test,
Deribit key #1 (LTP056, Railway `DERIBIT_CLIENT_ID_1`). Wizard → Deribit card → paste
Client ID/Secret → "Validate key and continue".

**Symptom:** Read-only scope validation PASSED (P68 gate works); draft strategy "Yellow
Brick" (`4ca7ada8…`, api_key `e006778b…`) created; then **"Verify data" failed** with
`SYNC_FAILED` (correlation_id `449274a6…`). Frontend correctly sanitized (no raw leak).

**Worker log root cause:**
```
POST /api/validate-key → 200   (read-only OK)
POST /api/encrypt-key  → 200   (envelope-encrypt OK)
POST /process-key      → 422   (Unprocessable Entity)
```

**Root cause chain (verified in source):**
1. `routers/process_key.py:130-142` — the H-11 per-flow source whitelist excludes
   `deribit` from EVERY flow_type (`teaser/onboard/internal_report/resync` = {okx,binance,
   bybit}). Wizard "Verify data" posts `flow_type="teaser"`, `source="deribit"` → the
   pydantic `field_validator` raises → 422.
2. This exclusion is **INTENTIONAL from P70** — `services/ingestion/adapter.py:27-30`:
   *"the process_key per-flow onboarding sets still exclude deribit (live LTP onboarding is
   Phase 72), and Deribit returns flow through the broker-dailies ONE-path (70-05, txn-log
   ledger), never fill-based process_key metrics."*
3. `services/ingestion/deribit.py:108-124` — `DeribitAdapter.compute_metrics` **raises
   NotImplementedError by design** ("returns are ledger-backed, NEVER fill-derived"). So
   the fill-based onboarding path (`process_key_long` → `compute_metrics`) cannot serve
   Deribit at all — Deribit is the first exchange where fill metrics don't apply.
4. The correct engine EXISTS and is P70-shipped: `job_worker.py:1777
   run_derive_broker_dailies_job` has a `venue == "deribit"` branch (line 1837) that fetches
   the txn-log ledger → asserts completeness → equity anchor → (strategy-mode) enqueues
   `compute_analytics_from_csv` → factsheet. **The gap is ONBOARDING ROUTING, not the
   engine.**

**P72's actual kernel (what must be built):** wire Deribit onboarding to route through the
broker-dailies ledger path instead of the fill-based `process_key_long`/`teaser` compute:
- **Backend:** admit `deribit` to the correct `process_key` flow set(s); for Deribit,
  onboarding must produce the factsheet via `derive_broker_dailies` (ledger), integrating
  with the `strategy_verifications` state machine; the synchronous `teaser` preview cannot
  run inline (ledger crawl is rate-limited/paginated, exceeds the ~300s inline ceiling).
- **Frontend:** the wizard's "Verify data" step must handle Deribit asynchronously — no
  inline fill-based preview; queue → pending → poll for the ledger factsheet.

**Acceptance:** re-run this canary to green for all 3 LTP keys (LTP056/068/016), each
producing a factsheet whose realized/funding/inverse-P&L reconciles (P70 engine, already
tested), then rotate keys (SC-4).

**Cleanup owed:** failed draft "Yellow Brick" (`4ca7ada8…`) under admin@quantalyze.test —
delete or re-verify after the fix.
