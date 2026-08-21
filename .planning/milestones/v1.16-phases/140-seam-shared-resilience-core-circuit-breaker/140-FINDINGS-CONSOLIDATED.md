# Phase 140 — Consolidated Review Findings (post-scrap)

**Compiled:** 2026-07-25
**Base:** `feat/v1.16-production-resilience` @ `43449cc6` (Phase 140 as verified — 33 commits)
**Archive of discarded fixes:** branch `wip/v1.16-phase140-fix-archive` @ `f29a7131` (37 commits)

## What happened

Phase 140 shipped verified (5/5 success criteria mutation-tested, 8859 tests green). Five review
rounds then ran against it — 6 specialists, then a Fable red team, then an Opus red team, then 5
partitioned reviewers, then 2 more scoped reviewers. Findings were repaired in five ad-hoc fix
batches (A–E) **without** the plan → plan-check gate the original phase went through.

**Every fix batch introduced new HIGH-severity defects, at roughly a 1:1 fix-to-defect ratio.**
Measured example: fixer batch D applied 8 fixes and introduced ~10 new ≥8-confidence defects.
Root causes identified:

1. **No planning gate on repairs.** The original phase passed `gsd-plan-checker` (2 iterations),
   which caught 2 blockers pre-execution — including one that would have shipped `@upstash/redis`
   into the browser bundle. No fix batch was gated this way.
2. **Fixers fix INSTANCES, not CLASSES.** Repeatedly: "scrub at every log site" → 3 of 5;
   "source all error classes from the leaf" → 5 of 7; "make the destructive control never the sole
   offer" → missed an arm; "enforce the composite cap" → landed where nothing writes the table.
   This persisted **even when the prompt explicitly said "EVERY site"**, so it is not purely a
   prompting failure — a single agent applying N fixes does not systematically enumerate a surface.
3. **Fixes collided with each other.** C5 reintroduced the exact log-direction bug C6 had just
   fixed. C2/C3's new retry affordance routed users back onto the draft-deleting button via the
   rate limiter.

**Decision (founder, 2026-07-25):** discard ALL fix commits; re-plan the ORIGINAL-code findings
properly through `gsd-plan-phase` (researcher → pattern-mapper → planner → plan-checker). Nothing
was merged, so the scrap exposed no users. Findings introduced only by the fixes cease to exist.

---

# PART 1 — ORIGINAL-CODE FINDINGS (the input to the new phases)

These exist in `43449cc6`. Grouped by the proposed phase split.

## Cluster A — Seam core / breaker internals

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| A-01 | **`5xx ⇒ Railway degraded` is false.** `analytics-service/routers/exchange.py:108,215,220,235,238` deliberately returns **503** for sub-dependency faults (MT5 gateway unconfigured/hung, sFOX egress-proxy) from a HEALTHY analytics service. MT5's gateway is a separate Railway service that restarts on every deploy → trips the global breaker, denying Deribit/sFOX/optimizer/admin to every tenant in 30s pulses. | HIGH | 9 |
| A-02 | **Deterministic per-key 500 feeds the shared counter.** `routers/internal.py:214` returns 500 forever for an undecryptable key; `KeyPermissionBadge` fetches on mount and failures are never cached, so 5 badges on one page = 5 increments. One user with one corrupt key re-trips the global breaker indefinitely. | HIGH | 9 |
| A-03 | **Unhandled FastAPI exceptions answer `text/plain`.** Starlette's `ServerErrorMiddleware` returns `PlainTextResponse("Internal Server Error")` (verified: starlette 0.52.1; `main.py:224`; `analytics-client.ts:202`). Any body-shape discriminator must handle this — it is the shape a caller-attributable unhandled exception takes. `internal.py:183`'s Supabase call sits outside any try. | HIGH | 9 |
| A-04 | **The breaker's own store is unbounded and runs BEFORE the deadline.** `Redis.fromEnv()` takes SDK defaults: 5 retries, `Math.exp(i)*50` backoff (~4.3s), **no signal** (verified `@upstash/redis@1.38.0` `chunk-2X4SLXT7.mjs:125-193`). Fail-open covers *rejections*; a **hang** is not a rejection, so a stalled Upstash holds the lambda to `maxDuration`. SC-4b's headroom arithmetic does not model the store at all. | HIGH | 9 |
| A-05 | **Anonymous DoS + cooldown oracle.** `verify-strategy` is the PUBLIC teaser (no `withAuth`) yet reaches the seam via `postProcessKey({flow_type:"teaser"})`, and every `status>=500` records into the single global `breaker:railway`. 5 input-triggered 500s in 30s deny key-connect/sync/optimizer/admin to every tenant, from an unauthenticated caller — who is then told the exact remaining TTL via `Retry-After`. `140-VERIFICATION.md:57`'s "all after the auth gate" claim is FALSE for this route. | HIGH | 9 |
| A-06 | **Unbounded composite probe fan-out defeats SC-4b.** `finalize-wizard/route.ts:753-758` loops composite members calling `runScopeBroadeningProbe` → `resilientFetch("keys-permissions")` sequentially, cache-bypassing (`?force_refresh=true`), while `SEAM_ROUTE_BUDGETS` declares `calls: 1` — and the invariant computes worst case from that same number, so it asserts `30 000 < 300 000` forever. No cap on membership. | HIGH | 9 |
| A-07 | **`process-key-enqueue` tightened 60s→15s without measurement.** `wizardErrors.ts:366` tells users "First sync of the day can require up to 60 seconds while the analytics service wakes up" and `warm-analytics` runs DAILY, so Railway is routinely cold. Live paths: `/api/keys/sync` and the wizard SUBMIT step. A false 504 also feeds the breaker, and the job may already be enqueued. The sibling row says "MEASURE BEFORE TIGHTENING". | HIGH | 9 |
| A-08 | **Recovery latency is ~60s, not the documented 30s.** Counter and open-lock are separate keys with independent lifetimes and nothing clears the counter on trip. Worked against the real Lua: 5 failures trip (lock 30s); at t≈31s one failure sees `floor(0.9667×5)=4` carried → `remaining=0` → **re-trips immediately**. Alignment-dependent. | MED | 8 |
| A-09 | **Ratelimit fail-open sentinel read as fail-closed.** `!(success && remaining > 0)` conflates `@upstash/ratelimit`'s internal-timeout sentinel (`{success:true, limit:0, remaining:0, reason:"timeout"}`, default `timeout:5000`) — which means "store unavailable, LET TRAFFIC THROUGH" — with counter exhaustion. One failure + one hung limiter call = full global trip. | MED | 8 |
| A-10 | **`err` is destroyed at both layers.** The core logs a static sentence and drops `err`; `analytics-client:163` mints a fresh Error with no `cause` and no log. `ECONNREFUSED` / TLS expiry / DNS `EAI_AGAIN` / a header `TypeError` are indistinguishable. ⚠️ See TRAP-1 — the naive fix leaks credentials. | HIGH | 9 |
| A-11 | **The breaker OPENING is never logged.** The single most important operational event this phase adds emits nothing — no log, no metric, no Sentry. Post-incident you cannot answer when it tripped, why, or how often it re-tripped. | MED | 9 |
| A-12 | **`SEAM_EXCLUSIONS` is documentation, not a guard.** Nothing asserts the excluded health warmers (`warmup-analytics.ts:38`, `cron/warm-analytics:54`) stay OUT of the core. Routing them in looks like an obvious cleanup and ESLint's allowlist won't object — but a cold `/health` probe failing is NORMAL, so the warmer would feed `recordSeamFailure`, trip the breaker, and the breaker would then block the recovery probe. **Self-sustaining outage. Zero tests fail.** | HIGH | 8 |
| A-13 | **The `budgetKey` a call site spends is never checked against `SEAM_ROUTE_BUDGETS`.** Proven: swapping `portfolio-optimizer`→`optimize-weights` (15s→30s) left **239 tests green**. 8 of 13 keys unpinned. | MED | 9 |
| A-14 | **`BREAKER_COOLDOWN_S >= BREAKER_WINDOW` is unasserted**, and the whole recovery path (TTL expiry = the half-open transition) is untested. Drop the cooldown to 5s as a "faster recovery" tweak → the counter hasn't decayed → ONE failure re-trips → the breaker flaps into a permanent outage. Structurally invisible to the current doubles (the fake limiter is FIXED-window; the real one is epoch-aligned SLIDING with weighted carry-over and no increment on denial). | MED | 8 |
| A-15 | **`CircuitOpenError` has no constructor validation** while its sibling `AnalyticsUpstreamError`, 60 lines away, fail-loudly `RangeError`s on a malformed status. `retryAfterS: number` admits `NaN` → `Retry-After: NaN`. | LOW | 8 |
| A-16 | **Leaf purity has zero teeth.** If someone adds an `import` to `seam-errors.ts`, nothing goes red — app compiles, tests pass, and `@upstash/*` silently enters the wizard bundle via 10 `"use client"` components. The repo already owns the machinery to guard this (`CONTRACT_GUARDS` registry). | HIGH | 9 |
| A-17 | **`SEAM_RETRIES` as a module-global cannot express Phase 141's requirement** (per-call-site retry allowlisting). Moving `retries` into the budget row costs ~13 lines and makes 141 a per-row flip. | LOW | 8 |
| A-18 | **ESLint rule misses the realistic shapes.** Verified through the `Linter` API: `const url = \`${base}/x\`; fetch(url)` and `new URL("/x", base)` both **MISS** because taint doesn't propagate one hop. The docblock documents a ceiling (`const b = a`) it calls unrealistic while the realistic shapes slip through unrecorded. | MED | 9 |
| A-19 | **`isBreakerOpen`'s malformed-value and throwing-`ttl` arms are untested** despite being in its stated contract. | LOW | 8 |
| A-20 | **The single-shared-key property is untested.** Every trip-and-observe path uses `"bridge"` on both sides; a regression to a per-budget key would stay green. | LOW | 8 |

## Cluster B — Wizard / client error surface

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| B-01 | **`CIRCUIT_OPEN` never reaches the wizard.** `finalize-wizard:395` and `keys/[id]/permissions:237` emit `code:"CIRCUIT_OPEN"`, which is NOT a `WizardErrorCode` and NOT in `SubmitStep`'s `KNOWN_FINALIZE_CODES` → renders the `UNKNOWN` "our team has been notified" dead end — the exact DOGFOOD-3 failure `SERVICE_UNAVAILABLE_RETRY` exists to kill. | HIGH | 9 |
| B-02 | **The classifier cannot match ANY transport message.** `wizardErrors.ts`'s substring cascade matches none of the three messages `analytics-client` produces → all fall to `UNKNOWN`/500. The `KEY_NETWORK_TIMEOUT` branch tests `includes("timeout")` while `AnalyticsTimeoutError` says **"timed out"** — dead code, and its regression test pins a raw undici string that can never reach the classifier. **The breaker needs 5 failures in 30s, unreachable at human retry cadence, so the COMMON Railway outage arrives breaker-CLOSED and hits this path.** | HIGH | 9 |
| B-03 | **`SyncPreviewStep` collapses every non-2xx into `SYNC_FAILED`**, whose copy reads *"We fetched your trades but the analytics computation did not complete."* On a breaker trip NOTHING was fetched — a false statement about the user's money data. `handleRetrySync` also swallows non-2xx silently. | HIGH | 9 |
| B-04 | **`finalize-wizard`'s probe arm blames the user's exchange for OUR outage** (`:425-434` maps every non-`CircuitOpenError` failure to `KEY_NETWORK_TIMEOUT` = "We could not reach the exchange"). | MED | 9 |
| B-05 | **The admin queue reads seam failures as SUCCESS.** `AllocatorMatchQueue.tsx:216-235` never checks `res.ok`/`res.status`; the 503 body has no `disabled` field → falsy → `else` → a full refetch presented as a completed recompute. `Retry-After` ignored. The `r` shortcut (`:313`) has no in-flight guard. | MED-HIGH | 9 |
| B-06 | **Background `keys/sync` cannot observe ANY HTTP failure.** `ApiKeyManager.tsx:202-211` uses `fetch().catch()`, which fires only on transport rejection — while its comment claims it logs 401/403/500. Key added, UI reports success, sync never enqueued, nothing recorded. | MED | 8 |
| B-07 | **`CIRCUIT_OPEN_COPY` duplicated across 10 production files** (+ re-declared in 12 test files), each asserting byte-identity that nothing enforces. Each test compares a route to its own copy of the string — a self-referential oracle. | MED | 9 |
| B-08 | **The envelope is three shapes.** 7 of 10 emitters send `{error}` with **no `code`**, so a client cannot uniformly detect a breaker trip. `src/lib/envelope.ts:26-40` already declares `ErrorEnvelope` and the seam literals would not typecheck against it. | MED | 9 |
| B-09 | **`WizardErrorCode` exhaustiveness is enforced at the definition site but not at the boundary.** `SubmitStep.tsx:124-139`'s `KNOWN_FINALIZE_CODES` is a hand-written `ReadonlySet` carrying no totality obligation; three unvalidated `as WizardErrorCode` casts of network data (`ConnectKeyStep:323`, `MultiKeyConnectStep:637,762`). | MED | 8 |
| B-10 | **Three Mechanism-B routes inherit the envelope structurally but nothing pins it** — `verify-strategy` (the PUBLIC teaser), `csv-validate`, `csv-finalize`. | LOW | 8 |
| B-11 | **`Retry-After` is honoured at 1 of 4 surfaces.** Only `SyncPreviewStep` reads it; `ConnectKeyStep`, `SubmitStep`, `MultiKeyConnectStep` call `buildEnvelope` with no context, so the "name the real wait" copy is unreachable in production. | LOW-MED | 8 |
| B-12 | **`admin/match/*` flatten `AnalyticsUpstreamError` 4xx to a generic 500**, so an admin cannot distinguish "bad parameter" from "Railway is broken". (The 5xx leak-closure must stay.) | LOW | 8 |
| B-13 | **`scenario/optimize` client discards the whole response on failure** — body never read, status never read, bare `catch {}`. | LOW | 6 |

## Cluster C — Money-path / data-integrity

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| C-01 | **`csv-finalize` retry is a permanent dead end.** If the 60s deadline fires after Python committed, you get a `pending_review` strategy **in the admin publish queue with zero daily returns and no `strategy_analytics` row** (poller has nothing to break out on). The retry hits Python's idempotency path returning `WIZARD_DUPLICATE` **with no `strategy_id`** → `csv-finalize:1214` → **502 "Please retry." forever.** No compensating branch exists. ⚠️ Pre-existing; Phase 145 is the scoped fix, but any retry affordance added here steers users into it. | HIGH | 9 |
| C-02 | **uvicorn does not cancel on client disconnect** (verified: no `is_disconnected` polling, no timeout middleware in `analytics-service/`). A client-side deadline therefore does NOT stop the Python side committing. Any copy claiming "nothing was submitted" is false for `UPSTREAM_TIMEOUT`/`UPSTREAM_NETWORK_ERROR`; only `CIRCUIT_OPEN` and a not-configured error genuinely mean nothing was sent. | MED | 8 |
| C-03 | **`keys/sync` resync re-POST mints a new `strategy_verifications` row per click** — `process_key.py:720` mints a fresh `uuid4()` when `wizard_session_id` is absent ("deliberately not idempotent-by-session"). No money impact on a `draft` strategy (`get_published_trust_signals` is gated on `published`), but the general pattern is a live trust-signal hazard on published strategies. | LOW | 9 |
| C-04 | **`keys/sync` answers CODELESS on five arms** — both 429s, both 400s, and the 404 — so no client can classify them. | MED | 9 |
| C-05 | **`finalize-wizard`'s live-permissions probe is an unchecked cast** (`(await res.json()) as LivePermissions`) whose consumer does `livePerms.trade === true || livePerms.withdraw === true`. On field drift both read `undefined`, both gates fall through, and **a key holding trade/withdraw scope is promoted to `pending_review`** — a publish gate failing OPEN. The sibling badge route validates; this one does not. | MED-HIGH | 8 |
| C-06 | **`keys/[id]/permissions` casts and then caches for 60s.** On drift the badge renders *"No read permission detected — the key may have been revoked"* about a HEALTHY money-bearing key, cached so "Re-check" repeats it. | MED | 9 |
| C-07 | **Parse failures are discarded with no log.** `res.json().catch(() => ({}))` in `process-key-client` (both arms) and `validate-and-encrypt`; `keys/sync` then returns `200 {}`. A truncated/gzip-corrupt body during a deploy = silent no-op resync. | MED | 8 |

## Cluster D — Observability / verification integrity

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| D-01 | **The fake cannot execute Lua / diverges from the real limiter.** `fakeRatelimitFor` is FIXED-window; the deployed one is epoch-aligned SLIDING. No test can observe decay, weighted carry-over, or the no-increment-on-denial rule. **Any breaker implementation using a Lua script needs a live-Redis integration test — a script-text guard pins only what the fake already models.** | HIGH | 10 |
| D-02 | **RESEARCH §10.2 was measurably WRONG** — `vi.mock` factories do NOT re-run on `vi.resetModules()` (vitest 4.1.10, measured). Any negative control built on the opposite premise is a silent FALSE GREEN. The real per-context hook is `Redis.fromEnv()`. Also: after `resetModules()` a statically imported class is a DIFFERENT object from the freshly-imported module's — assert against the same registry. | HIGH | 10 |
| D-03 | **16 existing route tests `vi.mock` the seam clients wholesale**, so they prove mapping and nothing about SC-1/SC-5. Zero of them `importActual` analytics-client — a class reached through a mocked module is `undefined`, and `x instanceof undefined` throws `TypeError` **from inside the catch block**. | HIGH | 10 |
| D-04 | **Comment rot at scale**: ~8 stale line refs the phase's own edits created; the mock-count claim stated 4 different wrong numbers; "ONLY legal home" contradicts the 4-path ESLint allowlist (and following it leads straight into A-12's self-sustaining outage); "5 minutes" vs the actual 60s `revalidate` (the T-140-32 rationale hinges on the 60s-vs-30s ratio); "5× headroom" is actually 2.5× (and 2.5× is the number Phase 141's retry math depends on). | MED | 10 |
| D-05 | **`npm test` has no global `unstubGlobals` safety net.** Per-file discipline only; a leaked `vi.stubGlobal("fetch")` is this repo's known CI-only-failure cause (CI=Node 22, local=Node 25). | LOW | 8 |
| D-06 | **`Redis.fromEnv`'s env guard is narrower than the SDK's own resolution** — the SDK also accepts `KV_REST_API_URL`/`KV_REST_API_TOKEN` (what the Vercel marketplace integration provisions). A project carrying only the `KV_*` shape gets `redis = null` and a **silently disabled breaker**. Confirm prod carries the `UPSTASH_*` names. | LOW | 7 |

---

# PART 2 — TRAPS (how the naive fix breaks)

Learned by watching five fix batches fail. **A plan that addresses PART 1 must respect these.**

- **TRAP-1 — Logging the transport error leaks credentials.** undici embeds outgoing headers in the
  error message, and in one shape the error **name**. On this seam that is `INTERNAL_API_TOKEN`,
  `X-User-Access-Token` (the user's live Supabase JWT), and raw exchange `api_key`/`api_secret`/
  `passphrase` in the body. Any scrub must cover **every** log site (there are ≥5, incl.
  `keys/validate-and-encrypt` and `keys/[id]/permissions`, and Sentry capture too), must handle
  per-request (non-env) secrets, and must not over-redact: a short secret substring-matched against
  prose **destroys the `ECONNREFUSED`/`ENOTFOUND` token** — the most valuable thing in the line.
- **TRAP-2 — A body-shape discriminator must handle `text/plain`** (A-03), or unhandled FastAPI
  exceptions still trip the global breaker.
- **TRAP-3 — Naming an error arm can turn a vague error into a specific lie.** `.single()` returns
  `data: null` for not-found, not-owned **and transport errors**; naming that arm "your draft is
  gone" while discarding `error` tells users something false and offers "start fresh".
- **TRAP-4 — A retry affordance must not route into a destructive control.** `/api/keys/sync` is
  limited to 5/60s and denies **codeless**; if codeless falls through to a branch that renders the
  delete-draft button as the SOLE control, five clicks of your own copy destroys the composite draft.
- **TRAP-5 — Enumerate the whole class.** Every "fix every site" instruction in this phase was
  under-delivered (3/5, 5/7, 1/2 arms). The plan must LIST the sites; the pattern-mapper should
  produce that list; the plan-checker must verify coverage against the codebase.
- **TRAP-6 — `resetUsedTokens` is a full-keyspace Lua SCAN** that blocks Redis's single thread on
  the DB shared with 15 production limiters (which fail CLOSED in prod), and grows forever
  (`DBSIZE`=146 today, all `quantalyze:events:*` with `TTL=-1`, never pruned). Client-side deadlines
  abandon the WAIT, not the WORK. Do not use it; own the counter key.
- **TRAP-7 — A one-deadline-for-the-whole-write-chain abandons the trip.** If the deadline fires,
  the async IIFE is orphaned and Fluid Compute freezes the instance — the breaker never arms, during
  exactly the correlated Railway/Upstash incident it exists for. Log direction must match the caller.
- **TRAP-8 — Fixes collide.** Sequence and isolate them; two fixes touching the same file in one
  pass reintroduced each other's bugs (C5 undid C6).
- **TRAP-9 — Relaxing a test assertion can silently delete coverage.** One relaxed assertion left
  the poll-driven-gate boundary pinned nowhere.
- **TRAP-10 — `import { X } … ; export { X }` resolves to `undefined` under vitest's SSR transform.**
  Use `export { X } from "./module"`.

---

# PART 3 — PROPOSED PHASE SPLIT

Contract between them: **the seam-core phase owns the error TYPES; the wizard phase owns how they
RENDER.** They share almost no files, which is what makes independent planning/execution safe.

- **Phase A (seam core / breaker internals):** Clusters A + D. Needs a live-Redis integration test
  (D-01) or its central artifact is unverifiable.
- **Phase B (wizard / client error surface):** Clusters B + C. Needs component + all-roles e2e.

---
*Compiled from ~20 reviewer reports across 5 rounds. Fix-introduced findings are deliberately
excluded — they died with the scrap. The TRAPS section is what survives of them, and it is the most
valuable output of the fix batches.*

---

# PART 4 — ROUND-5 FINDINGS (4 red teams on the ORIGINAL code, post-scrap)

Run against `43449cc6` after the fix batches were discarded, each armed with PARTS 1–3 and told not
to re-report them. Four lanes: seam-core failure matrix · route×consumer walk · Python↔TS contract ·
test-harness mutation. **These are NEW original-code findings.** Listed at HIGH/CRITICAL or
confidence ≥8; lower-confidence items remain in the reviewer transcripts.

## Cluster A additions — seam core

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| A-21 | ⭐ **The deadline fires during the BODY READ, outside the classification `try`.** `AbortSignal.timeout` aborts the response stream, so `fetch` resolves with headers and `res.json()` then rejects — but the core's `try` closes at `:560`, before every body read. **For the most common Railway degradation (headers fast, body slow) `recordSeamFailure()` is NEVER called.** The breaker under-counts precisely the mode it exists for. `resilientFetch`'s docblock ("breaker check → budgeted fetch → classified failure recording") is FALSE. Verified empirically against a stalling server. Downstream: `analytics-client:196` `return res.json()` has no catch, so the raw `DOMException` escapes `analyticsRequest` and misses every `instanceof` arm. | HIGH | 10 |
| A-22 | **A caller-fault throw is recorded as Railway degradation → permanent global outage from a config typo.** The URL template and `AbortSignal.timeout()` are INSIDE the try, so a malformed `ANALYTICS_SERVICE_URL` (missing scheme) throws before a packet leaves, is logged as "network failure reaching the analytics service", and after 5 requests opens the global breaker — which then re-trips forever. No request ever reached Railway; the log points ops at Railway. | HIGH | 9 |
| A-23 | **Redirects are followed and secret headers survive a CROSS-ORIGIN hop.** No `redirect` option is set. Verified on Node 25: after a 302 to a different origin, `Authorization` is stripped but **`X-Service-Key`, `X-Internal-Token` and `X-User-Access-Token` are forwarded verbatim** — the service key, the internal token, and a live user Supabase JWT. Redirects also silently consume budget (up to 20 hops inside one signal). `redirect: "error"` is a one-line closure. | MED-HIGH | 10 (mechanism) |
| A-24 | **`get`/`ttl` is a non-atomic 2-RTT race.** If the lock expires between them, `ttl` returns `-2` → `retryAfterS` falls back to 30 **and the function still returns `{open:true}`** — a healed circuit denies traffic for another 30s. If `ttl` throws while `get` returned `"open"`, the catch discards the known-open state, contradicting `DEFAULT_RETRY_AFTER_S`'s own docblock which names exactly that case. | MED-HIGH | 9 |
| A-25 | **`recordSeamFailure` has no is-open guard: in-flight failures re-arm an expired lock.** A 60s-budget call admitted at t=0 fails at t≈60; the lock (armed t=0, 30s) has expired so `nx` succeeds and arms a fresh 30s window for a request already doomed before the first trip. One wave of long-budget calls holds the breaker open 90s+ with no new traffic attempted. Distinct from A-08 and composes with it. | MED-HIGH | 9 |
| A-26 | **Every declared budget excludes the store round trips.** `isBreakerOpen()` runs before the signal exists and is itself unbudgeted/unsignalled — 1 RTT closed, **2 sequential RTTs open**; `recordSeamFailure()` adds 2 more after the deadline. With SDK defaults (A-04) a degraded Upstash adds ≈4.3s per call and ≈13s per *failed* call, **none of it in `SEAM_ROUTE_BUDGETS`**. | MED | 9 |
| A-27 | **A 2xx non-JSON page never records** — a Railway edge/maintenance page served as `200 text/html` is invisible to the breaker, and `analytics-client:193` throws an untyped local-dev message ("Is it running on the correct port?") during a production incident. **204 diverges across the two clients**, both wrongly (untyped throw vs `{ok:true, body:{}}`). A **304/205** pass-through crashes the route: `NextResponse.json(err, {status:304})` throws `TypeError: Invalid response status code`. | MED | 8 |
| A-28 | **`timeoutMsOverride` has no validation.** `AbortSignal.timeout(NaN|undefined|-1|1e15)` all throw — inside the try, so they are recorded as Railway network failures (A-22). Same fail-loud gap as A-15 in the sibling parameter. | LOW | 8 |
| A-29 | **A-06 quantified.** The composite loop is a sequential `await` in a `for`, cache-bypassing, and the member query has **no `.limit()`**: real worst case = N × 15 000 ms → **N ≥ 21 breaches `maxDuration`** (N ≥ 10 with one retry). Worse, the composite and single-key branches are mutually exclusive and the composite branch spends **zero** `process-key-enqueue` — so the budget table's row describes the single-key path and **the composite path is not modelled at all**. | HIGH | 9 |

## Cluster B additions — wizard / client surface

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| B-14 | ⭐ **`finalize-wizard`'s scope probe fails OPEN on 2xx drift — a publish gate.** Casts `as LivePermissions`; only rejects on explicit `true`. A 2xx `{}` or a renamed field → `{ok:true}` → the draft finalizes to `pending_review`, and **a key holding trade/withdraw scope is published as read-only-verified** while the user sees a normal success. Contradicts the fail-CLOSED doctrine written 40 lines above in the same file. | HIGH (sec) | 9 |
| B-15 | **`keys/sync` returns an unrecognised body at HTTP 200** → client sets `waiting_for_complete` and polls **a job that was never enqueued — 15 minutes** to the stall backstop. `ApiKeyManager` does the same with **no backstop at all**. | HIGH | 9 |
| B-16 | **The public teaser discards the copy written for it.** `process-key-client` emits `human_message`; `VerificationForm:54` reads `data.error ?? "Verification failed"` and `error` is never set, so an anonymous visitor sees the bare string. Also: uvicorn does not cancel, so the row is created upstream while `public_token` is minted only on success — **orphaned row, user can never reach results.** No Sentry, no PostHog. | HIGH | 9 |
| B-17 | **The admin queue renders a breaker trip as a completed recompute.** No `res.ok` check; spinner ends, stale queue reloads, zero error text → the admin reads *"No candidates yet for this allocator"* and draws a **wrong product conclusion**, and can loop forever. Its sibling `handleDecision` in the same file checks correctly — that is the fix shape. Inverted severity: a non-JSON platform 502 *does* alert; our own well-formed 503 is the silent one. | HIGH | 9 |
| B-18 | **CSV steps blame the user's file for a Railway crash.** A `text/plain` 5xx becomes `{}`, and the defaults render *"Validation failed. See per-row breakdown below."* **with zero rows**, and *"your file validated cleanly… your data is unchanged"* — a claim the route cannot make after a 500 from a handler that runs `finalize_csv_strategy`. | HIGH | 9 |
| B-19 | **Every `csv-finalize` transport failure re-enables Submit** (all codes except two), and the copy explicitly instructs a retry — steering users into the C-01 dead end, on exactly the timeout/network cases where Python already committed. | HIGH | 8 |
| B-20 | **`validate-and-encrypt`'s generic 500 blames the user's credentials for every infra fault** — three consumers render *"Key validation failed. Please try again."* verbatim. The route's own comment says this cascade **was the bug being fixed**; it was fixed only for `CircuitOpenError`. | HIGH | 9 |
| B-21 | **`create-with-key`/`composite/add-key` promise a notification that never happens** — network throw and non-JSON 5xx land on UNKNOWN *"Our team has been notified."* Neither route imports Sentry (0 hits). | HIGH | 9 |
| B-22 | ⭐ **`SyncPreviewStep` renders every seam error with NO retry button.** It passes the envelope with no `onRetry`, so `showRetry = recoverable && Boolean(onRetry)` is always false — recoverable seam errors render un-retryable and the only remaining control steers the user to **replace a perfectly good key during our outage**. | HIGH | 9 |
| B-23 | **`Retry-After` is honoured for 429 only, never for the breaker's 503** — the retry path is gated on `res.status === 429`, so the 503 (header-only) skips it and Retry is enabled instantly with no countdown. The repo's best `Retry-After` implementation does not cover the case this phase added. | MED-HIGH | 9 |
| B-24 | **`evalMatch` is the only analytics wrapper with no Zod schema** — 2xx drift reaches `metrics.intros_shipped.toString()` and **throws in render**, replacing `/admin/match/eval` with the error boundary. Both admin match routes also emit **no `code` at all** (the only two seam members off that contract) and flatten upstream 4xx to 500, making "Please try again" false for a 404/403. | MED | 9 |
| B-25 | **Funnel codes are collapsed before they are recorded** — `wizard_error` fires with `UNKNOWN`/`CSV_VALIDATION_FAILED`, so the funnel **cannot distinguish an outage from a bad file**. `MultiKeyConnectStep` emits no `wizard_error` at all while its single-key twin does. | MED | 9 |

## Cluster C additions — Python service contract & rate limiting (NEW CLUSTER)

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| C-08 | ⭐⭐ **CROSS-TENANT LEAK.** `strategy_verifications_wizard_session_id_unique_idx` is **not partial and not tenant-scoped** (single column, no `WHERE`, no `user_id`), and the duplicate pre-check uses the **service-role** client, so it is not RLS-scoped: a colliding UUID returns **another tenant's `verification_id`, `status` and `trust_tier`**. The partial index reviewers cite is on a different table and `/process-key` never consults it. | CRITICAL | 10 |
| C-09 | ⭐ **`/process-key` is ONE global 100/hour bucket for the whole platform**, keyed on `sha256(INTERNAL_API_TOKEN)`. Every lambda sends the same token, so teaser + onboard + resync + csv share one allowance — and `verify-strategy` is public, so **an anonymous caller can exhaust it and deny key-connect and sync to every paying tenant for the hour.** The Vercel limiters key on `user.id` and structurally cannot bound it. | HIGH | 9 |
| C-10 | **Three routers re-declare private `Limiter(key_func=get_remote_address)`** — the bug `services/rate_limit.py` exists to fix. Behind Railway's edge that resolves to the proxy, so they are effectively global: **bridge/optimizer 10/hour PLATFORM-WIDE**, validate/encrypt 100/hour (and key-connect spends **two** tokens). The token cost is modelled nowhere. | HIGH | 8 |
| C-11 | ⭐ **A total seam auth outage produces NO operator signal.** A stale `ANALYTICS_SERVICE_KEY` → 401 on every analytics-client endpoint → 4xx → **breaker never trips, `/health` green, `warm-analytics` green**, message matches no classifier → UNKNOWN. The mirror (secret missing Python-side) → 503 → breaker flaps forever, while `/process-key` and `/internal/*` keep working (both skipped by the middleware). Same misconfiguration, opposite behaviour. | HIGH | 9 |
| C-12 | ⭐ **An exchange outage trips the GLOBAL breaker.** `internal.py:339` returns 502 *"Exchange permission probe failed"* on **any** exchange-side error — Binance maintenance, a revoked key, an IP-allowlist change — plus 502 arms at `:218`/`:326`. Failures are explicitly not cached, so one dashboard render with five keys during a Binance outage = five 502s = a global trip denying Deribit users, the optimizer, admin match and CSV finalize. Far more reachable than A-02. | HIGH | 9 |
| C-13 | **FastAPI's 422 echoes the full request body — including raw exchange `api_secret`** — and the PUBLIC teaser forwards it verbatim to an anonymous browser. `csv-finalize` also returns the whole upstream body in `debug_context`. TRAP-1's class on a surface TRAP-1 does not cover (response bodies, not error messages). | MED-HIGH | 8 |
| C-14 | **FastAPI 422 `detail` is a LIST OF DICTS; two seam sites stringify it to `[object Object]`** — destroying the only diagnostic the 422 carried, in the user-visible copy *and* in `console.error`/Sentry. | HIGH | 9 |
| C-15 | **slowapi's 429 has no `detail` and no `Retry-After`** (`RATELIMIT_HEADERS_ENABLED` unset), so the TS coerces it to the literal `"Analytics service error"` → matches no classifier branch → UNKNOWN. **Every Python-side throttle renders as an unknown internal error.** | HIGH | 9 |
| C-16 | **`/api/validate-key` returns a 500 whose copy blames the user's credentials.** Two defects in one line: it is 5xx (so an exotic ccxt error from ONE user's key increments the **global** breaker on the busiest seam endpoint), and no classifier matches "check your credentials" so it renders UNKNOWN — contradicting its own text. | HIGH | 9 |
| C-17 | **`/api/encrypt-key` 503 "Encryption not configured"** on a missing/rotated KEK is a deterministic permanent 5xx that trips the global breaker, self-sustaining in the A-12 way. | MED-HIGH | 8 |
| C-18 | **On `/process-key`, auth is the LAST of three gates** (validation → slowapi → token check), because the `X-Service-Key` middleware skips that path. An unauthenticated caller who reaches the Railway URL can **enumerate feature flags** (`source:"sfox"` → 422 naming the flag) and **burn tokens from C-09's single global bucket** without holding the token. | HIGH | 8 |
| C-19 | **`onboard` idempotency is a permanent wedge presented as success.** The duplicate pre-check returns ~175 lines before `enqueue_compute_job`, while the SV `draft` INSERT commits before that. If the handler dies between them, the retry returns `WIZARD_DUPLICATE, queued:false` and **never enqueues** — mapped to HTTP 200 `{ok:true, accepted:true}`. The user is told the sync was accepted; it will never run. | HIGH | 9 |
| C-20 | **C-01 needs no timeout.** The pre-check runs before the strategy_id branch, so **any plain double-submit** in one wizard session returns `WIZARD_DUPLICATE` (which by construction carries no `strategy_id`) → 502 "Please retry." forever, with Submit re-enabled. Scoping Phase 145 as a *deadline* fix would under-fix this. Once finalize has written an SV row for a session, every subsequent csv call short-circuits and the inline pipeline is unreachable. | HIGH | 9 |
| C-21 | **`resync` cannot use the idempotency mechanism at all** — `keys/sync` sends no `wizard_session_id`, so Python mints a fresh uuid4 per call, and **`keys/sync`'s `WIZARD_DUPLICATE` branch is dead code** on the only flow that route sends. | MED | 9 |
| C-22 | **HTTP 200 with `ok:false` is invisible to `postProcessKey`** — Python returns it in three places including **the write-capable-key/auth rejection, i.e. a security verdict delivered as a success status**. The `/process-key` 200 surface has **four mutually exclusive shapes with no shared discriminator**, forcing every consumer into ad-hoc key sniffing. | HIGH | 8 |
| C-23 | **`resilient-fetch.ts:529`'s CT-4 claim is FALSE** — `X-User-Id` was deliberately removed from the Python key function as spoofable and now only WARN-logs. The core tells maintainers that header-forwarding buys per-tenant bucketing that does not exist, which plausibly masked C-09. | MED | 9 |

## Cluster D additions — harness integrity (57 mutations, each run and reverted)

**Headline: 10 simultaneous semantic mutations to the seam core produced `8859 passed | 287 skipped`
— byte-identical to the number Phase 140 certified as "5/5 success criteria mutation-tested."**

| ID | Finding | Conf |
|----|---------|------|
| D-07 | ⭐ **Every breaker tuning constant is unfalsifiable.** threshold 5→30 GREEN · cooldown 30→5 GREEN · window 30s→3600s GREEN · `DEFAULT_RETRY_AFTER_S` 30→999 GREEN · the `ex:` TTL actually written to Redis →3600 GREEN (all confirmed at full suite). **Root cause — a two-layer self-referential oracle:** the fake harvests its threshold from production's own `slidingWindow(BREAKER_FAILURE_THRESHOLD, …)` call, and every test loop bound is `mod.BREAKER_FAILURE_THRESHOLD`. | 10 |
| D-08 | ⭐ **Every `SEAM_BUDGETS` timeout VALUE is unfalsifiable** — bridge 15s→99s, permissions 15s→1s, enqueue 15s→60s, **the public teaser 60s→5s** all GREEN. The two tests that appear to cover it assert `toHaveBeenCalledWith(mod.SEAM_BUDGETS.X.timeoutMs)` — the value read from the table under test. **0 of 13 budgets pinned to a literal.** A-07's tightening is invisible in both directions. | 10 |
| D-09 | **Leaf purity proven toothless** — prepending `import { Redis } from "@upstash/redis"` to `seam-errors.ts` is GREEN at full suite. Confirms A-16 empirically. | 10 |
| D-10 | **`SEAM_ROUTE_BUDGETS` row CONTENTS unchecked; only the row COUNT is.** Dropping a leg from `finalize-wizard`'s two-leg `budgets` array is GREEN — the SC-4b worst case silently halves. Delete a row and add a bogus one and the `length === 15` assertion still passes. | 9 |
| D-11 | **`budgetKey` swaps still green at 2 of 3 sites.** Good news: `keys/[id]/permissions` IS caught by a named test — so the pattern exists and simply was not applied to the other twelve call sites. | 9 |
| D-12 | **`CIRCUIT_OPEN_COPY` cross-file drift is invisible** — changing one route's copy AND its own test's copy together is GREEN at full suite. Each of 12 assertions compares a route to its own local re-declaration; nothing asserts the 10 production literals equal each other. A one-sided swap IS caught, which is why it reads as covered. | 10 |
| D-13 | **The breaker's counter identifier is unpinned** (`limit(BREAKER_KEY:failures)` → `limit(BREAKER_KEY)` GREEN), and **`nx: true` → `nx: false` is GREEN** — the concurrent-trip idempotency the comment claims is asserted nowhere, even though the fake implements `nx` correctly. | 8 |
| D-14 | **`SEAM_EXCLUSIONS` guards existence, not membership.** Routing the `/health` warmer through the core was RED only at full suite and only **incidentally**, via the warmer's own test — not via any seam guard. A-12's self-sustaining outage remains structurally undefended. | 7 |

**Where coverage is genuinely strong** (do not re-derive): failure classification (`>=500` boundary
both directions), trip-comparison direction and shape, fail-open direction, breaker-check-before-fetch
ordering, header forwarding (dropping the spread is RED across 5 files), **the route retrofit layer**
(delete-arm / swap-copy / drop-`Retry-After` / drop-`code` are ALL RED at four routes — the
best-covered part of the phase), error identity and `retryAfterS` propagation, deadline plumbing,
and `SEAM_RETRIES` genuinely tightening the invariant.

**Two recommendations carried into the plan:** pin budgets and breaker constants to **literals** in a
table the implementation does not export into the assertion; and add a **live-Redis integration
test** — a script-text guard over the fake pins only what the fake already models.

---

# PART 5 — REVISED PHASE SPLIT (three phases)

Round 5 surfaced a cluster that did not exist in the original split: the **Python service contract
and rate-limit layer**. It is `analytics-service/` work with its own toolchain (pytest,
`mypy --strict`), its own reviewers, and a genuine security dimension (C-08 is a cross-tenant leak).
Bundling it with wizard copy or breaker internals would repeat the coupling mistake that produced
the fix-batch collisions.

| Phase | Scope | Risk profile | Verification need |
|-------|-------|--------------|-------------------|
| **A — seam core / breaker internals** | Cluster A + Cluster D | distributed-systems correctness | **live-Redis integration test** (D-01/D-07/D-08) or the central artifact stays unverifiable; constants pinned to literals |
| **B — wizard / client error surface** | Cluster B | UX correctness, data-loss affordances, funnel integrity | component tests + all-roles e2e |
| **C — Python service contract & rate limiting** | Cluster C | **security** (cross-tenant leak, anonymous platform DoS, credential echo) + availability | pytest + `mypy --strict`; RLS/SQL gates as `supabase/tests/test_*.sql` |

**Contracts between them:** Phase A owns the error TYPES; Phase B owns how they RENDER; Phase C owns
what the service EMITS (status codes, body shapes, limiter identity). A and C both touch the
5xx-vs-attributable question — A must not ship a discriminator that assumes a Python contract C is
about to change, so **C's status/body contract should be settled first or the two co-planned.**

**Sequencing note:** C-08 (cross-tenant leak) is the only CRITICAL and is independent of the breaker
entirely. It should not wait behind a distributed-systems phase.

---
*Round 5 compiled 2026-07-25 from 4 red teams (~120 raw findings, deduped to the above).
Tree verified byte-identical to `43449cc6` after 57 mutations.*

---

# PART 6 — ROUTE×CONSUMER CLOSING WALK (added 2026-07-26)

The route-consumer red team closed its one open quadrant (the compute group: bridge, simulator,
portfolio-optimizer, scenario/optimize). **No cell remains UNVERIFIED.** All 15 routes × 7 failure
modes are now walked route-side AND consumer-side. It found the highest-severity item in Cluster B.

| ID | Finding | Sev | Conf |
|----|---------|-----|------|
| B-26 | ⭐⭐ **STALE MONEY DATA SURVIVES A FAILED RECOMPUTE.** `PortfolioOptimizer.tsx:204-206` sets `error` but never clears `suggestions`. The render cascade at `:233` shows the error card only when `!suggestions`, so with a stale list present it falls through to `:302` `suggestions.slice(0,5)` — **the success branch**. The breaker 503 IS correctly detected (`:198` `data.status === "failed"` — the envelope works); the defect is purely that the prior result is not discarded. A user re-running during a Railway outage sees the **previous ranked allocation with live, clickable "Add to portfolio" links** and a small red line underneath, and acts on stale weights believing they are current. **The only cell in the entire audit where a failed compute is presented as an actionable result.** Fix shape already exists one directory away: `WeightOptimizerSection.tsx` calls `setResult(null)` before every re-run. | CRITICAL | 9 |
| B-27 | `ReplacementPanel.tsx:71` renders a raw `TypeError.message` ("Failed to fetch") as user-facing copy, and offers **no Retry control at all**. | MED | 9 |
| B-28 | `ReplacementPanel.tsx:57` `data.candidates ?? []` has no array guard — a non-array `candidates` renders a **silently blank panel**: no error, no log, no way to tell loading finished. | MED | 8 |

**Structural correction to earlier assumptions:** only **4 of the 11 presumed consumers** actually
call these routes. `BridgeDrawer`, `BridgeOutcomeBanner`, `OutcomesWidget` hit *different* endpoints
(`/api/bridge/outcome/*`, `/api/match/decisions/holding`); `BridgeTrigger`, `InsightStrip`,
`SimulateImpactButton`, `OptimizerPanel` are pass-through wrappers; `queries.ts` mentions bridge only
in a comment. "Do not assume one caller per route" cut **both** ways — the real risk here was
over-counting, not under-counting. A planner that fans out over the presumed-consumer list will
plan work against files that never touch the seam.

**Contradiction resolved by reading source, not averaging (Rule 7):** two agents made opposite claims
about `PortfolioImpactPanel`'s `Retry-After` handling. `:89` gates ALL retry-after logic on
`res.status === 429`, so the breaker's header-only 503 skips it entirely. Both were partly right;
neither was correct. This is B-23.

**Four themes for the planner** (the walk's own synthesis): (1) stale money data survives a failure —
B-26, isolated, fix shape known; (2) copy asserting something false about the user's data or key — 8
routes; (3) silent success on failure — `keys/sync` mode (g), `AllocatorMatchQueue`,
`finalize-wizard`'s fail-OPEN probe; (4) envelope fragmentation — five shapes, two mechanisms, `code`
absent on 7 of 10 emitters, the root cause under most of theme 2.

**Theme 3 should be planned as one unit and must not wait behind copy fixes** — the fail-open scope
probe (B-14) is a security gate, not an error-rendering concern.

**Confirmed strong, do not re-derive:** no SSR exposure (zero server components / `"use server"`
reach the seam — a breaker trip can never 500 a page); poll paths structurally disjoint from
breaker-feeding paths; short-circuit asymmetry (`resilient-fetch.ts:524-527` — retrying into an open
breaker cannot extend it). `create-with-key`'s breaker cell is the template the other 14 should copy.
TRAP-4 is not tripped anywhere today.

---

# PART 7 — CORRECTIONS TO THIS DOCUMENT (2026-07-26, from Phase 140.1 research)

**This document is 5 rounds of review, but it is not infallible.** Verified against source during
Phase 140.1 research; the authoritative 5xx site list is now the **S-01…S-24 table in
`.planning/phases/140.1-.../140.1-RESEARCH-A.md`**, not the prose below.

| # | Corrected claim | Reality |
|---|-----------------|---------|
| 1 | `/process-key` lives in `routers/internal.py` | **FALSE.** It is `services/process_key.py` and contains **zero 5xx sites**. `internal.py:218/:326/:339` belong to the **permissions** route. |
| 2 | **C-18** — an unauthenticated caller can drain the global `/process-key` bucket | **Half false, half WORSE.** A tokenless caller hashes to a *different* bucket and cannot drain the platform's. But **422 validation runs BEFORE slowapi**, so the flag-enumeration path consumes no token and is **completely unthrottled**. |
| 3 | **C-10** — three routers re-declare a private `Limiter` | **Under-scoped — TRAP-5 occurring inside this document.** Enumerating by "private `Limiter()`" yields 3 modules / 8 routes and **misses `optimizer.py:31`**, which is IP-keyed while correctly importing the shared limiter. **Nine sites.** It is also the tightest ceiling on the platform: **20/minute, global**. |
| 4 | **C-10** — key-connect spends "two tokens" | Buckets key on (key, **path**), so validate and encrypt have **separate** 100/hour counters. |
| 5 | **C-15** — slowapi's 429 has no `detail` | **Half right.** The body is `{"error": …}`, not empty; the TS reads `.detail`. A one-line TS fix, not a redesign. |
| 6 | **A-03** — verified against starlette 0.52.1 | Conclusion **survives**, but **prod pins 0.46.2**. The conclusion held; the method wouldn't have. Pin verification to the DEPLOYED version. |
| 7 | *(new)* **X-8** | **Five+ seam-reachable 5xx sites are missing from this doc entirely**, incl. `match.py:1817` (503 for a caller's oversized window) and `match.py:1765/1826` (**raw exception interpolated into user-reachable `detail`**). |

**Contract decision taken (PYAPI-05):** status answers *"is OUR service degraded"*, **not** *"whose
fault is it"*. Conflating the two is the shared root cause of **A-01 and C-12**. Four classes:
CALLER → 4xx, never counts · **CALLER'S EXCHANGE → 424**, never counts · SERVICE-TRANSIENT → 503 +
`Retry-After` + `dependency`, counts per-dependency · SERVICE-PERMANENT → 500 `retryable:false`,
**never** counts (a permanent 5xx must not be able to hold the breaker open — cf. A-12, C-17).

**Lesson for the Stage-2 review workflow:** correction #3 is TRAP-5 (fix the class, not the instance)
occurring *inside the finding that documents TRAP-5*. Enumerating by the shape of the **defect**
("private `Limiter()`") missed a site with the same **behaviour** (IP-keyed) but a different shape.
Red teams must enumerate by BEHAVIOUR, not by syntax.

## PART 7 (cont.) — corrections from RESEARCH-B

| # | Corrected claim | Reality |
|---|-----------------|---------|
| 8 | **C-08** — one unscoped read site | **Both halves CONFIRMED, and there is a THIRD site.** Index `20260510173005_..._drain.sql:83-84` is single-column/non-partial/non-tenant-scoped — **and its own comment at `:72-73` argues that shape is CORRECT**, so a fixer reading the code will agree with the bug. Query: `routers/process_key.py:581` → `services/db.py:71-76` = service-role (RLS-bypassing); pre-check `:722-728` filters on `wizard_session_id` alone. **NEW: the 23505 race-winner re-fetch at `:895-901` is the same unscoped read returning the same three foreign fields.** The class has **two** read sites, not one. |
| 9 | *(new blocker)* `UNIQUE(user_id, wizard_session_id)` is the obvious fix | **Not available** — `strategy_verifications` has **no `user_id` column** (`20260501055202:77-98`). Recommend `UNIQUE(strategy_id, wizard_session_id)`. **The pre-check must MOVE BELOW the `strategy_id` branch before it can be scoped at all** — an ordering change, not just a predicate change. |
| 10 | **C-18** | **Partly REFUTED** (agrees with correction #2, independently): `_process_key_rate_limit_key:104` falls back to the literal `"unauthenticated"`, so a header-less attacker gets its OWN bucket. The flag-enumeration half **stands** — verified by a local pydantic repro. |
| 11 | **C-13** | **Confirmed, but via a route a reviewer would not find**: the leak path is `process-key-client.ts:245-250` → `verify-strategy:194`, which **BYPASSES** the NEW-C35-01 allowlist at `:270-300`. |
| 12 | **C-22** | **Miscounts twice.** Two `ok:false`-at-200 sites on `/process-key` (the third is `routers/csv.py` — a different route), and **SIX** mutually exclusive 200 shapes, not four. |
| 13 | **C-14** | Names two stringify sites; there are **three**. |

**Q4 mechanism decided (PYAPI-09):** **enqueue-aware pre-check, no new SQL.**
`_enqueue_compute_job_internal` (`20260716090000:181+`) already dedupes on `(target, kind)` across
non-terminal statuses and returns the existing id, so re-calling `enqueue_compute_job` on the
duplicate path is safe. That change **plus the pre-check move** fixes C-19 **and** C-20. The
atomic-RPC alternative fixes neither C-20 nor stays inside the phase fence. Redefine `queued` as
"a non-terminal job exists **now**" so the contract is true by construction.

**Pattern across corrections #3, #8, #12, #13:** every under-count came from enumerating by the
**shape** of the known instance rather than by **behaviour**. This is TRAP-5 recurring at the review
layer. Binding on Stage-2 red teams: enumerate by behaviour, then verify the count.

## PART 7 (cont.) — correction #14, from orchestrator source-verification 2026-07-26

| # | Corrected claim | Reality |
|---|-----------------|---------|
| 14 | **H-5** (140.1 code review): the `finalize-wizard` guard is the "**already-shipped**"/"deployed" consumer | **FALSE — and it propagated into four planning artifacts before anyone checked.** The guard is **Phase 140's own commit `57b11813`** ("feat(140-06)") on the SAME unmerged branch. `43449cc6` is **NOT on `origin/main`** (`git merge-base --is-ancestor` fails; `git branch --contains` lists only `feat/v1.16-production-resilience` + the wip archive; `origin/main` = `dfeeeacc`). Phase 140.1 never touched that file (`git diff --stat` on it is empty). **Nothing on this branch is deployed.** |

**The defect is still real and still a merge blocker** — verified end-to-end at source: guard at
`route.ts:1433-1450` (`if ("code" in r || "idempotent" in r) return false;`, commented "mixed
envelope = bug"), miss arm at `:1369-1400` (`console.error` + `captureToSentry("process-key onboard
contract violation")` + **502**). At base `43449cc6` both duplicate arms hardcoded `"queued": False`
(`:754`, `:917`), which the guard's `queued=false` branch **accepts** — that branch permits `code`
and `idempotent`. The regression is solely that PYAPI-09 made `queued` sometimes `true` while
keeping those two fields.

**What the correction changes:** the "the TS guard is deployed, so rollout ordering picks the fix
direction" argument is **fiction**. Both sides land together; the choice is contract quality alone.

**Meta-lesson — the most instructive one of the programme so far.** A *reviewer's incidental framing
word* ("shipped") was adopted as a planning constraint by the orchestrator and written into
CONTEXT.md, a ROADMAP success criterion, a requirement, and a live planner prompt — none of which
were load-bearing on the defect, all of which were load-bearing on the FIX DIRECTION. The programme's
verify-at-source discipline had been applied to reviewers' *findings* but not to their *adjectives*.
**Check the premises you inherit, including the ones nobody flagged as claims.**

## PART 7 (cont.) — corrections #15–#22, from Phase 140.1.1 planning (2026-07-26)

The plan chain (researcher → mapper → planner → plan-checker ×2) was told to report evidence found
WRONG at source. It found eight more, several in artifacts the orchestrator itself wrote.

| # | Corrected claim | Reality |
|---|-----------------|---------|
| 15 | **H-5 "would break the live wizard on merge"** (orchestrator's escalation) | **FALSE — latent, not live.** Zero `wizard_session_id` in any TS caller; the duplicate path requires one (`process_key.py:977-979`). **Third** wrong claim about H-5, after "already deployed" (#14) and this. The defect was real every time; only its severity and constraints were wrong — and those are what decide the fix. |
| 16 | **"`/exchange/validate-key` already handles this correctly"** (code review AND `140.1.1-CONTEXT.md`) | **FALSE.** `read_only is False` appears **exactly twice repo-wide** — `process_key.py:1297` and `long_fetch.py:331`. That route never evaluates it. The real analog is `long_fetch.py:386-397`. |
| 17 | **The research's proposed fix shape for PYAPIFIX-02** | **UNSAFE.** It recommended a **transient denylist**; source shows `long_fetch` uses a **permanent allow-list**. A denylist fails unsafe — **it is literally the existing bug's own shape.** Caught by plan-check *before* execution. |
| 18 | *(new)* `MISSING_SCOPE` reachability | **Must be allow-listed.** `exchange.py:1047-1058` sets `read_only=False` + `error_code="MISSING_SCOPE"` and returns **without** `valid=True`, and it is absent from `long_fetch`'s `permanent_codes` — so without the allow-list entry a **permanent** scope fault becomes a **retryable 424**. |
| 19 | **PYAPIFIX-02 site count** | The review **over- AND under-counted**: its "two sites" are one predicate + its single return, and it **missed `process_key.py:358-359`'s `recoverable` set**, which omits `PROBE_FAILED`/`DDOS_PROTECTION` — **no status-code change fixes that.** |
| 20 | **PYAPIFIX-03 is one site (`internal.py:416-431`)** | **THREE sites.** The **pattern-mapper alone** found `routers/portfolio.py:2266`, and the **same function's second `create_exchange` at `:2316` already answers 500** — in-repo proof the class is real. **The instance-not-class defect the mapper exists to catch; a point-fix would have shipped.** |
| 21 | **"Name PYAPIFIX-02's four TRAP-9 casualty tests"** (orchestrator's instruction) | **They need ZERO edits.** They pin genuine caller faults and **are** the regression fence. Researcher and mapper found this independently. Blindly "updating" them would have deleted the fence — TRAP-9 inverted. |
| 22 | Misc | **M-14 is 2 sites, not 1.** The **pandera constraint is stale** (0.32.1 installed, collection clean). **ROADMAP has 6 success criteria, not 5** (orchestrator's own miscount). Line-cite drift in `internal.py`, `error_contract.py`, and `rate_limit.py` (survivor #8's guard is `:274`, not `:150`). `PATTERNS.md` cited a `test_error_contract*.py` "existing family" that **does not exist**. |

**Two meta-lessons.**
1. **#17 is the highest-value catch of the programme so far** — a *research recommendation* that would
   have re-implemented the bug it was fixing, stopped by the plan-check gate. This is the concrete
   answer to "why not just hand findings to a fixer": a fixer would have implemented the denylist.
2. **#21 inverts TRAP-9.** The programme's lesson had been "plans miss the tests a change invalidates".
   Here the orchestrator over-applied it and named four tests that must NOT change. **Both directions
   are failure modes; the enumeration must be verified, not assumed, in either direction.**
