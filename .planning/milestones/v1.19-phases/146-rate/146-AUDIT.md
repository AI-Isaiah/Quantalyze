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

## §3 — RATE-04 / TS-22: limit-value parity audit (fresh at HEAD `e912e38b`, 2026-08-18)

**Surface note:** this audit covers the FULL current 14-route seam census (§1)
plus the pertinent non-seam Python endpoints — not the requirement's "seven
already-limited routes". That count is an artifact of the stale list RATE-01
replaced (research Open Question 4; full-surface recommended and adopted).
Every number below was re-read from source at THIS HEAD this session; the
146-RESEARCH.md tables were used as method (which files, which comparisons),
never as data. `git diff --name-only 70a8918d..HEAD -- src/app/api
src/lib/ratelimit.ts` is EMPTY, so the §1 census site lines remain valid at
this HEAD verbatim; limiter values were nonetheless re-read directly.

**Two standing caveats (frame every verdict below):**

1. **Python slowapi storage is `memory://` per replica** (ASSUMPTION-3,
   `services/rate_limit.py` docstring; research Pitfall 5). Every Python value
   is a FLOOR ×N Railway replicas, reset on deploy. This audit sizes
   order-of-magnitude only; precision tuning is effort the storage cannot
   honor.
2. **Shared Vercel buckets:** `userActionLimiter` (5/60s, `ratelimit.ts:97`)
   backs ~9 seam surfaces plus `trades/upload` and `intro` — a resize for one
   route resizes all. The remedy recommendation for any such flow is "mint a
   new named limiter" (the codebase's established move, see
   `csvValidateLimiter`'s docblock `:195-206`), never "resize
   userActionLimiter". `scenarioPeerLimiter` (`:175-193`) is a documented
   LOAD-BEARING probe-oracle security control — its docblock must be cited
   before any change proposal touching it (T-146-09; no such proposal below).

**Verdict semantics:** MISMATCH = the two tiers disagree such that plausible
legitimate use produces backend seam 429s the front door permitted (or a
defense-in-depth floor is materially out of the codebase's own pattern), and a
value/bucket change is recommended → exactly one TODOS.md bullet per D-146-4.
CONSISTENT = aligned, or deliberate burst-vs-sustained layering with citation.

### Table A — Vercel limiter values (re-read from `src/lib/ratelimit.ts` at HEAD)

| Limiter | Value | Def line | Seam routes backed (census §1) |
|---|---|---|---|
| `userActionLimiter` | 5/60s | :97 | bridge, keys/[id]/permissions, keys/sync arm 2, keys/validate-and-encrypt, portfolio-optimizer, scenario/optimize, composite/add-key, create-with-key, finalize-wizard (9) |
| `keysSyncUserLimiter` | 30/60s | :105 | keys/sync arm 1 |
| `publicIpLimiter` | 10/60s | :117 | verify-strategy (per IP) |
| `adminActionLimiter` | 20/60s | :121 | admin/match/eval, admin/match/recompute |
| `simulatorLimiter` | 20/3600s | :126 | simulator |
| `csvValidateLimiter` | 20/60s | :206 | strategies/csv-validate |

### Table B — Python slowapi limits (re-read from routers at HEAD)

| Endpoint | Limit | Scope / key | Site |
|---|---|---|---|
| `/optimize-weights` | 20/minute | `optimize_weights` per tenant | optimizer.py:43-45 |
| `/csv/validate` | 30/hour | `csv_validate` per tenant | csv.py:62-64 — **no TS caller**; csv-validate rides `/process-key` |
| `/validate-key` | 100/hour | `validate_key` per tenant | exchange.py:1023-1025 |
| `/encrypt-key` | 100/hour | `encrypt_key` per tenant | exchange.py:1184-1186 |
| `/fetch-trades` | 10/hour | `fetch_trades` per tenant | exchange.py:1227-1229 — **no TS caller** |
| `/match/recompute` | 30/minute | `match_recompute` per tenant | match.py:1626-1634 |
| `/match/eval` | 30/minute | `match_eval` per tenant | match.py:1856-1860 |
| `/portfolio-analytics` | 10/hour | `portfolio_analytics` per tenant | portfolio.py:1575-1577 — **no TS caller** |
| `/portfolio-optimizer` | 10/hour | `portfolio_optimizer` per tenant | portfolio.py:1637-1639 |
| `/portfolio-bridge` | 10/hour | `portfolio_bridge` per tenant | portfolio.py:1899-1901 |
| `/verify-strategy` | 5/hour | `verify_strategy` per tenant | portfolio.py:2204-2206 — **no TS caller**; teaser rides `/process-key` |
| simulator | 20/hour IP-keyed decorator (FINDING-10 quarantined) + in-handler per-user 20/3600s | `req.user_id` | simulator.py:234 (decorator), :111-112 + :136 (user quota) |
| `/process-key` | dynamic: tenant `100/hour` (rate_limit.py:100), anon `30/hour` — **ONE shared platform-wide bucket** (`{scope}:anon`, rate_limit.py:107, :148, :337) — under platform ceiling `500/hour` (:114) | dual decorators | process_key.py:878-879 |
| internal.py permissions probe | 10/min per `key_id`, hand-rolled in-memory token bucket | per key | internal.py:125, :202 |

### Per-flow parity table

A flow = the Vercel route + the Python endpoint(s) its seam call spends tokens
on. Mapping re-derived fresh from route imports at HEAD (`validate-and-encrypt`
calls `validateKey` :309 + `encryptKey` :325; `keys/sync`, `csv-validate`,
`finalize-wizard`, `verify-strategy` import `postProcessKey`;
`composite/add-key` + `create-with-key` import `validateKey`+`encryptKey`),
cross-checked against the `rate_limit.py` docstring token-cost table (:74-93).

| # | Flow | Vercel effective | Python effective | Verdict |
|---|---|---|---|---|
| 1 | bridge → `/portfolio-bridge` | 5/min/user = 300/h | 10/h/tenant | **MISMATCH** (30×) |
| 2 | portfolio-optimizer → `/portfolio-optimizer` | 5/min/user = 300/h | 10/h/tenant | **MISMATCH** (30×) |
| 3 | scenario/optimize → `/optimize-weights` | 5/min/user = 300/h | 20/min/tenant = 1200/h | CONSISTENT ordering (Vercel gates first) — but floor out of pattern, see H-4 |
| 4 | keys/validate-and-encrypt → `/validate-key` + `/encrypt-key` | 5/min/user = 300/h burst | 100/h/tenant binding (2 tokens, two SEPARATE 100/h buckets depleting in lockstep) | CONSISTENT (burst vs sustained layering; legit connect volume ≪ 100/h) |
| 5 | composite/add-key AND create-with-key → same two exchange buckets | 5/min/user = 300/h each | shared 100/h/tenant per bucket | CONSISTENT (same layering; aggregate legit ≪ cap) |
| 6 | keys/sync → `/process-key` (resync) | arm 1 ceiling 30/min/user = 1800/h; arm 2 5/min per (user,strategy) | tenant 100/h + ceiling 500/h | CONSISTENT (layering; resyncs are event-driven, not sustained) |
| 7 | strategies/csv-validate → `/process-key` | 20/min/user = 1200/h | shared tenant 100/h | **MISMATCH** (12×; see below) |
| 8 | strategies/finalize-wizard → `/process-key` | 5/min/user = 300/h | shared tenant 100/h | CONSISTENT (finalize fires once per wizard) |
| 9 | verify-strategy (anon teaser) → `/process-key` anon | 10/min per IP = 600/h **per IP** | 30/h in ONE shared platform-wide anon bucket | **MISMATCH** (structural: per-IP front door cannot see platform-wide exhaustion) |
| 10 | admin/match/recompute → `/match/recompute` | 20/min/admin = 1200/h | 30/min/tenant = 1800/h | CONSISTENT (deliberate 1.5× defense-in-depth floor, match.py:1626-1632 comment) |
| 11 | admin/match/eval → `/match/eval` | 20/min/admin = 1200/h | 30/min/tenant = 1800/h | CONSISTENT (same deliberate sizing, match.py:1856-1860) |
| 12 | simulator → simulator.py | 20/h/user | 20/h/user in-handler (+ quarantined 20/h IP decorator) | CONSISTENT (deliberately matched — simulator.py:111 "match the 20/hour front-door ceiling") |
| 13 | keys/[id]/permissions → internal.py probe | 5/min/user = 300/h | 10/min per key_id = 600/h | CONSISTENT (Python is the looser floor) |

**Unpaired Python rows** (no TS caller at HEAD — dead-side floors, no flow
verdict): `/csv/validate` 30/h, `/fetch-trades` 10/h, `/portfolio-analytics`
10/h, `/verify-strategy` 5/h. Nothing on the seam spends them today; they cost
nothing and guard direct-to-Railway calls.

### The five pre-identified hypotheses — explicit verdicts

**H-1 — bridge/portfolio-optimizer: Vercel permits 30× the Python budget.
CONFIRMED** (rows 1-2; 300/h vs 10/h, both sides re-read fresh). A single
user's legitimate exploration exhausts the Python tenant bucket in ~10 clicks
(~2 minutes at the Vercel-permitted rate), after which the seam answers 429s
the front door said were allowed. **Which side is wrong: Vercel.**
`userActionLimiter` is a generic 5/min sensitive-POST bucket, not sized to
these compute-heavy flows; the Python 10/h is the deliberate compute cap
(audit-2026-05-07 L-0045, portfolio.py:179). Corrected value: mint a NEW named
Vercel limiter (e.g. `bridgeComputeLimiter`, ~10/3600s) for bridge +
portfolio-optimizer so the front door mirrors the backend budget and the 429
carries a truthful Retry-After — per caveat 2, NEVER resize
`userActionLimiter`. → two TODOS bullets (one per flow), values queued per
D-146-4.

**H-2 — validate-and-encrypt dual buckets. CONFIRMED as mechanism, flow
CONSISTENT.** Each connect spends 2 tokens from two SEPARATE 100/h buckets
(`validate_key` exchange.py:1023, `encrypt_key` exchange.py:1184; call sites
route.ts:309/:325 fresh). Because the buckets deplete in lockstep the binding
sustained cap is 100 connects/h/tenant — far above legitimate key-connect
volume — with the 5/min front door as the burst cap. Deliberate layering, not
a defect; no value change recommended, no TODOS bullet.

**H-3 — verify-strategy anon platform bucket. CONFIRMED** (row 9). The Python
anon tier is ONE shared platform-wide bucket ("Everything anonymous shares ONE
bucket", rate_limit.py:148; `f"{scope}:anon"` :337) at 30/h, while the Vercel
tier is per-IP (600/h per IP) — a handful of concurrent anonymous visitors
exhaust the shared bucket and the per-IP front door structurally cannot see
it. **Which side is wrong: neither trivially** — the shared anon bucket is a
deliberate anti-abuse control (its docblock records one anonymous IP draining
the whole platform's window, rate_limit.py:89-91; cited here per T-146-09
before proposing any change). But it is also a hard growth ceiling of ~30
teaser verifications/hour platform-wide. Corrected-value candidate (founder
call): key the anon tier per-IP (`30/h` per IP) or raise the shared tier as
teaser traffic grows. → TODOS bullet.

**H-4 — L-9 `/optimize-weights` per-tenant re-look (post-TS-04). CONFIRMED as
out of pattern (too loose).** Fresh: 20/minute per tenant (optimizer.py:43-45)
= 1200/h vs a max legitimate Vercel-forwarded rate of 300/h (scenario/optimize
5/min) — 4× headroom, where the match.py siblings deliberately size 1.5×
(30/min floor over a 20/min forwarded ceiling). Under caveat 1 the floor is
really 4×N replicas. No user-visible harm (Vercel gates first — row 3
CONSISTENT ordering), so this is a defense-in-depth sizing note, not a UX
defect. Corrected-value candidate: 10/minute per tenant (2× headroom, sibling
pattern); the literal pin in `test_limiter_identity.py` must move in the same
commit. → TODOS bullet.

**H-5 (TODOS "H1" row) — seam retry double-spends Python tokens. CONFIRMED as
live mechanism; decision: RECORD-ACCEPT.** A granted seam retry is a second
HTTP request and burns a second token from the Python limiter — including
`/process-key`'s shared platform ceiling — during exactly the incidents
retries fire in. Exposure was already narrowed by D-01/D-03 (TODOS.md
FINDING-8-residual: only onboard-with-a-key retries today; `resync` no longer
does). **Accepted for this phase:** a retry exemption (retry-marked requests
or token refunds) is a NEW mechanism, out of LIGHT-depth character
(146-CONTEXT founder ruling; research Open Question 3 recommended exactly
this). **Reversal point = the ship human gate.** No TODOS value bullet — this
is a recorded decision, not a value candidate.

### Additional finding (not among the five hypotheses)

**Row 7 — csv-validate vs `/process-key` tenant tier, plus a stale docblock
citation.** `csvValidateLimiter`'s docblock (`ratelimit.ts:195-206`) justifies
20/min by alignment with "the upstream Python service['s] own 30/hour cap"
in `routers/csv.py` — but fresh at HEAD the route does NOT call `/csv/validate`
(no TS caller, Table B): it rides `/process-key` (route.ts:6 imports
`postProcessKey`), whose tenant tier is 100/h SHARED with keys/sync and
finalize-wizard. The docblock's own iteration estimate (3-5 validations/min)
sustained for an hour is 180-300/h > 100/h — plausible legitimate exhaustion
mid-iteration, softened by caveat 1 (×N replicas). Candidates (founder call):
raise `_PROCESS_KEY_TENANT_LIMIT` or add a csv-scoped tier; and fix the stale
docblock citation. Both are code changes under the fence — queued to TODOS,
not touched here (D-146-4).

### Recorded scope decisions

- **Cron surfaces out of scope:** `warm-analytics` and
  `/api/match/cron-recompute` are deliberately unlimited cron/service-key
  surfaces (requirements decision #7 + A2; 146-02 SUMMARY recorded the
  cron-recompute note in rate_limit.py's docstring).
- **Zero live values changed by this phase:** verified by the git-diff gate
  (`git diff --name-only -- src/lib/ratelimit.ts analytics-service/routers/`
  = empty at commit time). Every remediation lives in TODOS.md per D-146-4.

### TODOS candidates filed (5 bullets, D-146-4)

1. Bridge flow: Vercel 300/h vs Python 10/h — mint new named limiter.
2. Portfolio-optimizer flow: Vercel 300/h vs Python 10/h — same remedy, shared
   new limiter with bullet 1.
3. L-9 `/optimize-weights`: 20/min/tenant floor vs 300/h forwarded ceiling —
   candidate 10/min; literal pin moves same commit.
4. verify-strategy anon: 600/h per IP vs 30/h shared platform anon bucket —
   per-IP anon keying or raised tier; anti-abuse docblock cited.
5. csv-validate: Vercel 1200/h vs shared `/process-key` tenant 100/h + stale
   `csvValidateLimiter` docblock citation — tier decision + docblock fix.

## §4 — Phase close (2026-08-18, closed at HEAD `828a881e`)

Phase 146 base: merge-base with origin/main = `8432a0b6`. Wave commits:
`70a8918d`/`f583572c` (146-01), `bad30cf8`/`9323c1cd`/`2030a158` (146-02),
`828a881e` (146-03 §3 + TODOS).

**Success-criteria status (each pointing at its evidence):**

| SC | Status | Evidence |
|---|---|---|
| SC1 — committed census replacing the stale route list | MET | §1 (twice-derived, 14 routes / 15 sites, quarantine empty; stale TODOS bullet retired) |
| SC2 — `admin/match/eval` 429 + Retry-After per user.id | MET | 146-01 (commit `70a8918d`); re-proven green at close: vitest trio 3 files / 62 tests, EXIT=0 |
| SC3 — direct-to-Railway match.py 429s (slowapi) | MET | 146-02 (commit `bad30cf8`); re-proven green at close: full pytest 5178 passed / 89 skipped, EXIT=0; `mypy --strict --follow-imports=silent services/ routers/ models/` — no issues in 91 files, EXIT=0 |
| SC4 — committed value audit, adjustments where wrong | MET as ANALYSIS + QUEUED remediation | §3 (13 flows, 4 MISMATCH verdicts, 5 hypothesis verdicts); value ADJUSTMENTS founder-queued to TODOS.md per locked D-146-4 — ROADMAP SC4 annotated with this disposition |
| SC5 — `withRateLimit` HOF | MET as VERIFIED-EXISTING (D-146-1) | §2 fresh-grep receipts; ROADMAP SC5 annotation |

**Closure discipline (recorded outputs):**

- REQUIREMENTS.md RATE-01..05 all still `- [ ]` — count of `^- \[ \] \*\*RATE-0`
  rows = **5** (verification owns ticks, not execution).
- Phase diff vs merge-base contains **0** files under `supabase/migrations/`
  (`git diff --name-only 8432a0b6...HEAD -- supabase/migrations/ | wc -l` = 0).
- Zero code diffs under `src/lib/ratelimit.ts` + `analytics-service/routers/`
  from plan 03 (Task-1 git-diff gate: `audit-clean`).

**Open reversal points for the ship human gate (surfaced, not absorbed):**

1. **D-146-1 / RATE-05 disposition** — VERIFIED-EXISTING, no `withRateLimit`
   symbol minted; cheapest conforming follow-up is a documented alias (§2).
2. **H-5 retry double-spend RECORD-ACCEPT** — a retry exemption is a new
   mechanism deliberately not built at LIGHT depth (§3).
3. **Five TODOS value candidates** — bridge + portfolio-optimizer new limiter,
   L-9 tighten, verify-strategy anon keying, csv-validate tier + docblock
   (§3; TODOS.md "Phase 146 — RATE-04 value-parity candidates").
