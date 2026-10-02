---
phase: 119
slug: sfox-read-adapter-key-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-18
---

# Phase 119 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) + vitest (src) + Supabase SQL tests |
| **Config file** | `analytics-service/pytest.ini`, `vitest.config.ts`, `supabase/tests/` |
| **Quick run command** | `cd analytics-service && .venv/bin/python -m pytest tests/test_sfox_*.py -q` |
| **Full suite command** | `cd analytics-service && .venv/bin/python -m pytest -q` ; `npm test` |
| **Estimated runtime** | ~10s python subset; parity contract test ~2s |

---

## Sampling Rate

- **After every task commit:** quick command for the touched surface
- **After every plan wave:** full suite + the parity contract test (`check-zod-db-check-parity`)
- **Before verify:** parity test green, SQL RED constraint test green (on TEST project), route tests green
- **Max feedback latency:** ~15s

---

## Per-Task Verification Map

| Task ID | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|-------------|-----------------|-----------|-------------------|--------|
| constraint-widen | 1 | SFOX-04 | `'sfox'` admitted at 4 CHECKs; still-invalid rejected; self-verify RAISE | SQL RED | `supabase/tests/test_sfox_exchange_boundary.sql` | ⬜ |
| lockstep-allowlist | 1 | SFOX-04 | TS SUPPORTED_EXCHANGES + pydantic Literals + fixture admit sfox | contract | `npm test -- check-zod-db-check-parity` | ⬜ |
| worker-validate-branch | 2 | SFOX-03 | non-ccxt sFOX validate; auth-fail → KEY_AUTH_FAILED; secret carve-out; ccxt path unchanged | unit | `pytest tests/test_sfox_validate.py -q` | ⬜ |
| routes-accept-sfox | 2 | SFOX-03 | all 3 routes admit sfox; secret optional for sfox only; fail-closed honest copy | unit | `vitest run src/app/api/**/route.test.ts` | ⬜ |
| read-pull | 3 | SFOX-02 | balances+trades+txns read via SfoxClient, read-only asserted; live leg human_needed | unit | `pytest tests/test_sfox_read.py -q` | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_sfox_exchange_boundary.sql` — RED constraint test (admits sfox, rejects bogus)
- [ ] `analytics-service/tests/test_sfox_validate.py` — worker validate-branch unit (auth ok / auth fail → honest)
- [ ] `analytics-service/tests/test_sfox_read.py` — read-pull unit (mocked SfoxClient)

*Existing parity contract test + route tests cover the lockstep + route surfaces.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration applied to TEST project | SFOX-04 | MCP apply to `qmnijlgmdhviwzwfyzlc` before merge (gate) | Apply via Supabase MCP, run the RED SQL test on TEST |
| Live prod-account read | SFOX-02 | Needs real sFOX key + likely phase-121 egress | Founder connects a real sFOX key; verify balances/trades/txns pull |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Parity contract test green (both sides + fixture)
- [ ] ccxt-exchange validation NOT weakened by the sfox secret carve-out (security)
- [ ] `nyquist_compliant: true` set

**Approval:** pending
