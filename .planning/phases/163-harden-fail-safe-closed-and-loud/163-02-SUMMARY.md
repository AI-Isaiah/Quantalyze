---
phase: 163-harden-fail-safe-closed-and-loud
plan: 02
subsystem: api
tags: [rate-limiting, upstash, slowapi, ratelimit, dos, retry-after]

requires:
  - phase: 163-harden-fail-safe-closed-and-loud
    provides: CONTEXT locked decision — size from measured backend reality, never resize the shared bucket
provides:
  - "A PROD measurement on record BEFORE the limiter number was chosen (replica count, 14-day front-door cadence, positive-control-validated)"
  - "`bridgeComputeLimiter` — a named 10/3600s per-user bucket derived from that measurement"
  - "bridge + portfolio-optimizer front doors moved off the shared `userActionLimiter`"
  - "Roster pin moved in the same commit; deny path falsifiable by limiter identity"
affects: [rate-limiting, seam-posture, future limiter sizing]

actuals:
  tokens: 0
  tasks: 0
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Limiter sizing derived from a measured effective backend budget (nominal x measured replicas), not from the nominal config alone"

key-files:
  created: []
  modified: []

key-decisions:
  - "bridgeComputeLimiter = 10/3600s per authenticated user — derived, not inherited"

patterns-established: []

requirements-completed: []

status: in-progress
---

# Phase 163 Plan 02: bridgeComputeLimiter Summary

## Task 1 — PROD measurement record (2026-08-26)

Read-only throughout. The bridge and optimizer endpoints were **never invoked** to time
them: that would consume real tenant budget and PROD compute. Every number below comes from
config reads, source reads at HEAD, or log *queries*.

### M1 — Backend budgets at HEAD (re-verified; these are the floor)

| Endpoint | Limit | Key scope | Source |
|---|---|---|---|
| `POST /portfolio-bridge` | `"10/hour"` | `partial(tenant_or_platform_key, scope="portfolio_bridge")` | `analytics-service/routers/portfolio.py:1945-1947` |
| `POST /portfolio-optimizer` | `"10/hour"` | `partial(tenant_or_platform_key, scope="portfolio_optimizer")` | `analytics-service/routers/portfolio.py:1684-1686` |
| bridge in-handler per-user window | `30` per `3600` s | per `req.user_id` | `portfolio.py:227-228`, applied at `:2010` |

`/portfolio-optimizer` has **no** in-handler per-user window — `_check_bridge_user_rate` has
exactly one call site (`portfolio.py:2010`, the bridge handler), verified by grep.

### M2 — Replica count (the load-bearing measurement)

The slowapi storage is `memory://` and therefore **per replica** — a recorded repo caveat at
`analytics-service/services/rate_limit.py:117-119`: *"With N Railway replicas every number
above is N× looser."* So the nominal `10/hour` is a floor of unknown multiple until N is
MEASURED. Read from the Railway production service config (read-only, no deploy touched):

- **MEASURED `numReplicas: 1` replica**, in a **single region** (one key in
  `multiRegionConfig`) — so the MEASURED effective per-tenant budget is 10/hour, x1, not x N.
- The deployment log confirms the background worker is co-resident in the same process
  rather than a second replica holding its own bucket: `Worker starting as worker-<id>
  (merged into API)`.

⇒ **N = 1.** The nominal per-tenant `10/hour` IS the effective per-tenant budget. It is not
`10 × N`.

### M3 — Observed PROD front-door cadence (Vercel log query, server-side filtered)

- **Window: 14 days** — the widest the log API accepts. `--since 21d` and `--since 28d` both
  return HTTP 400; `--since 14d` succeeds.
- **Retention proven, not assumed:** a query for the slice `--since 14d --until 13d` on a
  control path returns rows, so the window genuinely reaches 14 days back rather than
  silently clamping to a shorter retention.
- **Positive control (anti-vacuity):** before recording any zero, the same query shape was
  run against a path known to be hit — `requestPath:/api/cron/flag-monitor` — and returned
  rows (500 fetched, capped by the row limit, not by the window). A zero from this query
  shape is therefore a real zero, not a filter-syntax artifact.

| Path (production, 14 days) | Requests |
|---|---|
| `requestPath:/api/bridge` | **0** |
| `requestPath:/api/portfolio-optimizer` | **0** |
| `requestPath:/api/cron/flag-monitor` (control) | non-zero |

**This zero IS the measurement** — per the plan, a measured "unused surface, budget =
backend floor" is a valid and honest derivation. No number was invented to fill the gap.

An unfiltered log dump was also taken but is **not** cited as a 14-day census: the API
returns newest-first and capped the response at 1450 rows spanning only ~68 minutes. The
server-side `requestPath:` filtered queries above are the authoritative evidence, since the
filter is applied across the whole window rather than to a truncated tail.

### M4 — Backend cadence and duration (Railway), with its limitation recorded

- `railway logs --http` defaults to the **most recent successful deployment**, so its window
  is that deployment's lifetime — **~46 minutes** on the day of measurement, **not** 14 days.
  Recorded as a limitation rather than presented as a long-window result.
- In that window: **1** HTTP request to the entire analytics service (a cron POST answering
  401), **0** to `/portfolio-bridge`, **0** to `/portfolio-optimizer`.
- **Request duration could not be measured live** — there were no requests to time, and
  invoking the endpoints to generate some is prohibited. The only duration figure on record
  is in-repo, from the 2026-05-07 audit comment at
  `src/app/api/portfolio-optimizer/route.ts:107-110`: *"The optimizer fires a 15s Python
  round-trip on every call."* Cited as an **in-repo record, not a live measurement.**

### M5 — Key shape: the front door is finer-grained than the backend

| Layer | Bucket subject | Source |
|---|---|---|
| Next.js front door (bridge) | per USER — `` `bridge:${user.id}` `` | `src/app/api/bridge/route.ts:94` |
| Next.js front door (optimizer) | per USER — `` `optimizer:${user.id}` `` | `src/app/api/portfolio-optimizer/route.ts:112-113` |
| Python backend (both) | per TENANT | `portfolio.py:1945-1947`, `:1684-1686` |

A per-user front-door allowance must be `<=` the per-tenant backend budget, or a single user
can exhaust the whole tenant and hit a backend 429 the front door never saw.

### M6 — Shared-bucket collision surface (measured; corrects the research estimate)

**26** non-test `route.ts` files consume `userActionLimiter`. Counted with comment lines and
import specifiers stripped, so the two doc-only mentions — `strategies/composite/members`
and `strategies/wizard-draft`, whose comment literally reads *"NO rate limiter:
userActionLimiter buckets are for mutations"* — are correctly excluded. Two of the 26 leave
in this plan, so **24** remain sharing the bucket. RESEARCH §5 estimated "~9 surfaces"; the
measured figure is 26.

### DERIVATION — the arithmetic

```
effective per-tenant backend budget
  = 10 req/hour            (slowapi nominal, M1)
  x 1 replica              (MEASURED, M2 — not assumed)
  = 10 req/hour per tenant
```

The bridge's in-handler per-user cap of `30 / 3600 s` is **looser** than 10/hour/tenant, so
it never binds first. The binding backend constraint on both endpoints is the tenant's
10/hour.

The front door is keyed per user, the backend per tenant (M5). For the front door to deny
**before** the backend — which is the entire point, so the `Retry-After` the caller receives
is the truthful one — the per-user front-door allowance `n` must satisfy:

```
n per 3600 s  <=  10 per 3600 s
```

Bounding the choice from both sides:

- **n > 10** reproduces the defect being closed: the front door advertises budget the
  backend will not serve, so callers burn requests into a backend 429 whose `Retry-After`
  the front door never observed and cannot relay.
- **n < 10** denies requests the backend would happily have served. With **0** observed
  requests across 14 days (M3), there is no measured demand justifying restriction tighter
  than the backend's own budget.
- **n = 10** makes the front door's per-user ceiling exactly equal the backend's per-tenant
  ceiling. For a single-user tenant — the only tenant shape with any measured traffic, namely
  none — both deny at the same point, and the front door reaches it first because it is
  checked first.

**Chosen: `bridgeComputeLimiter = makeLimiter(10, "3600 s")` — 10 req/hour per authenticated user.**

### Why this is derived and not merely inherited

The prior figure on record was "≈10/3600s", and the ROADMAP's inherited mismatch figure was
"30×". Both are **confirmed** by this measurement — but only because N = 1:

```
current front door = 5 per 60 s = 300 req/hour per user
effective backend  =              10 req/hour per tenant
mismatch           = 300 / 10   = 30x        <- inherited figure, now MEASURED-true at N=1
```

Had the service been running 3 replicas, the effective backend budget would have been
30/hour, the true mismatch 10×, and the correct limiter size 30 — not 10. The replica read
(M2) is precisely what turns 10 from a number that mirrors a config literal into a number
derived from the effective budget. That is the drift trap CONTEXT named, and it was checked
rather than assumed.

### The user-facing harm this closes

`userActionLimiter` is `5 / 60 s`, so its denial can only ever emit `Retry-After <= 60`.
The backend's `10/hour` bucket can require a wait of up to `3600` seconds. Today's front door
can therefore understate the real wait by up to **60×**, and does so while claiming a budget
30× larger than the backend will honor.

<!-- gsd:write-continue -->

