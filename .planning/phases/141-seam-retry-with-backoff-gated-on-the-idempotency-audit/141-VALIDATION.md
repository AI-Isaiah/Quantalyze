---
phase: 141
slug: seam-retry-with-backoff-gated-on-the-idempotency-audit
status: complete
nyquist_compliant: true
wave_0_complete: true
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| SC1-registry | 141-03 | 2 | SEAM-05 | T-141-01/07 | audit == allowlist, absence ⇒ no-retry, exhaustive verdicts | unit | `npx vitest run src/lib/seam-retry-registry.test.ts` | ✅ | ✅ green |
| SC4-loop | 141-02 | 1 | SEAM-06 | T-141-03 | bounded 1-retry loop; both breaker gates; per-attempt latch | unit | `npx vitest run src/lib/resilient-fetch.retry.test.ts` | ✅ | ✅ green |
| T1-wiring | 141-04 | 3 | SEAM-05/06 | T-141-01 | both clients thread retriesOverride; teaser/csv one-fetch, resync/onboard/bridge two-fetch | unit (real clients, fetch-only mock) | `npx vitest run src/lib/resilient-fetch.retry.test.ts -t "client wiring"` | ✅ | ✅ green |
| T2-rows+pins | 141-04 | 3 | SEAM-05/06 | T-141-09 | 5 rows at retries:1; registry↔rows consistency pin; SC-4b charges backoff+jitterMax, composite clears ceiling | unit | `npx vitest run src/lib/seam-constants.pin.test.ts src/lib/seam-budgets.invariant.test.ts` | ✅ | ✅ green |
| T3-gate | 141-04 | 3 | SEAM-05/06 | all | SC-2/SC-3 mutations observed RED; full tree green | mutation + full suite | `npx vitest run --coverage` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] The typed retry-safety registry module + its test file (SC1) — `src/lib/seam-retry-registry.ts` (141-03)
- [x] The retry wrapper (bounded loop inside `resilientFetch`) + its test file (SC2/SC3/SC4) — `src/lib/resilient-fetch.ts` retry loop + `resilient-fetch.retry.test.ts` (141-02, wired 141-04)

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
| SC-2 | in `postProcessKey`, key the retriesOverride on `budgetKey` instead of `flow_type` (`RETRY_SAFE_FLOW_TYPES[budgetKey]` — no flow-type keys ⇒ every flow resolves 0) | the resync two-fetch wiring test (`resilient-fetch.retry.test.ts` client-wiring block) | ✅ observed (141-04) | RED first-hand: mutating the process-key init to `RETRY_SAFE_FLOW_TYPES[budgetKey]?.retries ?? 0` reddened the resync AND onboard wiring tests — `AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times` at `resilient-fetch.retry.test.ts:668` (resync) and `:690` (onboard). Keying on the many-to-one budgetKey resolves every process-key flow to no-retry, so the allowlisted resync/onboard stopped retrying. Reverted to `[args.flow_type]`; `grep -rn MUTANT src/` → 0; wiring block 6/6 green. |
| SC-3 | add `teaser: { retries: 1, evidence: "MUTANT" }` to `RETRY_SAFE_FLOW_TYPES` | the teaser one-fetch wiring test (`resilient-fetch.retry.test.ts`) AND the registry absence pin (`seam-retry-registry.test.ts`) — reddened in BOTH files | ✅ observed (141-04) | RED first-hand in TWO independent files (the belt is independent of the pin). Wiring: `SC3 — postProcessKey teaser … exactly ONE fetch` reddened — `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times`. Registry: **4** assertions reddened in `seam-retry-registry.test.ts` — SC3 belt (`expected { retries: 1, evidence: 'MUTANT' } to be undefined`), YES-map keys (`expected [ 'onboard', 'resync', 'teaser' ] to deeply equal [ 'onboard', 'resync' ]`), exhaustiveness flow union (duplicate `teaser`), disjointness flow grain (`expected [ 'teaser' ] to deeply equal []`). Reverted; `grep -rn MUTANT src/` → 0; both files green. |
| SC-4 | remove the pre-attempt-2 `isBreakerOpen` re-check from `resilientFetch`'s retry loop | the SC4b breaker-trips-between-attempts test (`resilient-fetch.retry.test.ts`) | ✅ observed (141-02) | RED first-hand: `AssertionError: expected null to be an instance of CircuitOpenError` at `resilient-fetch.retry.test.ts:436` — with the re-check deleted, attempt 1 trips the breaker but the retry fires anyway, resolving 200 instead of throwing. Adjacent probe (invert the ENTRY gate `if (breaker.open)` → `if (!breaker.open)`) reddens SC4a: `expected "vi.fn()" to be called 0 times, but got 1 times`. Both restored via `git checkout --`; `grep -rn MUTANT src/` → 0; 15/15 green. |

*Rules: Observed means run — paste the failing assertion. A skipped mutation is recorded skipped, never caught. Prefer the second member of a class (mutate a site the author did not have in mind).*

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under test.

- [x] No test imports a **constant** from the module it tests — expected values are **literals** in the test (the `EXPECTED_RETRIES` pin, the wiring fetch-count oracles, and the registry verdicts are all hand-typed)
- [x] No assertion compares a value to itself via a re-export, fixture, or table under test
- [x] Registry size is pinned to a **literal count** of audited flows, not `len(REGISTRY)` (exhaustiveness union pins in `seam-retry-registry.test.ts`)
- [x] SC2/SC3 proofs assert fetch-attempt COUNTS at the wiring level (teaser one-fetch / resync two-fetch through the real client), not a stubbed idempotency flag. NOTE: the SERVER-side row-count idempotency proof (compute_jobs / strategy_verifications) is plan 141-01's; this plan's SC2/SC3 are the CLIENT-wiring halves.

*If a self-referential oracle is deliberate, name it here:* none — the teaser/resync proofs must pin ECONOMICS (row counts, `public_token`/lead minting) not the impl's own retry decision. See memory `feedback_economic_invariant_oracles_not_self_referential`.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] **Every success criterion has a Falsifiability Ledger row**
- [x] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason** (SC-1 141-03, SC-2 141-04, SC-3 141-04, SC-4 141-02)
- [x] **Oracle Independence checklist complete**
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** all four success criteria Observed RED first-hand; full TS suite green (10387 passed, coverage 85.6/79.8/82.5/87.7 over the 80/72/74/82 gates); tsc 0, lint 0 errors. Real-Redis lane (`npm run test:redis`) re-proves SC-4 at the final tree in CI — it needs a Docker Redis container and could not run in the execution sandbox; SC-4 remains proven at the unit level (141-02, mocked Upstash).
