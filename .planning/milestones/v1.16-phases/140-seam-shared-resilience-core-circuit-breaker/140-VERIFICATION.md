---
phase: 140-seam-shared-resilience-core-circuit-breaker
verified: 2026-07-25T19:40:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: null
human_verification:
  - test: "Watch Sentry during the next real Railway degradation window: confirm CIRCUIT_OPEN 503 envelopes appear and that no cascade-500s occur in the same window."
    expected: "breaker:railway trips against the LIVE Upstash database, seam callers receive 503 CIRCUIT_OPEN + Retry-After, and no route emits a raw 500."
    why_human: "No live Upstash in CI/local (20+ test files delete the env vars) and no controllable Railway failure injection. The faked-Redis double is the correct double for SC-2 regardless — a real Upstash cannot deterministically prove cross-module-context sharing. Declared manual-only in 140-VALIDATION.md."
---

# Phase 140: SEAM — Shared resilience core + circuit breaker — Verification Report

**Phase Goal:** A hung or dying Railway fails fast at BOTH seam chokepoints with a clean typed error — never a lambda held until platform kill, never a cascade-500.
**Verified:** 2026-07-25T19:40:00Z
**Status:** human_needed (all 5 automated success criteria VERIFIED; 1 declared manual-only observation outstanding)
**Re-verification:** No — initial verification
**Method:** goal-backward, adversarial. Every success criterion was checked against shipped source AND **mutation-tested** — the implementation was deliberately broken and the guarding test was required to go red. A green test that survives its own mutation is not evidence.

---

## Gate Results (observed, not claimed)

| Gate | Command | Observed Output | Exit |
|------|---------|-----------------|------|
| Unit/integration | `npm test` | `Test Files 696 passed \| 19 skipped (715)` · `Tests 8859 passed \| 287 skipped (9146)` · 89.43s | **0** |
| Typecheck | `npm run typecheck` | `tsc --noEmit`, no output | **0** |
| Lint | `npm run lint` | `0 errors, 1 warning` (pre-existing `react-hooks/exhaustive-deps` in `EquityChart.tsx:1119`, unrelated to this phase) + `check-admin-route-manifest OK (20 routes)` + `check-route-contract OK (56 routes)` | **0** |
| Build | `npm run build` | `✓ Compiled successfully in 9.6s` | **0** |
| Coverage | `npm run test:coverage` | Stmts **84.36** / Branch **78.38** / Funcs **81.45** / Lines **86.48** — all above the ratchet (80 / 72 / 74 / 82) | **0** |

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Both chokepoints route through the ONE `resilient-fetch` core and return a typed error inside budget instead of holding the lambda | ✓ VERIFIED | `analytics-client.ts:118` and `process-key-client.ts:151` both call `resilientFetch`. Zero raw `ANALYTICS_SERVICE_URL` fetches outside the core + 3 documented `SEAM_EXCLUSIONS`. `route.seam.test.ts` for `keys/sync` and `admin/match/recompute` run the **REAL** clients (grep-confirmed: neither file mocks `@/lib/process-key-client`, `@/lib/analytics-client`, or `@/lib/resilient-fetch`) and assert typed 504 + `elapsedMs < 2000`. |
| SC-2 | Breaker state is SHARED, not per-instance; a second module context short-circuits with `503 CIRCUIT_OPEN` without touching Railway | ✓ VERIFIED | **Mutation-proven.** Replacing the Upstash-backed breaker with module-scope memory turned `resilient-fetch.test.ts` from 24 passed → **11 failed**, including `cross-context: a second module context short-circuits without touching Railway`. Negative control (`sharedStore = false`) confirms the harness genuinely builds two contexts. |
| SC-3 | Breaker fails **OPEN** on both `redis.get` throwing and `redis === null`, in production too | ✓ VERIFIED | **Mutation-proven.** Inverting `if (!redis) return { open: false }` → fail-closed made `fails OPEN when Upstash is unconfigured` go red. Core has **zero** `NODE_ENV`/`VERCEL_ENV` branches (grep). SC-3b test explicitly sets `VERCEL_ENV=production`. |
| SC-4 | CI invariant asserts `timeout × (1 + retries) < maxDuration` per route from ONE exported budget table | ✓ VERIFIED | **Mutation-proven ×3.** Deleting `maxDuration` → fail-loud naming the route. Mismatching 300→60 → fail-loud naming both sides. Setting `SEAM_RETRIES = 2` → `validate-and-encrypt` breaches at **360000ms vs 300000ms ceiling**, exactly as documented. Ceiling is `readFileSync` from disk, never the table. |
| SC-5 | No route handler surfaces a raw fetch/breaker error as a 500 | ✓ VERIFIED | **Mutation-proven ×2.** Disabling the bridge `CircuitOpenError` arm → `TC11` red. Disabling the `wizardErrors` type check → **4** tests red across `wizardErrors.test.ts` + `create-with-key/route.test.ts`. `admin/match/{eval,recompute}` `err.message` leak closed: static `GENERIC_COPY` / `TIMEOUT_COPY` / `CIRCUIT_OPEN_COPY`, detail only to `console.error`. |

**Score: 5/5 truths verified.**

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **SEAM-01** — both chokepoints through ONE core | ✓ SATISFIED | Both clients + the third seam (`keys/[id]/permissions`, `finalize-wizard`) + the dormant handler all call `resilientFetch`. Enforced by the `quantalyze/no-raw-analytics-fetch` ESLint rule at `"error"` with a 4-path closed allowlist. |
| **SEAM-02** — exported per-call-site budgets, `timeout × (1+retries) < maxDuration` test | ✓ SATISFIED | `SEAM_BUDGETS` (13 keys) + `SEAM_ROUTE_BUDGETS` (15 routes) + `SEAM_EXCLUSIONS` (3). All 15 routes pin `export const maxDuration = 300` on disk (verified individually). SC-4a/SC-4b mutation-proven. |
| **SEAM-03** — Upstash-backed breaker, cross-instance, fails OPEN | ✓ SATISFIED | `breaker:railway` module constant, `Ratelimit.slidingWindow(5, "30 s")`, `nx: true` idempotent trip. SC-2/SC-3 mutation-proven. |
| **SEAM-04** — typed `503 CIRCUIT_OPEN` envelope, no cascade-500 | ✓ SATISFIED (with ONE documented carve-out) | All three retrofit classes shipped. `CircuitOpenError` arms present in 11 handlers. **CORRECTION (review CR-05, 2026-07-25):** the original claim "all **after** the auth gate" was FALSE. `src/app/api/verify-strategy/route.ts` is a fully **unauthenticated public** route — no `withAuth`, no session read, only `assertSameOrigin` + `publicIpLimiter` — and it inherits the breaker envelope wholesale from `postProcessKey`. It has no auth gate to be after. The carve-out is now explicit rather than silently mis-stated: that route passes `unauthenticated: true`, which (a) opts the call out of WRITING the shared breaker counter (CR-04 — five anonymous input-triggered 500s previously denied the seam to every tenant) and (b) replaces the live `redis.ttl` in `Retry-After` with the static `DEFAULT_RETRY_AFTER_S` so the exact remaining cooldown is not readable from the open internet. The route is still BLOCKED by an already-open breaker — read, never write. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/seam-errors.ts` | Dependency-free leaf holding `CircuitOpenError` | ✓ VERIFIED | **0 imports, 0 side effects** (class declaration only). |
| `src/lib/resilient-fetch.ts` | Core: budgets + breaker + engine | ✓ VERIFIED | 574 lines. Breaker check → budgeted fetch → classified failure recording. `SEAM_RETRIES = 0`, no retry loop. |
| `src/lib/analytics-client.ts` | `analyticsRequest` → core | ✓ VERIFIED | `resilientFetch` at :118. `CircuitOpenError` rethrown first and unwrapped. |
| `src/lib/process-key-client.ts` | `postProcessKey` → core + `CIRCUIT_OPEN` envelope | ✓ VERIFIED | `resilientFetch` at :151. 503/`CIRCUIT_OPEN` + `Retry-After` arm ordered before timeout/network arms. |
| `src/lib/wizardErrors.ts` | Type-checked `SERVICE_UNAVAILABLE_RETRY` before substring cascade | ✓ VERIFIED | `:959` `instanceof CircuitOpenError` → `{ code: "SERVICE_UNAVAILABLE_RETRY", status: 503 }`, above the `message`-derived cascade at :967. |
| `src/lib/seam-budgets.invariant.test.ts` | SC-4 disk-read invariant | ✓ VERIFIED | 37 tests. `readFileSync` + anchored `/^export const maxDuration = (\d+)/m`. No default for an absent export. |
| `src/test/helpers/upstash-breaker.ts` | Importable fake Upstash doubles | ✓ VERIFIED | `fakeRedisFor` (nx/ttl semantics), `fakeRatelimitFor`, `seedBreakerOpen`, `FAKE_BREAKER_KEY` (drift-pinned against `BREAKER_KEY`). |
| `tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs` | Mechanism enforcing ONE core | ✓ VERIFIED | Registered in `index.mjs:42`, enabled `"error"` in `eslint.config.mjs:111`, allowlist at :120-134. **Mutation-proven** (see below). |
| Retrofitted route handlers | 11 handlers with typed arms | ✓ VERIFIED | bridge, simulator, portfolio-optimizer, scenario/optimize, validate-and-encrypt, create-with-key, composite/add-key, keys/[id]/permissions, finalize-wizard, admin/match/eval, admin/match/recompute. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `analytics-client.ts` | `resilient-fetch.ts` | `resilientFetch(budgetKey, path, init)` | ✓ WIRED | SC-1c wiring test spies the core and asserts `rawFetch` never called. |
| `process-key-client.ts` | `resilient-fetch.ts` | `resilientFetch(budgetKey, "/process-key", …)` | ✓ WIRED | Same test; `both clients route through the SAME core function object`. |
| `keys/[id]/permissions` + `finalize-wizard` | `resilient-fetch.ts` | `resilientFetch("keys-permissions", …)` | ✓ WIRED | Third seam closed; two duplicated `AbortSignal.timeout(15_000)` constants removed. |
| `validate-and-encrypt` (dormant handler) | `resilient-fetch.ts` | `resilientFetch("process-key-unified-dormant", …)` | ✓ WIRED | Previously had NO timeout at all; now inherits budget + breaker. |
| `resilient-fetch.ts` | Upstash `breaker:railway` | `redis.get` / `Ratelimit.limit` / `redis.set{nx,ex}` | ✓ WIRED | Mutation-proven to be load-bearing. |
| `wizardErrors.ts` | `seam-errors.ts` | `import { CircuitOpenError }` | ✓ WIRED | Value import from the leaf, never through a mockable client module. |
| ESLint rule | `npm run lint` | `eslint.config.mjs` `"error"` | ✓ WIRED | Mutation-proven to fire on a real violation. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `isBreakerOpen()` | `state`, `ttl` | `redis.get(BREAKER_KEY)` + `redis.ttl` | Yes — real Upstash reads; mutation shows tests depend on them | ✓ FLOWING |
| `recordSeamFailure()` | `success`, `remaining` | `breakerLimiter.limit()` then `redis.set{nx,ex}` | Yes | ✓ FLOWING |
| `resilientFetch()` | `timeoutMs` | `SEAM_BUDGETS[budgetKey].timeoutMs` → `AbortSignal.timeout()` | Yes — SC-4c spies `AbortSignal.timeout` and asserts the **table** value reaches it | ✓ FLOWING |
| `seam-budgets.invariant.test` | `onDisk` maxDuration | `readFileSync(routePath)` — NOT the table | Yes — mutation of the route file reddens the test | ✓ FLOWING |
| `CircuitOpenError.retryAfterS` | breaker TTL | `redis.ttl(BREAKER_KEY)` | Yes — `keys/sync` seam test seeds TTL **13** (deliberately not 30, which would collide with both `BREAKER_COOLDOWN_S` and `DEFAULT_RETRY_AFTER_S`) and asserts `Retry-After: 13` | ✓ FLOWING |

---

### Behavioral Spot-Checks (mutation tests — run by the verifier)

| # | Behavior under test | Mutation applied | Observed Result | Status |
|---|--------------------|------------------|-----------------|--------|
| M-1 | SC-2 breaker state is shared | Replace Upstash breaker with module-scope `__memOpenUntil`/`__memFails` | `Tests 11 failed \| 13 passed`; cross-context test red | ✓ PASS |
| M-1b | (control) additive memory alongside Upstash | Add memory state, keep Upstash | `24 passed` — correctly does NOT fire; confirms M-1's red is caused by removing shared state, not by editing the file | ✓ PASS |
| M-2 | SC-4a maxDuration read from disk | Delete `export const maxDuration = 300` from `simulator/route.ts` | 2 failed: `has NO \`export const maxDuration = <n>\` statement` | ✓ PASS |
| M-3 | SC-4a table/disk agreement | Change `simulator` maxDuration 300 → 60 | 1 failed: `exports maxDuration = 60 but SEAM_ROUTE_BUDGETS declares 300` | ✓ PASS |
| M-4 | SC-4b forward-compat with Phase 141 | `SEAM_RETRIES = 0` → `2` | 1 failed: `validate-and-encrypt can spend 360000ms … against a 300000ms function ceiling` | ✓ PASS |
| M-5 | SC-3 fail-OPEN policy | `if (!redis) return { open: false }` → `{ open: true }` | 1 failed: `fails OPEN when Upstash is unconfigured` | ✓ PASS |
| M-6 | SC-5c route arm | Disable bridge `instanceof CircuitOpenError` branch | 1 failed: `TC11 — CircuitOpenError → 503 + Retry-After carrying the breaker's own TTL` | ✓ PASS |
| M-7 | SC-5b wizard classifier | Disable `wizardErrors` `instanceof CircuitOpenError` branch | 4 failed incl. `TYPE wins over SUBSTRING`, `validateKey tripping the breaker → 503 …, never UNKNOWN/500` | ✓ PASS |
| M-8 | SEAM-01 lint mechanism | Add raw `fetch(\`${process.env.ANALYTICS_SERVICE_URL}/api/x\`)` to `simulator/route.ts` | `1 error … quantalyze/no-raw-analytics-fetch` | ✓ PASS |

All mutants were restored from pre-mutation copies; `git diff --stat` clean after each.

---

### Client-Bundle Boundary (the phase's highest-risk constraint)

Traced the **runtime (value) import closure** of `src/lib/wizardErrors.ts` programmatically:

```
FILES:          src/lib/wizardErrors.ts
                src/lib/seam-errors.ts
EXTERNAL PKGS:  (none)
REACHES @upstash/*:  false
```

- `wizardErrors.ts` has exactly **two** imports: `import type { GateFailureCode }` (erased at compile time) and `import { CircuitOpenError } from "@/lib/seam-errors"`.
- `seam-errors.ts` has **0** imports and **0** module-load side effects.
- The closure terminates with **zero external packages**. `@upstash/redis`, `@upstash/ratelimit`, and `Redis.fromEnv()`'s module-load singleton + console notice are unreachable from the client bundle.
- Corroborated independently: `npm run build` succeeded, and no `upstash`/`Upstash not configured` string appears in `.next/static/chunks/`.
- `resilient-fetch.ts` re-exports the leaf class as an **alias**; `resilient-fetch.test.ts` pins `mod.CircuitOpenError === leaf.CircuitOpenError` so there is exactly one class identity in the process.

**Verdict: ✓ VERIFIED. Constraint holds.**

---

### Scope Discipline

| Constraint | Status | Evidence |
|-----------|--------|----------|
| Retry NOT implemented (Phase 141) | ✓ HELD | `export const SEAM_RETRIES = 0;` — no retry loop, no backoff, no jitter in the core (grep). |
| Zero new npm dependencies | ✓ HELD | `git log --name-only 95d987eb ^dfeeeacc -- package.json package-lock.json` → **empty**. |
| `computePortfolioAnalytics` not deleted | ✓ HELD | `analytics-client.ts:303`, budgeted as `portfolio-analytics` with a "ZERO CALLERS TODAY" note. |
| `_unifiedValidateAndEncryptHandler` not deleted | ✓ HELD | `validate-and-encrypt/route.ts:170`. Note: it was **already non-exported** at the phase base commit `dfeeeacc` (line 144) — the phase did not change its visibility. |
| `OPTIMIZER_TIMEOUT_MS` deleted | ✓ HELD | Zero code references; only historical mentions in comments explaining the removal. |

---

### Deviations Audited

| # | Deviation | Judgement | Reasoning |
|---|-----------|-----------|-----------|
| D-1 | Abort guard broadened to `err instanceof Error \|\| err instanceof DOMException` | **SOUND** | jsdom's `DOMException` does not extend `Error`, while Node's does. An `Error`-only guard looks correct in production but silently reclassifies every timeout as "not reachable" under vitest. Present in both `analytics-client.ts:157` and `process-key-client.ts:203`. The `keys/sync` seam test rejects with the exact `DOMException("aborted","TimeoutError")` shape and asserts `UPSTREAM_TIMEOUT`. Strictly broadens correct classification; weakens nothing. |
| D-2 | Breaker trip rule `!success \|\| remaining <= 0` | **SOUND** | `Ratelimit.slidingWindow(N)` ALLOWS the Nth call with `remaining === 0` and denies the (N+1)th. Without the `remaining` clause the breaker would open one failure late. Verified against the fake's semantics (`success = count <= threshold`) and pinned by `trips the breaker once the failure allowance is exhausted` (threshold−1 → not open; threshold → open). |
| D-3 | Critical-regressions guard moved `analytics-client.ts` → `resilient-fetch.ts` | **SOUND — STRENGTHENED** | `src/__tests__/critical-regressions.test.ts:114-146` follows the SD-CRITICAL-01 invariant to its new home AND **adds** a per-client assertion that neither client contains a raw `fetch(`. Post-move the guard is strictly stronger than pre-move. |
| D-4 | `runPortfolioOptimizer`'s `timeoutMs` param and `OPTIMIZER_TIMEOUT_MS` deleted | **SOUND** | The route-local constant was the only caller. Deleting it gives the deadline exactly one owner (`SEAM_BUDGETS["portfolio-optimizer"]`), which is the SEAM-02 goal. Typecheck green. |
| D-5 | `AsyncLocalStorage` install moved into `src/test-setup.ts` | **SOUND, NOT SCOPE CREEP** | The prior per-file `async vi.hoisted` shape was a genuine race: `await import("node:async_hooks")` resolves on a later microtask, so under worker contention the file's own `next/*` imports could capture `undefined` and fail **silently with plausible wrong statuses**. Setup files are fully awaited before any test module imports. Idempotent and inert for the ~700 files that never touch a Next async-storage boundary. It remediates a flake this phase's own new seam test introduced. |
| D-6 | Negative control rebuilt around `Redis.fromEnv()` after measuring RESEARCH §10.2 wrong | **SOUND — the correct call** | The executor measured that `vi.mock` factories do NOT re-run on `vi.resetModules()` in vitest 4.1.10, contradicting §10.2. Building the control on the §10.2 model would have produced a **false green**. The rebuilt control hangs `beginContext()` off `Redis.fromEnv()`, which the core calls once per module-body execution. Independently confirmed by mutation M-1/M-1b: the control fires exactly when it should and not when it shouldn't. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/test/helpers/upstash-breaker.ts` | 15-16 | Doc comment asserts "`vi.mock` factories RE-RUN on `vi.resetModules()`" — the model the executor **measured to be false** and superseded in `resilient-fetch.test.ts`'s header | ⚠️ Warning | The comment's *recommendation* (hoist the store) is correct, so nothing shipped is wrong. But a future test author reading only the helper could build a negative control on the inverted model and get a false green — precisely the trap this phase discovered. Doc-only fix. |
| `src/app/api/keys/[id]/permissions/route.seam.test.ts` | 56 | Stale: "`globalThis.AsyncLocalStorage` — installed in the `vi.hoisted` block below". Commit `95d987eb` moved it to `src/test-setup.ts`; line **6** of the same header already says so | ℹ️ Info | Self-contradicting header. Doc-only. |
| `validate-and-encrypt/route.ts:158`, `csv-finalize/route.ts:511`, `wizardErrors.ts:501`, `bridge/route.test.ts:27` | — | `TODO` markers | ℹ️ Info | **All pre-existing** — verified present at the phase base commit `dfeeeacc`. **Zero** `TBD` / `FIXME` / `XXX` markers anywhere in the phase-modified file set, so the debt-marker blocker gate does not fire. |

No stubs, no placeholder returns, no hardcoded empty data, no console-log-only implementations found in the phase's file set.

---

### Human Verification Required

#### 1. Live breaker trip against a genuinely degraded Railway

**Test:** During the next real Railway degradation window, watch Sentry for `CIRCUIT_OPEN` 503 envelopes emitted by the seam routes, and confirm no cascade-500s appear in the same window.
**Expected:** `breaker:railway` trips against the LIVE Upstash database after 5 failures in 30s; seam callers receive `503 CIRCUIT_OPEN` with `Retry-After`; the breaker self-closes ~30s after Railway recovers (TTL expiry is the half-open transition).
**Why human:** There is no live Upstash in CI or local (20+ test files delete `UPSTASH_REDIS_REST_URL`/`_TOKEN`) and no controllable Railway failure injection. This is declared **Manual-Only** in `140-VALIDATION.md` and is explicitly post-merge observation, not a merge gate. Note the faked-Redis double remains the *correct* double for SC-2 regardless — a real Upstash cannot deterministically prove cross-module-context sharing, which is what SC-2 actually asserts.

---

### Gaps Summary

**None.** All 5 ROADMAP success criteria and all 4 requirements (SEAM-01..04) are satisfied in shipped source, and every one is backed by a test that was demonstrated to fail when the implementation is broken.

The adversarial starting hypothesis — "tasks completed, goal missed" — was **falsified**. Specific attempts to falsify each criterion and their outcomes:

- *"The tests pass vacuously"* → refuted by 9 mutations, 8 of which reddened the expected guard and 1 (M-1b) correctly stayed green as a control.
- *"The breaker is really per-instance"* → refuted: replacing shared state with module memory kills 11 tests.
- *"The invariant compares the table to itself"* → refuted: the ceiling is `readFileSync` from the route file; editing the route reddens the test.
- *"`SEAM_RETRIES = 0` makes SC-4b a no-op forever"* → refuted: at retries=2 the worst route breaches by 60s, so the assertion tightens automatically in Phase 141.
- *"`wizardErrors` drags Upstash into the client bundle"* → refuted: the value-import closure is 2 files and 0 external packages.
- *"The third seam is still raw"* → refuted: `keys/[id]/permissions` and `finalize-wizard` both call `resilientFetch("keys-permissions", …)`; the only remaining raw call sites are the 3 documented `SEAM_EXCLUSIONS`, enforced by a lint rule proven to fire.
- *"Error arms sit above the auth gate"* → refuted: all 11 handlers gate first, and two seam tests pin the T-140-12 unauthenticated-oracle case (401, no `Retry-After`, no breaker vocabulary).

Two doc-only defects were found (stale comments in `upstash-breaker.ts` and the permissions seam test header). Neither affects shipped behaviour; both are worth a one-line cleanup because the first repeats the exact misconception that would have produced a false green.

**Status is `human_needed` solely because of the declared manual-only live-Railway observation.** No automated criterion is outstanding, and nothing blocks proceeding to Phase 141.

---

_Verified: 2026-07-25T19:40:00Z_
_Verifier: Claude (gsd-verifier)_
