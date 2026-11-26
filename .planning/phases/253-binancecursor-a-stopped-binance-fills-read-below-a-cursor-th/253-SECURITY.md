---
phase: "253"
slug: "binancecursor-a-stopped-binance-fills-read-below-a-cursor-th"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-11-26"
audited_at_sha: 0084b80ccb5a194a3b81557bbd82ed0bb15c5a55
---

# Phase 253 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> The register was authored at plan time (all four PLANs carry a `<threat_model>`). The auditor
> (gsd-security-auditor, ASVS L1) verified each mitigation by code and catalogue-statement
> presence and by the existence of the named gate arms.

⚠️ **Evidence limit.** No Docker was available locally, so the SQL gate
`supabase/tests/test_strategy_fills_reread_bound.sql` and the live-DB pytest arms were NOT run in
this audit. CI (`sql-tests`, `sql-mutation`, `python`) is their first real run. The PROOF-01 N1/N2
neuter outcomes and the `lint-migration-data-dependence` acceptance are taken from the plan and
SUMMARY records, not re-run here. Every row below marked "presence" means the control and its arm
exist in code; it does not mean the arm was executed by this audit.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client roles (anon, authenticated) -> public schema | PostgREST exposes `public`; a client must never read or write a bound or call the RPC | per-strategy fills re-read bound (internal) |
| orphaned worker -> RPC | a watchdog-reclaimed worker may still run its epilogue | bound write, cursor write |
| migration -> TEST/PROD | auto-applies on merge with no human stop | DDL |
| worker -> Supabase (service role) | the worker writes the bound and the cursor | bound, cursor, flags |
| venue -> worker | fills and dq flags feed the stop predicate | fills (venue data) |
| census literals -> CI gates | a wrong floor either reds main or hides a lost arm | CI constants |
| worker -> `strategy_analytics.data_quality_flags` | jsonb read by dashboard/owner surfaces; anon-readable for a published strategy | `binance_*` flag keys (symbol names, bools, ints) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-253-01 | Elevation | `set_strategy_fills_reread_bound` SECDEF | high | mitigate | `SECURITY DEFINER` + `SET search_path = public, pg_catalog`, schema-qualified names (migration `20261126150000` :119-120, :143, :156-211); apply-time DO block asserts `prosecdef`/`proconfig` (:280-286); SECDEF 1 arm (presence) | closed |
| T-253-02 | Tampering | orphaned worker clears or lowers a live bound | high | mitigate | claim-token fence (`id = p_job_id AND status = 'running' AND claim_token = p_claim_token`, else `RETURN FALSE`, :135-152); FENCE 1/2 arms with RED-UNDER-M twins (presence); PROOF-01 N2 per SUMMARY | closed |
| T-253-03 | Info disclosure / Tampering | client access to `strategy_fills_reread_bounds` or the RPC | high | mitigate | RLS on + FOR ALL `USING (false) WITH CHECK (false)` (:89-95); REVOKE ALL FROM PUBLIC, anon, authenticated + GRANT service_role (:103-104, :224-227); DO block aborts the apply on any client EXECUTE (:288-302); GRANT 1, EXEC 1, POLICY 1/2, RESTORE 1 arms (presence) | closed |
| T-253-04 | Denial of service | migration blocks the PROD apply | medium | mitigate | `lock_timeout = '3s'` (:54); additive objects only; catalogue-only DO block; manual rollback `supabase/migrations/down/20261126150000-rollback.sql` | closed |
| T-253-05 | Tampering | bound left for a deleted key or erased user | low | mitigate | `ON DELETE CASCADE` from `strategies` and `api_keys` (:61-62); CASCADE 1 arm (presence) | closed |
| T-253-06 | Tampering | orphaned worker's bound write | high | mitigate | `p_claim_token` threaded exactly as `_advance_cursor` (WORKER_FENCE_V2); FALSE logs `worker_orphan_write_blocked` at the provisional and epilogue writes; pytest arms (presence) | closed |
| T-253-07 | Repudiation / data integrity | a lost bound write silently skips a span | high | mitigate | provisional bound written at the seed before Phase 1's store and the fills walk (review rounds 2-3); a failed write logs ERROR and skips the read and stores; epilogue write precedes the flag upsert and cursor RPC and on failure sets `binance_stop_below_cursor`; pytest arms (presence) | closed |
| T-253-08 | Info disclosure | WARNING/ERROR log content | low | mitigate | new log lines carry strategy id, column ISO, instant ms, job id and exception class only; no fill content | closed |
| T-253-09 | Denial of service | full-reach walk on every failed bound read | medium | mitigate | `load_strategy_fills_reread_bound` never raises; a failed read applies no bound term; RPC keeps an uncovered bound; provisional write passes `covers=None` | closed |
| T-253-10 | Tampering | mutation floors below the corpus hide a lost arm | medium | mitigate | `FILES_FLOOR`/`ARMS_FLOOR` in `scripts/mutation-floors.mjs` set to the `--parse-only` count; vitest ratchet pins them. `ARMS_FLOOR` is a static count; CI `sql-mutation` FULL is the first biting comparison, and a floor above the real count fails loudly | closed |
| T-253-11 | Repudiation | drift finding silenced by an allowlist row | medium | mitigate | `NAME_SET_RATCHET` `snapshot-only` row with `clearedBy` in `scripts/dump-sql-functions.ts`; no content-drift allowlist row in `scripts/baseline-content-drift-check.mjs` (only a `COMPARED_FLOOR` raise) | closed |
| T-253-12 | Info disclosure | carried flag payload | low | mitigate | explicit nine-key allowlist with shape validators (`binance_sync_flags.py:37-72`); no fill content; no non-test `src/` reader of any of the nine keys. Residual exposure of symbol strings on the anon-readable row is transferred, see AR-253-01 | closed |
| T-253-13 | Tampering / data integrity | carried key promotes a row to `complete_with_warnings` | medium | mitigate | carry placed after both `_warned` loops in `analytics_runner.py`; no `binance_` key in the NAV/allocated-capital guard key sets; CSV arm asserts exact `"complete"` | closed |
| T-253-14 | Denial of service | first derive raises on a missing prior row | high | mitigate | `isinstance(..., dict)` guard at the call site; `carry_binance_sync_flags` is pure and returns `{}` for a non-dict; no-prior-row arm | closed |
| T-253-15 | Repudiation | flag sticks forever or is cleared by a raised read | medium | mitigate | clear gated on `_binance_read and not phase2_failed and not _fills_read_skipped and not flag_load_failed`; F3/F4 arms | closed |
| T-253-16 | Denial of service | guarded prior-flags read inside a failure writer | medium | mitigate | `read_binance_sync_flags` wraps the read in `try/except`, logs one WARNING, returns `{}`; read-raises arms | closed |
| T-253-SC | Tampering | npm/pip/cargo installs | low | accept | no package installed: `package.json`, lockfile and analytics requirements unchanged in `origin/main...HEAD` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-253-01 (transfer) | T-253-12 residual; review round 1 WR-01 | Traded-symbol strings (`binance_partial_symbols`, `binance_deadline_symbols`, page-cap, untimed-page, unlisted lists) sit on the anon-readable `strategy_analytics.data_quality_flags` of a published strategy (`analytics_read` policy) and, since 253, persist until the next clean Binance sync. The class predates 253 (`binance_partial_symbols` since 2026-05-17). Not fixable in 253: SC-3 requires `binance_deadline_symbols` to survive the derive and CSV writes, and the Phase 250 quiet-prefix reader uses it. Dormant while `USE_RAW_TRADE_INGESTION` is off. Transferred to `TODOS.md` `[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]` (owner: the phase that turns the switch on for Binance, before it flips; gate: an anon PostgREST read returns no symbol string). Caveat: the switch is process-global (`job_worker.py` `_RAW_TRADE_INGESTION_ENABLED`, default `"false"`, read once at import), so "off for Binance" means off for every venue; the live Railway value is not verifiable from the repo. | Routed under the repo review rule (MEDIUM, routed in 253-REVIEW-FIX.md round 1) | 2026-11-26 |
| AR-253-02 (transfer) | T-253-07 residual; round-4 focused review of fix `6d0a48a7a` (WR-03 narrowed, not closed) | On a set column with no stored fill, a run whose provisional bound write fails skips the fills read and holds its own daily store, but `cron_sync` (`routers/cron.py`) and `/fetch-trades` (`routers/exchange.py`) store daily rows without consulting the bound. After the RPC recovers, the next run seeds past the unread span. T-253-07's control holds for the worker's own writes; this path is outside it. Trigger: the bound RPC unavailable for longer than a cron cycle while the switch is on (worker against a database without migration `20261126150000`, or that migration rolled back). Dormant while `USE_RAW_TRADE_INGESTION` is off. Transferred to `TODOS.md` `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (owner: the phase that turns the switch on for Binance, before it flips; fix direction: fail closed unless the RPC exists on the target database). | Routed under the repo review rule (MEDIUM data-integrity survivor, commit `23d591467`) | 2026-11-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-26 | 17 | 17 | 0 | gsd-security-auditor (Sonnet, ASVS L1, block_on high) at `0084b80cc`; presence-only for SQL gate and live-DB pytest arms |
| 2026-11-26 | 17 | 17 | 0 | orchestrator: AR-253-02 added for the routed round-4 residual `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (`23d591467`); no register status changed |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-26 (gate arms CI-bound; see Evidence limit)
