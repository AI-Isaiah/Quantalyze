# Phase 240: CONNECTTRUTH - Research

**Researched:** 2026-11-24
**Domain:** slowapi/limits rate-limit stacking over a signed HMAC tenant claim (Python/FastAPI + Next.js route handlers), pandas date-column normalisation, FastAPI flat error-body contract
**Confidence:** HIGH on the limiter mechanics and the CSV change (both executed as probes this session); MEDIUM on three sizing numbers and on the Upstash worst-case (derived, flagged `[ASSUMED]`)
**Anchored at:** worktree HEAD `0184e8677` (branch `gsd/phase-240-connecttruth`). Cite by symbol; line ranges below are HEAD readings and rot.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All four rulings are the founder's, 2026-11-24, relayed by the coordinator; each took the recommended option.

**RLIM-01 — anonymous bucket**
- Per-IP anonymous tier. The TS teaser route (`src/app/api/verify-strategy/route.ts`) mints the anonymous tenant claim with a hash of the client IP, read at Vercel from `getClientIp`, never Railway's proxy IP. Python keys `process_key:anon:<iphash>` at 30/hour per IP. — **Reversibility:** costly — the claim payload grammar widens on both sides of the signed `X-Tenant-Claim` contract (`src/lib/tenant-claim.ts`, `services/rate_limit.py`).
- An aggregate anonymous ceiling sits on top, kept well below the shared 500/hour `/process-key` ceiling, so anonymous traffic as a whole cannot starve tenants.
- The simulator's IP-keyed limit was ruled to be re-keyed onto `tenant_or_platform_key`. ⚠️ MEASURED at HEAD 2026-11-24 (UI research, confirmed by the phase agent): this already shipped in Phase 163 SEC-05 — `routers/simulator.py` decorates with `partial(tenant_or_platform_key, scope="simulator")` and `_simulator_rate_limit_key` is deleted. The phase verifies it with a pin (no analytics-service limit keyed on `get_remote_address`) and corrects the stale FINDING-10 prose in the `services/rate_limit.py` docblock; it does not redo the re-key.

**RLIM-02 — CSV limits**
- CSV-scoped upstream tier. csv-validate sends a signed scope signal (carried by the signed claim or an HMAC-covered header — never an unsigned header). Python gives CSV validation its own per-tenant bucket sized at or above the edge limit (20/minute), exempt from the shared 500/hour ceiling or given its own slice of it, so a CSV user inside the edge limit is never refused upstream. — **Reversibility:** costly — a signed contract between `process-key-client.ts` and `routers/process_key.py`.
- csv-validate and csv-finalize move onto separate edge limiters (csv-finalize spends no upstream token).
- The stale docblock citation ("the upstream 30/hour cap" in `routers/csv.py`) is replaced with the real upstream cap in the same change.

**CONN-06 — CSV month-name date cells**
- Parse the month-name cell (e.g. `12 Mar 2024` in a `DD/MM/YYYY` column). A month name carries no day/month ambiguity, so the reading cannot land in the wrong calendar. Flag it through the existing date-normalization info flag. Closes TODOS `[170.1-CSV-ODD-SPELLING-REJECTED]` with a test.

**CONN-05 — validate-key 400 code**
- Every validate-key 400 gets the flat `{detail, code, recoverable}` shape. Codes: `AUTH_FAILED` (bad credentials on any venue, incl. sFOX 401/empty token and MT5 bad password), `MT5_WRONG_SERVER`, `MT5_MASTER_PASSWORD`, plus new `VENUE_DISABLED` (sFOX/MT5 go-dark gates) and `INVALID_REQUEST` (`create_exchange` `ValueError`). Permanent arms are `recoverable:false`. Every `detail` string stays byte-identical (the TS classifier matches on detail text). One test per venue reads `code`. — **Reversibility:** costly — public body contract read by TS consumers.
- Light touch on the entry's other two findings: feed the MT5 permanent codes into `routers/process_key.py` `_envelope_error`'s `recoverable` derivation (plumbing exists); re-derive STATUS_CONTRACT.md prose coordinates by symbol; the historical §7 S-table stays as a census, recorded with that reason.

**Decided autonomously**
- [Research] Q: "How many analytics replicas share the memory:// limiter?" → Selected: "1 Railway replica, 1 uvicorn worker (Dockerfile CMD has no --workers); the limiter is one global counter" — a measurement, re-read if the deploy config changes.
- [Proof] Q: "How is PROOF-01 shown?" → Selected: "each new gate neutered in a byte copy, RED with its named arm, restored with cp and cmp, GREEN, recorded verbatim in the plan SUMMARY" — test-process only.

### Claude's Discretion
- Exact anonymous aggregate ceiling and CSV tier numbers, within the rulings above; the hash construction for the IP (keyed HMAC so the raw IP never reaches Python or logs); code placement and test layout.

### Deferred Ideas (OUT OF SCOPE)
- Retiring the orphaned teaser UI (`[192-ORPHANED-LANDING-VERIFY]`) — not chosen; stays with its own owner.

**Scope fences from CONTEXT "Out of scope" and "Specifics":** the "contact support" string in `csv_validator.py` (`_maybe_auto_normalize_percent_form`) belongs to Phase 222 ALERTTRUTH; writes in `csv_validator.py` stay inside the date-detection/parse symbols. No limit in analytics-service may be keyed on `get_remote_address` after this phase. `publicIpLimiter` also serves factsheet-share, scenario-share, BTC benchmark and tearsheet PDF routes: do not retune it.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-05 | Every validate-key 400 body carries the same machine-readable code on every venue; the entry's other two findings are fixed or recorded with a reason | 11 raise sites enumerated (§CONN-05); the flat-body builder is `VenueTransientHTTPException` (accepts any 4xx); roster/census moves listed; permanence plumbing via `val.permanent`; STATUS_CONTRACT prose coordinates located |
| CONN-06 | A month-name date cell in a numeric-date CSV column is parsed | Working prototype (executed): masks month-name cells out of pandas' first-cell format inference, merges their parse into both readings; passes all UI-SPEC acceptance and rejection cases; 1115 existing CSV tests green with it applied |
| RLIM-01 | Anonymous visitors from different IPs cannot exhaust a shared anon bucket; no limit keyed on the proxy IP | Claim grammar `public:<32-hex>`; third stacked limit with `exempt_when`; **decorator order must change** (probe proves refused anon requests burn the platform ceiling today); alert rekey; pin extension |
| RLIM-02 | A signed-in user within the edge limit never gets an upstream 429; docblocks cite the real cap | Claim grammar `csv:<uuid>` derived inside `postProcessKey` from `flow_type`; own per-tenant bucket; ceiling exemption; Upstash bucket-bound derivation → 60/minute; edge limiter split semantics |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted directives the planner must verify against (global + project `CLAUDE.md` + `AGENTS.md`):

- **Which database am I on:** the CLI is linked to PROD. Phase 240 has **no migration and no DB write**; no task may run `supabase db push`/`--linked`. Any PROD/TEST read goes through the marker query first.
- **No AI attribution** in commits or PR bodies (memory rule, founder 2026-10-20; overrides the harness attribution reminder). No skip-CI trailer tokens in any commit message or PR body, even to deny them.
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry (checklist from `git log <base>..HEAD`, grouped by theme, cross-checked), in the same commit as the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- **TODOS.md holds open work only:** the ship deletes the entries it closes and names them in the CHANGELOG (§TODOS closure list below). LOW/Info review survivors are never booked.
- **Completion is historical:** verification files use `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never in `drift_subjects`.
- **Gate integrity:** `sql-gate-lint`, `sql-mutation`, `plan-anchor-verify` are untouched (no SQL). A test that can't fail is wrong (Rule 9): every new gate is shown RED on a neutered byte copy and restored with `cp` + `cmp`, never `git checkout/restore/stash` on uncommitted work.
- **mypy strict is CI** for any analytics-touching change: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, run from `analytics-service/`.
- **pytest only from `analytics-service/`**; never `importlib.reload` in tests; always `grep -a`; a new test file/arm can move several censuses — grep them all.
- **Public repo with `.planning/` tracked:** no secrets, PROD ids, home paths or account numbers in tracked text (this file included); never quote a credential-shaped literal (fixture MACs are not pasted here).
- **Key functions never raise (G-8); literal limit pins in `tests/test_limiter_identity.py` and `tests/test_process_key.py` move in the same commit as any limit.**
- **`DESIGN.md` governs visual decisions:** UI-SPEC says this phase places nothing new on any rendered surface.
- `AGENTS.md`: "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing route code. This phase edits two existing route handlers by a few lines and adds no Next API surface; the planner should still skim the relevant guide once `npm ci` has run (not installed in this worktree).
- **Gate for ship:** green means bound to the head SHA with the expected check count (CI-gate-integrity section).

## Summary

Four independent, mostly Python-side changes behind one signed-claim contract. The riskiest finding is not in the requirement text: **the `/process-key` limit stack evaluates the platform ceiling BEFORE the per-identity limit** (slowapi runs decorators bottom-up, and the ceiling decorator is the bottom one). A request refused by its own per-IP limit has therefore already spent a ceiling token. Probed with a faithful replica of the stack: one anonymous caller hammering past its own limit leaves an innocent tenant refused (`429`). Adding a per-IP tier without reordering would leave RLIM-01's real starvation vector open, because the Vercel front door admits 10/min/IP (600/h/IP) against a 500/h ceiling. The fix is to put the per-identity limit first, the new anon aggregate second, the ceiling last, all three as callable providers (static limits are always evaluated before dynamic ones, which would silently reorder things).

The per-IP tier is a payload grammar change (`public:<32 hex>`), the CSV scope is a second one (`csv:<uuid>`); both are derived inside the single `postProcessKey` chokepoint so no route can forget them, and Python validates both strictly with reserved prefixes (a malformed `public:*` must never fall into the tenant arm). Python must accept both grammars before the TS mint ships (deploy-order section). For CSV, the edge limiter is Upstash `slidingWindow(20, "60 s")` while the Python limiter is a `limits` fixed window anchored at the first hit; each edge bucket admits at most 20 so one exact 60 s span can hold 40, and a trailing upstream hit time can stretch that to 60, so a Python tier of "20/minute" (or 40) does not make "never 429" hold. Recommend 60/minute per tenant and an exemption of CSV traffic from the 500/hour ceiling (only an exemption satisfies "never", at the cost of the aggregate backstop; stated below).

CONN-05 is a mechanical sweep of 11 raise sites onto the existing flat-body class, with two new codes that need exemptions (not verdict rows) in the TS roster. CONN-06 is a symbol-scoped change to `_detect_and_normalize_date_column` plus four small helpers; it was prototyped and run against seven existing CSV test files (1115 passed) and a 14-case acceptance/rejection matrix on `daily_returns`, `daily_nav` and `trades`.

**Primary recommendation:** Ship in this wave order — (1) Python verifier + stack reorder + csv tier + alert rekey (accepts both grammars), (2) TS mint (`anonymousClaimPayload`, csv payload, edge limiter split), (3) CONN-05 sweep + roster, (4) CONN-06 validator — with PROOF-01 neuter points per gate listed in §Validation Architecture.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Client IP extraction for the anon tier | Frontend Server (Vercel route handler `verify-strategy`) | — | Only Vercel sees the real client; Railway sees its own proxy hop. `getClientIp` is the single reader (trusts `x-real-ip` only when `VERCEL === "1"`) |
| IP pseudonymisation + claim payload construction | Frontend Server (`tenant-claim.ts`, called from `postProcessKey`) | — | The secret (`INTERNAL_API_TOKEN`) lives on both sides, but the raw IP must never leave Vercel; the one mint module stays the one implementation |
| CSV scope signal | Frontend Server (`postProcessKey`, derived from `flow_type`) | API/Backend verifier | The body is not readable at slowapi key time (RESEARCH G-7), so the scope must ride the signed header |
| Per-IP / aggregate / CSV / ceiling enforcement | API/Backend (Python `routers/process_key.py`, `services/rate_limit.py`) | — | The `memory://` limiter lives in the analytics process (1 replica, 1 worker per CONTEXT) |
| Edge per-user CSV throttle | Frontend Server (Upstash via `ratelimit.ts`) | — | Vercel gates first; it is the number the upstream tier must exceed |
| Validate-key 400 code emission | API/Backend (`routers/exchange.py`) | — | Producer of the wire contract |
| Validate-key verdict classification | Frontend Server (`classifyKeyValidationError`, three key routes + rotate-secret) | Browser (renders `WIZARD_ERROR_COPY`) | Unchanged verdicts; roster/invariant tests move |
| CSV date normalisation | API/Backend (`services/csv_validator.py`) | — | Reached by `/process-key` (flow csv) and `/api/csv/validate` |
| Anon saturation alert | API/Backend (`services/app_error_handlers.py`) | Sentry (rule outside repo) | Follows the key re-spelling |

## Standard Stack

No new packages. Everything is the existing stack; versions are the lock pins and what this session executed against.

### Core
| Library | Version | Purpose | Why standard |
|---------|---------|---------|--------------|
| slowapi | 0.1.10 (`requirements.txt` pin; installed 0.1.10) | Decorator limiter, callable limit providers, `exempt_when(request)` | Already the repo's one canonical `limiter` singleton in `services/rate_limit.py` |
| limits | 5.8.0 (pin and installed) | `FixedWindowRateLimiter` over `memory://` | slowapi's default strategy is `"fixed-window"` (`extension.py` `self._strategy or ... "fixed-window"`) |
| `node:crypto` `createHmac` | Node 25.8.1 local | IP pseudonym + claim MAC | The existing mint already uses it; `tenant-claim.ts` is "ONE implementation" |
| pandas / pandera | lock 3.0.3 / 0.34.1; **local 3.0.1 / 0.32.1** | CSV date parse and schema | Existing. Local differs from the lock, so CSV evidence below is labelled |
| `@upstash/ratelimit` | `slidingWindow(20, "60 s")` at the edge | Edge CSV limit | Existing `makeLimiter` |

### Supporting
| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| structlog `capture_logs` | existing | Assert the 429 handler's log line carries no IP/hash | RLIM body-hygiene test |
| `fastapi.testclient` + `tests/app_factory.build_test_app` | existing | Drive the REAL limiter stack with production's 429 handler | All new limiter behaviour tests (`throttled_client` fixture in `tests/test_process_key.py`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Claim-carried CSV scope | HMAC-covered extra header | Needs a second verifier + header parity fixture; the claim already has the exp/MAC/parity machinery and a 512-char budget (claim is ~115 chars) |
| Third stacked limit with `exempt_when` | Fold the aggregate into the ceiling key function | Folding makes anon traffic stop counting toward the platform total and changes what the 500 means; the third limit keeps the founder's "aggregate sits on top" reading |
| Exempt CSV from the ceiling | Own CSV ceiling slice | Slice keeps a backstop but a single user at the edge maximum (1,200/h) plus two more users exceeds any modest slice, so "never refused" no longer holds. See Open Question 2 |

**Installation:** none.

**Version verification:** `pip3 show slowapi limits` → 0.1.10 / 5.8.0 (matches `requirements.txt` lines for `slowapi==0.1.10`, `limits==5.8.0`) `[VERIFIED: requirements.txt + installed package]`.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. `gsd_run query package-legitimacy check` was therefore not run for any package (its `--ecosystem` form requires package arguments). **Packages removed due to [SLOP]: none. Flagged [SUS]: none.**

## Architecture Patterns

### System Architecture Diagram

```
 anonymous caller                         signed-in user
        |                                        |
        v                                        v
 POST /api/verify-strategy              POST /api/strategies/csv-validate
 (Vercel route)                         (Vercel route)
   publicIpLimiter 10/min/IP              csvValidateLimiter 20 per 60 s per user (Upstash sliding)
   ip = getClientIp(headers)              |
        |                                 |
        +----------------+----------------+
                         v
              postProcessKey (process-key-client.ts)   <- THE chokepoint
                payload = "public:<hmac32(ip)>"  (teaser, ip known)
                        | "public"                (teaser, ip unknown)
                        | "csv:<user_id>"         (flow_type csv)
                        | "<user_id>"             (everything else)
                mintTenantClaim({userId: payload}, INTERNAL_API_TOKEN)
                headers: Authorization, X-Tenant-Claim, X-User-Id (unsigned, diagnostic only)
                         v
              POST /process-key  (Railway, 1 replica, memory:// fixed window)
                verify_tenant_claim  -> payload | None   (rsplit(".",2), exp, compare_digest)
                         v   evaluation order = decorator order, BOTTOM FIRST
         [1] per-identity limit   key: process_key:t:<uid> | :csv:<uid> | :anon:<hex> | :anon | :unverified:<h>
              sizes: 100/hour | 60/minute | 30/hour | 30/hour | 100/hour      (provider reads key prefix)
         [2] anon aggregate       key: process_key:anon-all   exempt unless claim is anonymous
              size: 200/hour                                                     (callable, no `key` param)
         [3] platform ceiling     key: process_key:ceiling:<credhash>  | csv-scoped claims EXEMPT
              size: 500/hour
                         v  any refusal
              rate_limit_exceeded_handler -> 429 {ok, code:"RATE_LIMITED", human_message, detail, correlation_id,
                                                  recoverable:true, retry_after_seconds} + Retry-After
              _alert_anon_bucket_saturated  (only: shared anon key, anon aggregate key)
```

### Files this phase touches (write list)

```
analytics-service/
  services/rate_limit.py            claim grammar, key spellers, docblock corrections (FINDING-10 stale prose)
  routers/process_key.py            limits, providers, 3-decorator stack (reordered), _envelope_error/pre-gate permanence
  routers/exchange.py               11 raise sites -> VenueTransientHTTPException(status_code=400, ...)
  routers/csv.py                    OPTIONAL docblock touch only (no limit change; L-4 stays "30 per 1 hour", no TS caller). NOTE: CONTEXT locates the stale "upstream 30/hour cap" sentence in routers/csv.py; it actually lives in the csvValidateLimiter docblock in src/lib/ratelimit.ts (which merely cites csv.py). csv.py itself carries no stale claim
  services/app_error_handlers.py    anon alert follows the rekey
  services/csv_validator.py         ONLY _detect_and_normalize_date_column + 5 new private helpers (see write list)
  docs/STATUS_CONTRACT.md           prose coordinates by symbol; record the 400 flat shape
  tests/                            see Validation Architecture
src/
  lib/tenant-claim.ts               anonymousClaimPayload (+ csv payload helper); TenantIdentity doc update
  lib/process-key-client.ts         derive payload from flow_type / optional client IP (one chokepoint)
  lib/ratelimit.ts                  csvFinalizeLimiter; csvValidateLimiter docblock (stale citation)
  lib/wizardErrors.ts               VENUE_WIRE_CODES_WITHOUT_VERDICT: VENUE_DISABLED, INVALID_REQUEST
  app/api/verify-strategy/route.ts  pass the already-computed ip through
  app/api/strategies/csv-finalize/route.ts   swap limiter instance
  (tests listed below)
tests/fixtures/tenant-claim-parity.json      new cases (computed by standalone node -e, never by the module)
TODOS.md, CHANGELOG.md, VERSION, package.json   per CLAUDE.md ship rules
```

### Pattern 1 — RLIM-01 claim grammar (reserved prefixes, strict Python parse)

**What:** Payload is dot-free already (mint guard 2 refuses `.`; Python parses with `rsplit(".", 2)`), so `:` is free. Grammar:

| Payload | Meaning | Python bucket key |
|---|---|---|
| `public` | legacy / unknown-IP anonymous | `process_key:anon` (shared; kept as the fallback) |
| `public:<32 lowercase hex>` | per-IP anonymous | `process_key:anon:<hex>` |
| `csv:<36-char uuid>` | CSV-scoped tenant | `process_key:csv:<uuid>` |
| anything else verified | tenant | `process_key:t:<payload>` |

- The `public:` and `csv:` prefixes are **reserved**: a verified payload starting `public:` that fails the strict `fullmatch` goes to the **shared anon** key, never to `:t:` (otherwise a bug or a skewed deploy lands an anonymous caller at the 100/hour tenant tier). A malformed `csv:` payload goes to the generic tenant arm.
- Implement once in `services/rate_limit.py` as a private classifier used by BOTH `tenant_rate_limit_key` and `tenant_or_platform_key` (they duplicate the `payload == ANON_PAYLOAD` test today). Neither may raise or return `""` (G-8; an empty key makes slowapi skip the limit and log an ERROR).
- TS side: `anonymousClaimPayload(ip, secret)` in `tenant-claim.ts`: `"public"` when `ip` is `"unknown"`/empty, else `public:` + `createHmac("sha256", secret).update("anon-ip:" + ip).digest("hex").slice(0, 32)`. Domain-separated message so the pseudonym can never equal a claim MAC. The raw IP never leaves Vercel. `X-User-Id` stays the literal `"public"` (unsigned, diagnostic) — do not put the hash there.
- Keep guard 1/2/3 of `mintTenantClaim` as is; update `TenantIdentity`'s doc (it says "ONE server-side literal is admitted: `public`").
- The keys differ in their second segment (`t`, `csv`, `anon`, `unverified`, `ceiling`), which is what makes prefix-based sizing in the provider collision-free.

**Source of the grammar constraints:** `ANON_PAYLOAD`, `_CLAIM_MAX_CHARS`, `rsplit(".", 2)` in `rate_limit.py` `[VERIFIED: analytics-service/services/rate_limit.py (Read) L149 "ANON_PAYLOAD: Final[str] = \"public\"" and L299 "payload, exp_raw, provided_mac = raw.rsplit(\".\", 2)"]`.

**No reader treats the payload as an identity.** Every non-test caller of `verify_tenant_claim` was grepped (HEAD): the only two are `tenant_rate_limit_key` and `tenant_or_platform_key`, both in `services/rate_limit.py`, and both use the payload only to spell a bucket key. The simulator module docstring, `portfolio.py` and `process_key.py` mention the claim in prose only. Nothing downstream reads the payload as a `user_id`, so the `public:` and `csv:` prefixes cannot break an identity reader. (The in-handler `_check_simulator_user_rate` keys on the server-set `req.user_id` from the body, not on the claim.) The other ten routes that use `tenant_or_platform_key` receive claims minted by `analyticsRequest` over real user ids only; routing them through the same classifier is for consistency, not behaviour.

### Pattern 2 — The stack order (THE finding)

Measured facts, each from executing code, not from reading comments:

1. slowapi evaluates limits in registration order and `break`s at the first refusal; limits evaluated before it have already `hit` (consumed). Decorators register bottom-up, so **the bottom decorator is evaluated first**. `[VERIFIED: probe 1 below + slowapi/extension.py __evaluate_limits (read, version 0.1.10)]`
2. At HEAD the registered dynamic groups are, in evaluation order, `['_process_key_ceiling_key', '_process_key_rate_limit_key']`: the **ceiling is first**. The comment above the decorators ("Inner = per-identity; outer = the platform ceiling") describes the wrong order. `[VERIFIED: executed against the real module: `limiter._dynamic_route_limits["routers.process_key.process_key"]`]`
3. Consequence, probed with a faithful replica (ceiling bottom, identity top; identity limit 2, ceiling 5): one anon caller sends 10 requests → `[200, 200, 429 x8]`, and a different tenant's next request → **429**. The refused anon calls burned the ceiling. `[VERIFIED: probe 2 below]`
4. With the order [identity, aggregate, ceiling] the same hammer leaves the aggregate at exactly its 2 admitted hits and the ceiling untouched; a tenant afterwards is admitted; `exempt_when(request)` works on dynamic providers in 0.1.10 (`Limit._exempt_when_takes_request`: one-parameter callable receives the request). `[VERIFIED: probe 3 below]`
5. `route_limits = limits + dynamic_limits`: **static (string) limits always run before dynamic (callable) ones** regardless of decorator order (`_check_request_limit`). The existing two are callable providers, so their relative order is the decoration order. The new aggregate MUST also be a callable (a plain `"200/hour"` string would be evaluated first and re-create the burn). `[VERIFIED: slowapi/extension.py _check_request_limit (read)]`
6. A provider declaring a `key` parameter makes slowapi call the key function once during limit expansion (`LimitGroup.__iter__`) and again at evaluation, for every request, exempt or not. The aggregate provider should declare **no** `key` parameter so its key function runs only for non-exempt (anonymous) requests. `[VERIFIED: slowapi/wrappers.py (read)]`
7. An empty key logs `"Skipping limit: %s. Empty value found in parameters."` at ERROR per request. Never return `""` from the aggregate key function; use `exempt_when`. `[VERIFIED: slowapi/extension.py (read)]`
8. `limits` storage keys include the amount (`LIMITER/k/scope/3/1/minute`): the same key string under two different limit amounts is two counters. Name the aggregate key distinctly (`process_key:anon-all`), do not reuse `process_key:anon` for it. `[VERIFIED: probe 4 below]`

**Target decorator stack (top to bottom in source = evaluated last to first):**
```
@limiter.limit(_process_key_ceiling_limit_for, key_func=_process_key_ceiling_key, exempt_when=<csv-scoped claim>)   # [3]
@limiter.limit(_process_key_anon_aggregate_limit, key_func=_process_key_anon_aggregate_key, exempt_when=<not anonymous>)  # [2]
@limiter.limit(_process_key_limit_for, key_func=_process_key_rate_limit_key)                                        # [1]
```
All three callable. Pin the evaluation order with a test that reads `limiter._dynamic_route_limits` key-function names (literal list), plus the behavioural hammer test.

Probe sources (executed as written against slowapi 0.1.10 + fastapi; no repo code imported). Probe A is the target order with the recommended no-`key` aggregate provider plus `exempt_when`; probe B is the CURRENT order (identity on top, ceiling at the bottom):

```python
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse

lim = Limiter(key_func=lambda request: "x")
app = FastAPI(); app.state.limiter = lim
app.add_exception_handler(RateLimitExceeded, lambda r, e: JSONResponse({"refused": str(e.detail)}, status_code=429))
agg_key_calls = []
def k_ident(request: Request) -> str: return "ident:" + request.headers["x-id"]
def k_ceil(request: Request) -> str: return "ceil"
def k_agg(request: Request) -> str:
    agg_key_calls.append(request.headers["x-id"]); return "agg"
def not_anon(request: Request) -> bool: return not request.headers["x-id"].startswith("anon")
def prov_ident(key: str) -> str: return "2/hour" if key.startswith("ident:anon") else "100/hour"
def prov_agg() -> str: return "3/hour"            # NO `key` parameter
def prov_ceil(key: str) -> str: return "5/hour"

@app.post("/p")                                                       # probe A
@lim.limit(prov_ceil, key_func=k_ceil)                                # top    -> evaluated last
@lim.limit(prov_agg, key_func=k_agg, exempt_when=not_anon)            # middle
@lim.limit(prov_ident, key_func=k_ident)                              # bottom -> evaluated first
async def p(request: Request): return {"ok": True}
# probe B: same functions, only two decorators, identity written ABOVE ceiling:
#   @lim.limit(prov_ident, key_func=k_ident) / @lim.limit(prov_ceil, key_func=k_ceil)

# Probe A output:  anon-A x10 -> [200, 200, 429 x8]; anon-B -> 200; anon-C -> 429 (aggregate of 3 full);
#                  tenant x3 -> [200, 200, 429] (ceiling used 3 of 5, so the 8 refused A calls burned nothing);
#                  aggregate key function invoked for tenant requests: 0
# Probe B output:  anon-A x10 -> [200, 200, 429 x8]; an innocent tenant's next request -> 429
# Probe C (limits 5.8.0): FixedWindowRateLimiter(MemoryStorage()).hit(parse("3/minute"), "k", "scope");
#                  item.key_for("k", "scope") == "LIMITER/k/scope/3/1/minute"; window reset == first-hit time + 60 s
```

**Measured on the real route, not only the replica:** swapping the two existing decorator lines in a byte copy of `routers/process_key.py` (identity first, ceiling last) and running the existing pins (`tests/test_process_key.py` selected by `stacked or ceiling or anon or sizing or registers or inner or key_func or claim`, plus `tests/test_anon_bucket_alert.py`) gave **32 passed, 0 failed**; the file was restored byte-for-byte (`cmp`). The reorder therefore breaks no existing pin; it only needs new ones (order literal, hammer-does-not-burn). Side effect to record: with identity first, a TENANT already at its 100/hour no longer spends ceiling tokens on its refused calls either (strictly less ceiling spend; no pin observes it).

### Pattern 3 — Sizing the provider by key prefix

`_process_key_limit_for(key)` today: `key == anon_bucket_key("process_key")` → 30/hour else 100/hour. New: prefix tests on the second segment — `process_key:anon` and `process_key:anon:*` → `_PROCESS_KEY_ANON_LIMIT`; `process_key:csv:*` → `_PROCESS_KEY_CSV_LIMIT`. Keep the three literals as module constants so tests can `monkeypatch.setattr` them (the existing pattern: `_PROCESS_KEY_CEILING_LIMIT`, `_PROCESS_KEY_TENANT_LIMIT`).

Recommended numbers (discretion; all `[ASSUMED]` until the founder/planner confirms):

| Constant | Value | Derivation |
|---|---|---|
| `_PROCESS_KEY_ANON_LIMIT` (per IP) | `30/hour` | Ruled by the founder (CONTEXT) |
| `_PROCESS_KEY_ANON_AGGREGATE_LIMIT` | `200/hour` | 40% of the 500 ceiling ("well below"); six IPs at their full 30 are needed to exhaust it; leaves ≥300/h of ceiling for everyone else |
| `_PROCESS_KEY_CSV_LIMIT` (per user) | `60/minute` | 3x the edge's 20 per 60 s (two buckets per exact span, a third for upstream latency), see Pattern 5 |
| CSV ceiling | exempt | see Pattern 5 / Open Question 2 |

### Pattern 4 — Reading the CSV scope through slowapi without the body

The body is unreadable at key time, so CSV rides the signed claim: inside `postProcessKey`, `flow_type === "csv"` → payload `csv:<args.userId>`. Deriving it from `flow_type` (one place, the shared headers assembly) means csv-validate cannot forget it. All four `postProcessKey` call sites pass `flow_type` as a string literal (argument expressions read at HEAD): `strategies/csv-validate` → `"csv"`, `strategies/finalize-wizard` → `"onboard"`, `keys/sync` → `"resync"`, `verify-strategy` → `"teaser"`; the `flow_type: "onboard"` literal in `keys/validate-and-encrypt` is the JSON body of its own direct fetch, not a `postProcessKey` call. So no variable-valued `flow_type` can inherit the CSV bucket or the ceiling exemption, and `FlowType` is the closed union `"teaser" | "onboard" | "resync" | "csv"` `[VERIFIED: src/lib/process-key-client.ts (Read) L60 "export type FlowType = \"teaser\" | \"onboard\" | \"resync\" | \"csv\";"]`. Python cannot cross-check claim scope against `body.flow_type` (the body is read after the limiter); a holder of `INTERNAL_API_TOKEN` could mint any scope, which is already the claim's documented threat model (adds no new trust surface). `csv-finalize` no longer calls `/process-key` (Phase 145), so it spends no upstream token `[VERIFIED: process-key-client.ts docblock + csv-finalize route has no postProcessKey import]`.

CSV bucket key `process_key:csv:<uuid>`; its ceiling key is the credential-hash form (`platform_ceiling_key`), and the ceiling decorator carries `exempt_when` for a csv-scoped claim.

### Pattern 5 — Window semantics and the CSV tier size

- Edge: `csvValidateLimiter = makeLimiter(20, "60 s")` is `Ratelimit.slidingWindow(20, "60 s")` `[VERIFIED: src/lib/ratelimit.ts (Read) L206 "export const csvValidateLimiter = makeLimiter(20, \"60 s\");" and makeLimiter body "limiter: Ratelimit.slidingWindow(requests, window)"]`. Upstash documents the sliding window as an approximation that weights the previous window's count and "assumes a uniform request flow in the previous window" `[CITED: upstash.com/docs/redis/sdks/ratelimit-ts/algorithms]`.
- Python: slowapi default `fixed-window`, anchored at the **first hit** of that key (probe 4), so a Python window is a 60 s span positioned by the user's own first request.
- The bound, by the simple argument: each Upstash bucket (one window length wide) admits at most 20 (the limit), and a 60 s span touches at most two buckets, so the edge admits at most 40 inside any exact 60 s span. A Python tier of 20/minute, and the sibling 1.5x pattern (30/minute), can therefore 429 a user the edge admitted. But 40 has **zero margin**: Python counts the hit when the request arrives after the upload and the edge check, so Python's hit time trails the edge's by a variable delay (up to the 60 s `process-key-sync` seam budget), which stretches one Python window across a third edge bucket. 3 x 20 = 60 covers any trail up to one window. **Recommend 60/minute per user**, and do not call it "airtight" in the docblock: say "sized at three times the edge's per-window cap so latency between the edge check and the upstream hit cannot push an admitted user over it". `[ASSUMED: the bucket model comes from Upstash's documented fixed-window-plus-previous-window description; not run against Upstash]`
- Why no hourly CSV limit: the edge allows 1,200/h per user; the shared tenant tier is 100/hour (`_PROCESS_KEY_TENANT_LIMIT = "100/hour"` `[VERIFIED: process_key.py (Read) L110]`), which is exactly the 12x mismatch the TODO entry records. The csv tier is per-minute only.
- Ceiling: 20/min is 1,200/h per user against a 500/h ceiling, so one user at the edge maximum exhausts the platform ceiling in under 25 minutes. Only an exemption makes "never refused upstream" true; a slice must be sized to (concurrent CSV users) x 2,400/h. The exemption loses the aggregate backstop for CSV; what still bounds it: the per-user edge limit, authentication, the 10 MB body cap, the row cap, and per-tenant 60/minute.

### Pattern 6 — CONN-06 month-name cells (validated prototype)

**Where a month-name cell dies at HEAD (executed):** in `validate_csv`, `_normalise_date_zones` passes the cell, then `_detect_and_normalize_date_column` parses the whole column twice (`_parse_dates(s, dayfirst=False/True)`). pandas infers ONE format from the first element, so every cell of another shape becomes NaT; the NaT cell is "readable under neither reading", is replaced by the `_UNSUPPORTED_ZONE_TOKEN` placeholder and surfaces as pandera `coerce_dtype` (+ `dtype`) at its row. A month-name cell in a numeric column is therefore rejected, and a month-name FIRST cell makes every other row fail (the same limitation exists today for an ISO FIRST cell in a day-first column: probed `ISO-first+dd` → `coerce_dtype` at rows 2 and 3, and stays rejected; this phase need not change it).

**Minimal change (new/changed symbols, all in `services/csv_validator.py`):**
- New private helpers: `_MONTH_NUMBER` (English full + 3-letter, lower-cased, own dict — never `%b`, which is locale-dependent), `_MN_DMY` and `_MN_MDY` regexes (4-digit year only, bounded, `re.ASCII`), `_read_month_name_cell(cell) -> datetime.date | None` (`date(y, m, d)` in the helper so `31 Feb` stays unreadable), `_month_name_cells(s) -> (mask, parsed)`, `_month_name_flag_sentence(n, with_day_first)`, `_month_only_flag(n)`.
- In `_detect_and_normalize_date_column` ONLY: compute the mask after `iso_like`; parse `s.where(~month_named)` for both readings and fill the month cells from `month_parsed` into BOTH readings (the same merge the code already does for `year_first`); in the "month-first is the only valid reading — unchanged" branch add `and not month_named.any()` so the column is rewritten (otherwise pandera re-parses raw text and rejects the month cell: probed, regressed `us+Mar` until this guard); return the M-only flag from the two branches that today return `None` after rewriting (equal-parse and month-first-rewrite) and append the "Also read ..." sentence in the day-first branch. Count `N` only when the column also holds a non-month, non-blank cell (a column written entirely with month names stays exactly as today: accepted, no flag; probed).
- Nothing else in the file moves. `_maybe_auto_normalize_percent_form` (Phase 222) is untouched; the write list is disjoint from it, so the two phases can land in either order. G6: the rule literal stays `date_format_normalized`; no new `"rule":` literal (`test_csv_rule_family_oracle.py` passed with the prototype).

**Evidence (labelled):** executed on Python 3.14.3 / pandas 3.0.1 / pandera 0.32.1 locally; **CI is Python 3.12 / pandas 3.0.3 / pandera 0.34.1** — the executors must re-run on CI. Probe matrix (HEAD → prototype), `daily_returns` unless stated:

| Case | HEAD | Prototype |
|---|---|---|
| `DD/MM/YYYY` + `12 Mar 2024` last / mid | `coerce_dtype` at the cell's row | `ok`, range ends `2024-03-12`, all first/last rows `Timestamp` |
| month-name cell as FIRST row (`10 Jan 2024`, then `13/01/2024`…) | `coerce_dtype` rows 2-3 | `ok`, M-only flag, range correct |
| US `MM/DD/YYYY` + month cell (last, first) | `coerce_dtype` | `ok`, M-only flag |
| ISO column + month cell | `coerce_dtype` | `ok`, M-only flag |
| `12-Mar-2024`, `12 March 2024`, quoted `"Mar 12, 2024"` | rejected | `ok` + day-first flag with "Also read" sentence |
| `12 Mar 24`, `12 Mär 2024` | rejected | **still rejected** (`coerce_dtype` at the row) |
| month cell out of order | order check | order check (`monotonic_dates`, row 0) — note: that rule reports row 0 for every date at HEAD, not "its row" |
| column entirely month names | accepted, no flag | accepted, no flag (unchanged) |
| `daily_nav` (3 cases) | rejected | `ok`, same flags |
| `trades` (3 cases) | rejected on the date | the date error is gone (the residual error in my synthetic file was a currency rule from my own fixture; build the real test from an existing valid trades fixture) |
| `trades` month cell **with a time** (`15 Jan 2024 10:00`) | rejected | **still rejected** (regex is date-only; pin as today) |

Existing suites run with the prototype applied to `services/csv_validator.py`: `tests/test_csv_validator.py`, `test_csv_validator_date_format_2026_05_27.py`, `test_csv_hostile_inputs_170_1.py`, `test_csv_never_raises_170_1.py`, `test_csv_excel_quirks.py`, `test_csv_header_case.py`, `test_csv_rule_family_oracle.py` → **1115 passed, 0 failed**; file restored byte-for-byte (`cmp`) afterwards.

### Pattern 7 — CONN-05: the flat body on the 400 arms

The builder is `VenueTransientHTTPException(*, status_code, code, detail, recoverable)` in `services/error_contract.py`; its guard admits any 4xx and requires a non-empty scalar `detail` and non-empty `code` `[VERIFIED: error_contract.py (Read) L410-417 signature; guard text (sed) "if not 400 <= status_code < 500"]`. It subclasses `HTTPException`, so direct-call tests using `pytest.raises(HTTPException)` and `.detail` / `.status_code` keep passing; production's handler (`services/app_error_handlers.py`) serialises it to `{"detail", "code", "recoverable"}`. The class name says "venue transient" but it is the repo's one flat-body builder; the docstring explains why a new class would fork the vocabulary — reuse it, and add one sentence to its docblock recording that it now also carries permanent 400s.

**The 11 raise sites reachable from `POST /api/validate-key` (HEAD line numbers in `routers/exchange.py`, re-derive by symbol):**

| # | Symbol / condition | Today | New `code` | `recoverable` |
|---|---|---|---|---|
| 1 | `_validate_sfox_key`: empty/blank token guard (L364) | `HTTPException(400, AUTH_FAILED_DETAIL)` | `AUTH_FAILED` | False |
| 2 | `_validate_sfox_key`: `SfoxApiError` 401/403 (L394) | same | `AUTH_FAILED` | False |
| 3 | `_validate_sfox_key`: aiohttp `ValueError` control-char token (L470) | same | `AUTH_FAILED` | False |
| 4 | `_validate_mt5_key_probe`: `parse_mt5_credentials` `wrong_server` (L591) | `HTTPException(400, MT5_WRONG_SERVER_DETAIL)` | `MT5_WRONG_SERVER` | False |
| 5 | same: `auth` kind (L593) | `HTTPException(400, AUTH_FAILED_DETAIL)` | `AUTH_FAILED` | False |
| 6 | `except Mt5ClientError`: `classify_mt5_login_error` == `auth` (L980) | AUTH_FAILED_DETAIL | `AUTH_FAILED` | False |
| 7 | same: `wrong_server` (L983) | MT5_WRONG_SERVER_DETAIL | `MT5_WRONG_SERVER` | False |
| 8 | master (trade-capable) login rejected (L1345) | `HTTPException(400, MT5_MASTER_PASSWORD_DETAIL)` | `MT5_MASTER_PASSWORD` | False |
| 9 | `validate_key`: sFOX go-dark gate (L1724) | `HTTPException(400, SFOX_DISABLED_DETAIL)` | `VENUE_DISABLED` (new) | False |
| 10 | `validate_key`: MT5 go-dark gate (L1739) | `HTTPException(400, MT5_DISABLED_DETAIL)` | `VENUE_DISABLED` (new) | False |
| 11 | `validate_key`: `create_exchange` `except ValueError` (L1745) | `HTTPException(400, str(e))` | `INVALID_REQUEST` (new) | False |

`[VERIFIED: routers/exchange.py (Read L1721-1746 for rows 9-11; grep "raise HTTPException(status_code=400" for the line list); detail constants (Read closed_sets.py L99-107): MT5_DISABLED_DETAIL = "MT5 integration is not yet available."; MT5_WRONG_SERVER_DETAIL = "Broker server not found — check the exact server name shown in your MT5 terminal login window."; SFOX_DISABLED_DETAIL = "sFOX integration is not yet available." (closed_sets.py (Read) L63)]`

Notes the planner needs:
- **The ccxt arm is 424, not 400.** `validate_key`'s `if result["error"]` raises `VenueTransientHTTPException(status_code=424, code=result["error_code"], ...)` after Phase 140.3-06 remapped the seven venue-transient sites; the TODOS prose ("answers 400 with `{detail, code, recoverable}` for a ccxt `AuthenticationError`") predates that. The flat shape exists on 424 for ccxt AUTH_FAILED; the 400 arms above are what lacks a code. The TS verdict is unaffected: `classifyKeyValidationError` reads `seamCode` first and discards the status.
- **Rows 4-8 are also reached through `/internal/keys/{id}/rotate-secret`**, which calls `_validate_mt5_key` directly and lets these exceptions propagate uncaught; the TS rotate route reads `seamErrorCode(errBody)` onto `seamCode` and classifies with the same function, so rotate gains the codes for free. Rows 9-10 are NOT reachable from rotate (the gates live in `validate_key`, not in `_validate_mt5_key`).
- `routers/internal.py` `get_key_permissions` has its own raw 400s (`HTTPException(400, SFOX_DISABLED_DETAIL)` and the `create_exchange` `ValueError` → `HTTPException(400, str(exc))`): **not** validate-key, out of scope; leave them (follow-up only if the founder wants the codes everywhere).
- **Completeness ("every" 400), beyond the 11 sites I found:** a grep of `status_code=400` across `analytics-service/services/` returns no raise site (only prose mentions), and `validate_key_permissions` / the MT5 classify seam return verdict objects, not HTTP errors, so the 11 sites are the whole set at HEAD. That is a state, not a guard. **Add a census gate** modelled on `tests/test_raw_5xx_census.py` (AST walk, `ast.Call` of bare `HTTPException`): scope it **by function** to `validate_key`, `_validate_sfox_key`, `_validate_mt5_key` and `_validate_mt5_key_probe` in `routers/exchange.py`, and fail on any `HTTPException` whose status is 400 (keyword `status_code=400` or positional). Scope by function because `fetch_trades` in the same file keeps a legitimate raw 400 ("Strategy has no connected API key") and must not be swept in. Neuter: re-raise one site as a raw `HTTPException(400, ...)` in a byte copy.
- Row 11 catches ANY `ValueError` from `create_exchange`, not only `Unsupported exchange: {name}`; `create_exchange` has no other `raise ValueError` in the body read (egress-proxy attribute assignment does not raise), so the string is stable today. The test should pin the real message.
- The emitter scanner in `seam-venue-vocabulary.invariant.test.ts` reads `code=` literals of `VenueTransientHTTPException`; literal codes keep the `routers/exchange.py: 1` dynamic-site pin unchanged (that pin counts only the one literal-less forward).

**TS side:**
- `VENUE_WIRE_CODE_TO_VERDICT` already maps `AUTH_FAILED` (→ `KEY_AUTH_FAILED`, 400). `MT5_MASTER_PASSWORD` and `MT5_WRONG_SERVER` are **already** in `VENUE_WIRE_CODES_WITHOUT_VERDICT` ("reaches ... through the cascade's 'master password' branch"), so no roster edit for them. Only `VENUE_DISABLED` and `INVALID_REQUEST` are new emitted codes: each needs a measured-reason exemption (R1/R2 in UI-SPEC), over 80 characters.
- `EXPECTED_EMITTED_CODES` goes from 48 to 50 codes; `DERIVED_FLOOR = 28` moves by the file's own rule: 0.6 x 50 = 30.0 → **30**. `[VERIFIED: src/lib/seam-venue-vocabulary.invariant.test.ts (Read) L961-967: "28 stays 28 (2026-11-19, Phase 218 plan 03)", "The hand-typed roster holds 48 codes", "0.6 x 48 = 28.8, floored to 28 - same rule, no move.", then "const DERIVED_FLOOR = 28;"]`
- `VENUE_DISABLED` / `INVALID_REQUEST` appear nowhere else in `src/` or `analytics-service/` (grep over both trees: 0 hits), so there is no existing meaning to collide with.
- `wizardKeyRosters.ts` `CLASSIFIER_RETURNED_CODES` is derived from the verdict table plus a hand-typed cascade list; no verdict row is added, so it does not move.
- **Do not extend `validate_key_venue_transient_contract.json`.** Its TS reader (`tests/lib/validate-key-venue-transient-parity.test.ts`) asserts "every case answers ONE status" (the 424 set), and the Python census `EXPECTED_FIXTURE_TRIGGERS` pins 18 triggers one-to-one with call sites. Adding 400 cases breaks both. Use a **new** fixture (e.g. `validate_key_permanent_400_contract.json`) with its own Python driver and TS parity test, same shape, own census; that is the cross-language bytes gate for UI-SPEC test 4.

**Permanence plumbing (entry finding M-03):** `ValidationResult.permanent` has one consumer, `long_fetch.py`, which consults it first and treats a stated verdict as authoritative. `_envelope_error` (derivation from `_ROUTE_TERMINAL_ERROR_CODES` ∪ `PERMANENT_VALIDATION_ERROR_CODES`) and the sync-arm 424 pre-gate (`val.error_code not in PERMANENT_VALIDATION_ERROR_CODES`) both ignore it; MT5 states `permanent=True` for wrong-server and master-password (`services/ingestion/mt5.py`). Recommended minimal fix, matching `long_fetch`'s provenance channel: at the 403 `_envelope_error(...)` call pass `recoverable=` derived from `val.permanent` when it is not `None`; at the pre-gate add `and val.permanent is not True`. The CONTEXT's literal reading (add the two codes to `_ROUTE_TERMINAL_ERROR_CODES`) fixes only `_envelope_error` and leaves the pre-gate and the pinned shared set untouched; do NOT add to `PERMANENT_VALIDATION_ERROR_CODES` (a pin, `tests/test_process_key_scope_rejection_statuses.py`, asserts that set's equality, and `exchange.py:1848`/`portfolio.py:2582` also read it) and do NOT reuse `_ROUTE_TERMINAL_ERROR_CODES` wholesale in the pre-gate (it contains `VALIDATION_UNEXPECTED`, which the pre-gate deliberately lets through as transient). MT5 is unreachable on both paths today (`_is_long_fetch` routes onboard/resync to the worker), so this is latent; test it by driving the helper/arm directly with a `ValidationResult(permanent=True)`.

**STATUS_CONTRACT.md prose coordinates:** 47 `path:line` tokens total; the S-table (rows S-01..S-31) is a historical census and its coordinates are expected to rot (record that reason, do not re-number). Prose coordinates outside the table sit at (doc lines at HEAD): 68, 109, 131, 134, 137, 138, 254, 257, 259, 262, 292, 293, 354, 520, 521, 549, 552-554, 578-580, 591, 615-617, 638. Replace each with a searchable code-text anchor (symbol name); a mechanical `grep -noE '[A-Za-z_/.-]+\.(py|ts|tsx):[0-9]+'` over the doc must return only lines inside the S-table afterwards. No test reads the doc's coordinates (grep of `STATUS_CONTRACT` consumers shows prose references only).

### Anti-Patterns to Avoid
- **Re-deriving the order from the source comment.** The comment is wrong; the registry order is the truth. Pin it.
- **A static `"200/hour"` for the aggregate** (runs first, see Pattern 2 item 5).
- **Returning `""` to "skip" a limit** (ERROR log per request).
- **Alerting on the per-IP key.** `_anon_alert_last_at` is keyed by the refusing key; per-IP keys would grow it without bound and page on normal fairness refusals. Alert only on the aggregate key and the legacy shared key.
- **Hashing the IP inside Python / putting the raw IP or hash in `X-User-Id`.**
- **Extending the 424 venue fixture** (breaks the one-status assertion).
- **Adding MT5 codes to `PERMANENT_VALIDATION_ERROR_CODES`.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fair per-IP / aggregate / tenant windows | A custom counter dict | The existing slowapi `limiter` singleton, callable providers, `exempt_when` | The repo's whole programme is one canonical limiter; a second store is the instances-vs-classes defect (`test_limiter_identity.py`) |
| Claim signing/verification | New header or JWT | `mintTenantClaim` / `verify_tenant_claim` (HMAC over `<payload>.<exp>`, `compare_digest`, 300 s ttl) | No new secret, no new trust surface (documented G-15) |
| IP pseudonym | Unkeyed hash of the IP | HMAC-SHA256 with `INTERNAL_API_TOKEN`, domain-separated message, truncated hex | IPv4 space is brute-forceable without a key; note Python holds the same key, so the value is pseudonymous, not anonymous (Open Question 1) |
| Month-name parsing | `dateutil`/`%b`/fuzzy parsing, `pd.to_datetime` on the mixed column | Strict regex + own month table + `datetime.date(y, m, d)` | Locale-independent, no 2-digit-year or non-English guess, `31 Feb` stays invalid, bounded input (cells over `MAX_DATE_CELL_CHARS = 64` are replaced before this runs) |
| Flat 400 body | A new exception class or ad-hoc `JSONResponse` | `VenueTransientHTTPException` | One vocabulary, handler already registered in production and in `build_test_app` |
| Cross-language agreement of the edge and upstream CSV numbers | A comment | A vitest that reads both source files (hand-typed expectations, one assertion `python >= edge`) | Same shape as `tests/lib/process-key-onboard-contract-parity.test.ts`; neuterable by editing either number |

**Key insight:** every defect here was "two places that must agree, with a comment saying they do". The deliverable is the gates that make disagreement red, each neutered once.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted. (One runtime-state fact the planner needs, stated in the Deploy-Order pitfall: the `memory://` counters reset on every Railway restart and are not migrated; no stored data holds the old `process_key:anon` key.)

## Common Pitfalls

### Pitfall 1: Deploy-order window (Vercel before Railway)
**What goes wrong:** Vercel ships the new mint first; old Python sees `public:<hex>` or `csv:<uuid>` as an ordinary tenant payload.
**Why:** `tenant_rate_limit_key` sends any verified payload other than `"public"` to `<scope>:t:<payload>`.
**Effect (derived from that code):** per-IP anon claims land at the 100/hour tenant tier per IP (looser than 30), csv claims land at a 100/hour per-user bucket (the pre-change size, now separate from other flows). Neither is a starvation or an outage; both are transient. Old TS + new Python is unchanged behaviour.
**How to avoid:** Python must accept both grammars (it does by construction: `public` and plain tenant payloads keep their arms). Prefer landing Python first (Phase 225 shipped as PR-1/PR-2 for the same reason); if one PR, accept and record the window. Strict Python validation of the `public:` suffix is what stops a malformed value from ever reaching `:t:`.
**Warning signs:** `process_key:t:public:` or `process_key:t:csv:` appearing in a slowapi throttle log line.

### Pitfall 2: The ceiling burns first (see Pattern 2)
Warning sign: tenants 429 while the anon aggregate counter is low.

### Pitfall 3: Alert dedupe dict growth and alert noise
`_alert_anon_bucket_saturated` compares `refusing_key` to `anon_bucket_key("process_key")` and dedupes in `_anon_alert_last_at` keyed by it. After the rekey, keep the Sentry message, fingerprint (`["anon-bucket-saturated", "process_key"]`) and tag (`anon_bucket_saturated`) byte-stable (a Sentry rule outside the repo reads the tag) and fire only for {aggregate key, legacy shared key}. Per-IP refusals stay a structured warning only. `tests/test_anon_bucket_alert.py` drives the legacy `public` claim and its 30 calls and stays valid; add aggregate and per-IP-silent arms.

### Pitfall 4: slowapi prints the bucket key (conflicts with UI-SPEC §3)
`__evaluate_limits` logs `"ratelimit %s (%s) exceeded at endpoint: %s"` with the key verbatim on every refusal `[VERIFIED: slowapi/extension.py (read)]`. UI-SPEC §3 says no 429 body, header **or log line** carries the IP hash or bucket key. The app's own handler log (`request.rate_limited`: path, limit, retry_after_seconds, correlation_id) is clean, but slowapi's library line is not, and tenant user ids already appear there today. Record as Open Question 1; do not pick silently. Options: a `logging.Filter` on the `slowapi` logger rewriting the key segment, or narrowing the UI-SPEC rule to body, headers and app logs (precedent: `credential_hash` is hashed *because* the key is printed).

### Pitfall 5: Literal pins and censuses that move
Python: `tests/test_process_key.py` — `test_process_key_limit_sizing_literals` (adds csv/aggregate/anon-per-IP literals), `test_process_key_route_registers_both_limits` (`len(groups) == 2` → 3; rename), `test_two_stacked_limits_both_evaluated` and `test_inner_tenant_limit_evaluates_independently_of_the_ceiling` (still pass under the new order: the ceiling is evaluated after the identity; confirm), `test_teaser_claim_buckets_to_anon` (stays: bare `public` is the fallback), `test_anon_bucket_exhausts_at_30...` (stays); `tests/test_anon_bucket_alert.py`; `tests/test_limiter_identity.py` (L-4 `"30 per 1 hour"` stays; gate 3 scans `routers/` NAME tokens for `get_remote_address`, extend it to every non-test `.py` under `analytics-service/` for the RLIM-01 pin — today only comments mention it outside `routers/`, so the extension is green by construction and must be shown RED by planting the token); `tests/test_tenant_claim_parsing.py`; `tests/test_tenant_claim_parity.py` (binds the shared fixture; floor "at least 4 cases").
TS: `src/lib/tenant-claim.test.ts`, `src/lib/analytics-client.test.ts` and `test_tenant_claim_parity.py` all read `tests/fixtures/tenant-claim-parity.json` — new cases move all three suites by design; compute each `claim` once with a standalone `node -e`, never by importing the module under test. `src/lib/process-key-client.test.ts` ("mints the literal payload 'public' on the anonymous teaser path" — stays valid when no IP is passed; add the IP and csv cases), `tests/integration/process-key-thin-adapters.test.ts` (pins `X-User-Id` = `public` for the teaser: stays), `src/app/api/verify-strategy/route.test.ts` and `route.seam.test.ts` (mock `getClientIp` → `127.0.0.1`).
Source-scanning guard: `process-key-client.ts` has a **line-scoped extractor** for `retriesOverride: retriesForFlow(args.flow_type, args.context),`; keep that expression on one physical line and do not touch it.
`src/lib/seam-log-coverage.test.ts` guards `console.*` sites in `process-key-client.ts`: add no new log site.
Five vitest files mock `@/lib/ratelimit` with a closed factory exporting `csvValidateLimiter` — adding `csvFinalizeLimiter` to csv-finalize requires adding it to the mocks of `src/app/api/strategies/csv-finalize/route.test.ts`, `src/__tests__/csv-finalize-after-failloud.test.ts`, `csv-finalize-c14-regression.test.ts`, `csv-finalize-concurrent-never-classified.test.ts`, `csv-finalize-cross-submission-merge.test.ts` (a missing export on a `vi.mock` factory throws). csv-validate's mocks and `seam-ratelimit-posture.invariant.test.ts` (roster pins `csv-validate` → `csvValidateLimiter`) stay as they are; csv-finalize left the seam import edge in Phase 145, so it is not in that roster.

### Pitfall 6: The "edge split" changes less than it reads
The two CSV routes already pass different identifiers (`strategies-csv-validate:${user.id}` and `strategies-csv-finalize:${user.id}`) into `checkLimit(csvValidateLimiter, ...)`, so they already count separately (distinct identifiers are distinct Upstash keys; the key composition is not documented on the Upstash page I fetched, so this is `[ASSUMED]` — the identifiers are distinct strings and the TS test can assert the two `checkLimit` identifiers differ). The `csvValidateLimiter` docblock claim "the wizard's validate→submit cycle rides the same dedicated bucket" is therefore false at HEAD. The split is configuration hygiene (own instance, own docblock, own tuning), with the **60 s window kept** so the wire sentence "Wait a minute and try again" stays true; size it 20, unchanged. Test: each route calls `checkLimit` with its own limiter object (identity), and the validate route's limiter is not the finalize route's.

### Pitfall 7: pandas first-element format inference
Why `masks` rather than rewriting month cells to ISO text before the detector: rewriting works for a month cell in the middle or the end, but the FIRST-cell case then fails (the ISO first cell fixes pandas' inferred format, every `dd/mm/yyyy` cell becomes NaT). Masking month cells out of the parse input and merging their independent parse into both readings fixes first, middle and last. Probed both; keep the mask design.

### Pitfall 8: Local environment is not CI's
Python 3.14.3 / pandas 3.0.1 / pandera 0.32.1 locally vs 3.12 / 3.0.3 / 0.34.1 in CI; the worktree has **no `node_modules`**, so no vitest run was possible in this session. Every TS statement below is from reading, not execution. Run `npm ci` first.

### Pitfall 9: A3 in the UI-SPEC is wrong in a way that matters
UI-SPEC A3 says that if MT5 is switched off, rotating a stored MT5 key "reaches the Python arm and renders `UNKNOWN`". Measured: the Python `rotate_key_secret` calls `_validate_mt5_key` **directly**; the `mt5_enabled_server()` gate lives only in `validate_key`. Neither the TS rotate route (`grep -c isMt5EnabledServer` → 0) nor the Python rotate route has a gate, so with MT5 dark a rotate runs a **live probe** and never emits `VENUE_DISABLED`. That is a go-dark leak (small: needs an existing stored MT5 key), not a verdict gap. See Open Question 3.

### Pitfall 10b: `exempt_when` predicates are key functions in disguise
slowapi calls them for every request and re-raises whatever they throw (`swallow_errors` is False), turning a throttling concern into a bodyless 500 that feeds the TS breaker (the G-8 class). `_process_key_not_anonymous` and the csv-scope predicate must never raise: build them on `verify_tenant_claim` (already never-raise) and wrap the classification in the same try/except-return-safe-default shape; the safe default for the aggregate exemption is "anonymous" (not exempt) so a failure refuses rather than skips a limit, and for the ceiling exemption it is "not csv" (not exempt). Pin both with the existing hostile-input corpus style (`test_tenant_claim_parsing.py`).

### Pitfall 10: Per-request cost and keyspace
The key function runs twice per `key`-provider group per request and each call HMAC-verifies the claim; at this traffic that is irrelevant, but do not add a DB call. `memory://` per-IP keys are created per distinct IP; an IPv6 attacker rotating addresses mints keys up to the request rate x one hour; the aggregate bounds the admitted anon work, not the key count. Normalising IPv6 to its /64 before hashing is an optional hardening (Open Question 4), not required.

## Code Examples

Only values read from source this session appear as literals.

### Reading the verified constants (do not restate numbers; import or re-read)
```python
# Source: analytics-service/routers/process_key.py (Read L110-124)
_PROCESS_KEY_TENANT_LIMIT = "100/hour"
_PROCESS_KEY_ANON_LIMIT = "30/hour"
_PROCESS_KEY_CEILING_LIMIT = "500/hour"
```

### Provider sizing by key prefix (shape; new constants are the planner's)
```python
def _process_key_limit_for(key: str) -> str:
    if key == anon_bucket_key("process_key") or key.startswith(anon_bucket_key("process_key") + ":"):
        return _PROCESS_KEY_ANON_LIMIT
    if key.startswith("process_key:csv:"):
        return _PROCESS_KEY_CSV_LIMIT
    return _PROCESS_KEY_TENANT_LIMIT
```

### The exemption predicate shape (slowapi 0.1.10 passes the request to a one-parameter callable)
```python
def _process_key_not_anonymous(request: Request) -> bool:
    payload = verify_tenant_claim(request)          # never raises
    return not (payload == ANON_PAYLOAD or (payload or "").startswith("public:"))
```

### Flat 400 (the one builder)
```python
raise VenueTransientHTTPException(
    status_code=400, code="AUTH_FAILED", detail=AUTH_FAILED_DETAIL, recoverable=False,
)
```

### TS payload derivation, inside the one chokepoint (shape)
```ts
// tenant-claim.ts: anonymousClaimPayload(ip, secret): "public" | `public:${hex32}`
// process-key-client.ts, where the claim is minted today (mintTenantClaim({ userId: args.userId }, internalToken)):
//   payload = args.userId === "public" ? anonymousClaimPayload(args.clientIp ?? "unknown", internalToken)
//           : args.flow_type === "csv" ? `csv:${args.userId}` : args.userId
```

### Month-name flag text (UI-SPEC §1.3, pinned character for character)
`Read 1 date written with a month name (such as 12 Mar 2024) and normalized it to YYYY-MM-DD.` / `Read {N:,} dates ... and normalized them to YYYY-MM-DD.` / `Also read 1 date written with a month name (such as 12 Mar 2024).` / `Also read {N:,} dates written with a month name (such as 12 Mar 2024).` The day-first sentence stays byte-identical: `Detected day-first (DD/MM/YYYY) dates and normalized them to YYYY-MM-DD.`

## State of the Art

| Old approach | Current approach | When | Impact |
|--------------|------------------|------|--------|
| One shared anon bucket, 30/h platform-wide | Per-IP 30/h + aggregate cap | This phase | A few IPs no longer deny each other |
| IP-keyed slowapi limits behind Railway's proxy | `tenant_or_platform_key` everywhere | Phases 140.1 / 163 | Already complete; this phase only pins it |
| Substring cascade over `detail` | `seamCode` table first, cascade second | Phase 140.3-05 | The 400 arms gain a code, verdicts unchanged |

**Deprecated/outdated:** the `routers/process_key.py` docblock statement that `exempt_when` "cannot see the request" (false in slowapi 0.1.10, which passes the request to a one-parameter callable); the `rate_limit.py` FINDING-10 prose and the line "Nothing ... outside `routers/simulator.py` (FINDING-10) may key on it"; the "Verify strategy (Python) 1 of 5/hour" and "CSV validate (Python)" rows of the token-cost table (re-state them for the new csv/anon tiers); the `csvValidateLimiter` docblock ("the upstream 30/hour cap (the CSV router's limiter ...)"; `routers/csv.py`'s own `/csv/validate` `30/hour` is real but has no TS caller and stays pinned at `30 per 1 hour`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Aggregate anon ceiling 200/hour | Pattern 3 | Too low starves the teaser growth path; too high weakens "well below 500". Founder-retunable constant |
| A2 | CSV per-tenant tier 60/minute (3x edge) | Pattern 3/5 | Too low re-opens upstream 429; the bucket bound (2 buckets per exact span, a third under latency) comes from Upstash's documented window description, not from running Upstash; the latency allowance assumes upstream trail ≤ one window (the seam budget is 60 s) |
| A3 | Exempt CSV from the 500/hour ceiling (vs slice) | Pattern 5, Open Q 2 | Loses the collective backstop for CSV; founder allowed either |
| A4 | Upstash key = prefix + identifier, so csv-validate and csv-finalize already count separately | Pitfall 6 | If they shared a counter, the split is a behaviour change (halves the budget per route) |
| A5 | `VENUE_DISABLED`/`INVALID_REQUEST` render `UNKNOWN` through the cascade (UI-SPEC claims it; I did not replay it, no node_modules) | CONN-05 | A stray cascade needle would give a different verdict; the exemption reason must be written from a replay |
| A6 | Railway runs exactly 1 replica (CONTEXT states it; `railway.toml` has no `numReplicas`, live value not readable from the repo and variables were off-limits) | Locked decisions | N replicas multiply every tier by N |
| A7 | slowapi's warning line carrying the key is acceptable under house norm (precedent `credential_hash`) | Pitfall 4 | Contradicts UI-SPEC §3 wording; needs a decision |
| A8 | New-TS/old-Python skew effects (looser anon, separate csv bucket) | Pitfall 1 | Derived by reading the current key function, not by running skew |
| A9 | The decorator reorder also changes how TENANT refusals spend the ceiling (a tenant at its own limit no longer burns ceiling tokens). No existing pin observes it (32 pins green under a byte-copy swap), but the founder-visible effect is "slightly more ceiling headroom under tenant abuse" | Pattern 2 | None adverse; recorded so the CHANGELOG states it |
| A10 | The aggregate/ceiling exemptions' safe defaults on a predicate fault ("anonymous" / "not csv") | Pitfall 10b | A wrong default either refuses a legitimate anonymous call or skips a limit on a fault |

## Open Questions

1. **slowapi's own throttle log prints the bucket key (and thus the IP hash).**
   - Known: executed source shows `limit_key` in a WARNING on every refusal; UI-SPEC §3 forbids the hash/bucket key in any log line; the app handler's log is clean; tenant ids already print.
   - Unclear: whether the founder wants the strict reading.
   - Recommendation: add a small `logging.Filter` on the `slowapi` logger that replaces the key segment for `process_key:anon:*` (cheap, testable, neuterable); if the planner prefers, narrow the UI-SPEC rule to body, headers and app logs and say so in the plan.
2. **CSV ceiling: exempt or slice.**
   - Known: only exemption satisfies "never"; a slice sized for N users is `N x 2,400/h`.
   - Recommendation: exempt via `exempt_when` on the ceiling decorator; record the lost backstop in the CHANGELOG notes.
3. **The rotate-secret go-dark gap (UI-SPEC A3), corrected above.** No gate on either side; a rotate while MT5 is dark live-probes. Decide: add `isMt5EnabledServer` to the TS rotate route (return `KEY_VENUE_NOT_ENABLED`, the copy is true there because nothing is sent) and/or `mt5_enabled_server()` at the top of Python `rotate_key_secret`; or book it. UI-SPEC says the planner must not silently skip the decision.
4. **IPv6 /64 normalisation before hashing** — optional hardening; the aggregate is the backstop.
5. **Live replica count and worker count** — repo shows one uvicorn process (`CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}`, no `--workers`) and no replica pin; the live service setting was not read.
6. **`routers/internal.py` SFOX_DISABLED 400** (key-permissions path) is not validate-key; left alone.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | pytest, mypy | yes | 3.14.3 local (CI 3.12) | run the full suite on CI |
| pytest (from `analytics-service/`) | all Python gates | yes | works; `test_process_key.py` subset takes ~45 s (collection-dominated) | — |
| mypy | strict gate | yes | 2.0.0 local (CI pin may differ) | CI is authoritative |
| slowapi / limits | limiter probes | yes | 0.1.10 / 5.8.0 | — |
| Node | vitest, `node -e` fixture generation | yes | 25.8.1 | — |
| `node_modules` | vitest, tsc, eslint | **no** (absent in this worktree) | — | `npm ci` before any TS task; TS claims here are by reading |
| Supabase local stack / Docker | none of this phase's gates | not needed | — | tests use `TestClient`, no DB |
| `gsd-tools` | planning | yes | — | `graphify` is disabled in this repo (status: not enabled), so no graph context was used |

**Missing dependencies with no fallback:** none blocks research; executors must `npm ci`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service, `asyncio_mode = auto`, `pythonpath = .`) + vitest (root) |
| Config file | `analytics-service/pytest.ini`; `vitest.config.ts` |
| Quick run command | `cd analytics-service && python3 -m pytest <file> -q -p no:cacheprovider` |
| Full suite command | CI: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`; TS: `npx vitest run` |
| Type gate | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements → Test Map
| Req ID | Behaviour | Test type | Automated command | File exists? |
|--------|-----------|-----------|-------------------|--------------|
| CONN-05 | Each of the 11 400 arms answers flat `{detail, code, recoverable:false}`, detail byte-identical (one test per venue: ccxt-adjacent `create_exchange` arm, sFOX, MT5) | integration (TestClient, real handler) | `cd analytics-service && python3 -m pytest tests/test_validate_key_permanent_400.py -q` | Wave 0 (new; start from the `app_client` harness in `test_validate_key_venue_transient.py`) |
| CONN-05 | Direct-call tests still catch the subclass | unit | `python3 -m pytest tests/test_sfox_validate.py tests/test_mt5_validate.py tests/test_mt5_validate_parity.py tests/test_mt5_rotate_secret_internal.py -q` | yes |
| CONN-05 | Roster/census: two new codes have reasoned exemptions; floor 30 | vitest invariant | `npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts src/lib/wizardErrors.invariant.test.ts src/lib/wizardKeyRosters.test.ts src/lib/dialog-envelope.invariant.test.ts` | yes (edit) |
| CONN-05 | Rendered parity: new flat bodies classify to the HEAD verdict | vitest, zero mocks | `npx vitest run tests/lib/validate-key-permanent-400-parity.test.ts` | Wave 0 (new, new fixture) |
| CONN-05 | Permanence plumbing: `val.permanent` honoured at `_envelope_error` call and the 424 pre-gate | unit | `python3 -m pytest tests/test_process_key_scope_rejection_statuses.py tests/test_process_key.py -k "permanent or recoverable" -q` | partly (extend) |
| CONN-06 | Each accepted spelling x (mid, first, last) x (DD/MM, MM/DD, ISO) x (`daily_returns`, `daily_nav`, `trades`): `ok`, row count, range, preview date type == neighbours | unit | `python3 -m pytest tests/test_csv_validator_date_format_2026_05_27.py -q` | yes (extend; helpers `_csv`, `_dates`, `_flag_rules`) |
| CONN-06 | Rejections held: `12 Mar 24`, non-English month, month+time, out-of-order | unit | same file | extend |
| CONN-06 | Flag text: five forms character for character; existing day-first flag byte-identical; all-month column unchanged | unit | same file | extend |
| CONN-06 | No new `"rule":` literal | oracle | `python3 -m pytest tests/test_csv_rule_family_oracle.py tests/test_csv_never_raises_170_1.py tests/test_csv_hostile_inputs_170_1.py -q` | yes |
| RLIM-01 | Claim grammar: `public:<hex32>` → `process_key:anon:<hex>`; malformed `public:*` → shared anon, never `:t:`; `csv:` grammar; cross-language fixture cases | unit + parity | `python3 -m pytest tests/test_tenant_claim_parsing.py tests/test_tenant_claim_parity.py tests/test_process_key.py -k "key_func or claim" -q`; `npx vitest run src/lib/tenant-claim.test.ts src/lib/analytics-client.test.ts` | yes (extend) |
| RLIM-01 | IP A exhausting its 30 leaves IP B admitted; aggregate refuses after its size; **IP A hammering well past 30 does not move the aggregate or the ceiling**; tenant unharmed | integration (`throttled_client`, shrink constants with `monkeypatch.setattr`) | `python3 -m pytest tests/test_process_key_anon_ip_tier.py -q` | Wave 0 (new) |
| RLIM-01 | Evaluation order literal: `[per-identity, aggregate, ceiling]`; three registered groups | unit | `python3 -m pytest tests/test_process_key.py -k "registers" -q` | yes (rename/edit) |
| RLIM-01 | 429 body, headers and the app handler's structlog line carry neither IP nor hash nor key | integration (`capture_logs`) | `python3 -m pytest tests/test_process_key_anon_ip_tier.py -k hygiene -q` | Wave 0 |
| RLIM-01 | Anon alert fires for aggregate and shared keys only; per-IP silent; dict stays bounded | unit | `python3 -m pytest tests/test_anon_bucket_alert.py -q` | yes (extend) |
| RLIM-01 | No analytics-service limit keyed on the proxy IP (scan widened beyond `routers/`) | static | `python3 -m pytest tests/test_limiter_identity.py -q` | yes (extend gate 3) |
| RLIM-01 | TS mint: IP known → `public:<hex32>`; unknown → `public`; raw IP never in any header/log; `X-User-Id` stays `public` | vitest | `npx vitest run src/lib/process-key-client.test.ts tests/lib/process-key-client.test.ts src/app/api/verify-strategy` | yes (extend) |
| RLIM-02 | 60 csv calls in one minute for one user, none 429; the 61st is refused (bounded); tenants saturating the 500 ceiling (shrunk constant) do not refuse csv | integration | `python3 -m pytest tests/test_process_key_csv_tier.py -q` | Wave 0 (new) |
| RLIM-02 | TS mints `csv:<uuid>` for `flow_type: "csv"` and only then; independent HMAC recompute | vitest | `npx vitest run src/lib/process-key-client.test.ts tests/integration/process-key-thin-adapters.test.ts` | yes (extend) |
| RLIM-02 | Python csv tier >= edge number, read from both source files | vitest (cross-language, hand-typed) | `npx vitest run tests/lib/csv-limit-agreement.test.ts` | Wave 0 (new) |
| RLIM-02 | csv-validate and csv-finalize use distinct limiter objects and distinct identifiers; 60 s windows | vitest | `npx vitest run src/app/api/strategies/csv-finalize src/__tests__/csv-validate-route.test.ts src/__tests__/csv-finalize-*.test.ts src/lib/seam-ratelimit-posture.invariant.test.ts` | yes (edit mocks) |
| RLIM-02 | Docblocks cite the real cap (no "30/hour" upstream claim) | static | grep gate in the same vitest as above (assert the stale phrase is gone and the csv tier literal is named) | extend |

### Sampling Rate
- **Per task commit:** the single touched file's quick command (≈45 s for `test_process_key.py` due to collection).
- **Per wave merge:** all Python files named above + the vitest set for that wave + the mypy gate.
- **Phase gate:** CI full suite green, bound to the head SHA with the expected check count, before `/gsd-verify-work`.

### PROOF-01 neuter points (byte copy → RED naming its arm → `cp` back + `cmp` → GREEN, recorded verbatim in the plan SUMMARY)
| Gate | Neuter | Expected RED arm |
|---|---|---|
| CONN-05 per-venue | revert one raise in `routers/exchange.py` to `HTTPException(400, detail=...)` (do each venue) | that venue's test reads `code` absent |
| CONN-05 roster | add a `code="VENUE_DISABLED"` raise with the roster entry removed | member-for-member assertion in `seam-venue-vocabulary.invariant.test.ts` |
| CONN-06 acceptance | make `_month_name_cells` return an all-False mask | acceptance tests per spelling |
| CONN-06 first-row | remove `.where(~month_named)` masking only | first-row case |
| CONN-06 US branch | delete `and not month_named.any()` | US + month case |
| CONN-06 flag | drop the count / sentence | flag-text test |
| RLIM-01 grammar | make the classifier treat `public:<hex>` as shared | per-IP isolation test |
| RLIM-01 order | swap the decorator order back (ceiling at the bottom) | hammer-does-not-burn test and the order-literal test |
| RLIM-01 aggregate | remove the aggregate decorator | aggregate refusal test and `len(groups) == 3` |
| RLIM-01 alert | alert on any `process_key:anon*` key | per-IP-silent arm |
| RLIM-01 pin | plant `get_remote_address` as a NAME in a `services/` byte copy | widened gate 3 |
| RLIM-01 TS | make `anonymousClaimPayload` always return `public` | TS mint test |
| RLIM-02 scope | `postProcessKey` ignores `flow_type` | TS csv test AND Python plain-claim contrast |
| RLIM-02 size | set `_PROCESS_KEY_CSV_LIMIT = "10/minute"` | the 60-call test |
| RLIM-02 exemption | drop the ceiling `exempt_when` | tenants-saturate-ceiling test |
| RLIM-02 split | point csv-finalize back at `csvValidateLimiter` | limiter-identity assertion |
| RLIM-02 agreement | edit either number in a source copy | cross-language agreement test |

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_validate_key_permanent_400.py` — CONN-05 per-venue wire tests + `validate_key_permanent_400_contract.json` fixture + `tests/lib/validate-key-permanent-400-parity.test.ts`
- [ ] `analytics-service/tests/test_process_key_anon_ip_tier.py` — RLIM-01 (isolation, aggregate, hammer-no-burn, hygiene)
- [ ] `analytics-service/tests/test_process_key_csv_tier.py` — RLIM-02
- [ ] `tests/lib/csv-limit-agreement.test.ts` — cross-language number agreement
- [ ] new cases in `tests/fixtures/tenant-claim-parity.json` (standalone `node -e`)
- [ ] `npm ci` in the executing worktree

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (service auth unchanged) | `INTERNAL_API_TOKEN` bearer + `X-Tenant-Claim`; unchanged |
| V3 Session Management | no | — |
| V4 Access Control | yes | Claim scope (`public:`, `csv:`) is signed; Python never trusts `X-User-Id` |
| V5 Input Validation | yes | Strict `fullmatch` on the `public:` suffix and `csv:` uuid; CSV month regex is anchored, bounded, ASCII; cells over 64 chars never reach it |
| V6 Cryptography | yes | HMAC-SHA256 only (`createHmac` / `hmac.compare_digest`); never hand-rolled; domain-separated pseudonym message |
| V7 Error Handling and Logging | yes | No IP, hash or bucket key in 429 body/headers/app logs; slowapi's line is Open Question 1 |
| V8 Data Protection | yes | Raw IP never leaves Vercel; the hash is pseudonymous (Python holds the same key) |
| V11 Business Logic (anti-automation) | yes | Per-IP + aggregate + ceiling ordering is the control |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Anonymous flood burns the platform ceiling through refused requests | Denial of service | Evaluate per-identity first, aggregate second, ceiling last (Pattern 2); probe-proven |
| Forged/replayed claim to pick a bucket | Spoofing / Tampering | HMAC + `exp` (300 s) + `compare_digest`; reserved prefixes route malformed values to the shared anon arm |
| `X-Forwarded-For` spoofing to rotate buckets | Spoofing | `getClientIp` trusts `x-real-ip` only on Vercel, else the rightmost XFF entry; aggregate is the backstop |
| IPv6 address rotation | Denial of service | Aggregate cap; optional /64 normalisation |
| Hostile CSV cell (ReDoS, very long cell) | Denial of service | Existing `MAX_DATE_CELL_CHARS = 64` placeholder before parse; month regexes are anchored alternations over short fixed classes |
| IP/hash disclosure through logs | Information disclosure | App-handler log carries none; filter the slowapi line or narrow the rule (Open Question 1) |
| Cell content echoed in an error | Information disclosure | Flag sentences use a fixed example (`12 Mar 2024`), never a cell |

## Sources

### Primary (HIGH confidence — read or executed this session)
- slowapi 0.1.10 installed source (`extension.py` `__evaluate_limits`, `_check_request_limit`, `__limit_decorator`; `wrappers.py` `LimitGroup.__iter__`, `Limit`); version equals the `requirements.txt` pin
- `limits` 5.8.0 executed probe (fixed-window anchoring and key shape)
- In-repo reads: `services/rate_limit.py`, `routers/process_key.py` (limits, providers, `_envelope_error`, the 424 pre-gate), `services/app_error_handlers.py` (alert, 429 handler), `routers/exchange.py` (validate-key arms), `services/error_contract.py` (`VenueTransientHTTPException`), `services/closed_sets.py`, `services/csv_validator.py`, `routers/csv.py`, `routers/internal.py` (rotate path), `src/lib/tenant-claim.ts`, `src/lib/process-key-client.ts`, `src/lib/ratelimit.ts`, `src/lib/wizardErrors.ts` (verdict table and exemption roster), `src/lib/seam-venue-vocabulary.invariant.test.ts`, `src/lib/wizardKeyRosters.ts`, rotate-secret route, csv-validate/csv-finalize/verify-strategy routes, `tests/test_process_key.py` and sibling limiter tests, the two committed fixtures
- Executed probes: limit-stack order (3 variants), CSV date matrix (14 cases x 3 formats), 7 existing CSV test files with the prototype applied (1115 passed) and restored with `cmp`

### Secondary (MEDIUM confidence)
- upstash.com/docs/redis/sdks/ratelimit-ts/algorithms — sliding-window formula and approximation statement (fetched; key composition not described there)

### Tertiary (LOW confidence)
- The Upstash bucket bound (at most 20 per bucket, at most two buckets per exact 60 s span, a third under upstream latency) is my reading of the documented algorithm, not an observation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; versions read from the pins and the installed packages.
- Architecture (limiter stack, claim grammar): HIGH — order and `exempt_when` behaviour executed; skew effects derived.
- CONN-06: HIGH locally, MEDIUM until re-run on CI versions (pandas 3.0.3 / pandera 0.34.1 / Python 3.12).
- CONN-05: HIGH on the arm enumeration; the TS verdict statements for the two new codes are cited from the UI-SPEC (A5), not replayed.
- Pitfalls: HIGH for items backed by a probe or a source read; MEDIUM for A4/A8.

**Gate skips, stated plainly:** `graphify` is disabled in this repo (no graph context); no Context7/web research was needed beyond the one Upstash page (all library behaviour was read from the installed source); `research-plan`/`research-store` seam steps were not run because no external library question remained open; `package-legitimacy` not run (no packages); no vitest run was possible (no `node_modules`).

**TODOS closure list for the ship (CLAUDE.md rule b):** delete `[170.1-CSV-ODD-SPELLING-REJECTED]`; the whole "v1.16 Phase-140.1.2 review — findings routed onward" section (M-03 permanence plumbing, M-07 body shapes, coordinate drift); "verify-strategy teaser: per-IP front door cannot see the shared anon bucket"; "csv-validate: 12x over the shared `/process-key` tenant tier + stale docblock citation". Name them in the CHANGELOG entry; fix any pointer that cites them in the same PR (`grep` showed `[170.1-CSV-ODD-SPELLING-REJECTED]` in `CHANGELOG.md`, `.planning/REQUIREMENTS.md`, the v1.22 research files and the 170.1 verification; those are lineage, not live owners).

**Research date:** 2026-11-24
**Valid until:** 2026-12-08 (the limiter stack, the roster counts and line numbers are fast-moving in a repo with ~6 parallel phases; re-derive anchors by symbol before acting)
