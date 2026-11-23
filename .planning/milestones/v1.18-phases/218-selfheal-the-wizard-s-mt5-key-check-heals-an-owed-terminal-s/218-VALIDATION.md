---
phase: "218"
slug: "selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-19"
---

# Phase 218 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 218-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (asyncio auto) in `analytics-service/`; vitest |
| **Config file** | `analytics-service/pytest.ini`; `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_mt5_validate.py tests/test_mt5_validation_park.py tests/test_mt5_terminal_scrub.py tests/test_validate_key_venue_transient.py tests/test_mt5_server_known.py -q -x` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -q` + mypy strict (CI line) ; `npm test` ; `npm run typecheck` ; `npm run lint` |
| **Estimated runtime** | ~120 seconds quick; full suites several minutes |

---

## Sampling Rate

- **After every task commit:** the quick pytest line for server tasks; the touched vitest file(s) for TS tasks
- **After every plan wave:** full analytics pytest + mypy strict + vitest for touched folders
- **Before `/gsd-verify-work`:** full suites green
- **Neuter once (project rule):** probe after a non-scrubbed kind; pass the wizard bound as the thread deadline; drop the banner hold. Each must go RED, restored from a byte backup.

---

## Per-Task Verification Map

Filled by the planner per task (SC-1..SC-7 and census rows from RESEARCH.md). SC ids are derived (no REQ ids are assigned to 218); each plan's `requirements` carries them as `218-SC-N`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 218-01-T1 | 01 | 1 | SC-1, SC-2, SC-3 (server), SC-5 | T-218-01, T-218-04, T-218-05 | no probe after a non-scrubbed kind; detail names no infrastructure | pytest (tracer) + neuter-once | `cd analytics-service && python3 -m pytest -p no:cacheprovider -q tests/test_mt5_validation_park.py tests/test_mt5_concurrency.py tests/test_raw_5xx_census.py` + mypy strict | yes (rewrite + new cases) | ⬜ |
| 218-01-T2 | 01 | 1 | SC-2, SC-3 (server) | T-218-03, T-218-04 | thread deadline never the wizard bound; sibling never raises | pytest + neuter-once | `cd analytics-service && python3 -m pytest -p no:cacheprovider -q tests/test_mt5_validate.py tests/test_mt5_validation_park.py tests/test_mt5_terminal_scrub.py tests/test_validate_key_venue_transient.py tests/test_mt5_server_known.py tests/test_mt5_session_episodes.py tests/test_mt5_relogin.py tests/test_status_contract_exchange_internal.py` + mypy strict | yes (edit) | ⬜ |
| 218-02-T1 | 02 | 2 | SC-4, SC-5 (park noise) | T-218-06, T-218-07 | worst case 105 s inside 120 000 ms; floor refuses an overrun | pytest (tracer) + neuter-once | `cd analytics-service && python3 -m pytest -p no:cacheprovider -q tests/test_mt5_validate.py tests/test_mt5_validation_park.py tests/test_mt5_terminal_scrub.py tests/test_validate_key_venue_transient.py tests/test_mt5_server_known.py` + mypy strict | yes (extend) | ⬜ |
| 218-02-T2 | 02 | 2 | SC-3 (docs), SC-4 (docs) | T-218-08 | contract doc matches the code | doc grep + quick pytest + mypy | `grep -n '^\| S-31 \|' analytics-service/docs/STATUS_CONTRACT.md` ; quick analytics line incl. `tests/test_ingestion_mt5.py` ; mypy strict (full suite at plan level) | yes | ⬜ |
| 218-03-T1 | 03 | 2 | SC-3 (wizard), census | T-218-09, T-218-SC | closed wire vocabulary; lockfile unchanged | vitest (tracer) | `npx vitest run tests/lib/validate-key-venue-transient-parity.test.ts src/lib/seam-venue-vocabulary.invariant.test.ts src/lib/dialog-envelope.invariant.test.ts src/lib/wizardKeyRosters.test.ts src/lib/wizardErrors.test.ts src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.roster-render.test.tsx` + `npm run typecheck` | yes (edit) | ⬜ |
| 218-03-T2 | 03 | 2 | SC-3 (wizard) | T-218-10 | not captured; copy true at its only emitter | vitest + neuter-once | `npx vitest run` over the 5 twin files + `StrategyForm.test.tsx` | yes (twins) | ⬜ |
| 218-04-T1 | 04 | 1 | SC-6 | T-218-12, T-218-SC | no step effects before the founder chooses | vitest (tracer) + neuter-once | `npx vitest run "src/app/(dashboard)/strategies/new/wizard" "src/app/(dashboard)/allocations/components" src/lib/wizard` + `npm run typecheck` | partial (new `WizardClient.resume-hold.test.tsx`) | ⬜ |
| 218-04-T2 | 04 | 1 | SC-7 | T-218-14 | copy names a secret kind only | vitest (matrix) | `npx vitest run src/lib/wizard/resume-banner.test.ts "src/app/(dashboard)/strategies/new/wizard" "src/app/(dashboard)/allocations/components"` + typecheck + lint | no (new `resume-banner.test.ts`) | ⬜ |

**Neuter-once homes:** (a) probe after a non-scrubbed kind is in 218-01-T1; (b) the wizard bound passed as the thread deadline is in 218-01-T2; (c) the floor disjunct is dropped in 218-02-T1; (d) the verdict row is deleted in 218-03-T2; (e) the banner hold is dropped in 218-04-T1. Each restores from a byte backup in the scratchpad (`cmp` exit 0), never through git.

**Expected cross-plan red:** after 218-01, and before 218-03, `src/lib/seam-venue-vocabulary.invariant.test.ts` and `tests/lib/validate-key-venue-transient-parity.test.ts` are RED by construction. 218-03 makes both green.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_mt5_validation_park.py` — inline-heal tests (healed, each failure kind, bound overrun, floor)
- [ ] `analytics-service/tests/test_mt5_terminal_scrub.py` — bound plumbing and never-raises sibling
- [ ] banner copy pure function + test under `src/lib/wizard/`
- [ ] `node_modules` installed in the executor worktree

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First wizard MT5 check after an analytics deploy succeeds without Retry | SC-1 | needs a real deploy + the validation terminal | After the ship deploy, run one wizard MT5 key check; expect a normal verdict and an `owed_scrub` stage event in Railway logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
