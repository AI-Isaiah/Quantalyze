---
phase: 141
slug: seam-retry-with-backoff-gated-on-the-idempotency-audit
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-31
---

# Phase 141 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (TypeScript seam clients + registry); pytest 8.x for any live idempotency proof |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --no-file-parallelism src/lib/<changed>.test.ts` |
| **Full suite command** | `npx vitest run --no-file-parallelism` |
| **Estimated runtime** | ~90s (quick) / ~4min (full TS suite) |

---

## Sampling Rate

- **After every task commit:** Run the quick command on the changed seam-lib test file(s)
- **After every plan wave:** Run the full vitest suite
- **Before `/gsd:verify-work`:** Full suite green + SC2's idempotency proof exercised against the real `compute_jobs` index
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

*Populated by the planner / gsd-nyquist-auditor once PLAN.md tasks exist.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | SEAM-05/06 | — | retry only fires for allowlisted proven-safe calls | unit | `npx vitest run …` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] The typed retry-safety registry module + its test file (SC1)
- [ ] The retry wrapper (`withSeamRetry` or equivalent) + its test file (SC2/SC3/SC4)

*Existing seam infrastructure (breaker, budgets, discriminator, errors) covers the rest.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none) | — | — | — |

---

## Falsifiability Ledger

> **Coverage answers "is it verified?". This section answers "CAN the verification FAIL?"**
> One row per success criterion. Mutation = a *semantic* change to production code. Complete Observed at execution.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 | flip one registry entry from no-retry → retry (e.g. `teaser: {retries: 1}`) | the audit/registry-shape test | ✅ observed (141-03) | RED first-hand: adding `teaser: { retries: 1, evidence: "MUTANT" }` to `RETRY_SAFE_FLOW_TYPES` reddened **4** assertions in `seam-retry-registry.test.ts` — SC3 belt (`AssertionError: expected { retries: 1, evidence: 'MUTANT' } to be undefined`, :65), YES-map keys (`expected [ 'onboard', 'resync', 'teaser' ] to deeply equal [ 'onboard', 'resync' ]`), exhaustiveness flow union (duplicate `teaser`), and disjointness flow grain (`expected [ 'teaser' ] to deeply equal []`, :124). Reverted; `grep -rn MUTANT src/` → 0; 14/14 green. |
| SC-2 | in the retry wrapper, drop the flow_type gate so it keys on `budgetKey` instead of `flow_type` | the resync single-effect test (exactly ONE compute_job + ZERO duplicate draft SV rows) | ⬜ pending | asserted — NOT observed |
| SC-3 | add `teaser` to the allowlist (retries: 1) | the teaser regression test (two identical calls → TWO `strategy_verifications` rows) | ⬜ pending | asserted — NOT observed |
| SC-4 | remove the pre-attempt-2 `isBreakerOpen` re-check from `resilientFetch`'s retry loop | the SC4b breaker-trips-between-attempts test (`resilient-fetch.retry.test.ts`) | ✅ observed (141-02) | RED first-hand: `AssertionError: expected null to be an instance of CircuitOpenError` at `resilient-fetch.retry.test.ts:436` — with the re-check deleted, attempt 1 trips the breaker but the retry fires anyway, resolving 200 instead of throwing. Adjacent probe (invert the ENTRY gate `if (breaker.open)` → `if (!breaker.open)`) reddens SC4a: `expected "vi.fn()" to be called 0 times, but got 1 times`. Both restored via `git checkout --`; `grep -rn MUTANT src/` → 0; 15/15 green. |

*Rules: Observed means run — paste the failing assertion. A skipped mutation is recorded skipped, never caught. Prefer the second member of a class (mutate a site the author did not have in mind).*

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under test.

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test (esp. the registry verdicts: the test must not assert `registry.teaser === registry.teaser`)
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Registry size is pinned to a **literal count** of audited flows, not `len(REGISTRY)`
- [ ] SC2/SC3 idempotency proofs assert row COUNTS against the real DB contract, not a stubbed idempotency flag

*If a self-referential oracle is deliberate, name it here:* none — the teaser/resync proofs must pin ECONOMICS (row counts, `public_token`/lead minting) not the impl's own retry decision. See memory `feedback_economic_invariant_oracles_not_self_referential`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason**
- [ ] **Oracle Independence checklist complete**
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
