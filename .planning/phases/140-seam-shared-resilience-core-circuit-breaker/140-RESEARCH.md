# Phase 140: SEAM — Shared resilience core + circuit breaker - Research

**Researched:** 2026-07-25
**Domain:** Vercel Next.js 16 (Fluid Compute) → Railway FastAPI seam hardening; Upstash-Redis-backed circuit breaker; timeout-budget unification
**Confidence:** HIGH on the codebase inventory (every claim below is a direct read of `main` at 2026-07-25); HIGH on the Upstash API surface (read from installed `.d.mts` typings); MEDIUM on the Vercel project's effective default `maxDuration` (platform default verified from official docs; a dashboard override cannot be read from the repo).

---

<user_constraints>
## User Constraints

**No `CONTEXT.md` exists for this phase** (`/gsd:discuss-phase` was not run — milestone research
explicitly flagged Phase 140 as "standard/well-precedented, skip research-phase"). The
constraints below are therefore transcribed from the three upstream artifacts that already
lock this phase's design: `.planning/ROADMAP.md` (Phase 140 block), `.planning/REQUIREMENTS.md`
(SEAM-01..04 + Out of Scope table), and `.planning/research/SUMMARY.md`.

### Locked Decisions (from ROADMAP.md Phase 140 + SUMMARY.md — do NOT re-litigate)

1. **ONE shared `src/lib/resilient-fetch.ts` core.** Both `analyticsRequest()`
   (`analytics-client.ts:65`) and `postProcessKey()` (`process-key-client.ts:83`) route
   through it. Hardening one file only is Pitfall 2 and is explicitly forbidden.
2. **Breaker backed by the already-installed `@upstash/redis` + `@upstash/ratelimit`.**
   `Ratelimit.slidingWindow` as the failure counter, `SET … EX` as the open-state lock,
   **TTL expiry IS the half-open transition** (no extra state machine).
3. **ONE shared `breaker:railway` key** — both clients hit the same physical Railway
   deployment; two breakers can disagree (Open Decision 4, resolved "one").
4. **Breaker fails OPEN on Redis error** — deliberate divergence from `ratelimit.ts`'s
   fail-CLOSED. A broken breaker must never itself become the outage.
5. **Timeouts already exist** in both clients. This phase **unifies and documents** them
   into ONE exported per-call-site budget table. It does not add the mechanism.
6. **Retry is NOT in this phase** (Phase 141, gated on the SEAM-05 idempotency audit).
   Breaker ships BEFORE retry. The budget table must still be shaped so
   `timeout × (1 + retries) < maxDuration` is assertable with `retries = 0`.
7. **ZERO new npm dependencies.** `cockatiel` / `opossum` / `p-retry` are explicitly
   rejected in the Out of Scope table.
8. **`503 CIRCUIT_OPEN` envelope matches the existing `process-key-client.ts` shape**
   (`{ok:false, code, human_message, correlation_id, recoverable}`).

### Claude's Discretion (genuinely open — recommendations below)

- Breaker tuning constants (failure threshold N, counting window, cooldown TTL).
- Whether the breaker counts only *infrastructure* failures (timeout / network / 5xx) or
  also upstream 4xx. **Recommendation: infrastructure only** — see Pitfall 4.
- Whether the third Railway seam (`/internal/keys/{id}/permissions`, §4 below) is in scope
  for routing through the core, or documentation-only in this phase.
- Whether to add an ESLint rule banning raw `fetch(${ANALYTICS_URL}…)` outside the core.
- Exact placement of the SEAM-02 CI invariant test (recommendation: `src/lib/`, §8).

### Deferred Ideas (OUT OF SCOPE — ignore completely)

- `OPS-01` circuit-breaker state/ops dashboard.
- `OPS-03` `Idempotency-Key` header support.
- `OPS-04` adaptive/load-aware rate limiting driven by the breaker signal.
- Retry of any kind (Phase 141). Rate limiting (Phase 146). All JOB work (142–145).
- Rate-limiting `cron/warm-analytics`.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SEAM-01** | Both chokepoints route through ONE shared resilience core | §4 **Authoritative call-site inventory** — proves there are actually **four** live Railway fetch mechanisms, not two. §5 names the exact function signatures both clients must adapt to. §9 gives the ESLint-rule precedent (`no-raw-retry-after-parse.mjs`) for making "one core" structurally enforced rather than convention. |
| **SEAM-02** | Documented, exported per-call-site timeout budget re-derived against `maxDuration`; test asserts `timeout × (1+retries) < maxDuration` | §4 table gives every call site's **current** budget (four divergent constants: 15s ×3, 30s default, 60s, 15s permissions) and latency character (sync-pipeline vs enqueue-only, from `_is_long_fetch` in `process_key.py`). §6 resolves the `maxDuration` source-of-truth problem — **only `keys/sync` exports one**; everything else relies on an unreadable platform default. §8 gives the CI-invariant test pattern + the `AbortSignal.timeout` spy technique needed to assert budgets at all. |
| **SEAM-03** | Upstash-backed breaker, observed consistently across Fluid Compute instances, fails OPEN on Redis error | §7 verifies the exact Upstash primitives against the installed typings (`set` with `{ex, nx}`, `ttl`, `get`, `eval`; `RatelimitResponse` fields). §10 gives the two-module-context test recipe with the in-repo precedent. §7.3 flags the **null-client case** (Upstash unconfigured) which SEAM-03's wording does not cover but CI hits on every run. |
| **SEAM-04** | Clean typed `503 CIRCUIT_OPEN` envelope; no raw error escapes as a cascade-500 | §5 **cascade-500 escape surface** enumerates precisely which callers escape (2 echo `err.message` into a 500; 2 route through a **string-matching** classifier that falls through to `UNKNOWN`/500; 5 already map typed errors but have no `CIRCUIT_OPEN` branch). All 9 need a retrofit; the two classes need *different* retrofits. |
</phase_requirements>

---

## Summary

Phase 140's design is settled. What the milestone research left open — and what this pass
resolves — is the **implementation surface**: exactly which files change, what the numbers
in the budget table are, and how the five success criteria can actually be proven in this
repo's test harness.

Three findings materially change the plan's shape versus the milestone research. First,
**there are four live Railway fetch mechanisms in `src/`, not two.** Besides
`analyticsRequest()` and `postProcessKey()`, the `/internal/keys/{id}/permissions` endpoint
is hit directly from two separate files with their own duplicated `AbortSignal.timeout(15_000)`
(`keys/[id]/permissions/route.ts:96` and `finalize-wizard/route.ts:82`), and there are two
`/health` warm probes with a third and fourth budget (5s and 10s). SEAM-02 says "*every* seam
call site" — the plan must either route the permissions seam through the core or record an
explicit, reasoned exclusion. Silence here reproduces the exact drift Pitfall 2 describes.

Second, **`maxDuration` is unreadable for eight of the nine seam routes.** Only
`keys/sync/route.ts:55` exports one (`300`). Every other route inherits the Vercel platform
default. That makes SC-4 ("a CI test asserts `timeout × (1 + retries) < maxDuration` for
every route") impossible to implement honestly as written — the test has no source of truth
to read. The fix is cheap and is the correct hardening anyway: the budget table declares the
expected `maxDuration` per route, and the CI test **fails loud if a route file does not
export a matching `maxDuration`**. That converts a platform assumption into a checked
in-repo fact.

Third, **the cascade-500 escape surface splits into two classes needing two different
retrofits.** `admin/match/eval` and `admin/match/recompute` catch and return `err.message`
verbatim inside a 500 — the literal cascade-500. But `create-with-key` and
`composite/add-key` are worse in a subtler way: they classify by **substring-matching the
error message** (`classifyKeyValidationError` in `wizardErrors.ts:890`), and a new
`CIRCUIT_OPEN` error whose message happens to contain none of the ~12 magic substrings falls
through to `{ code: "UNKNOWN", status: 500 }`. A breaker that trips during a key-connect
would surface to the founder as "something went wrong, team notified" — the exact
failure the DOGFOOD-3 and KEY_AUTH_FAILED fixes were written to eliminate.

**Primary recommendation:** Build `src/lib/resilient-fetch.ts` exporting (a) a
`SEAM_BUDGETS` table keyed by call-site id, (b) a `resilientFetch()` that owns
timeout + breaker + typed error construction, and (c) a `CircuitOpenError` class. Adapt both
clients to it *without changing their public signatures or existing error types* (so the 16
route tests that `vi.mock` those modules keep passing), add a `CIRCUIT_OPEN` branch to
`classifyKeyValidationError` keyed on the **error type**, not a substring, and close the two
`err.message`-echoing 500s. Assert budgets by spying `AbortSignal.timeout` (verified
writable+configurable on both Node 22 and 25).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-request deadline (`AbortSignal.timeout`) | Frontend Server (Next route/lib, Node runtime) | — | The deadline must sit *below* the Vercel function's `maxDuration`; only the caller knows its own ceiling. Railway cannot enforce the caller's budget. |
| Breaker state storage | External store (Upstash Redis) | — | Fluid Compute reuses instances but does **not** share memory across them. Any module-level `let` is per-instance and silently inadequate (Pitfall 3, already burned this codebase's `debug-key-flow/rate-limit.ts`). |
| Breaker decision (open/closed check) | Frontend Server (`resilient-fetch.ts`) | — | The decision must happen *before* the outbound fetch, i.e. on the Vercel side. A Railway-side breaker cannot prevent the request that reaches it. |
| Typed error taxonomy (`UPSTREAM_TIMEOUT` / `_NETWORK_ERROR` / `CIRCUIT_OPEN`) | Frontend Server (shared core) | Route handlers (mapping to HTTP status) | The core knows *what* failed; the route knows *what status/copy* its client contract requires. Splitting here is why `bridge` can forward upstream 4xx while `create-with-key` maps to `{code}` — same core, different presentation. |
| HTTP envelope + human message | Route handler | — | Each route has a distinct client contract (`{error}` vs `{code}` vs `{ok,code,human_message}`). The core must not impose one. |
| Exchange-level breaker (per-API-key 429 cooldown) | API/Backend (Python worker) | Database (`api_keys.last_429_at`) | **Already exists** (`job_worker.py:731 _check_circuit_breaker`). Different resource (an exchange), different tier. Out of scope — but it is the in-repo proof that "breaker state lives in a shared store" is this project's established pattern. |
| Cold-start warming | Frontend Server (fire-and-forget) | — | `warmup-analytics.ts` / `cron/warm-analytics`. Deliberately must NOT consume breaker budget — see §4 note. |

---

## Standard Stack

### Core (all already installed — zero new dependencies)

| Library | Version (installed, verified) | Purpose | Why Standard |
|---------|------|---------|--------------|
| `@upstash/redis` | **1.38.0** [VERIFIED: `node_modules/@upstash/redis/package.json`] | Breaker open-lock (`SET key EX n NX`), state read (`GET`/`TTL`) | The ONLY durable cross-Fluid-Compute-instance store already wired in this project. Backs `src/lib/ratelimit.ts` in prod. |
| `@upstash/ratelimit` | **2.0.8** [VERIFIED: `node_modules/@upstash/ratelimit/package.json`] | `Ratelimit.slidingWindow(N, window)` as the failure counter | Already the failure-counting primitive in `ratelimit.ts`; reusing it means the breaker's counter has the same operational characteristics as a proven prod component. |
| `AbortSignal.timeout()` | Web platform (Node ≥22) | Per-request deadline | Already the mechanism in **both** clients. Verified spy-able (see §8). |
| `vitest` | **4.1.10** [VERIFIED: `node_modules/vitest/package.json`] | Test harness for all five SCs | Repo's suite. `vi.resetModules()` + dynamic `import()` is the SC-2 mechanism and already has an in-repo precedent in `analytics-client.test.ts`. |

**Installation:** none. `package.json` already declares `"@upstash/ratelimit": "^2.0.8"` and
`"@upstash/redis": "^1.38.0"`.

### Verified Upstash API surface (read from installed `.d.mts`, not from training data)

| Call | Signature | Source |
|------|-----------|--------|
| `redis.set(key, value, opts)` | `opts: SetCommandOptions` = `{get?} & ({ex:number}\|{px}\|{exat}\|{pxat}\|{keepTtl:true}\|{}) & ({nx:true}\|{xx:true}\|{})` | `error-8y4qG0W2.d.mts:2106-2153` [VERIFIED] |
| `redis.get<T>(key)` | `Promise<T \| null>` | `error-8y4qG0W2.d.mts:4229ff` [VERIFIED] |
| `redis.ttl(key)` | `Promise<number>` | `error-8y4qG0W2.d.mts:3516` (pipeline form; scalar form present) [VERIFIED] |
| `redis.incr(key)` / `redis.expire(key, s)` | present | `error-8y4qG0W2.d.mts:3259 / 3071` [VERIFIED] |
| `redis.eval(script, keys, args)` | `Promise<TData>` — Lua available if an atomic check-and-trip is wanted | `error-8y4qG0W2.d.mts:4241` [VERIFIED] |
| `ratelimit.limit(id)` → `RatelimitResponse` | `{success, limit, remaining, reset, pending, reason?}` | `@upstash/ratelimit/dist/index.d.mts:39-80` [VERIFIED] |

**`ex` + `nx` compose.** The `SetCommandOptions` type is an *intersection* of the TTL union
and the nx/xx union, so `redis.set("breaker:railway", "open", { ex: 30, nx: true })` type-checks.
This is the exact primitive the locked design calls for. [VERIFIED: typings]

**⚠️ `RatelimitResponse.pending`.** The typings document that on Vercel you should
`waitUntil(pending)` when `analytics: true`. The existing `checkLimit()` never does this
(pre-existing, out of scope). **Recommendation: construct the breaker's `Ratelimit` with
`analytics: false`** — it sidesteps the dangling-promise hazard entirely and keeps breaker
counters out of the rate-limit analytics dashboard. [CITED: `@upstash/ratelimit/dist/index.d.mts:56-74`]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Ratelimit.slidingWindow` as counter | Raw `INCR` + `EXPIRE` | Fewer moving parts, but re-implements window semantics `slidingWindow` already gets right, and loses the `reset` timestamp that makes `Retry-After` derivable. Locked decision says `slidingWindow`. |
| Non-atomic `check → set` | `redis.eval` Lua CAS | Atomicity matters only if two instances tripping simultaneously is harmful. It isn't — both write `open` with the same TTL. Keep it simple; note the benign race in a comment. |
| `cockatiel` / `opossum` | — | **Forbidden** by the Out of Scope table. Both in-memory-only; would still need the Redis adapter. |

---

## Package Legitimacy Audit

**Zero external packages are installed by this phase.** Every dependency is already present,
pinned in `package.json`, and running in production behind `src/lib/ratelimit.ts`.

| Package | Registry | Installed | Source Repo | slopcheck | Disposition |
|---------|----------|-----------|-------------|-----------|-------------|
| `@upstash/redis` | npm | 1.38.0 (already) | github.com/upstash/redis-js | n/a — no install | Pre-existing, no action |
| `@upstash/ratelimit` | npm | 2.0.8 (already) | github.com/upstash/ratelimit-js | n/a — no install | Pre-existing, no action |

**Packages removed due to slopcheck `[SLOP]`:** none — no packages were evaluated for install.
**Packages flagged `[SUS]`:** none.

The slopcheck gate was **not run** because this phase installs nothing; running it would
produce no actionable signal. If the planner introduces any package, the gate must run first.
Note that `scripts/check-banned-packages.mjs` already runs in CI (`.github/workflows/ci.yml:401`)
and is the repo's existing supply-chain guard.

---


## 4. Authoritative Call-Site Inventory (SEAM-01 + SEAM-02 raw material)

Derived from `grep -rln 'analytics-client\|process-key-client' src` plus
`grep -rn "ANALYTICS_SERVICE_URL" src`, then reading each hit. **The second grep is the one
milestone research did not run** — it surfaces two additional live Railway mechanisms.

### 4.1 The four live Railway fetch mechanisms

| # | Mechanism | Location | Timeout today | In milestone research? |
|---|-----------|----------|---------------|------------------------|
| **A** | `analyticsRequest()` | `src/lib/analytics-client.ts:65` | `30_000` default (`:20`), `15_000` override at 3 sites | ✅ named |
| **B** | `postProcessKey()` | `src/lib/process-key-client.ts:83` | `60_000` hardcoded (`:132`) | ✅ named |
| **C** | `/internal/keys/{id}/permissions` — raw `fetch`, **two copies** | `src/app/api/keys/[id]/permissions/route.ts:87` and `src/app/api/strategies/finalize-wizard/route.ts:82` (`fetchLivePermissions`) | `AbortSignal.timeout(15_000)` — **duplicated constant in two files** | ❌ **NOT named — new finding** |
| **D** | `/health` warm probes | `src/app/api/cron/warm-analytics/route.ts:54` (5s `AbortController`) and `src/lib/warmup-analytics.ts:37` (10s `AbortController`) | 5s / 10s | ⚠️ only `cron/warm-analytics` mentioned |

Plus one **dormant** path and one **special-case** path:

| Path | Location | Status |
|------|----------|--------|
| Direct `fetch(${ANALYTICS_URL}/process-key)` with **no timeout at all** | `src/app/api/keys/validate-and-encrypt/route.ts:158`, inside `_unifiedValidateAndEncryptHandler` | **DEAD** — underscore-prefixed, zero references (`grep -rn "_unifiedValidateAndEncryptHandler" src` returns only the declaration). Documented dormant at `:120-135` pending a `/process-key` encrypt branch. **Recommendation: leave dead, but note it — if it is ever revived it must be revived *through the core*.** A lint rule (§9) makes that automatic. |
| `debug-key-flow` per-step fetch | `src/app/api/debug-key-flow/route.ts:176-181` | `AbortSignal.any([req.signal, AbortSignal.timeout(60_000)])`, `maxDuration = 300`. Bespoke heartbeat/SSE design with client-abort propagation the core does not model. **Recommendation: explicitly OUT, documented in the budget table as an intentional exclusion with the reason.** |

**Zero server actions and zero React Server Components call the seam clients**
(`grep -rln '"use server"' src` → no hits; the only `analytics-client` reference outside
routes is a *comment* in `src/lib/analytics/usage-events-client.ts:7` and
`src/lib/correlation-id.ts`). So the entire SEAM-01 surface is route handlers. [VERIFIED: grep]

### 4.2 Mechanism A — `analyticsRequest()` call sites

`ANALYTICS_URL` = `process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002"` (`:14`).
Timeout resolution: `options?.timeoutMs ?? DEFAULT_TIMEOUT_MS(30_000)` (`:70`).

| Route | Wrapper(s) called | Calls/req | Current budget | Worst-case wall clock | `maxDuration` | Latency character |
|-------|-------------------|-----------|----------------|----------------------|---------------|-------------------|
| `POST /api/keys/validate-and-encrypt` | `validateKey` → `encryptKey` (sequential) | **2** | 30s each | **60s** | *none* | Live exchange auth probe — genuinely slow, variable per venue |
| `POST /api/strategies/create-with-key` | `validateKey` → `encryptKey` (sequential, `:254`, `:289`) | **2** | 30s each | **60s** | *none* | Live exchange auth probe |
| `POST /api/strategies/composite/add-key` | `validateKey` → `encryptKey` (sequential, `:239`, `:271`) | **2** | 30s each | **60s** | *none* | Live exchange auth probe |
| `POST /api/bridge` | `findReplacementCandidates` | 1 | **15s** (hardcoded in client `:260`) | 15s | *none* | Compute (weighted covariance) |
| `POST /api/simulator` | `simulateAddCandidate` | 1 | **15s** (hardcoded in client `:285`) | 15s | *none* | Compute |
| `POST /api/portfolio-optimizer` | `runPortfolioOptimizer` | 1 | **15s** (`OPTIMIZER_TIMEOUT_MS` in the **route**, `route.ts:14`, passed at `:123`) | 15s | *none* | Heavy compute |
| `POST /api/scenario/optimize` | `optimizeScenarioWeights` | 1 | 30s default | 30s | *none* | Compute |
| `GET /api/admin/match/eval` | `evalMatch` (GET) | 1 | 30s default | 30s | *none* | Eval sweep — can be slow at large `lookback_days` |
| `POST /api/admin/match/recompute` | `recomputeMatch` | 1 | 30s default | 30s | *none* | Heavy compute (match engine) |

**Dead export:** `computePortfolioAnalytics()` (`analytics-client.ts:224`) has **zero callers**
(`grep -rn "computePortfolioAnalytics" src` returns only the declaration). Milestone research
listed it as "UNAUDITED — do not assume retry-safe" for Phase 141; it is in fact unreachable.
Flag to the planner: either delete it in this phase (it is one of the two functions the core
must adapt, so touching it is free) or leave it and let Phase 141's audit record "no callers".
**Recommendation: leave it, note it in the audit artifact — deleting it is scope creep and it
is a plausible future caller.**

**Note the budget-declaration inconsistency this table exposes:** 15s is declared *inside the
client* for bridge and simulator, but *inside the route* for portfolio-optimizer. Three
identical budgets, two different owners. SEAM-02's "ONE exported table" fixes exactly this.

### 4.3 Mechanism B — `postProcessKey()` call sites

Single budget: `AbortSignal.timeout(60_000)` at `process-key-client.ts:132`, with the CT-7
rationale comment at `:101-107`. No per-call override exists.

**Critical latency split — verified in the Python source, not inferred:**
`analytics-service/routers/process_key.py:446-452`:

```python
def _is_long_fetch(body: _ProcessKeyBody) -> bool:
    """teaser/csv/internal_report run inline (Vercel 300s ceiling sufficient);
    onboard + resync queue via worker dyno (BACKBONE-09)."""
    return body.flow_type in {"onboard", "resync"}
```

and the module docstring (`:9-16`): *SYNCHRONOUS (default for csv, teaser, internal_report):
runs the full 5-method pipeline inline* / *QUEUED (for resync + onboard): returns
`{queued, correlation_id, verification_id}` synchronously.* [VERIFIED: source read]

| Route | `flow_type` | Server mode | Realistic latency | Current budget | `maxDuration` |
|-------|-------------|-------------|-------------------|----------------|---------------|
| `POST /api/keys/sync` (`unifiedKeysSyncHandler`, `:406`) | `resync` | **QUEUED** — returns 202 immediately after enqueue | fast (enqueue RPC only) | 60s | **`300`** (`route.ts:55`) — the only explicit one |
| `POST /api/strategies/finalize-wizard` (`:1245`) | `onboard` | **QUEUED** | fast (enqueue) | 60s | *none* |
| `POST /api/verify-strategy` (`unifiedVerifyStrategyHandler`, `:165`) | `teaser` | **SYNCHRONOUS** full pipeline | ~10-25s typical (per the CT-7 comment) | 60s | *none* |
| `POST /api/strategies/csv-validate` (`:192`) | `csv` (step=validate) | **SYNCHRONOUS** | seconds — file-size dependent | 60s | *none* |
| `POST /api/strategies/csv-finalize` (`:1162`) | `csv` (step=finalize) | **SYNCHRONOUS** | seconds | 60s | *none* |

**Planning consequence:** the single 60s constant is simultaneously **4× oversized** for the
two enqueue-only routes and **the only load-bearing budget** for the three synchronous ones.
The unified table should split at minimum into `ENQUEUE` (recommend 15s — an enqueue that
takes 15s means Railway is sick) and `SYNC_PIPELINE` (keep 60s; do not tighten without
latency data — see Open Question 2).

### 4.4 Mechanism C — the third seam (NEW FINDING)

Two files independently declare the same 15s budget against the same endpoint:

- `src/app/api/keys/[id]/permissions/route.ts:87-96` — `GET`, wrapped in `withAuth`, feeds an
  `unstable_cache` 60s layer. Errors → `{error: userMessage, code}` **502** (`:211`) or a
  generic **500** at `:148`.
- `src/app/api/strategies/finalize-wizard/route.ts:76-99` (`fetchLivePermissions`) — `POST`
  with `?force_refresh=true`, deliberately bypassing both cache layers. **Throws** on any
  non-OK (`:95`) and the route **fails CLOSED** (a probe failure blocks finalize, `:363`/`:375`
  → 502).

Both target the same Railway deployment as A and B. **If the breaker is keyed
`breaker:railway` (the locked decision), these two paths are the only Railway callers that
would still hammer a dying Railway while the breaker is open** — an internally inconsistent
outcome for a phase whose SC-1 is "a hung or dying Railway fails fast at BOTH seam
chokepoints."

**Recommendation:** route C through the core in this phase. It is small (one shared helper
replacing two duplicated `fetch` blocks) and it removes a genuine duplicated constant, which
is literally SEAM-02's stated purpose ("*every* seam call site"). If the planner defers it,
the deferral must be an explicit line in the budget table, not an omission.

### 4.5 Mechanism D — warm probes (recommend explicit exclusion)

`cron/warm-analytics` (5s) and `warmup-analytics.ts` (10s, fire-and-forget from a Server
Component) both hit `/health`. Their purpose is to probe a *cold* service, so:

- They must **not** consume breaker failure budget — a cold-start probe failing is the
  normal case, and counting it would trip the breaker during routine warmup.
- They must **not** be blocked by an open breaker — the half-open recovery signal is
  precisely a successful `/health`.

**Recommendation: explicitly excluded, documented in the budget table with this reasoning.**
An unexplained absence here is indistinguishable from an oversight.

---

## 5. The Cascade-500 Escape Surface (SC-5)

SC-5: *"No route handler calling either client surfaces a raw fetch/breaker error as a 500 —
every failure arrives as the typed envelope."*

### 5.1 Mechanism B is already clean

Every `postProcessKey()` caller does `if (!result.ok) return result.response;`
(`keys/sync:423`, `verify-strategy:180`, `csv-validate:207`, `csv-finalize:1185`,
`finalize-wizard:1263`). The client itself never throws on a fetch failure — it returns a
`NextResponse` carrying `{ok:false, code:"UPSTREAM_TIMEOUT"|"UPSTREAM_NETWORK_ERROR",
human_message, correlation_id, recoverable}` at 504/502 (`process-key-client.ts:144-175`).

**So SC-5's work is entirely on Mechanism A**, plus adding a `CIRCUIT_OPEN` arm to B's existing
envelope (trivial — one more branch in the same shape). [VERIFIED: read all five call sites]

### 5.2 Mechanism A — three distinct classes, three distinct retrofits

| Class | Routes | Current behavior | What a `CircuitOpenError` does today | Retrofit needed |
|-------|--------|------------------|--------------------------------------|-----------------|
| **CLASS 1 — literal cascade-500 (echoes `err.message`)** | `GET /api/admin/match/eval` (`:36-42`), `POST /api/admin/match/recompute` (`:56-59`) | `catch (err) { … return NextResponse.json({ error: err.message }, {status:500}) }` | Surfaces the raw breaker message to an admin browser inside a **500** | Add a `CircuitOpenError` branch → **503** + `human_message`. **Also** stop echoing `err.message` on the generic arm (both routes leak upstream strings — the exact leak `portfolio-optimizer:144-147` M-0333 and `bridge:142-145` H-1062 already fixed elsewhere). This is a real, pre-existing security-adjacent defect these two routes never got. |
| **CLASS 2 — substring classifier, falls through to `UNKNOWN`/500** | `POST /api/strategies/create-with-key` (`:438-452`), `POST /api/strategies/composite/add-key` (`:393`) | `classifyKeyValidationError(message)` in `wizardErrors.ts:890-961` — ~12 `lower.includes(...)` branches, terminal `return { code: "UNKNOWN", status: 500 }` | Depends entirely on the breaker error's **message text**. If it contains "rate" → `KEY_RATE_LIMIT`/503 (accidentally OK-ish); if "timeout" → `KEY_NETWORK_TIMEOUT`/502; otherwise → **`UNKNOWN` / 500** and the wizard shows "something went wrong, team notified" | **Do NOT fix by choosing a message that happens to match a substring** — that is exactly the fragility the classifier's own collision-invariant comment (`:919-926`) warns about. Add a **type-checked** early return: `if (err instanceof CircuitOpenError) return { code: "SERVICE_UNAVAILABLE_RETRY", status: 503 }` *before* the substring cascade, plus a new `WizardErrorCode` + copy entry. Note `classifyKeyValidationError` currently takes a `string`, so its **signature must change to accept the error object** (or gain a sibling). Both call sites pass `message` — a 2-line change each. |
| **CLASS 3 — typed mapping exists, no `CIRCUIT_OPEN` arm** | `bridge` (`:119-153`), `simulator` (`:148-177`), `portfolio-optimizer` (`:133-158`), `scenario/optimize` (`:127-145`), `keys/validate-and-encrypt` (`:221-246`) | Branch on `AnalyticsUpstreamError` (4xx forward) then `AnalyticsTimeoutError` (→504), then a **static, non-leaking** generic (500 / 502 / 503) | Falls to the generic arm → a **500** (bridge, simulator, scenario/optimize, validate-and-encrypt) or **503** (portfolio-optimizer, already correct) with static copy. No leak, but the wrong status and no `Retry-After` | Insert a `CircuitOpenError` branch **before** the generic arm → 503 + `Retry-After`. `portfolio-optimizer` additionally calls `refundRateLimitToken()` on its upstream-failure arms (`:127`, `:152`) — the `CIRCUIT_OPEN` arm should refund too, for consistency with its own documented R-0002 rationale. |

**Count: 9 route handlers need edits** (2 + 2 + 5). Plus `wizardErrors.ts` (new code + copy +
type-checked branch) and the 5 `postProcessKey` callers get the new code for free via the
client's envelope.

### 5.3 A `Retry-After` hint is derivable and should be used

The breaker's open-lock TTL is readable (`redis.ttl("breaker:railway")`), so the 503 can carry
a truthful `Retry-After`. The repo already has the canonical builders
(`rateLimitDenyJson` / `rateLimitDenyText`, `ratelimit.ts:263-288`) and an ESLint rule banning
raw `Retry-After` parsing on the client (`tools/eslint-plugin-quantalyze/rules/no-raw-retry-after-parse.mjs`)
— so emitting a well-formed header means existing client retry logic
(`src/lib/retry/parseRetryAfterSeconds`) understands it with zero client changes. [VERIFIED: source read]

---

## 6. `maxDuration` — the SC-4 source-of-truth problem

### 6.1 What the code actually declares

`grep -rn "maxDuration" src` (excluding tests) returns **eight** exports repo-wide. Of the
nine seam routes, exactly **one** declares it:

| Seam route | `maxDuration` |
|------------|---------------|
| `keys/sync` | **`300`** (`route.ts:55`) |
| all eight others | **not exported** → platform default |

Non-seam exports for context: `debug-key-flow` = 300 (comment at `:15` reads *"maxDuration=300
— Vercel Pro default, pinned for clarity"*), `cron/flag-monitor` = 60, `cron/founder-lp-report`
= 60, the four PDF routes = 30. `vercel.json` has **no `functions` block**, so there is no
repo-level override. [VERIFIED: grep + file read]

### 6.2 What the platform default is

Vercel's official duration docs (last_updated 2026-07-01) give, **with Fluid compute (enabled
by default)**:

| | Default | Maximum | Extended maximum |
|---|---|---|---|
| Hobby | 300s | 300s | — |
| Pro | **300s** | 800s | 1800s |
| Enterprise | 300s | 800s | 1800s |

[CITED: https://vercel.com/docs/functions/configuring-functions/duration §"Duration limits"]

The in-repo comment at `debug-key-flow/route.ts:15` independently asserts "Vercel Pro default"
= 300, which corroborates both the plan tier and the value.

### 6.3 Why SC-4 cannot be implemented as literally written

SC-4 requires a CI test asserting `timeout × (1 + retries) < maxDuration` **per route**. For
eight of nine routes there is no `maxDuration` in the repo for a test to read. A test that
hardcodes `300` as "the default" silently encodes an assumption that a dashboard change (the
Vercel Functions settings page has a **Default Max Duration** field —
[CITED: same doc, §"Setting a default maximum duration → Dashboard"]) would invalidate with
zero CI signal.

**Recommendation (this is the load-bearing planning call):** make the budget table the
*declaration* and the route files the *verification*:

1. `SEAM_BUDGETS` in `resilient-fetch.ts` records, per call-site id:
   `{ routePath, timeoutMs, callsPerRequest, expectedMaxDurationS, latencyClass, notes }`.
2. **Add an explicit `export const maxDuration = N` to each of the eight seam routes**,
   matching the table. Cheap, and it converts an unreadable platform default into a checked
   in-repo fact — the same "pinned for clarity" reasoning `debug-key-flow` already applies.
3. The CI test (§8) reads each `routePath` from disk, extracts the `maxDuration` export, and
   fails loud if it is **missing** or **≠ `expectedMaxDurationS`**, then asserts
   `timeoutMs × callsPerRequest × (1 + retries) < expectedMaxDurationS × 1000`.

Note `callsPerRequest`: three routes make **two** sequential `analyticsRequest()` calls
(§4.2). A per-call assertion would pass while the route's real worst case is double. The
table must carry the multiplier or the invariant is wrong for a third of Mechanism A.

### 6.4 Does anything depend on the CURRENT 30s / 60s values?

Investigated explicitly (this was an assigned question). **Findings:**

| Dependency | Verdict |
|------------|---------|
| Any client-side poll/backoff tuned to 30s or 60s | **No.** `SyncProgress.tsx` uses `POLL_MAX_ATTEMPTS=40` (~120s) + `MISSING_ROW_GRACE_POLLS=10`, keyed on DB row state, not on the seam budget. |
| Any test asserting a specific ms value | **No.** `analytics-client.test.ts:385` simulates the timeout by rejecting with `new DOMException("aborted","TimeoutError")` — it never asserts the ms. `process-key-client.test.ts` (87 lines) asserts headers only. |
| Python-side timeout the client budget must exceed | **Partially.** `/process-key` synchronous flows run the full 5-method pipeline with no documented server-side cap; the CT-7 comment (`process-key-client.ts:101-107`) states 60s "leaves slack for typical synchronous teaser runs (~10-25s)". **Tightening the 60s for `teaser`/`csv` risks converting a slow-but-succeeding teaser into a 504.** |
| Railway platform ceiling | ~5 min on public networking [CITED via milestone SUMMARY.md → https://docs.railway.com/networking/public-networking/specs-and-limits]. Above every proposed budget; not binding. |

**Conclusion:** the two enqueue-only budgets (`keys/sync`, `finalize-wizard`) can be tightened
freely — nothing observes them. The three synchronous ones (`verify-strategy`, `csv-validate`,
`csv-finalize`) are the only place a re-derived budget could regress live behavior, and the
only evidence for "safe" is a code comment, not measured latency. See Open Question 2.


---

## 7. Breaker Design Notes (implementation-specific gaps the locked design leaves open)

### 7.1 The three Redis operations, verified against installed typings

```ts
// Source: @upstash/redis 1.38.0 typings, error-8y4qG0W2.d.mts:2106-2153 / 4229ff
// CHECK (before every seam call)
const open = await redis.get<string>("breaker:railway");   // null | "open"
// TRIP (on Nth failure) — ex + nx compose per SetCommandOptions intersection
await redis.set("breaker:railway", "open", { ex: COOLDOWN_S, nx: true });
// RETRY-AFTER hint for the 503 envelope
const ttl = await redis.ttl("breaker:railway");            // seconds, -2 if absent
```

`nx: true` makes the trip idempotent under concurrent tripping — the first writer's TTL
stands, so a second instance tripping 200ms later does not extend the cooldown. That is the
desired semantics and it is why `nx` matters here. [VERIFIED: typings]

**TTL expiry IS half-open** (locked): when the key expires, the next request passes through
to Railway naturally. A success does nothing special; a failure re-increments the counter and
re-trips. **No explicit half-open state, no probe scheduling, no state machine.** The plan
should state this explicitly so a reviewer does not flag "missing half-open" as a defect.

### 7.2 Failure counter — what counts as a failure

`Ratelimit.slidingWindow(N, window)` used inversely: call `.limit("breaker:railway:failures")`
**only on a failure**; `success === false` means "more than N failures in `window`" → trip.

**Recommendation: count ONLY infrastructure failures.** Specifically:
- ✅ count: `AnalyticsTimeoutError` / `DOMException{name:"TimeoutError"}`, network throw, HTTP **5xx**
- ❌ do NOT count: HTTP **4xx** (a user's bad API key returning 400 is Railway working
  *correctly*), Zod contract-violation throws from `parseResponse` (a schema drift, not an outage)

Rationale grounded in this repo: `create-with-key` / `composite/add-key` deliberately map a
wrong-credential 400 through `classifyKeyValidationError` as a **client fault**. If 4xx counted
toward the breaker, a handful of users fat-fingering API keys would trip the breaker and take
down key-connect for everyone — turning a user error into an outage. This is the single most
important tuning decision in the phase and it is currently unstated in the requirements.

### 7.3 ⚠️ The null-client case that SEAM-03's wording does not cover

SEAM-03 says fail OPEN "when Redis itself **errors**." It does not say what happens when Redis
is **unconfigured** (`UPSTASH_REDIS_REST_URL` / `_TOKEN` absent → `Redis.fromEnv()` never
constructed, `ratelimit.ts:52-55` returns `null`).

This is not hypothetical: **CI runs with Upstash unconfigured on every run** — 20+ test files
do `delete process.env.UPSTASH_REDIS_REST_URL` (e.g. `admin/strategy-review/route.test.ts:105`,
`admin/users/[id]/roles/route.test.ts:231`), and `adr-0014-secret-handling.md:24-25` lists both
vars as dashboard-provisioned, i.e. absent locally. [VERIFIED: grep]

`ratelimit.ts` handles null by failing **CLOSED in prod** (503) and **OPEN elsewhere**. **The
breaker must fail OPEN in ALL environments including production**, with a loud
`console.error` + `process.emitWarning` at module load mirroring `ratelimit.ts:57-79`. A
breaker that blocks all traffic because its store is misconfigured is strictly worse than no
breaker — the same argument SEAM-03 already makes for the error case, extended to the null
case. **The plan must state this as an explicit, tested behavior, not leave it implied.**

### 7.4 Do NOT reuse the `redis` singleton by importing `ratelimit.ts`

`ratelimit.ts` creates its `redis` at module scope and does not export it. Importing
`ratelimit.ts` from `resilient-fetch.ts` would drag in `next/server` (`NextResponse`) and 15
`Ratelimit` constructions as a side effect. **Recommendation: construct a separate
`Redis.fromEnv()` in `resilient-fetch.ts`** (same physical database — the locked "do not
provision a second store" constraint is about the *database*, not the client object) with
`prefix` distinct from `"quantalyze"` so breaker keys never collide with limiter keys.

### 7.5 In-repo precedents the breaker must mirror / must not repeat

| Precedent | File | Lesson |
|-----------|------|--------|
| ✅ **Postgres-backed exchange breaker** | `analytics-service/services/job_worker.py:731 _check_circuit_breaker`, `EXCHANGE_COOLDOWNS:416` | This project's established pattern: breaker state in a **shared store**, cooldown as a **TTL-like timestamp**, per-resource keying. Cite it in the new module's docstring. |
| ✅ **Upstash limiter** | `src/lib/ratelimit.ts` | Module shape to copy: singleton client, null-guard, documented behavior matrix, named exported constants with rationale comments. |
| ❌ **In-memory `Map` limiter** | `src/app/api/debug-key-flow/rate-limit.ts:29` | The anti-pattern, *with its own honest LIMITATIONS block* (`:5-19`) admitting "cross-instance slip". The breaker must not become a second one of these. Its "ESCALATION PATH" comment literally points at `ratelimit.ts` as the fix. |

---

## 8. Testing Budgets: `AbortSignal.timeout` Is Not Introspectable

**Verified at runtime on both Node versions this repo uses:**

```
Node v25.8.1 : AbortSignal.timeout descriptor {"writable":true,"configurable":true,"enumerable":false}
Node v22.22.1: AbortSignal.timeout descriptor {"writable":true,"configurable":true}
AbortSignal.timeout(50) → Object.keys(signal) === []   // ms is NOT readable off the signal
```
[VERIFIED: executed locally, both `node` and `/opt/homebrew/opt/node@22/bin/node` — Node 22 is
the CI version per the repo's known CI-vs-local split]

**Consequence:** you cannot assert a budget by inspecting the `signal` passed to `fetch`. The
two workable techniques:

1. **`vi.spyOn(AbortSignal, "timeout")`** — works because the property is
   writable + configurable. Assert `expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000)`.
   Simplest; no production-code change.
2. **Inject the budget through the core's own API** — `resilientFetch({ budgetKey: "bridge" })`
   resolves `SEAM_BUDGETS.bridge.timeoutMs` and the test asserts against the exported table
   *plus* one spy proving the table value reaches `AbortSignal.timeout`.

**Recommendation: both** — (2) for the per-call-site table assertion (a pure data test, fast,
runs for all 9+ sites), (1) as a single wiring test proving the table is actually consumed.
This directly implements the repo's own hard-won lesson: *"testing a fix's helper ≠ testing
that the call site INVOKES it."*

**Do NOT use `vi.useFakeTimers()` to test the timeout path.** The established in-repo pattern
is to simulate the abort by rejecting the fetch mock:

```ts
// Source: src/lib/analytics-client.test.ts:385-398 (existing, passing)
const timeoutErr = new DOMException("aborted", "TimeoutError");
const fetchMock = vi.fn().mockRejectedValue(timeoutErr);
// → asserts the error is mapped to AnalyticsTimeoutError
```

Note `process-key-client.ts:136-138` checks `err.name === "AbortError" || "TimeoutError"`
(broader) while `analytics-client.ts:93` checks `err instanceof DOMException && name === "TimeoutError"`
(narrower). **The shared core must adopt the broader check** — the narrower one misses a
plain `AbortError` and would fall through to the generic
`"Analytics service is not reachable"` message. This is a real (small) behavioral divergence
the unification should close, and a regression test should pin it.

### The CI invariant test — placement and precedent

| Option | Runs in CI? | Precedent |
|--------|-------------|-----------|
| `src/lib/seam-budgets.invariant.test.ts` | ✅ **yes** — root `vitest.config.ts` `include` covers `src/**/*.test.{ts,tsx}` | `src/app/scenario-share/[token]/page-server-boundary.test.ts` — a source-scanning vitest test that `readFileSync`s route files and asserts a structural invariant, with an explicit honest "CEILING" comment about what it does *not* cover |
| `scripts/*.test.ts` | ❌ **no** — root config excludes `scripts/**`; needs `--config scripts/vitest.config.ts`, only invoked ad hoc | `scripts/check-gdpr-export-coverage.test.ts` |
| `scripts/check-*.ts` in `npm run lint` | ✅ yes (`lint` = eslint + `check-admin-route-manifest` + `check-route-contract`) | good for a *gate*, but not for the numeric assertion |

**Recommendation: `src/lib/` vitest test.** It is in the default suite, counts toward the
coverage ratchet, and matches the closest structural precedent. Copy that file's "CEILING"
honesty convention — state that the test reads only the listed route files, not the transitive
import graph.

---

## 9. Making "ONE core" Structural, Not Conventional (SEAM-01)

The repo has a local ESLint plugin (`tools/eslint-plugin-quantalyze/`) with nine rules,
including two that are exactly this pattern — *ban the raw primitive, force the shared helper*:

- `no-raw-retry-after-parse.mjs` — bans `Number(headers.get("Retry-After"))`, forces
  `parseRetryAfterSeconds`
- `no-raw-localstorage.mjs`, `no-raw-published-predicate.mjs`, `no-raw-staleness-derivation.mjs`

Rules are tested via RuleTester in `tools/eslint-plugin-quantalyze/tests/**` and those tests
**are** in the root vitest `include` (`vitest.config.ts` include list). `npm run lint` runs
eslint over `src/` only. [VERIFIED: file reads]

**Recommendation:** add `no-raw-analytics-fetch` — flag any `fetch()` whose URL template
references `ANALYTICS_SERVICE_URL` / `ANALYTICS_URL` outside an allowlist
(`src/lib/resilient-fetch.ts`, plus explicitly-excluded `debug-key-flow` and the two
`/health` warmers). This is what prevents the **dead** `_unifiedValidateAndEncryptHandler`
(§4.1) from being revived with no timeout, and prevents a tenth seam appearing the way the
third one did. Marginal cost (~60 lines rule + RuleTester fixtures); it is the only mechanism
that makes SEAM-01 hold over time rather than at merge time.

---

## 10. Testing Breaker State Across Two Module Contexts (SC-2)

SC-2: *"a seam call from a DIFFERENT module context (simulating a second Fluid Compute
instance) short-circuits … breaker state lives in the shared Upstash store, never per-instance
memory."*

### 10.1 The in-repo precedent to cite

`src/lib/analytics-client.test.ts:33` + `:52` already does exactly the required manoeuvre:

```ts
beforeEach(() => { vi.resetModules(); });
// ...
vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof globalThis.fetch);
const mod = await import("./analytics-client");   // fresh module registry each time
```

`vi.resetModules()` clears the module registry so the next dynamic `import()` re-executes the
module body — which is precisely what re-creates a module-scope `let state = "closed"`. **That
is the mechanism that makes an in-memory breaker fail this test and a shared-store breaker
pass it.**

### 10.2 The critical subtlety: the fake store must survive `resetModules`

> 🛑 **CORRECTED 2026-07-25 DURING EXECUTION OF 140-01 — DO NOT COPY THE CLAIM BELOW.**
> The assertion that "`vi.mock` factories **re-run** when the registry is reset" is **FALSE on
> vitest 4.1.10**. It was measured directly: a factory incrementing a hoisted counter reports
> **1** execution both before and after `vi.resetModules()`. Building the SC-2 negative control
> on the false premise yields a **silent FALSE GREEN** — context B keeps the cached,
> already-tripped store, short-circuits, and the control never fires.
> **The corrected model is documented in the header of `src/lib/resilient-fetch.test.ts`
> (written by 140-01). Plans 140-03 and 140-06 MUST read that header instead of this section.**
> Summary of what is actually true:
> 1. Non-mocked modules DO re-execute on `resetModules()` — that is what makes SC-2 a real proof
>    (a module-scope `let breakerState` cannot survive, so only out-of-module state can).
> 2. `vi.mock` factories do NOT re-run. The per-context hook that DOES exist is `Redis.fromEnv()`,
>    called once per module-body execution — hang per-context setup off that.
> 3. Class identity: after `resetModules()`, a statically imported `CircuitOpenError` is a
>    DIFFERENT class object from the one the freshly imported core throws. Assert against the
>    module namespace from the SAME registry (`b.CircuitOpenError`), not the static import.
>
> Hoisting the store is still correct and is still what survives the reset in shared mode — only
> the stated *reason* and the negative-control shape were wrong.

*(Original text, retained for provenance — superseded by the correction above.)*
`vi.mock` factories **re-run** when the registry is reset. If the fake Redis lives *inside* the
factory, each module context gets a fresh empty store and even a correct implementation fails.
The store must be hoisted outside:

```ts
// Recommended shape. vi.hoisted has 10+ in-repo precedents
// (e.g. src/app/api/benchmark/btc/route.test.ts, src/app/auth/callback/route.test.ts).
const shared = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return { store };
});

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: () => ({
      get: async (k: string) => { /* read shared.store, honour expiresAt */ },
      set: async (k, v, o) => { /* honour {ex, nx} */ },
      ttl: async (k: string) => { /* seconds remaining, -2 if absent */ },
    }),
  },
}));
```

Then: import context A → drive N failures → **`vi.resetModules()`** → import context B →
assert B short-circuits **without calling `fetch`**. The `expect(fetchMock).not.toHaveBeenCalled()`
assertion is the one that actually proves "without touching Railway" (SC-2's wording).

**Negative control (strongly recommended):** the same test with the fake store swapped for a
per-factory (non-hoisted) store must FAIL. Without it, the test cannot distinguish "shared
store works" from "the test never really created a second context." This is the repo's
`feedback_economic_invariant_oracles_not_self_referential` discipline applied to a
non-money invariant.

### 10.3 ⚠️ Known hazard: leaked `vi.stubGlobal("fetch")` → CI-only failures

Documented repo lesson: CI runs **Node 22**, local runs **Node 25**, and a leaked
`vi.stubGlobal("fetch")` produces CI-only vitest failures that are *not* flakes. The fix is
`vi.unstubAllGlobals()` in `afterEach`. The helper `src/test/helpers/fetch.ts`
(`installFetchMock` / `restoreFetchMock`) exists for exactly this and its docstring
(H-0404/M-0470) documents the missing-restore hazard.

**Note the seam's two existing test files use neither helper:**
- `analytics-client.test.ts` → `vi.spyOn(globalThis, "fetch")` + `vi.restoreAllMocks()` in `afterEach`
- `process-key-client.test.ts` → direct `global.fetch = fetchMock`, restored from a captured `realFetch`

**Recommendation:** new tests use `installFetchMock()` / `restoreFetchMock()` **and** an
explicit `afterEach(() => vi.unstubAllGlobals())`. Do not mix styles within a file. Reproduce
any suspected CI-only failure locally with `PATH=/opt/homebrew/opt/node@22/bin` before
calling it a flake.

### 10.4 ⚠️ The 16 route tests that `vi.mock` the seam clients

`grep -rn 'vi.mock("@/lib/process-key-client"\|vi.mock("@/lib/analytics-client"' src tests`
returns **16 unique files** (9 mocking `analytics-client`, 8 mocking `process-key-client`, 1 both — 9+8−1=16; an earlier draft mis-summed this as 18).
Every one replaces the module wholesale.

**Two consequences the planner must design around:**

1. **The breaker is invisible to all 16.** They will keep passing unchanged — good for blast
   radius, but it means **none of them prove SC-1 or SC-5 end-to-end**. The new SC-1/SC-5
   tests must exercise the **real** client with only `fetch` faked, at the route level, for at
   least one route per mechanism (`admin/match/*` for A, `keys/sync` for B, per SC-1's
   explicit wording).
2. **Adapting the clients must not change their public signatures or exported error classes.**
   Those 16 mocks assert against `validateKey`/`encryptKey`/`postProcessKey` shapes and several
   re-export `AnalyticsUpstreamError`/`AnalyticsTimeoutError` (`bridge/route.test.ts:115` and
   `simulator/route.test.ts:97` use `vi.mock(..., async () => {...})` with `importActual`
   specifically to keep the real error classes). **`CircuitOpenError` should be exported from
   `resilient-fetch.ts` and RE-EXPORTED from `analytics-client.ts`**, so those partial mocks
   pick it up without edits.

---

## 11. Common Pitfalls

### Pitfall 1: Hardening only the two named chokepoints
**What goes wrong:** `/internal/keys/{id}/permissions` (2 call sites, 15s each) keeps hitting
a dying Railway while the breaker is open; SC-1's promise ("a hung or dying Railway fails
fast") is false for the wizard's finalize gate, which **fails CLOSED** on a probe failure.
**Why it happens:** the milestone brief and the requirements both say "both chokepoints"; a
`grep` for the *client module names* finds only two. The third seam is only visible via
`grep ANALYTICS_SERVICE_URL`.
**How to avoid:** run the env-var grep, not just the module grep. Put every hit in the budget
table with an explicit in/out disposition.
**Warning signs:** a budget table with fewer than 11 rows (9 A-routes + 2 C-sites), or one with
no "excluded, reason" rows.

### Pitfall 2: A `CIRCUIT_OPEN` error that reaches `classifyKeyValidationError` as a string
**What goes wrong:** the wizard shows "Something went wrong — the team has been notified"
(the `UNKNOWN`/500 terminal branch, `wizardErrors.ts:960`) instead of "Service temporarily
unavailable, retry in Ns."
**Why it happens:** the classifier takes `message: string` and does ~12 `lower.includes(...)`
checks. A breaker error is a *new* error type nobody added a branch for.
**How to avoid:** branch on the error **type** before the substring cascade; change the
signature to accept the error. Do NOT pick a message string that happens to match an existing
substring — the classifier's own comment (`:919-926`) documents the collision-invariant
fragility of that approach.
**Warning signs:** a diff that adds a `lower.includes("circuit")` branch.

### Pitfall 3: Counting HTTP 4xx as breaker failures
**What goes wrong:** users entering wrong API keys (a 400 from the exchange, mapped to
`KEY_AUTH_FAILED`) trip the breaker and take key-connect down for everyone. A user error
becomes an outage.
**Why it happens:** the naive `if (!res.ok) recordFailure()`.
**How to avoid:** count timeouts, network throws, and 5xx only. Add a regression test:
N consecutive 400s must NOT trip; N consecutive 503s must.
**Warning signs:** the failure-recording call sits inside `analytics-client.ts`'s `if (!res.ok)`
block (`:107`) rather than in a status-classified branch.

### Pitfall 4: The breaker's own store outage becomes the outage
**What goes wrong:** Upstash blips → breaker check throws → seam calls fail → total outage,
caused entirely by the safety mechanism.
**Why it happens:** copying `ratelimit.ts`'s fail-CLOSED-in-prod matrix without noticing the
inversion. SEAM-03 calls this out for the *error* case; **the `redis === null` case is the
one that gets missed** (§7.3), and it is the case CI exercises on every run.
**How to avoid:** every path out of the breaker check — throw, null client, malformed value —
returns "closed, proceed." Wrap the whole check in `try/catch` returning `false`. Test all
three.
**Warning signs:** any `throw` inside the breaker-check function; any `isProduction()` branch
inside it.

### Pitfall 5: A budget test that passes because it re-reads the implementation
**What goes wrong:** the test imports `SEAM_BUDGETS`, and asserts each entry against… itself.
Green forever, catches nothing.
**Why it happens:** the invariant's two sides (`timeoutMs` and `maxDuration`) live in
different places, and it is easier to put both in the table.
**How to avoid:** `timeoutMs` from the table; `maxDuration` **read from the route file on
disk**. The test must fail if a route's `maxDuration` export is removed or edited. That is the
whole point of the CI invariant.
**Warning signs:** the test file has no `readFileSync`.

### Pitfall 6: Breaker state that does not actually cross module contexts in the test
**What goes wrong:** SC-2's test passes against an in-memory breaker because the fake store
was recreated inside the `vi.mock` factory, which re-ran on `resetModules`.
**How to avoid:** `vi.hoisted()` for the store (§10.2) **and** a negative control proving the
test fails without a shared store.
**Warning signs:** no `vi.hoisted` in the SC-2 test; no `expect(fetchMock).not.toHaveBeenCalled()`.

### Pitfall 7: Tightening the synchronous `/process-key` budget on comment evidence
**What goes wrong:** `teaser` runs the full 5-method pipeline inline; the only evidence that
"~10-25s typical" is a code comment (`process-key-client.ts:106`). Re-deriving 60s → 30s on
that basis converts slow-but-succeeding landing-page teasers into 504s — on the public,
unauthenticated, lead-generating path.
**How to avoid:** keep 60s for `flow_type ∈ {teaser, csv}` in this phase; tighten only
`{resync, onboard}` (enqueue-only, nothing observes them — §6.4). Record the un-measured
latency as an explicit Open Question rather than a silent assumption.
**Warning signs:** a budget table where `verify-strategy` drops below 60s with no cited latency data.

### Pitfall 8: Assuming `maxDuration` is 300 without pinning it
**What goes wrong:** a Vercel dashboard "Default Max Duration" change silently invalidates
every budget headroom calculation, with zero CI signal.
**How to avoid:** export `maxDuration` explicitly on all nine seam routes; make the CI test
fail on a missing or mismatched export (§6.3).
**Warning signs:** the invariant test hardcodes `300` as a fallback for un-annotated routes.

---

## 12. Anti-Patterns to Avoid

- **Module-level `let breakerState`** — the entire point of SEAM-03. `debug-key-flow/rate-limit.ts`
  is the in-repo example of this pattern *with an honest limitations block*; the breaker gets
  no such exemption.
- **A second Upstash database** — same physical store, distinct key prefix.
- **A "v2" of `ratelimit.ts`** — reuse, never fork. (Same instruction the RATE phase gets.)
- **Global middleware for the breaker** — Next 16 middleware/proxy runs before routing and
  cannot know the call-site budget. The core is per-call, in the Node runtime.
- **Changing the public signatures of `validateKey`/`encryptKey`/`postProcessKey`** — 16 test
  files mock them (§10.4).
- **Adding an explicit half-open state machine** — TTL expiry is the transition (locked).
- **`AbortSignal.timeout` inside route files** — after this phase, the only legal home is the core.

---

## 13. Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Failure counting over a time window | `INCR` + manual window arithmetic | `Ratelimit.slidingWindow` (already installed, prod-proven) | Locked decision; also yields `reset` for `Retry-After`. |
| Open-state lock with expiry | `SET` + a separate `EXPIRE` + a stored timestamp | `redis.set(k, v, { ex, nx })` | One round-trip, atomic, idempotent under concurrent trips. [VERIFIED: typings] |
| Half-open probe scheduler | A background job / cron / probe queue | TTL expiry | Zero moving parts; nothing to schedule, nothing to leak. |
| `Retry-After` parsing on any client | `Number(res.headers.get("Retry-After"))` | `parseRetryAfterSeconds` from `src/lib/retry/` | Already the ONE parser, already lint-enforced by `no-raw-retry-after-parse`. |
| Deny-response construction | Hand-rolled `NextResponse.json({error}, {status:503, headers})` | `rateLimitDenyJson` shape (`ratelimit.ts:263`) as the template | Canonical status/header pairing already exists; match it so ops tooling sees one shape. |
| A generic circuit-breaker abstraction | `cockatiel` / `opossum` | ~50 lines on `@upstash/*` | Both are in-memory-only and still need the Redis adapter you must write regardless. Explicitly forbidden by the Out of Scope table. |
| An in-memory fallback when Upstash is absent | A `Map`-backed "best-effort" breaker | Nothing — fail OPEN, log loudly | A per-instance breaker gives false confidence (Pitfall 3 in milestone research). If deliberately chosen it must be *documented* as best-effort — better to have none. |

**Key insight:** every primitive this phase needs already exists in the repo. The genuinely new
code is the ~50-line breaker, the budget table, and the CI invariant. Everything else is
adaptation and error-mapping retrofits across 9 route handlers.

---

## 14. Recommended Structure & Code Sketches

```
src/lib/
├── resilient-fetch.ts        # NEW — core: SEAM_BUDGETS, resilientFetch(), CircuitOpenError, breaker
├── resilient-fetch.test.ts   # NEW — breaker semantics, fail-OPEN×3, two-module-context (SC-2/SC-3)
├── seam-budgets.invariant.test.ts  # NEW — reads route files from disk (SC-4)
├── analytics-client.ts       # MODIFIED — analyticsRequest() delegates; re-exports CircuitOpenError
├── process-key-client.ts     # MODIFIED — postProcessKey() delegates; + CIRCUIT_OPEN envelope arm
├── ratelimit.ts              # UNCHANGED — pattern reference only
└── wizardErrors.ts           # MODIFIED — new code + copy; type-checked branch before substrings

src/app/api/…                 # MODIFIED — 9 route handlers: maxDuration export + CIRCUIT_OPEN arm
                              #   (+2 more if the permissions seam is routed through the core)

tools/eslint-plugin-quantalyze/rules/
└── no-raw-analytics-fetch.mjs  # NEW (recommended, optional) — structural SEAM-01 enforcement
```

### Pattern: the breaker check (fail-OPEN on every failure mode)

```ts
// Every exit path returns a boolean. Nothing throws. See §7.3 for the null case.
async function isBreakerOpen(): Promise<{ open: boolean; retryAfterS?: number }> {
  if (!redis) return { open: false };            // unconfigured — fail OPEN in ALL envs
  try {
    const v = await redis.get<string>(BREAKER_KEY);
    if (v !== "open") return { open: false };
    const ttl = await redis.ttl(BREAKER_KEY);
    return { open: true, retryAfterS: ttl > 0 ? ttl : DEFAULT_RETRY_AFTER_S };
  } catch (err) {
    console.error("[resilient-fetch] breaker check failed — failing OPEN:", err);
    return { open: false };                       // Redis errored — fail OPEN
  }
}
```

### Pattern: simulating a timeout in tests (existing repo convention)

```ts
// Source: src/lib/analytics-client.test.ts:385-398 (verbatim shape, currently passing)
const timeoutErr = new DOMException("aborted", "TimeoutError");
const fetchMock = vi.fn().mockRejectedValue(timeoutErr);
```

### Pattern: two-module-context breaker assertion (SC-2)

```ts
const shared = vi.hoisted(() => ({ store: new Map<string, {v: string; exp: number}>() }));
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => fakeRedis(shared.store) } }));

// context A: drive N failures until the breaker trips
const a = await import("@/lib/resilient-fetch");
/* … N failing calls … */

vi.resetModules();                       // simulate a second Fluid Compute instance

const fetchMock = installFetchMock();
const b = await import("@/lib/resilient-fetch");
await expect(b.resilientFetch(/* … */)).rejects.toBeInstanceOf(b.CircuitOpenError);
expect(fetchMock).not.toHaveBeenCalled();  // ← the assertion that proves "without touching Railway"
```

---

## 15. State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vercel KV as the Next.js edge KV store | **Discontinued**; Upstash Redis directly | pre-2026-02 | Confirms Upstash is the right (and only) store here; do not look for a Vercel-native option. [CITED: milestone SUMMARY.md, Vercel plugin knowledge-update 2026-02-27] |
| One-request-per-Lambda | **Fluid Compute**, instance reuse + optimized concurrency, default on | current | Module state lives *longer* but is still **not shared**. Makes an in-memory breaker look more correct in a smoke test while remaining wrong. [CITED: https://vercel.com/docs/functions/configuring-functions/duration §"Consequences of changing the maximum duration"] |
| Pro default `maxDuration` 15s / max 300s (pre-Fluid) | **Default 300s / max 800s (Pro), extended 1800s beta** | current docs, last_updated 2026-07-01 | The headroom for every seam budget is far larger than any proposed timeout — the binding constraint is *user patience and lambda cost*, not the platform ceiling. [CITED: same doc, §"Duration limits"] |

**Deprecated / dormant in-repo:**
- `PROCESS_KEY_UNIFIED_BACKBONE` / `USE_COMPUTE_JOBS_QUEUE` — retired / permanently on
  (`docs/runbooks/compute-queue.md`). Do not add flag branches for them.
- `_unifiedValidateAndEncryptHandler` (`keys/validate-and-encrypt/route.ts:144`) — dead,
  zero callers, **no timeout**. Do not revive without routing through the core.
- `computePortfolioAnalytics` (`analytics-client.ts:224`) — zero callers.

---

## 16. Validation Architecture

`workflow.nyquist_validation: true` in `.planning/config.json` → this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **vitest 4.1.10** (+ `@vitejs/plugin-react`, `jsdom` env, `@vitest/coverage-v8` 4.1.10) |
| Config file | `vitest.config.ts` (root); `scripts/vitest.config.ts` for `scripts/**` (NOT in the default run) |
| Setup file | `src/test-setup.ts` |
| Quick run command | `npx vitest run src/lib/resilient-fetch.test.ts --no-file-parallelism` |
| Full suite command | `npm test` (= `vitest run`); coverage gate: `npm run test:coverage` |
| Lint gate | `npm run lint` (eslint over `src/` + `check-admin-route-manifest` + `check-route-contract`) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |

Notes: root `include` covers `src/**/*.test.{ts,tsx}`, `tests/{a11y,visual,lib,integration}/**`,
and `tools/eslint-plugin-quantalyze/tests/**`. Coverage thresholds are a ratchet
(lines 82 / statements 80 / functions 74 / branches 72) enforced by the merged-shard
`frontend-coverage` CI job. `maxWorkers = cpus-1`; use `--no-file-parallelism` for local
flake isolation.

### Success Criteria → Test Map

| SC | Behavior | Test type | Automated command | File exists? |
|----|----------|-----------|-------------------|--------------|
| **SC-1a** | Railway hangs → `keys/sync` (via `postProcessKey`) returns the typed 504/`UPSTREAM_TIMEOUT` envelope, does not hold the lambda | route integration, real client + faked `fetch` rejecting `DOMException("TimeoutError")` | `npx vitest run src/app/api/keys/sync/route.seam.test.ts` | ❌ **Wave 0** |
| **SC-1b** | Same for `admin/match/recompute` (via `analyticsRequest`) | route integration, real client | `npx vitest run src/app/api/admin/match/recompute/route.seam.test.ts` | ❌ **Wave 0** |
| **SC-1c** | Both clients demonstrably call ONE core (`resilientFetch` invoked from both) | unit + spy | `npx vitest run src/lib/resilient-fetch.wiring.test.ts` | ❌ **Wave 0** |
| **SC-2** | After N failures, a call from a `vi.resetModules()` context short-circuits with `CIRCUIT_OPEN` **and never calls `fetch`** | unit, two module contexts, `vi.hoisted` shared fake store | `npx vitest run src/lib/resilient-fetch.test.ts -t "cross-context"` | ❌ **Wave 0** |
| **SC-2-neg** | **Negative control:** same test with a per-factory (non-shared) store MUST fail | unit | same file, `-t "negative control"` | ❌ **Wave 0** |
| **SC-3a** | `redis.get` throws → seam still attempts the real request | unit | `… -t "fails OPEN when Redis errors"` | ❌ **Wave 0** |
| **SC-3b** | `redis === null` (Upstash unconfigured) → attempts the real request, in prod too | unit, `VERCEL_ENV=production` | `… -t "fails OPEN when Upstash is unconfigured"` | ❌ **Wave 0** |
| **SC-3c** | 4xx does NOT trip the breaker; 5xx/timeouts DO | unit | `… -t "failure classification"` | ❌ **Wave 0** |
| **SC-4a** | Every seam route file exports `maxDuration` matching `SEAM_BUDGETS` | source-scan invariant (`readFileSync`) | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ❌ **Wave 0** |
| **SC-4b** | `timeoutMs × callsPerRequest × (1 + retries) < maxDuration × 1000` for every entry | pure data assertion over the exported table | same file | ❌ **Wave 0** |
| **SC-4c** | The table's `timeoutMs` actually reaches `AbortSignal.timeout` | unit, `vi.spyOn(AbortSignal,"timeout")` | `npx vitest run src/lib/resilient-fetch.test.ts -t "budget reaches AbortSignal"` | ❌ **Wave 0** |
| **SC-5a** | Class-1 routes (`admin/match/{eval,recompute}`) return typed 503 on `CIRCUIT_OPEN`, never echo `err.message` | route unit (existing files, extend) | `npx vitest run src/app/api/admin/match/eval/route.test.ts src/app/api/admin/match/recompute/route.test.ts` | ✅ extend |
| **SC-5b** | Class-2 (`create-with-key`, `composite/add-key`): `CircuitOpenError` → 503 + a real wizard code, **never** `UNKNOWN`/500 | unit on `classifyKeyValidationError` + route | `npx vitest run src/lib/wizardErrors.test.ts src/app/api/strategies/create-with-key/route.test.ts` | ✅ extend (verify `wizardErrors.test.ts` exists) |
| **SC-5c** | Class-3 (5 routes): `CIRCUIT_OPEN` → 503 + `Retry-After`, not the generic 500 | route unit (existing files, extend) | `npx vitest run src/app/api/bridge/route.test.ts src/app/api/simulator/route.test.ts src/app/api/portfolio-optimizer/route.test.ts src/app/api/scenario/optimize/route.test.ts src/app/api/keys/validate-and-encrypt/route.test.ts` | ✅ extend |
| **SC-5d** | `postProcessKey` returns the `CIRCUIT_OPEN` envelope; all 5 callers pass it through unchanged | unit | `npx vitest run src/lib/process-key-client.test.ts` | ✅ extend |
| **Regression** | Timeout mapping is unchanged for both clients (`AbortError` **and** `TimeoutError`) | unit | `npx vitest run src/lib/analytics-client.test.ts src/lib/process-key-client.test.ts` | ✅ exists |
| **Regression** | ESLint rule flags a raw `ANALYTICS_URL` fetch outside the allowlist *(if adopted)* | RuleTester | `npx vitest run tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts` | ❌ Wave 0 (optional) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/resilient-fetch.test.ts src/lib/seam-budgets.invariant.test.ts --no-file-parallelism` (<10s)
- **Per wave merge:** `npm test` + `npm run typecheck` + `npm run lint`
- **Phase gate:** full suite green **with coverage** (`npm run test:coverage`, thresholds are a
  blocking CI gate) before `/gsd:verify-work`. `npm run build` must also pass — `maxDuration`
  exports are route-segment config and a malformed one is a build error, not a test error.

### Wave 0 Gaps

- [ ] `src/lib/resilient-fetch.test.ts` — SC-2, SC-2-neg, SC-3a/b/c, SC-4c
- [ ] `src/lib/seam-budgets.invariant.test.ts` — SC-4a, SC-4b (source-scan; copy the "CEILING"
      honesty comment convention from `src/app/scenario-share/[token]/page-server-boundary.test.ts`)
- [ ] `src/lib/resilient-fetch.wiring.test.ts` — SC-1c (both clients invoke the core)
- [ ] `src/app/api/keys/sync/route.seam.test.ts` — SC-1a (must NOT `vi.mock("@/lib/process-key-client")`)
- [ ] `src/app/api/admin/match/recompute/route.seam.test.ts` — SC-1b (must NOT `vi.mock("@/lib/analytics-client")`)
- [ ] Verify `src/lib/wizardErrors.test.ts` exists; if not, create for SC-5b
- [ ] *(optional)* `tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts`
- [ ] Framework install: **none needed**

---

## 17. Security Domain

`security_enforcement` is not set in `.planning/config.json` → treated as **enabled**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control in this phase |
|---------------|---------|-------------------------------|
| V2 Authentication | no (unchanged) | Every seam route keeps its existing `withAuth` / `isAdminUser` / `CRON_SECRET` gate. The core must sit **after** auth in every handler — do not hoist a breaker check above an auth check (an unauthenticated caller must not be able to probe breaker state). |
| V3 Session Management | no | Untouched. |
| V4 Access Control | no | Untouched. `X-Service-Key` / `Bearer INTERNAL_API_TOKEN` / `X-User-Access-Token` forwarding must be preserved byte-for-byte through the core — `process-key-client.ts:112-125` and `analytics-client.ts:83-88`. A dropped `X-User-Id` re-opens the CT-4 cross-tenant rate-limit-bucket defect. |
| V5 Input Validation | yes (indirect) | No new user input. The breaker key is a **constant**, never user-derived — a user-influenced breaker key would be a trivial cross-tenant DoS. Assert this in review. |
| V6 Cryptography | no | No crypto. `validateKey`/`encryptKey` payloads pass through the core unchanged; the core must never log request bodies (they carry raw API secrets). |
| V7 Error Handling & Logging | **yes — the core of SC-5** | Static, non-leaking client-facing copy; detail server-side only. Precedents: `bridge:142-145` (H-1062), `portfolio-optimizer:144-147` (M-0333), `create-with-key:439-441` (H-0305). `finalize-wizard`'s `scrubInternalToken` (`:105-118`) is the template for any log line that could contain a credential. |
| V9 Communications | no | HTTPS to Railway unchanged. |

### Known Threat Patterns

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| Breaker error message leaks internal URLs (`http://localhost:8002/...`), Python tracebacks, or header names to an authed browser | Information Disclosure | Static human copy in the 503; raw detail to `console.error` + Sentry only. **This is the pre-existing defect in `admin/match/{eval,recompute}`** (both echo `err.message` at 500) that SC-5 must close. |
| Credentials in a core log line | Information Disclosure | Never log request bodies. Reuse `scrubInternalToken` for anything that could embed `INTERNAL_API_TOKEN`. |
| User-influenced breaker key → one tenant trips the breaker for all | Denial of Service | Breaker key is a module constant (`breaker:railway`). Never interpolate user input. |
| 4xx counted as failures → user error becomes an outage | Denial of Service | Count timeouts / network / 5xx only (§7.2, Pitfall 3). |
| Breaker check before the auth gate → unauthenticated breaker-state oracle | Information Disclosure | Core is invoked from inside the handler body, after `withAuth`. |
| Broken breaker store causes the outage | Denial of Service | Fail OPEN on error **and** on null client, in all environments (§7.3). |
| `Retry-After` reveals precise cooldown | Information Disclosure (negligible) | Accepted — it is the same information `rateLimitDenyJson` already publishes, and it is operationally necessary. |

---

## 18. Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js (local) | dev/test | ✓ | v25.8.1 | — |
| Node.js (CI parity) | reproducing CI-only failures | ✓ | v22.22.1 at `/opt/homebrew/opt/node@22/bin` | — |
| `vitest` | all SCs | ✓ | 4.1.10 | — |
| `@upstash/redis` | SEAM-03 | ✓ | 1.38.0 | — |
| `@upstash/ratelimit` | SEAM-03 | ✓ | 2.0.8 | — |
| **Live Upstash instance** | end-to-end breaker proof | ✗ (env vars unset locally and in CI; 20+ tests delete them) | — | ✅ **Faked Redis via `vi.mock` + `vi.hoisted` shared store** — this is the *correct* test double for SC-2 anyway (a real Upstash cannot prove cross-module-context sharing deterministically) |
| Railway analytics service | manual smoke | ✗ locally (`ANALYTICS_SERVICE_URL` unset → `http://localhost:8002`) | — | ✅ Faked `fetch`; the repo's existing convention for all 16 seam route tests |
| `tsx` | `scripts/check-*` gates | ✓ (devDep, used by `npm run lint`) | — | — |

**Missing dependencies with no fallback:** none — this phase is code + tests only.
**Missing with fallback:** Upstash and Railway, both covered by test doubles that are the
preferred approach regardless.

---

## 19. Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | The Vercel project's effective default `maxDuration` is **300s** (Pro + Fluid). Platform default is documented; a **dashboard override cannot be read from the repo**. | §6.2 | MEDIUM. If the dashboard sets a lower default (e.g. 60s), the three routes making **two** sequential 30s calls (60s worst case) already have zero headroom today. **The §6.3 recommendation — export `maxDuration` explicitly on all nine routes — eliminates this risk entirely and is the reason it is the primary recommendation.** |
| A2 | `flow_type: teaser` synchronous runs are "~10-25s typical". Sourced from a **code comment** (`process-key-client.ts:106`), not measurement. | §4.3, §6.4 | MEDIUM. Tightening the 60s budget on this basis could 504 the public landing-page teaser. Mitigated by Pitfall 7's recommendation to leave `{teaser, csv}` at 60s in this phase. |
| A3 | `_unifiedValidateAndEncryptHandler` is genuinely dead. Verified by grep across `src/`; not verified against dynamic dispatch (there is none in this codebase, but the grep is the whole evidence). | §4.1 | LOW. Worst case a dormant, timeout-less path stays dormant. |
| A4 | Counting only 5xx/timeout/network (not 4xx) is correct for this backend. Reasoned from `classifyKeyValidationError`'s 400-is-a-client-fault semantics; **no operator has stated a preference**. | §7.2 | MEDIUM. If Railway returns 4xx during genuine degradation the breaker would under-trip. Recommend confirming with the founder or accepting the 4xx-exclusion as a documented decision in the plan. |
| A5 | Breaker tuning constants (N failures, window, cooldown) are unset by any upstream artifact. | Discretion | MEDIUM. Too sensitive → false trips on normal load; too dull → no protection. Suggest a starting point of **5 failures / 30s → 30s cooldown**, exported as named constants with rationale comments (the `ratelimit.ts` convention) so tuning is a one-line change. **This is a genuine open decision, not a verified recommendation.** |
| A6 | Routing the third seam (`/internal/keys/{id}/permissions`) through the core is in scope. | §4.4 | LOW-MEDIUM. Adds ~2 files of scope. If deferred, SEAM-02's "every seam call site" is only satisfiable with an explicit written exclusion. |
| A7 | Node 22/25 `AbortSignal.timeout` writability implies vitest `spyOn` works. Descriptor verified on both; the `vi.spyOn` call itself was **not** executed. | §8 | LOW. If it fails, fall back to technique (2) — injecting the budget through the core's own API — which needs no spy. |

---

## 20. Open Questions (RESOLVED)

> **RESOLUTION (plan revision, 2026-07-25):** all six questions were decided by operator
> decision and are implemented in the Phase 140 plan set — do not re-litigate:
> 1. Breaker tuning → **5 failures / "30 s" window / 30s cooldown**, named exported constants
>    with rationale comments (140-01 Task 1).
> 2. Sync budget → tighten **only** `{resync, onboard}` → 15s; `{teaser, csv}` stay 60s with
>    a "MEASURE BEFORE TIGHTENING" note in SEAM_BUDGETS (140-01).
> 3. Third seam → **IN SCOPE**, routed through the core (140-06 Task 1).
> 4. `no-raw-analytics-fetch` ESLint rule → **ADOPTED**, init-tracking variant + RuleTester
>    (140-07 Task 2).
> 5. `computePortfolioAnalytics` → **NOT deleted**; the dormant `_unifiedValidateAndEncryptHandler`
>    fetch is routed through the core (140-05 Task 3).
> 6. `admin/match/{eval,recompute}` `err.message` leak → **FIXED in this phase** (140-03).
> Additionally: **A4 (4xx never trips the breaker) is ACCEPTED** as a documented decision with
> in-code rationale (140-01 Task 3).


1. **What are the breaker's tuning constants?**
   - *Known:* mechanism, key, store, fail-open policy — all locked.
   - *Unclear:* failure threshold N, counting window, cooldown TTL. No upstream artifact states them.
   - *Recommendation:* start at 5 failures / 30s window / 30s cooldown, as **named exported
     constants with rationale comments** (the `ratelimit.ts:94-214` convention). Make them
     trivially tunable; do not hide them in the function body.

2. **Should the synchronous `/process-key` budget be re-derived downward?**
   - *Known:* 60s today; `{teaser, csv}` run the full pipeline inline (verified in
     `process_key.py:446-452`); `{resync, onboard}` merely enqueue.
   - *Unclear:* real p95/p99 latency for teaser and csv. The only evidence is a code comment.
   - *Recommendation:* tighten **only** `{resync, onboard}` (→ ~15s) in this phase; keep
     `{teaser, csv}` at 60s and record "measure before tightening" as a note in the budget
     table. Never guess a budget on the public lead-generating path.

3. **Is the third seam in or out?** (§4.4)
   - *Recommendation:* **in** — two duplicated 15s constants against the same backend is
     exactly what SEAM-02 exists to eliminate, and leaving it out means the breaker is open
     while two live paths still hammer Railway. If the planner sizes it out, the exclusion
     must be a written row in the table.

4. **Adopt the `no-raw-analytics-fetch` ESLint rule?**
   - *Recommendation:* **yes.** ~60 lines + RuleTester fixtures, following
     `no-raw-retry-after-parse.mjs`. It is the only mechanism that keeps SEAM-01 true after
     merge — and the third seam's existence is direct evidence that convention alone failed.

5. **Delete the dead `computePortfolioAnalytics` export?** (§4.2)
   - *Recommendation:* **no** — leave it, note "zero callers" in Phase 141's audit artifact.
     Deleting is scope creep; the planner should not spend a review cycle on it.

6. **Should `admin/match/{eval,recompute}`'s pre-existing `err.message` leak be fixed here?**
   - It is not literally in SEAM-04's wording, but SC-5 says "no raw error escapes as a
     cascade-500" and these two are the only routes that do exactly that.
   - *Recommendation:* **yes, fix in this phase.** The retrofit touches the same `catch` block;
     fixing the leak is a two-line change and closes a real information-disclosure gap that
     `bridge` (H-1062) and `portfolio-optimizer` (M-0333) already closed elsewhere.

---

## 21. Sources

### Primary (HIGH confidence — direct reads of this repo at 2026-07-25)

- `src/lib/analytics-client.ts` (341 lines, read in full), `src/lib/process-key-client.ts` (189, full), `src/lib/ratelimit.ts` (424, full)
- `src/lib/wizardErrors.ts:890-961` (`classifyKeyValidationError`), `src/lib/retry/index.ts`, `src/lib/warmup-analytics.ts`, `src/app/api/debug-key-flow/rate-limit.ts`
- All 9 Mechanism-A route handlers + all 5 Mechanism-B route handlers (error-handling regions read directly)
- `src/app/api/keys/[id]/permissions/route.ts:31-116`, `src/app/api/strategies/finalize-wizard/route.ts:50-99`, `src/app/api/cron/warm-analytics/route.ts:30-80`, `src/app/api/debug-key-flow/route.ts:15-30,122-181`
- `analytics-service/routers/process_key.py:1-40, 440-460` (`_is_long_fetch`, sync-vs-queued contract); `analytics-service/services/job_worker.py:416,731` (existing DB-backed breaker)
- `src/lib/analytics-client.test.ts:1-70, 375-398`, `src/lib/process-key-client.test.ts` (87, full), `src/lib/ratelimit.test.ts:1-90`, `src/test/helpers/fetch.ts`, `src/app/scenario-share/[token]/page-server-boundary.test.ts:1-45`
- `vitest.config.ts`, `scripts/vitest.config.ts`, `package.json` scripts, `.github/workflows/ci.yml` (run steps), `next.config.ts`, `vercel.json`
- `node_modules/@upstash/redis/error-8y4qG0W2.d.mts:2106-2153, 3043-3516, 4229-4249`; `node_modules/@upstash/ratelimit/dist/index.d.mts:37-80`; installed versions from both `package.json`s
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`; `node_modules/next/package.json` → **16.2.11**
- Runtime probes: `AbortSignal.timeout` property descriptor on Node v25.8.1 and v22.22.1
- Greps: `grep -rln 'analytics-client|process-key-client' src`; `grep -rn "ANALYTICS_SERVICE_URL" src`; `grep -rn "maxDuration" src`; `grep -rn 'vi.mock("@/lib/(analytics|process-key)-client"' src tests`; `grep -rln "resetModules|unstubAllGlobals|vi.hoisted|UPSTASH_REDIS_REST" src`
- `.planning/ROADMAP.md` (Phase 140 block), `.planning/REQUIREMENTS.md` (SEAM-01..04 + Out of Scope), `.planning/STATE.md`, `.planning/research/{SUMMARY,PITFALLS}.md`, `.planning/config.json`

### Secondary (MEDIUM confidence)

- [Vercel — Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration) (official, last_updated 2026-07-01) — duration defaults/maxima per plan with Fluid; dashboard-override mechanism
- Railway public-networking ~5 min request ceiling — via `.planning/research/SUMMARY.md` citing https://docs.railway.com/networking/public-networking/specs-and-limits (not independently re-fetched)
- `docs/architecture/adr-0014-secret-handling.md` (Upstash env provisioning), `docs/runbooks/compute-queue.md` (retired flags, via SUMMARY.md)

### Tertiary (LOW confidence)

- `cockatiel` / `opossum` "in-memory only" — inherited from milestone research (web search). Supports a **don't-use** decision only, which is already locked by the Out of Scope table.

---

## 22. Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Call-site inventory (§4) | **HIGH** | Every site read at file:line via two independent greps (module names AND env-var). The third-seam finding came from the grep milestone research did not run. |
| Cascade-500 escape surface (§5) | **HIGH** | All 14 route handlers' `catch` blocks read directly; the three classes are structural, not inferred. |
| `maxDuration` situation (§6) | **HIGH** on what the repo declares (grep is exhaustive); **MEDIUM** on the effective platform default (A1 — dashboard unreadable). The recommendation neutralizes the MEDIUM. |
| Upstash API surface (§7) | **HIGH** | Read from installed typings, not docs or training data. |
| Test techniques (§8, §10) | **HIGH** | `AbortSignal.timeout` descriptor probed on both Node versions; the `resetModules` + dynamic-import pattern is already passing in `analytics-client.test.ts`. |
| Breaker tuning constants | **LOW** | A5 — no upstream artifact specifies them; the suggested values are judgment, flagged as an Open Question. |
| Failure-classification policy (4xx excluded) | **MEDIUM** | A4 — reasoned from in-repo semantics, not operator-confirmed. |

**Research date:** 2026-07-25
**Valid until:** ~2026-08-24 (30 days). Shorter if `main` moves: re-run
`grep -rn "ANALYTICS_SERVICE_URL" src` and `grep -rn "maxDuration" src` at plan kickoff —
the inventory is the perishable part.
