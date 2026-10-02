---
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
plan: 04
subsystem: seam
tags: [seam-retry, retriesOverride, allowlist, idempotency-audit, SC-4b, mutation-testing, SEAM-05, SEAM-06]

# Dependency graph
requires:
  - phase: 141-02
    provides: "dormant bounded retry loop in resilientFetch + the retriesOverride escape hatch on ResilientFetchInit + SEAM_RETRY_BACKOFF_MS/SEAM_RETRY_JITTER_MAX_MS"
  - phase: 141-03
    provides: "seam-retry-registry.ts — RETRY_SAFE_FLOW_TYPES / RETRY_SAFE_ANALYTICS allowlist maps (absence ⇒ no-retry) + the SC1 audit evidence"
provides:
  - "Live bounded one-retry for onboard/resync (flow_type grain) and the four compute analytics wrappers (budgetKey grain); everything else provably at 0"
  - "The SEAM-05 registry↔rows consistency pin — audit and enforcement cannot drift"
  - "SC-4b arithmetic now charges the true worst case: timeoutMs×(1+retries) + retries×(backoff + jitterMax)"
  - "SC-2 and SC-3 falsifiability-ledger rows Observed; all four rows Observed; nyquist_compliant: true"
affects: ["SEAM retry runtime behaviour", "process-key-client", "analytics-client", "SC-4b headroom invariant"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-grain retry gate: process-key keyed on flow_type (budgetKeyFor is many-to-one — keying on budgetKey retries teaser, the SC3 landmine); analytics keyed on the 1:1 budgetKey at the ONE chokepoint all nine wrappers inherit"
    - "Explicit `?? 0` is the BELT: absence never delegates to the budget row from the client side, so a future flip of the process-key-sync row can never retry teaser/csv"
    - "The SEAM_BUDGETS row is the SC-4b arithmetic's honest source, NOT the retry switch; the registry↔rows consistency pin ties the two hand-typed statements so they cannot drift"
    - "Charge the MAX jitter (bound it and charge the bound) — jitter stays stateable in the worst-case invariant"

key-files:
  created: []
  modified:
    - "src/lib/process-key-client.ts — value import of RETRY_SAFE_FLOW_TYPES; retriesOverride keyed on args.flow_type in the resilientFetch init; budgetKeyFor docblock extended"
    - "src/lib/analytics-client.ts — value import of RETRY_SAFE_ANALYTICS; retriesOverride keyed on options.budgetKey at the analyticsRequest chokepoint"
    - "src/lib/resilient-fetch.ts — five SEAM_BUDGETS rows flipped to literal retries: 1 (bridge, simulator, portfolio-optimizer, optimize-weights, process-key-enqueue)"
    - "src/lib/seam-constants.pin.test.ts — hand-typed EXPECTED_RETRIES pin (5 at 1, rest 0) + registry↔rows consistency pin"
    - "src/lib/seam-budgets.invariant.test.ts — SC-4b charges the backoff term (retries × calls × (backoff + jitterMax))"
    - "src/lib/resilient-fetch.retry.test.ts — 6 client-level wiring tests (real clients, fetch-only mock) + single-attempt pins on the pre-retry classification/breaker tests"
    - "src/lib/resilient-fetch.test.ts — retriesOverride:0 on the transport-mechanics tests the row flip would otherwise make retry"
    - "src/app/api/keys/sync/route.seam.test.ts — SC-1a now expects the resync timeout's two attempts"
    - "src/lib/seam-ssr-exposure.pin.test.ts — the type-only registry leaf added to the hand-typed allow-list (direct-edge scan cannot see import type)"
    - ".planning/.../141-VALIDATION.md — SC-2 + SC-3 Observed; map filled; nyquist_compliant: true"

key-decisions:
  - "process-key retry gate keys on flow_type, NOT budgetKey — SC3: budgetKeyFor is many-to-one (teaser+csv → process-key-sync), so a budgetKey gate would retry the non-idempotent teaser"
  - "The five row flips + both negative pins + the SC-4b backoff term land in ONE commit (the pins redden any partial state) — that is their job"
  - "keys-permissions stays retries:0 (hand-typed literal) so the finalize-wizard composite branch still clears its 300k lambda ceiling — a flip there would breach (T-141-09)"
  - "Deviation: the row flip makes bare bridge/resync calls retry — pin the pre-retry single-attempt classification tests to retriesOverride:0 rather than weaken their assertions; retry has its own test file"
  - "Deviation: the SSR direct-edge scan cannot distinguish `import type` from a value import, so the type-only registry leaf is allow-listed with a written reason (it creates no runtime edge)"

patterns-established:
  - "SC-2 mutation: key the process-key retriesOverride on budgetKey → resync/onboard two-fetch wiring tests RED"
  - "SC-3 mutation: add teaser to RETRY_SAFE_FLOW_TYPES → teaser one-fetch wiring test RED AND 4 registry-absence pins RED (two independent files — belt ⟂ pin)"

requirements-completed: [SEAM-05, SEAM-06]

# Metrics
duration: ~85min
completed: 2026-07-31
---

# Phase 141 Plan 04: SEAM-06 activation + SEAM-05 consistency pin Summary

**Activated the seam retry: both clients now thread a `retriesOverride` from the registry into the shared transport — process-key on `flow_type` (the SC3 belt, with an explicit `?? 0` so teaser/csv can never retry), analytics on the 1:1 `budgetKey` at the one chokepoint all nine wrappers inherit — five audited `SEAM_BUDGETS` rows flipped to literal `retries: 1` with both negative pins edited in the same commit, SC-4b now charging the true worst case including max jitter, and both remaining falsifiability-ledger rows (SC-2, SC-3) Observed RED first-hand.**

## Performance

- **Duration:** ~85 min
- **Completed:** 2026-07-31
- **Tasks:** 3
- **Files modified:** 10 (0 created)

## Accomplishments

- Wired BOTH seams to the registry (Class A, N=2 — neither left dead): `RETRY_SAFE_FLOW_TYPES[args.flow_type]?.retries ?? 0` in `postProcessKey`, `RETRY_SAFE_ANALYTICS[options.budgetKey]?.retries ?? 0` in `analyticsRequest`.
- Flipped exactly five `SEAM_BUDGETS` rows to literal `retries: 1` (bridge, simulator, portfolio-optimizer, optimize-weights, process-key-enqueue); `SEAM_RETRIES` seed and all must-stay-0 rows unchanged; each flipped row names its registry entry.
- Reworked the per-row pin to a hand-typed `EXPECTED_RETRIES` (5 at 1, rest 0) and ADDED the registry↔rows consistency pin (allowlist keys ⊆ rows-at-1; process-key-sync + keys-permissions pinned 0 at the row grain).
- Extended SC-4b to charge `retries × calls × (SEAM_RETRY_BACKOFF_MS + SEAM_RETRY_JITTER_MAX_MS)`; the composite branch still clears its ceiling because keys-permissions stays 0.
- Observed SC-2 and SC-3 mutations RED first-hand (SC-3 in TWO independent files); all four ledger rows now Observed; `nyquist_compliant: true`.

## Task Commits

1. **Task 1: wire both clients to the registry** — `cc3765f5` (feat)
2. **Task 2: flip five rows + edit both pins + charge backoff in SC-4b (one commit)** — `f2d47275` (feat)
3. **Task 3: SC-2 + SC-3 ledger observations + phase gate** — `7ff9085f` (test)

## RED observed first-hand — Task 1 wiring (asymmetric proof-of-necessity)

Before wiring, the six client-level tests ran with the ALLOWLISTED flows failing and the belt flows passing — the asymmetry is the wiring's reason to exist:

```
✓ SC3 teaser → ONE fetch          ✓ SC3 csv → ONE fetch        ✓ validateKey → ONE fetch
× SC2 resync → expected 2, got 1  × SC2 onboard → expected 2, got 1  × bridge → not reachable (1 fetch)
Tests  3 failed | 3 passed
```

After wiring: 21/21 green in `resilient-fetch.retry.test.ts`.

## SC-2 ledger mutation Observed (Task 3)

Mutation — key the process-key `retriesOverride` on `budgetKey` instead of `flow_type` (`RETRY_SAFE_FLOW_TYPES[budgetKey]`, which has no flow-type keys ⇒ every flow resolves 0):

```
FAIL … SC2 — postProcessKey resync … exactly TWO fetches, resolves ok
AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times   (:668)
FAIL … SC2 — postProcessKey onboard … exactly TWO fetches, resolves ok
AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times   (:690)
```

Reverted to `[args.flow_type]`; `grep -rn MUTANT src/` → 0; wiring block 6/6 green.

## SC-3 ledger mutation Observed (Task 3) — RED in TWO independent files

Mutation — add `teaser: { retries: 1, evidence: "MUTANT" }` to `RETRY_SAFE_FLOW_TYPES`:

Wiring belt (`resilient-fetch.retry.test.ts`):
```
FAIL … SC3 — postProcessKey teaser … exactly ONE fetch (never retried)
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
```

Registry pin (`seam-retry-registry.test.ts`) — 4 assertions:
```
× RETRY_SAFE_FLOW_TYPES.teaser is strictly undefined
  expected { retries: 1, evidence: 'MUTANT' } to be undefined
× RETRY_SAFE_FLOW_TYPES keys equal the hand-typed safe set
  expected [ 'onboard', 'resync', 'teaser' ] to deeply equal [ 'onboard', 'resync' ]
× YES∪NO flow keys cover ALL four flow_types            (duplicate 'teaser')
× YES ∩ NO = ∅ at flow grain                            expected [ 'teaser' ] to deeply equal []
```

The red asymmetry across two files is the proof the belt (wiring) is independent of the pin (registry). Reverted; `grep -rn MUTANT src/` → 0; both files green; production source byte-identical to committed (`git diff` empty).

## Phase gate (final tree)

- **Full TS suite:** `npx vitest run --coverage` → **10387 passed | 287 skipped | 0 failed** (754 files), exit 0.
- **Coverage:** Stmts 85.58 / Branch 79.82 / Funcs 82.5 / Lines 87.72 — all clear the 80/72/74/82 gates.
- **tsc:** `npx tsc --noEmit` → 0 errors.
- **lint:** `npm run lint` → 0 errors (1 pre-existing, unrelated `react-hooks/exhaustive-deps` warning in `EquityChart.tsx`); route-contract + admin-manifest checks OK.
- **Real-Redis lane:** `npm run test:redis` requires a Docker Redis container (`docker-compose.redis-test.yml`) not available in the execution sandbox — it re-proves SC-4 at the final tree in CI. SC-4 remains proven at the unit level (141-02, mocked Upstash). Recorded honestly in 141-VALIDATION Sign-Off.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Blocking] The row flip makes bare `bridge`/`resync` calls retry — pre-retry mechanics tests reddened**
- **Found during:** Task 2 (running the verify lane after flipping the rows).
- **Issue:** `resilient-fetch.test.ts` and the 141-02 tests in `resilient-fetch.retry.test.ts` used bare `"bridge"` as a generic single-attempt vehicle, and `keys/sync/route.seam.test.ts` drives a real `resync`. With the rows now at `retries: 1`, those bare calls retry, doubling breaker records and tripping mid-drive (10 + 3 + 1 failures).
- **Fix:** Pinned the affected single-attempt classification/breaker tests to `retriesOverride: 0` (explicit "single-attempt path"; retry has its own test file); rewrote the "loop DORMANT" test to prove row-default no-retry on a still-0 key (validate-key); updated the keys/sync SC-1a assertion to expect the resync timeout's TWO attempts (the correct new wired behaviour — resync is audit-safe).
- **Files modified:** `src/lib/resilient-fetch.test.ts`, `src/lib/resilient-fetch.retry.test.ts`, `src/app/api/keys/sync/route.seam.test.ts`
- **Commit:** `f2d47275` (same commit as the row flip, deliberately)

**2. [Rule 3 - Blocking] SSR-exposure pin flags the type-only registry leaf**
- **Found during:** Task 3 phase gate (full suite).
- **Issue:** `seam-ssr-exposure.pin.test.ts` uses a DIRECT-EDGE regex that matches `from "./process-key-client"` / `from "./resilient-fetch"` regardless of `import type`. The registry leaf imports only `type FlowType` and `type SeamBudgetKey` (erased at build, no runtime edge), so it is genuinely SSR-safe, but the source scan cannot tell. Latent since 141-03 created the file; surfaced by the first full-suite run. (Not caused by this plan's edits — the registry's imports were untouched — but it blocks the phase gate.)
- **Fix:** Added `src/lib/seam-retry-registry.ts` to the test's hand-typed `ALLOWED_SEAM_IMPORTERS` allow-list with the written reason (the sanctioned mechanism the test itself prescribes), and updated the allow-list literal pin to three entries.
- **Files modified:** `src/lib/seam-ssr-exposure.pin.test.ts`
- **Commit:** `7ff9085f`

## Threat surface scan

No new network endpoints, auth paths, file access, or schema changes were introduced — retry re-crosses the EXISTING Vercel→Railway seam, and the eligibility decision is made at the flow_type/budgetKey grain the threat model prescribes (T-141-01/07/09 mitigations all in place: flow_type gate + explicit `?? 0`, process-key-sync row pinned 0, keys-permissions row pinned 0, per-row + registry↔rows pins). No threat flags.

## Authentication Gates

None — no external service configuration required.

## Self-Check: PASSED

- Commits exist: `cc3765f5` (task 1), `f2d47275` (task 2), `7ff9085f` (task 3) — all in `git log`.
- `grep -n "retriesOverride: RETRY_SAFE_FLOW_TYPES[args.flow_type]" src/lib/process-key-client.ts` → 1 hit inside the init (line 453).
- `grep -n "retriesOverride: RETRY_SAFE_ANALYTICS[options.budgetKey]" src/lib/analytics-client.ts` → 1 hit (line 434); `grep -c "RETRY_SAFE_ANALYTICS"` → 2 (import + use).
- `grep -c "retries: 1," src/lib/resilient-fetch.ts` → 5; `SEAM_RETRIES = 0` line unchanged.
- `grep -rn MUTANT src/` → 0.
- Full suite green (10387 passed, 0 failed); coverage clears all four gates; tsc 0; lint 0 errors.

---
*Phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit*
*Completed: 2026-07-31*
