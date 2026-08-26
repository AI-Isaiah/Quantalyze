# Phase 163: HARDEN — Fail safe, closed, and loud - Research

**Researched:** 2026-08-26
**Domain:** Backend hardening — logging redaction, request-path failure honesty, worker/SQL plumbing, rate-limit + audit coverage, repo-hygiene gates
**Confidence:** HIGH (every claim below is measured against HEAD this session unless tagged otherwise)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**.planning username scrub (SC-4)**
- **Scope corrected by measurement: 80 files, not the ~50 the ROADMAP estimated.** Measured
  2026-08-26 on main: 80 tracked `.planning/` files contain the macOS username, 57 contain
  `/Users/` absolute paths. Plan against 80.
- **Forward-only redaction, no history rewrite.** The username is already published on a
  public repo — pushed, cloneable, in GitHub's history. Scrubbing forward stops new leakage
  but does NOT unpublish. Founder accepted that limit explicitly rather than force-pushing
  ~700 commits, which would break every open PR ref, invalidate the
  `archive/v1.20-phase-162-planning-artifacts` tag, and still leave forks and caches holding
  the old objects.
- Replacement token `<user>` — greppable and obviously a placeholder.
- **Gate: a NEW no-allowlist CI scan job.** Do not extend gitleaks — its allowlist is
  path-based and therefore structurally blind to this class. The gate must fail the build on
  a new occurrence and must be demonstrated RED when neutered.
- ⚠️ Severity is metadata, not credentials. Say so in the requirement; do not inflate it.

**bridgeComputeLimiter (SC-5)**
- **Size it from measured backend reality, not from the existing limiter family.** Derive
  from actual bridge + portfolio-optimizer job durations and worker concurrency on PROD
  before choosing a number. The "30× front/back mismatch" figure in the ROADMAP is inherited
  and must be re-derived — the same drift trap as the curated-copy migration header, whose
  PROD census moved 129 → 103 rows within a single day.
- ⛔ Do NOT resize the shared `userActionLimiter` (`src/lib/ratelimit.ts:97`, 5/60s).
- Existing family for shape reference only: `keysSyncUserLimiter` 30/60s,
  `syncProgressLimiter` 60/60s, `adminActionLimiter` 20/60s, `publicIpLimiter` 10/60s,
  `simulatorLimiter` 20/3600s.
- The `add_wizard_composite_key` audit-coverage decision (pragma vs real emission) must be
  RECORDED in the requirement, not just implemented.

**createAdminClient post-commit 500 class (SC-2)**
- **Hoist the client construction ABOVE the irreversible commit** at each of the three known
  sites. The defect is sequencing, not error handling — a post-commit throw means the work
  landed and the user got a 500.
- ⛔ Do NOT add a non-throwing `createAdminClientOrNull()` variant. Converting a loud failure
  into a quiet one is the exact anti-pattern this phase exists to close, and it would need a
  second rule to stop it spreading across the other 179 call sites (182 total measured).
- A source-scan gate for the class was considered and deferred: static detection of
  "constructed after an await-commit in the same function" across 182 sites is likely to
  produce false positives. Fix the three sites; revisit the gate only if a fourth appears.

### Claude's Discretion
- SC-1 (structlog frozen-proxy) is fully prescribed by the success criterion — source-scan
  gate for Mode A, behavioral redaction test for Mode B, each demonstrated RED when neutered.
  No grey area. ⚠️ Note for the planner: a scan of `analytics-service/` on 2026-08-26 found
  NO module-scope `.bind()` in non-test code, so Mode A's gate is PREVENTIVE, not corrective.
  It must still be proven RED by introducing a violation, or it is a test that cannot fail.
- SC-2's `checkStuckNotifications` "nothing stuck" vs "could not tell" distinction, and the
  paging-on-failed-denominator behaviour, are at Claude's discretion within the constraint
  that both must be falsifiable by the integration test.
- SC-3 (INTO STRICT removal, deterministic resync pre-check, `body.cancel()`) is mechanical.
- SC-4's `simulator.py` tenth IP-keyed route repair and the panel-removal abort are
  mechanical; the concealing wrapper-check test must become an equality assertion with the
  quarantine list shrinking to 0.

### Deferred Ideas (OUT OF SCOPE)
- Rewriting git history to purge the username from published commits — explicitly declined
  by the founder 2026-08-26 as costing more than it buys.
- A source-scan gate for the `createAdminClient`-after-commit class — deferred as likely
  false-positive-prone across 182 call sites; revisit if a fourth site appears.
- `/gsd-pr-branch` adoption and its deletion guard — landed separately as v0.74.1.1, not
  part of this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-05 | structlog frozen-proxy class fixed at the class level; source-scan gate (Mode A) + behavioral redaction test (Mode B) | §1 — full mechanism verified against structlog source via Context7; worker-process gap found (`main_worker.py` never configures) |
| OPS-06 | `createAdminClient()` cannot throw on the request path after an irreversible commit — three known sites closed | §2 — all sites located at HEAD (4 pattern occurrences in 3 files); throw mechanism verified |
| OPS-07 | Flag-monitor honesty: `checkStuckNotifications` distinguishes states; failed denominator read PAGES; integration test falsifies both | §2 — both defects located with exact lines; integration-test vacuity confirmed from 141.2 record |
| OPS-08 | 10-param `_enqueue_compute_job_internal` drops `INTO STRICT` on lost-race branches | §3 — latest definition + all 4 STRICT branches located; 7-param de-STRICT pattern to copy quoted |
| OPS-09 | Resync draft pre-check deterministic (`ORDER BY created_at DESC` + bounded window) | §3 — query chain located; two-draft residual and stale-comment interplay documented |
| OPS-10 | Retry loop cancels abandoned response bodies (`body.cancel()`) | §3 — the single abandoning `continue` located; structural-Response capability-check requirement identified |
| SEC-01 | Server-side password policy backing client `minLength={6}` verified, enforced, documented | §4a — client sites + local config found; hosted-project verification is a human checkpoint |
| SEC-02 | Tracked `.planning/` docs pass a NO-ALLOWLIST username/path scan | §4b — counts re-measured; 7 files OUTSIDE `.planning/` found (incl. 2 applied migrations); gate home + needle problem analyzed |
| SEC-03 | `add_wizard_composite_key` policed by the audit-coverage gate; pragma-vs-emission decision recorded | §5 — gate mechanism + the escape mechanism (name absent from allowlist, pragma decorative) verified |
| SEC-04 | Bridge + portfolio-optimizer flows get named `bridgeComputeLimiter`; ⛔ no `userActionLimiter` resize | §5 — both front-door sites + both backend budgets verified at HEAD; roster-pin tests identified |
| SEC-05 | Tenth IP-keyed route (`simulator.py`) repaired; concealing wrapper-check becomes equality; quarantine → 0 | §4c — key func, quarantine constant, and the concealing `continue` all located |
| SEC-06 | Removing a panel mid-validate aborts the in-flight credential-carrying POST | §4d — `doRemove` (no abort) vs `handleStopWaiting` (aborts) verified; server ignores `request.signal` |
</phase_requirements>

## Summary

This phase is 100% in-repo hardening: no new packages, no new services, no schema-shape
changes (one forward-only SQL function re-base). Every one of the five success criteria
resolves to specific, already-located code sites; the research below pins each with
file:line at HEAD and quotes the discrete values a plan or gate will assert against.

Two findings materially extend what the ROADMAP already knew:

1. **The Mode B structlog failure is not hypothetical — the worker process never configures
   logging at all.** `main_worker.py` contains zero references to `configure_logging` or
   `structlog`, no non-test module imports `main.py`, and the Railway worker service runs
   `python -m main_worker` (Dockerfile CMD-override note). So the process that actually runs
   ccxt ingestion and MT5 calls emits through structlog's DEFAULT chain — no
   `_redact_processor` — and without the stdlib `setLogRecordFactory` bridge that exists
   precisely to stop `logger.warning("ccxt: %s", str(exc))` leaking HMAC signatures. The
   Mode B behavioral test should target this, and the fix is one line in each entrypoint
   plus main.py import-order.
2. **The no-allowlist username scan cannot reach zero on `.planning/` alone.** 7 tracked
   files OUTSIDE `.planning/` also carry the username — 5 under `docs/`, and 2 APPLIED
   Supabase migrations (comment line 5 of each). A truly no-allowlist repo-wide gate
   requires a decision about those (see §4b) — including the repo rule that editing applied
   migrations is a tracked invariant violation.

**Primary recommendation:** plan the phase as five independent workstreams matching the five
SCs (they are file-disjoint except for shared test rosters), with the PROD limiter
measurement and the hosted-password-policy read as explicit early tasks/checkpoints, and
demonstrate every new gate RED by neutering — with its expected-count tokens measured
PRE-EDIT (this file records those counts below so they are on the record before any edit).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| structlog redaction (SC-1) | Python service (FastAPI + worker processes) | — | Redaction must be process-local at the emitting process; both `uvicorn main:app` and `python -m main_worker` entrypoints own it |
| Mode A source-scan gate | CI (pytest source scan, analytics-service) | — | Precedent: `tests/test_limiter_identity.py` already scans `routers/` source tokens |
| createAdminClient hoist (SC-2) | API / Next.js route handlers | — | Sequencing defect inside three route files; no DB change |
| Flag-monitor honesty (SC-2) | API (Vercel cron route) + `src/lib` | Vercel cron dashboard (consumes status code) | A non-200 is what makes the cron run register failed — that IS the page channel |
| Enqueue de-STRICT (SC-3) | Database (plpgsql, forward-only migration) | CI `sql-tests` job | Function body lives in `supabase/migrations/`; ⚠️ merging to main auto-applies to PROD |
| Resync pre-check ordering (SC-3) | Python service (request path) | — | PostgREST query-builder chain in `routers/process_key.py` |
| `body.cancel()` (SC-3) | Frontend server (`src/lib/resilient-fetch.ts`) | — | The seam retry loop runs in Vercel functions |
| Password policy (SC-1/SEC-01) | Supabase Auth (hosted GoTrue) | Client forms (UX floor only) | `supabase.auth.signUp` goes browser → Supabase Auth directly; no Next.js server in between |
| Username scan (SEC-02) | CI (repo-wide script) | — | Precedent: `scripts/check-*.ts` wired into `npm run lint` |
| simulator limiter key (SEC-05) | Python service | — | slowapi `key_func` swap + test roster |
| Panel-removal abort (SEC-06) | Browser / client component | — | AbortController wiring in `MultiKeyConnectStep.tsx`; server deliberately does not read `request.signal` |
| Audit-coverage gate (SEC-03) | CI (vitest contract test) | — | `src/__tests__/audit-coverage.test.ts` allowlist edit |
| bridgeComputeLimiter (SEC-04) | Frontend server (`src/lib/ratelimit.ts` + 2 routes) | Python backend (budget source of truth) | Front door mirrors the backend's real budget |

## Standard Stack

No new libraries. This phase uses only what is already installed:

### Core (already present — do not add or upgrade anything in this phase)
| Library | Where | Purpose in this phase |
|---------|-------|----------------------|
| structlog (`cache_logger_on_first_use=True` config) | `analytics-service/services/logging_config.py` | SC-1 subject |
| slowapi | `analytics-service/services/rate_limit.py` | SEC-05 key-func swap |
| `@upstash/ratelimit` via `makeLimiter` | `src/lib/ratelimit.ts:83` | SEC-04 new named limiter |
| vitest / pytest / `supabase/tests/test_*.sql` | repo test lanes | all gates |

⛔ Phase 165 (DEPS) owns all dependency churn. Adding or bumping any package here would
make its reds ambiguous — explicitly out of scope.

## Package Legitimacy Audit

**No external packages are installed by this phase.** Nothing to audit; the Package
Legitimacy Gate is satisfied vacuously. (Banned-packages list in CLAUDE.md checked: nothing
in this phase touches dependency manifests at all.)

## Section 1 — structlog frozen-proxy redaction (SC-1 / OPS-05)

### How logging is configured today

`configure_logging()` is defined at `analytics-service/services/logging_config.py:216-246`.
The processor chain [VERIFIED: analytics-service/services/logging_config.py:218-234]:

```python
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            ...
            _redact_processor,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO+
        cache_logger_on_first_use=True,
    )
```

It also installs the stdlib bridge (`logging.setLogRecordFactory(_redact_log_record_factory)`,
`logging_config.py:242-246`) so every stdlib `LogRecord` is scrubbed at creation. The
factory's own docstring names the leak class this phase closes [VERIFIED:
logging_config.py:206-209]: *"Without this, `logger.warning("ccxt: %s", str(exc))` in
exchange.py would leak the HMAC signature embedded in the ccxt exception message."*

### The two failure modes, verified against structlog's source

- **Mode A — module-scope `.bind()`.** structlog's configuration docs state it directly:
  *"you must never call `new()` or `bind()` in module or class scope because you will
  receive a logger configured with structlog's default values"* [VERIFIED: structlog
  docs/configuration.md via Context7]. This is broken regardless of
  `cache_logger_on_first_use` — `.bind()` on the lazy proxy assembles a real `BoundLogger`
  from whatever `_CONFIG` holds at that instant.
- **Mode B — first use before `configure_logging()`.** With `cache_logger_on_first_use=True`,
  `BoundLoggerLazyProxy.bind` replaces `self.bind` with a `finalized_bind` closure that
  captures the logger assembled from the config active at FIRST use; later
  `structlog.configure()` calls update `_CONFIG` but never reach that closure [VERIFIED:
  structlog `src/structlog/_config.py` `BoundLoggerLazyProxy.bind` via Context7]. A proxy
  first used pre-configure therefore emits through the default chain — no
  `_redact_processor`, no JSON — forever.

### Measured state at HEAD

- **Mode A: zero occurrences.** `grep` over non-test `analytics-service/` code for
  module-scope `.bind()` on a `get_logger` result returned nothing (measured this session).
  The Mode A gate is PREVENTIVE — its RED demonstration must temporarily introduce a
  violation. **Pre-edit gate token: expected module-scope-`.bind()` count in non-test
  analytics-service code = 0.**
- **Module-scope lazy proxies (safe if never bound and never used pre-configure) exist at:**
  `main.py:161,380,473,658`, `routers/debug_key_flow.py:41`, `routers/process_key.py:67`,
  `services/rate_limit.py:139`, `services/ingestion/long_fetch.py:45` [VERIFIED via grep
  this session].
- **API process import order is fragile:** `main.py:44-45` imports every router BEFORE
  `configure_logging()` runs at `main.py:66`. No import-time emission was found, so the API
  process is safe today only by the absence of import-time log calls — nothing pins that.
- **⚠️ The WORKER process never configures logging at all.** [VERIFIED this session]:
  `main_worker.py` has zero `configure_logging`/`structlog` references; no non-test module
  imports `main`; `sentry_init.py` and `main_worker_healthz.py` are also clean; the
  Dockerfile header records the worker service CMD override as `python -m main_worker`
  [VERIFIED: analytics-service/Dockerfile:1-8]. Consequence: on the worker — the process
  that actually runs ccxt long-fetch and MT5 sync — structlog runs its DEFAULT chain (no
  `_redact_processor`) and the stdlib LogRecord-factory bridge is never installed, so the
  exact `logger.warning("ccxt: %s", str(exc))` leak the factory exists to stop is UNGUARDED
  there. This is the concrete Mode B instance the behavioral test should pin.
- `services/mt5_client.py:162-176` `_stage_logger()` binds per call specifically to dodge
  the frozen-proxy trap; its docstring claims *"main.py configures inside the lifespan, long
  after import"* — that sentence is STALE (configure runs at `main.py:66`, module scope) but
  its conclusion is correct for the worker. Update the comment when touching this area.

### Where the secrets flow

- **ccxt HMAC signatures:** embedded in ccxt exception messages/URLs. Emission paths:
  stdlib `logger = logging.getLogger("quantalyze.analytics")` (`routers/exchange.py:75`) and
  worker-side ingestion logging (`services/job_worker.py` imports `ccxt` at line 54;
  `services/ingestion/long_fetch.py:45` uses a structlog proxy).
- **MT5 passwords:** `mt5linux` f-string-interpolates the password into remotely-eval'd
  source, so *exception TEXT is a credential disclosure surface* [VERIFIED:
  services/mt5_client.py:153-155, also :87-104]. `Mt5Client.login` already redacts by VALUE
  (`for literal in (str(login), password, server):`, mt5_client.py:991) and
  `emit_mt5_stage_event` carries only a closed field allow-list — those guards are
  emission-site-local; the process-level chain is the backstop this phase must make
  unconditional.
- **Redaction machinery to reuse (do not hand-roll):** `services/redact.py` —
  `DENYLIST_EXACT` (includes `"signature"`, `"passphrase"`, `"apisecret"` etc., redact.py:38-56),
  `scrub_pii`, `scrub_freeform_string`. Existing tests to extend, not duplicate:
  `tests/test_logging_config.py`, `tests/test_stdlib_redact_bridge.py`, `tests/test_redact.py`,
  `tests/test_verify_strategy_redaction.py`.

### Fix shape (planner's to sequence)

1. Move `configure_logging()` above the router imports in `main.py` (Mode B, API process).
2. Call `configure_logging()` at `main_worker.py` startup before any loop starts (Mode B,
   worker process — the live instance).
3. Mode A source-scan gate: a pytest test scanning non-test `.py` files under
   `analytics-service/` for module-scope `.bind(` on a `get_logger(...)` result (AST or
   token scan; `tests/test_limiter_identity.py` is the in-repo precedent for source-scan
   tests). RED demo: introduce a scratch violation, observe fail, remove.
4. Mode B behavioral test: subprocess (or `structlog.reset_defaults()`-isolated) test that
   emits a denylisted value through a module-scope proxy BEFORE `configure_logging()` and
   proves the fixed entrypoint ordering redacts it; neuter by reverting the ordering → RED.
   ⚠️ Test isolation: `configure_logging()` is idempotent but global — use
   `structlog.reset_defaults()`/subprocess so this test cannot poison siblings.

## Section 2 — createAdminClient post-commit 500 class + monitor honesty (SC-2 / OPS-06, OPS-07)

### The throw mechanism

`createAdminClient` throws synchronously when env is missing [VERIFIED:
src/lib/supabase/admin.ts:11-17]:

```ts
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
  }
  ...
}
```

`logAuditEventAsUser(createAdminClient(), …)` evaluates the argument BEFORE the call, so the
throw lands outside `logAuditEventAsUser`'s own `try` (which wraps only the `after()`
scheduling, src/lib/audit.ts:917-921), and `withAuth` has no catch — an opaque 500.

### The known sites at HEAD

The pattern `logAuditEventAsUser(createAdminClient(),` occurs **4 times in 3 files**
(the "three known sites" of WR-01 are these three files; `preferences` has since grown a
second occurrence) [VERIFIED via grep this session]:

| File:line | Position relative to commit | Note |
|---|---|---|
| `src/app/api/strategies/csv-finalize/route.ts:798` | AFTER the fold committed a new strategy (`!error && isUuid(newStrategyId)` branch) | The WR-01 headline site (was `:733` on 2026-08-20 — the file moves; anchor on the call shape, not the number). Its own docblock (route.ts ~:790-793) promises "a failed emission … must NOT change this response" |
| `src/app/api/preferences/route.ts:289` | AFTER `update_allocator_mandates` RPC succeeded | Post-commit — success-branch emit |
| `src/app/api/preferences/route.ts:221` | On the RPC ERROR branch (nothing committed) | Same call shape; a throw here converts a classified error response into an opaque 500 — fix in the same pass |
| `src/app/api/account/deletion-request/route.ts:141` | AFTER the GDPR Art. 17 intake row INSERTed | Post-commit |

**Locked fix:** hoist `const admin = createAdminClient()` ABOVE the irreversible commit in
each handler (throw-before-commit is fail-safe: loud 500, nothing landed), then pass `admin`
to the emit calls. ⛔ No `createAdminClientOrNull`. ⛔ No class-wide source-scan gate (deferred
per CONTEXT). Note csv-finalize's two `after()`-epilogue admin usages (route.ts:1851-1852,
:1967-1968) are already try/catch-wrapped dynamic imports — out of scope.

### checkStuckNotifications — "nothing stuck" vs "could not tell"

[VERIFIED: src/lib/observability.ts:22-27]:

```ts
  if (error) {
    console.error("[observability] Failed to check stuck notifications:", error.message);
    return { stuck: 0 };
  }
  return { stuck: count ?? 0 };
```

`0` currently means BOTH states. Also note `count ?? 0` re-imports the same collapse for a
null count (the flag-monitor's `getDenominator` docblock explains why null/NaN counts are
"a read we could not complete"). **No runtime caller exists today** — the only reference is
the export-presence pin `src/__tests__/observ12-fixtures-presence.test.ts:53-57` — so the
return-type change is a free design point. Discretion recommendation: a discriminated union
(`{ kind: "ok"; stuck: number } | { kind: "indeterminate"; error: string }`), mirroring
`DenominatorResult` in the flag-monitor (see below) so the repo has ONE shape for this
distinction; update the presence pin in the same commit.

### The denominator read that must PAGE

`getDenominator` in `src/app/api/cron/flag-monitor/route.ts:294-333` already distinguishes
read-error and unusable-count from zero — but BOTH terminal arms return at **default HTTP
200** [VERIFIED: flag-monitor/route.ts:308-312 and :325-329]:

```ts
    return {
      kind: "terminal",
      res: NextResponse.json({ ok: false, reason: "denominator_read_failed" }),
    };
```

So a persistent Supabase read failure pages nobody and the Vercel cron history shows green
(the 141.2 record: "the remedy replaced a wrong page with no page"). Fix shape: return a
non-200 status (the loud signal — a failed cron run) on both terminal arms, plus the
email/Sentry channel the planner chooses; the cost (Vercel cron history semantics change) was
already priced in the TODOS entry.

**The integration test must actually falsify.** The 141.2 review found
`tests/integration/cron-flag-monitor.test.ts` gained an `auditLogRows` option that **no test
passes**, and no test exercises a read error, `count: null`, or `count: NaN` — under both
denominator mutations the file stayed green [VERIFIED: the option exists unused at
tests/integration/cron-flag-monitor.test.ts:70-79; vacuity recorded in the 141.2 close-out].
OPS-07's "the integration test actually falsifies both" means: add integration cases for
(a) stuck-vs-indeterminate and (b) the paging arm, and demonstrate each RED by neutering the
fix (e.g., revert status to 200 → test fails).

## Section 3 — Worker/request plumbing (SC-3 / OPS-08, OPS-09, OPS-10)

### OPS-08 — de-STRICT the 10-param enqueue overload

**Latest definition of BOTH overloads** (re-base target — the "re-base SQL fn before CREATE
OR REPLACE" rule applies):
`supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` — 7-param
at :49, 10-param at :181. Later migrations (20260816140000, 20260825130000/140000/150000)
only REFERENCE the function in comments; none redefines it [VERIFIED via grep this session].

The 10-param lost-race re-read still has **four `INTO STRICT` branches** [VERIFIED:
20260716090000:283-311; the four occurrences]:

```sql
  -- Lost the race — re-read the winner's row.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id ...
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id ...
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id ...
  ELSE
    SELECT id INTO STRICT v_new_id ...
```

The 7-param overload in the SAME file already carries the target pattern [VERIFIED:
20260716090000:140-172] — plain `SELECT INTO` (comment: *"the winner may have advanced past
the in-flight statuses (done / failed_*) … the original SELECT INTO STRICT raised
NO_DATA_FOUND … as an opaque 500"*) followed by an explicit
`RAISE … USING ERRCODE = 'serialization_failure'` when the re-read finds nothing ("MVCC
race, retry safe"). Parity = replicate that for all four target branches.

⚠️ Traps the planner must carry:
- New FORWARD-ONLY migration; never edit `20260716090000` (applied). Merging
  `supabase/migrations/**` to main AUTO-APPLIES to PROD. Run the 3 reviewers
  (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply.
- `20260716090000:317+` carries a self-verifying DO block asserting both function bodies
  retain the retired-kind reject — the re-based body must keep that clause or the deploy
  fails (correctly).
- A new `supabase/tests/test_*.sql` gate asserting the de-STRICT (e.g.,
  `pg_get_functiondef` of the 10-param overload contains zero `INTO STRICT` AND contains the
  `serialization_failure` raise) will be **RED in CI until someone hand-applies the migration
  to the TEST project** — nothing applies migrations to TEST automatically (the recorded
  phase-162 "expect four red SQL gates" mechanism). Say so in the plan so the red is read
  as expected, and schedule the hand-apply.
- **Pre-edit gate tokens:** `INTO STRICT` occurrences in the CURRENT 10-param body = 4;
  in the current 7-param body = 0.

### OPS-09 — deterministic resync draft pre-check

[VERIFIED: analytics-service/routers/process_key.py:1404-1413]:

```python
        existing_resync = one(
            supabase.table("strategy_verifications")
            .select("*")
            .eq("strategy_id", strategy_id)
            .eq("flow_type", "resync")
            .eq("status", "draft")
            .limit(1)
            .maybe_single()
            .execute()
        )
```

No `ORDER BY`: when the documented two-draft residual occurs (concurrent two-tab race — the
long comment at :1387-1402 records it), which draft `.limit(1)` resumes is
planner/PostgREST-order dependent. Fix: `.order("created_at", desc=True)` plus a bounded
window (`.gte("created_at", <now - window>)`) so an ancient orphaned draft can't be resumed.
The window length is Claude's-discretion; anchor it on the worker's 30 s tick + the 15 s
timeout blip mechanics described in the comment. ⚠️ Two adjacent prose debts to settle in the
same edit: this comment block, and DEF-141.1-02-A (the SCOPE BOUND comment that still
over-claims "closes the SEQUENTIAL retry class only" — the recorded doc-drift item).
Tenant-scope note: the read is safe to reorder — it already runs strictly after the
ownership gate (comment at :1382-1385).

### OPS-10 — `body.cancel()` on abandoned responses

The seam retry loop is `for (let attempt = 0; attempt <= retries; attempt++)` at
`src/lib/resilient-fetch.ts:2458`. Exactly ONE exit abandons a real `Response`: the
counting-status retry arm [VERIFIED: resilient-fetch.ts:2688-2692]:

```ts
        console.error(
          `[resilient-fetch] ${budgetKey}: attempt ${attempt + 1} of ` +
            `${retries + 1} returned ${res.status} — retrying after backoff`,
        );
        continue;
```

- `readDependencyBody` (resilient-fetch.ts:2148-2160) reads via `res.clone().json()` and
  only for 503 — the ORIGINAL body is never consumed on any counting status, so undici
  buffers it until the attempt signal fires.
- The transport-arm `continue` (~:2614) follows a THROWN fetch — no `Response` exists; the
  breaker pre-check `continue`s (:1466, :1470) run before fetch. No other site abandons.
- ⚠️ Capability-check the call: `SeamResponse` is deliberately structural and several
  fixtures are bare `{ ok, status }` literals with no `body` at all (the same reason
  `hasContractualWait` checks `headers.get` — see its docblock ~:2178+). Shape:
  `res.body?.cancel().catch(() => {})` (or a typeof guard) — a missing `body` must degrade,
  never throw inside the classification window.
- Falsifier: a vitest case with a stubbed `Response` whose `body.cancel` is a spy, driven
  through a counting-status retry; neuter by deleting the cancel call → RED.

## Section 4 — Security floor (SC-4 / SEC-01, SEC-02, SEC-05, SEC-06)

### 4a — Server-side password policy (SEC-01)

- Client floor: `src/components/auth/SignupForm.tsx:241` — literal `minLength={6}` on the
  password input; signup goes browser → Supabase Auth directly via `supabase.auth.signUp`
  (SignupForm.tsx:87) — there is NO Next.js server hop to enforce anything on.
  `src/components/auth/ResetPasswordForm.tsx:21` defines its own
  `const MIN_PASSWORD_LENGTH = 6;` — two independent client constants, no shared source.
- Local config: [VERIFIED: supabase/config.toml:175,178]
  `minimum_password_length = 6` and `password_requirements = ""`. ⚠️ `config.toml` governs
  the LOCAL dev stack; the HOSTED project's policy lives in the Supabase dashboard /
  Management API and is not represented in the repo [ASSUMED: hosted GoTrue default minimum
  is 6 — must be read, not assumed].
- Deliverable shape: (1) a checkpoint:human-verify (or Management-API read) confirming the
  hosted project's minimum-length ≥ 6 setting — a live op, founder-visible; (2) document the
  policy (where it is set, what it is) beside the auth forms or in docs/; (3) optionally a
  behavioral probe against the TEST project (5-char signUp expecting a 4xx — never against
  PROD); (4) unify the two client constants into one exported `MIN_PASSWORD_LENGTH` so
  client copy cannot drift from the documented policy.

### 4b — `.planning` username scrub + NO-ALLOWLIST gate (SEC-02)

**Re-measured at HEAD this session** (CONTEXT figures in parentheses):
2938 tracked `.planning/` files; **80** contain the macOS username (80 ✓); **59** contain
`/Users/` absolute paths (57 — drifted +2 since the CONTEXT measurement; re-measure at plan
execution, plan against the live number). ⚠️ Severity is metadata, not credentials — keep
the requirement's framing.

**⚠️ The username also exists in 7 tracked files OUTSIDE `.planning/`** [VERIFIED via
`git grep` this session — occurrence counts]:

| File | Occurrences | Editable? |
|---|---|---|
| `docs/notes/mt5-scaling-cost-2026-08-08.md` | 4 | yes |
| `docs/pitch/partner-qualification-notes.template.md` | 1 | yes |
| `docs/pitch/partner-qualification-script.md` | 2 | yes |
| `docs/superpowers/plans/2026-04-07-perfect-match-engine.md` | 2 | yes |
| `docs/superpowers/plans/2026-04-09-portfolio-management-demo-hero.md` | 1 | yes |
| `supabase/migrations/20260517013000_revoke_probe_oracle_assert_strategy_visible_to_allocator.sql` | 1 (header comment, line 5 — an absolute `.review/` artifact path) | ⚠️ APPLIED migration |
| `supabase/migrations/20260517013100_sanitize_user_recipient_email_case_insensitive.sql` | 1 (same shape, line 5) | ⚠️ APPLIED migration |

A gate that is genuinely no-allowlist must scan the whole tracked tree — a `.planning/`-only
scope IS a path restriction, reproducing the gitleaks blindness the CONTEXT names. But the
repo can only reach zero if the 7 outside files are scrubbed too, and two of them are
applied migrations, where editing is a tracked invariant violation (migration-reviewer #11).
**Decision to surface to the planner (recommendation first):**
1. **(Recommended)** Scrub all 87 files including the two migration header COMMENTS
   (comment-only, zero SQL bytes change; the Supabase CLI tracks applied migrations by
   version, not content hash [ASSUMED — verify before relying on it], so nothing breaks
   mechanically), record the deliberate exception to the no-edit rule in the migration
   headers themselves, and ship the gate repo-wide with a true zero-allowlist.
2. Alternatively scope the gate to "all tracked files except `supabase/migrations/`" —
   rejected by the CONTEXT's own logic unless the founder explicitly re-accepts a
   path carve-out.

**Gate home.** ⛔ Not the `secret-scan` job (ci.yml:1821 — already red on
`workflow_dispatch`, known/filed). Two live precedents:
- `npm run lint` already chains policy scripts [VERIFIED: package.json:11]:
  `eslint … && tsx scripts/check-admin-route-manifest.ts && tsx scripts/check-route-contract.ts`
  — both exit 1 on violation. A third `tsx scripts/check-planning-hygiene.ts` (name
  illustrative) rides the existing `frontend-lint` CI job for free.
- The `frontend-policy` job (ci.yml:495) hosts grep-style checks ("Check for banned
  packages", ci.yml:536) if a job-level home is preferred.
Recommendation: the `npm run lint` script — it runs locally AND in CI, matches the stated
precedent, and needs no workflow-file change.

**Two implementation traps specific to this gate:**
- **The needle problem.** A scan whose source contains the literal username fails its own
  scan (or needs the one allowlist entry the gate forbids). Store the needle encoded
  (base64/char-codes) with a comment saying why, and ALSO match structural patterns
  (the escaped regex `\/Users\/[^\/\s]+\/` and the dash-mangled `-Users-…` scratchpad form)
  so a future absolute path with a DIFFERENT username still fails. ⚠️ Spell such patterns in
  ESCAPED form everywhere — including in the gate's own source, plans, and summaries — or
  the artifact self-matches the scan (this file does so deliberately).
- **The NUL-byte blind spot.** `src/lib/wizardErrors.test.ts` carries a deliberate NUL at
  line 1572; `grep`/`git grep` treat it as binary and silently skip content after it, and
  exit 1 reads as "clean". The scanner must read files as text regardless (node `fs` +
  `includes`, or `grep -a` semantics) or it is structurally blind to one file.
- **Recurring source:** GSD tooling and agents routinely write absolute paths into new
  `.planning/` artifacts (worktree paths, scratchpad paths). The gate failing future PRs on
  those is the gate WORKING — but plans/summaries authored during THIS phase must already
  comply (this RESEARCH.md uses repo-relative paths only).
- **Pre-edit gate tokens (measured this session, before any scrub):** username-bearing
  tracked files = 87 (80 in `.planning/` + 7 outside); `/Users/`-bearing `.planning/`
  files = 59. RED demo: after the scrub lands, reintroduce one occurrence in a scratch
  file → gate must fail; remove it.

### Runtime State Inventory (for the scrub — a string-replacement sub-task)

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — the username exists only in git-tracked text (verified by `git grep` scope) | none |
| Live service config | None — no service reads `.planning/` or docs/ content | none |
| OS-registered state | None relevant to the token | none |
| Secrets/env vars | None — token is a username, not a credential (CONTEXT: metadata, not credentials) | none |
| Build artifacts | Git HISTORY still holds all occurrences — forward-only by locked decision; forks/caches out of reach | accepted, recorded |

### 4c — The tenth IP-keyed route: `simulator.py` (SEC-05)

The offending key func [VERIFIED: analytics-service/routers/simulator.py:92]:

```python
    return f"simulator:ip:{get_remote_address(request)}"
```

(`_simulator_rate_limit_key`, decorating `portfolio_simulator`'s `@limiter.limit("20/hour")`.)
Repair pattern = the nine already-repaired siblings:
`key_func=partial(tenant_or_platform_key, scope="…")` as at
`routers/portfolio.py:1948` (`scope="portfolio_bridge"`). The in-handler per-user quota
(`_check_simulator_user_rate`, simulator.py:~104-130) is the authoritative per-tenant check
and STAYS — only the slowapi decorator key changes.

The concealment to remove, in `analytics-service/tests/test_limiter_identity.py`:
- The quarantine constant [VERIFIED: test_limiter_identity.py:120]:
  `IP_KEYED_QUARANTINE: frozenset[str] = frozenset({"simulator.py"})` → must become
  `frozenset()` (the equality assert at :493 `assert offenders == IP_KEYED_QUARANTINE`
  already exists — shrinking the set makes it bite).
- The concealing carve-out inside the wrapper-check
  `test_every_registered_router_limit_is_shared_or_quarantined` [VERIFIED:
  test_limiter_identity.py:609-610]:

  ```python
                if name == "routers.simulator.portfolio_simulator":
                    continue  # FINDING-10 — reported, not fixed here
  ```

  Delete it so the `isinstance(limit.key_func, functools.partial)` +
  `key_func.func is rl.tenant_or_platform_key` assertions apply to simulator too — that is
  the "equality assertion" the CONTEXT demands.
- `EXPECTED_CLASS_SIZE = 9` (test_limiter_identity.py:108) — the class enumeration grows to
  include simulator; move the literal deliberately (the constant's own comment orders this).
- Also sweep `tests/test_limiter_route_coverage.py` (mirrors the quarantine wording) and any
  literal pin naming simulator's key. Repo rule: limiter literal pins move in the same
  commit as the behavior. Behavioral falsifier: a throttle test driving the repaired route
  to 429 under a tenant claim (pattern: `test_match_recompute_actually_throttles`,
  test_limiter_identity.py:614+).
- **Pre-edit gate tokens:** quarantine size = 1; `get_remote_address`-referencing router
  files = exactly `{simulator.py}`.

### 4d — Panel removal mid-validate must abort the POST (SEC-06)

In `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx`:
- The credential-carrying POST: `wizardFetch("/api/strategies/composite/add-key", { …
  signal: controller.signal, … body: JSON.stringify({ … api_key: p.apiKey, api_secret: …,
  passphrase: … }) })` [VERIFIED: MultiKeyConnectStep.tsx:1231-1247]. Controllers are stored
  per-panel: `abortControllersRef.current.set(panelId, controller)` (:1211).
- Abort IS already wired for two exits — the deadline tick (:1125-1126) and `Stop waiting`
  (`handleStopWaiting`, :1168-1173, which looks the panel up by IDENTITY via `panelsRef`).
- The removal path does NOT abort [VERIFIED: MultiKeyConnectStep.tsx:1040-1043]:

  ```ts
  const doRemove = useCallback((idx: number) => {
    setAnnouncement(`Key ${idx + 1} removed`);
    setPanels((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  ```

  The long comment above `anyValidating` (:1104-1114) RECORDS this as deliberate ("Left
  as-is on purpose … Logged in TODOS.md") with the reasoning that the abort "buys nothing"
  because neither connect route reads `request.signal` (re-verified this session: zero
  `request.signal` reads in `composite/add-key/route.ts` and `validate-key/route.ts`).
  SEC-06 overrides that disposition: the client-side abort is the requirement (release the
  in-flight credential-carrying request and its client bound). **The comment must be
  rewritten in the same edit** — after the fix it states the opposite of the code, the exact
  doc-drift class the repo tracks.
- Fix shape: `doRemove` resolves the panel by identity (`panelsRef.current[idx]`, like
  `handleStopWaiting`), calls `abortControllersRef.current.get(p.id)?.abort()`, and deletes
  the panel's entries from `abortControllersRef` / `abortReasonsRef` (today nothing cleans
  the maps on removal — a small leak worth closing while here). Honest-copy caveat stays:
  aborting stops the browser listening, not the server working — the server may still store
  the key (the :1145-1165 comment's CR-02 lesson); do not let any new copy claim "nothing
  was saved".
- Falsifier: vitest — start a validate (mock fetch pending), remove the panel, assert the
  fetch's signal is aborted; neuter by removing the abort call → RED.

## Section 5 — Coverage gates (SC-5 / SEC-03, SEC-04)

### SEC-03 — `add_wizard_composite_key` and the audit-coverage gate

Why it escapes today: the gate's RPC detection is an ALLOWLIST-driven regex —
`MUTATING_RPC_NAMES` [VERIFIED: src/__tests__/audit-coverage.test.ts:203-224, quoted
verbatim]:

```ts
const MUTATING_RPC_NAMES: readonly string[] = [
  "admin_role_mutate",
  "enqueue_compute_job",
  "sanitize_user",
  "send_intro_with_decision",
  "create_wizard_strategy",
  ...
  "finalize_csv_strategy_with_returns",
  "commit_scenario_batch",
  "update_allocator_mandates",
  "delete_allocator_api_key",
  "disconnect_allocator_api_key",
  "stamp_first_bridge_surfaced",
  "stamp_first_sync_success",
  "sync_trades",
];
```

`add_wizard_composite_key` is absent, so the call at
`src/app/api/strategies/composite/add-key/route.ts:481` is invisible to the gate — and the
`@audit-skip` pragma already sitting at :477-480 (*"wizard draft — add_wizard_composite_key
writes draft strategies + api_keys not yet user-visible. The user-visible creation is
audited at finalize time…"*) is currently DECORATIVE: the gate never evaluates it.
Sibling `create_wizard_strategy` IS listed — the asymmetry is the gap.

Fix: add `"add_wizard_composite_key"` to `MUTATING_RPC_NAMES`. Then the pragma-vs-emission
decision becomes live: (a) keep the existing pragma (its stated reason is coherent — drafts
are audited at finalize in `finalize-wizard/route.ts`) or (b) emit a real
`logAuditEventAsUser` at add-key time. Either way the decision must be RECORDED in the
requirement text (REQUIREMENTS.md SEC-03 entry), not just implemented — locked in CONTEXT.
Falsifier is built-in: with the name listed, temporarily deleting the pragma must turn the
gate RED (that IS the neuter demo). ⚠️ Phase-164 dependency: this same allowlist is the ONE
edit SHARE's mint/revoke RPCs must land in — SEC-03 standing is a hard prerequisite of 164.
Also note the gate's own stale-comment debt (DEF-141.2-03-A: `audit-coverage.test.ts:962-964`
cites retired flag-monitor coordinates inside an `it.skip` comment) — fix opportunistically
if touching that region.

### SEC-04 — `bridgeComputeLimiter`

Current front-door state [VERIFIED this session]:
- `src/app/api/bridge/route.ts:94` — `checkLimit(userActionLimiter, \`bridge:${user.id}\`)`
- `src/app/api/portfolio-optimizer/route.ts:113` — `checkLimit(userActionLimiter, rateLimitKey)`
- `userActionLimiter = makeLimiter(5, "60 s")` [VERIFIED: src/lib/ratelimit.ts:97] — 300/h/user.

Current backend budgets [VERIFIED this session]:
- `/portfolio-bridge`: slowapi `"10/hour"` per tenant
  (`routers/portfolio.py:1947-1948`, `scope="portfolio_bridge"`) plus an in-handler per-user
  sliding window `_BRIDGE_USER_RATE_LIMIT = 30` / `_BRIDGE_USER_RATE_WINDOW_SEC = 3600`
  (portfolio.py:227-228, applied at :334-335).
- `/portfolio-optimizer`: slowapi `"10/hour"` per tenant (portfolio.py:1685-1686).
- Caveat that shapes the measurement: Python slowapi storage is `memory://` PER REPLICA —
  backend figures are floors ×N, order-of-magnitude only (recorded repo caveat).

So the inherited "30×" = 300/h front vs 10/h back. **Locked decision: re-derive from
measured PROD reality (actual bridge + optimizer request durations and concurrency) as an
early task before choosing the number**; the prior recommendation on record was
`bridgeComputeLimiter ≈ 10/3600s` mirroring the backend budget (truthful `Retry-After`).
Implementation notes:
- New named export in `src/lib/ratelimit.ts` via the existing `makeLimiter` factory, with
  the docblock rationale the family convention requires; adopt it at exactly the two routes
  above. ⛔ `userActionLimiter` untouched (backs ~9 surfaces; the remedy for any of its
  flows is a NEW named limiter, never a resize — standing repo rule).
- Tests that MUST move in the same commit: the seam-limiter roster pin —
  `src/lib/seam-ratelimit-posture.invariant.test.ts:252` ("the derived limiter population
  matches the hand-typed roster (a new seam route fails BY NAME)") — plus any deny-shape
  pins for the two routes.
- Falsifier: the roster test IS the structural gate (fails by name on the swap until the
  roster is updated); behavioral: a 429 deny-shape test through `rateLimitDenyJson` for the
  new limiter.
- Out of scope here (separate booked items, do not fold in): `/optimize-weights` per-tenant
  floor (L-9) and the verify-strategy anon-bucket mismatch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redaction of new leak surfaces | A second scrubber | `services/redact.py` `scrub_pii` / `scrub_freeform_string` | Canonical denylist mirrored TS↔Python; drift-guarded |
| New rate limiter | A bespoke wrapper | `makeLimiter` (`src/lib/ratelimit.ts:83`) + `checkLimit`/`rateLimitDenyJson` | Deny-shape + misconfiguration 503 conventions already pinned by tests |
| Tenant-keyed slowapi bucket | A new key scheme | `partial(tenant_or_platform_key, scope=…)` | Nine routes already repaired this way; test roster asserts the identity |
| CI policy gate | A new workflow/job | `tsx scripts/check-*.ts` chained in `npm run lint` | Runs locally AND in CI; exit-1 contract established |
| structlog test isolation | monkeypatching internals | `structlog.reset_defaults()` / `structlog.testing`, or a subprocess | Official reset API; the config is process-global |
| SQL function verification | string-diffing migration files | `pg_get_functiondef` in a `supabase/tests/test_*.sql` gate | The 20260716090000 DO block is the in-repo precedent |

## Common Pitfalls

1. **A gate that cannot fail.** Every new gate (Mode A scan, username scan, SQL de-STRICT
   gate, quarantine equality, abort test, denominator paging test) must be shown RED by
   neutering its subject, then restored. Gate tokens counted PRE-EDIT — this file records
   the pre-edit counts (§1: 0 module-scope binds; §3: 4 STRICT in 10-param / 0 in 7-param;
   §4b: 87 username files; §4c: quarantine size 1) so post-edit numbers can't be laundered.
2. **`sql-tests` red-until-hand-applied.** Any new SQL gate asserting its migration's
   effects hard-fails in CI until the migration is applied to the TEST project by hand —
   nothing applies migrations to TEST automatically. Expected red, must be named in the plan.
3. **Editing applied migrations.** The de-STRICT fix is a NEW migration re-based on the
   `20260716090000` definitions (grep ALL migrations first — done above; that file is the
   latest). The username-scrub migration-comment exception (§4b) needs an explicit recorded
   decision.
4. **`git grep` is silently blind to `src/lib/wizardErrors.test.ts`** (deliberate NUL at
   line 1572). The username scanner must not use binary-skipping grep semantics.
5. **File-scoped test runs cannot clear contract tests** — `src/__tests__/contracts/` and
   `audit-coverage.test.ts` scan all of `src/`; even a comment can redden them. Clear reds
   with a full-suite run.
6. **Worktree agents get no `node_modules`** — symlink it; `npx vitest` otherwise downloads
   a different vitest or fails. CI is Node 22 vs local Node 25 — a CI-only vitest red is
   reproducible with the Node 22 PATH, not a flake.
7. **pytest only from `analytics-service/`, with `python3`** — repo-root runs miss VCR
   cassettes and make LIVE broker calls. ⛔ Never run `uvicorn main:app` locally — it claims
   real PROD compute jobs. Run `mypy --strict` on `services/ routers/ models/` before ship.
8. **structlog config is process-global.** The Mode B test must not leave the default (or a
   test) config behind for sibling tests — `reset_defaults()` or subprocess isolation.
9. **Limiter literal pins move in the same commit** as any limiter change
   (`test_limiter_identity.py` and the TS roster test both pin literals by design).
10. **This phase's own artifacts must pass its own gate** — no absolute paths or the
    username in any PLAN/SUMMARY/RESEARCH file written from here on.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | vitest (TS, sharded in CI with coverage thresholds lines 82/stmts 80/funcs 74/branches 72), pytest (analytics-service), psql SQL gates (`supabase/tests/test_*.sql` via `sql-tests`) |
| Config files | `vitest.config.ts`; pytest via `analytics-service/` cwd; ci.yml `sql-tests` |
| Quick run (TS) | `npx vitest run <file>` (repo root; worktrees need node_modules symlink) |
| Quick run (py) | `cd analytics-service && python3 -m pytest tests/<file> -x` |
| Full suite | `npm run test` (or CI shards) + `cd analytics-service && python3 -m pytest` + `npm run lint` |
| Phase gate | Full TS suite + full pytest + `npm run lint` green; `mypy --strict` clean on services/routers/models |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-05 A | No module-scope `.bind()` in non-test analytics code | source-scan (pytest) | `python3 -m pytest tests/test_logging_config.py -x` (extend) | ❌ Wave 0 (new test in existing file or new `test_structlog_frozen_proxy.py`) |
| OPS-05 B | Pre-configure emission is redacted (API import order + worker entrypoint) | behavioral (pytest, subprocess-isolated) | same | ❌ Wave 0 |
| OPS-06 | Admin client constructed before commit; throw is pre-commit | unit (vitest per route) | `npx vitest run src/app/api/strategies/csv-finalize/route.test.ts` (+ preferences, deletion-request) | route tests exist; add cases |
| OPS-07 | Stuck-vs-indeterminate distinct; denominator failure → non-200 + page | unit + integration | `npx vitest run src/app/api/cron/flag-monitor/route.test.ts tests/integration/cron-flag-monitor.test.ts` | exist; integration currently CANNOT fail on these paths — must gain read-error/`count:null`/`count:NaN` cases |
| OPS-08 | 10-param overload: 0 `INTO STRICT`, serialization_failure raise present | SQL gate | CI `sql-tests` (red until TEST hand-apply) | ❌ Wave 0 (`supabase/tests/test_enqueue_internal_destrict.sql`) |
| OPS-09 | Pre-check ordered + bounded | pytest | `python3 -m pytest tests/ -k resync -x` | extend existing process_key tests |
| OPS-10 | Abandoned counting-status response body cancelled | unit (vitest) | `npx vitest run src/lib/resilient-fetch.retry.test.ts` | file exists; add spy case |
| SEC-01 | Hosted policy ≥ 6 verified + documented | checkpoint:human-verify (+ optional TEST-project probe) | manual / Management API | — |
| SEC-02 | Zero username / absolute-path occurrences in tracked files | CI script in `npm run lint` | `npm run lint` | ❌ Wave 0 (`scripts/` + wiring) |
| SEC-03 | `add_wizard_composite_key` under the audit law; decision recorded | contract test | `npx vitest run src/__tests__/audit-coverage.test.ts` | exists; allowlist edit |
| SEC-04 | Two routes on `bridgeComputeLimiter`; roster + deny-shape updated | invariant + unit | `npx vitest run src/lib/seam-ratelimit-posture.invariant.test.ts` | exists; roster edit |
| SEC-05 | Simulator tenant-keyed; quarantine == ∅; carve-out gone; 429 behavioral | pytest | `python3 -m pytest tests/test_limiter_identity.py tests/test_limiter_route_coverage.py -x` | exist; edits |
| SEC-06 | Panel removal aborts in-flight POST | unit (vitest) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"` | exists; add case |

### Sampling Rate
- **Per task commit:** the file-scoped quick command for the touched surface, PLUS
  `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/contracts` whenever any
  `src/` file changes (global scanners).
- **Per wave merge:** full vitest suite + full pytest (from `analytics-service/`) + `npm run lint`.
- **Phase gate:** full suite green; each new gate's RED demonstration recorded in the
  SUMMARY with its pre-edit token counts; advisory-gate language ("would have caught").

### Wave 0 Gaps
- [ ] Mode A source-scan + Mode B behavioral tests (analytics-service) — OPS-05
- [ ] `supabase/tests/` de-STRICT gate + the forward-only migration it verifies — OPS-08
- [ ] `scripts/` username/path scanner + `package.json` lint wiring — SEC-02
- [ ] Integration-test falsifiers for flag-monitor read-error and paging arms — OPS-07
- Framework installs: none needed.

## Security Domain

`security_enforcement` not disabled in config → included. This phase IS the security floor;
ASVS mapping of its own deliverables:

| ASVS Category | Applies | Standard Control (this phase) |
|---------------|---------|-------------------------------|
| V2 Authentication | yes | Supabase Auth (GoTrue) hosted password policy — verified, not assumed (SEC-01) |
| V4 Access Control | yes | Tenant-keyed rate buckets (`tenant_or_platform_key`), per-user in-handler quotas (SEC-04/05) |
| V5 Input Validation | marginal | No new input surfaces; existing Zod/pydantic layers untouched |
| V6 Cryptography | no new | ⛔ nothing hand-rolled; ccxt HMAC handled by redaction only |
| V7 Error Handling & Logging | yes (core) | structlog `_redact_processor` + stdlib factory bridge made unconditional in BOTH processes; fail-loud non-200 on monitor failure |
| V8 Data Protection | yes | Username/path scrub of the public tracked tree; forward-only, severity = metadata |

| Pattern | STRIDE | Mitigation in this phase |
|---------|--------|--------------------------|
| Credential leak via exception text (ccxt HMAC, mt5linux password interpolation) | Information Disclosure | Process-level redaction guaranteed at both entrypoints; Mode A/B gates |
| False health (monitor reports success on failed read) | Repudiation / DoS-blindness | Non-200 terminal arms; indeterminate state distinct from zero |
| Rate-limit bypass by bucket collapse (shared NAT / spoofable keys) | DoS | Tenant-keyed slowapi key; front-door limiter mirroring backend budget |
| Unaudited mutating RPC | Repudiation | Allowlist gate extended; pragma-vs-emit recorded |
| Credential POST outliving its UI context | Information Disclosure | Client abort on panel removal (server-side `request.signal` handling remains a recorded non-goal) |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- Coverage is a blocking CI gate (lines 82 / stmts 80 / funcs 74 / branches 72 in
  `vitest.config.ts`); new TS code in this phase must not sink the ratchet.
- This Next.js version diverges from training data — read `node_modules/next/dist/docs/`
  before touching Next-specific surfaces (flag-monitor route status codes are plain
  `NextResponse` — low risk).
- Banned packages list: not applicable (no installs).
- Workflow rules that bind execution: feature branch + `/ship` (never manual git commit /
  never `/gsd-ship`); one PR landed at a time; per-phase review = gsd-code-reviewer +
  gsd-verifier only; ⛔ reviews block only on user-facing or data-integrity findings;
  3 reviewers before asking to apply any migration; `.planning/` is tracked — `git add` it.
- Tests must be able to fail (neuter → RED → restore is the required demonstration);
  money-math not touched this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hosted Supabase project's minimum password length is currently 6 (GoTrue default) | §4a | If lower/unset, SEC-01 is a live gap, not a documentation task — the checkpoint read resolves this either way |
| A2 | Supabase CLI tracks applied migrations by version, not content hash, so a comment-only edit to the two applied migrations is mechanically safe | §4b | If content-hashed, the scrub option 1 breaks `migration list` reconciliation — verify with `supabase migration list` behavior before choosing option 1 |
| A3 | The worker service on Railway runs `python -m main_worker` per the Dockerfile CMD-override note (the Railway UI/railway.toml override itself is not in-repo) | §1 | If the worker were launched via uvicorn/main.py it would be configured; the fix (configure in `main_worker.py`) is correct and harmless either way |
| A4 | undici keeps buffering an unconsumed abandoned response body until the attempt signal fires (the OPS-10 premise, inherited from the requirement text) | §3 | If undici already reclaimed it, `body.cancel()` is still correct hygiene; no downside |
| A5 | The `/Users/`-count drift (57 → 59) is organic new-file growth, not a measurement-method difference | §4b | None — plan against the live re-measured number at execution time |

## Open Questions

1. **Which page channel for the denominator failure?** Non-200 (cron shows failed) is the
   minimum; whether to ALSO send the SEV email / Sentry capture on the terminal arms is
   Claude's-discretion — recommend non-200 + Sentry capture, email left to the existing
   streak machinery.
2. **`bridgeComputeLimiter` number** — blocked on the locked early-task PROD measurement
   (durations + concurrency). Do not default to 10/3600s without the measurement on record.
3. **Username-scan scope decision** (§4b options 1/2) — recommend option 1; needs the
   applied-migration-comment exception recorded, or a founder re-accept of a carve-out.
4. **Does SEC-06 need the server to honor `request.signal`?** Recorded elsewhere as its own
   phase (server-side request cancellation, D-03); this phase's scope is the client abort —
   keep it that way, restate the boundary in the plan.
5. **`checkStuckNotifications` consumers** — none exist at runtime; decide whether OPS-07
   also wires it into a cron/admin surface or only fixes the contract (recommend
   contract-only; wiring is new scope).

## Sources

### Primary (HIGH confidence)
- Codebase at HEAD (bf00ad0c), read directly this session — all `file:line` citations above
- structlog official docs + source via Context7 (`/hynek/structlog`): docs/configuration.md
  (module-scope bind prohibition), src/structlog/_config.py (`BoundLoggerLazyProxy.bind`
  finalized-bind caching)
- `.planning/phases/163-…/163-CONTEXT.md`, `.planning/ROADMAP.md` (Phase 163 entry),
  `.planning/REQUIREMENTS.md` (OPS-05..10, SEC-01..06)

### Secondary (MEDIUM confidence)
- TODOS.md entries (WR-01 original text recovered from git history at the requirement-
  authoring revision; 141.2 close-out items 5/6/11; the bridge/optimizer mismatch entries at
  the 2026-08-20 revision) — all key claims re-verified against HEAD code above

### Tertiary (LOW confidence)
- Hosted GoTrue password default (A1), Supabase migration content-hash behavior (A2) —
  flagged in Assumptions Log for verification during execution

## Metadata

**Confidence breakdown:**
- SC-1 mechanism + sites: HIGH — structlog behavior verified from its source; worker gap measured
- SC-2 sites: HIGH — all four pattern occurrences read in context at HEAD
- SC-3: HIGH — latest SQL definitions read in full; single abandoning `continue` located
- SC-4: HIGH for code sites; MEDIUM for the two hosted/apply-behavior assumptions (A1, A2)
- SC-5: HIGH — gate allowlist and both backend budgets quoted verbatim

**Research date:** 2026-08-26
**Valid until:** ~2026-09-09 (fast-moving repo; re-measure counts and line anchors at plan
execution — several cited files are known movers)
