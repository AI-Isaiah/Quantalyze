---
phase: "242"
slug: "secretshygiene-the-full-history-is-scanned-on-a-schedule-and"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-27"
---

# Phase 242 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The planner fills the per-task map from `242-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workflow and file-shape pins), the SQL mutation runner on the pg-lane (SQL gates), gitleaks 8.30.1 (scan) |
| **Config file** | `vitest.config.ts`, `scripts/mutation-floors.mjs`, `.gitleaks.toml`, `.gitleaksignore` |
| **Quick run command** | `npx vitest run <touched test files> --testTimeout=120000` and `node scripts/mutation-runner/run.mjs --file <gate>` |
| **Full suite command** | `gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --exit-code 2` plus the touched vitest suites and `npm run typecheck && npm run lint` |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** the task's quick command
- **After every plan wave:** the full suite command
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

Filled by the planner 2026-11-27. Every task has an automated command; "PROOF" means the task also records a neuter / RED / `cp` + `cmp` / GREEN row in its plan SUMMARY.

| Plan-Task | Wave | Req | Behavior proven | Automated command | Fails when |
|-----------|------|-----|-----------------|-------------------|------------|
| 242-01-T1 | 1 | SECR-03 | ignore file suppresses every historical finding; the workflow's scan command reads zero; ignore-file shape pinned | `gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --no-banner --exit-code 2`; `actionlint .github/workflows/secret-scan-full-history.yml`; `npx vitest run src/__tests__/secret-scan-full-history.test.ts --testTimeout=120000` | exit 2 or 1 / a diagnostic / a failed arm |
| 242-01-T2 | 1 | SECR-03 | red path files one count-only dedup issue; every workflow property pinned and calibrated; commit-scoped vs global suppression shown on a throwaway repo | same vitest file; `npx vitest run src/__tests__/critical-regressions.test.ts --testTimeout=120000` | a failed arm, or the behavioural arm skipped where gitleaks exists |
| 242-01-T3 | 1 | SECR-03 | PROOF (S-01..S-07): one deleted fingerprint gives exactly one finding; inline comment voids a line; global line hides from the scan but not the pin | workflow/test-reading vitest set; range scan `origin/main..HEAD` | failed count > 0 / leaks found |
| 242-02-T1 | 1 | SECR-04 | CHECK and `cron_sync_tick` narrowed; W1 (wildcard sibling) bites | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_cron_sync_tick.sql; test $? -eq 2` | exit 1 / `arms:` not 9/9/0 |
| 242-02-T2 | 1 | SECR-04 | all four bodies re-based; snapshots match; VAC-04 pragmas; other three gates GREEN on the new bodies | `npm run schema:functions:check`; `lint-migration-data-dependence` (self-test + run); cron_sync `--file` | non-zero exit / occurrence-mismatch |
| 242-02-T3 | 1 | SECR-04 | P2 (header equals Vault secret), K1 (whitespace key); PROOF D-01..D-03 | cron_sync `--file` (11/11/0); `lint-sql-gates`, `lint-app-guc` (self-test + run) | exit 1 / a finding |
| 242-03-T1 | 2 | SECR-04 | prober gate repointed; W1, K1 bite | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_prod_prober_cadence.sql; test $? -eq 2` | exit 1 / not 9/9/0 |
| 242-03-T2 | 2 | SECR-04 | ops gate repointed; W1, K1 bite (`ops_staleness_check`, SC-2) | `... --file supabase/tests/test_ops_staleness_check.sql; test $? -eq 2` | exit 1 / not 16/16/0 |
| 242-03-T3 | 2 | SECR-04 | PROOF E-01..E-04 | `lint-sql-gates`, `lint-app-guc` | a finding |
| 242-04-T1 | 2 | SECR-04 | analytics gate repointed; U3 (CHECK refuses sibling), W1, K1 bite | `... --file supabase/tests/test_analytics_service_settings_and_vault_tick.sql; test $? -eq 2` | exit 1 / not 17/17/0 |
| 242-04-T2 | 2 | SECR-04 | rollback restores old bodies and CHECK; base-commit gates GREEN after it; second run refused | `node scripts/lint-app-guc.mjs`; `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts --testTimeout=120000` | a finding / failed arm |
| 242-04-T3 | 2 | SECR-04 | PROOF F-01..F-03 (F-01 also shows the verify block aborting an old-shaped CHECK) | `lint-sql-gates`, `lint-app-guc` | a finding |
| 242-05-T1 | 3 | SECR-04 | ARMS_FLOOR raised by the 10 new twinned arms; floor censuses agree | `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts --testTimeout=120000`; `node scripts/mutation-runner/run.mjs --parse-only` | RATCHET STALE / a defect / waived > 0 |
| 242-05-T2 | 3 | SECR-04 | sql-tests sentinel table and sum match the four gates | census vitest set incl. `contracts/ci-anti-skip-gate.contract.test.ts`, `drift-check-scripts`, `lint-sql-gates.test` | failed count > 0 |
| 242-06-T1 | 4 | SECR-03, SECR-04 | the two closed TODOS entries deleted, pointer fixed, dispatch entry annotated | TODOS-reading vitest set | failed count > 0 |
| 242-06-T2 | 4 | SECR-03, SECR-04 | runbooks check the exact set; WINDOWS 61 half (c) answered | `npx vitest run src/__tests__/mutation-annotation-parser.test.ts src/__tests__/mutation-runner-floors.test.ts --testTimeout=120000` | failed arm |
| 242-06-T3 | 4 | SECR-03, SECR-04 | phase gate: four `--file` runs, static census, linters, phase vitest set, typecheck + lint, full-history + range + squash-shaped scans | phase vitest set; `npm run typecheck && npm run lint`; `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=origin/main..HEAD` | failed count > 0 / non-zero exit / leaks found |

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree before any vitest command (no node_modules yet)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The scheduled workflow's first run on main is green | SECR-03 | Observable only after merge | Dispatch `secret-scan-full-history` on main after merge; record the run id |
| The migration applied on TEST and PROD | SECR-04 | Applied by `supabase-migrate.yml` on merge | Read the apply-test and apply run ids; marker query, then read the four bodies and the CHECK on PROD |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no MISSING sentinel; `npm ci` is each tracer task's precondition)
- [x] No watch-mode flags
- [ ] Feedback latency < 300s (a full-history scan is about 60 s and a gate `--file` run about 45-90 s; the phase gate in 242-06-T3 exceeds 300 s by design)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
