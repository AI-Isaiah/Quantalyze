# 146-AUDIT — RATE-01 census + RATE-05 disposition

**Cut at execution HEAD: commit `70a8918d` (`feat/v1.19-phase-146`), 2026-08-18.**
This artifact SUPERSEDES both the stale TODOS.md "Rate limiting only on 6 routes"
bullet (retired in TODOS.md with a pointer here) AND the census tables in
`146-RESEARCH.md`, which were cut at the 145 branch tip and are method, not data
(research Pitfall 1). Every output below was produced fresh at this HEAD; no row
is inherited from the research file.

## §1 — RATE-01: the seam-route rate-limit census (fresh, twice-derived)

### Derivation 1 — the living invariant (population derived from disk every run)

Command (exit code captured unpiped; full log retained in the 146-01 SUMMARY):

```
npx vitest run src/app/api/admin/match/eval/route.test.ts \
  src/lib/seam-ratelimit-posture.invariant.test.ts \
  src/lib/api/limiter-ordering.test.ts --no-file-parallelism
# EXIT=0
#  Test Files  3 passed (3)
#       Tests  62 passed (62)
```

Green means, structurally (VERBATIM semantics of the passing gates):
- the from-disk seam walk found ≥14 seam routes and ≥12 `checkLimit` sites
  (vacuity fence);
- the derived limiter population EQUALS the hand-typed
  `EXPECTED_LIMITER_ROUTES` (14 routes, `admin/match/eval` now a member);
- `NO_LIMITER_QUARANTINE` EQUALS the derived no-limiter set — both are `[]`;
- every limiter route routes its deny through the chokepoint ONCE PER ARM
  (15 deny-routed arms ≥ 15 `checkLimit` sites);
- the partition is total.

### Derivation 2 — independent one-off import-edge grep (comment-stripped)

One-off cross-check, NOT a persistent second scanner (the invariant remains the
living gate). Node script walked `src/app/api/**/route.ts`, comment-stripped
each file (block comments blanked, `//` lines dropped — so the two prose
mentions of `rateLimitDenyJson` in the admin/match pair cannot count, research
Pitfall 6), then matched the THREE-module import edge
`from "…(analytics-client|resilient-fetch|process-key-client)"` (two-module
grep would silently drop `keys/[id]/permissions`, which imports ONLY
`resilient-fetch`). Output VERBATIM:

```
src/app/api/admin/match/eval/route.ts  checkLimit=1
src/app/api/admin/match/recompute/route.ts  checkLimit=1
src/app/api/bridge/route.ts  checkLimit=1
src/app/api/keys/[id]/permissions/route.ts  checkLimit=1
src/app/api/keys/sync/route.ts  checkLimit=2
src/app/api/keys/validate-and-encrypt/route.ts  checkLimit=1
src/app/api/portfolio-optimizer/route.ts  checkLimit=1
src/app/api/scenario/optimize/route.ts  checkLimit=1
src/app/api/simulator/route.ts  checkLimit=1
src/app/api/strategies/composite/add-key/route.ts  checkLimit=1
src/app/api/strategies/create-with-key/route.ts  checkLimit=1
src/app/api/strategies/csv-validate/route.ts  checkLimit=1
src/app/api/strategies/finalize-wizard/route.ts  checkLimit=1
src/app/api/verify-strategy/route.ts  checkLimit=1
TOTAL seam routes: 14
CENSUS_EXIT=0
```

### Cross-check verdict

**The two derivations AGREE route-for-route**: 14 seam routes, identical
membership, identical per-route `checkLimit` counts (15 sites total —
`keys/sync` carries two arms), zero no-limiter routes. `csv-finalize` is
ABSENT from both, as expected: it left the seam import edge in Phase 145
(D-06 i-b, direct fold RPC) — its own limiter is unchanged and pinned in its
`route.test.ts`, it is simply no longer a member of this population. No
divergence → no STOP condition.

### The census table (route × limiter × value × key shape × source line)

Limiter values read fresh from `src/lib/ratelimit.ts` (`export const … =
makeLimiter(n, window)`, lines cited); `checkLimit` sites located by
`grep -n "checkLimit(" <route>` at this HEAD. Multi-line call sites cite the
`checkLimit(` line.

| # | Route (`src/app/api/…`) | Limiter | Value | Key shape | Site |
|---|---|---|---|---|---|
| 1 | `admin/match/eval/route.ts` | `adminActionLimiter` (ratelimit.ts:121) | 20/60s | `match-eval:${user.id}` (per admin user) | :157 |
| 2 | `admin/match/recompute/route.ts` | `adminActionLimiter` (:121) | 20/60s | `match-recompute:${user!.id}` (per admin user) | :101 |
| 3 | `bridge/route.ts` | `userActionLimiter` (:97) | 5/60s | `bridge:${user.id}` (per user) | :94 |
| 4 | `keys/[id]/permissions/route.ts` | `userActionLimiter` (:97) | 5/60s | `key-perms:${user.id}` (per user) | :380 |
| 5 | `keys/sync/route.ts` — arm 1 | `keysSyncUserLimiter` (:105) | 30/60s | `keys-sync-user:${user.id}` (per-user ceiling) | :168 |
| 6 | `keys/sync/route.ts` — arm 2 | `userActionLimiter` (:97) | 5/60s | `keys-sync:${user.id}:${strategy_id}` (per user×strategy) | :179 |
| 7 | `keys/validate-and-encrypt/route.ts` | `userActionLimiter` (:97) | 5/60s | `keys-validate-encrypt:${user.id}` (per user) | :143 |
| 8 | `portfolio-optimizer/route.ts` | `userActionLimiter` (:97) | 5/60s | `optimizer:${user.id}` (per user) | :113 |
| 9 | `scenario/optimize/route.ts` | `userActionLimiter` (:97) | 5/60s | `scenario-optimize:${user.id}` (per user) | :151 |
| 10 | `simulator/route.ts` | `simulatorLimiter` (:126) | 20/3600s | `simulator:${user.id}` (per user) | :112 |
| 11 | `strategies/composite/add-key/route.ts` | `userActionLimiter` (:97) | 5/60s | `strategies-composite-add-key:${user.id}` (per user) | :286 |
| 12 | `strategies/create-with-key/route.ts` | `userActionLimiter` (:97) | 5/60s | `strategies-create-with-key:${user.id}` (per user) | :505 |
| 13 | `strategies/csv-validate/route.ts` | `csvValidateLimiter` (:206) | 20/60s | `strategies-csv-validate:${user.id}` (per user) | :201 |
| 14 | `strategies/finalize-wizard/route.ts` | `userActionLimiter` (:97) | 5/60s | `strategies-finalize-wizard:${user.id}` (per user) | :1009 |
| 15 | `verify-strategy/route.ts` | `publicIpLimiter` (:117) | 10/60s | `verify-strategy:${ip}` (per IP — public route) | :59 |

**Post-Task-1 state: all 14 seam routes limited; quarantine empty.** Every deny
arm routes through `rateLimitDenyJson`/`isRateLimitMisconfigured` (the per-arm
chokepoint count in the invariant), so a limiter misconfiguration answers 503,
never a lying 429.

### The stale TODOS bullet, and why every route it named is limited

The retired bullet (TODOS.md, "Rate limiting only on 6 routes") named
`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`,
`admin/partner-import`, `trades/upload`, `intro` as unlimited. Fresh at this
HEAD: the seam members appear in the table above; the three non-seam routes
carry their own inline limiters (VERBATIM):

```
$ grep -n "checkLimit(" src/app/api/admin/partner-import/route.ts src/app/api/trades/upload/route.ts src/app/api/intro/route.ts
src/app/api/admin/partner-import/route.ts:471:  const rl = await checkLimit(adminActionLimiter, `partner-import:${user.id}`);
src/app/api/trades/upload/route.ts:110:  const rl = await checkLimit(userActionLimiter, `trades-upload:${user.id}`);
src/app/api/intro/route.ts:117:  const rl = await checkLimit(userActionLimiter, `intro:${user.id}`);
```

All three are also classified in `limiter-ordering.test.ts`'s CANONICAL bucket,
whose "no stale entries" case proves every classified path still consumes a
limiter.

## §2 — RATE-05: VERIFIED-EXISTING per D-146-1 (fresh-grep receipts)

**Disposition: VERIFIED-EXISTING.** The requirement's substance — "an HOF
composing with `withAuth`; a new route cannot silently ship limiterless" — is
delivered by the existing wrappers plus the two CI gates. The requirement's
named symbol (`withRateLimit`) is NOT minted: a third functionally-identical
wrapper blends conflicting patterns (Rule 7). Locked as D-146-1
(146-CONTEXT.md); each leg re-verified fresh at HEAD `70a8918d`:

### (a) `withAuthLimited` exists and composes `withAuth`

```
$ grep -n "withAuth\b\|export function withAuthLimited\|checkLimit" src/lib/api/withAuthLimited.ts | head -8
6:import { withAuth } from "@/lib/api/withAuth";
8:  checkLimit,
30: *   CSRF + auth + approval-gate  (delegated to withAuth)
43: * Because it composes `withAuth`, every adopting route also gets the
64:  /** Forwarded to withAuth. Defaults to true (approval gate enforced). */
145:export function withAuthLimited<T = undefined>(
```

Current non-test adopters (importer grep):

```
$ grep -rln "withAuthLimited" src/ --include="*.ts" | grep -v test
src/app/api/bridge/route.ts
src/app/api/bridge/outcome/route.ts
src/app/api/bridge/outcome/dismiss/route.ts
src/app/api/allocator/scenario/saved/route.ts
src/lib/api/withAdminAuth.ts
src/lib/api/withAuthLimited.ts
```

### (b) `withAdminAuth` accepts `rateLimitKey`

```
$ grep -n "rateLimitKey" src/lib/api/withAdminAuth.ts | head -4
36:  rateLimitKey?: (user: { id: string }) => string | null;
39:   * supplied, the parsed body is validated BEFORE the `rateLimitKey` limiter
168:    if (options.rateLimitKey) {
169:      const surfaceKey = options.rateLimitKey({ id: user.id });
```

### (c) `withRole` contains no limit call

`withRole` lives in `src/lib/auth.ts:598` (`export function withRole<P = …>`),
not in a dedicated `withRole.ts`. The limiter grep over its ENTIRE module:

```
$ grep -n "checkLimit\|rateLimit" src/lib/auth.ts
(no output — exit 1)
```

### (d) Zero non-test `withRateLimit` symbols repo-wide

```
$ grep -rn "withRateLimit" src/ --include="*.ts" --include="*.tsx" | grep -v test
(no output — exit 1)
$ grep -rn "withRateLimit" src/ --include="*.ts" | wc -l
0
```

(0 occurrences INCLUDING tests — the symbol does not exist anywhere.)

### (e) Both CI gates exist and are non-empty

```
$ wc -l src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/api/limiter-ordering.test.ts
     842 src/lib/seam-ratelimit-posture.invariant.test.ts
     339 src/lib/api/limiter-ordering.test.ts
$ grep -c "it(" src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/api/limiter-ordering.test.ts
src/lib/seam-ratelimit-posture.invariant.test.ts:29
src/lib/api/limiter-ordering.test.ts:8
```

Both ran green at this HEAD (§1 derivation 1). The posture invariant enforces
the roster+quarantine EQUALITIES over a from-disk population; limiter-ordering
enforces the completeness law (`every rate-limited route is classified`) over
`checkLimit(` / `withAuthLimited(` / `rateLimitKey:` consumers.

### The honest residual (restated, not hidden)

- A brand-new no-limiter seam route fails the quarantine equality as a
  FORCING FUNCTION ("decide whether that is intended and write the reason
  down"), not a prohibition — a determined author can still add the route to
  the quarantine with a reason. That is the designed behaviour: the gate
  forces a conscious, written decision; it does not make one.
- No existing wrapper fits an admin GET (`withAuthLimited` targets the
  authed-user shape; `withAdminAuth({rateLimitKey})` is the schema-validated
  admin POST shape) — which is why `admin/match/eval` is hand-wired inline
  like its sibling recompute rather than wrapped.

**Reversal point:** the ship human gate. If the founder holds to the letter of
the requirement's symbol name, the cheapest conforming follow-up is a
documented alias (`export const withRateLimit = …` over `withAuthLimited`'s
limiter step) — deliberately NOT built here (D-146-1 forbids re-opening the
call in-phase).

## §3 — RATE-04: limit-value parity audit — PENDING

Owned by Plan 146-03. Not cut here; do not cite this file for RATE-04 until
that plan lands its section.
