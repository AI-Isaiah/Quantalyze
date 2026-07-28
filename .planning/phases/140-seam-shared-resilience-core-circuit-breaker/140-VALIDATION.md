---
phase: 140
slug: seam-shared-resilience-core-circuit-breaker
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
---

# Phase 140 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `140-RESEARCH.md` §16 (Validation Architecture).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (`@vitejs/plugin-react`, `jsdom` env, `@vitest/coverage-v8` 4.1.10) |
| **Config file** | `vitest.config.ts` (root). `scripts/vitest.config.ts` is NOT in the default run. |
| **Setup file** | `src/test-setup.ts` |
| **Quick run command** | `npx vitest run src/lib/resilient-fetch.test.ts src/lib/seam-budgets.invariant.test.ts --no-file-parallelism` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Coverage gate** | `npm run test:coverage` — ratchet lines 82 / statements 80 / functions 74 / branches 72, BLOCKING in CI (`frontend-coverage` merged-shard job) |
| **Lint gate** | `npm run lint` |
| **Typecheck** | `npm run typecheck` (`tsc --noEmit`) |
| **Build gate** | `npm run build` — `maxDuration` is route-segment config; a malformed export is a BUILD error, not a test error |
| **Estimated runtime** | quick ~10s · full suite several minutes |

⚠️ **CI-vs-local hazard:** CI runs Node 22, local is Node 25. Reproduce CI-only failures with
`PATH=/opt/homebrew/opt/node@22/bin`. A leaked `vi.stubGlobal("fetch")` is the known cause —
every seam test MUST `vi.unstubAllGlobals()` in `afterEach`.

---

## Sampling Rate

- **After every task commit:** quick run command above (<10s)
- **After every plan wave:** `npm test` + `npm run typecheck` + `npm run lint`
- **Before `/gsd:verify-work`:** full suite green **with coverage** + `npm run build` passes
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| SC | Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|----|-------------|----------|-----------|-------------------|-------------|--------|
| SC-1a | SEAM-01 | Railway hangs → `keys/sync` (via `postProcessKey`) returns typed 504/`UPSTREAM_TIMEOUT`, lambda not held | route integration (real client, faked `fetch` rejecting `DOMException("TimeoutError")`) | `npx vitest run src/app/api/keys/sync/route.seam.test.ts` | ❌ W0 | ⬜ pending |
| SC-1b | SEAM-01 | Same for `admin/match/recompute` (via `analyticsRequest`) | route integration (real client) | `npx vitest run src/app/api/admin/match/recompute/route.seam.test.ts` | ❌ W0 | ⬜ pending |
| SC-1c | SEAM-01 | Both clients demonstrably invoke ONE core | unit + spy | `npx vitest run src/lib/resilient-fetch.wiring.test.ts` | ❌ W0 | ⬜ pending |
| SC-2 | SEAM-03 | After N failures, a call from a `vi.resetModules()` context short-circuits with `CIRCUIT_OPEN` **and never calls `fetch`** | unit, two module contexts, `vi.hoisted` shared fake store | `npx vitest run src/lib/resilient-fetch.test.ts -t "cross-context"` | ❌ W0 | ⬜ pending |
| SC-2-neg | SEAM-03 | **Negative control** — same test with a per-factory (non-shared) store MUST fail | unit | `npx vitest run src/lib/resilient-fetch.test.ts -t "negative control"` | ❌ W0 | ⬜ pending |
| SC-3a | SEAM-03 | `redis.get` throws → seam still attempts the real request (fail OPEN) | unit | `npx vitest run src/lib/resilient-fetch.test.ts -t "fails OPEN when Redis errors"` | ❌ W0 | ⬜ pending |
| SC-3b | SEAM-03 | `redis === null` (Upstash unconfigured) → attempts real request, **in production too** | unit, `VERCEL_ENV=production` | `npx vitest run src/lib/resilient-fetch.test.ts -t "fails OPEN when Upstash is unconfigured"` | ❌ W0 | ⬜ pending |
| SC-3c | SEAM-03 | 4xx does NOT trip the breaker; 5xx/timeout/network DO | unit | `npx vitest run src/lib/resilient-fetch.test.ts -t "failure classification"` | ❌ W0 | ⬜ pending |
| SC-4a | SEAM-02 | Every seam route file exports `maxDuration` matching `SEAM_BUDGETS` | source-scan invariant (`readFileSync`) | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ❌ W0 | ⬜ pending |
| SC-4b | SEAM-02 | `timeoutMs × callsPerRequest × (1 + retries) < maxDuration × 1000` for every entry | pure data assertion over the exported table | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ❌ W0 | ⬜ pending |
| SC-4c | SEAM-02 | The table's `timeoutMs` actually reaches `AbortSignal.timeout` | unit, `vi.spyOn(AbortSignal,"timeout")` | `npx vitest run src/lib/resilient-fetch.test.ts -t "budget reaches AbortSignal"` | ❌ W0 | ⬜ pending |
| SC-5a | SEAM-04 | Class-1 (`admin/match/{eval,recompute}`) → typed 503 on `CIRCUIT_OPEN`, **never** echo `err.message` | route unit (extend existing) | `npx vitest run src/app/api/admin/match/eval/route.test.ts src/app/api/admin/match/recompute/route.test.ts` | ✅ extend | ⬜ pending |
| SC-5b | SEAM-04 | Class-2 (`create-with-key`, `composite/add-key`): `CircuitOpenError` → 503 + real wizard code, never `UNKNOWN`/500 | unit on `classifyKeyValidationError` + route | `npx vitest run src/lib/wizardErrors.test.ts src/app/api/strategies/create-with-key/route.test.ts` | ✅ extend* | ⬜ pending |
| SC-5c | SEAM-04 | Class-3 (5 routes): `CIRCUIT_OPEN` → 503 + `Retry-After`, not a generic 500 | route unit (extend existing) | `npx vitest run src/app/api/bridge/route.test.ts src/app/api/simulator/route.test.ts src/app/api/portfolio-optimizer/route.test.ts src/app/api/scenario/optimize/route.test.ts src/app/api/keys/validate-and-encrypt/route.test.ts` | ✅ extend | ⬜ pending |
| SC-5d | SEAM-04 | `postProcessKey` returns the `CIRCUIT_OPEN` envelope; all 5 callers pass it through unchanged | unit | `npx vitest run src/lib/process-key-client.test.ts` | ✅ extend | ⬜ pending |
| REG-1 | SEAM-01 | Timeout mapping unchanged for both clients (`AbortError` **and** `TimeoutError`) | unit | `npx vitest run src/lib/analytics-client.test.ts src/lib/process-key-client.test.ts` | ✅ exists | ⬜ pending |
| REG-2 | SEAM-01 | ESLint rule flags a raw `ANALYTICS_SERVICE_URL` fetch outside the allowlist | RuleTester | `npx vitest run tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*\* SC-5b: verify `src/lib/wizardErrors.test.ts` exists; create if absent.*

---

## Wave 0 Requirements

- [ ] `src/lib/resilient-fetch.test.ts` — SC-2, SC-2-neg, SC-3a/b/c, SC-4c
- [ ] `src/lib/seam-budgets.invariant.test.ts` — SC-4a, SC-4b (source-scan; copy the "CEILING" honesty-comment convention from `src/app/scenario-share/[token]/page-server-boundary.test.ts`)
- [ ] `src/lib/resilient-fetch.wiring.test.ts` — SC-1c
- [ ] `src/app/api/keys/sync/route.seam.test.ts` — SC-1a (must **NOT** `vi.mock("@/lib/process-key-client")`)
- [ ] `src/app/api/admin/match/recompute/route.seam.test.ts` — SC-1b (must **NOT** `vi.mock("@/lib/analytics-client")`)
- [ ] Verify `src/lib/wizardErrors.test.ts` exists; create for SC-5b if not
- [ ] `tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts` — REG-2
- [ ] Framework install: **none needed**

⚠️ **16 existing route tests `vi.mock` the seam clients wholesale** — none of them prove SC-1
or SC-5. The new `*.seam.test.ts` files must use the REAL clients with only `fetch` faked.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Breaker trips against a genuinely degraded live Railway | SEAM-03 | No live Upstash in CI/local (env vars unset; 20+ tests delete them) and no controllable Railway failure injection. The faked-Redis double is the *correct* double for SC-2 regardless — a real Upstash cannot deterministically prove cross-module-context sharing. | Post-merge observation only. Watch Sentry for `CIRCUIT_OPEN` envelopes during the next real Railway incident; confirm no cascade-500s in the same window. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
