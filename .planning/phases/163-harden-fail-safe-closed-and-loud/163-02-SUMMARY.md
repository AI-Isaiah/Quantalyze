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

# estimateTokens scale (chars/4 over the realized diff), NOT a harness token count.
# 32023 chars of source diff + 23460 chars of this SUMMARY = 55483 / 4 = 13871.
# The plan estimated 50000 (confidence: low). Reported as measured, not rounded
# toward the estimate — the whole point of the pair is to expose the miss.
actuals:
  tokens: 13871
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Limiter sizing derived from a measured EFFECTIVE backend budget (nominal x measured replica count), not from the nominal config literal alone"
    - "Route -> limiter IDENTITY pinned by a hand-typed roster compared against a from-disk derivation, with vacuity fence + arity check + both-polarity needle self-test"

key-files:
  created: []
  modified:
    - src/lib/ratelimit.ts
    - src/app/api/bridge/route.ts
    - src/app/api/portfolio-optimizer/route.ts
    - src/lib/seam-ratelimit-posture.invariant.test.ts
    - src/app/api/bridge/route.test.ts
    - src/app/api/portfolio-optimizer/route.test.ts

key-decisions:
  - "bridgeComputeLimiter = 10/3600s per authenticated user — DERIVED from 10/hour slowapi nominal x 1 MEASURED replica, not inherited from the roadmap's 30x figure"
  - "The inherited 30x mismatch is confirmed, but only because N=1; at 3 replicas the correct size would have been 30, not 10"
  - "userActionLimiter left byte-identical (26 measured consumer routes) — a NEW named limiter is the standing remedy, never a resize"
  - "scenario/optimize deliberately NOT moved (different backend, separately booked L-9) and that decision is now pinned in EXPECTED_ROUTE_LIMITERS"
  - "DEVIATION (Rule 2): the seam roster pins route PATHS not limiter identity, so it could not see the swap (measured: 24/24 green post-swap). A new identity pin was ADDED rather than moved"
  - "A measured ZERO (0 requests / 14 days on both front doors) is recorded as the finding rather than converted into an invented demand estimate"

patterns-established:
  - "Measure the EFFECTIVE budget, not the nominal one: a per-replica in-memory limiter's config literal is a floor of unknown multiple until the replica count is read"
  - "A zero-traffic measurement is a valid derivation input, provided it carries a positive control proving the query shape can return non-zero"

requirements-completed: [SEC-04]

status: complete
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

## Task 2 — `bridgeComputeLimiter` + two route swaps

`src/lib/ratelimit.ts` gained one named export following the family convention
exactly (a `//` block immediately above a single `makeLimiter` call, first line the
literal `// 10/hour per authenticated user — Phase 163 SEC-04 bridge compute.`, window as
a second-scale literal `"3600 s"`). The docblock carries the derivation above, so the
number's justification travels with the code rather than living only in this file.

Both call sites swapped:

| Site | Before | After |
|---|---|---|
| `src/app/api/bridge/route.ts` (post-validation limiter arm) | `checkLimit(userActionLimiter, …)` | `checkLimit(bridgeComputeLimiter, …)` |
| `src/app/api/portfolio-optimizer/route.ts` (post-validation limiter arm) | `checkLimit(userActionLimiter, …)` | `checkLimit(bridgeComputeLimiter, …)` |
| `src/app/api/portfolio-optimizer/route.ts` (5xx token refund) | `userActionLimiter.resetUsedTokens` | `bridgeComputeLimiter.resetUsedTokens` |

The refund had to move with the swap: refunding to `userActionLimiter` after consuming
from `bridgeComputeLimiter` would credit an unrelated bucket while leaving the compute
budget spent. The refund also matters MORE now, not less — an unrefunded token used to
cost the caller a slot for a minute; it now costs one for up to an hour.

The B15 limiter-ordering comment (consume the token only after input validation) is
preserved at both sites, and neither deny body was converged onto `rateLimitDenyJson`
where the route hand-rolls its 429 — the six live 429 contracts enumerated in
`ratelimit.ts` stay intact.

### Prohibitions — both held, diff-verified

- **`userActionLimiter` is byte-identical.** Still `makeLimiter(5, "60 s")` with its
  original comment. The only diff lines mentioning it are prose inside the NEW limiter's
  docblock explaining why it was not reused. Verified by `git diff` filtered to that
  identifier.
- **`src/app/api/scenario/optimize/route.ts` is untouched** — it does not appear in the
  diff at all. It calls a different backend (`/optimize-weights`) whose per-tenant floor
  is a separately booked item (L-9). That decision is also now pinned in the new roster,
  so it stays visible instead of relying on memory.

## DEVIATION — the roster pin had to be ADDED, not moved (Rule 2)

**The plan's Task 2 step 4 rests on a premise that is false at HEAD.** It says to move the
hand-typed roster in `src/lib/seam-ratelimit-posture.invariant.test.ts` so that "a
neutered swap fails BY NAME", and the plan's `must_haves` asserts the same.

That roster (`EXPECTED_LIMITER_ROUTES`) pins **which routes consume a limiter — not which
limiter**. Both `bridge` and `portfolio-optimizer` were already members before this plan,
so swapping their bucket changes nothing it can observe.

**Measured, not assumed:** after completing the limiter swap and before touching any test,
the file was run and reported **24/24 passing**. The entire SEC-04 change was invisible to
the gate the plan nominated to catch it.

Nothing else in the repo pins route→limiter identity either. Checked:
`src/lib/api/limiter-ordering.test.ts` (buckets routes by ORDERING — wrapper / canonical /
no-input / public-IP — never by limiter), and the four route test files (they drive
`checkLimitResult` directly and pass whichever bucket produced the denial).

**Resolution (Rule 2 — missing critical functionality, not an architectural change):** the
pin was **added** in the file the plan named, beside the existing one:
`EXPECTED_ROUTE_LIMITERS`, a hand-typed route → limiter-per-arm map compared against a
from-disk derivation. It carries the anti-vacuity apparatus the file's own conventions
demand:

- a **vacuity fence** — the needle must capture at least 12 limiter identifiers, so a
  renamed/wrapped `checkLimit` cannot silently reduce the comparison to empty-vs-empty;
- an **arity check** — a route with 2 `checkLimit` sites must yield 2 names, or one arm's
  bucket is invisible to the pin (`keys/sync` and `create-with-key` are real two-arm
  shapes, and `keys/sync` uses two DIFFERENT limiters);
- a **both-polarity needle self-test** — a limiter named only in prose must not count. This
  is a live shape, not hypothetical: `portfolio-optimizer`'s docblock now names the very
  bucket it moved away from, so an unstripped scan would read the comment as consumption.

## Task 3 — behavioural 429/503 coverage bound to limiter identity

Both routes already had 429 `RATE_LIMITED` and 503 `SEAM_MISCONFIGURED` coverage. Those
cases drive `STATE.checkLimitResult` directly, so they assert what the route does GIVEN a
denial — identically, whichever bucket produced it. They are not evidence about WHICH
budget the caller spends, and SEC-04 is entirely a claim about which budget.

Added per route (4 cases total): a 429 case and a 503 case that additionally assert, **by
identity**, the limiter instance handed to `checkLimit`. The mock exposes a distinguishable
sentinel rather than `{}`, so "called `checkLimit`" and "called `checkLimit` WITH THE
COMPUTE BUCKET" remain different claims. The 503 case pins that the misconfiguration arm is
unchanged by the swap — an Upstash outage is still OUR outage, not a throttle.

## Anti-vacuity: neuter → RED → restore (performed, not imagined)

Every gate added here was demonstrated able to fail, and the demonstrations were run twice
— once for the structural tier, once for the behavioural.

| Tier | Mutation | Observed result |
|---|---|---|
| Structural (`seam-ratelimit-posture`) | revert `bridge/route.ts` to `checkLimit(userActionLimiter, …)` | **RED — 1 failed / 25 passed.** Only the NEW assertion fires, naming route and both limiters (`derived=[userActionLimiter] pinned=[bridgeComputeLimiter]`). The other 25 stay green, which is exactly why it was needed. |
| Behavioural (both route tests) | same revert | **RED — both new identity cases fail** with `No "userActionLimiter" export is defined on the "@/lib/ratelimit" mock`. The mock exports ONLY the limiter the route should use, so a revert fails loudly at the module boundary instead of silently spending the wrong bucket. |
| Task 1's own verify | — | Observed **RED first**: the derivation was fully written but the gate's `MEASURED`-before-keyword pattern did not match the prose, so it failed (exit 1) before the wording was made to state the measured fact plainly. It is not a gate that passes on arrival. |

**Restore method matters and is recorded:** restores used **byte backups**, never
`git checkout --`, which would have destroyed the uncommitted work in the tree. Each
restore was verified by `shasum` against the pre-mutation backup and, after the Task 2
commit, by an empty `git diff` against the committed route.

## Verification

| Gate | Result |
|---|---|
| `seam-ratelimit-posture.invariant.test.ts` | 26 passed (was 24 — 2 new) |
| `ratelimit.test.ts` + both route tests + posture | 139 passed |
| `audit-coverage.test.ts` + `src/__tests__/contracts` (global scanners) | 126 passed, 1 skipped |
| `tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 3 warnings — all pre-existing, in files not touched by this plan (`ContributionWizardOverlay.tsx`, `EquityChart.tsx`, `SyncPreviewStep.tsx`). Both manifest checks OK. |
| Full vitest suite | see below |

### A full-suite-only red, caught and fixed

The first full-suite run reddened `src/lib/seam-citations.invariant.test.ts`: the new
limiter docblock carried three bare `file.ext:NN` citations, which that invariant forbids
across the whole seam surface. The rule is right, and this docblock is precisely the case
it protects — a coordinate into a ~2000-line Python router goes stale the moment a line is
added above it, and the block's entire value is that a future reader can re-verify the
budget it derives from. Converted to symbol-anchored references (the `@limiter.limit`
decorators on the `portfolio_bridge` / `portfolio_optimizer` handlers, the ASSUMPTION-3
storage note in the `rate_limit.py` module docstring, and `_BRIDGE_USER_RATE_LIMIT` /
`_BRIDGE_USER_RATE_WINDOW_SEC`).

**No file-scoped run could have caught this** — the citation scanner walks the entire seam
surface, so only a full run reddens on it. This is the documented repo hazard, encountered
live.

### Full suite: GREEN — and the intermediate reds were mine, from contention

Final clean run: **806 files passed, 0 failed, 19 skipped; 12599 tests passed, 281
skipped.**

This is recorded honestly because the intermediate runs were NOT green and the reason
matters. Three full runs on effectively the same code gave 1 red, then 9, then 55 — an
escalating count is not a code signal. Diagnosis, measured rather than assumed:

- **54 of the 55 failures were `Test timed out in 5000ms` / `15000ms`**, not assertion
  failures.
- **All 15 failing files were jsdom UI component tests** (factsheet, allocations, scenario
  composer, chart widgets). None touch rate limiting, and none of this plan's six files
  appeared among them.
- **Sampled failures pass in isolation** — `format-percent-contract.test.ts` and
  `StrategyTable.test.tsx` ran 39/39 green on their own.
- **The cause was self-inflicted:** a full suite was running concurrently with `npm run
  lint` and, later, with a second suite. After confirming no stray `vitest` processes
  remained, the clean run finished in **239s** versus 685-888s under contention — and
  passed completely.

The lesson is worth carrying: on this machine a full vitest run must not share the box with
another heavy job, or it manufactures timeout reds that look like regressions.

## Self-Check: PASSED

Files claimed as modified — all present and containing the claimed change:

- `src/lib/ratelimit.ts` — `export const bridgeComputeLimiter = makeLimiter(10, "3600 s");` present
- `src/app/api/bridge/route.ts` — `checkLimit(bridgeComputeLimiter, …)` present
- `src/app/api/portfolio-optimizer/route.ts` — `checkLimit(bridgeComputeLimiter, …)` + refund retargeted
- `src/lib/seam-ratelimit-posture.invariant.test.ts` — `EXPECTED_ROUTE_LIMITERS` present
- `src/app/api/bridge/route.test.ts` — 2 identity cases present
- `src/app/api/portfolio-optimizer/route.test.ts` — 2 identity cases present

Commits verified present in `git log`:

| Task | Commit | Subject |
|---|---|---|
| 1 | `eae0fed45` | `docs(163-02): record the PROD measurement before choosing the limiter size` |
| 2 | `5ae8e06f3` | `feat(163-02): bridgeComputeLimiter — move both compute front doors off the shared bucket` |
| 3 | `76939f74f` | `test(163-02): bind both deny arms to the limiter IDENTITY, with the RED demo recorded` |
| fix | `8cf5ed4f2` | `fix(163-02): symbol-anchor the limiter docblock's citations` |

Claims deliberately NOT made: no live backend duration was measured (see Deferred #1), and
the 14-day zero is reported as a zero rather than converted into a demand estimate.

## Threat model outcome

| Threat ID | Disposition | Status |
|---|---|---|
| T-163-04 — DoS via compute front doors on the 300/h shared bucket | mitigate | **Closed.** Both front doors now sized to the measured effective backend budget. |
| T-163-05 — collateral damage to ~9 (measured: 26) shared surfaces if `userActionLimiter` were resized | mitigate | **Closed.** Shared bucket byte-identical; new named limiter instead. Diff-verified. |

No new security-relevant surface was introduced: no new endpoint, no new auth path, no
schema change. Two existing routes changed which rate-limit bucket they consult.

## Known stubs

None. No hardcoded empty values, placeholder text, or unwired data paths were introduced.

## Deferred / unresolved

1. **Backend request DURATION was not measurable.** There is no observed traffic to time,
   and invoking the endpoints to generate some is prohibited. The only duration figure on
   record is the in-repo `~15s Python round-trip` note, cited as such. If a duration-based
   resize is ever wanted, it needs real traffic first — the honest answer today is that the
   number would be invented.
2. **Railway HTTP log retention is deployment-scoped** (~46 minutes at time of measurement),
   not 14 days. The Vercel side carried the long-window evidence. Worth knowing before
   anyone plans a future measurement task around Railway logs.
3. **The 14-day zero is a real finding, not a proxy for "safe forever".** If these surfaces
   gain real users, 10/hour/user may bind before the backend does for a multi-user tenant.
   The correct response then is to re-measure — the derivation in the docblock is written so
   the next person can redo it rather than inherit it.
4. **`scenario/optimize` remains on `userActionLimiter`** over the `/optimize-weights`
   backend, whose per-tenant floor is the separately booked L-9. Same defect class, out of
   scope here by CONTEXT lock, now visibly pinned in `EXPECTED_ROUTE_LIMITERS`.
5. **RESEARCH §5's "~9 surfaces" estimate for the shared bucket is wrong** — measured 26.
   Not a defect in this plan's output, but the figure is quoted elsewhere and will mislead
   anyone sizing a future limiter against it.

## Files

**Modified**
- `src/lib/ratelimit.ts` — new `bridgeComputeLimiter` export + docblock carrying the derivation
- `src/app/api/bridge/route.ts` — limiter import + one call site
- `src/app/api/portfolio-optimizer/route.ts` — limiter import, call site, refund target, stale comments
- `src/lib/seam-ratelimit-posture.invariant.test.ts` — NEW `EXPECTED_ROUTE_LIMITERS` identity pin (+2 tests)
- `src/app/api/bridge/route.test.ts` — mock retargeted, +2 identity-bound deny cases
- `src/app/api/portfolio-optimizer/route.test.ts` — mock retargeted, +2 identity-bound deny cases

**Created** — `.planning/phases/163-harden-fail-safe-closed-and-loud/163-02-SUMMARY.md`

---

**SEC-04 closed.** Named limiter in place, sized from a measurement taken before the number
was chosen, shared bucket untouched, both routes rewired, the swap made falsifiable on two
independent tiers — each demonstrated RED by neutering and restored by byte backup.



