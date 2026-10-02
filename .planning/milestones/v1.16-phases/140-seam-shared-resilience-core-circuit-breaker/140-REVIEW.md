---
phase: 140-seam-shared-resilience-core-circuit-breaker
reviewed: 2026-07-25T19:20:00Z
depth: deep
files_reviewed: 24
files_reviewed_list:
  - src/lib/resilient-fetch.ts
  - src/lib/seam-errors.ts
  - src/lib/analytics-client.ts
  - src/lib/process-key-client.ts
  - src/lib/wizardErrors.ts
  - src/lib/seam-budgets.invariant.test.ts
  - src/test/helpers/upstash-breaker.ts
  - src/test-setup.ts
  - src/__tests__/critical-regressions.test.ts
  - src/__tests__/contracts/contracts-registry.test.ts
  - src/app/api/admin/match/eval/route.ts
  - src/app/api/admin/match/recompute/route.ts
  - src/app/api/bridge/route.ts
  - src/app/api/simulator/route.ts
  - src/app/api/portfolio-optimizer/route.ts
  - src/app/api/scenario/optimize/route.ts
  - src/app/api/keys/[id]/permissions/route.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/api/strategies/composite/add-key/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/verify-strategy/route.ts
  - eslint.config.mjs
  - tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs
findings:
  critical: 5
  warning: 7
  info: 7
  total: 19
status: issues_found
---

# Phase 140: Code Review Report — SEAM shared resilience core + circuit breaker

**Reviewed:** 2026-07-25
**Depth:** deep (cross-file: import graph, call chains across `src/app/api/**` → `src/lib/*-client.ts` → `src/lib/resilient-fetch.ts`, plus the Python `process_key.py` counterpart and the installed `@upstash/*` transports)
**Files Reviewed:** 24 source files (test files read for context, not reported unless they cause a false green)
**Status:** issues_found

## Summary

The phase does what it says structurally: one core, one budget table, one breaker key, typed 503 arms after every auth gate on the ten authenticated routes, and an ESLint mechanism instead of a convention. The header forwarding I was asked to verify is intact on the two live clients — `X-Service-Key` (`analytics-client.ts:124`), `Bearer INTERNAL_API_TOKEN` + `X-User-Id` + `X-User-Access-Token` (`process-key-client.ts:155-165`) and `X-Internal-Token` (`keys/[id]/permissions/route.ts:136`) all pass through byte-for-byte. The trip threshold arithmetic is correct against the real `slidingWindow` Lua script (the 5th failure yields `remaining === 0` with `success === true`, and `success && remaining > 0` correctly falls through to the trip). `nx: true` genuinely makes concurrent trips idempotent. The four locked design decisions in the prompt were not counted against the implementation.

What I found instead are five defects that make the phase's own central safety claims false in production:

1. **The SC-4b headroom invariant is arithmetically wrong on the one route that loops.** `finalize-wizard` issues N sequential `keys-permissions` seam calls for an N-member composite; the table declares `calls: 1`. The test that exists to catch exactly this passes vacuously.
2. **The breaker introduced a new unbounded external dependency in front of every seam call.** `Redis.fromEnv()` is constructed with the SDK defaults — 6 attempts, ~4.3s of backoff sleeps, and **no request signal at all** — and `isBreakerOpen()` runs *before* `AbortSignal.timeout` is created. A hung Upstash hangs the lambda, which is the precise failure SEAM-01 exists to abolish.
3. The `process-key-enqueue` budget was cut 60s → 15s on the live onboarding/resync path with zero latency measurement, against a service whose cold-start problem is documented in-repo.
4. One global breaker counts user-triggerable upstream 5xx from a **public unauthenticated** route, turning five bad requests into a 30s seam-wide outage for every tenant.
5. That same public route makes breaker state an unauthenticated oracle, contradicting T-140-12/T-140-20 and `140-VERIFICATION.md:57`.

The prose-to-code ratio in `resilient-fetch.ts` is high enough that several of these were argued for in comments and then not implemented that way; the comments are load-bearing evidence in a few findings below.

---

## Critical Issues

### CR-01: `SEAM_ROUTE_BUDGETS` under-declares finalize-wizard's seam calls by an unbounded factor — the SC-4b invariant is false and its test cannot fail

**File:** `src/lib/resilient-fetch.ts:308-314` and `src/app/api/strategies/finalize-wizard/route.ts:753-758`

**Issue:**
The table declares finalize-wizard's worst case as one `keys-permissions` probe plus one `process-key-enqueue`:

```ts
"src/app/api/strategies/finalize-wizard/route.ts": {
  expectedMaxDurationS: 300,
  budgets: [
    { key: "keys-permissions", calls: 1 },   // ← wrong
    { key: "process-key-enqueue", calls: 1 },
  ],
},
```

The composite branch of the route loops over every member and awaits a fresh probe **sequentially**:

```ts
for (const member of members ?? []) {
  const memberKeyId = typeof member.api_key_id === "string" ? member.api_key_id : null;
  if (!memberKeyId) continue;
  const probe = await runScopeBroadeningProbe(memberKeyId);   // → fetchLivePermissions → resilientFetch("keys-permissions", …)
  if (!probe.ok) return probe.response;
}
```

`runScopeBroadeningProbe` → `fetchLivePermissions` (route.ts:100-125) → `resilientFetch("keys-permissions", …)` at 15 000 ms each, and this path deliberately **bypasses both cache layers** (`?force_refresh=true`, and it is not wrapped in `unstable_cache`) — so every member costs a full round trip on every submit. I found no cap on `strategy_keys` membership anywhere in `closed-sets.ts` or the add-key route.

`seam-budgets.invariant.test.ts:132-136` computes `worstCaseMs` from `entry.budgets` — i.e. from the same wrong number — so SC-4b asserts `30 000 < 300 000` and is green forever. This is the exact "compares the table to itself" anti-pattern the file's own header (lines 14-28) says it was written to avoid; the disk read only rescues the `maxDuration` side, not the `calls` side.

**Concrete failure scenario:** a manager finalizes a 21-key composite (nothing forbids it; the founder's own Zavara book is a 3-key composite and multi-key is a headline feature). Railway is slow but not dead — each probe takes ~14s and does not trip the breaker. 21 × 14s = 294s, plus the members SELECT and the legacy finalize DB work → the Vercel function is killed at `maxDuration = 300`. The user gets a platform 504 with **no typed envelope, no `Retry-After`, no `code`** — precisely the outcome SC-4b claims to prevent — and the wizard's `SubmitStep` renders `UNKNOWN`. Worse, the probes that already ran did real credential decrypts on the Python side, so the request is partially executed with no record of where it stopped.

**Fix:**
```ts
// src/lib/resilient-fetch.ts — make the fan-out explicit and bounded.
"src/app/api/strategies/finalize-wizard/route.ts": {
  expectedMaxDurationS: 300,
  budgets: [
    // COMPOSITE FAN-OUT: one probe PER member (route.ts:753-758), cache-bypassing.
    // Must match the hard cap enforced at the loop.
    { key: "keys-permissions", calls: MAX_COMPOSITE_MEMBERS_PROBED },
    { key: "process-key-enqueue", calls: 1 },
  ],
},
```
and enforce the cap where the fan-out happens, so the table is a checked fact rather than a hope:
```ts
// src/app/api/strategies/finalize-wizard/route.ts
const members = (await …) ?? [];
if (members.length > MAX_COMPOSITE_MEMBERS_PROBED) {
  return NextResponse.json(
    { error: "This composite has too many keys to finalize in one request.",
      code: "COMPOSITE_TOO_MANY_MEMBERS" },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}
```
Separately, `seam-budgets.invariant.test.ts` needs a guard that the `calls` column is not decorative — e.g. an AST/regex scan asserting that a route whose `budgets` entry has `calls: 1` contains no `for`/`map`/`Promise.all` enclosing its seam call. Without that, this class of drift is undetectable by the very test written to detect it.

---

### CR-02: The breaker's own store is an unbounded, retrying dependency placed *in front of* every seam deadline — a slow Upstash hangs the lambda

**File:** `src/lib/resilient-fetch.ts:362-365`, `414-431`, `516-527`

**Issue:**
```ts
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()          // ← SDK defaults, no timeout, no retry override
    : null;
```
`@upstash/redis@1.38.0` (`chunk-2X4SLXT7.mjs:126-131, 142-193`) defaults to:
- `retry.attempts = 5` → the request loop runs `for (let i = 0; i <= 5; i++)`, i.e. **up to 6 fetch attempts**;
- `backoff = (i) => Math.exp(i) * 50` → sleeps of 50 + 136 + 369 + 1004 + 2729 ms ≈ **4.3s of pure `setTimeout`** between attempts;
- `signal: config.signal` — and nothing is passed here, so **each of the 6 attempts has no abort signal and no timeout**. Node's `fetch` will wait indefinitely on a stalled connection.

And the ordering in `resilientFetch` puts this ahead of the budget:

```ts
const breaker = await isBreakerOpen();     // ← unbounded, up to 2 round trips
if (breaker.open) { throw new CircuitOpenError(...); }
…
res = await fetch(`${ANALYTICS_URL}${path}`, {
  ...requestInit,
  signal: AbortSignal.timeout(timeoutMs),  // ← the deadline only starts HERE
});
```

The module docblock (lines 42-50, 405-413) claims *"EVERY exit path returns a value and nothing throws… Unconfigured store, a `get` that rejects, a malformed value: all resolve to `{ open: false }`."* That enumeration is a list of **rejections**. A slow or hanging store is not a rejection, so it is not covered, and the fail-open guarantee simply does not apply to the most likely Upstash degradation mode. `recordSeamFailure()` (:445-469) has the same exposure and is `await`ed *inside the catch arm* — i.e. exactly when Railway is already failing, which is precisely when a shared regional Upstash is most likely to be under load too (correlated failure).

**Concrete failure scenario:** Upstash has a regional incident and REST requests stall rather than reject. Every seam route now blocks on `isBreakerOpen()` before issuing anything. `/api/bridge`, `/api/simulator`, key-connect and the public teaser all hold Vercel concurrency slots until `maxDuration = 300` and return platform 504s with no envelope. A feature added to *prevent* Railway from holding lambda slots has made a second, unrelated service able to hold them — with no breaker of its own, and with the failure amplified by 6 retries. Note the seam budget table then also lies: a `bridge` request advertised at 15s can occupy 300s.

**Fix:** bound the breaker's own I/O and make the fail-open guarantee cover latency, not just rejection.
```ts
// src/lib/resilient-fetch.ts
/** The breaker must never cost more than this. It is a hint, not a dependency. */
export const BREAKER_STORE_TIMEOUT_MS = 250;

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      // One attempt. A breaker read that needs a retry is already too slow to be useful.
      retry: { retries: 1, backoff: () => 0 },
      signal: () => AbortSignal.timeout(BREAKER_STORE_TIMEOUT_MS),
    })
  : null;
```
and belt-and-braces at the call site, so a future SDK default change cannot re-open it:
```ts
export async function isBreakerOpen() {
  if (!redis) return { open: false };
  try {
    // Whatever the store does, the breaker check itself is bounded.
    return await withDeadline(readBreakerState(), BREAKER_STORE_TIMEOUT_MS, { open: false });
  } catch (err) { … return { open: false }; }
}
```
`recordSeamFailure()` should additionally be fire-and-forget (`void recordSeamFailure().catch(() => {})`) rather than `await`ed on the error path — the caller's error is already decided, and bookkeeping must not extend a failing request.

---

### CR-03: `process-key-enqueue` cut 60s → 15s on the live onboarding/resync seam with no latency evidence, against a documented cold-start service

**File:** `src/lib/resilient-fetch.ts:205-209`, `src/lib/process-key-client.ts:59-63, 144-145`

**Issue:**
```ts
"process-key-enqueue": {
  timeoutMs: 15_000,
  notes: "… An enqueue that takes 15s means Railway is sick. Tightened from the
          blanket 60s; nothing observes these two budgets (research §6.4).",
},
```
Two problems with that justification. First, "nothing observes these budgets" is an argument that the *old* value was untested, not that the *new* value is safe — it is the absence of evidence, presented as evidence of absence. Second, the sibling row four lines below applies the opposite standard to the same class of decision: `"process-key-sync"` is annotated **"MEASURE BEFORE TIGHTENING — the only latency evidence is a code comment… never guess a budget."** The phase guessed on the other one.

I verified the server-side premise and it is *directionally* right — `analytics-service/routers/process_key.py:446-452, 922-941` does return after enqueue for `{onboard, resync}`. But it is not free: the handler first runs a `strategy_verifications` SELECT pre-check, an INSERT (with a 23505 race re-SELECT branch), and an `enqueue_compute_job` RPC — three-plus Supabase round trips — **after** a possible Railway cold start. The repo documents that cold start as a real, recurring problem: `src/lib/warmup-analytics.ts:1-19` ("The Python analytics service runs on Railway with cold-start behavior") allocates a 10s warmup budget for a bare `/health` GET, and `vercel.json:7` warms it only **once a day** (`0 0 * * *`).

**Concrete failure scenario:** a manager connects a key at 09:00. The last warm cron ran at 00:00 and the service is cold. Railway boots the Python image (pandas/numpy/ccxt import cost), then does the three Supabase round trips. Total 18s — comfortably inside the old 60s, now outside the new 15s. `postProcessKey` returns `504 UPSTREAM_TIMEOUT` and `SyncPreviewStep` (`:531`) shows `KEY_NETWORK_TIMEOUT`. Worse than a plain error: the enqueue may have *already succeeded* server-side before the client deadline fired, so the sync runs while the user is told it failed and retries — double-enqueueing exactly the non-idempotent `/process-key` that `SEAM_RETRIES = 0` exists to protect (`resilient-fetch.ts:117-126`). This is the money-bearing key-connect path for Deribit/MT5/sFOX accounts.

**Fix:** revert to the previous value until measured, and record the reason in the same shape the sibling row uses:
```ts
"process-key-enqueue": {
  timeoutMs: 60_000,
  notes:
    "flow_type in {resync, onboard}: enqueue-only server-side (process_key.py:_is_long_fetch), " +
    "BUT the enqueue is preceded by a possible Railway cold start (warmup-analytics.ts) plus " +
    "three Supabase round trips. MEASURE BEFORE TIGHTENING — same standard as process-key-sync. " +
    "Tightening to 15s without p99 data risks 504-ing a request whose enqueue already succeeded, " +
    "which the user then retries against a non-idempotent endpoint.",
},
```
If the tightening is wanted, it needs a p99 from a cold-start window first, and the enqueue path needs the SEAM-05 idempotency key before the timeout can safely be shortened.

---

### CR-04: One global breaker counts user-triggerable 5xx sourced from a public unauthenticated route — five bad requests deny the seam to every tenant

**File:** `src/lib/resilient-fetch.ts:562-571`, `src/app/api/verify-strategy/route.ts:28-42, 179`

**Issue:**
```ts
if (res.status >= 500) {
  await recordSeamFailure();
}
// 4xx NEVER records. …
```
The 4xx carve-out is reasoned carefully. The 5xx side is not reasoned at all: it assumes every upstream 5xx is *infrastructure* degradation. On a FastAPI service, an unhandled exception on an input-dependent code path is also a 500, and it is fully attributable to a caller's payload. There is exactly one breaker key (`BREAKER_KEY = "breaker:railway"`, :83) shared by all tenants and all thirteen budget keys, so a 500 caused by one caller's input denies **the whole seam** — key connect, sync, optimizer, simulator, bridge, admin match — for `BREAKER_COOLDOWN_S = 30`.

The reachable-by-anyone half is `verify-strategy`: it is a **fully unauthenticated public route** (no `withAuth`, no session read — only `assertSameOrigin` and `checkLimit(publicIpLimiter, …)`), and it reaches the seam via `postProcessKey({ flow_type: "teaser", … })` at :179, which is the *inline* 5-method pipeline (`process-key-sync`), i.e. the widest 5xx surface on the service.

**Concrete failure scenario:** an attacker (or an unlucky bot) finds one teaser payload that trips an unhandled Python exception — a malformed exchange/credential combination that reaches a `KeyError`/`ZeroDivisionError` in the adapter. Five requests in 30 seconds, from five IPs to stay under `publicIpLimiter`, and `breaker:railway` opens. Every authenticated manager's key connect, every allocator's optimizer run and every admin match recompute returns `503 CIRCUIT_OPEN` for 30s. Repeat every 30s for an indefinite, near-zero-cost denial of service on a money-bearing app. Before this phase those five requests each failed in isolation. The phase's own §A4 note ("if Railway 4xxes during genuine degradation the breaker under-trips") shows the *under*-trip direction was considered; the over-trip direction from attributable 5xx was not.

**Fix:** stop treating "5xx" as a synonym for "infrastructure", and stop letting the anonymous surface share a fate with the authenticated one.
```ts
// Only statuses that are unambiguously the platform, not the payload.
// 500 from FastAPI is frequently an input-dependent unhandled exception and is
// attributable to ONE caller; counting it lets one payload deny every tenant.
const INFRA_STATUSES = new Set([502, 503, 504]);
if (INFRA_STATUSES.has(res.status)) {
  await recordSeamFailure();
} else if (res.status >= 500) {
  console.error(`[resilient-fetch] ${budgetKey}: upstream ${res.status} (not counted — see A4)`);
}
```
and, at minimum, exclude the anonymous path from *writing* breaker state (it can still be blocked by it):
```ts
// resilientFetch(budgetKey, path, { …, countsTowardBreaker: false })
// set false for "process-key-sync" calls originating from verify-strategy.
```

---

### CR-05: Breaker state is an unauthenticated oracle via `verify-strategy`, contradicting T-140-20 and the phase's own verification record

**File:** `src/app/api/verify-strategy/route.ts:28-42, 179`; `src/lib/process-key-client.ts:186-200`; `.planning/…/140-VERIFICATION.md:57`

**Issue:**
Ten route handlers place the `CircuitOpenError` arm after `withAuth` / `isAdminUser`, each with a comment stating that hoisting it *"would turn 'is Railway degraded right now?' into an unauthenticated oracle."* `140-VERIFICATION.md:57` records this as satisfied: *"`CircuitOpenError` arms present in 11 handlers, all **after** the auth gate."*

`verify-strategy` has no auth gate to be after. It is public by design, and it inherits the breaker envelope wholesale from `postProcessKey`:

```ts
return { ok: false, response: NextResponse.json(
  { ok: false, code: "CIRCUIT_OPEN", human_message: CIRCUIT_OPEN_HUMAN_MESSAGE,
    correlation_id: correlationId, recoverable: true },
  { status: 503, headers: { "Retry-After": String(err.retryAfterS) } }) };
```

`Retry-After` is the breaker's **live TTL** read from `redis.ttl` (`resilient-fetch.ts:422-423`), not a constant — so an anonymous caller learns not merely *that* the circuit is open but *exactly how many seconds remain*.

**Concrete failure scenario:** an anonymous client polls `POST /api/verify-strategy` with a syntactically-valid throwaway payload once per IP-limit window. A `503 { code: "CIRCUIT_OPEN" }` with `Retry-After: 23` is an unambiguous, timestamped, free signal that the production analytics backend is degraded right now and will stay degraded for 23 more seconds. Combined with CR-04, the same endpoint provides both the lever and the readout — trip it, confirm it tripped, wait for `Retry-After`, trip it again. Independently of the attack, this is a competitive/operational information leak from a live investment product's public surface. The invariant is either wrong for this route or the route needs an exception documented; silently claiming "all after the auth gate" in the verification is the worse of the two.

**Fix:** on the anonymous surface, do not disclose the distinguishing code or the live TTL.
```ts
// src/app/api/verify-strategy/route.ts — after postProcessKey returns !ok
if (!result.ok) {
  // Public surface: collapse the breaker's distinguishable 503 into the same
  // opaque envelope every other transient failure produces, and drop the live
  // TTL (Retry-After leaks the exact cooldown remaining).
  return NextResponse.json(
    { ok: false, code: "TEMPORARILY_UNAVAILABLE",
      human_message: "We could not verify this key right now. Please try again shortly." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}
```
Then correct `140-VERIFICATION.md:57` to record the public-route carve-out explicitly rather than asserting a universal that does not hold.

---

## Warnings

### WR-01: `CIRCUIT_OPEN` is not a `WizardErrorCode` — the wizard still shows the "our team has been notified" dead end for a breaker trip on finalize

**File:** `src/lib/wizardErrors.ts:138, 771`; `src/lib/process-key-client.ts:190`; `src/app/api/strategies/finalize-wizard/route.ts` (probe arm, `code: "CIRCUIT_OPEN"`); `src/app/api/keys/[id]/permissions/route.ts:237`; `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx:124-139`

**Issue:** the phase introduced `SERVICE_UNAVAILABLE_RETRY` and wired it into `classifyKeyValidationError` for `create-with-key` and `composite/add-key` — two routes. Every other emitting site publishes a *different* string, `code: "CIRCUIT_OPEN"`, which is not a member of the `WizardErrorCode` union and has no `WIZARD_ERROR_COPY` entry. `SubmitStep` filters against a closed set:

```ts
const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set([
  "KEY_SCOPE_BROADENED", "KEY_NETWORK_TIMEOUT", "GATE_DRAFT_GONE",
  "GUARD_BLOCKED", "COMPOSITE_MEMBERSHIP_UNKNOWN",
]);
const surfaced = data.code && KNOWN_FINALIZE_CODES.has(data.code as WizardErrorCode)
  ? (data.code as WizardErrorCode) : "UNKNOWN";
```

`"CIRCUIT_OPEN"` is not in it, so a breaker trip during wizard submit renders `UNKNOWN` — *"Something went wrong… our team has been notified"* — which `wizardErrors.ts:133-137` names as the exact DOGFOOD-3 failure the new code exists to kill. Two vocabularies for one condition means the fix landed on 2 of 8 emitting paths.

**Fix:** emit one code. Either promote `CIRCUIT_OPEN` into the union with copy, or have the non-wizard emitters use `SERVICE_UNAVAILABLE_RETRY`. Minimum viable:
```ts
// SubmitStep.tsx
const KNOWN_FINALIZE_CODES = new Set<WizardErrorCode>([
  …, "SERVICE_UNAVAILABLE_RETRY",
]);
// finalize-wizard/route.ts + process-key-client.ts + keys/[id]/permissions/route.ts
code: "SERVICE_UNAVAILABLE_RETRY",   // one vocabulary across the seam
```
and add a test that every `code:` string emitted by a seam route is a `WizardErrorCode` — otherwise this drifts again.

---

### WR-02: The dormant unified handler was re-plumbed through the core and still omits `X-User-Id` — the CT-4 cross-tenant bucket the core's own comment names

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:195-215`

**Issue:** `resilient-fetch.ts:531-534` and `process-key-client.ts:149-150` both warn that *"A dropped `X-User-Id` re-opens the CT-4 cross-tenant rate-limit-bucket defect."* The one place in the repo where it *is* dropped is the dormant handler, which the phase deliberately touched — routing it through the core "so whoever revives it inherits a budget and the breaker" — while leaving the header gap:

```ts
const res = await resilientFetch("process-key-unified-dormant", "/process-key", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${internalToken}`,
    "X-Correlation-Id": correlationId,
    // ← no X-User-Id, no X-User-Access-Token
  },
  body: JSON.stringify({ …, context: { …, user_id: args.userId, … } }),
```
`user_id` is in the *body*; the Python limiter keys on the *header* (`_process_key_rate_limit_key` → `(token_hash, X-User-Id)`). Whoever revives this handler inherits a budget and a breaker and a cross-tenant rate-limit bucket where every user shares one `process_key:<token_hash>:anon` window — one tenant's burst starves all others. Left latent, this is precisely the shape the third seam had.

**Fix:**
```ts
headers: {
  "Content-Type": "application/json",
  Authorization: `Bearer ${internalToken}`,
  "X-Correlation-Id": correlationId,
  // CT-4 — the Python limiter keys on the HEADER, not context.user_id.
  "X-User-Id": args.userId,
},
```
Better: delete the direct `resilientFetch` here and route through `postProcessKey`, which already owns this contract and the flow-type budget split — the handler is calling `/process-key` with `flow_type: "onboard"` and has no reason to speak the protocol itself.

---

### WR-03: The ESLint allowlist is directory-glob wide where the documented exclusions are single files, and the rule keys on one env-var name

**File:** `eslint.config.mjs:120-134`; `tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs:59, 71-78`

**Issue:** `SEAM_EXCLUSIONS` (`resilient-fetch.ts:341-348`) documents exactly three *files*. The allowlist exempts two *trees*:
```js
"src/app/api/debug-key-flow/**",      // exclusion names route.ts only
"src/app/api/cron/warm-analytics/**", // exclusion names route.ts only
```
`debug-key-flow/` already contains a second module (`rate-limit.ts`, cited in the core's own docblock as an in-repo anti-pattern). Any new file added under either tree — a helper, a second route segment — is silently exempt from the rule that the config header calls *"the ONLY mechanism that keeps SEAM-01 true after the merge"*. `contracts-registry.test.ts` freezes the list at *four entries*, not at *four files*, so widening by adding a file to an existing tree is invisible to that guard too.

Separately, the rule's entire detection surface is the literal `"ANALYTICS_SERVICE_URL"` (`no-raw-analytics-fetch.mjs:59`). A sixth seam written as `fetch("https://analytics-prod.up.railway.app/api/x")`, or against a new `RAILWAY_ANALYTICS_URL`, is undetectable. The rule's own header says it exists because "convention demonstrably did not hold" — the mechanism is narrower than the convention it replaces.

**Fix:**
```js
files: [
  "src/lib/resilient-fetch.ts",
  "src/app/api/debug-key-flow/route.ts",        // file, matching SEAM_EXCLUSIONS
  "src/app/api/cron/warm-analytics/route.ts",   // file, matching SEAM_EXCLUSIONS
  "src/lib/warmup-analytics.ts",
],
```
and broaden the rule's taint source so a renamed variable does not defeat it:
```js
const ENV_VARS = new Set(["ANALYTICS_SERVICE_URL", "RAILWAY_ANALYTICS_URL"]);
// plus: report any fetch() whose first argument contains a string literal
// matching /\.up\.railway\.app|analytics-service/ — a hardcoded host is the
// other realistic way a sixth seam gets written.
```

---

### WR-04: `no-raw-analytics-fetch` is the only `quantalyze/*` rule not disabled for test files

**File:** `eslint.config.mjs:299-313`

**Issue:** the test-exempt block turns off eight rules; `no-raw-analytics-fetch` is absent. Six test files already assign `process.env.ANALYTICS_SERVICE_URL` (`finalize-wizard/route.test.ts:429`, three `*.seam.test.ts`, `debug-key-flow/route.test.ts:66`, `cron/warm-analytics/route.test.ts:33`). None currently `fetch()` it, so CI is green today — but the next test that seeds a URL and then drives a raw `fetch` through it (the obvious way to write a negative-control fixture for this very rule) will red CI at `error` with a message telling the author to route it through the core, which is wrong advice for a fixture. The block's own comment states the principle: *"The rules guard PRODUCTION state drift, not tests."*

**Fix:**
```js
{
  files: ["src/**/*.{test,spec}.{ts,tsx}"],
  rules: {
    …,
    "quantalyze/no-raw-analytics-fetch": "off",
  },
},
```

---

### WR-05: `test-setup.ts` mutates `globalThis` for all ~700 test files to fix a two-file problem

**File:** `src/test-setup.ts:27-28`

**Issue:**
```ts
(globalThis as unknown as { AsyncLocalStorage: unknown }).AsyncLocalStorage = AsyncLocalStorage;
```
The comment correctly diagnoses the race and correctly notes setup files are awaited before test modules. But the blast radius is every test in the suite, not the two that touch `unstable_cache`. Next's `FakeAsyncLocalStorage` throws the E504 invariant *deliberately* — it is how Next tells a jsdom test that it has reached a server-only boundary it should not have. Installing the real implementation globally converts that loud, specific failure into silent success across the whole suite, permanently. Any future test that accidentally reaches a `cookies()`/`headers()`/`after()`/`use cache` boundary in the jsdom environment will now quietly "work" instead of failing, which is the opposite of the project's fail-loud rule.

**Fix:** scope it to the files that need it, via a dedicated setup file wired only to the seam/route projects, or install-and-restore per file:
```ts
// src/test/setup/next-async-storage.ts — listed in vitest `setupFiles` for the
// route-boundary project only, not for the default jsdom project.
import { AsyncLocalStorage } from "node:async_hooks";
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;
```

---

### WR-06: `isBreakerOpen()` is a non-atomic GET-then-TTL — a lock expiring between the two calls denies a request against an already-closed breaker

**File:** `src/lib/resilient-fetch.ts:419-423`

**Issue:**
```ts
const state = await redis.get<string>(BREAKER_KEY);
if (state !== "open") return { open: false };
const ttl = await redis.ttl(BREAKER_KEY);
return { open: true, retryAfterS: ttl > 0 ? ttl : DEFAULT_RETRY_AFTER_S };
```
Two round trips against a key whose whole purpose is a 30s TTL. If the key expires between them, `ttl` returns `-2`, the ternary substitutes `DEFAULT_RETRY_AFTER_S = 30`, and the caller is rejected with `CircuitOpenError(30)` **for a breaker that is already closed** — and told to wait 30s when the correct answer is 0. The fallback comment (:109-114) frames `-1`/`-2` as a display concern; it is actually a correctness signal that the read was stale. This is exactly the boundary the cooldown makes most likely, since traffic resumes the instant the lock expires.

**Fix:** treat an absent TTL as "not open" and collapse to one round trip.
```ts
// One command, atomic: TTL alone distinguishes all three states.
//  > 0  → open, with the real remaining cooldown
//  -2   → key absent (never set, or expired between reads) → CLOSED
//  -1   → key with no TTL → treat as closed and repair, never as an eternal open
const ttl = await redis.ttl(BREAKER_KEY);
if (ttl <= 0) return { open: false };
return { open: true, retryAfterS: ttl };
```
(If the `"open"` sentinel value is still wanted for observability, read both with a pipeline so they are one round trip and one point in time.)

---

### WR-07: `classifyKeyValidationError` silently changed how non-`Error` throws are classified

**File:** `src/lib/wizardErrors.ts:936, 967`; callers at `create-with-key/route.ts:472`, `composite/add-key/route.ts:427`

**Issue:** the signature moved from `string` to `unknown`, and both callers stopped pre-normalising. Before, a non-`Error` throw reached the classifier as the literal `"Validation failed"` (the callers' fallback), which matches no branch → `UNKNOWN`/500. Now it reaches the cascade as `String(error)`:

```ts
const message = error instanceof Error ? error.message : String(error);
const lower = message.toLowerCase();
if (lower.includes("signature") || lower.includes("invalid secret")) { … 400 … }
```
A thrown *string* (legal JS, and what some SDKs do) containing "signature", "timeout", "ip", etc. now steers the classification. A thrown plain object becomes `"[object Object]"`. The comment at :963-966 justifies totality, which is right, but does not acknowledge that the *substring surface widened* — a non-`Error` value that was previously inert is now classifiable, and can be steered to a 400 "your secret is wrong" for something that is not a credential problem.

**Fix:** keep totality without widening the cascade's input:
```ts
// Only an Error's message is trusted by the substring cascade. Any other thrown
// value is by definition unrecognised — it must not be able to steer the
// classification via a coincidental substring.
if (!(error instanceof Error)) {
  return { code: "UNKNOWN", status: 500 };
}
const lower = error.message.toLowerCase();
```

---

## Info

### IN-01: The failure counter is never reset when the breaker trips
**File:** `src/lib/resilient-fetch.ts:445-462`
`recordSeamFailure` sets the open-lock but leaves `breaker:railway:failures` at its exhausted count. Because `BREAKER_WINDOW` (30s) equals `BREAKER_COOLDOWN_S` (30), the sliding window's previous-bucket weight is still ≈ threshold at the moment the lock expires — so the first failure after recovery re-trips immediately, then decays over the following ~30s. This behaves like an implicit half-open and is arguably fine, but it is *emergent*, not designed, and it is not pinned by any test. Add a test that documents the intended post-cooldown sensitivity, or `redis.del` the counter alongside the trip.

### IN-02: Breaker counter key is double-prefixed
**File:** `src/lib/resilient-fetch.ts:396-402, 448-450`
`prefix: "breaker"` plus identifier `` `${BREAKER_KEY}:failures` `` yields the physical key `breaker:breaker:railway:failures`. Harmless but confusing for anyone inspecting the Upstash keyspace during an incident. Use `"railway:failures"` as the identifier.

### IN-03: The dormant handler's budget key contradicts `budgetKeyFor`
**File:** `src/lib/resilient-fetch.ts:220-224`; `src/app/api/keys/validate-and-encrypt/route.ts:195, 204`
The handler posts `flow_type: "onboard"` — which `budgetKeyFor` maps to `process-key-enqueue` (15s) — but uses `"process-key-unified-dormant"` (60s). A revival inherits a budget 4× the one its own flow type dictates, and the two will drift independently. Fold the row into `process-key-enqueue` or route through `postProcessKey` (see WR-02).

### IN-04: Raw upstream JSON body forwarded to the client on non-2xx
**File:** `src/lib/process-key-client.ts:245-251`; `src/app/api/keys/validate-and-encrypt/route.ts:216-220`
`NextResponse.json(err, { status: res.status })` echoes whatever FastAPI returned. Pre-existing, not introduced here — but the phase's stated posture is "static bodies, no raw upstream strings" (T-140-11, applied to `admin/match/*`), and these two paths are the largest remaining hole in it. Worth folding into the same pass rather than leaving the posture half-applied.

### IN-05: `pending` from `breakerLimiter.limit()` is neither awaited nor caught
**File:** `src/lib/resilient-fetch.ts:448-450`
`Ratelimit.limit()` returns a `pending` promise. With `analytics: false` it is effectively inert, so this matches the `checkLimit` precedent, but an unhandled rejection from it would be a process-level crash on Node. `void res.pending?.catch(() => {})` costs nothing.

### IN-06: `critical-regressions` guard is prose-fragile
**File:** `src/__tests__/critical-regressions.test.ts` (the `fetch(` bypass assertion)
`/(^|[^a-zA-Z0-9_])fetch\s*\(/m` asserted `false` against the two client files will red CI if any future *comment* in them writes `fetch(`. The phase was bitten twice by prose defeating a guard (140-03 dev. 1, 140-05 dev. 2); this is the same hazard inverted. Strip comments before matching, or match on the AST.

### IN-07: Rule's one-hop taint ceiling is documented but leaves the most natural evasion open
**File:** `tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs:42-47, 184-189`
Pass (a) calls `referencesSeam(node.init, tainted, false)` — `checkTainted: false` — so `const base = process.env.X; const url = \`${base}/p\`; fetch(url)` is not reported. The header is honest about this, but "assign the URL to a second const" is not adversarial, it is ordinary code. A fixed-point loop over `VariableDeclarator` until no new names are tainted is ~10 lines and closes it.

---

_Reviewed: 2026-07-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
