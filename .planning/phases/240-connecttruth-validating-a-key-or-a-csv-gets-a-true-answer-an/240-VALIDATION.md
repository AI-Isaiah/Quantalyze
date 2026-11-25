---
phase: "240"
slug: "connecttruth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-24"
---

# Phase 240 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The requirement → test map and the PROOF-01 neuter table live in `240-RESEARCH.md` § Validation Architecture; this file is the sampling contract over it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) + vitest (root) |
| **Config file** | `analytics-service/pytest.ini`, `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest <touched test file> -q -p no:cacheprovider` / `npx vitest run <touched test file>` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -n auto -q` ; `npx vitest run` ; CI strict mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) |
| **Estimated runtime** | quick ≈ 45 s; full Python ≈ 10 min; full vitest ≈ 10 min |

---

## Sampling Rate

- **After every task commit:** the touched file's quick command.
- **After every plan wave:** every Python file and vitest file named for that wave in RESEARCH § Validation Architecture, plus the mypy gate, plus `src/lib/*invariant*`, seam-log-coverage and critical-regressions.
- **Before `/gsd-verify-work`:** full suites green.
- **Max feedback latency:** 60 seconds per task.

---

## Per-Task Verification Map

Filled by the planner's task `<automated>` blocks; each requirement row in RESEARCH § "Phase Requirements → Test Map" must be covered by at least one task.

| Requirement | Wave 0 file | Automated command |
|-------------|-------------|-------------------|
| CONN-05 | `analytics-service/tests/test_validate_key_permanent_400.py`, `tests/lib/validate-key-permanent-400-parity.test.ts` | `python3 -m pytest tests/test_validate_key_permanent_400.py -q`; `npx vitest run tests/lib/validate-key-permanent-400-parity.test.ts src/lib/seam-venue-vocabulary.invariant.test.ts` |
| CONN-06 | extend `tests/test_csv_validator_date_format_2026_05_27.py` | `python3 -m pytest tests/test_csv_validator_date_format_2026_05_27.py tests/test_csv_rule_family_oracle.py -q` |
| RLIM-01 | `analytics-service/tests/test_process_key_anon_ip_tier.py` | `python3 -m pytest tests/test_process_key_anon_ip_tier.py tests/test_limiter_identity.py tests/test_anon_bucket_alert.py -q`; `npx vitest run src/lib/tenant-claim.test.ts src/lib/process-key-client.test.ts` |
| RLIM-02 | `analytics-service/tests/test_process_key_csv_tier.py`, `tests/lib/csv-limit-agreement.test.ts` | `python3 -m pytest tests/test_process_key_csv_tier.py -q`; `npx vitest run tests/lib/csv-limit-agreement.test.ts` |
| CONN-05 (permanence plumbing, plan 08) | `analytics-service/tests/test_process_key_permanence_plumbing.py` | `python3 -m pytest tests/test_process_key_permanence_plumbing.py tests/test_process_key_scope_rejection_statuses.py -q` |

Per task, copied verbatim from each task's `<automated>` blocks (18 tasks, 18 with an automated verify; each command's `<fails_when>` lives beside it in the plan):

| Task | Plan | Wave | Requirement | Type | Automated command(s) | Status |
|------|------|------|-------------|------|----------------------|--------|
| 240-01-T1 | 240-01 | 1 | CONN-06 | tracer | `cd analytics-service && python3 -m pytest tests/test_csv_validator_date_format_2026_05_27.py -q -p no:cacheprovider`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |
| 240-01-T2 | 240-01 | 1 | CONN-06 | auto | `cd analytics-service && python3 -m pytest tests/test_csv_validator_date_format_2026_05_27.py tests/test_csv_validator.py tests/test_csv_hostile_inputs_170_1.py tests/test_csv_never_raises_170_1.py tests/test_csv_excel_quirks.py tests/test_csv_header_case.py -q -p no:cacheprovider` | ⬜ pending |
| 240-01-T3 | 240-01 | 1 | CONN-06 | auto | `cd analytics-service && python3 -m pytest tests/test_csv_validator_date_format_2026_05_27.py tests/test_csv_rule_family_oracle.py tests/test_csv_never_raises_170_1.py tests/test_csv_hostile_inputs_170_1.py -q -p no:cacheprovider`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |
| 240-02-T1 | 240-02 | 1 | RLIM-01 | tracer | `cd analytics-service && python3 -m pytest tests/test_process_key_anon_ip_tier.py tests/test_tenant_claim_parsing.py tests/test_limiter_identity.py -q -p no:cacheprovider`<br>`cd analytics-service && python3 -m pytest tests/test_process_key.py -q -p no:cacheprovider -k "anon or claim or key_func or sizing or stacked or inner or registers"` | ⬜ pending |
| 240-02-T2 | 240-02 | 1 | RLIM-01 | auto | `cd analytics-service && python3 -m pytest tests/test_process_key_anon_ip_tier.py tests/test_limiter_route_coverage.py tests/test_anon_bucket_alert.py tests/test_envelope_recoverable.py -q -p no:cacheprovider`<br>`cd analytics-service && python3 -m pytest tests/test_process_key.py -q -p no:cacheprovider` | ⬜ pending |
| 240-02-T3 | 240-02 | 1 | RLIM-01 | auto | `cd analytics-service && python3 -m pytest tests/test_anon_bucket_alert.py tests/test_limiter_identity.py tests/test_process_key_anon_ip_tier.py tests/test_limiter_route_coverage.py tests/test_tenant_claim_parsing.py -q -p no:cacheprovider`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |
| 240-03-T1 | 240-03 | 1 | CONN-05 | tracer | `cd analytics-service && python3 -m pytest tests/test_validate_key_permanent_400.py tests/test_sfox_validate.py tests/test_validate_key_venue_transient.py -q -p no:cacheprovider`<br>`npx vitest run tests/lib/validate-key-permanent-400-parity.test.ts tests/lib/validate-key-venue-transient-parity.test.ts src/lib/seam-venue-vocabulary.invariant.test.ts` | ⬜ pending |
| 240-03-T2 | 240-03 | 1 | CONN-05 | auto | `cd analytics-service && python3 -m pytest tests/test_validate_key_permanent_400.py tests/test_sfox_validate.py tests/test_mt5_validate.py tests/test_mt5_validate_parity.py tests/test_mt5_rotate_secret_internal.py tests/test_validate_key_venue_transient.py tests/test_status_contract_exchange_internal.py -q -p no:cacheprovider`<br>`npx vitest run tests/lib/validate-key-permanent-400-parity.test.ts src/lib/seam-venue-vocabulary.invariant.test.ts src/lib/wizardErrors.invariant.test.ts src/lib/wizardKeyRosters.test.ts src/lib/dialog-envelope.invariant.test.ts`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |
| 240-04-T1 | 240-04 | 2 | RLIM-02 | tracer | `cd analytics-service && python3 -m pytest tests/test_process_key_csv_tier.py tests/test_tenant_claim_parsing.py tests/test_process_key_anon_ip_tier.py -q -p no:cacheprovider` | ⬜ pending |
| 240-04-T2 | 240-04 | 2 | RLIM-02 | auto | `cd analytics-service && python3 -m pytest tests/test_process_key_csv_tier.py tests/test_process_key_anon_ip_tier.py tests/test_tenant_claim_parsing.py tests/test_limiter_route_coverage.py tests/test_limiter_identity.py tests/test_anon_bucket_alert.py -q -p no:cacheprovider`<br>`cd analytics-service && python3 -m pytest tests/test_process_key.py tests/test_process_key_scope_rejection_statuses.py tests/test_envelope_recoverable.py -q -p no:cacheprovider`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |
| 240-05-T1 | 240-05 | 2 | CONN-05 | tracer | `cd analytics-service && python3 -m pytest tests/test_validate_key_permanent_400.py tests/test_validate_key_venue_transient.py tests/test_status_contract_exchange_internal.py tests/test_sfox_validate.py tests/test_mt5_validate.py -q -p no:cacheprovider`<br>`npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts src/lib/wizardErrors.invariant.test.ts src/lib/wizardKeyRosters.test.ts src/lib/dialog-envelope.invariant.test.ts` | ⬜ pending |
| 240-05-T2 | 240-05 | 2 | CONN-05 | auto | `cd analytics-service && python3 -m pytest tests/test_mt5_rotate_secret_internal.py tests/test_validate_key_permanent_400.py tests/test_status_contract_exchange_internal.py tests/test_raw_5xx_census.py tests/test_limiter_route_coverage.py -q -p no:cacheprovider`<br>`npx vitest run tests/lib/validate-key-permanent-400-parity.test.ts src/lib/seam-venue-vocabulary.invariant.test.ts 'src/app/api/keys/[id]/rotate-secret/route.test.ts'`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |
| 240-06-T1 | 240-06 | 3 | RLIM-01, RLIM-02 | tracer | `npx vitest run src/lib/process-key-client.test.ts src/app/api/verify-strategy src/lib/seam-log-coverage.test.ts tests/integration/process-key-thin-adapters.test.ts tests/lib/process-key-client.test.ts`<br>`npm run typecheck` | ⬜ pending |
| 240-06-T2 | 240-06 | 3 | RLIM-01, RLIM-02 | auto | `npx vitest run src/lib/tenant-claim.test.ts src/lib/analytics-client.test.ts src/lib/process-key-client.test.ts tests/integration/process-key-thin-adapters.test.ts src/__tests__/csv-validate-route.test.ts`<br>`cd analytics-service && python3 -m pytest tests/test_tenant_claim_parity.py tests/test_tenant_claim_parsing.py tests/test_process_key_anon_ip_tier.py tests/test_process_key_csv_tier.py -q -p no:cacheprovider`<br>`npm run typecheck && npm run lint` | ⬜ pending |
| 240-07-T1 | 240-07 | 3 | RLIM-02 | tracer | `npx vitest run src/app/api/strategies/csv-finalize src/__tests__/csv-finalize-after-failloud.test.ts src/__tests__/csv-finalize-c14-regression.test.ts src/__tests__/csv-finalize-concurrent-never-classified.test.ts src/__tests__/csv-finalize-cross-submission-merge.test.ts src/__tests__/csv-finalize-rpc.test.ts src/__tests__/csv-validate-route.test.ts src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/api/limiter-ordering.test.ts` | ⬜ pending |
| 240-07-T2 | 240-07 | 3 | RLIM-02 | auto | `npx vitest run tests/lib/csv-limit-agreement.test.ts src/lib/seam-ratelimit-posture.invariant.test.ts src/__tests__/csv-validate-route.test.ts`<br>`npm run typecheck && npm run lint` | ⬜ pending |
| 240-08-T1 | 240-08 | 3 | CONN-05 | tracer | `cd analytics-service && python3 -m pytest tests/test_process_key_permanence_plumbing.py tests/test_process_key_scope_rejection_statuses.py tests/test_envelope_recoverable.py -q -p no:cacheprovider`<br>`cd analytics-service && python3 -m pytest tests/test_process_key.py tests/test_process_key_anon_ip_tier.py tests/test_process_key_csv_tier.py -q -p no:cacheprovider` | ⬜ pending |
| 240-08-T2 | 240-08 | 3 | CONN-05 | auto | `cd analytics-service && python3 -m pytest tests/test_validate_key_venue_transient.py tests/test_error_contract_429.py tests/test_error_contract_r1_permanent_500.py tests/test_error_contract_scalar_detail.py tests/test_validate_key_permanent_400.py -q -p no:cacheprovider`<br>`grep -anE '[A-Za-z_/.-]+\.(py\|ts\|tsx):[0-9]+' analytics-service/docs/STATUS_CONTRACT.md \| grep -av '^[0-9]*:\| S-' \| wc -l # [HEAD=26 EXPECT==0]`<br>`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] the new test files, each created by the task that first runs it: `analytics-service/tests/test_validate_key_permanent_400.py` and `tests/lib/validate-key-permanent-400-parity.test.ts` (240-03-T1), `analytics-service/tests/test_process_key_anon_ip_tier.py` (240-02-T1), `analytics-service/tests/test_process_key_csv_tier.py` (240-04-T1), `tests/lib/csv-limit-agreement.test.ts` (240-07-T2), `analytics-service/tests/test_process_key_permanence_plumbing.py` (240-08-T1)
- [ ] the CONN-05 contract fixture `analytics-service/tests/fixtures/validate_key_permanent_400_contract.json` (240-03-T1)
- [ ] new cases in `tests/fixtures/tenant-claim-parity.json`
- [ ] `npm ci` in each executing worktree (no node_modules in fresh worktrees)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (18 of 18)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no task's verify is MISSING)
- [x] No watch-mode flags (every vitest call is `vitest run`)
- [ ] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
