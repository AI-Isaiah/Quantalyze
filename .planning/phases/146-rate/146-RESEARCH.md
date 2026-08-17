# Phase 146: RATE — Audit + close the two verified gaps — Research

**Researched:** 2026-08-18
**Domain:** Rate limiting across the Vercel (Next.js/Upstash) and Railway (FastAPI/slowapi) tiers
**Confidence:** HIGH — every claim below was verified by reading source files this session; zero new external dependencies

> ⚠️ **CODE-STATE WARNING — READ FIRST.** Every grep, census, line number, and file citation in
> this document was taken at the **Phase-145 branch tip** — worktree
> `/Users/helios-mammut/claude-projects/quantalyze-145`, branch `feat/v1.19-phase-145`, commit
> `c96f549b409033a310f7c8f3cd2c61c6b238099d` (which includes a merge of `origin/main`) — because
> the MAIN checkout is stale for csv-finalize surfaces. That branch is minutes from merging.
> **Every census here MUST be re-run at plan time and again at execution kickoff, post-merge.**
> Phase 146 is sequenced last precisely because its deliverable is a fresh grep — a stale grep
> reads as coverage it does not have (ROADMAP.md:77). RATE-01's committed artifact is the re-run,
> not this file.

## Summary

The RATE group's premise was corrected once already (v1.16 research, `.planning/research/SUMMARY.md:16`): the "seven unlimited routes" in the stale `TODOS.md` bullet were all limited by 2026-07-23. Since then, Phases 140.1–140.4 built substantially MORE of Phase 146's machinery than the requirements (written 2026-07-25) assume. The central finding of this research: **three of the five RATE requirements are partially or largely pre-satisfied by shipped CI invariants, and the phase's real work is (a) two small, precisely-fenced code changes with same-commit test-roster updates, (b) a value audit whose input tables are already assembled below, and (c) four ledger obligations (TS-21, TS-22, TS-23-remainder, TS-36) that the requirement texts do not name but that are formally assigned to Phase 146.**

Specifically: RATE-01's grep exists as a *living, from-disk-derived CI test* (`src/lib/seam-ratelimit-posture.invariant.test.ts`) that enumerates the seam-route population every run; RATE-05's "HOF that composes with withAuth" exists as `withAuthLimited` (`src/lib/api/withAuthLimited.ts`, shipped audit-2026-05-07) plus `withAdminAuth({ rateLimitKey })`, and RATE-05's "no CI gate" premise is stale — two independent CI gates now fail any new seam route that ships without a limiter decision. The two genuine gaps are exactly as verified in v1.16 research and re-verified here at the 145 tip: `admin/match/eval` (RATE-02) and Python `routers/match.py` (RATE-03).

**Primary recommendation:** Plan this as a short mechanical phase (founder-ruled LIGHT depth, TODOS.md § review-depth table): Plan 1 = RATE-01 census artifact + RATE-04/TS-22 value audit + adjustments; Plan 2 = RATE-02 (eval limiter, mirroring recompute inline) + RATE-03/TS-21 (match.py slowapi) + TS-36 (tenant-claim parity pytest) + TS-23 remainder (bare-scalar 429 migration) — each change carrying its same-commit test-roster updates enumerated in "Common Pitfalls" below; RATE-05 resolved as a recorded met-by-existing-means decision (founder-decision candidate, see Open Questions).

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| RATE-01 | Kickoff re-grep → authoritative gap list replacing stale TODOS route list | The population derivation ALREADY exists as CI machinery (`seam-ratelimit-posture.invariant.test.ts` — 14 seam routes, 13 limited + 1 quarantined); artifact = dated census commit + retire stale `TODOS.md` bullet (worktree TODOS.md:866-868). See "RATE-01" section. |
| RATE-02 | `admin/match/eval` rate limit keyed on `user.id`, sized to eval-tooling cadence | Verified no-limiter at 145 tip; sibling `admin/match/recompute` is the exact pattern to mirror; three client consumers enumerated (cadence = mount + lookback flips, not polling). Three test rosters must move in the same commit. See "RATE-02" section. |
| RATE-03 | Python `match.py` (`/recompute`, `/eval`) slowapi limits mirroring `portfolio.py` | Verified zero limiter (`test_match_routes_still_have_no_limiter` pins the gap and goes RED on close); tenant claims ALREADY on the wire from TS side (inert); exact decorator pattern + 4 pytest gates that must move same-commit enumerated. See "RATE-03" section. |
| RATE-04 | Audit existing limiter VALUES against real Python-side cost, adjust where wrong | Full both-sides value tables assembled below (13 Vercel routes × limiters; 12 Python endpoints × limits); 4 concrete mismatch candidates pre-identified; `test_limit_value_is_unchanged_by_the_rekey` pins Python values as literals. See "RATE-04" section. |
| RATE-05 | `withRateLimit(handler, limiter)` HOF composing with `withAuth`/`withRole`; no silent limiterless new route | **Premise partially stale**: `withAuthLimited` (composes `withAuth`) + `withAdminAuth({rateLimitKey})` exist; two CI gates (seam-posture equality + limiter-ordering completeness) already fail an unclassified new limiter/seam route. Gap: `withRole` has no limiter hook; no wrapper fits an admin GET. Founder-decision candidate on satisfaction-by-existing-means. See "RATE-05" section. |

</phase_requirements>

## Project Constraints (from CLAUDE.md / memory / founder rulings)

- **Review depth = LIGHT** (founder ruling, TODOS.md review-depth table, both checkouts): "researcher + planner + ledger, no deep review round. Self-described mechanical… Nothing in it can silently corrupt data or money." Keep the Falsifiability Ledger and Oracle Independence checklist regardless.
- **Every test must be able to fail** — neuter→observe RED→restore for each new gate.
- **pytest ONLY from `analytics-service/`** (repo-root runs cause VCR cassette misses → LIVE broker calls); use `python3`.
- **Run `mypy --strict` before shipping analytics-service changes**; fix via `cast()` not `# type: ignore`.
- **CI = Node 22 vs local Node 25** — CI-only vitest failures are real; `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal`.
- **Coverage is a blocking CI gate** (lines 82 / stmts 80 / fns 74 / branches 72 vitest thresholds).
- **Local vitest**: use `--no-file-parallelism` to avoid flakes.
- **Commit workflow**: `/ship` not `/gsd-ship`; feature branch + PR; never bundle commit with edits.
- ⚠️ **Migration-timestamp constraint (self-expiring 2026-08-19 12:00 UTC)** — recorded verbatim from worktree TODOS.md:2819-2823: the Phase-145 fold migration is stamped `20260819120000` (future-dated at merge). *"Until that instant, any OTHER migration must carry a timestamp ABOVE it or it trips the backdated-migration guard. Phase 146 planning: if 146 ships a migration before Aug 19 noon UTC, stamp it `2026081913…`+."* **Phase 146 as scoped needs NO migration** (all changes are TS + Python application code), so this constraint should be moot — but if any plan mints one, the stamp rule is binding.
- **Repo is PUBLIC and `.planning/` is tracked** — this file is world-readable on push; keep PROD identifiers already-public-grade (project refs below already appear throughout `.planning/`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-user/per-IP request throttling (429) | API route handlers (Next.js, Upstash sliding window) | — | User-facing quota; keyed on `user.id`/IP; distributed store (Upstash) shared across Fluid Compute instances |
| Defense-in-depth platform throttling | Python service (FastAPI + slowapi) | — | Guards against a leaked `X-Service-Key` bypassing Vercel entirely; keyed by `tenant_or_platform_key`; storage is `memory://` per replica (documented ASSUMPTION-3) |
| Limiter misconfiguration → 503 (not 429) | `src/lib/ratelimit.ts` chokepoint (`rateLimitDenyJson`/`isRateLimitMisconfigured`) | — | Single-sourced 503-vs-429 decision; routes own only body + extra headers |
| New-route structural enforcement | CI invariant tests (vitest + pytest) | — | `seam-ratelimit-posture.invariant.test.ts` (TS, population derived from disk), `test_limiter_identity.py` (Python, registered-limit set is a literal) |
| Tenant identity across the seam | `src/lib/tenant-claim.ts` mint → `services/rate_limit.py:verify_tenant_claim` | — | Signed `X-Tenant-Claim`; already sent (inert) on both match wrappers; TS-36 owes the Python-side parity pytest |

## Standard Stack

No new libraries. Everything needed is already a pinned dependency:

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@upstash/ratelimit` | 2.0.8 (per `ratelimit.ts:411` docblock, hand-typed timeout sentinel) | Vercel-side sliding-window limiters | Already in `package.json` `[VERIFIED: src/lib/ratelimit.ts:2-3, 411-422]` |
| `@upstash/redis` | in-repo | Limiter store | Already wired `[VERIFIED: src/lib/ratelimit.ts:54-57]` |
| `slowapi` | `==0.1.10` | Python-side limits | `[VERIFIED: analytics-service/requirements.txt:226 — "slowapi==0.1.10"]` |

**Installation:** none. **Package Legitimacy Audit:** N/A — this phase installs zero packages. If a plan proposes adding one, that is scope drift; refuse.

## RATE-01 — the re-grep, and what already exists

### The population, derived at 145 tip (MUST be re-derived post-merge)

The seam-route population is defined by an import edge on THREE modules, not two — `analytics-client`, `resilient-fetch`, `process-key-client` — per the shipped invariant `[VERIFIED: src/lib/seam-ratelimit-posture.invariant.test.ts:73-77]`:

```ts
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;
```

RATE-01's requirement text says "either seam client" (two modules); the invariant's three-module edge is the correct predicate — `keys/[id]/permissions/route.ts` imports ONLY `resilient-fetch` and would be silently dropped by a two-module grep `[VERIFIED: grep at 145 tip — resilient-fetch importers include src/app/api/keys/[id]/permissions/route.ts, which is absent from the analytics-client/process-key-client importer list]`.

**Census at `c96f549b` — 14 seam routes: 13 with `checkLimit`, 1 without** `[VERIFIED: seam-ratelimit-posture.invariant.test.ts:179-213, quoted verbatim]`:

```ts
const EXPECTED_LIMITER_ROUTES: readonly string[] = [
  "src/app/api/admin/match/recompute/route.ts",
  "src/app/api/bridge/route.ts",
  "src/app/api/keys/[id]/permissions/route.ts",
  "src/app/api/keys/sync/route.ts",
  "src/app/api/keys/validate-and-encrypt/route.ts",
  "src/app/api/portfolio-optimizer/route.ts",
  "src/app/api/scenario/optimize/route.ts",
  "src/app/api/simulator/route.ts",
  "src/app/api/strategies/composite/add-key/route.ts",
  "src/app/api/strategies/create-with-key/route.ts",
  "src/app/api/strategies/csv-validate/route.ts",
  "src/app/api/strategies/finalize-wizard/route.ts",
  "src/app/api/verify-strategy/route.ts",
];
const NO_LIMITER_QUARANTINE: readonly string[] = [
  "src/app/api/admin/match/eval/route.ts",
];
```

⚠️ **Phase 145 already changed this population**: `csv-finalize` LEFT the seam (direct fold RPC, D-06 i-b) — its comment sits inside the roster `[VERIFIED: same file :190-193 — "Phase 145 (D-06 i-b): csv-finalize left the seam import edge (direct fold RPC)."]`. This is the concrete proof that a pre-merge grep would be wrong, and why the RATE-01 artifact must be cut post-merge.

- `cron/flag-monitor` mentions `postProcessKey` only in comments — NOT a seam importer `[VERIFIED: src/app/api/cron/flag-monitor/route.ts:201-250 — all four matches are docblock prose]`.
- `cron/warm-analytics` is `CRON_SECRET`-gated and hits only `/health` — stays OUT of scope per locked requirements decision #7 `[VERIFIED: src/app/api/cron/warm-analytics/route.ts:33-34 auth check; REQUIREMENTS.md:33]`.

### What the artifact should be

The stale list RATE-01 replaces is the TODOS bullet naming six routes (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro`) as "unlimited → arbitrary quota burn" `[VERIFIED: quantalyze-145/TODOS.md:866-868]`. All are limited today. The requirement asks for a *committed artifact*; the invariant test is the *living* version of the same derivation. Recommendation: the artifact is a dated census table (route × limiter × value × key shape — the RATE-04 table below IS that table) committed under `.planning/phases/146-rate/`, plus retiring/annotating the stale TODOS bullet. **Do not build a second scanner** — the invariant already runs every CI pass and self-tests both polarities of its needle (`:497-594`).

## RATE-02 — `admin/match/eval`

### Verified current state (145 tip)

- `GET` handler, manual auth: `createClient()` → `getUser()` → `isAdminUser(supabase, user)` → 403; then `evalMatch(…, { userId: user.id })` `[VERIFIED: src/app/api/admin/match/eval/route.ts:129,147,156-164]`. No `checkLimit` anywhere in the file (it is the quarantined no-limiter seam route).
- `maxDuration = 300`, spends the `match-eval` 30 s seam budget `[VERIFIED: route.ts:38 + docblock :30-37]`.
- Real cadence (for sizing): `MatchEvalDashboard.tsx` fetches once per mount and once per `lookback`/`partnerTag` change — no polling `[VERIFIED: src/components/admin/MatchEvalDashboard.tsx:54-92 — useCallback(load) + useEffect(() => { load(); }, [load])]`. Consumers: `MatchEvalDashboard`, `admin/partner-pilot/[partner_tag]/page.tsx`, `admin/partner-roi/page.tsx`.

### Prescription

Mirror the sibling `admin/match/recompute` inline shape — it is the identical auth shape (admin, manual `isAdminUser`) and already carries the SEAMUX-03 `{error, code}` deny bodies:

```ts
// Pattern source: src/app/api/admin/match/recompute/route.ts:12,101 [VERIFIED]
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
// after the isAdminUser gate, before evalMatch:
const rl = await checkLimit(adminActionLimiter, `match-eval:${user.id}`);
if (!rl.success) return rateLimitDenyJson(rl, { /* recompute's body/header shape */ });
```

- **Limiter choice (Claude's-discretion recommendation):** reuse `adminActionLimiter` (20/min per user) `[VERIFIED: src/lib/ratelimit.ts:119-121 — "20/minute per IP — admin actions that burst during normal use (match recompute, partner imports)"]`. 20/min comfortably covers mount + lookback-flipping across three admin surfaces, matches the sibling, and avoids minting a new bucket. Key on `user.id` per the requirement (note the module comment says "per IP" but recompute keys it `match-recompute:${user.id}` — key on user.id, matching the sibling and the requirement).
- Deny bodies: copy recompute's exactly — 503 `{error:"Rate limiter unavailable", code:"SEAM_MISCONFIGURED"}`, 429 `{error:"Too many requests", code:"RATE_LIMITED"}`, `Retry-After` + `Cache-Control: private, no-store` `[VERIFIED: seam-ratelimit-posture.invariant.test.ts:798-833 behavioural pins for recompute]`.
- Placement: after admin gate (auth→validate→limit; a GET with query params only → `NO_INPUT` bucket in limiter-ordering, below).

### The three test rosters that MUST move in the SAME commit (or CI reds)

1. `seam-ratelimit-posture.invariant.test.ts` — add eval to `EXPECTED_LIMITER_ROUTES` AND shrink `NO_LIMITER_QUARANTINE` to `[]`. The quarantine is an EQUALITY by design: *"IF IT IS EVER GIVEN A LIMITER, THIS QUARANTINE MUST SHRINK IN THE SAME COMMIT"* `[VERIFIED: :203-213]`. The deny must be chokepoint-routed ONCE PER ARM (`denyRoutedSites >= checkLimitSites`) `[VERIFIED: :256-277]`.
2. `src/lib/api/limiter-ordering.test.ts` — COMPLETENESS gate: *"every API route that consumes a rate-limit token … MUST be classified in exactly one bucket"* `[VERIFIED: :9-15]`. Classify eval as `NO_INPUT` (limiter, no request body).
3. ⚠️ Comment trap, self-tested in the invariant: eval's source already contains the PROSE "Same pairing as rateLimitDenyJson (…)" in a comment — the scanner comment-strips before counting, so the real call must be added, and the eval entry in the invariant's own docblock (`:94-100`) referencing eval-as-no-limiter becomes stale prose to update.

## RATE-03 — Python `routers/match.py`

### Verified current state (145 tip)

- `POST /recompute` (`match.py:1623` decorator `@router.post("/recompute")`, handler `async def recompute(req: RecomputeRequest)`) and `GET /eval` (`:1841`, `async def eval_metrics(lookback_days…, partner_tag…)`) carry NO `@limiter.limit` and — critically — **neither signature has a `request: Request` parameter** `[VERIFIED: match.py:1623-1627, 1841-1851]`.
- The gap is pinned by an executable note that goes RED the day it is closed: `[VERIFIED: analytics-service/tests/test_limiter_identity.py:589-602, quoted]`:

```python
def test_match_routes_still_have_no_limiter(self) -> None:
    """RATE-03 / Phase 146's gap, recorded as an executable note. ..."""
    import routers.match  # noqa: F401
    assert not [n for n in rl.limiter._route_limits if n.startswith("routers.match.")]
    assert not [n for n in rl.limiter._dynamic_route_limits if n.startswith("routers.match.")]
```

- The TS side ALREADY sends the tenant claim on both wrappers, deliberately inert: *"TS-04: INERT — /api/match/recompute has NO Python limiter at all (TS-21, owned by Phase 146). Sent anyway"* `[VERIFIED: src/lib/analytics-client.ts:922-925; evalMatch passes tenantId: tenant.userId :951-957]`. So tenant bucketing works the moment the decorator lands — no TS change needed.
- `POST /cron-recompute` also has no limiter `[VERIFIED: match.py:1900]` — recommend recording it OUT of scope, mirroring requirements decision #7 (cron, service-key-gated, different threat model). The Python cron loop does not traverse `/recompute`'s HTTP surface.

### Prescription — mirror `portfolio.py`'s pattern EXACTLY (syntax, not values)

```python
# Pattern source [VERIFIED: analytics-service/routers/portfolio.py:1575-1577]:
@router.post("/portfolio-analytics", response_model=PortfolioAnalyticsResponse)
@limiter.limit(
    "10/hour", key_func=partial(tenant_or_platform_key, scope="portfolio_analytics")
)
async def portfolio_analytics(request: Request, req: PortfolioAnalyticsRequest) -> ...
```

Apply as `scope="match_recompute"` / `scope="match_eval"`. **Value sizing is discretion, but the sizing logic is fixed:** these limiters are defense-in-depth against a leaked `X-Service-Key`, NOT the user quota — the Vercel tier owns the quota. Therefore each Python value must sit AT OR ABOVE the maximum legitimate Vercel-forwarded rate, or the mirror throttles legitimate admins: recompute is forwarded at ≤20/min per admin (adminActionLimiter), eval likewise post-RATE-02. Recommendation: `"30/minute"` per tenant on both (comfortably above 20/min forwarding, brutally below an unauthenticated-loop abuse rate). ⚠️ Do NOT copy portfolio.py's `10/hour` VALUE — that would be 120× tighter than the Vercel tier forwards for recompute.

### The five pytest/structural gates that MUST move in the SAME commit

1. **Delete `test_match_routes_still_have_no_limiter`** — its own docstring orders it: *"goes red the day someone closes it so the note gets deleted instead of rotting"* `[VERIFIED: :589-596]`.
2. **`test_rate_limited_route_set_is_a_literal`** — the registered-static-limit set is `{IP_KEYED_CLASS rows} | {simulator}` compared by equality `[VERIFIED: :551-569]`; new `routers.match.*` entries must be added explicitly. ⚠️ Do NOT add match rows to `IP_KEYED_CLASS` itself — that table is the enumerated PYAPI-03 defect class with `EXPECTED_CLASS_SIZE = 9` asserted `[VERIFIED: :92, :457-459]`; match routes were never IP-keyed. Extend the `expected` union in the literal test instead.
3. **`test_every_registered_router_limit_is_shared_or_quarantined`** — every registered limit's `key_func` must be `functools.partial` of `rl.tenant_or_platform_key` `[VERIFIED: :571-587]`. The prescription above satisfies this by construction; any bespoke key fails CI.
4. **`test_scopes_are_distinct_so_no_two_routes_share_a_bucket`** `[VERIFIED: :286]` — new scopes must be unique strings.
5. **slowapi signature requirement** — the decorated handler MUST take a parameter literally named `request` (slowapi's `__evaluate_limits` checks for it); both match handlers currently lack it and must gain `request: Request` `[VERIFIED: services/rate_limit.py module docstring — "slowapi decides whether to pass the request by checking for a parameter literally named request"; portfolio.py handlers all carry it]`. `functools.partial` preserves the check (same docstring).

Also update the two now-false prose sites: `services/rate_limit.py` docstring's *"⚠️ No limiter at all: routers/match.py …RATE-03 / Phase 146 owns adding one"* `[VERIFIED: docstring, near end]`, and `analytics-client.ts`'s two "INERT … owned by Phase 146" comments (`:922-925`, `:930-940`).

### Behavioral note for `/eval` (from TS-21 ledger row)

*"`/eval` is now load-bearing: plan 140.1-04 changed its paginator-cap answer from 503 to 400, which removed the accidental back-pressure the old 503 provided via the breaker"* `[CITED: .planning/phases/140.1-*/140.1-TS-OBLIGATIONS.md:733]` — i.e. the limiter is now the only back-pressure `/eval` has.

## RATE-04 — the value audit (input tables pre-assembled)

**The audit artifact compares these two tables, per user-visible flow.** Every value below read from source this session at 145 tip; re-verify at execution.

### Vercel-side (Upstash, distributed, per the stated key)

| Route | Limiter | Value | Key shape | Source |
|---|---|---|---|---|
| admin/match/recompute | adminActionLimiter | 20/min | `match-recompute:{user.id}` | `[VERIFIED: route.ts:12,101]` |
| bridge | userActionLimiter | 5/min | `bridge:{user.id}` | `[VERIFIED: route.ts:18,94]` |
| keys/sync (arm 1) | keysSyncUserLimiter | 30/min | `keys-sync-user:{user.id}` | `[VERIFIED: route.ts:168]` |
| keys/sync (arm 2) | userActionLimiter | 5/min | per-(user,strategy) | `[VERIFIED: route.ts:179-180]` |
| keys/validate-and-encrypt | userActionLimiter | 5/min | `keys-validate-encrypt:{user.id}` | `[VERIFIED: route.ts:18,143]` |
| keys/[id]/permissions | userActionLimiter | 5/min | `key-perms:{user.id}` | `[VERIFIED: route.ts:5,380]` |
| portfolio-optimizer | userActionLimiter | 5/min | (route key; also resets tokens on some path `:141-143`) | `[VERIFIED: route.ts:12,113]` |
| scenario/optimize | userActionLimiter | 5/min | `scenario-optimize:{user.id}` | `[VERIFIED: route.ts:12,151]` |
| simulator | simulatorLimiter | 20/hour | `simulator:{user.id}` | `[VERIFIED: route.ts:17,112]` |
| composite/add-key | userActionLimiter | 5/min | (route key) | `[VERIFIED: route.ts:13,286-287]` |
| create-with-key | userActionLimiter | 5/min | (route key) | `[VERIFIED: route.ts:5,505-506]` |
| csv-validate | csvValidateLimiter | 20/min | (route key) | `[VERIFIED: route.ts:4,201-202]` |
| finalize-wizard | userActionLimiter | 5/min | (route key) | `[VERIFIED: route.ts:7,1009-1010]` |
| verify-strategy | publicIpLimiter | 10/min per IP | `verify-strategy:{ip}` | `[VERIFIED: route.ts:8,59]` |

Limiter definitions: `userActionLimiter` 5/60s, `keysSyncUserLimiter` 30/60s, `adminActionLimiter` 20/60s, `simulatorLimiter` 20/3600s, `csvValidateLimiter` 20/60s, `publicIpLimiter` 10/60s `[VERIFIED: src/lib/ratelimit.ts:97-206]`.

### Python-side (slowapi, ⚠️ `memory://` = PER-REPLICA, documented ASSUMPTION-3: *"With N Railway replicas every number above is N× looser"* `[VERIFIED: services/rate_limit.py docstring]`)

| Endpoint | Limit | Scope | Source |
|---|---|---|---|
| /optimize-weights | 20/min | optimize_weights | `[VERIFIED: optimizer.py:42-45]` |
| /csv/validate | 30/hour | csv_validate | `[VERIFIED: csv.py:61-64]` |
| /validate-key | 100/hour | validate_key | `[VERIFIED: exchange.py:1022-1025]` |
| /encrypt-key | 100/hour | encrypt_key | `[VERIFIED: exchange.py:1183-1186]` |
| /fetch-trades | 10/hour | fetch_trades | `[VERIFIED: exchange.py:1226-1229]` |
| /portfolio-analytics | 10/hour | portfolio_analytics | `[VERIFIED: portfolio.py:1575-1577]` |
| /portfolio-optimizer | 10/hour | portfolio_optimizer | `[VERIFIED: portfolio.py:1636-1638]` |
| /portfolio-bridge | 10/hour | portfolio_bridge | `[VERIFIED: portfolio.py:1898-1900]` |
| /verify-strategy | 5/hour | verify_strategy | `[VERIFIED: portfolio.py:2201-2203]` |
| simulator | 20/hour (IP-keyed, FINDING-10 quarantined) + in-handler per-user quota | — | `[VERIFIED: simulator.py:234, :242-249]` |
| /process-key | dynamic: 100/hour tenant, 30/hour anon, 500/hour platform ceiling | — | `[CITED: services/rate_limit.py docstring token-cost table + TODOS.md H1 row]` |
| /match/recompute, /match/eval | **NONE** (this phase's RATE-03) | — | `[VERIFIED: test_limiter_identity.py:589-602]` |

### Pre-identified mismatch candidates (analysis — the audit's starting hypotheses, to confirm/refute, not conclusions)

1. **Bridge / portfolio-optimizer: Vercel permits 30× the Python budget.** 5/min/user = 300/hour vs 10/hour/tenant Python. A single user's legitimate exploration exhausts the Python tenant bucket in ~2 minutes, after which the seam answers 429s the Vercel tier told them were allowed. One side is wrong; decide which per-flow.
2. **keys/validate-and-encrypt: 5/min Vercel (300/h) vs 100/hour × two separate Python buckets** (each call spends L-1 AND L-2 — *"2 tokens from two SEPARATE 100/hour buckets"* `[CITED: rate_limit.py docstring token-cost table]`).
3. **verify-strategy (teaser): 10/min per IP Vercel vs 30/hour ANON platform-wide at `/process-key`** — a handful of concurrent anonymous visitors can exhaust the platform-wide anon bucket; the Vercel per-IP limiter cannot see the shared exhaustion.
4. **L-9 `/optimize-weights` 20/min** — the ledger's named riskiest: *"it is a platform ceiling today and becomes per tenant the moment TS-04 lands — at which point 20/minute per tenant may be wrong in the other direction (too loose)"* `[CITED: 140.1-TS-OBLIGATIONS.md:734 (TS-22)]`. TS-04 has landed (claims are minted and sent), so this re-look is due.
5. **Retry double-spend (recorded decision wanted, not a defect):** a seam retry burns a SECOND Python token during exactly the incidents retries fire in `[CITED: TODOS.md H1 row :1502]` — "accept, or exempt retries from the Python limiter."

⚠️ **If any Python VALUE changes:** `test_limit_value_is_unchanged_by_the_rekey` pins each as a literal in `IP_KEYED_CLASS` rows `[VERIFIED: test_limiter_identity.py:266]` — update the table row in the same commit. ⚠️ **If any Vercel value changes:** grep each limiter's docblock rationale in `ratelimit.ts` — several values are load-bearing security controls (e.g. `scenarioPeerLimiter`'s probe-oracle defense `:179-193`), and shared buckets (`userActionLimiter` serves ~9 surfaces) mean changing the value for one route changes it for all — prefer minting a new named limiter over resizing a shared one.

## RATE-05 — the HOF, and the stale premise

**What exists at 145 tip (all shipped before this phase):**

- `withAuthLimited(options, handler)` — composes `withAuth`, enforces auth → validate → limit by construction, defaults deny to `rateLimitDenyJson` (503-split for free) `[VERIFIED: src/lib/api/withAuthLimited.ts:145-191]`. Adopters: `allocator/scenario/saved`, `bridge/outcome`, `bridge/outcome/dismiss`, `bridge` `[VERIFIED: importer grep]`.
- `withAdminAuth({ rateLimitKey, schema })` — opt-in per-surface admin limiter, B15b validate-then-limit `[VERIFIED: src/lib/api/withAdminAuth.ts:22-49]`.
- `withRole(...)` — **NO limiter hook** `[VERIFIED: src/lib/auth.ts:598-660 — no checkLimit in the wrapper]`.
- **No symbol `withRateLimit` exists anywhere** `[VERIFIED: repo-wide grep, zero non-test hits]`.
- **The "no CI gate" premise is stale.** Two gates now exist: (a) `seam-ratelimit-posture.invariant.test.ts` derives the seam population FROM DISK every run and holds a hand-typed equality on both the limiter roster and the no-limiter quarantine — *"A new seam route that inlines a 429-only arm fails here BY NAME on the day it is written"* `[VERIFIED: :41-66, :245-289]`; (b) `limiter-ordering.test.ts` COMPLETENESS forces every new `checkLimit` route into a classified bucket `[VERIFIED: :9-15]`. Both landed in Phase 140.4 — AFTER the requirement was written (2026-07-25).

**The honest residual gap:** a new seam route with NO limiter at all fails gate (a) only as "the no-limiter set changed — decide whether that is intended" — a forcing function, not a prohibition; and neither existing wrapper fits an admin GET (withAdminAuth parses a JSON body; withAuthLimited has no role gate). `admin/match/eval` will therefore stay hand-wired inline (like its sibling) unless a wrapper is extended.

**Recommendation (founder-decision candidate — see Open Questions):** satisfy RATE-05 by RECORDED DECISION that `withAuthLimited` + `withAdminAuth({rateLimitKey})` + the two CI gates ARE the structural successor (the locked decision #5's substance — "HOF composing alongside withAuth/withRole, not global middleware" — is delivered by `withAuthLimited`), rather than minting a third wrapper named `withRateLimit` that would coexist with two functionally identical ones (Rule 7: surface conflicts, don't blend; two wrappers is already the ADR-0005 migration state, three is worse). If the requirement's letter is held to, the cheapest conforming implementation is `export const withRateLimit = …` as a thin documented alias/refactor of `withAuthLimited`'s limiter step — but flag before building.

## Ledger obligations formally assigned to Phase 146 (scope the requirements text does not name)

The 140.1 obligations ledger (`.planning/phases/140.1-pyapi-python-service-contract-status-attributability-limiter/140.1-TS-OBLIGATIONS.md`) assigns **4 rows** to 146 (`:24 — "146 → 4"`). Planner: read that file directly; it says *"read this file INSTEAD of re-deriving"* (:964).

| Row | What 146 owes | Key constraints |
|---|---|---|
| **TS-21** (= RATE-03) | slowapi limits on match routes | Covered above. |
| **TS-22** (= RATE-04) | Value audit L-1..L-9 | *"Audit after TS-04, not before. Sizing a per-tenant bucket against platform-wide observed traffic is how you get the number wrong twice."* TS-04 landed → unblocked. |
| **TS-23 (remainder)** | Migrate the four bare-scalar in-handler `HTTPException(429)` sites — `match.py:1742`, `simulator.py:249`, `portfolio.py:1964`, `portfolio.py:2255` `[VERIFIED: grep at 145 tip]` — onto the `service_error()` envelope, AND decide which of the THREE coexisting 429 wire shapes WINS | ⚠️ Must PRESERVE the `Retry-After` headers 140.1.2 added header-only (use `service_error`'s `retry_after` kwarg; *"dropping the existing `headers=` kwarg without passing `retry_after` silently regresses the wire"*). The 429-with-Retry-After envelope is constructable since PYAPIFIX-06(a). TS discriminator already tolerates all three shapes (140.2-06), so no TS change is forced. `internal.py`'s migrated throttle arm (`service_error(429, "RATE_LIMITED", retryable=True, retry_after=…)` `[CITED: REQUIREMENTS.md PYAPIFIX2-03]`) is the worked example. |
| **TS-36** | NEW pytest reading `tests/fixtures/tenant-claim-parity.json` (repo root — `[VERIFIED: tests/fixtures/ contains tenant-claim-parity.json]`), feeding each case's claim to `services/rate_limit.py:verify_tenant_claim` (`[VERIFIED: def at rate_limit.py:252]`) with the case's secret in `INTERNAL_API_TOKEN`, asserting the returned payload | *"Bind to the BYTES — do not re-derive the table, do not fork a second fixture. Neutering either side must redden the other's suite."* Two cases carry exp 2050/2030 deliberately — keep. |

(TS-39(b) mentions "pair it with a 146 pass" as one OPTION for the anonymous-teaser breaker key, but its owner is Phase 141 — note, do not absorb.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 503-vs-429 deny decision | inline status literals | `rateLimitDenyJson` / `isRateLimitMisconfigured` | Single-sourced in `ratelimit.ts:325-327`; the per-arm invariant reds any inlined arm |
| Route population scanner for RATE-01 | a new grep script | the shipped invariant + a dated census commit | Two scanners agreeing is not evidence; the invariant self-tests both needle polarities |
| Python limiter keying | any bespoke/IP key | `partial(tenant_or_platform_key, scope=…)` | *"Never introduce a new IP-derived key. That is the defect, not the fix."* `[VERIFIED: rate_limit.py docstring]`; pytest gate enforces the partial |
| A third auth+limit wrapper | `withRateLimit` from scratch | `withAuthLimited` / `withAdminAuth({rateLimitKey})` | Both exist, tested, adopted; see RATE-05 |
| 429 envelope on Python | new response shape | `service_error(429, "RATE_LIMITED", retryable=True, retry_after=…)` | The arm exists with one worked consumer (`internal.py`); adding a FOURTH shape was explicitly refused in 140.1.2 |

## Common Pitfalls

### Pitfall 1: The stale-grep trap this phase exists to avoid — recursively
**What goes wrong:** Any census cut from this file, from MAIN pre-merge, or from the 145 worktree post-merge is stale by construction. **Avoid:** RATE-01's artifact is cut fresh at execution, on merged `main`, with the three-module import edge. **Warning sign:** a plan citing THIS file's route list as the deliverable.

### Pitfall 2: Same-commit roster discipline (7 gates across 2 languages)
RATE-02 moves 2 vitest rosters + 1 classification (posture roster+quarantine equality; limiter-ordering bucket). RATE-03 moves 4-5 pytest surfaces (delete tripwire; literal route set; shared-key sweep — satisfied by construction; distinct scopes; `request: Request` signatures). Splitting any of these across commits = a red CI between them. Each gate is enumerated with citations in the RATE-02/RATE-03 sections.

### Pitfall 3: Copying portfolio.py's VALUE instead of its PATTERN
`10/hour` on `/match/recompute` throttles legitimate admin traffic the Vercel tier permits at 20/min. The mirror is the decorator+key_func syntax; the value must exceed the max legitimate forwarded rate (defense-in-depth sizing, not quota sizing).

### Pitfall 4: Resizing a SHARED Vercel limiter for one route's sake
`userActionLimiter` (5/min) backs ~9 surfaces including attestation/deletion. If RATE-04 concludes a seam route needs a looser cap, mint a NEW named limiter (the codebase's established move — see `csvValidateLimiter`'s docblock rationale `:195-206`) rather than resizing the shared bucket.

### Pitfall 5: Believing the Python limiter is distributed
slowapi storage is `memory://` — per replica, reset on deploy (ASSUMPTION-3). Values are floors ×N replicas. Do not spend effort tuning Python values to precision the storage cannot deliver; the audit should size order-of-magnitude and note the caveat in the artifact.

### Pitfall 6: The eval comment false-positive
`admin/match/eval/route.ts` mentions `rateLimitDenyJson` in PROSE today. Any hand grep for adoption must comment-strip (the invariant does; a naive `grep -l` reports the gap closed while it is open — the exact shape `[VERIFIED: invariant :94-100]`).

### Pitfall 7: pytest / mypy discipline (memory-sourced, repeatedly bitten)
Run pytest ONLY from `analytics-service/` with `python3`; run `mypy --strict` before ship (gsd runs pytest only — mypy errors stay latent until PR CI); local missing `pandera` → `pip install 'pandera==0.32.1' --break-system-packages`.

### Pitfall 8: Migration timestamps (should be moot)
No RATE deliverable needs a migration. If one appears before 2026-08-19 12:00 UTC it must be stamped above `20260819120000` (see Project Constraints). Treat a migration in any 146 plan as a scope smell first.

## Runtime State Inventory

Not a rename/refactor/migration phase — omitted by design. (No stored data, service config, OS state, secrets, or build artifacts change: all edits are application code + tests. The only external-state touchpoints are Upstash buckets — new key prefixes `match-eval:*` self-create — and slowapi in-memory counters, which reset on deploy.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node (local 25 / CI 22) | vitest suites | ✓ | see memory note | `PATH=/opt/homebrew/opt/node@22/bin` reproduces CI |
| python3 + pytest | analytics-service tests | ✓ (established) | — | — |
| Upstash env vars | NOT needed for tests | n/a | — | limiter fails OPEN outside prod `[VERIFIED: ratelimit.ts:17-19]` |
| Live DBs / Railway / Vercel | **NOT needed** | n/a | — | phase is code+tests only; no live-DB action anywhere |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | vitest (TS, coverage-gated) + pytest (Python, `--cov-fail-under=80`) |
| Config | `vitest.config.ts`; `analytics-service/` pytest config |
| Quick run (TS) | `npx vitest run src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/api/limiter-ordering.test.ts --no-file-parallelism` |
| Quick run (Py) | `cd analytics-service && python3 -m pytest tests/test_limiter_identity.py -x` |
| Full suite | `npm run test` (TS) · `cd analytics-service && python3 -m pytest` + `mypy --strict` (Py) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RATE-01 | Census artifact matches derived population | invariant (existing) | vitest posture invariant (above) | ✅ exists; artifact is a committed doc |
| RATE-02 | eval 429+Retry-After past limit; 503 on misconfig | unit + invariant | `npx vitest run src/app/api/admin/match/eval/route.test.ts --no-file-parallelism` + posture invariant | ❌ deny-arm cases to ADD to existing route.test.ts (file exists `[VERIFIED: ls]`) |
| RATE-03 | direct Railway hit → 429 via slowapi | pytest | `python3 -m pytest tests/test_limiter_identity.py -x` (+ new behavioral case; `test_default_keyed_route_actually_throttles` `:750` is the throttle-proof pattern to mirror) | ❌ roster edits + 1 new case |
| RATE-04 | committed audit; adjusted values pinned | artifact + literal pins | existing literal-pin tests red on unpinned change | ✅ pins exist both sides |
| RATE-05 | new seam route cannot ship limiterless unnoticed | invariant (existing) | posture invariant equality cases | ✅ exists; deliverable is the recorded decision |
| TS-36 | TS mint ↔ Python verifier byte-parity | pytest (new) | `python3 -m pytest tests/test_rate_limit*.py -x` (new reader) | ❌ Wave work: new pytest reading `tests/fixtures/tenant-claim-parity.json` |
| TS-23 rem. | 4 bare-scalar 429s → envelope, Retry-After preserved | pytest | route-level 429-shape assertions | ❌ per-site assertions to add/repoint |

### Sampling Rate
- **Per task commit:** the two quick runs above (target < 30 s each).
- **Per wave merge:** full vitest + full pytest + `mypy --strict`.
- **Phase gate:** full suites green; every new/changed gate has an observed neuter-RED.

### Wave 0 Gaps
- None structural — both frameworks and both invariant harnesses exist. The "❌" rows above are ordinary in-wave test work, not infrastructure.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes (eval is admin-gated) | existing `isAdminUser` gate unchanged; limiter added BEHIND it |
| V5 Input Validation | yes | B15 auth→validate→limit ordering, enforced by `limiter-ordering.test.ts` |
| V11 Business Logic / resource limits | **core of the phase** | Upstash sliding window (distributed) + slowapi (per-replica defense-in-depth) |

| Threat | STRIDE | Mitigation this phase touches |
|--------|--------|-------------------------------|
| Leaked `X-Service-Key` → direct Railway loop | Elevation/DoS | RATE-03 slowapi tenant/platform buckets on match routes |
| Admin-account compromise → eval scrape loop | DoS/inference | RATE-02 per-user.id cap |
| Upstash outage misread as user throttle | Repudiation/availability | KEEP the 503 chokepoint discipline (posture invariant) — do not regress it while editing rosters |
| Per-peer metric probe oracle | Information disclosure | `scenarioPeerLimiter` is a documented load-bearing control — do not resize during RATE-04 without re-reading its docblock `[VERIFIED: ratelimit.ts:179-193]` |

## State of the Art (what changed since the requirements were written, 2026-07-25)

| Requirement assumption | Current reality | Changed by |
|---|---|---|
| "today's per-route hand-wiring has no CI gate" (RATE-05) | Two CI gates: posture invariant (derived population, equality quarantine) + limiter-ordering completeness | Phase 140.4 (SEAMRIM-05), audit-2026-05-07 (B15) |
| "seven already-limited routes" (RATE-04) | 13 limited seam routes; csv-finalize left the seam in Phase 145 | Phases 140.x, 145 |
| No HOF exists | `withAuthLimited` + `withAdminAuth({rateLimitKey})` | audit-2026-05-07 |
| Tenant claims absent on match wrappers | Claims minted and sent, deliberately inert pending RATE-03 | Phase 140.2-09 (TS-04) |
| Python 429s: one shape | THREE 429 wire shapes coexist; 146 owns the match/simulator/portfolio migration + which-shape-wins decision | 140.1.2 (TS-23 annotation) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Real admin eval cadence is mount+lookback-flips (no polling anywhere) — derived from reading `MatchEvalDashboard` only; the two partner pages were not read line-by-line | RATE-02 sizing | Limit too tight → admin 429s; mitigated by choosing 20/min (4× a plausible burst). `[ASSUMED]` for the partner pages' fetch pattern |
| A2 | `/cron-recompute` should be recorded out-of-scope by analogy to requirements decision #7 | RATE-03 | If in scope, one more decorator + roster row; cheap either way. `[ASSUMED]` — boundary decision for planner/discuss |
| A3 | Railway replica count N is small (affects how loose per-replica slowapi values really are) | RATE-04 | Values N× looser than written; note in artifact. `[ASSUMED]` — could be checked via Railway MCP read-only if the planner wants it, but no live action is required |
| A4 | The 145 branch merges without further churn to the rate-limit surfaces | everywhere | All citations shift; the mandated post-merge re-grep absorbs this by design. `[ASSUMED]` |

## Open Questions (founder-decision candidates)

1. **RATE-05 satisfaction-by-existing-means.** The locked decision (#5, REQUIREMENTS.md:31) says "withRateLimit HOF … not global middleware". `withAuthLimited` IS that HOF in substance under another name, and the CI gates close the "silently ship with no limiter" hole the requirement targets. Recommend: recorded decision + (optionally) a documented alias, NOT a third parallel wrapper. Needs sign-off because the requirement text names a specific symbol.
2. **Which 429 wire shape WINS** for the TS-23 bare-scalar migration — 140.1.2 deliberately left this to the owner (146). The worked example (`internal.py` → nested `service_error` envelope) is the path of least resistance; the flat `main.py` handler shape cannot be adopted by a raise site (it is a returned JSONResponse from an exception handler) `[CITED: TS-23 ledger row]`.
3. **Retry double-spend of Python tokens (H1)** — "accept, or exempt retries from the Python limiter" wants a recorded decision; recommend RECORD-ACCEPT in the RATE-04 artifact (an exemption is a new mechanism, out of LIGHT-depth character).
4. **RATE-04 population**: audit the full current 13-route surface (recommended — the tables above make it nearly free) or only the 7 routes the stale list named. Recommend full surface; the requirement's "seven" is an artifact of the stale list RATE-01 exists to replace.

## Sources

### Primary (HIGH confidence — read in full or in relevant part this session, at 145 tip `c96f549b`)
- `src/lib/ratelimit.ts` (all 635 lines), `src/lib/seam-ratelimit-posture.invariant.test.ts` (all 835 lines), `src/lib/api/withAuthLimited.ts` (all 191 lines)
- `src/lib/api/withAdminAuth.ts:1-130`, `src/lib/auth.ts:580-660`, `src/lib/api/limiter-ordering.test.ts:1-60,230-310`
- `src/app/api/admin/match/eval/route.ts`, `admin/match/recompute/route.ts`, + limiter call sites of all 13 limited seam routes (grep + targeted reads)
- `analytics-service/services/rate_limit.py` (module docstring in full + `verify_tenant_claim` def), `routers/match.py` (endpoints + imports), `routers/portfolio.py` / `optimizer.py` / `csv.py` / `exchange.py` / `simulator.py` decorator sites, `tests/test_limiter_identity.py` (structure + gates :540-615), `main.py` 429 handler region, `requirements.txt:226`
- `.planning/ROADMAP.md` (Phase 146 charter :186-199, ordering :77-79), `.planning/REQUIREMENTS.md` (RATE :101-107, decisions :24-34, PYAPI ticks), `.planning/phases/140.1-*/140.1-TS-OBLIGATIONS.md` (rows TS-21/22/23/36, §3, :849-853), `.planning/research/SUMMARY.md` (v1.16 corrections), `TODOS.md` both checkouts (review-depth table, H1, migration-timestamp deferral :2819-2823, stale route bullet :866-868)

### Secondary / Tertiary
- None — no web or docs lookups were needed; the domain is entirely in-repo and the phase adds no dependencies.

## Metadata

**Confidence breakdown:**
- Census & gap verification: HIGH — derived from source + the repo's own self-testing invariants, at a pinned commit; staleness is handled by the mandated re-run, not by trust in this file
- Patterns & same-commit gate lists: HIGH — every gate quoted with line ranges
- Value-audit mismatch candidates: MEDIUM — values verified, but the *judgment* of which side is wrong is analysis for the audit to settle
- Sizing recommendations (20/min eval, 30/min match): MEDIUM — discretion, reasoned from verified forwarding rates

**Research date:** 2026-08-18 · **Valid until:** the moment `feat/v1.19-phase-145` merges (line-number citations) / 2026-08-25 (structural claims). RATE-01's fresh grep supersedes all census content here by design.
