# Runbook — The Vercel→Railway seam circuit breaker

Phases 140 / 140.2 / 141 / 141.1 / 141.2. Every call from a Vercel route to the Railway
analytics service goes through the ONE seam core, `src/lib/resilient-fetch.ts`.
That core carries a circuit breaker backed by Upstash Redis. This covers "is a
circuit open right now?", "why did it trip", "when does it close", and the
several things that look like fixes and are not.

> **⚠️ This is NOT the breaker in [compute-queue.md](./compute-queue.md).** That
> one is a Python per-API-key 429 cooldown — it stamps `api_keys.last_429_at` and
> makes the job worker skip a retry, and it is keyed per exchange API key. THIS
> one is a TypeScript, Upstash-backed circuit on the Vercel→Railway HTTP seam,
> keyed per service dependency. They share the words "circuit breaker" and
> nothing else. If you arrived here chasing a stalled sync job, you want
> compute-queue.md.

All references below are to SYMBOLS (`BREAKER_COOLDOWN_S`, `isBreakerOpen`,
`recordSeamFailure`), never to line numbers — grep for the symbol. The seam's own
comment-citation guard enforces the same rule in code, because coordinates rot
silently and symbols do not.

## Health check first

The breaker's entire state is a handful of Upstash keys. Read them directly. The
wire form below is the one `@upstash/redis` itself uses (POST to the base URL,
body = the command array — read out of the installed SDK, not from memory):

```bash
curl -s -X POST "$UPSTASH_REDIS_REST_URL" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  -d '["MGET","breaker:railway","breaker:mt5-gateway","breaker:supabase"]'
```

Answer decode — `{"result":[...]}`, one slot per key, in request order:

- `null` → no lock has been written for that key, or its key TTL has fully
  expired. **Circuit closed.**
- `open:<armedAtMs>:<expiresAtMs>` (see `encodeBreakerLock`) → a lock exists.
  Compare `expiresAtMs` to now, in **epoch milliseconds**:
  - `expiresAtMs > now` → **circuit OPEN.** Callers on any budget that declares
    this dependency (plus every budget, for `breaker:railway`) are being refused
    with `CircuitOpenError` before any fetch is issued.
  - `expiresAtMs <= now` → **TOMBSTONE, circuit CLOSED.** The key deliberately
    outlives the lock it carries (`BREAKER_LOCK_TOMBSTONE_S`), so "the key
    exists" and "the circuit is open" are different questions. `isBreakerOpen`
    reports CLOSED the moment the *encoded* expiry passes, whatever the key's own
    TTL says. **Do not read key presence as an open circuit** — that is the
    single most likely misdiagnosis on this surface.

A value `decodeBreakerLock` rejects reads CLOSED rather than yielding a
`Retry-After`. It rejects a nonsensical SPAN (`<= 0`, or wider than
`(BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) × 1000` = 90 000 ms) and, since
phase 141.2, an implausible ABSOLUTE expiry — one further into the future than
that same widest span. The absolute check is **one-sided on purpose**: a lock in
the past is the tombstone the close event is derived from.

⚠️ **That is only the READ side, and the sentence that used to stand here stated
it as though it were the whole story** ("decodes to `null` and reads CLOSED").
On the WRITE side a rejected value used to be strictly worse than a corrupt one:
`recordSeamFailure` decided its write from the DECODE, so a corrupt-but-present
value looked "absent", took the `SET NX` arm, and Redis refused it because the
key exists — no lock stored, no transition emitted, and the circuit unable to
open for the rest of that key's TTL on every seam route. Phase 141.2 branches
that write on the RAW value's presence instead, so a corrupt value is
**displaced** by the next recorded failure and the store self-heals. When
triaging, the two halves now read: corruption reads CLOSED, and corruption is
cleaned up by the next trip rather than jamming it.

## What can be open, and what cannot

`breakerKeysFor` builds each call site's check as **its declared dependencies
plus the global key**, read in ONE `mget`:

| Key | Openable at HEAD? | Notes |
|-----|-------------------|-------|
| `breaker:railway` | **Yes — and it is the WIDE one** | The residual global key. Appended to EVERY call site's check, so an open global circuit gates all seam routes at once, including the anonymous public teaser. Carries the failures that name no dependency: transport throws, deadlines, body-read aborts, and any counting status whose dependency is absent or outside the closed set. |
| `breaker:mt5-gateway` | Yes | Only from `exchange.py`'s `_validate_mt5_key` raising `MT5_GATEWAY_UNREACHABLE` at 503. Reached by `POST /api/validate-key`. |
| `breaker:supabase` | Yes | From `portfolio.py`'s `ANALYTICS_ROW_NOT_CREATED` and `match.py`'s `ADMIN_CHECK_UNAVAILABLE` / `ROLE_CHECK_UNAVAILABLE`, all 503. |
| `breaker:kek` | **No** | Its only emitters (`KEK_UNAVAILABLE`, `KEY_UNDECRYPTABLE`) are **500s** — SERVICE-PERMANENT, which never counts. No site at HEAD can open this key. |
| `breaker:egress-proxy` | **No** | Same reason: `EGRESS_PROXY_MISCONFIGURED` is a 500. |

**Only a `503` counts**, so only a `503` can open a per-dependency key. A `500` is
SERVICE-PERMANENT — an operator must act, and counting it would guarantee a
self-sustaining outage where the breaker blocks its own recovery probe. A `424`
never counts either, and its `dependency` field is the **caller's venue**
(`binance`, `deribit`, …), which must never become a breaker key.

So: if you see `breaker:kek` or `breaker:egress-proxy` holding a value, something
outside this module wrote it. That is a finding, not a normal state.

## Why it trips

| Constant | Value | Meaning |
|----------|-------|---------|
| `BREAKER_FAILURE_THRESHOLD` | 5 | Counted failures inside the window before the circuit opens |
| `BREAKER_WINDOW` | `30 s` | The sliding window failures are counted over |
| `BREAKER_COOLDOWN_S` | 30 | How long the lock stays live — and the `Retry-After` the 503 envelope advertises |
| `BREAKER_LOCK_TOMBSTONE_S` | 60 | How much longer the KEY survives than the lock it carries |
| `BREAKER_STORE_TIMEOUT_MS` | 2 000 | Per-command deadline on the breaker's OWN Upstash calls |

**⚠️ THE UNIT IS AN ATTEMPT, NOT A REQUEST.** Since Phase 141 the per-attempt
latch in `resilientFetch` is reset at the top of every loop iteration, so a
retried call whose attempts both fail records **two** failures against
`BREAKER_FAILURE_THRESHOLD`, not one — and reaches the trip in half as many user
requests.

⚠️ **This runbook used to say, flatly, that sustained degradation trips "in 3
user requests instead of 5". That is no longer unconditional**, and the old claim
is named rather than quietly deleted because it is still correct for the traffic
shape it describes. Three conditions have to hold together, and phase 141.2
narrowed two of them:

| condition | who decides it | since |
|---|---|---|
| the call is retry-eligible at all | `retriesForFlow` + the registry maps, **not** the `SEAM_BUDGETS` row | 141.2 / D-01, D-03 |
| the failures carry **no** contractual wait | `hasContractualWait` — a 503 naming a positive `Retry-After` fails fast and records ONE | 141.2 / D-06 |
| both attempts actually fail a **counting** class | `seamBreakerVerdict` — only a counting 503 or a transport failure advances the counter | 141 |

Because every SERVICE-TRANSIENT 503 the analytics service emits carries a
mandatory `Retry-After`, the halved trip point is **not** the mandatory-503 case
— it is the transport/timeout class (throws, deadlines, header-less platform-edge
5xx), which is also the dominant Railway-blip class. For everything else the trip
point is `BREAKER_FAILURE_THRESHOLD` counted failures, unchanged since 140.

The exact numbers are deliberately not reprinted here: they live in
`seam-constants.pin.test.ts`, pinned literal-against-literal, and the per-attempt
doubling is pinned as BEHAVIOUR by the per-attempt-latch case in
`resilient-fetch.retry.test.ts` (delete the latch reset and that case reddens).
Phase 141.2 deleted the pin that asserted the trip count as arithmetic over the
threshold — it could not fail, which is why this paragraph had drifted from the
code without anything going red.

The halved trip point is accepted and deliberate (Phase 141.1 / D-02): a Railway
blip reaching the threshold in counted failures inside `BREAKER_WINDOW` is a real
outage, and containing it sooner is what a breaker is for. Do not "fix" a fast
trip by raising the threshold — that is two decisions, not one (it delays
protection during a real outage, and delays it further still for retried
traffic).

**⚠️ Blind spot worth knowing during a rate-limit incident:** an attempt the
Python limiter refuses answers `429`, which `seamBreakerVerdict` classifies
non-counting, AND is refused **above** the `/process-key` audit write — so a
platform-ceiling drain advances neither the breaker nor the flag-monitor's
denominator. Both instruments read "quiet" while every caller is being refused.
The `429`s themselves are the only signal; look at the Railway logs, not at this
surface.

## When does it close — the recovery band

There is no half-open state, no probe scheduler, no state machine. **Lock expiry
IS the half-open transition**: when the lock expires the next caller passes
through naturally; a success does nothing special, a failure re-increments and
can re-trip.

**⚠️ 30 s is the LOCK's life, not the system's recovery latency.** The failure
counter is never cleared on a trip — `recordSeamFailure` writes only the lock —
so when the lock expires the previous window bucket is still carrying weight, and
whether one failure instantly re-trips depends on WHERE in that bucket the
original trip landed. Measured against real Redis in plan 140.2-01 (R-7), from
two runs that waited the IDENTICAL 32 s:

| trip at window position p | carry-over floor((1−p′)·5) | one failure at +32 s |
|---|---|---|
| 0.05 | 4 ⇒ remaining 0 | RE-TRIPS instantly |
| 0.50 | 2 ⇒ remaining 2 | does NOT re-trip |

**OBSERVED RECOVERY BAND: [30 s, 60 s], alignment-dependent** — that is
`[BREAKER_COOLDOWN_S, BREAKER_COOLDOWN_S + BREAKER_WINDOW]`. The lock's own life
is a flat 30 s (observed [29, 30]); the time until the seam actually **stays**
usable is up to twice that.

Operationally: **a circuit that reopens ~30 s after you watched it close is not
necessarily still-degraded upstream.** It may be window alignment. Wait a full
60 s from the first close before concluding the dependency is still sick.

## Retry — up to 2 attempts, and only where an audit says so

Since Phase 141 some seam calls make **up to two attempts**, with a jittered wait
of `SEAM_RETRY_BACKOFF_MS + random × SEAM_RETRY_JITTER_MAX_MS` = 250–500 ms
between them.

The gate is **not** the `SEAM_BUDGETS` row. It is a required `retriesOverride`
argument fed from the committed idempotency audit in
`src/lib/seam-retry-registry.ts`:

- `RETRY_SAFE_ANALYTICS` — the analytics-seam YES verdicts, keyed by budget key:
  `bridge`, `simulator`, `portfolio-optimizer`, `optimize-weights`.
- `RETRY_SAFE_FLOW_TYPES` — the `/process-key` YES half. **`onboard` alone**, and
  its grant is CONDITIONAL: `retriesForFlow` (same module) refuses the retry
  unless the call's context carries a truthy `wizard_session_id`, because that is
  the antecedent the entry's own evidence rests on and the same truthiness
  predicate the Python flow-type gate applies. It is consulted at the shared
  `postProcessKey` chokepoint, and **a caller that states nothing gets no
  retry** — the default is the safe one, so a future call site cannot inherit a
  retry it has not earned.
- `RETRY_AUDIT_NO_FLOW_TYPES` — the proven-NO half: `teaser`, `csv`, and — since
  141.2 / D-03 — **`resync`**, whose grant was WITHDRAWN. It had been allowlisted
  on the strength of a sentence that a later re-derivation found false and
  deleted, leaving the grant standing; `resync` mints its session server-side, so
  it has no durable key to dedup on and a replay can insert a second draft
  verification row. The re-enable condition is written into its entry. **The
  anonymous public teaser is never retried** either, by construction — it is
  deliberately non-idempotent (every submission mints a fresh session), and it
  shares the `process-key-sync` budget with `csv`.

**Read the counts out of the pins, not out of this page.** `seam-constants.pin.test.ts`
pins which `SEAM_BUDGETS` rows carry a retry, and `seam-retry-registry.test.ts`
pins each map's population against a hand-typed fence. A budget row carrying a
retry does **not** mean calls on it retry: `budgetKeyFor` is many-to-one, so
`process-key-enqueue` serves both `onboard` and `resync` while the audit — and
therefore the actual behaviour — is per flow type, and now per key as well.

If you are asked "did this route retry?", read the registry and `retriesForFlow`,
not the budget row.

### The `Retry-After` fail-fast (Phase 141.1 / D-01, parse semantics since 141.2 / D-06)

**A 503 that NAMES A POSITIVE WAIT is not retried.** Every SERVICE-TRANSIENT 503
the analytics service emits carries a mandatory `Retry-After`
(`error_contract.service_error`), and that wait is orders of magnitude longer
than the jittered backoff — so retrying inside the backoff is near-certain to
fail AND spends a second breaker failure learning that, on billed lambda wall
clock. `hasContractualWait` gates the fall-through, and the loop returns attempt
1's response with its body intact.

**Naming a wait means PARSING to one, not merely carrying the header.** Until
141.2 the gate was a presence test, so a `Retry-After: 0` — which RFC 9110
§10.2.3 defines as "retry now" — and an empty or garbage value all suppressed the
retry. The gate now delegates to `parseRetryAfterSeconds`, the single shared
`Retry-After` parser: **strictly positive seconds, or nothing.** Operationally:

| header value on a 503 | behaviour |
|---|---|
| a positive delta-seconds (what our own contract emits) | fails fast |
| an HTTP-date, WITH the response's own `Date` header | fails fast — a date-form wait is still a wait |
| an HTTP-date, with NO `Date` header to resolve it against | retries (the delta is not knowable from the server's clock) |
| `0`, empty, negative, or unparseable | retries |
| absent | retries |

So **"the response had a `Retry-After`" is not enough to explain a single-attempt
503 in the logs** — read the value. The parsed number is used for nothing else:
it never reaches a sleep, a timer or a log line, so a hostile header still cannot
influence timing. The only 503 emitter we control cannot produce a non-positive
value (`_validate` rejects it); whether the platform edge can is unverified.

Attempt 1's own failure **is** still recorded — the 503 did happen. What is not
spent is the second one.

The jittered backoff is unchanged for the transport/timeout class, which is the
dominant Railway-blip class and carries no response at all, let alone a header to
honour.

### The doubled-compute cost (Phase 141.1 / D-03) — ACCEPTED, not a defect

**A retry on any of the four analytics budgets adds a SECOND CONCURRENT FULL
COMPUTE while attempt 1 is still burning CPU on Railway.** Nothing on the FastAPI
side awaits `request.is_disconnected()`, so attempt 1 is not cancelled when the
Vercel lambda abandons it. The four affected budgets: `bridge` (15 s timeout),
`simulator` (15 s), `portfolio-optimizer` (15 s), `optimize-weights` (30 s).

This is a known, accepted consequence of Phase 141 — server-side request
cancellation is deferred to its own phase with its own soak, and is booked in
`TODOS.md`. Its operational meaning during an incident: **Railway CPU during a
degradation on those four routes can be up to double what the request rate
suggests**, which can itself prolong the degradation. If you are diagnosing
Railway CPU saturation that coincides with seam 503s, this is a live contributing
mechanism, not a red herring.

## Where the signal shows up

`emitBreakerTransition` emits both a local and a remote record for each
transition. **Both exist on purpose — replacing either with the other is a
regression.**

- **Vercel function log**, greppable without a Sentry round trip:
  `[resilient-fetch] seam.breaker.open` / `…seam.breaker.close`, with a payload
  of `{ breakerKey, failures, cooldownS, correlationId }`.
- **Sentry**, `level: "warning"`, tags `surface:seam-breaker` and
  `transition:open|close`. Search `surface:seam-breaker`.

`correlationId` is `<breakerKey>@<armedAtMs>` — **derived from the lock**, so the
open and the close of the same lock share an id. Use it to pair them. A
per-request id could not do this: the request that trips a circuit is never the
request that observes it heal.

`console.warn`, not `error`, and `level: "warning"` on the capture, for the same
reason — a breaker transition is an operational fact and the OPEN half is a
mitigation working. Routing it to `error` would make every recovery look like a
fault.

Two more events worth knowing, both throttled remotely but unconditional in the
console, and both keyed on the `(surface, stage)` pair rather than per budget (an
Upstash outage hitting twelve budgets is ONE incident):

- `seam.breaker.check_failed` — `isBreakerOpen` could not read the store. **The
  breaker just failed OPEN.**
- `seam.breaker.record_failed` — a failure could not be recorded. That failure is
  not counted toward any trip.

Additionally, since Phase 141.1 the counting-5xx **retry** arm logs
`[resilient-fetch] <budgetKey>: attempt N of M returned <status> — retrying after
backoff`. A 503 that is retried and then succeeds is invisible to the user by
design, and this line is the ONLY signal that a dependency is degrading *below*
the breaker threshold. Its absence during a suspected degradation is itself
information.

> **Known gap:** the *fall-through* exit of that same arm is still unlogged, so a
> `Retry-After` fail-fast and a last-attempt surrender are currently
> indistinguishable in the logs (booked as DEF-141.1-06-A). If you see a counting
> 503 surface to the caller with no "retrying" line, it was one of those two and
> the log will not tell you which — check whether the response carried a
> `Retry-After`.

## Fail-open is the doctrine

**Every failure mode of the breaker's own store resolves to "closed, proceed", in
ALL environments, production included.** Client unconfigured, `get` throwing,
malformed value, aborted command — all of it fails open. There is no environment
branch anywhere in the module.

This is a deliberate inversion of `src/lib/ratelimit.ts`, which fails CLOSED on a
production misconfiguration. The mechanisms differ: a silently-disabled rate
limiter removes a regulatory cap, whereas **a breaker that blocks traffic because
its own store is misconfigured has itself become the outage it exists to
prevent.**

Two consequences an operator must internalise:

1. **If `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are absent, there is
   no breaker at all.** The module logs one unconditional warning at load and
   then every circuit reads closed forever. Silence from this surface can mean
   "healthy" or "not installed", and the two look identical from the outside.
2. **A too-tight store deadline silently DISABLES the breaker rather than
   tightening it.** An aborted breaker read fails OPEN.
   `BREAKER_STORE_TIMEOUT_MS` sits at 2 000 ms — an order of magnitude above
   Upstash's REST latency from Vercel — precisely so that healthy round trips do
   not turn into aborts.

## What NOT to do

- **⛔ Do NOT clear the failure counter on trip via `resetUsedTokens`.** This is
  forbidden (TRAP-6). It is a **full-keyspace Lua `SCAN`** against the Upstash
  database **shared with fifteen production limiters**. It is the obvious remedy
  for the [30 s, 60 s] recovery band, and it is the wrong one — the band is
  ACCEPTED and pinned by a measured test so that a future retune moves a number
  rather than a wish.
- **⛔ Do NOT lower `BREAKER_STORE_TIMEOUT_MS` toward observed latency.** See
  above — it disables the breaker instead of tightening it.
- **⛔ Do NOT raise `BREAKER_FAILURE_THRESHOLD` to stop "early" trips.** It is two
  decisions, not one (see *Why it trips*), and both constants are pinned
  literal-against-literal in `seam-constants.pin.test.ts`.
- **⛔ Do NOT add a retry to a budget row to make a route more resilient.** The
  row is not the gate. A retry requires an entry in `seam-retry-registry.ts`
  backed by a written idempotency audit, and the census in
  `resilient-fetch.wiring.test.ts` will redden if a call site acquires or drifts
  a retry without one.
- **⛔ Do NOT declare a dependency a call site cannot reach.** Over-declaration is
  the A-01 direction — one dependency's trip suppressing calls that could never
  touch it. Under-declaration is fail-open, which is the doctrine. **When in
  doubt, declare fewer**; the global key is in every check regardless, so a
  Railway-wide outage still blocks everything.
- **⛔ Do NOT hand-write a lock into Upstash to "force" a circuit closed or open.**
  There is no supported manual override. To end an open circuit early, delete the
  key — but understand that the failure counter survives, so it can re-trip on
  the next failure (see the recovery band).

## Gotcha: the alert can compute correctly and email nobody

The repo's only error-rate alert is the `flag-monitor` cron. Its numerator was
structurally dead until Phase 141.1 repaired it, and even now
`sendErrorRateAlert` only sends when **both** `RESEND_API_KEY` and
`FOUNDER_LP_REPORT_TO` are set — otherwise it returns `action: "alerted"`, logs,
and **no email leaves the system**. Per the standing note in project memory,
`RESEND_API_KEY` may not be set in Vercel production.

**Before treating that alert as live, confirm both env vars are set in Vercel
production.** Otherwise the alert computes correctly and pages nobody, which
looks exactly like "no incidents".

This does not affect `seam.breaker.open` itself — that goes to the Vercel log and
to Sentry directly, neither of which routes through Resend.

## Unverified / check before relying on

- **The `curl` above has not been executed against production by the author of
  this runbook.** The request shape (POST to the base URL, JSON command array,
  `{"result":…}` response) was read out of the installed `@upstash/redis` client
  source, so it matches what the application itself sends; the credentials and
  network path are the unverified part.
- **No breaker key has been observed OPEN in production.** The trip mechanics,
  constants and recovery band come from source and from plan 140.2-01's measured
  Redis runs, not from a production incident.
- **Deleting a lock key** as an early-close is described from the module's read
  semantics (absent key ⇒ closed), not from an executed operation.
- **Sentry search terms** (`surface:seam-breaker`) are derived from the tags
  `emitBreakerTransition` sets, not confirmed against an indexed event. See
  [sentry-triage.md](./sentry-triage.md) for the EU-region and deploy-lag
  caveats that apply to any Sentry lookup here.
