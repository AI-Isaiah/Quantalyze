---
gate: phase-16-exit-day-2-decision
status: COMMIT
decided_at: "2026-05-06T00:00:00Z"
decided_by: "Founder (Helmut Mueller)"
deliberation_started_at: "2026-05-06T00:00:00Z"
deliberation_minutes: 0
correlation_id_evidence_chain:
  - "PR #116 (commit 3932842, 2026-05-05): live OKX strategy 272-trade reproduction → migration 099 atomic bridge fix → strategy_analytics.computation_status flips to 'complete' under wizard poll loop"
  - "Plan 18 root-cause section in commit body: dispatch-order race in main_worker.py:155-165, sync_strategy_analytics_status fired before mark_compute_job_done, leaving strategy_analytics frozen at 'computing'"
  - "PRs #117-120: 4 Bybit-specific patches (readOnly STRING vs INT, permission detection precedence, fetchCurrencies disable, INTERNAL_API_TOKEN parity, load_markets best-effort) — broker-quirk root causes, not route divergence"
post_draft_correction: "Original auto-draft (2026-05-06T00:00:00Z) had deliberation_minutes:0 + empty evidence chain because it pre-dated PR #116 integration. Day-2 work was already shipped 2026-05-05; this revision records the verdict against the actual Phase 18 root causes, not the stale hypothesis ranking."
---

# Day-2 Decision Document — Phase 16 → Phase 18 Gate (REVISED)

> **REVISED 2026-05-06.** The original auto-draft (preserved in Appendix C) was generated from Phase 16 verification artifacts that had not yet absorbed PR #116 (merged 2026-05-05). PR #116 — explicitly self-titled "Phase 18 / Day-2 root-cause fix" in migration 099's header — surfaced the recurring wizard-hang root cause via end-to-end Playwright + a live OKX strategy. This revision records the verdict against the actual evidence chain.

## TL;DR

**Verdict: COMMIT to Phase 19.**

Phase 16's diagnostic backbone shipped (10/12 OBSERV at code level, 2,731 frontend + 653 analytics tests green). PR #116 (2026-05-05) used a subset of that backbone — error envelope correlation_id round-trip + structlog + Playwright observability + Sentry boundaries — to root-cause the wizard hang via direct end-to-end testing instead of the SSE smoke harness. Three distinct root causes shipped:

1. **Bridge race** (migration 099) — `mark_compute_job_done` and `mark_compute_job_failed` were not atomic with `sync_strategy_analytics_status`. The 50ms gap let the bridge fire while `compute_jobs.status='running'`, the 038 RPC's "any non-terminal → 'computing'" branch wrote `strategy_analytics.computation_status='computing'`, and then the bridge was never re-fired after terminal flip. Wizard polled forever.
2. **Missing chain link** — `run_sync_trades_job` did not enqueue the follow-on `compute_analytics` job. Documented in migration 032 STEP 11/12 since Sprint 3 but never wired. New strategies finished sync_trades and stayed at NULL metrics indefinitely.
3. **Validate-key swallow sites** — bare `except Exception:` clauses in `routers/exchange.py:validate_key` and `services/exchange.py:validate_key_permissions` discarded the upstream ccxt class + body, masking real broker rejections behind generic `code: UNKNOWN` envelopes. Replaced with `logger.exception` for full stack traces + ccxt class names.

Subsequent PRs #117–#120 patched 4 distinct Bybit-specific issues (readOnly STRING vs INT, permission detection precedence, fetchCurrencies disable, INTERNAL_API_TOKEN parity wiring, load_markets best-effort fallback) — these are broker-quirk root causes that argue for a broker-quality SLA pattern, not for or against the BACKBONE unification verdict.

Founder commits to Phase 19 unification (POST /process-key + IngestionAdapter Protocol + state-machine wizard transitions + 4-PR VIEW-shim + flag-monitor cron + idempotency UNIQUE INDEX + process_key_long job registry + JSONB fingerprint + compute_similarity if/when reactivated) as the v1.1 backbone reset rather than continuing to spot-fix divergent routes. Open-perp + TWR≠YTD reconciliation (BACKBONE-06/07) fold into Phase 18 as independent v1 deliverables.

---

## Section 1 — Candidate Root Causes (Revised against PR #116 evidence)

| # | Hypothesis | Status (REVISED) | Evidence |
|---|-----------|------------------|----------|
| 1 | `compute_jobs.metadata->>'correlation_id'` not threaded through `enqueue_compute_job` calls | **CONFIRMED, scoped as forensic gap (NOT the wizard-hang root cause)** | Original auto-draft cited `route.ts:110, :158` — these are inside `logAuditEvent({metadata:{path:'queue'/'legacy'}})` writes to `audit_log`, **not** `compute_jobs.metadata`. The actual `enqueue_compute_job` RPC at `route.ts:81-84` passes only `{p_strategy_id, p_kind}`, even though the RPC accepts `p_metadata JSONB DEFAULT NULL` (migration 062 + 032). Forensic chain incomplete; ships as Phase 18 forensic patch. |
| 2 | Migration 084/085/086 trigger fires under `auth.uid() = NULL` from service-role | RULED OUT | Plan 16-04 RLS audit: 4 pytest cases assert `stamp_first_*` use `NEW.user_id`. Forward-guard CI test added. |
| 3 | Resend tag round-trip drops correlation_id under load | RULED OUT (architecturally) | Plan 16-05: tags-first + `(correlation_id, resend_message_id)` mapping fallback; migration 098 RLS-locked correlation table on test project `qmnijlgmdhviwzwfyzlc`. |
| 4 | Sentry boundaries miss `correlation_id` tag | RULED OUT | Plan 16-03: `error.tsx` + `global-error.tsx` with correlation_id tag; `analytics-service/sentry_init.py` PII before_send mirrors pii-scrub.ts. |
| 5 | KEK env-var read fails silently in Railway | **NOT THE WIZARD ROOT CAUSE** (subsumed) | PR #116's validate-key swallow-sites fix (`routers/exchange.py` + `services/exchange.py`) reveals the actual error class + body via `logger.exception`. The original "fails silently" symptom was the swallow site, not the KEK read. Plan 16-07 Task 5 SSE smoke remains optional forensic infrastructure. |
| 6 | Broker-specific timing/rate-limit on first `validate_key` call | **NOT THE WIZARD ROOT CAUSE; broker-quirk subset confirmed in 4 follow-up PRs** | PRs #117-120 patched 4 Bybit-specific issues (readOnly typing, permission detection, fetchCurrencies, load_markets, INTERNAL_API_TOKEN). None caused the recurring "wizard hangs at computing" pattern; that was hypothesis-bridge-race (#9, new). |
| 7 | Wizard step state machine drops error envelope between steps | RULED OUT (UI level) | Plan 16-06 WizardErrorEnvelope wired in 3 steps (8 vitest passing); Playwright MCP addendum confirmed envelope renders with correlation_id matching meta tag. |
| 8 | PostHog mobile cohort ≥ threshold → mobile-only failure | RULED OUT (for now) | Plan 16-09: N=0 mobile `wizard_start` events; documented credential gap; mobile fallback deferred to Phase 17 conditional. |
| **9** | **(NEW) Bridge race in main_worker.py dispatch loop** | **CONFIRMED — wizard root cause, shipped PR #116** | `main_worker.py:155-165` dispatched `sync_strategy_analytics_status` BEFORE `mark_compute_job_done`. The 038 RPC's "any non-terminal → 'computing'" branch wrote stale status, and the bridge was never re-fired after terminal flip. Migration 099 makes the bridge atomic with the status flip. Live-verified on a stuck OKX strategy (272 trades). |
| **10** | **(NEW) Missing sync_trades → compute_analytics chain link** | **CONFIRMED — wizard root cause, shipped PR #116** | `run_sync_trades_job` finished trade persist and never enqueued `compute_analytics`. Documented in migration 032 STEP 11/12 since Sprint 3 but unwired. New strategies stayed at NULL metrics + `computation_status='computing'` indefinitely. PR #116 wires the enqueue with transient-failure tolerance + 2 regression tests in `test_job_worker.py:553`. |
| **11** | **(NEW) Validate-key swallow sites mask broker rejections** | **CONFIRMED — observability root cause, shipped PR #116** | `routers/exchange.py:validate_key` + `services/exchange.py:validate_key_permissions` had bare `except Exception:` discarding ccxt class + body. Customers saw `code: UNKNOWN`. Replaced with `logger.exception`. |
| **12** | **(NEW 2026-05-06) Vercel prod `INTERNAL_API_TOKEN` had literal `\n` suffix; broke parity with Railway** | **CONFIRMED — production internal-auth root cause, fixed this session** | `vercel env pull --environment=production` showed value bytes `…bdd3\\n` (hex `5c 6e` = literal backslash-n at offset 0x52, not a newline char). Railway value was clean. Vercel→FastAPI internal calls used `secrets.compare_digest(provided, expected)` (constant-time strict bytewise — `analytics-service/routers/internal.py:117`); the trailing `\n` made every prod call from `/api/debug-key-flow`, `/api/strategies/finalize-wizard`, and `/api/keys/[id]/permissions` 403 against the analytics-service. Preview env was clean (PR previews unaffected). Fixed via `vercel env rm INTERNAL_API_TOKEN production` + re-add via stdin (clean 64-hex-char value); prod redeployed `dpl_7tXiB3WS6mdfv9qMkZRprMrs7u5o → quantalyze-hh1p7ido4` aliased to `quantalyze-rho.vercel.app`. **Strong candidate for the recurring "API key fails after several attempts" customer pattern** — `/api/keys/[id]/permissions` 403s manifest as opaque wizard failures because the route 403s BEFORE reaching PR #116's swallow-site fix in `routers/exchange.py:validate_key`. |
| **13** | **(NEW 2026-05-06) FastAPI `_read_test_creds` calls `decrypt_credentials` with wrong signature** | **CONFIRMED — Plan 16-07 Task 5 staging blocker** | `analytics-service/routers/debug_key_flow.py:82` calls `encryption.decrypt_credentials(v)` with single-string arg; real signature is `decrypt_credentials(encrypted_row: dict, kek: bytes) -> tuple[str, str, str | None]` (`services/encryption.py:90`). Comment line 64 says "adjust per actual API at founder-gate". Direct curl smoke against Railway with the now-staged 7 DEBUG_KEY_FLOW_* vars + clean INTERNAL_API_TOKEN returns: `{"step":"validate_key","status":"error","error":{"code":"TypeError","human_message":"decrypt_credentials() missing 1 required positional argument: 'kek'"}}`. Phase 18 fix: drop the Fernet-decrypt call (testnet creds are low-sensitivity; raw plaintext storage is fine) — alternative is to KEK-encrypt the env values, which is over-engineered for testnet. |
| **14** | **(NEW 2026-05-06) FastAPI step bodies (`validate_key`/`encrypt_key`/`fetch_trades`) are documented placeholders** | **CONFIRMED — Plan 16-07 Task 5 staging blocker** | Comments at `analytics-service/routers/debug_key_flow.py:108`, `:148`, `:178` say "Real call wired at founder-gate". Bodies return static dicts (`{"valid": True, "broker": ...}`, field lengths only, `{"fetched": 0}`) — no `services.exchange.validate_key_permissions`/`fetch_raw_trades` invocation. Both real functions exist (`services/exchange.py:49,461`). Phase 18 fix: wire the real calls into the placeholder bodies. Without this, the SSE diagnostic harness can never validate broker creds against live broker sandboxes — even with Plan 16-07 env staging + token parity fixed. |

**Net (REVISED 2):** 5 ruled out, 1 confirmed forensic gap (#1), 2 reframed as not-wizard-root (#5, #6), 3 NEW confirmed wizard root causes shipped in PR #116 (#9, #10, #11), **3 NEW confirmed root/blocker causes surfaced 2026-05-06 (#12 prod auth root cause [fixed], #13 + #14 Plan 16-07 staging blockers [Phase 18 wiring owed])**.

---

## Section 2 — Bug #1 Forensic Patch (corrected scope)

The original auto-draft mis-cited the call site. Correct scope:

- **Actual call site:** `src/app/api/keys/sync/route.ts:81-84` — `enqueue_compute_job` RPC invocation passes only `{p_strategy_id, p_kind}`. The RPC signature (migration 062:174-180) accepts `p_metadata JSONB DEFAULT NULL`; we never pass it.
- **Wrong cite in auto-draft:** lines 110 + 158 are inside `logAuditEvent` calls writing `metadata: {path: 'queue'/'legacy'}` to the `audit_log` table — distinct table, distinct purpose.
- **Fix:** thread `await getCorrelationId()` from `@/lib/correlation-id` into `p_metadata: { correlation_id }` at the queue-path RPC call.
- **Test:** mock the RPC, assert third positional arg `{p_metadata: {correlation_id: <header-value>}}`. The auto-draft snippet was wrong (used `expect.objectContaining({metadata: ...})` against the second arg, which is the named-arg payload — close, but missed that `p_metadata` is the named key).
- **Mirror:** sweep `src/app/api/allocator/holdings/sync/route.ts` for symmetric calls (review at PR time).
- **Why ship it under COMMIT:** even with Phase 19 unification on the way, the next 2-4 weeks of v1 traffic will continue running through divergent routes; threading the correlation_id buys forensic completeness during the transition window. One line + one test, low risk.

---

## Section 3 — Falsifiable SKIP/COMMIT/HOLD Criteria (REVISED with PR #116 evidence)

| Path | Criteria | Met? |
|------|---------|------|
| **SKIP** | Single correlation_id chain → ONE bug | NO — three independent wizard-hang root causes shipped (bridge race + missing chain + swallow sites) plus four Bybit-quirk root causes shipped in PR #117-120. |
| **SKIP** | Regression test fails without fix | YES for each (TestSyncTradesEnqueuesComputeAnalytics in test_job_worker.py:553; migration 099's DO-block self-verifying invariant). |
| **SKIP** | No other failure mode unexplained | NO — the 4 Bybit-quirk PRs prove broker-quality is a parallel concern. |
| **COMMIT** | 2+ root causes | **YES** — three wizard root causes (bridge race, chain link, swallow sites) + four broker-quirk root causes. |
| **COMMIT** | ≥3 files in fix | **YES** — PR #116 alone touched 5: migration 099, main_worker.py, routers/exchange.py, services/exchange.py, run_sync_trades_job. PRs #117-120 added 4-5 more. |
| **COMMIT** | No clean unit test possible | **PARTIAL** — bridge race has the migration-99 DO-block invariant; chain link has TestSyncTradesEnqueuesComputeAnalytics; broker-quirks tested via Bybit detection unit tests. The "no clean test" criterion was a SKIP-tiebreaker, not a hard COMMIT requirement. |
| **HOLD** | Surfaced cause unfamiliar | NO — the bridge race and missing chain link are familiar dispatch-ordering / job-graph patterns. Both have specific code-level fixes already shipped. |

**Verdict: COMMIT.** Multiple distinct root causes already shipped justify continuing the unification work as the long-term backbone reset rather than further spot-fixing divergent routes.

---

## Section 4 — Phase 19 BACKBONE / FINGERPRINT under COMMIT

| REQ | Description | Scope under COMMIT | Notes |
|-----|-------------|--------------------|-------|
| BACKBONE-01 | `POST /process-key` unified RPC | IN | Replaces verify-strategy + validate-and-encrypt + keys/sync + finalize-wizard. |
| BACKBONE-02 | `IngestionAdapter` Protocol | IN | OKX + Bybit adapters as v1 brokers; Binance as future-broker stub (account deferred). |
| BACKBONE-03 | `verification_requests` → `strategy_verifications` migration | IN | 4-PR VIEW-shim per BACKBONE-04. |
| BACKBONE-04 | 4-PR VIEW-shim sequence | IN | Plan-checker enforces no-combine rule per STATE.md L109. |
| BACKBONE-05 | Feature flag + cron-based rollback monitor | IN | Operational safety for the cutover. |
| BACKBONE-06 | Open-perp correctness fix | ~~IN (Phase 18)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19 | Independent v1 work, ships ahead of unification. |
| BACKBONE-07 | TWR ≠ YTD reconciliation at equity-curve layer | ~~IN (Phase 18)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19 | Independent v1 work, ships ahead of unification. |
| BACKBONE-08 | State-machine wizard step status transitions | IN | Locks the wizard state model so future bridge-race-class bugs are statically detectable. |
| BACKBONE-09 | Idempotency via `wizard_session_id` UNIQUE INDEX | IN | Prevents the double-submit class of bug. |
| BACKBONE-10 | `process_key_long` job registry insert | IN | Tied to BACKBONE-01. |
| FINGERPRINT-01 | JSONB `fingerprint` column | DEFERRED to v2 (UC-C) | Per UC-C 2026-04-30. |
| FINGERPRINT-02 | `compute_similarity()` SQL function | DEFERRED to v2 (UC-C) | Per UC-C 2026-04-30. |

10 of 12 BACKBONE/FINGERPRINT tasks IN scope. FINGERPRINT-01/02 remain deferred to v2 per the prior UC-C decision.

---

## Section 5 — Phase 18 Scope (under COMMIT)

> **REVISED 2026-05-06** — BACKBONE-06 + BACKBONE-07 rows below are SUPERSEDED. Per `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` L22-23, both pushed to Phase 19 (rationale: pairs with `IngestionAdapter.reconstruct_positions` + equity-curve refactor). Section preserved for historical record; canonical phase attribution lives in REQUIREMENTS.md + ROADMAP.md.

| Deliverable | Status |
|-------------|--------|
| Bug #1 forensic fix (compute_jobs correlation_id thread, corrected cite) | IN-FLIGHT this session |
| Python `redact.py` mirror of `src/lib/admin/pii-scrub.ts` | READY to plan |
| Founder LP report cron reusing factsheet PDF endpoint | READY to plan |
| BACKBONE-06: Open-perp correctness fix | ~~READY to plan (independent v1)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19 |
| BACKBONE-07: TWR ≠ YTD reconciliation at equity-curve layer | ~~READY to plan (independent v1)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19 |
| Phase 19 entry prep: route inventory + migration plan 093-097 (per STATE.md L106-107) | READY to plan |

Phase 19 (BACKBONE-01..05/08-10) follows Phase 18 in Wave 5.

---

## Section 6 — Open Phase 16 Founder Gates (Status update)

| Gate | Status |
|------|--------|
| Plan 16-07 Task 5 — Railway DEBUG_KEY_FLOW_* + INTERNAL_API_TOKEN + SSE smoke | **PARTIAL 2026-05-06.** ✅ 7 DEBUG_KEY_FLOW_* env-blobs staged in Railway production (raw plaintext — testnet creds; Fernet-encryption discussion deferred). ✅ INTERNAL_API_TOKEN parity restored on Vercel prod (Hypothesis #12 fixed). ❌ FastAPI placeholder code blocks live smoke (Hypotheses #13 + #14). Phase 18 wires the real broker calls + drops the broken `decrypt_credentials` call; smoke unblocks at that point. Smoke-test invocation committed as `scripts/smoke-debug-key-flow.sh` so the unblock event is repeatable. |
| Plan 16-08 Task 3 — 12 vcrpy cassettes against live broker sandboxes | **DONE for in-scope brokers (8/8) 2026-05-06.** OKX 4/4 ✅ (PR #113). Bybit 4/4 ✅ (this PR — commit `5e6a948`; replay 4/4 passed; Layer A + B leak gates clean). **Binance 4/4 deferred — founder has no Binance account.** Target lowered from 12 to 8 stands. Test_repro_key_flow.py now accepts `TypeError` as a valid drift exception class (real-world Bybit ccxt parser crash on missing `coin` array). |

---

## Section 7 — Founder Override (RECORDED)

- [x] I have reviewed the revised Sections 1-6.
- [x] My verdict is: **☑ COMMIT**
- [x] Phase 19 unification proceeds in Wave 5 after Phase 18.
- [x] Phase 18 in-scope: redact.py + LP cron + Bug #1 forensic fix + open-perp + TWR + Phase 19 entry prep.
- [x] Plan 16-07 Task 5: complete now (Railway env staging + SSE smoke endpoint wiring).
- [x] Plan 16-08 Task 3: complete Bybit cassettes now; defer Binance pending account.

**Founder: Helmut Mueller   Date: 2026-05-06**

---

## Appendix A — Phase 16 SC Verification Snapshot (REVISED)

| SC | Truth | Status | Notes |
|----|-------|--------|-------|
| SC-1 | correlation_id queryable in 5 layers | PARTIAL → IN-FLIGHT (4/5 → 5/5 after Bug #1 patch) | This session's Phase 18 fix closes the compute_jobs.metadata gap. |
| SC-2 | Wizard structured envelope on every error path | VERIFIED | 8 vitest + Playwright MCP confirmed. PR #116 validate-key swallow-fix ensures real broker errors no longer collapse to `code: UNKNOWN`. |
| SC-3 | repro-key-flow.sh deterministic against cassettes | IN-FLIGHT | Target lowered to 8 cassettes (OKX 4/4 ✅, Bybit 4/4 in-flight, Binance deferred). |
| SC-4 | /api/debug-key-flow SSE runs against test creds | PENDING | Founder elects to complete now. |
| SC-5 | Migrations 084/085/086 audited under unified-pipeline RLS + PostHog mobile count | VERIFIED | trigger-rls-audit.md + TODOS.md OBSERV-11 N=0. |

---

## Appendix B — Open Questions from Original Auto-Draft (Resolved)

1. **Bug #1 ship in Phase 18?** YES — as forensic patch, not as the regression-test deliverable for the original wizard hang (that was bridge race + missing chain).
2. **Stage Railway env post-Phase 18 or pre?** NEITHER — founder elects to complete now in parallel with Phase 18 work (D2 in this session).
3. **LP cron scoped to existing factsheet PDF endpoint?** Pending Phase 18 plan-phase clarification.

---

## Appendix C — Original Auto-Draft Status Header (preserved for audit)

```yaml
gate: phase-16-exit-day-2-decision
status: HOLD
decided_at: "2026-05-06T00:00:00Z"
decided_by: "Claude (auto-draft, pending founder approval)"
deliberation_started_at: "2026-05-06T00:00:00Z"
deliberation_minutes: 0
correlation_id_evidence_chain: []
```

The auto-draft recommended HOLD pending Plan 16-07 Task 5 + Plan 16-08 Task 3 because it had not absorbed PR #116 (merged 2026-05-05, the day before draft generation). Migration 099's commit body explicitly self-titles "Phase 18 / Day-2 root-cause fix" — the actual Day-2 work was already done. This revision records the founder verdict against the real evidence chain.

---

_Revised: 2026-05-06 by Founder (Helmut Mueller) with Claude assistance._
_Source artifacts: PR #116 commit body (3932842); migration 099_mark_compute_job_atomic_status_bridge.sql; analytics-service/tests/test_job_worker.py:553 (TestSyncTradesEnqueuesComputeAnalytics); PR #117 (5a55f0e), #118 (7a418d7), #119 (5a55f0e), #120 (25fa4da)._
