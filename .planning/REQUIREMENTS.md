# Requirements: Quantalyze — v1.16 Production Resilience & Reliability

**Defined:** 2026-07-25
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.

**Milestone goal:** Give the live money-bearing plumbing failure handling — so a hung Railway
request, a silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real
investor factsheet on a spinner that never resolves.

> ⚠️ **These requirements are written against the RESEARCH-CORRECTED scope**
> (`.planning/research/SUMMARY.md`), NOT the original `PROJECT.md` / `TODOS.md` prose. All four
> researchers independently contradicted three of the milestone's stated premises using fresh
> greps + `git blame` against current `main`. Summary of the corrections that reshaped this list:
> 1. **RATE was ~85% already shipped** — all seven "unlimited" routes already call `checkLimit()`
>    (landed 2026-04-10 → 2026-07-23). Real gaps: `admin/match/eval` + the Python `routers/match.py`.
> 2. **SEAM timeouts already exist** in BOTH clients (`AbortSignal.timeout`). Missing = retry +
>    breaker. And there are **TWO** chokepoints — `keys/sync`/`verify-strategy` go through
>    `process-key-client.ts`, not `analytics-client.ts`.
> 3. **Retry-safety is a property of `flow_type`, not path** — `teaser` is deliberately
>    NON-idempotent.
> 4. **"The janitor also fixes the fence flake"** is UNVERIFIED and is NOT an acceptance criterion.
> 5. **The 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` bullet is likely stale** — reproduce before fixing.

**Decisions taken at requirements time** (research Open Decisions 1–8, resolved here):
| # | Decision | Resolution |
|---|----------|------------|
| 1 | Janitor target table | **BOTH, as two distinct mechanisms** — `strategy_analytics.computation_status='computing'` (new reaper, JOB-02) AND `compute_jobs.status='running'` (extend WORKER-04, JOB-05). Neither requirement implies the other. |
| 2 | Fence-flake "two birds" claim | **NOT an acceptance criterion.** Observe only; if it clears, note it as a side-effect. |
| 3 | 42501 / unified-backbone bullet | **Reproduce-first gate** (JOB-06). "Could not reproduce" is a valid, budget-saving outcome. |
| 4 | Breaker key identity | **ONE shared `breaker:railway` key** — both clients hit the same physical deployment. |
| 5 | Rate-limit wiring convention | **`withRateLimit` HOF** composing alongside `withAuth`/`withRole`. Not global middleware. |
| 6 | csv-finalize fold-RPCs vs compensate | **Deferred to JOB-06 after the reproduction pass.** |
| 7 | `cron/warm-analytics` | **OUT of RATE scope** — cron route, service-key gated, different threat model. |
| 8 | Python limiters beyond `match.py` | **OUT of scope** — `match.py` is the one verified Python-side gap. |

---

## v1 Requirements

### SEAM — Vercel→Railway resilience

- [x] **SEAM-01**: Both Vercel→Railway chokepoints (`analyticsRequest()` in `analytics-client.ts` AND `postProcessKey()` in `process-key-client.ts`) route through ONE shared resilience core, so hardening cannot cover one path and silently miss the money-onboarding path.
- [x] **SEAM-02**: Every seam call site has a documented, exported timeout budget re-derived against its route's `maxDuration`, replacing the two divergent ad-hoc budgets (30s vs hardcoded 60s); a test asserts `timeout × (1 + retries) < maxDuration` per route.
- [x] **SEAM-03**: A circuit breaker backed by the existing Upstash store (NOT in-memory) trips on repeated Railway failures and is observed consistently across concurrent Fluid Compute instances; it fails **OPEN** (attempts the real call) when Redis itself errors, so a broken breaker can never become the outage.
- [x] **SEAM-04**: When the breaker is open or the seam fails, the caller receives a clean typed `503 CIRCUIT_OPEN` envelope with a human message — no raw error escapes a route handler as a cascade-500.
- [x] **SEAM-05**: A committed retry-safety audit artifact maps every seam function and `/process-key` `flow_type` to retry-safe yes/no with traced evidence of server-side side effects, including the currently-unaudited `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge set, and resolves whether `_get_recompute_lock` is distributed or process-local.
- [x] **SEAM-06**: Bounded retry with exponential backoff + full jitter (2–3 attempts) is enabled ONLY for allowlisted entries from SEAM-05, respects the open breaker with no bypass, and provably NEVER retries `flow_type: teaser` (a retry there mints a duplicate verification + `public_token` + lead).

### JOB — Job-state integrity (no forever-spinners)

- [x] **JOB-01**: `strategy_analytics` carries a dedicated writer-stamped `computing_started_at`, set in the SAME statement/transaction that sets `computation_status='computing'` — never `updated_at`/`computed_at`, the exact mistake that forced the 106-janitor revert.
- [x] **JOB-02**: A recurring pg_cron reaper transitions stranded `strategy_analytics` rows (stuck `computing` past threshold AND no active `compute_jobs` row) to a TERMINAL `failed` state carrying a user-recoverable message, so a wizard poll — or a page refresh — sees a real outcome instead of spinning forever. Supersedes the one-off `reset_stuck_computing_rows.py` script.
- [x] **JOB-03**: The reaper's staleness threshold is derived from the **chain-inclusive** worst case a `strategy_analytics` row can legitimately sit at `computing` — walk `JOB_CHAIN_FOLLOW_ON` over `TIMEOUT_PER_KIND` and sum the per-hop ceiling `(batch_size - 1) × max_handler + handler × max_attempts + backoff` across the longest chain, yielding a **43,920 s (12.2 h)** ceiling that sits under the shipped 16 h threshold — never copied from the `compute_jobs` 4h number, and a CI invariant (mirroring `test_every_kind_has_watchdog_headroom`) fails if any handler's real worst case exceeds it. ⛔ REJECTED derivation, recorded so it is never re-derived: `batch_size × max_per_kind_timeout` is the **`compute_jobs`** formula (`20260720120000:24-25`); research collision C-6 proved that re-applying it here yields **9,000 s (≈4.9× too small)** because it counts only the LAST chain hop, and a reaper on that threshold would reap healthy in-flight chains. It is named here only as the rejected answer.
- [ ] **JOB-04**: A reconciliation sweep detects strategies with persisted daily-returns data but NO `compute_jobs` row of any status and no terminal `strategy_analytics` row past a grace window — the "`after()` never ran at all" hole that the in-closure placeholder guard structurally cannot catch — and idempotently re-enqueues + alerts Sentry.
- [x] **JOB-05**: The existing orphaned-`running` `compute_jobs` purge transitions rows to a terminal `failed` status instead of bare `DELETE` (so pollers break out and the audit trail survives), at a tightened cadence with the 4h `claimed_at` threshold UNCHANGED; delivered as a NEW migration layered on `20260720120000`, reconciling the TEST-DELETE / PROD-reset split (WR-02).
- [x] **JOB-06**: The stale 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim is reproduced against current `main` before any fix is scoped (documented pass/fail); the genuinely-open gap — csv-finalize's three-step RPC → RPC → `after()` sequence having no wrapping transaction — is closed by either one SECURITY DEFINER transaction or explicit compensating cleanup + Sentry, so a partial failure leaves no orphan strategy row.
- [x] **JOB-08**: The retention family's **stale-`pending` gap is decided on measured evidence, not skipped by default**. `retention_compute_jobs_done` (jobid 4), `retention_compute_jobs_failed` (jobid 8) and `retention_compute_jobs_orphaned_running` (⚠️ jobid is per-project and NOT stable: measured 2026-08-17, TEST moved 11 → 19 on Phase 144's re-registration and PROD has always been 29 — match on JOBNAME, never on the number) exist; **nothing sweeps stale `pending`** — the one status an undrained enqueue cron produces. A committed measurement of the stale-`pending` population **on PROD** exists BEFORE any sweep is scoped, and the outcome is EITHER a sweep added as a fourth swept status using JOB-05's terminal-UPDATE pattern, OR an explicit WON'T-FIX carrying that measurement as evidence — **"population is zero on prod" is a valid, budget-saving outcome** (same measure-first shape as JOB-06). ⛔ The sweep, if built, transitions to a terminal status and NEVER `DELETE`s: a `DELETE` of `pending` under `supabase/migrations/**` auto-applies to PRODUCTION on merge and destroys real queued work. Evidence that the gap is real on the TEST project (where it is certain, since TEST has no draining worker): the `derive-allocator-key-dailies` cron fanned out 1,884 `derive_broker_dailies` rows on 2026-08-02, and because `claim_compute_jobs_with_priority` orders by `next_attempt_at` ASC before `LIMIT p_batch_size`, the backlog sat permanently at the head of the claim queue and starved every live claim test — 10 deterministic `python` failures on ANY branch including main, cleared only by hand. ⛔ Do NOT close this by `cron.unschedule(9)`: `supabase/tests/test_derive_allocator_keys_fanout.sql` assertion 6 requires that cron registered, so unscheduling reddens the `sql-tests` gate instead.

  **RESOLVED 2026-08-17 (Phase 144): WON'T-FIX carrying the measurement, per SC#4's sanctioned
  budget-saving outcome.** No stale-`pending` sweep is built. The measurement that justifies it is
  carried here rather than cited, because a WON'T-FIX with no measurement attached is just a skip.

  **The census (2026-08-17), verbatim:**

  | status | PROD `khslejtfbuezsmvmtsdn` | TEST `qmnijlgmdhviwzwfyzlc` |
  |---|---|---|
  | `pending` | **0** | 2819 (2026-08-11 → 08-15) |
  | `running` | **0** | **402** — 396 claimed (`derive_broker_dailies`) + 6 NULL-claim (`poll_positions`), 2026-08-03 → 08-14 ⚠️ corrected 2026-08-17; the original "6" was the NULL-claim subset |
  | `done` | 1545 (07-18 → 08-17) | 0 |
  | `failed_final` | 121 (05-20 → 08-17) | 0 |

  **The structural argument is the load-bearing part, not the zero.** A zero snapshot of a swept
  population would say only that the sweeper had recently run. But **nothing sweeps `pending` at
  all** — that absence *is* the whole of JOB-08 — so nothing has ever removed a `pending` row on
  PROD, and any row that had ever stranded there would still be sitting in that count today.
  ⇒ **PROD `pending` = 0 is not a snapshot; it is the statement that zero rows have EVER stranded
  on PROD.** That is what makes it decisive evidence rather than a lucky moment. Corroborated
  in-repo at `20260816140000:82`: *"Nothing sweeps stale 'pending' at all (JOB-08)."*

  **TEST's 2819 is a CI-hygiene artifact, not a product defect.** TEST has no draining worker and
  cron jobid 9 (`derive-allocator-key-dailies`) fans out one job per api_key daily, so the backlog
  is manufactured by the test environment's own configuration. Building production code to sweep it
  would be shipping a migration — which auto-applies to PROD — to fix a condition that exists only
  where no worker runs. Filed to `TODOS.md` under *Phase 144 — recorded deferrals* as CI hygiene.

  **⛔ Two traps stand regardless, and are restated here so a future reader who reopens this does
  not have to re-derive them:**
  - **Never `DELETE` a `pending` row.** A `DELETE` of `pending` under `supabase/migrations/**`
    auto-applies to PRODUCTION on merge and destroys real queued work. If a sweep is ever built it
    transitions to a terminal status, using JOB-05's terminal-UPDATE pattern.
  - **Never `cron.unschedule(9)`.** `supabase/tests/test_derive_allocator_keys_fanout.sql`
    assertion 6 requires that cron registered, so unscheduling reddens the `sql-tests` gate instead.

  **Dated-claim discipline.** The numbers above are a *dated claim*, not a fact. Phase 144 Plan 03
  re-runs the PROD census immediately before merge, so this decision rests on a fresh measurement
  rather than on this row's age. If that re-census returns a non-zero PROD `pending`, the structural
  argument above is falsified — nothing sweeps `pending`, so a non-zero count means rows HAVE
  stranded — and this WON'T-FIX must be reopened rather than re-cited.
- [ ] **JOB-07**: No reaper or sweep runs heavy work on the worker's shared asyncio event loop; a regression test proves a large synthetic backlog does not stall `healthz` past `STALE_THRESHOLD` (the WEDGE-01 crash class the janitor exists to clean up after).

### RATE — Rate limiting (audit + close verified gaps)

- [ ] **RATE-01**: A kickoff re-grep produces the authoritative current gap list (every `src/app/api` route calling either seam client, checked for `checkLimit`), replacing the stale `TODOS.md` route list as the basis for this group's scope.
- [ ] **RATE-02**: `admin/match/eval` enforces a rate limit keyed on `user.id`, sized to real eval-tooling cadence — the one verified Next.js-layer gap.
- [ ] **RATE-03**: The Python `routers/match.py` endpoints (`/recompute`, `/eval`) enforce server-side slowapi limits mirroring `portfolio.py`'s pattern, giving defense-in-depth if a leaked `X-Service-Key` reaches Railway directly and bypasses the Vercel-side limiter.
- [ ] **RATE-04**: Existing limiter VALUES on the seven already-limited routes are audited against real Python-side cost and adjusted where wrong — the substantive remaining RATE question is whether each route has the RIGHT limit, not whether it has one.
- [ ] **RATE-05**: A `withRateLimit(handler, limiter)` HOF exists and composes alongside `withAuth`/`withRole`, so a newly-added route cannot silently ship with no limiter (today's per-route hand-wiring has no CI gate).

---

## v1 Requirements — added 2026-07-26 (post-140 review programme)

> Phase 140 shipped SEAM-01..04 verified, then five review rounds (~20 reviewer reports, 4 red teams,
> 57 harness mutations) found 46 + ~120 defects **in that shipped code**. Five ad-hoc fix batches were
> **discarded wholesale** (archive branch `wip/v1.16-phase140-fix-archive`) because repairs without a
> plan→plan-check gate ran ~1:1 fix-to-defect. These groups re-enter that work through the normal
> gate. Full evidence, per-finding, in
> `.planning/phases/140-seam-shared-resilience-core-circuit-breaker/140-FINDINGS-CONSOLIDATED.md`
> (PART 2 "TRAPS" is binding on any plan that touches these).
>
> Requirement IDs cite finding IDs as *evidence*, not as scope — each requirement must be satisfiable
> and testable on its own terms.

### PYAPIFIX — Close Phase 140.1's own review findings (Phase 140.1.1)

> From `.planning/phases/140.1-.../140.1-REVIEW.md` — 36 findings, **36 mutations injected and 12
> SURVIVED**. These are defects in code 140.1 *landed*, not in the original Phase 140 surface.

- [x] **PYAPIFIX-01**: the `/process-key` duplicate reply and its consumer agree on one contract, proven by a test that exercises the **real** Python response against the **real** TypeScript guard — not two suites each mocking the other. *(H-5: `analytics-service/routers/process_key.py` — `_wizard_duplicate_reply` defined :717, its dict emits `"code": "WIZARD_DUPLICATE"` :738 / `"idempotent": True` :739 / `"queued"` :744 — emits `queued:true` with `code`/`idempotent`; `src/app/api/strategies/finalize-wizard/route.ts` — the `isProcessKeyOnboardResponse(upstream)` guard at :1857 rejects that shape → Sentry + 502 (`console.error("[strategies/finalize-wizard] unified upstream returned unrecognized shape"` :1893-1894, the 502 :1917).)* ⚠️ **Two corrections, both source-verified:** the guard is **NOT deployed** (Phase 140's commit `57b11813` on this same unmerged branch) so there is no rollout-ordering constraint — choose the fix on contract quality; and **no live caller can trigger the 502 today** (`finalize-wizard`/`keys/sync` contain zero `wizard_session_id`; the duplicate path requires a caller-supplied one per `analytics-service/routers/process_key.py` — `idempotent_by_session = body.flow_type != "teaser" and bool(body.context.get("wizard_session_id"))` at :1033-1035, consumed at :1351 / :1509). This is contract incoherence with a live trap arm, **not** a production break. Also absorb the unowned **M-11 re-triage**: onboard has no request-level double-submit protection, only job-level dedupe.
- [x] **PYAPIFIX-06**: `error_contract.py`'s remaining guard gaps are closed, breaking a **circular deferral** — no downstream phase can reach them (140.2/140.3 are TypeScript-only by their own CONTEXTs; 146 is a rate-limit phase). **(a)** A `429` carrying `Retry-After` is constructable — today `retry_after` requires `retryable:true` while the CALLER arm raises on it (`_validate`, `:146-155` + ~`:100`), yet `140.1-VERIFICATION.md` gap 1 and obligation TS-23 both mandate migrating the two in-handler 429 sites onto that envelope. **(b)** The `>=500` arm rejects a venue `dependency` — today `service_error(500, "X", dependency="binance", retryable=False)` validates, and **Phase 140.2 keys the breaker on `dependency`**, so a venue name on a 500 poisons a breaker key. *(M-1, M-2 — same function PYAPIFIX-04 already opens; excluding them half-closes the class in the phase whose stated principle is "enforce, don't document".)*
- [x] **PYAPIFIX-02**: A fault at the caller's venue answers **424/retryable** at every site a Python-side change can correct without depending on an unlanded TypeScript obligation, with the remainder (all three in `analytics-service/routers/exchange.py`, coordinates re-derived from HEAD 2026-08-08 — the original `:145`/`:152`/`:505` were read at `e26f0520`: the sFOX 429 arm, now `VenueTransientHTTPException(status_code=424, code="RATE_LIMITED"` :184-189; the sFOX 5xx/transport arm, now `code="NETWORK_UNAVAILABLE"` :199-204; and the ccxt `result["error"]` arm, now `code=result["error_code"]` :619-624) enumerated and blocker-named (**BLOCKED-BY: TS-05** — migrating them to `service_error(424)` turns `body.detail` from scalar to object, which `src/lib/analytics-client.ts` feeds into `classifyKeyValidationError` as `"[object Object]"` → terminal UNKNOWN dead-end render; the read is now `throw new AnalyticsUpstreamError(seamHumanMessage(error) ?? …` :552-557, and its docblock names the old `error.detail ??` read at :535-536), not 403 — implemented as a **permanent-code ALLOW-LIST** (never a transient denylist), the class closed rather than point-fixed, and no body contradicting itself (`recoverable:false` beside "Try again in a moment"). *(H-1.* ⚠️ **Corrected at source 2026-07-26:** `/exchange/validate-key` does **NOT** already handle this — `read_only is False` appears exactly twice repo-wide outside tests (`analytics-service/routers/process_key.py:1597`, `analytics-service/services/ingestion/long_fetch.py:331`); the real analog is the same `long_fetch.py`'s IMP-1 permanence block — comment opens :385, `permanent_codes = {` :406-409, `_is_permanent = (` derivation :432-439. The research's **transient denylist fails unsafe — it is the existing bug's own shape**. `MISSING_SCOPE` **must** be allow-listed (⚠️ this one is the `services/` file, **not** the `routers/` one — `analytics-service/services/exchange.py`, where the deribit `if scope_detail:` arm inside `validate_key_permissions` sets `result["read_only"] = False` :1104 + `result["error_code"] = … "MISSING_SCOPE"` :1111-1115 without `valid=True`, and the allow-list it must join is `PERMANENT_VALIDATION_ERROR_CODES = frozenset(` :1025-1033, while it is absent from `analytics-service/services/ingestion/long_fetch.py`'s `permanent_codes = {` :406-409) or a permanent scope fault becomes a retryable 424. The review also **missed `analytics-service/routers/process_key.py`'s `_envelope_error` `recoverable` set** (the code-derived verdict — `def _envelope_error(` :375, derivation :405-412, now inverted onto `_ROUTE_TERMINAL_ERROR_CODES = frozenset(` :364), which omits `PROBE_FAILED`/`DDOS_PROTECTION` — no status-code change fixes that.)*
- [x] **PYAPIFIX-03**: A failure in code that performs **no network I/O** is attributed to us (500), never to the caller's venue — so it counts, and someone is paged, **at all three sites**. *(H-2: `analytics-service/routers/internal.py` — `create_exchange(` :485, its `except Exception:` :488, now `service_error(500, "ADAPTER_INIT_FAILED"` :517-522. ⚠️ **Corrected 2026-07-26 — this is a 3-site class, not 1**: the pattern-mapper found `analytics-service/routers/portfolio.py` — `create_exchange(` :2283, `except Exception` :2286, now `service_error(500, "ADAPTER_INIT_FAILED"` :2309-2314 — and the **same function's second `create_exchange(` at `:2373` already answers 500** (`HTTPException(status_code=500, detail="Strategy verification failed")` :2550), which is in-repo proof the class is real. The instance-not-class defect this programme exists to catch.)*
- [x] **PYAPIFIX-04**: The `body.detail.detail` scalar guarantee is **enforced by a guard**, matching every other rule in `error_contract.py`, because Phase 140.2 renders from it. *(H-3)*
- [x] **PYAPIFIX-05**: Every one of the 12 surviving mutations turns a test RED, re-run and observed first-hand — including the ccxt-subclass narrowing that survived **twice** while making `RateLimitExceeded` answer 500, and `default_platform_key` returning `""`, which makes slowapi **skip limiting entirely** and ships green. *(H-4 + the Medium mutation set.)* **Also folds in M-15** — `analytics-service/tests/test_process_key_200_discriminator.py` asserts `len(_SHAPES) == 6` against the `_SHAPES = [` list literal **in the same file** (:372) — ⚠️ the assertion is gone at HEAD; its tombstone (`# M-15 — the enumeration fence, read from the ROUTER'S OWN AST` :416, "What was here before: a bare length assertion on `_SHAPES` against the literal six" :420) marks the spot — and its docstring's claim that a seventh return site reddens it is false. A toothless *Python* test squarely inside this phase's goal, which the "12 survivors" wording would otherwise skip and whose triage destination (140.2) cannot edit Python.

### PYAPIFIX2 — Surviving findings from the 140.1.1 review cycle (Phase 140.1.2)

> From 5 Stage-1 lenses + 5 Stage-2 red teams over `56fb7167..39688d69`. **An adversarial refutation
> pass refuted 4 of 10 findings outright and reduced 3 more** — the list below is only what survived.
> Evidence: `140.1.1-STAGE1-FINDINGS.md`, `140.1.1-STAGE2-FINDINGS.md`, `140.1.1-REVIEW.md`.
> **All five code items are Python; Phase 140.2 is TypeScript-only by its own CONTEXT, so they have
> no other home** — the same circular deferral that forced PYAPIFIX-06 into 140.1.1.

- [x] **PYAPIFIX2-01** *(HIGH)* — ⚠️ **PYTHON HALF CLOSED (7/7 sites carry code+recoverable); RENDER HALF → OB-1, owner 140.3** (ledger row **TS-35** in `140.1-TS-OBLIGATIONS.md` carries it, with `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json` as its parity input). Not a bare tick: ROADMAP SC1 also demands that a Binance-maintenance-shaped failure *no longer renders* as `UNKNOWN`/500 with no retry affordance, and that render assertion is **not delivered by this phase** — `create-with-key/route.ts` returns the status the classifier computed and the upstream status is discarded (RESEARCH C-1), so it can only be fixed in TypeScript. The venue-transient class is closed at **every** consumer of `validate_key_permissions`, including the **live key-connect route**. Today `analytics-service/routers/exchange.py`'s `if result["error"]:` arm (read as `:522` at `637074b0`; at HEAD it is `VenueTransientHTTPException(status_code=424, code=result["error_code"]` :619-624 under `@router.post("/validate-key")` :468 / `async def validate_key(` :472 — `/api/validate-key`, used by `create-with-key`, `composite/add-key`, `keys/validate-and-encrypt`) and `analytics-service/routers/portfolio.py`'s `if validation.get("error"):` arm (read as `:2322`; at HEAD the `if` is :2338 and the raise `code=validation["error_code"]` :2354-2359) collapse `RATE_LIMITED`/`DDOS_PROTECTION`/`EXCHANGE_UNAVAILABLE`/`NETWORK_UNAVAILABLE`/`PROBE_FAILED` into an opaque 400 with no `code` and no `retryable`. **The arm 140.1.1 fixed serves teaser/csv/internal_report; the unfixed one carries strictly more real traffic.** Traced consequence: `EXCHANGE_UNAVAILABLE` and `NETWORK_UNAVAILABLE` fall through `classifyKeyValidationError`'s substring cascade (`src/lib/wizardErrors.ts` — `export function classifyKeyValidationError(` :1927, terminating in `return { code: "UNKNOWN", status: 500 };` :2110) to **`UNKNOWN`/500 "our team has been notified" with no retry affordance** — the DOGFOOD-3 dead end that cascade exists to kill. Also enumerate `_validate_mt5_key`'s three classified-upstream 400 arms (all in `analytics-service/routers/exchange.py` — ⚠️ `routers/`, not `services/exchange.py`; `async def _validate_mt5_key(` :222, and the three `NETWORK_ERROR_DETAIL` arms read as `:335`/`:345`/`:361` at `637074b0` are at HEAD the `except asyncio.TimeoutError` arm :392-397, the `except Mt5AccountMismatchError` arm :408-413, and the `except Mt5ClientError` transient tail :430-435), which sit outside TS-32's carve-out.
- [x] **PYAPIFIX2-02** *(reproduce-first)* — **REPRODUCED, then FIXED** (plan 01): `error_kind="transient"` was observed first-hand on **both** codes through the real `Mt5Adapter`, so the gate opened and the fix landed — permanence is now **stated by the adapter** (provenance), not by a fifth string list. A permanent MT5 credential fault is not classified as a recoverable venue fault. `MT5_WRONG_SERVER` (`analytics-service/services/ingestion/mt5.py` — `error_code="MT5_WRONG_SERVER",` :104) and `MT5_MASTER_PASSWORD` (same file, `error_code="MT5_MASTER_PASSWORD",` :227) are absent from **both** `PERMANENT_VALIDATION_ERROR_CODES` (`analytics-service/services/exchange.py:1025-1033`) and `analytics-service/services/ingestion/long_fetch.py`'s local `permanent_codes = {` :406-409, so on the live worker path they yield `error_kind="transient"` → **3 gateway-serialised retries → `failed_final`** for a credential that can never succeed. **MT5 is `ENABLED=true` in production.** The TS side already classifies both as 400 client faults (`src/lib/wizardErrors.ts` — `return { code: "KEY_MT5_MASTER_PASSWORD", status: 400 };` :2078 and `return { code: "KEY_MT5_WRONG_SERVER", status: 400 };` :2081) — **Python and TypeScript hold opposite verdicts on the same codes.** ⚠️ **Reproduce the worker path before scoping** — one red team held that MT5 branches before `create_exchange` and never calls `validate_key_permissions`; "could not reproduce" is a valid, budget-saving outcome.
- [x] **PYAPIFIX2-03** — closed (plan 02): the raw `HTTPException(429)` now goes through `service_error(429, "RATE_LIMITED", retryable=True, retry_after=...)`, giving that builder arm its first consumer; the `error_contract.py` comment it invalidated was inverted in the SAME commit. `/internal` throttling emits the service's own envelope. `analytics-service/routers/internal.py`'s per-key throttle arm inside `async def get_key_permissions(` (:185, route decorator :184) raises a raw `HTTPException(429)` — ⚠️ at HEAD that site is already the fixed `service_error(429, "RATE_LIMITED", retryable=True, retry_after=int(_RATE_LIMIT_WINDOW_S)` :251-257 — one line from a builder arm that would validate it cleanly — so the 429 arm added in 140.1.1 has **zero call sites** and the response carries no `code`. *(Its consumer additionally launders the 429 into `502 / PROBE_FAILED`, discarding the `Retry-After` — that half is TypeScript and belongs to 140.3.)*
- [x] **PYAPIFIX2-04** — closed (plan 02): all four user-facing 429s carry `Retry-After`. Every **user-facing** 429 carries a `Retry-After`. Four do not: `analytics-service/routers/match.py` — the `_force_last_run` throttle, `status_code=429,` :1742; `analytics-service/routers/portfolio.py` — the `if not _check_bridge_user_rate(` arm :1962, `status_code=429,` :1964; `analytics-service/routers/simulator.py` — the `if not _check_simulator_user_rate(` arm :247, `status_code=429,` :249 (+ the same `portfolio.py`'s `if not _check_verify_strategy_email_rate(` arm :2253, `status_code=429,` :2255, on a dead route). This is the 429-shaped hole in the "503 carries `Retry-After`; honour it" rule.
- [x] **PYAPIFIX2-05** — closed (plan 04): `_SHAPES` is bound to the router's AST by a one-to-one containment oracle (router source AST vs live HTTP bodies — two artifacts, never a count). Falsifiability OBSERVED: deleting a row reddens naming the uncovered fingerprint, and the M-15 fence still reddens on a 7th 200-capable return. The 200-discriminator corpus cannot silently shrink. 140.1.1 deleted `test_pyapi_10a_exactly_six_shapes_are_covered` as self-referential — correctly — but it was **also** the only guard on `_SHAPES`, and the AST fence that replaced it does not read `_SHAPES` at all. **Deleting a row was OBSERVED to survive** (141→140 passed). One assertion, bound to the fingerprint set.
- [x] **PYAPIFIX2-06** — closed (plans 02 + 04): all four artifact items corrected, each replacement coordinate RE-DERIVED by reading source at current HEAD (never `old + N`); the fifth item was a scope collision, settled below. The phase's own artifacts state only what they can support. `140.1.1-VERIFICATION.md` must read `gaps_found`: its Direction-2 claim *"no already-correct test was weakened or removed"* is **false** (two tests were deleted; one is missing from the deletions table), and PYAPIFIX-02's carve-out completeness was evidenced by `grep -c "BLOCKED-BY: TS-05" → 1`, which proves a marker exists, not that a list is complete. In `docs/STATUS_CONTRACT.md`: the "not seam-reachable" list's `exchange.py:491` **currently points at a live 424 arm**; S-11's `internal.py:414` is wrong (at HEAD `2c55ece0` the `except Exception:` is `:442` and the `service_error(500, "ADAPTER_INIT_FAILED", ...)` raise is `:471`; the `:421`/`:450` pair quoted here was itself read at `39688d69` and has since drifted — which is the point); `## 1. The four classes` heads a **five**-row table. ⚠️ **Do NOT run a general comment sweep** — the "six refs off by the inserted-line count" diagnosis was **refuted**; most drift pre-dates the phase, so any number recomputed as old+18 would be wrong.
  - ⚠️ **W-1 — location clause corrected.** This requirement originally placed the 6/7→6/10 census *"In `docs/STATUS_CONTRACT.md`"*. **That was false.** The census is a CODE COMMENT at `analytics-service/services/error_contract.py` — `# MEMBERSHIP, not prohibition: six of sixteen legitimately name one of`, inside `_validate`'s `if status_code >= 500:` arm, :166-171 (`def _validate(` :100). The planner settled the scope collision as a fenced comment-only exception and it landed in plan 02 (`e5aead5d`), with the arithmetic re-derived by AST — **6 of 16** `service_error(500, …)` sites carry `dependency` — never as `7 + 3`. Plan 04 therefore touches no code for this item. Leaving the false location on a ticked requirement would be the identical defect class this requirement exists to correct.

### SEAMCORE — Seam core & breaker correctness (Cluster A + D)

- [x] **SEAMCORE-01**: Breaker failure recording is driven by an **attributability** decision, not by `status >= 500`: a fault caused by the caller, the caller's credentials, or the caller's exchange must not count as Railway degradation, and a genuine service fault must. The discriminator handles the `text/plain` body an unhandled FastAPI exception produces. *(A-01, A-02, A-03, A-05, A-22, C-12; TRAP-2)*
- [x] **SEAMCORE-02**: The failure-recording window covers the **whole** request lifecycle including the response-body read, so a deadline that fires after headers arrive — the most common Railway degradation — is recorded, and the body-read rejection surfaces as a typed seam error rather than a raw `DOMException`. *(A-21)*
- [x] **SEAMCORE-03**: Every breaker-store round trip is bounded by an explicit retry/timeout configuration and is **counted in the budget invariant**, so a hung Upstash cannot hold a lambda to `maxDuration` and the declared per-route budgets remain true in the open, closed and failing-store states. *(A-04, A-26)*
- [x] **SEAMCORE-04**: Breaker state reads are self-consistent — a healed circuit is never reported open, and a known-open state is never discarded by a secondary-call failure. *(A-24)*
- [x] **SEAMCORE-05**: Trip and recovery behaviour is **measured and asserted**, not assumed: recovery latency matches its documentation, cooldown-vs-window ordering is enforced by a test, an in-flight pre-trip failure cannot re-arm an expired lock, and the store's fail-open sentinel is never read as counter exhaustion. *(A-08, A-09, A-14, A-25)*
- [x] **SEAMCORE-06**: Breaker open/close transitions emit a structured operational event, and transport failures are logged with a diagnostic that **preserves the syscall token** (`ECONNREFUSED`/`ENOTFOUND`/TLS/DNS) while scrubbing every credential the seam carries — at every log site and every Sentry capture, including per-request secrets. *(A-10, A-11; TRAP-1 is binding)*
- [x] **SEAMCORE-07**: Every breaker constant and every per-route timeout budget is pinned by an oracle the implementation **does not supply** (literals in the test, not values read back from the table under test), so changing any tuning value fails a test in both directions. *(D-07, D-08, D-10, D-13)*
- [x] **SEAMCORE-08**: Structural invariants of the core are mechanically enforced rather than documented: the shared-error leaf stays dependency-free, each call site's budget key is pinned, health-warmer paths provably cannot enter the core, and the lint guard catches the URL shapes that actually occur in this codebase. *(A-12, A-13, A-16, A-18, D-09, D-11, D-14)*
- [x] **SEAMCORE-09**: The breaker's Redis-side semantics are verified against **real Redis** — a fake that cannot execute the deployed Lua cannot verify sliding-window decay, weighted carry-over, no-increment-on-denial, or `nx` trip idempotency. *(D-01, D-02, D-13)*
- [x] **SEAMCORE-10**: Multi-call routes declare their real worst case: fan-out over composite members is bounded, the bound is enforced at the query, and the budget table models the branch actually taken rather than a sibling branch. *(A-06, A-29)*
- [x] **SEAMCORE-11**: The core fails loud on malformed inputs and refuses ambiguous transports: invalid timeout/retry-after values raise at construction, redirects are not followed (secret headers must never survive a cross-origin hop), and non-JSON 2xx / 204 / 304 responses resolve to one defined, non-crashing outcome across both clients. *(A-15, A-23, A-27, A-28)*

### SEAMUX — Client & wizard error surface (Cluster B)

- [ ] **SEAMUX-01**: Seam error codes and their user-facing copy have **one source of truth**; a drift between any two production copies fails a test, and `CIRCUIT_OPEN` is a first-class code the wizard classifier recognises rather than an unknown-code dead end. *(B-01, B-07, D-12)*
- [ ] **SEAMUX-02**: The wizard error classifier is pinned against the **actual** messages the seam clients emit, so the common breaker-closed Railway outage classifies correctly instead of falling through to `UNKNOWN`. *(B-02)*
- [ ] **SEAMUX-03**: Every seam-touching route answers with the repo's typed error envelope carrying a `code`, on every arm — including the public teaser, the CSV routes, the admin match routes, and `keys/sync`'s currently codeless arms — so a client can discriminate without sniffing prose. *(B-08, B-10, B-12, C-04)*
- [ ] **SEAMUX-04**: No error surface makes a **false claim about the user's data or its cause**: our outage is never reported as the user's exchange, the user's file, or the user's credentials being at fault, and no copy asserts work completed (or didn't) that the client cannot know. *(B-03, B-04, B-16, B-18, B-20; C-02 bounds what may truthfully be claimed)*
- [ ] **SEAMUX-05**: Every seam call site observes the **HTTP outcome**, not just transport rejection: an unrecognised or unparseable body is a failure, not a success, and never starts a poll for work that was never enqueued. *(B-05, B-06, B-13, B-15, B-17, C-07)*
- [ ] **SEAMUX-06**: A recoverable seam error always offers a retry, that retry is never the sole route to a destructive control, and `Retry-After` is honoured at every surface that renders one — for the breaker's 503 as well as 429. *(B-11, B-22, B-23; TRAP-4 is binding)*
- [ ] **SEAMUX-07**: Every analytics response consumed by a decision is **schema-validated and fails closed**. A publish/permission gate must never pass because a field went missing. *(B-14, B-24, C-05, C-06)*
- [ ] **SEAMUX-08**: Seam failures are observable to us as well as to the user: funnel events carry the specific error code rather than a collapsed bucket, every wizard variant emits them, and unexpected failures actually reach Sentry wherever the copy claims a team was notified. *(B-21, B-25)*
- [ ] **SEAMUX-09**: A failed recompute **discards the result it invalidates**. No surface may present a prior successful result as current after a subsequent attempt failed — in particular, no failed compute may leave money-bearing output (ranked allocations, weights, candidate lists) rendered with live action controls, and no unvalidated shape may render as an empty-but-successful panel. *(B-26 — CRITICAL — plus B-27, B-28; the correct pattern already exists in `WeightOptimizerSection.tsx`)*

### PYAPI — Python service contract & limiter identity (Cluster C)

- [x] **PYAPI-01**: Wizard-session uniqueness is **tenant-scoped**, and no duplicate pre-check can return another tenant's verification id, status or trust tier. Proven by an RLS/SQL gate under `supabase/tests/`. *(C-08 — the programme's only CRITICAL)*
  - **DONE (2026-07-26) — both halves, across two plans.**
    - *Constraint half* (Plan 140.1-01): `UNIQUE (strategy_id, wizard_session_id)` (migration `20260726000225`), gated by `supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql`, proven RED pre-migration and GREEN post-migration.
    - *Query half* (Plan 140.1-02, commit `ca9a9235`): **both** service-role read sites now scoped — the duplicate pre-check (`analytics-service/routers/process_key.py` — `if idempotent_by_session:` :1351, `existing = one(` :1352 with `.eq("strategy_id", strategy_id)` :1355 + `.eq("wizard_session_id", wizard_session_id)` :1356) and the 23505 race-winner re-fetch (same file — `race_winner = one(` :1523, `.eq("strategy_id", strategy_id)` :1526 + `.eq("wizard_session_id", wizard_session_id)` :1527), each filtering `strategy_id` AND `wizard_session_id`. The pre-check had to **move** below the `strategy_id is None` branch before it could be scoped at all. A `strategies` id+user_id ownership gate runs ahead of the first read (403 `STRATEGY_NOT_OWNED`), because `strategy_id` is caller-supplied and a scoped read alone is necessary-not-sufficient. Proven by pytest oracles PYAPI-01d (one per read site) and PYAPI-01e; mutation M2 (drop the scoping from the race site only) reddens the race oracle while the pre-check oracle stays green.
    - The SQL gate passes with the query half unfixed, which is why both plans were required before this box could be ticked.
- [x] **PYAPI-02**: `/process-key` throttling is bounded **per tenant**, so no single caller — and in particular no anonymous caller of the public teaser — can exhaust the allowance for paying tenants. *(C-09, C-23)*
  - **DONE (2026-07-26) — Plan 140.1-06, commits `f8c85b07` (Python) + `eb88d53e` (TS mint).**
    - Buckets: `process_key:t:<user_id>` 100/hour · `process_key:anon` **30/hour** ·
      `process_key:unverified:<sha256(cred)[:16]>` 100/hour + WARN · stacked platform ceiling
      `process_key:ceiling:<hash>` 500/hour. Identity is an HMAC-SHA256 `X-Tenant-Claim`
      (`<payload>.<exp>.<mac>`) keyed on `INTERNAL_API_TOKEN` — **no new secret, no new library**.
    - The anonymous half is closed by a DEDICATED bucket sized *below* a tenant's, proven live:
      `test_anon_bucket_exhausts_at_30_without_touching_a_tenant` (31 teaser calls 429 the teaser
      and a tenant call still passes).
    - Forgery closed by four oracles — tampered MAC, wrong secret, expired claim, and unsigned
      `X-User-Id` — each asserting the attacker lands in `unverified`, never a tenant bucket.
    - Both stacked limits proven to evaluate against a live `TestClient` in both directions
      (ASSUMPTION-1: RESEARCH read slowapi 0.1.9, prod pins 0.1.10).
    - Requires PYAPI-04 in the same wave: without it an *unauthenticated* caller could allocate
      `unverified` buckets. That is why the two shipped together.
- [x] **PYAPI-03**: No router declares its own request-address-keyed limiter; all throttling goes through the shared limiter service with a documented token cost per flow. *(C-10; distinct from RATE-03, which adds `match.py` coverage)*
  - Closed by 140.1-07 (`7297f941`, `60086ce3`, `e26f0520`, `139f3153`). 9/9 routes rekeyed onto `partial(tenant_or_platform_key, scope=...)`; 0 private `Limiter()` (AST-gated); singleton default no longer IP-derived; flow-cost table in `services/rate_limit.py`'s docstring; 63 oracles in `tests/test_limiter_identity.py`.
  - ⚠️ **FINDING-10 open**: `analytics-service/routers/simulator.py` is a TENTH IP-keyed route — `def _simulator_rate_limit_key(` :59 returning `f"simulator:ip:{get_remote_address(request)}"` :92 that the plan's do-not-touch list calls "correctly user-keyed". Reported, quarantined by an equality gate, NOT fixed — needs its own plan.
- [x] **PYAPI-04**: On `/process-key`, authentication is decided **before** validation and throttling, so an unauthenticated caller can neither enumerate configuration nor consume the throttle budget. *(C-18)*
  - **DONE (2026-07-26) — Plan 140.1-06, commit `3a1bee30`.**
    - Gate order was pydantic 422 → slowapi 429 → handler 403; it is now
      **bearer 500/401 → 422 → 429 → 403**. `main.verify_service_key`'s `/process-key` carve-out
      became a GATE (`main.py:_gate_process_key`) — middleware is the only layer that runs before
      pydantic resolves.
    - *Enumeration* closed by a substring oracle, not a status check: an unauthenticated POST with
      `source:"sfox"` answers 401 and the body contains none of `SFOX` / `SFOX_ENABLED` / `MT5` /
      `MT5_ENABLED`. Positive control: the SAME body with a valid bearer still 422s **with** the
      flag name, so the silence is provably the auth gate and not a broken harness.
    - *Budget burn* closed with a storage oracle: 105 unauthenticated POSTs record **zero** slowapi
      hits on `/process-key`. ("the next authenticated call is not 429" alone is vacuous — an
      anonymous caller lands in its own bucket either way.)
    - Unset `INTERNAL_API_TOKEN` ⇒ **500 `INTERNAL_TOKEN_UNCONFIGURED` `retryable:false`**, checked
      BEFORE any comparison: `compare_digest(provided, getenv(...) or "")` matches empty-vs-empty
      and ADMITS the request (plan-check blocker B4). 500 not 401 — it is OUR misconfiguration.
    - Mutation M3 (restore the bare skip) ⇒ 8 tests RED. Reverted and verified clean.
    - Both refusals RETURN a `service_error_response`, never raise (QUANTALYZE-4), pinned by an
      `ast.Raise` assertion over both functions. `_verify_internal_token` stays in the handler as
      defence-in-depth, with its original 403 assertions kept verbatim as handler-level tests.
- [x] **PYAPI-05**: Status codes are attributable at the source: a fault in the caller's request, credentials or exchange answers 4xx; only a genuine service-side fault answers 5xx. This is the emit-side contract SEAMCORE-01 consumes. *(C-12, C-16, C-17; A-01)*
- [x] **PYAPI-06**: A missing or stale platform secret produces an unambiguous operator signal rather than a green `/health` with a silently broken seam. *(C-11)*
  - **DONE (2026-07-26) — Plan 140.1-06 (`3a1bee30`) + Plan 140.1-08 (`49e0cf2d`).**
    `/process-key`'s auth gate emits **three distinct** structured events so an operator can
    tell a config fault from a rotation from an attack: `process_key.auth.secret_unset` (ERROR),
    `process_key.auth.token_absent` (WARN), `process_key.auth.token_mismatch` (WARN). None
    references the token variable — no token, no prefix, no length. Plus
    `rate_limit.tenant_claim_unverified` (WARN, claim PRESENCE only, never content).
    - *`/health` half closed by 140.1-08*: `analytics-service/main.py` — `async def health():` :829, whose body dict adds `config_ok` :863 (the secret verdict,
      deliberately NOT crossed with the worker-heartbeat `status`) and `config_degraded_secrets`
      :864 (names only), plus `REQUIRED_PLATFORM_SECRETS` + a lifespan startup assertion whose
      before-the-worker ordering is AST-pinned, plus rate-limited Sentry captures on all four
      secret arms. **`/health` stays HTTP 200** on config degradation — a red `/health` is a
      Railway restart loop that suppresses the very signal being added (T-140.1-24).
    - *No-echo proven*: every contiguous 6-gram of two canary secrets AND two caller-presented
      wrong values is asserted absent from Sentry captures, stdout, stderr and the stdlib log
      stream; a positive control asserts the capture DOES name `SERVICE_KEY`. Mutation S-07
      (echo the secret value into the capture) reddens it.
    - ⚠️ **RESIDUAL, carried as TS-26**: a *stale* (as opposed to missing) Vercel-side
      `ANALYTICS_SERVICE_KEY` is detectable only *after the fact*, via the `config_fault=mismatched`
      Sentry trail on each 401. Proactive detection needs a credential-carrying probe on the
      `warm-analytics` warmer — and it can NEVER be a `/health` extension (A-12 / O-7 forbid routing
      `/health` through the seam core, or the breaker blocks its own recovery probe).
- [x] **PYAPI-07**: No response body echoes caller-supplied credentials, and structured validation detail reaches logs and users **as structure**, not stringified to `[object Object]`. *(C-13, C-14)*
- [x] **PYAPI-08**: Throttle responses carry a machine-readable code and a `Retry-After`, so a throttle never renders as an unknown internal error. *(C-15)*
- [x] **PYAPI-09**: Idempotency is complete rather than partial: a replay can never return "duplicate" for work that was never enqueued, and there is no state from which a client is told to retry forever with no path to success. *(C-01, C-19, C-20, C-21)*
- [x] **PYAPI-10**: The `/process-key` success surface has **one discriminator**, and no security verdict is delivered under a success status. *(C-22)*

### MT5 — MetaTrader 5 end-to-end on the unified backbone (Phase 142.2)

Added 2026-08-03 from `/gsd-discuss-phase 142.2`. Scope anchor: the connect experience and the
correctness of what it produces. v1.15 already shipped the MT5 pipeline (tag `v1.15`, 6/6 phases)
and MT5 is already folded into the unified backbone at `analytics-service/services/broker_dailies.py` — `def combine_mt5_deal_ledger(` :545 — this group does
**not** build a pipeline, it makes the existing one reachable, honest, and *proven*.

⚠️ v1.15 shipped **6/6 phases green with two open items intact**. A green unit suite is therefore
explicitly not evidence for this group. MT5-06..09 are satisfied only by an end-to-end run against
a live funded account on a **trading day**.

- [x] **MT5-01** — ✅ **DELIVERED 2026-08-03, ahead of planning** (D-01 called for the flip *before*
  any code). All six env entries now exist: `MT5_ENABLED` on Production / Preview / Development and
  `NEXT_PUBLIC_MT5_ENABLED` on all three (it was Production-only). Production was **redeployed** —
  `quantalyze-djygeqsqy`, `main` @ `d80a1ba`, Ready — so the var is in effect, not merely stored.
  Preview/Development pick theirs up on their next build, which is the normal path. ⚠️ Vercel CLI had
  to be upgraded 54.4.1 → 58.4.4 first: the old CLI looped on `env add … preview`, answering
  `git_branch_required` and then suggesting verbatim the command just run. The requirement text below
  is retained as the specification.
  The production half-state is closed. Server-side `MT5_ENABLED=true` is set in
  Vercel **and redeployed** (an env change alone is inert), across Production, Preview **and**
  Development — and because `NEXT_PUBLIC_MT5_ENABLED` is today Production-only, **both** vars are
  extended to Preview and Development so no environment carries a gate the others do not. Evidence
  the gap is real: prod holds 29 encrypted vars and `MT5_ENABLED` is absent from all of them, so
  `isMt5EnabledServer()` (`src/lib/closed-sets.ts` — `export function isMt5EnabledServer(): boolean {` :178, strict `=== "true"`) is false while
  `MT5_UI_ENABLED` (same file — `export const MT5_UI_ENABLED = process.env.NEXT_PUBLIC_MT5_ENABLED === "true";` :124, a bare `NEXT_PUBLIC_MT5_ENABLED === "true"` with **no founder gate**)
  is true — the MT5 card renders for **every** production user and `src/app/api/strategies/create-with-key/route.ts`'s `if (isMt5 && !isMt5EnabledServer()) {` gate (:151, returning `code: "KEY_VENUE_NOT_ENABLED"` :153)
  rejects every one of their submissions. ⛔ The closed-set no-widening pin holds: `mt5` stays OUT
  of `UI_EXCHANGE_CODES` / `EXCHANGES` / `FUNDING_EXCHANGES` / `CRYPTO_EXCHANGES` regardless of the
  flag (`src/lib/closed-sets.ts` — the no-widening docblock above `MT5_UI_ENABLED`, :119-122).
- [x] **MT5-02** — ✅ **DELIVERED + VERIFIED 2026-08-03** as a consequence of MT5-01, and verified by
  observation rather than inference: `curl https://quantalyze.xyz/security` now returns the
  `mt5-readonly` anchor and the "investor (read-only) password" copy (4 matches each), content that
  renders **only** when `isMt5EnabledServer()` is true. Before the redeploy it returned none. This
  doubles as the live proof that MT5-01's server gate is actually in effect — the same function
  guards `src/app/api/strategies/create-with-key/route.ts` (`if (isMt5 && !isMt5EnabledServer()) {` :151), so that rejection arm can no longer fire.
  The `/security#mt5-readonly` investor-password guide renders in production. It
  gates on the same `isMt5EnabledServer()` (`src/app/(marketing)/security/page.tsx` — `{isMt5EnabledServer() && (` :544), so it is
  currently **blank** — the wizard tells a founder to use an investor password while the page
  explaining what that is shows nothing. Content is already correct; this is a gating consequence
  of MT5-01, asserted separately because it is a distinct user-visible surface.
- [x] **MT5-03**: The Broker-server field renders as plain text while OKX's passphrase stays
  masked, via a **per-venue** flag (`passphraseSecret`) added alongside the per-venue
  `passphraseLabel` / `passphrasePlaceholder` config the file already carries. MT5 reuses OKX's
  passphrase slot (`src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` — the
  `id: "mt5" as const,` venue entry :142, whose `passphraseLabel: "Broker server"` / `passphraseSecret: false`
  sit at :151-152), and that slot used to be `type={showSecret ? "text" : "password"}` — the shared
  unmask that still drives the api_secret input at :718; the passphrase input's `type=` is now the
  per-venue `{passphraseSecret && !showSecret ? "password" : "text"}` at :739 (`passphraseSecret`
  declared :76, defaulted `?? true` at :445) — so a global unmask would expose the OKX passphrase, a genuine API
  credential. The OKX render stays **byte-identical**.
- [x] **MT5-04**: `KEY_INVALID_FORMAT` no longer buckets unrelated causes. The **24 emitting** sites across
  `src/app/api/strategies/create-with-key/route.ts` (12) and
  `src/app/api/strategies/composite/add-key/route.ts` (12) are split into honest codes
  (missing-required-field, unsupported-venue, venue-not-enabled, input-too-long), leaving
  `KEY_INVALID_FORMAT` for **actual format failures only** — which makes its existing copy true
  again. Today `src/lib/wizardErrors.ts`'s `KEY_INVALID_FORMAT: {` entry (:613, `cause:` :625-626) stated *"Client-side format check failed before sending the
  key to the exchange"*, which was **factually false** for the observed failure (a server-side
  feature gate), and offers Binance/OKX/Bybit hex-length advice to an MT5 user. ⚠️ MT5-01 makes the
  MT5-gate arm (`src/app/api/strategies/create-with-key/route.ts` — `if (isMt5 && !isMt5EnabledServer()) {` :151) **unreachable** — a fix aimed only at that arm would repair a line
  that can no longer fire; the value is in the class. MT5 already has correct dedicated copy
  (`src/lib/wizardErrors.ts` — `KEY_MT5_MASTER_PASSWORD: {` :516 and `KEY_MT5_WRONG_SERVER: {` :533) the route never
  reaches. Out of scope, logged to `TODOS.md`: the same defect's **9** remaining emitting sites in
  `keys/validate-and-encrypt/route.ts` (4) and `verify-strategy/route.ts` (5).
  ⚠️ **Counts corrected 2026-08-04 from executed measurement, replacing the research's 28/11.**
  `grep -c 'KEY_INVALID_FORMAT'` returns 14 per in-scope route, but `grep -c 'code: "KEY_INVALID_FORMAT"'`
  returns **12** — the delta is comment prose describing the MT5 short-login carve-out. Only emitting
  sites can lie to a user, so 24 (12+12) in scope and 9 (4+5) deferred are the real numbers, and the
  `wizardErrors.invariant.test.ts` registry pin uses the literal **12**. Re-verified by grep at HEAD by
  plan 07 and again by the phase verifier. A miscounted class-fix ledger is this phase's own defect
  class — the requirements doc must not carry a number its own execution disproved.
- [x] **MT5-05** *(DISCHARGED 2026-08-04 on PROD, after MT5-13 landed)*: A founder completes the MT5
  connect flow through the wizard **without needing to know an internal error code, a server name, or
  a flag** — the phase-goal sentence, asserted as an outcome rather than as the sum of MT5-01..04.
  **Evidence** (live founder run, not a test): strategy `8d382aaf-4e23-4fc1-85b9-78fafc5c8e54`
  "Alpha Centauri" — `status='private'` (the correct allocator/contribution terminal status),
  `supported_exchanges=['mt5']`, linked key venue `mt5` and active, `series_completeness='ledger_complete'`,
  metrics computed 14:19Z (`sharpe=-0.78`, `max_drawdown=-41.5%`, `computation_error=NULL`).
  ⚠️ **It took TWO blockers past the phase's own green suite to get here** — MT5-11 (gate drift, found
  by dogfood) and MT5-13 (the ccxt-only probe, found by this run). Both were invisible to 10k+ tests
  and visible within minutes of a real submit. Weight exposure over review depth accordingly.
  ⚠️ `computation_status='complete_with_warnings'` — not a blocker for this requirement, but NOT
  investigated; do not read this checkbox as "the MT5 numbers are audited."
- [x] **MT5-11** *(BLOCKER — found by live dogfood 2026-08-03, minutes after MT5-01 opened the
  path)*: `isLedgerBackedExchange` is brought back into lockstep with the Python source set, so an
  MT5 (and sFOX) strategy is evaluated on the **daily-returns** branch of the gate rather than the
  fill-based one. **Measured drift:**
  `analytics-service/services/ingestion/long_fetch.py` — `_LEDGER_BACKED_SOURCES: frozenset[str] = frozenset({"deribit", "sfox", "mt5"})` :63 — holds
  `_LEDGER_BACKED_SOURCES = frozenset({"deribit", "sfox", "mt5"})`, while
  `src/lib/strategyGate.ts`'s `export function isLedgerBackedExchange(` (`:73` at `8b327594^`; **deleted at HEAD by MT5-12**, replaced by `export function isDailyReturnsSourced(` :163) still returns `exchange === "deribit"` — under a comment that
  explicitly instructs *"Mirrors the analytics-service `is_ledger_backed` … **keep the two in
  lockstep**. Deribit is the only such venue today."* Python was widened for sfox and mt5; the
  TypeScript mirror and its comment were never updated.
  **Observed consequence on PROD** (key `46293712`, strategy `7a5d033a`, connected 14:44 UTC):
  the pipeline succeeded end to end — `process_key_long` → `derive_broker_dailies` →
  `compute_analytics_from_csv`, all `done`, 1 attempt, no errors, `unified_backbone_at_claim=true`
  — and wrote **135 rows to `csv_daily_returns` (2026-03-22 → 2026-08-03, 75 non-zero days, returns
  −10.57% … +14.97%)** with **0 rows in `trades`**, which is correct-by-construction for a
  deal-ledger venue. `src/lib/strategyGate.ts`'s `const isDailyReturnsSourced =` (`:181` at `8b327594^`) and its
  `(!input.apiKeyId || input.isLedgerBacked === true)` term (`:184` there; **both gone at HEAD** — MT5-12 replaced them with `export function isDailyReturnsSourced(` :163 reading `SERIES_TRUSTED_FOR_DAILY_BRANCH` :170) then evaluated false, dropping a 135-day account onto the fill branch → `0 < 5` →
  `GATE_INSUFFICIENT_TRADES`. ⚠️ **The failure is unwinnable and the remedy offered is false**: the
  screen advises "try another key", but **no** MT5 key can ever pass this gate regardless of
  history, and `try_another_key` **destroys the draft and every `strategy_keys` member under it**
  (`SyncPreviewStep.tsx` — `onTryAnotherKey` fires `handleDeleteDraft()`). With the term corrected,
  135 ≥ `STRATEGY_GATE_MIN_CSV_ROWS` (7) and the same account passes.
  ⚠️ **sFOX carries this bug latently** — it is in the Python set and absent from the TS mirror;
  it is masked only because sFOX is dormant. Fix both venues, not just mt5.
  ⚠️ The **stale comment is part of the defect** — a future reader following it re-narrows the
  function. Whatever replaces the hardcoded literal must make TS/Python divergence *detectable*
  rather than restating the instruction that already failed.
  ⛔ **Delivery route settled by the founder 2026-08-03: NOT a standalone PR.** This requirement is
  satisfied **through MT5-12** (delete the venue-list proxy; the daily series answers for itself).
  Shipping the one-term widening on its own is explicitly rejected — it would re-arm the identical
  drift for the next venue. MT5-11 remains listed separately because it names the *observed* defect
  and its PROD evidence; MT5-12 names the *fix*.
- [x] **MT5-12** *(ARCHITECTURAL — founder call 2026-08-03: consolidate the backbone, do NOT ship
  MT5-11 as a standalone patch)*: **Strategy admissibility is decided from the canonical daily
  series itself, not from a venue-name list.** `isLedgerBackedExchange` is **deleted**, not widened,
  and no hardcoded venue set governs gate routing in *either* language.
  **Why the one-line fix is refused as the deliverable:** MT5-11's branch condition is a **proxy**.
  The gate's real question — stated in `src/lib/strategyGate.ts`'s `// The \`!input.apiKeyId || input.isLedgerBacked\` term is load-bearing:` comment (`:170-176` at `8b327594^`; gone at HEAD) — is *"is this daily series complete,
  or is it a funding-only stub with a fills gap that would understate the track record?"* It
  approximates that with *"which venue is this?"*, hand-maintained in two languages with only a
  comment ("keep the two in lockstep") as enforcement. That proxy was always going to drift; it
  drifted; widening it re-arms the same trap for the next venue.
  ⭐ **Founder insight 2026-08-03, verified in code — "all venues produce a ledger."** This is
  correct and it reshapes the requirement. `services/broker_dailies.py` holds **four** combine
  functions and **every venue already derives the same daily series from ledger-shaped inputs**:
  `def combine_realized_and_funding(` :218 (binance/bybit/okx — realized PnL **+ funding**),
  `def combine_native_ledger(` :268 (deribit), `def combine_sfox_balance_history(` :351 (sfox),
  `def combine_mt5_deal_ledger(` :545 (mt5). The file header records that funding was **+20.4% on a live
  Bybit account — two-thirds of the profit** — and that `fetch_daily_pnl` excludes funding by
  design, so realized-only is wrong. Some venues *additionally* expose equity / unrealized PnL.
  ⇒ **"ledger-backed vs fill-based" was never about whether a ledger exists.** Every venue has one.
  The only genuine difference is that perps *also* fetch fills (`adapter.fetch_raw`) into `trades`;
  `analytics-service/services/ingestion/long_fetch.py`'s `if is_ledger_backed:` :461 skips that step for ledger venues because it is redundant or unimplemented
  there. `trades` is therefore a **parallel, partly-redundant representation populated by only some
  venues** — and the gate reads *it* instead of the daily series every venue produces. **MT5 did not
  fall through a gap in the backbone; it revealed the gate was never on the backbone for any venue.
  Binance passes for the same wrong reason MT5 fails.**
  ⇒ **Supersedes the initial "add a provenance column" sketch.** Since all venues already land in
  one daily series, completeness is a property of **that series' inputs**, not a venue label — and
  today it is interrogated *only* for perps and *only* by venue name, while deribit/sfox/mt5 ledgers
  receive **no completeness check at all** and are trusted purely by list membership. The
  requirement is the invariant (below), not any particular carrier; research/planning chooses
  between a per-series completeness signal, a derived check over the inputs, or another mechanism.
  **The missing piece, confirmed on PROD:** `csv_daily_returns` carries
  `strategy_id, date, daily_return, created_at, updated_at, id, api_key_id, allocator_id` — and
  **no completeness or provenance column**. A canonical daily row therefore cannot state whether it
  is a complete ledger-derived return or a funding-only stub, which is precisely why the gate is
  forced to interrogate a venue list. "Dailies are canonical" currently holds for **computation**
  and fails for **trust**: trustworthiness lives outside the dailies.
  ⚠️ **The falsification test — the safety property MUST survive.** A naive "always read the daily
  series" satisfies MT5-11 and **breaks the invariant the branch exists to protect**: it would admit
  a keyed perp whose `csv_daily_returns` holds funding only (no fail-loud completeness gate), and
  publish an understated track record as verified. The fix is not "stop asking"; it is "make the
  daily series answer". Any candidate implementation is rejected unless a fixture of a
  fills-gapped perp is still **refused** — that case is the oracle, not MT5 passing.
  ⚠️ Scope reaches every venue's ingestion (it must write the provenance the gate will read) and
  needs a schema change + migration. ⛔ `supabase/migrations/**` **auto-applies to PRODUCTION on
  merge to main** — the migration is the highest-risk artefact in this phase.
  **MT5-11 is delivered *through* this requirement, not before it.** If the combined work proves too
  large, the founder's stated valve is a **follow-up phase immediately after 142.2** — not a revert
  to the standalone patch, and not shipping MT5 blocked.
  *Deferred, explicitly not required here:* renaming `csv_daily_returns`, whose CSV-era name now
  carries API-derived MT5/Deribit/perp data — the same seam showing in the schema. Cosmetic relative
  to the invariant; log to `TODOS.md`.
#### MT5-06..10 — moved to Phase 142.3 (split 2026-08-03 at the D-14 valve)

⚠️ The five requirements below were **split out of Phase 142.2 into Phase 142.3** on 2026-08-03,
on the sizing finding in `142.2-RESEARCH.md`. They are unchanged in content — only their owning
phase moved. The cut is the founder's pre-authorised D-14 valve (*"we can do another phase right
after this one, if this one becomes too large"*), **not** a scope cut: nothing here is dropped,
deferred to v2, or made optional.

Why these five and not others: they are exactly the requirements that **cannot be satisfied
offline**. MT5-06/07/08 need a founder at the MT5 terminal on a trading day with the live funded
account; MT5-09/10 can only run once that comparison has produced numbers. MT5-10 is additionally
**uncapped by founder decision**, so bundling it with the reachability work made the combined
phase unsizeable rather than merely large. The dependency across the cut is one-directional —
142.2 makes MT5 reachable, 142.3 proves it correct.

⛔ **142.2 closing is not "MT5 is done."** It means MT5 is *reachable*. v1.15's failure mode was
shipping 6/6 green with both open items intact; these five are the items. Do not archive the
milestone or advertise MT5 until 142.3 passes.

- [ ] **MT5-06** *(measure-first)*: The MT5 server-UTC offset is **measured live and asserted on**,
  not assumed. The gateway's server time is read against UTC at connect and the observed offset is
  persisted (`139-VERIFICATION.md:12` names `MT5_SOAK_SERVER_OFFSET_MIN` as the intended carrier);
  a **near-midnight deal** becomes an explicit regression test — a deal within the offset window of
  midnight must land on the day the terminal shows. MT5 brokers stamp deals in broker-server time
  (commonly UTC+2/+3, DST-shifting) while dailies bucket by UTC date. ⚠️ This is the one failure the
  MT5-07 oracle **cannot see unaided**: a wrong offset leaves period totals reconciling perfectly
  while the daily series is shifted, corrupting Sharpe, max drawdown and every risk metric derived
  from it. Hardcoding the broker's offset is not acceptable — it breaks at the next DST transition
  and is wrong for every other broker.
- [ ] **MT5-07**: Rendered performance is verified against an **external** oracle — the MT5
  terminal's own equity and balance figures, or the broker statement, over a fixed window, matching
  within a stated tolerance. ⛔ Internal consistency (dailies compound to displayed equity, backbone
  agrees with UI) does **not** satisfy this: that is the self-referential oracle shape that let
  three money bugs survive six review passes. `analytics-service/services/broker_dailies.py` already claims `account_info()
  .equity` is authoritative (`combine_mt5_deal_ledger`'s docstring — "``account_info().equity`` is ALWAYS authoritative" :604; `def combine_mt5_deal_ledger(` :545); this tests the claim.
- [ ] **MT5-08**: Verification runs against the **live funded account** on a **trading day** — real
  fills, fees, swap charges and equity, via the read-only investor password. A demo account does
  not satisfy this (synthetic fills/swaps, artificial starting balance exercising different anchor
  logic), nor does reusing the v1.15 soak account (it shipped green with both open items intact, so
  it has already demonstrated it does not catch these). A weekend run proves nothing.
- [ ] **MT5-09**: Every surface that renders strategy performance shows the same, correct MT5
  numbers — strategy detail, public factsheet, scenario composer, portfolio PDF, browse. The
  architecture says these agree by construction (`analytics-service/services/job_worker.py` — the
  `# 5. #5 collapse (D4): asset_class is THE annualization clock selector` block :6163-6172, whose
  `periods_per_year = periods_per_year_for_asset_class(` is :6170, via shared
  `strategies.asset_class`), and MT5's annualization clock is already correct
  (`src/app/api/strategies/create-with-key/route.ts` stamps `asset_class: isCryptoExchange(exchange) ? "crypto" : "traditional",` :514;
  `src/app/api/strategies/finalize-wizard/route.ts` says "stamp `traditional` for mt5 (forex/CFD)" :829; `portfolio-stats
  .ts` **defaults** to 252, so a caller that forgets the basis still lands on MT5's right clock —
  crypto is the fragile direction, not MT5). This requirement exists to **test that invariant, not
  assume it**: the backbone-bypass surfaces logged in `TODOS.md` — `_compute_portfolio_analytics`
  (`analytics-service/routers/portfolio.py` — `async def _compute_portfolio_analytics(` :628), `equity_reconstruction.py`, and the bespoke TS
  stacks `portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts` — **re-derive**
  metrics rather than reading them, and are the one place it could be false. One daily series
  checked five ways; a divergence is a finding.
- [ ] **MT5-10** *(uncapped by founder decision)*: Any discrepancy MT5-07/09 surfaces is **fixed
  within this phase**, wherever its root cause lives — including in shared backbone money-math
  affecting every venue. A bounded alternative (split shared-cause fixes into their own phase) was
  offered and **declined**, so the planner must size for the unbounded case rather than treat it as
  an escape hatch. The phase does not close while the terminal and the UI disagree: a known-wrong
  number rendered to users is worse than an unfinished phase.

- [ ] **MT5-13** *(found by the MT5-05 live run, 2026-08-04 — BLOCKS a clean MT5-05 pass)*: **A venue
  with no API-scope concept never renders a failed scope probe.** The MT5 success screen shows
  `PROBE_FAILED: Could not check key scopes. Try again.` in red, with copy blaming the venue
  ("This is a problem at the venue — try again shortly"). It is **deterministic, not flaky**: the
  probe handler (`analytics-service/routers/internal.py` — `@router.post("/keys/{key_id}/permissions")` :184 / `async def get_key_permissions(` :185, running to EOF :564) contains **zero `mt5` references**
  and its own docstring names step 5 as *"Open a CCXT exchange + call `detect_permissions`"*. MT5 is
  not a ccxt venue and a login / investor-password / server triple **has no scopes to detect**, so
  `detect_permissions` throws → 424 `EXCHANGE_PROBE_FAILED` → `src/lib/wizardErrors.ts` maps it to
  `KEY_PROBE_FAILED` (`VENUE_WIRE_CODE_TO_VERDICT` :1795, its `["PROBE_FAILED", { code: "KEY_PROBE_FAILED", status: 503 }],` row :1802; cascade fallback :2104). Every MT5 key hits it, every time.
  **Why this blocks MT5-05:** that requirement's wording is "without needing to know an internal
  error code", and a literal `PROBE_FAILED:` string on the success screen is exactly that. The
  "try again" advice is also unwinnable — retrying can never succeed.
  ⛔ **NOT a security hole, and the fix must not be sold as one.** Read-only IS enforced for MT5, by
  a different and appropriate mechanism: `_validate_mt5_key` (`analytics-service/routers/exchange.py` — `async def _validate_mt5_key(` :222; ⚠️ `routers/`, not `services/exchange.py`), built as
  the fail-CLOSED clone of the sFOX validator, probes with `client.order_check(mt5_probe_request())`
  and rejects any credential that can trade. Verified 2026-08-04. The defect is the *badge*, not the
  enforcement.
  **Shape:** follow the D-03 precedent set by `passphraseSecret` — a per-venue capability flag whose
  DEFAULT preserves today's behaviour, so every ccxt venue stays byte-identical and MT5 opts out. MT5
  renders an explanatory line (investor passwords are read-only by design), never a failed probe.

- [x] **MT5-14** *(found by the MT5-05 live run, 2026-08-04)*: An MT5 strategy can declare **MT5** as
  its supported exchange in the wizard metadata step, and the venue is **preselected from the key the
  founder already connected** rather than asked again.
  ⛔ **SEVERITY CORRECTED 2026-08-04 — this was mis-filed as cosmetic and it is a HARD BLOCKER.**
  The same ccxt-only probe is called by `finalize-wizard` on EVERY submit as a scope-broadening
  defence. ⚠️ **Line numbers re-derived from source 2026-08-08** (the previous set — `:175`,
  `:194`, `:519` — had drifted; phases 150–152 moved this file). In
  `src/app/api/strategies/finalize-wizard/route.ts`: the probe fetch of
  `/internal/keys/{id}/permissions?force_refresh=true` at **:220**, the `if (!res.ok)` throw at
  **:237**, and the catch mapping to `KEY_NETWORK_TIMEOUT` at **:617** and **:628**. For MT5 the
  probe throws `Unsupported exchange: mt5` (confirmed in Sentry 2026-08-04T11:53:52 on
  `GET /api/keys/6d36dd92-…/permissions`), so a PERMANENT venue-unsupported condition is
  reported to the user as a temporary network blip that says "try again" — the founder clicked Retry
  **five times** against a failure that can never succeed.
  **Consequence: an MT5 strategy cannot be submitted AT ALL.** MT5 reaching the wizard's preview
  (v0.53.0.0) is real, but the LAST click fails in a different subsystem, so MT5 is **not usable
  end-to-end in production**. MT5-05 is not completable until this lands.
  **Two distinct fixes, both required:** (a) the probe must handle MT5 (or finalize must not demand a
  ccxt scope probe for a venue that has none — read-only is already proven by `_validate_mt5_key`);
  (b) the catch-all mapping of any probe failure to `KEY_NETWORK_TIMEOUT` must stop — a permanent
  unsupported-venue error must never render as a retryable timeout.
  **Observed (the badge, same root cause):** the "Supported exchanges" chips render Binance / OKX / Bybit / Deribit / sFOX — no MT5
  — on a strategy whose only key IS MT5. The founder must either mis-declare the venue or leave it blank.
  ⛔ **This is NOT the MT5-11 drift class — do not "fix the stale list".** It is DELIBERATE:
  `src/lib/closed-sets.ts:119-122` (the docblock above `export const MT5_UI_ENABLED` :124) states *"mt5 stays OUT of UI_EXCHANGE_CODES / EXCHANGES / FUNDING_EXCHANGES
  / CRYPTO_EXCHANGES regardless of this flag — the manager-surface `<Select>` must not silently
  widen"*, citing UI-SPEC §MT5-Manager-Parity and enforced by the `closed-sets.mt5-flag` no-widening
  pin. **A test WILL go red when this changes, and that is the guard working, not a regression to
  route around.** The pin must be re-cut deliberately, with its reasoning updated, in the same commit.
  **Why the decision is now outgrown:** it was taken while MT5 could not reach the end of the wizard.
  As of v0.53.0.0 it can, so a live MT5 strategy now hits a metadata step that cannot describe it.
  **Second half, independent of the list:** the wizard already knows the connected key's exchange, so
  preselecting it removes the question entirely. Do not ship the widening without the preselect —
  widening alone just adds a sixth chip the founder still has to find.

- [ ] **MT5-15** *(raised by the MT5-05 close, 2026-08-04 — the caveat on that checkbox, given its own
  ID so it cannot be lost)*: An MT5 strategy's analytics complete **without warnings**, or the warning
  is understood and accepted in writing. **All three** MT5 strategies on PROD carry
  `computation_status='complete_with_warnings'` (`8d382aaf` Alpha Centauri, `4eab92b0` Black Swan, and
  Arctic Fox) with `computation_error = NULL`.
  ⚠️ **NOT investigated.** MT5-05 is discharged on the wizard-completion criterion it was written
  against, and this does not reopen it — but it is the reason that checkbox must not be read as "the
  MT5 numbers are audited". Establish what the warning IS before deciding whether it matters; it may
  be benign (short history, non-trading days) or it may be the same class MT5-07 exists to catch.
  ⛔ Do NOT plan MT5-07 (external-oracle verification) as closing this — MT5-07 compares rendered
  performance against the terminal; this asks why our own pipeline flagged itself.

---

### OWN — An allocator can see and use their OWN unpublished strategy (founder call 2026-08-04)

Raised during the MT5-05 live run. The allocator connecting a key is often **verifying a trading
team's performance**, not publishing their own track record — so the strategy must be fully usable
by its owner while staying invisible to everyone else. Publication stays admin-only; none of this
weakens that.

⚠️ **Scope fence — this is NOT MT5 work and must not be folded into Phase 142.3.** 142.3's job is
proving MT5 *numbers* are correct. This group is a visibility/caching feature touching the factsheet,
scenario and portfolio. Mixing them repeats the 142.2 sizing mistake the researcher caught at the
D-14 valve.

- [x] **OWN-01** *(ALREADY MET — recorded with evidence, do NOT re-implement)*: The owner's
  not-yet-published strategy is **addable to a scenario**. `/api/strategies/browse` runs through
  `withPublishedOrOwner(..., user.id)` (CONTRIB-03): the owner sees their own unpublished rows under
  their REAL name (own rows skip the codename redaction), everyone else sees `status='published'`
  only. It is picker-driven, so **nothing is auto-added** — which is the founder's stated requirement
  (adding a team's key to verify performance must not silently join the allocation).

- [x] **OWN-02**: The owner can **view the full factsheet** of their own unpublished strategy from the

  ✅ **Phase 148 (5/5 plans, VERIFICATION passed). ✅ **DELIVERED 2026-08-05.** Ticked 2026-08-14 during the v1.17 close — audit blocker **B3**: the box sat unticked with the body still reading as the original problem statement, so REQUIREMENTS.md alone said the owner factsheet had never shipped.**

  account that uploaded it. Today `src/app/factsheet/[id]/v2/page.tsx` wraps the signature probe in
  `withPublishedOnly(` (:403-409, inside the `Promise.all` that also runs `readPublicVerificationSignals`) with **no owner branch**, so the owner gets `notFound()` — the page's own
  log hint reads *"strategy may be draft / archived or RLS-hidden"* (:452). The correct primitive already
  exists and is used by browse (`withPublishedOrOwner`).
  ⛔ **THIS IS NOT A ONE-LINE SWAP, and shipping it as one would create a disclosure bug.** That
  route is **public and cached**: it builds an `unstable_cache` entry keyed on `${id}::${computedAt}`,
  and the file's own header justifies that cache as safe *because "the only fields we cache come from
  the published row."* Make the gate owner-inclusive without touching caching and an owner rendering
  their draft **populates a cache entry an anonymous visitor can then read** — the same disclosure
  class as the `strategy_analytics (*)` anon splat already in TODOS. The acceptance test is therefore
  adversarial, not happy-path: **after an owner has viewed their draft, an anon request for the same
  id must still 404.**

- [x] **OWN-03**: If the strategy is genuinely the allocator's own, it can be **added to their
  portfolio** (not only a scenario).
  ✅ **CURRENT BEHAVIOUR ESTABLISHED 2026-08-04** by the live MT5-05 run, so the "verify before
  planning" caveat is discharged: a contribution-wizard finalize lands `status='private'` and the
  **portfolio does NOT update**. Confirmed on PROD (`8d382aaf`, "Alpha Centauri", `status=private`,
  `series_completeness=ledger_complete`, metrics computed 14:19Z) and by the founder in the UI.
  ⭐ **FOUNDER CALL (2026-08-04, same run): the current behaviour is CORRECT, and the defect is the
  MISSING QUESTION — not the missing write.** Verbatim: *"my portfolio hasn't updated. Which is not
  wrong, as there was no question whether this is my own strategy with allocation, or a ready API key
  for a team to check. This needs to be in the wizard for the allocator."*
  So the deliverable is a **wizard step, not a portfolio mutation**: when an ALLOCATOR finalizes a
  contribution, ask which of the two things this is —
    (a) **my own capital, with an allocation** → offer to add it to the portfolio (still a choice, and
        it needs an allocation amount, so this is a form, not a checkbox); or
    (b) **a trading team's key I am verifying** → private strategy only, portfolio untouched, which is
        exactly what ships today.
  ⛔ **(b) MUST remain the default and MUST stay a no-op.** Auto-adding on finalize is the behaviour
  the founder has now refused TWICE (see OWN-01, where the same reasoning made picker-driven scenario
  adds correct): a key connected purely to check someone else's numbers must never silently join the
  allocator's book. The gap is that the product never ASKS, so the honest branch is unreachable.
  ⚠️ Scope note: this is the first requirement in the OWN set that WRITES. OWN-01/02/04 are read/gate
  changes; this one creates a portfolio position from wizard state, so it needs its own money-path
  review (weights, allocation basis, and what happens when the same strategy is added twice).
  ⭐ **FOUNDER MODEL REFINEMENT (2026-08-05, evening — SUPERSEDES the 2026-08-04 finalize-form
  reading above where they differ):** the question and the allocation are TWO SEPARATE STEPS.
  Verbatim: *"When an allocator adds a key, they have to be asked, whether that is a key with their
  own capital in it, or a trading team's key that they want to verify. If it is their own capital,
  it gets marked, and then in holdings tab it can be added to the allocation. A trading team's key
  can never move into allocation, as an allocator cannot put money into the trading team's
  account."* So:
    (1) The wizard (key-add/categorization step) asks the question and stores a persistent
        OWNERSHIP MARK (own-capital vs team-review) — no amount, no position write in the wizard.
    (2) The HOLDINGS tab is where a marked own-capital strategy gets ADDED to the allocation
        (explicit action + amount — the money-path review applies HERE).
    (3) ⛔ HARD INVARIANT, not a default: a team-review-marked strategy is NEVER allocatable — no
        code path may create a position from it (an allocator cannot put money into a trading
        team's account). Structural exclusion, assert it like the visibility gates.
    (4) Retro path: existing own strategies (Black Swan et al., finalized before the question
        existed) need the mark to be settable so they become allocatable from Holdings.
  Discuss-phase may still confirm a wizard-side shortcut ("mark now, allocate here too?") but the
  canonical allocation surface is Holdings.
  ⭐ **FOUNDER DIRECTION (2026-08-05 dogfooding, screenshots on record): the categorization/profile
  step is CULLED TO ESSENTIALS in the same pass.** Verbatim: *"there should be a question in the
  categorization, whether the strategy is an allocators own strategy with capital or a key from a
  trading team for review (but just with crisper text). We should also get rid of most questions
  for now. Like AUM, size of strategy, type of strategy etc. I hate this page, so it should really
  just have essentials, especially for the allocator."* So: (1) the capital-vs-review question gets
  crisp copy and lives IN the categorization step; (2) AUM / strategy-size / strategy-type and
  similar non-essential profile questions are REMOVED (or collapsed behind an optional disclosure)
  for now — exact cull list is a discuss-phase decision with the founder's bias being aggressive
  removal. ⚠️ Check what downstream panels consume the culled answers (factsheet fields, discovery
  filters) — removing a question must not break a consumer; hide the panel per no-invented-data
  rather than fabricate.

- [x] **OWN-04**: The wizard preview links to the full factsheet **once that view exists**. Explicitly

  ✅ **Phase 148. ✅ **DELIVERED 2026-08-05** — the wizard preview links to the full factsheet, which now exists. Ticked 2026-08-14, audit blocker **B3**.**

  BLOCKED ON OWN-02: adding the link first would point every draft at a `notFound()` — the same
  dead-end class Phase 142.2 existed to delete.

- [x] **OWN-05** *(added 2026-08-05 — founder dogfooding direction)*: **An allocator can give their
  OWN private/draft strategies a proper name.** Verbatim: *"For the Allocator, he should for his own
  strategies have the ability to give strategies proper names. Like that strategy has a name, and as
  it is private, I should be able to give it its own name."* Today the wizard auto-assigns sentinel
  codenames ("Alpha Centauri", "Black Swan", "Arctic Fox") and the founder cannot tell his own MT5
  strategies apart from the key labels he knows them by (MM2/MM3 — the 2026-08-05 holdings-confusion
  incident). Scope: rename affordance for OWN rows only (owner-authz, `user_id = auth.uid()`),
  private/draft only or with a defined published-rename policy decided at discuss; surfaces that
  render the name (my-strategies ranking, Browse drawer own rows, factsheet owner lane, holdings
  alias) must show the new name coherently. ⚠️ Pseudonymity trap: the PUBLIC codename/disclosure-tier
  redaction contract (C-0112) must be untouched — renaming is an OWNER-FACING name, never a bypass of
  codename redaction on public surfaces.

---

### WIZ-CONT — Wizard continuity & credential dedup (founder call 2026-08-04, live MT5-05 run)

- [x] **WIZCONT-01**: Re-entering "add a strategy" with an existing wizard draft **continues where the
  founder left off** instead of restarting. ⚠️ **Resume is NOT missing — do not rebuild it.**
  `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — `const [step, setStep] = useState<WizardStepKey>(() => {` :187-191 — already resumes to `sync_preview` when `initialDraft` is present, and the
  server query in `src/app/(dashboard)/strategies/new/wizard/page.tsx` (`const { data: draft } = await supabase` :79 … `.maybeSingle();` :89) correctly finds the row (verified on PROD: the live draft carries
  `source='wizard'`, `status='draft'`, so it IS matched). The restart is therefore attributable to the
  **entry point BEFORE the wizard** — but **not** the one named here originally *(corrected
  2026-08-12 by Phase 154 observation — the earlier "branch chooser" diagnosis was inferred from
  stale code, per this requirement's own demand to establish the entry path by observation first)*.
  Observed at HEAD: `src/app/(dashboard)/strategies/new/page.tsx` is a **pure `redirect()`** (32 lines,
  forwarding `?source=csv` straight to `/strategies/new/wizard`) — it chooses nothing and re-asks
  nothing. The draft-blind entry point was **`ContributionWizardOverlay.tsx:146`**, which hardcoded
  `initialDraft={null}` (the explicit Phase 110 deferral) and is the surface reached from
  `+ Strategy` (allocations / scenario) and the My Strategies empty state. Fix the overlay's draft
  awareness, not the state machine and not `/strategies/new`.
  ✅ **DELIVERED (Phase 154, plan 05)** — the overlay is draft-aware: it defers mounting the wizard
  until the draft query has answered, so it can no longer mount a `null` draft and race the answer,
  and a resume banner in `WizardClient` tells the user they were returned to where they left off.
  The CSV short-circuit is pinned by an explicit truth table rather than inferred, and an e2e spec
  (`e2e/wizard-resume.spec.ts`) covers the path.
  ⚠️ **The diagnosis above named ONE overlay renderer; there are five.** `DashboardChrome.tsx:78` is
  a consumer that neither this entry, PATTERNS.md, nor RESEARCH.md listed, and it was caught only by
  a failing test after 154-05 landed. Treat "the entry point" as a call-site CLASS, not a line
  number, if this surface is touched again.
  ⚠️ **Unverified at close**: the Playwright spec is authored and wired into `ci.yml` but has not been
  observed green, and no browser pass has been run against the resume banner. Founder confirmation of
  the landing step is outstanding — see `154-VERIFICATION.md` (status `human_needed`).

- [x] **WIZCONT-02** *(NARROW — was mis-recorded as a data-integrity hole; corrected 2026-08-04 by
  live observation)*: Re-connecting the same credentials from a context that has **lost the wizard
  session token** must not create a second strategy + second `api_keys` row.
  ✅ **The common case is ALREADY SAFE, and an earlier draft of this requirement got it wrong.** I
  predicted that navigating away and re-entering the wizard would duplicate; the founder re-ran it on
  PROD and **no duplicate was created**. Mechanism, verified: `wizard_session_id` is a client
  idempotency token held in **localStorage**, "regenerated only on an explicit draft delete" — so it
  SURVIVES navigation. The re-run matched the fence at `src/app/api/strategies/create-with-key/route.ts` — the idempotency-fence `const { data: existingDraft, error: existingDraftErr } = await supabase` :263, `.eq("wizard_session_id", wizard_session_id)` :267 — and returned the
  existing draft **before** the Railway validate + encrypt (observable as the run being much faster).
  A DB backstop also exists on PROD: `strategies_user_wizard_session_source_uniq`
  — `UNIQUE (user_id, wizard_session_id, source) WHERE wizard_session_id IS NOT NULL`.
  ⚠️ **Residual gap, genuinely narrower:** the fence and the unique index are both keyed on
  `wizard_session_id`, so they cannot match when that token is gone — a different browser/profile, a
  cleared localStorage, or an incognito window. In that path nothing refuses a duplicate, because
  `public.api_keys` has **no unique constraint beyond the primary key** (confirmed on PROD).
  ⚠️ **A quick UNIQUE index is not the fix.** Credentials are stored ENCRYPTED (`api_key_encrypted`,
  per-row `dek_encrypted` + `nonce`), so uniqueness on ciphertext dedups nothing — two encryptions of
  the same secret differ. Identity must come from a stable non-secret value (e.g. the venue's own
  account id returned at validation), which differs per venue and does not exist everywhere today.
  ⛔ **Fail toward the EXISTING row, never a silent overwrite**: re-connecting must not clobber a key
  whose `strategy_keys` membership and synced history other strategies depend on.
  **Priority: LOW** relative to WIZCONT-01 — it needs a lost token, not ordinary navigation.
  ✅ **DELIVERED (Phase 154, plans 03 + 06)** as "one fence, two keys": `api_keys.venue_account_id`
  + the LIVE-scoped partial UNIQUE `api_keys_user_exchange_venue_account_uniq`
  (`WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL`) at the DB layer;
  at the app layer a second fence key in `create-with-key` that resolves a token-less re-connect
  onto the EXISTING (strategy, key) pair read-only, plus constraint-name discrimination on the
  23505 arms of BOTH wizard-write routes. One neutral line tells the user what happened.
  ⚠️ **Residual (2026-08-12, Phase 154): only MT5 exposes a venue-confirmed stable non-secret
  account id at validation** (`ValidationResult` in
  `analytics-service/services/ingestion/adapter.py:98-123` carries no account-identity field for
  ccxt venues). Token-less re-connect dedup is live for **MT5 only**; ccxt venues and pre-existing
  `api_keys` rows (backfilled NULL) remain undeduplicable until a venue identity exists. Deferred
  by CONTEXT.md decision — cross-venue identity is explicitly out of scope.
  ⚠️ **Second residual, recorded 154-06: the stamped value is "what the server passed", not "what
  the venue confirmed".** `authenticated` holds EXECUTE on the SECURITY DEFINER
  `create_wizard_strategy`, which stamps `p_venue_account_id` **without validation**, so a caller
  who WANTS a duplicate can still mint one by varying that parameter — exactly as it already can by
  varying `p_wizard_session_id`. The scrub trigger closes the direct-table-INSERT path, not the RPC
  path. This raises the floor for the ACCIDENTAL re-connect the requirement is about and **is not an
  anti-forgery control**. Same CR-01 class as `p_exchange`; owned by **Phase 156
  (CONNECT-REFACTOR)**, which moves the `api_keys` INSERT behind a service-role writer and withdraws
  `authenticated` EXECUTE from both wizard RPCs.
  ⚠️ **Third residual, found during 154-06 execution: the app fence reads `venue_account_id` through
  the service-role client, because it structurally cannot read it any other way.** The column is not
  on the `api_keys` SELECT allowlist (20260410225608 + its three extensions), and PostgreSQL requires
  SELECT privilege on every column a query *references* — a `WHERE` filter included — so the
  user-scoped client answers 42501 on that read, always. The read is owner-filtered
  (`.eq("user_id", …)` is load-bearing under a bypassed RLS) and fetches one `id`; it mirrors
  `finalize-wizard/route.ts:1223`, which reads the sibling non-allowlisted `attested_venue` the same
  way (153.6-04). Phase 156 absorbs it when the whole INSERT moves behind the service-role writer.

### WIZFORM — Form errors belong on the form (founder call 2026-08-04, verbatim)

> "It should not error on any input from the strategy description page. And if it errors, the error
> should be shown on that page next to the wrong answer, highlighting the box in which the answer
> belongs in red."

- [x] **WIZFORM-01** *(BLOCKING UX — cost the founder 3 failed submits during the MT5-05 run)*: A
  field the user can get wrong is validated **on the form, inline, next to that field**, with the
  offending input highlighted — never as a terminal page-level error after submit.
  **Observed:** a 2-character description passed the metadata step, then failed at submit as a
  full-page red envelope. The founder could not tell which field was wrong, so they changed the
  **supported-exchanges chips twice** (adding sFOX, which is factually wrong for an MT5 account)
  chasing an error that was actually about the description. **A misleading error does not just cost a
  retry — it sends people to corrupt unrelated fields.**
  The server already knows the answer: `src/app/api/strategies/finalize-wizard/route.ts` — inside
  `function validatePayload(` (:337), the `description.length < 10` arm (:389) returns the exact string
  `{ error: "description must be 10-5000 characters" }` at :395. The user never sees it (see WIZFORM-02). The client
  knows the rule too and could refuse at the field.

- [x] **WIZFORM-02** *(the same UNKNOWN class Phase 142.2 was supposed to delete)*: No wizard failure
  renders as `code: UNKNOWN` / "We could not classify this failure" when the server DID classify it.
  **Root cause:** `finalize-wizard`'s `validatePayload` returns bare `{ error: "..." }` with **no
  `code` field**. ⚠️ **Line numbers re-derived from source 2026-08-08** (the previous set —
  `:345` plus `:298/:324/:333/:355/:381/:392/:427` — had drifted; phases 150–152 moved this file).
  Anchor on the SYMBOL: `function validatePayload(` at `src/app/api/strategies/finalize-wizard/route.ts:337`.
  All NINE of its 400 arms are code-less: `:347` ("Invalid request body"), `:374`, `:383`,
  `:396` ("description must be 10-5000 characters" — the arm that cost the founder 3 submits),
  `:405`, `:428`, `:439`, `:474`, `:503`. And the
  client collapses any code-less or unmapped response to `UNKNOWN`.
  ⚠️ **Phase 142.2 plan 07 split 24 rejection sites onto honest codes and MISSED this validator** —
  so the defect class we shipped a fix for on 2026-08-04 was still reachable the same afternoon.
  Whatever sweep closes this must be driven from the emitting sites, not from a hand-listed set.
  ⚠️ **A prior investigation logged this exact route + shape** (`wizard-finalize-codeless-400-unknown`,
  recorded 2026-07-08 as fixed by making description optional). The 10-char minimum is still enforced
  at `description.length < 10 ||` (`src/app/api/strategies/finalize-wizard/route.ts:389`, the arm whose 400 is `:396` above — this one coordinate was missed by the 2026-08-08 re-derivation), so that fix was narrower than recorded or has regressed. Treat the stored learning as
  STALE and re-derive from source.
  ⚠️ **SECOND LIVE INSTANCE (founder-hit 2026-08-05):** the validate-key client rosters
  `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) / `KNOWN_ADD_KEY_CODES`
  (`MultiKeyConnectStep.tsx`) are missing `SERVICE_UNREACHABLE`, `KEY_MISSING_READ_SCOPE`,
  `KEY_PERMISSION_DENIED` → the server's honest verdict is downgraded to `UNKNOWN` client-side,
  invisible to Sentry. The derived-sweep MUST cover these rosters too. A 3-member stopgap may land
  earlier via hotfix; the class fix stays here. See ROADMAP Phase 153 SC2. (Diagnosis 2026-08-05: nothing was persisted server-side; the failure is strictly pre-encrypt/pre-RPC.)

- [x] **WIZFORM-04** *(founder, verbatim: "clicking twice is not acceptable, especially with this
  mistake message. A user would just not know what to do")*: A **transient infrastructure** failure
  never becomes a user decision. Submit absorbs it — bounded automatic retry with backoff — and only
  surfaces an error once retries are genuinely exhausted, then with copy naming an action the user
  can actually take.
  **Observed:** submit returned `KEY_NETWORK_TIMEOUT` and required a manual **Retry** click. The
  founder knew to click it; a real allocator sees "We could not reach the exchange … switch to a
  different exchange" on a **forex account they own**, and stops.
  ⛔ **The fix is NOT "add a retry loop" — that papers over the real question.**
  `finalize-wizard` crosses a Railway seam on **EVERY submit** to re-validate key permissions, for a
  key that was validated minutes earlier and has already synced 136 daily rows. MT5 serialises every
  gateway call through ONE lock, so that re-validation is the most contended call in the flow and the
  timeout is a **self-inflicted** dependency at the worst moment — the last click of the funnel.
  **Ask first whether the call is needed at all** (a recent successful validation + a live synced
  series is already evidence), and only then discuss retry.
  ⚠️ Anything added here must respect the existing seam-budget contract
  (`src/lib/seam-budgets.invariant.test.ts` recomputes it) — a naive retry multiplies the budget this
  route is explicitly capped on, and there is a circuit breaker (`breaker:railway`) the retries would
  feed. Retrying into an open breaker is how one slow venue takes down every other user's submits.

- [x] **WIZFORM-05** *(added 2026-08-05 — founder-hit the same day; previously unowned)*: **The MT5
  validate-key DEADLINE INVERSION is reconciled: an MT5 key validation's honest verdict always
  arrives inside the budget the client grants the request.** Today it structurally cannot:
  `SEAM_ROUTE_BUDGETS["validate-key"].timeoutMs` is 30s (`src/lib/resilient-fetch.ts:537-538`,
  verified 2026-08-08) while the analytics-service applies `_MT5_PROBE_TIMEOUT_S` (35s)
  SEPARATELY to three stages of `_validate_mt5_key`
  (`analytics-service/routers/exchange.py` — constant defined :62, applied :328 / :380 / :456;
  `_validate_mt5_key` itself at :222. ⚠️ **`routers/`, not `services/exchange.py` — both files
  exist and only `routers/` has this symbol**) — a slow MT5 broker login legitimately takes
  35–70s+ to fail, so the server's classified verdict lands after the client has already abandoned
  the request (founder-observed: two 502s at exactly 30s, downgraded to `UNKNOWN` by the WIZFORM-02
  roster gap). ccxt venues answer fast; only MT5 bites.
  **Fix shape is a decision, not a mandate:** venue-aware client budget for the MT5 arm, OR a
  bounded end-to-end Python probe deadline — respecting the seam-budget contract
  (`seam-budgets.invariant.test.ts` recomputes per-request sums with `encrypt-key`) either way.
  ⚠️ Distinct from WIZFORM-04 (submit-path retry semantics): this is the validate step's budget
  arithmetic, not retry policy. (Incident correlation `wizard:0320530a-76d9-4dc0-9b69-f59d5445ad24`;
  Vercel/Railway logs 2026-08-05 14:47–14:51 UTC; the mt5-gateway was UP throughout — not an outage.)

- [x] **WIZFORM-03**: Venue-shaped error copy must not be shown for venues it cannot apply to. The

  ✅ **DELIVERED. Ticked 2026-08-14 during the v1.17 close — audit blocker B4, where the
  DISPOSITION ITSELF was the defect: the rollup asserted the connect steps "still pass neither",
  and that sentence was FALSE at HEAD. Measured before ticking: `ConnectKeyStep.tsx:1082-1089`
  and `MultiKeyConnectStep.tsx:1847-1854` each pass `surface: "connect"` AND `venue`;
  `SubmitStep.tsx:690` passes `surface: "submit"` and its venue. The class is exactly THREE codes
  — `KEY_PROBE_FAILED` (:923), `KEY_RATE_LIMIT` (:1150), `KEY_NETWORK_TIMEOUT` (:1172) — the only
  entries carrying `REQUIRES_SUBSTITUTABLE_VENUE` / `REQUIRES_NON_SUBSTITUTABLE_VENUE`, and every
  wizard-copy call site in `src/` passes a venue (verified by enumerating them, not by sampling).
  ⚠️ `153-VERIFICATION.md` W-153-4 caught this staleness on 2026-08-13 and it went unactioned for
  a day — a requirement can be blocked by a sentence about the code rather than by the code.**

  MT5 submit timeout advises *"switch to a different exchange"* — impossible advice when the account
  IS the venue. Same unwinnable-remedy class as MT5-13 and the deleted "0 trades" message.
  ℹ️ The timeout itself is expected under load, not a defect: `finalize-wizard` crosses a Railway seam
  on EVERY submit to re-check permissions, and MT5 serialises through a single gateway lock.

### WIZFORM-ABANDON — Work that outlives its timeout (minted at Phase 153.5 planning, 2026-08-11)

> ⚠️ **Recorded here late.** These three IDs were minted in `ROADMAP.md` when Phase 153.5 was planned
> (2026-08-11) from the three findings Phase 153.3's `/code-review high` deliberately deferred, and
> all five plans declared them — but no canonical row existed until this entry, so the requirements
> matrix read the phase as satisfying nothing (warning `W-153.5-1`). The behaviour was implemented
> and verified; what was missing is the record.
> **Phase goal these three share:** no `asyncio.to_thread` work can keep touching the MT5 terminal
> after its `wait_for` fired and its caller released the lease. ONE defect with three faces — fixed
> at the SINK, not at three call sites.

- [x] **ABANDON-05** *(finding #5 — this repairs the safety argument D-35 already rests on)*: The one
  surviving `mt5.shutdown()` never fires under a terminal it no longer holds. `_mt5_bounded_restart`
  abandons its work at the ~10s bound, and the abandoned thread can reach `Mt5Client.restart()`'s
  `stale.shutdown()` — the deliberate heal of a wedged pipe (MT5CONC-01), and since D-35 the ONLY
  teardown left in the client — **after** the lease released, i.e. under the next holder.
  **Why load-bearing beyond its own finding:** D-35 removed `shutdown()` from `close()` and TODOS
  records the survivor as safe *"because every call site holds the terminal lease."* Finding #5 is
  precisely the case where that premise is false.
  Anchor: `services/mt5_concurrency.py` › `_mt5_bounded_restart` — the
  `wait_for(to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S)`.

- [x] **ABANDON-06** *(findings #6a/#6b — one mechanism, two sites; the leak the Pitfall-6 `finally`
  structurally cannot see)*: A connect-stage timeout never orphans an `Mt5Client` that the abandoned
  thread then constructs — no rpyc session leaks.
  **Observed:** `routers/exchange.py` › `_validate_mt5_key_probe` › `_connect_and_probe`, **STAGE 1 —
  connect**, the `wait_for(to_thread(lambda: Mt5Client(...)))`: on this path `client` is still `None`
  when the Pitfall-6 `if client is not None:` release runs, so the `finally` releases **nothing** and
  the session the thread later opens has no owner. Same mechanism on the worker path at
  `services/ingestion/mt5.py` › `Mt5Adapter.validate`, whose connect sits deliberately outside the
  close-`finally` (its own comment: *"there is no client to close yet"*).

- [x] **ABANDON-07** *(finding #7 — D-29's serialization on the timeout path)*: When the ONE
  end-to-end probe deadline (D-03) fires, the abandoned probe stops touching the terminal. Today
  `except asyncio.TimeoutError` sets `trace.outcome = "deadline_exceeded"` and raises 424 **while
  `_connect_and_probe`'s inner threads keep issuing rpyc calls**, so D-29's terminal serialization
  does not hold on the timeout path — the next holder shares its terminal with a thread nobody is
  waiting for.
  Anchor: `routers/exchange.py` › `_validate_mt5_key_probe` — the
  `wait_for(_connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S)`.

⛔ **Two limits are ACCEPTED, not closed, by the phase that satisfies these three.** Read them WITH
the matrix rows below, never separately — the phase states both in code precisely so the good news
cannot be taken without the caveat:

1. **D-43 — the fence cannot un-send a call already dispatched on the wire.** Verified against the
   pinned rpyc 5.2.3 wheel: `sync_request_timeout` is a purely *client-side* TTL on
   `AsyncResult.wait()` and nothing cancels the remote handler, so an in-flight call completes
   server-side. If the zombie had already dispatched `stale.shutdown()` when the lease released, the
   pipe still dies for the next holder; `_assert_expected_login`'s detection bracket therefore stays.
   Stated at three source sites (`services/mt5_client.py`, `services/mt5_concurrency.py`, the header
   of `tests/test_mt5_abandon_fence.py`).
2. **The construction window is NARROWED, not closed.** A construction that COMPLETES inside the
   window between the `wait_for` firing and the lease's bump passes both the pre- and the
   post-connect check and still leaks ONE socket, because nobody is left to receive the client. The
   window is bounded by the caller's unwind, and no sink-side mechanism can do better without the
   caller-side holder RESEARCH §Open Q-1 ruled out. Stated at `routers/exchange.py` — *"One window is
   narrowed, not closed (D-43)"* — directly beneath the paragraph that says the leak is closed.

### PARITY — the fixes that only landed on one path (minted at Phase 153.6 planning, 2026-08-11)

> Source: `/code-review xhigh` over the whole 153→153.5 span (2026-08-11, 40 agents, 29 verified
> findings → 13 distinct defects). Nine land here as five clusters. Three of the four root causes are
> the SAME failure: a correct fix applied to one path while its twin went untouched, with no guard
> asserting the two agree — the instance-not-class mistake, found inside the span whose own charter
> said "fix it at the SINK, not three times". Every requirement below therefore demands the CLASS
> closure ("what makes the two paths unable to diverge again"), never N point patches.
> Minted AT planning (not after) so the requirements matrix never reads this phase as satisfying
> nothing — the W-153.5-1 lesson, recorded verbatim at the WIZFORM-ABANDON header above.

- [x] **PARITY-01** *(cluster A — adapter parity; 3 findings, ONE cause)*: `services/ingestion/mt5.py`
  carries every fix `routers/exchange.py` received in Phase 153.3 — **by construction, not by copy**.
  The probe body (A1 terminal short-circuit that stops `order_check` on an `undetermined` verdict;
  A2 class-only broad `except` around netref materialization — exception TEXT is a
  credential-disclosure surface, T-134-01; A3 the operator-fault arm classifying
  `("permanent", <curated>)` instead of a bare retried-forever `RuntimeError`) lives in ONE shared
  module (`services/mt5_probe.py`) that BOTH paths call, and an ast parity roster with per-file
  anti-vacuity floors reds on any hand-written second copy. ⛔ The worker never imports `routers/`
  (D-07); the two documented divergences (lease bound, timeout chains) stay at the call sites.

- [x] **PARITY-02** *(cluster B — absorption + telemetry)*: No broad `except` sees
  `Mt5SessionAbandoned` before its dedicated arm, anywhere upstream of the D-42 classify arms:
  B1 `_read_terminal` re-raises it ahead of both sibling arms (same edit as A2 — D-14); B2 a
  stage-1 connect abandon answers 424 `NETWORK_UNAVAILABLE` (transient), never the 503 that counts
  toward `breaker:mt5-gateway` (D-15: the dedicated D-40 arm was on the WRONG `try` block, not
  mis-ordered); B3 `Mt5Client._timed` re-raises the fence type WITHOUT emitting `mt5.stage`, making
  the 153.5 §Q-4 telemetry contract structural for every stage (D-16: fix at `_timed`, never
  restructure `restart()`), so the D-32 recovery-latency population Phase 155 reads holds only real
  round-trips.

- [x] **PARITY-03** *(cluster C — the budget and the oracle that cannot see it)*:
  `connectAbortDeadlineMsFor` covers the connect routes' **failing**-state worst case on BOTH venue
  arms — 190 500 ms serialized / 100 500 ms default; the shortfall was the identical per-route
  10 500 ms (`failing_store − grace = 25 500 − 15 000`) on each arm (D-10a), so a serialized-only fix
  is this phase committing its own headline mistake. AND the oracle pins the ECONOMICS — "the browser
  is the LAST party to give up, for the route it aborts, in EVERY breaker state" — quantified over
  `BREAKER_STATES` in `seam-budgets.invariant.test.ts`, so selecting the wrong column can never again
  pass (D-11a: falsified by mutation, including the closed-column-only structural mutation).
  `158_500` appears nowhere as an oracle (the blind pin was `validate-budget.test.ts:226`, NOT the
  invariant file — D-11 CORRECTED).

- [x] **PARITY-04** *(cluster D — the venue lock is bypassable; SECURITY, live on PROD; ASVS V4)*:
  `finalize-wizard`'s scope-broadening probe gate reads a SERVER-attested venue and nothing else —
  `api_keys.attested_venue`, written ONLY by the two SECURITY DEFINER wizard RPCs
  (`create_wizard_strategy`, `add_wizard_composite_key`), with a SECURITY INVOKER `BEFORE INSERT`
  trigger that NULLs any client-supplied value, and NO fallback to `exchange` (NULL ⇒ PROBED, the
  fail-toward direction). DELETE + re-INSERT with a forged `exchange` becomes irrelevant rather than
  merely harder. ⛔ D-02: no new GRANT/REVOKE on `api_keys`. D-01d: the backfill pins the PROD census
  (**29 rows total / 2 mt5**, measured 2026-08-11 against `khslejtfbuezsmvmtsdn`) and its self-verify
  ABORTS on drift. D-19: both RPC re-bases on their LATEST bodies (F6 advisory-lock fence preserved);
  any `exchange` column-comment re-stamp preserves the `20260810120000` substring. ⚠️ Calibration:
  a SELF-targeted control bypass (owner dodging a probe on their own key), not a tenant leak.

  ✅ **CLOSED 2026-08-13 by Phase 156 (CONNECT-01..05), and the deferred-control threat flag is
  CLEARED.** ⚠️ The flag's literal marker string is deliberately absent from this file now — a
  repo grep for it is one of this phase's acceptance gates, so restating it even inside a closure
  sentence would keep the gate red for a reason that is the opposite of the truth (this file
  committed exactly that mistake once while being written). ⛔ **The residual's history is
  restated, not deleted** — the reasoning that
  produced remedy (b) is what a future privilege change will re-read, so it stays legible:
  153.6 could not take remedy (a) inside its own phase, shipped remedy (b) (the `CHECK` coupling
  `exchange` to `attested_venue`, which makes a forged attestation break the forger's own
  ingestion), and recorded — correctly — that this was **a property of the venue set, not a
  control**: it holds only while every probe-exempt venue is unsyncable, and sFOX joining
  `scopeProbeSupported:false` would have made the forgery free. That is what "deferred" meant, and
  it is what Phase 156 discharged.
  · **Remedy (a) as shipped:** Migration A `20260813150106_wizard_rpcs_service_role_writer.sql`
    (`GRANT EXECUTE … TO service_role`, transitional two-arm gate) + Migration B
    `20260814120000_wizard_rpcs_revoke_authenticated.sql` (`REVOKE … FROM authenticated`, both
    bodies narrowed to `auth.role() = 'service_role'` with zero `auth.uid()`).
  · **The gate PARITY-04 named is discharged:** *"Goes fully ✅ when CI observes assertion 5
    green"* — `sql-tests` ran GREEN (not grey, not cancelled) against TEST twice on 2026-08-13:
    run `31719652331` on `feat/phase-156-connect-refactor` (16:30:00→16:30:30 UTC) and run
    `31732467687` on `main` after PR #680 merged (19:01:42→19:02:17 UTC). Both carried the
    `20260811210000` marker, so the 5a–5e block ARMED rather than SKIPped.
  · ⚠️ **What that observation does NOT cover, stated so nobody reads it as more:** those runs
    executed assertion 5 as it stood at 153.6. The INVERTED 5d and the new 5f/5g/5h minted by
    plan 156-08 are **state-adaptive** — they gate on `v_revoke_live` and SKIP on a database
    that does not yet carry Migration B, which TEST does not at the time of writing. They arm
    when Migration B reaches TEST. That pending observation belongs to **CONNECT-01**, which
    records it explicitly; PARITY-04's own stated gate is met.
  · ⛔ **The ceiling is unchanged and must not drift:** the venue is the one this server observed
    a successful read-only authentication at. **Never** "the venue cannot be forged" — any server
    route holding `createAdminClient()` can still pass any uid and any venue string.
  · ⭐ **The `CHECK` was KEPT, not retired** (CONNECT-04). Remedy (b) is now a fence against a
    *future* writer letting the two columns diverge, independent of who writes.

- [x] **PARITY-05** *(cluster E — retry affordance)*: A probe parse miss (a 2xx body the schema
  cannot read — what a rolling analytics deploy produces) regains a Retry control via a NEW
  recoverable code (`KEY_SCOPE_CHECK_UNREADABLE`), while the genuinely permanent probe arm keeps
  `KEY_SCOPE_CHECK_UNAVAILABLE` with no Retry. ⛔ Never reverted to `KEY_NETWORK_TIMEOUT` (that
  sentence is the lie 153.2-04 removed); never a recoverable action added to the permanent code.
  D-18 pin inventory exact: `EXPECTED_TABLE_SIZE` 74 → 75 at BOTH sites (re-cut, never deleted);
  `EXPECTED_FINALIZE_REJECTION_SITES` STAYS 32 — that it does not move is the proof this is a fix,
  not an addition. `KNOWN_FINALIZE_CODES` gains the member in the SAME commit the route emits it.

### CONNECT — the venue the server validated is the venue the server writes (minted at Phase 156 planning, 2026-08-13)

> ✅ **CLOSED 2026-08-13.** Cleared the **PARITY-04 deferred-control threat flag** shipped live on PROD in PR #675
> (CR-01 remedy **(a)** — the connect-flow refactor both `20260810120000` and `20260811210000`
> defer). ⛔ **Two landings, not one.** Both single-migration orderings produce a total
> connect-a-key outage window (`156-RESEARCH.md` "Deploy order"), so the phase ships as
> **PR A** (service-role writer + `GRANT EXECUTE … TO service_role`, `authenticated`'s grant
> left standing) and **PR B** (`REVOKE … FROM authenticated`, merged only after PR A's route is
> verified live on PROD). **CONNECT-01 does not close until PR B.**
>
> Sub-clauses (`-01b`, `-01c`, `-02b`, `-03b`) are parts of their parent ID, not separate IDs.
> The five IDs below are the complete minted set.

- [x] **CONNECT-01** *(SC1 — the RPC door)*: A caller holding a valid session and the
  server-minted ciphertext cannot set `attested_venue` by any route — not by client INSERT
  (closed by 153.6's scrub trigger) and **not by calling either wizard RPC directly over
  PostgREST**. `authenticated` holds no `EXECUTE` on `create_wizard_strategy` or
  `add_wizard_composite_key`; the call is refused with SQLSTATE **`42501`** and **no row is
  minted**. Proven by an INVERTED assertion 5d, which today fails *if the door is shut*.
  **-01b:** the identical assertions exist for the composite twin (new 5f/5g) — 5d alone closes
  one of two identical doors. **-01c (anti-vacuity + outage guard):** `service_role` **HAS**
  `EXECUTE` on both, and a privileged call SUCCEEDS and stores `attested_venue = exchange` — a
  negative-only assertion also passes on a database where the function was dropped.
  ⛔ **Green-CI trap:** the whole 5a–5e block is gated on
  `col_description(api_keys.attested_venue) LIKE '%20260811210000%'`
  (`test_api_keys_exchange_not_user_writable.sql:242-253`). SC5 re-stamps that comment; if the
  re-stamp drops the substring the block falls to `RAISE NOTICE 'SKIP (5)'` with exit code 0.
  Any re-stamp preserves `20260811210000`, adds the new migration id, and both markers carry a
  5a-shaped positive control.

- [x] **CONNECT-02** *(SC2 — the trace)*: `attested_venue` is written from a venue **this server
  observed a successful read-only authentication at**, traced end to end. ⚠️ **The ROADMAP's
  stated trace is through the wrong route:** the wizard never touches
  `/api/keys/validate-and-encrypt`. `ConnectKeyStep.tsx:787` → `POST /api/strategies/create-with-key`
  and `MultiKeyConnectStep.tsx:1195` → `POST /api/strategies/composite/add-key`; each route runs
  `isSupportedExchange` → `validateKey(exchangeNormalized)` → `encryptKey(exchangeNormalized)` →
  the RPC inside ONE server request under `withAuth`. `/api/keys/validate-and-encrypt` is a
  **sibling** surface whose three client-INSERT consumers land `attested_venue = NULL` ⇒ PROBED
  by design — ⛔ **do not change that**, assertion 5c asserts that INSERT still SUCCEEDS.
  **-02b:** a structural CI invariant makes "the route was rewired" falsifiable — neither wizard
  RPC name may be reached from a user-scoped client in either route file.
  ⛔ **The honest ceiling, to be written and not exceeded:** "the venue is the one this server
  observed a successful read-only authentication at", **never** "the venue cannot be forged".
  Any server route holding `createAdminClient()` can still pass any uid — the standing
  `service_role` trust boundary (ADR-0001/ADR-0003).

- [x] **CONNECT-03** *(SC3 — the wizard still works, and the ownership check survives)*: The
  wizard works end to end for every venue, single-key **and** composite. ⚠️ Both RPCs need the
  user-scoped client today *because* their `auth.uid()` guards demand it; a service-role writer
  makes `auth.uid()` NULL, so the guard cannot be kept and **must not be relaxed**.
  ⛔ **Trap B (the failure this requirement exists to prevent):**
  `IF v_auth_uid IS NOT NULL AND v_auth_uid <> p_user_id THEN RAISE` is a **permanent silent
  no-op** under `service_role` — the ownership check vanishes with no error and no test failure.
  The final bodies contain **zero** occurrences of `auth.uid()`, asserted structurally from
  `pg_get_functiondef` by both the migration's post-verify and an outside canary.
  ⛔ **Trap C:** `current_user` inside a SECDEF body is the function **owner**, so a
  `current_user` role test always passes — use `auth.role()`.
  **-03b:** the ownership binding moves **entirely to the route** (`p_user_id` is `withAuth`'s
  `getUser()`-verified `user.id`, never a request-body field), which makes the route-level unit
  assertion load-bearing in a way it was not before, and makes `test_wizard_composite_fence.sql`
  Part 3b (`:167-182`) a **vacuous** green test pinning a deleted control unless it is re-cut to
  the new boundary.
  ⛔ **Pitfall 3:** `service_role` has **no** `EXECUTE` on either RPC today and is not a member
  of `authenticated` — omitting `GRANT EXECUTE … TO service_role` ships a total connect outage.
  ⛔ **Fail-closed:** a missing `SUPABASE_SERVICE_ROLE_KEY` answers `SEAM_MISCONFIGURED` at 503
  (already in the code union — no new code is minted) and **never** falls back to the
  user-scoped client; that fallback re-opens the door and makes every gate here pass vacuously.

- [x] **CONNECT-04** *(SC4 — the fence stays)*: `CHECK (attested_venue IS NULL OR attested_venue =
  exchange)` (`api_keys_attested_venue_matches_exchange`) is **KEPT**, not removed as redundant,
  and re-asserted as present **and** `convalidated` by both new migrations' post-verify. It is the
  fence that stops a *future* writer letting the two columns diverge, independent of who does the
  writing. Assertion 5e (SQLSTATE `23514` discipline) is untouched.

- [x] **CONNECT-05** *(SC5 — the prose stops under-claiming, without over-claiming)*: Every claim
  153.6 had to weaken is re-strengthened to exactly what is now true — the `attested_venue` column
  comment, both `COMMENT ON FUNCTION` texts, `finalize-wizard/route.ts:1213-1220` + its test
  docblock, `create-with-key/route.ts:772-780` and `:102-107` — and the PARITY-04
  deferred-control threat flag is cleared. ⛔ `20260811210000` §1b **cannot be edited** (applied
  migration, `migration-reviewer` invariant 11) — it is superseded by name in the new migration's
  header. ⚠️ **`venue_account_id` is RESTATED, not closed:** Phase 156 closes its *reachability*
  half ("only the server can pass it" becomes true); the value still has **no in-database oracle**
  ("the venue confirmed it" stays false). ⚠️ **IN-04 is restated accurately:** the RPCs run as
  their **owner** (`postgres`), not as `service_role`, so the scrub trigger's `service_role`
  allowlist entry is **still unused** — Phase 156 does not become its beneficiary.

**Explicitly OUT of scope** (recorded so they are not re-proposed): the `asset_class` stamp's
`apiKeyExchange` → `attestedVenue` swap (needs an oracle over √365 vs √252 this phase will not
have); `add_wizard_composite_key`'s absence from `MUTATING_RPC_NAMES` (a pre-existing
audit-coverage gap — **logged to `TODOS.md`, not fixed here**, Rule 3); `finalize_wizard_strategy`
(a third wizard RPC with `authenticated` EXECUTE that writes no `api_keys` row); any backfill or
re-attestation of existing rows (`20260811210000` WR-01 — an unbounded re-backfill retro-attests
exactly the rows the trigger deliberately scrubbed).

### STALE — No stale screens (founder call 2026-08-04: "no stale screens")

- [x] **STALE-01**: A wizard screen never shows a state the backend has already left. Two instances
  observed on PROD during the MT5-05 run: (a) the wizard sat on **"Fetching trades…"** after the job
  chain had finished at 11:39:35; (b) the gate rendered a refusal computed from a **stale analytics
  row while a re-derive was in flight**, so the user saw a failure that was already being fixed.
  ~~⚠️ **Root cause NOT yet established**~~ — **DISCHARGED 2026-08-12 (Phase 154, plan 01)** against
  PROD evidence, before any fix was planned. `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` — the docblock above `const RETRY_THRESHOLD_MS = 900_000;` (:112), lines :109-111 — states the loop "has no time-based abort (it stops only on
  success / terminal failure / 3 consecutive network errors)", which means it *should* have
  terminated at 11:39:35.
  **Mechanism verdict: M2(ii)** (`154-INVESTIGATION.md`) — the DB was terminal and the client was
  reading nothing; the zero-rows read was coerced to the domain value `"pending"` by
  `statusRow?.computation_status ?? "pending"` (`useStrategySyncPoller.ts:228-229`), so the loop
  never saw a terminal state to stop on. **M2(i), M3 and M4 were each RULED OUT by evidence**, not
  by argument — every declared child job existed and was `status='done'`, `attempts=1`,
  `last_error=null`. The cause is client-side, which is why the Python/SQL arm (plan 07) is a
  recorded NO-OP rather than a fix: a change there would have been the bandaid.
  ✅ **DELIVERED (Phase 154, plans 04 + 08)** — 04 removed the `?? "pending"` fabrication and widened
  `sync-progress` to single-key callers; 08 removed the two `isComposite` gates that had hidden the
  stall backstop and the in-flight datum from single-key users, honoured `queued: false`, and added
  the single-key repoll twin so an empty series under a terminal status repolls instead of rendering
  a refusal. Mid-re-derive the screen is amber (`role="status"`); red renders only on a CURRENT
  verdict. The four RED pins T1/T1b/T2b/T3 are green with their oracles byte-unchanged.
  ⚠️ **Unverified at close**: no browser pass on the amber state; the SQL gate
  `test_api_keys_venue_identity_uniq.sql` is authored but unrun. See `154-VERIFICATION.md`.

---

### MT5-GOAL — "MT5 works" is not "MT5 finishes the wizard" (founder reframe 2026-08-04)

⭐ **Read this before treating any MT5 checkbox as done.** MT5-05 is legitimately discharged — a
founder completed the wizard and the strategy exists with a real 136-day series. But the founder's
actual goal is broader than the requirement that was written, stated verbatim after the wizard
succeeded:

> *"The goal is that MT5 works. And at the moment, maybe it ingests the data, but I cannot use it in
> the scenario, and I can still not produce a factsheet."*

So the phase requirement measured the wizard, and the founder measures the **product**. Both readings
are defensible; the founder's is the one that decides whether MT5 ships. The gap between them is
exactly SCEN-01 (the series never reaches the scenario engine) and OWN-02 (no factsheet for an
unpublished strategy you own) — neither of which is an MT5 defect. **MT5 is the first venue to
traverse this path from a cold start, so it is exposing pre-existing holes in the surfaces AFTER
ingestion, not bugs of its own.** Every one of the findings below reproduces for non-MT5 strategies.

- [ ] **MT5-GOAL-01**: An MT5 strategy is usable end-to-end by the allocator who uploaded it: it
  ingests (done), it **projects in a scenario** (blocked by SCEN-01), and its **factsheet is
  viewable** (blocked by OWN-02). This is an umbrella acceptance requirement — it closes only when its
  three dependencies close, and it exists so "MT5-05 ✅" can never be mistaken for "MT5 works".

---

### SCEN — The scenario composer actually projects what you add (dogfood 2026-08-04)

All five found in one live founder session, composing a scenario from a just-uploaded MT5 strategy.

- [x] **SCEN-01** ⛔ **HIGHEST PRIORITY — silent money-path correctness bug, NOT MT5-specific**:

  ✅ **Phase 147 (6/6 plans, VERIFICATION passed). ✅ **DELIVERED 2026-08-05** — the scenario engine receives the real series. Ticked 2026-08-14, audit blocker **B3**. ⚠️ This one mattered most: it is the silent money-path correctness bug, and an unticked box invites someone to re-plan a fix that already shipped.**

  A strategy added to a scenario contributes its **actual return series**. Today ~4 in 10 do not, and
  fail **silently**.
  ⭐ **CENSUS CORRECTED 2026-08-04 after investigation — my first count UNDERSTATED it.** I reported
  "18 of 42 rows". The truth is worse: **`strategy_analytics.daily_returns` has NO PRODUCTION WRITER
  AT ALL.** Re-measured on PROD, split by `is_example`:

  | population | rows | `daily_returns` populated | `returns_series` populated |
  |---|---|---|---|
  | real strategies (`is_example = false`) | 27 | **0** | 18 |
  | demo seeds (`is_example = true`) | 15 | **15** | 15 |

  **Every populated row is a demo seed.** The only writers left are `scripts/seed-full-app-demo.ts:1633`
  and `e2e/helpers/seed-test-project.ts:570`. The service builds its upsert from
  `metrics_result.metrics_json` (`analytics-service/services/analytics_runner.py` — `payload.update(metrics_result.metrics_json)` :1594; and the `strategy_analytics` upsert sites in
  `analytics-service/services/job_worker.py` cited as `:5299/:2385/:4380` at `8b327594`, which are at HEAD
  `def _upsert()` :5323-5324, `def _stamp_nav_failed()` :2397-2398 and `def _mark_insufficient()` :4404-4405), and that
  dict (`analytics-service/services/metrics.py` — the `sanitize_metrics({` payload :1178-1196, `"returns_series"` :1191 … `"return_quantiles"` :1195) carries `returns_series`, `drawdown_series`, `monthly_returns`,
  `rolling_metrics`, `return_quantiles` — **never `daily_returns`**. PostgREST projects only named
  columns, so the un-named one stays NULL forever. My "18" were merely the rows that got far enough to
  have a `returns_series`; the real figure is **every strategy the service has ever computed**.
  ⚠️ **This is exactly why the demo universe looked fine and real strategies did not** — the seeds
  write the column the engine reads, so no amount of demo-driven testing could surface it. `src/app/api/strategies/[id]/returns/route.ts` selects **only**
  `daily_returns` — ⚠️ at HEAD that `.select(` reads `"daily_returns, returns_series, computation_status, data_quality_flags"` :254, with the reason recorded :241-242 — and that route is what the composer lazily fetches for a drawer-added strategy. So
  the engine receives an empty series and renders *"0 overlapping days"*, *"Only 0 observations"* and
  `0.00` for every metric — **with no error, no warning, no empty-state**.
  **Blast radius spans every source, so this is not an MT5 bug:** CSV published **7 of 30** (these are
  visible to ALL allocators, not just the owner), CSV pending_review 3 of 4, okx 3, mt5 3, bybit 1;
  statuses published / pending_review / private / draft.
  **The data is intact** — `csv_daily_returns` holds all 136 rows for the founder's instance
  (`4eab92b0`, 2026-03-22 → 2026-08-04). Nothing was lost; it is a plumbing gap between the producer
  and this one reader.
  ✅ **RESOLVED — the READER is wrong, decisively, and backfilling the writer would have been the
  wrong lever.** Heavy series were deliberately moved OFF `strategy_analytics` by migration 087
  (`20260428120919`, decision D-02, the 1MB TOAST ceiling), so re-populating a fat JSONB column would
  fight a settled architectural decision.
  ⚠️ **`returns_series` must NOT be forwarded raw.** It is `_drop_nonfinite(cumprod(1+returns))`
  (`analytics-service/services/metrics.py` — `_cumulative_clean = _drop_nonfinite(cumulative)` :774, `returns_series = [` :775-778) — a WEALTH INDEX, shape-identical to `DailyPoint[]` but semantically
  inverted. Verified on PROD for `4eab92b0`: it starts at exactly **1.0** (2026-03-22) and ends at
  **0.7196** (2026-08-04). Forwarding it raw would claim **+100% on day one**. It must be DIFFERENCED.
  ⭐ **The codebase had already settled this drift** — `resolveDailyReturnSeries(daily_returns,
  returns_series)` backs BOTH strategy-detail surfaces (`src/app/factsheet/[id]/v2/page.tsx` — `let dailyReturns = resolveDailyReturnSeries(dailyRaw, analytics?.returns_series);` :121, docblock :114;
  `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — `let dailyReturns = resolveDailyReturnSeries(` :65) with its own tests and a docstring naming this bug.
  Rule 7: use that resolver, do not mint a third mechanism. The composer then blends the same series
  those pages render.

- [x] **SCEN-02**: In the scenario composition list, a strategy **the allocator uploaded themselves**
  is visually distinguishable from a third-party published one.
  **Today there is no such marker anywhere** (verified in code): the added-strategy row
  (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `{draft.addedStrategies.map((a) => {` :7057 … `})}` :7447, the `<li` at :7108; `<TrustTierLabel` :7182, `<CoverageStateChip state={chipState}` :7216) renders a toggle, the name, a `TrustTierLabel` (data
  *provenance*: api_verified / csv_uploaded / self_reported / composite) and a `CoverageStateChip`
  (in-blend / manually-excluded) — none of which is ownership. The ownership bit **does exist
  server-side** and is deliberately discarded: `src/app/api/strategies/browse/route.ts` computes `const isOwnRow = r.user_id !== null && r.user_id === user.id;` (:264) purely to
  un-redact the name, and the emitted row (the `return {` object :277-311) is a named-key fence carrying only
  `id, name, codename, markets, strategy_types, is_example`.
  ⚠️ **Cost note:** surfacing it is an ADDITIVE WIRE CHANGE, not a client derivation — `AddedStrategy`
  (`src/app/(dashboard)/allocations/lib/scenario-state.ts` — `export interface AddedStrategy {` :96, fields :100-103) carries only `id, name, markets, strategy_types`, and
  that type is zod-validated AND PERSISTED (`SCENARIO_SCHEMA_VERSION = 4`), so a new field is a
  schema-version decision.

- [x] **SCEN-03**: A strategy row in the scenario is **clickable**, opening richer detail (and, once
  OWN-02 exists, the full factsheet). Today rows are **not clickable at all** — no `onClick`, no
  `href`, no drawer, no expansion (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — the added-row `<li` opens :7108 and closes :7445). The Holdings tab already has
  this affordance (`src/app/(dashboard)/allocations/components/HoldingsTable.tsx` — `import { HoldingDetail } from "./HoldingDetail";` :55, rendered `<HoldingDetail` :966), so the composer is the outlier.
  ⚠️ Partially cheap: `addedStrategyMetadataLookup` (same `ScenarioComposer.tsx` — `const addedStrategyMetadataLookup = useMemo<` :2486 … `return map;` :2542) **already holds
  `cagr` and `sharpe` in memory** for book strategies and never renders them. For drawer-added
  strategies they are null — the returns route does not return them — so a richer row is NOT uniformly
  free. ⛔ Depends on OWN-02 for the factsheet link (same dead-end trap as OWN-04).

- [x] **SCEN-04**: The numbers on a scenario row are **labelled**. Founder, looking at a live row:
  *"What do the numbers actually mean?"* The row renders `1.000`, a `LEVERAGE` toggle, `1`, and `—`
  with no column headers and no inline labels (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — the control cluster `<div className="flex items-center gap-2"` :7226: weight `<input` :7233, `renderModeToggle` :7251, leverage `<input` :7257, notional `renderNotional(a.id, a.name)` :7277). They are weight,
  mode, leverage, and notional; the last is an em-dash whenever it is non-derivable, which reads as
  "broken" rather than "not applicable".

- [x] **SCEN-05**: The strategy browser does not show **duplicate rows for the same strategy**.
  Observed live: **two identical "Alpha Centauri" entries**, indistinguishable in the list. Both are
  real, owned, `status='private'` rows (`8d382aaf`, created 2026-08-04; `081f2912`, created
  2026-07-20) — so this is not a rendering bug, it is the accumulated cost of re-running the wizard.
  Relates to WIZCONT-02 (dedup) but is distinct: WIZCONT-02 prevents creating them, this one is about
  not presenting the user with an unresolvable choice between two identical names.

---

### AUM — An allocator can size a hypothetical book (founder call 2026-08-04, verbatim)

- [x] **AUM-01** ⛔ **DESIGN FLAW, founder-stated**: The allocator can **set AUM directly**, and
  weights follow from it. Founder verbatim: *"I should be able to change AUM, and then the weight
  changes. That is it. Currently, I have only strategies that are not in my book, which consequently
  leads then to no AUM, and no computation at all. You see how silly that is?"*
  **Today AUM is derived-only and has no input anywhere.** `scenarioAum`
  (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `const scenarioAum = useMemo(() => {` `:3463-3472` at `c4bbe51e`; at HEAD Phase 151 replaced it with `const liveHoldingsSum = useMemo(` :3951 and `const scenarioAum = sanitizedManualAum ?? liveHoldingsSum;` :4010) summed **exclusively** live holdings whose scope-ref is toggled on
  (`scopeRef.startsWith("holding:")`); an added strategy contributes nothing by construction. Size is
  then `weight × scenarioAum` (`const size = weight * scenarioAum;` :4284), so "allocate $500k to this strategy" is **not expressible** —
  only "this strategy is N% of my existing book".
  **The causality is backwards for the primary use case:** evaluating a candidate you do not yet hold
  is precisely what a scenario is for, and that is the case that cannot compute a size or commit.
  ⚠️ **CORRECTION recorded so the fix is not mis-scoped:** the founder linked AUM=0 to *"no computation
  at all"*, and that link is **wrong** — verified in code. `scenarioMetrics`
  (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `const scenarioMetrics = useMemo(` :3228) depends on `engineSet, engineState, dateMapCache, blendBasis` and
  **NOT on `scenarioAum`**. Sharpe/CAGR/cumulative-return/max-DD are weight-based; AUM scales only
  dollar figures and gates the commit. **The 0.00s the founder saw were SCEN-01, not this.** Shipping
  AUM-01 alone would leave the screen showing zeros — do not let it be planned as the fix for that.

- [x] **AUM-02** ⛔ **NOT A FENCE — A CRASH. Investigated 2026-08-04, initial framing was WRONG.**
  An **MT5 account's equity can contribute to AUM**. Today it cannot, ever, and the reason is not a
  deliberate venue decision: **the holdings sync is still ccxt-only and dies on the first call.**
  **PROD smoking gun** (verified directly, twice): api_key `46293712-59e6-46c0-8204-5dd32afe2503`
  (mt5, active, not disconnected) carries `sync_status='error'` and
  `sync_error = "'Mt5Session' object has no attribute 'fetch_balance'"` — a **raw Python AttributeError
  sitting in a user-visible column**. Job `9d3f9c6e`, kind `poll_allocator_positions`, `failed_final`,
  fired by the 04:00 cron on 2026-08-04, carries the identical `last_error`.
  **Mechanism:** `_make_exchange_client` (`analytics-service/services/job_worker.py` — `def _make_exchange_client(` :976) returns an `Mt5Session` for mt5
  (`if exchange_name == "mt5": return _make_mt5_session(...)` :1001-1002), but `_fetch_spot_rows` unconditionally calls `exchange.fetch_balance()`
  (`analytics-service/services/allocator_positions.py` — `async def _fetch_spot_rows(` :418, `balance = await exchange.fetch_balance()` :434) and `_fetch_derivative_rows` (same file :515) calls ccxt `fetch_positions`
  (`analytics-service/services/positions.py` — `async def fetch_positions(` :317-343). Neither file contains the string `mt5` or `sfox` anywhere. Enqueue is
  **venue-agnostic** at both triggers (cron jobid 15 `0 4 * * *`, and the user "Sync now" RPC), so MT5
  keys ARE scheduled and DO run — they just crash. `_make_exchange_client` was widened to two
  non-ccxt venues while its holdings-sync consumer stayed ccxt-only.
  ✅ **No deliberate fence exists in this path** — checked and absent from `run_poll_allocator_positions_job`,
  `_allocator_key_preflight`, both enqueue functions, and the `allocator_holdings` DDL (`venue` is free
  TEXT). The real MT5 fences are elsewhere (`src/lib/closed-sets.ts:101-124` — the `MT5_UI_ENABLED` docblock + const; and `analytics-service/services/job_worker.py`'s `elif venue == "mt5":` branch :3455, whose kill-switch gate `if not mt5_enabled_server():` is :3487).
  ⚠️ **sFOX is the same latent bug**: `SfoxClient` exposes `get_balances()`, not `fetch_balance()`
  (`analytics-service/services/sfox_client.py` — `async def get_balances(self)` :272). Invisible only because sFOX is flag-off with no keys. Fix the CLASS.
  ⚠️ **Sizing (~1–1.5 days, medium risk), not a one-liner.** Account-level equity IS available today —
  `Mt5Client.account_info()` (`analytics-service/services/mt5_client.py` — `def account_info(self) -> dict[str, Any]:` :327-332) returns equity/balance/currency and the derive
  path already consumes it (`analytics-service/services/job_worker.py` — `_mt5_equity = float(_mt5_info["equity"])` :3717, block :3716-3718) — so ONE holdings row per MT5 account is
  reachable. But it needs: a non-ccxt venue branch; the **MT5 gateway concurrency story** (a SECOND
  job kind contending for the ONE shared Windows terminal — must reuse `_mt5_terminal_lock_for`, which
  now lives in `analytics-service/services/mt5_concurrency.py` (`_MT5_TERMINAL_LOCKS` :126, `def _mt5_terminal_lock_for(` :129-134) and is imported by `job_worker.py` :130 / used :364, the login bracket, the bounded-restart helper, the read-timeout discipline,
  and it re-raises MT5CONC-02 cross-process serialization); the `mt5_enabled_server()` kill-switch for
  parity with the derive arm; and an FX decision for non-USD account currency (no existing seam).
  ⛔ **Per-symbol MT5 holdings is a SEPARATE, larger decision**: `positions_get` is deliberately
  forbidden on the client facade by a parametrized pin (`analytics-service/tests/test_mt5_client_contract.py` — `@pytest.mark.parametrize(` :720 listing `"positions_get",` :725, `def test_read_only_surface_no_trade_methods(forbidden):` :735-739,
  exact-surface pin `def test_public_surface_is_exactly_the_contract():` :748-763, no-getattr pin `def test_no_getattr_passthrough():` :742-745). Widening it means consciously
  re-cutting a trust-integrity fence, not a quiet edit.
  💡 **Cheap interim, NOT the fix**: a ~4-line honest skip for non-ccxt venues in
  `fetch_allocator_holdings` (`analytics-service/services/allocator_positions.py` — `async def fetch_allocator_holdings(` :1076) would stop stamping a daily raw
  `AttributeError` into the user-visible `sync_error`. Ship only as an explicit interim decision — it
  papers over the gap.

- [x] **AUM-05** *(split out of AUM-02 so it cannot be lost when that item is scoped to MT5)*: **sFOX
  will crash the holdings sync the same way MT5 does, the first day a real key exists.** `SfoxClient`
  exposes `get_balances()` (`analytics-service/services/sfox_client.py` — `async def get_balances(self)` :272), not the ccxt `fetch_balance()` that
  `_fetch_spot_rows` calls unconditionally (`analytics-service/services/allocator_positions.py` — `async def _fetch_spot_rows(` :418, `balance = await exchange.fetch_balance()` :434) — so a live sFOX key will
  stamp `sync_error = "'SfoxClient' object has no attribute 'fetch_balance'"`, byte-identical in
  shape to the MT5 failure already on PROD.
  ⚠️ **Invisible today only because sFOX is flag-off with zero keys** — which is exactly why it needs
  its own line. It is not a hypothetical: the same widening that put MT5 on this path is already
  written for sFOX and simply has not been switched on. **Fix the CLASS (non-ccxt venues in the
  holdings path), not the MT5 instance**, or sFOX go-live re-runs this outage with a new venue name.
  🔗 The sFOX go-live gate is tracked separately (worker egress IPs, founder flag) — this must be
  closed BEFORE that flip, not discovered by it.

- [x] **AUM-03** ⛔ **WORSE THAN FILED — the copy names a control THAT DOES NOT EXIST.** The AUM-zero
  refusal must name an affordance the user can find. Current copy: *"Can't record a scenario commit:
  portfolio AUM is zero. Connect an exchange API key or toggle on a live holding before submitting."*
  (`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3559` at `c4bbe51e`; at HEAD that
  single literal is gone — the refusal now branches `canEnterBook ? AUM_REFUSAL_BOOK_REACHABLE : AUM_REFUSAL_NO_BOOK` :4272-4273 inside `function handleCommit()` :4253).
  **Both halves are unactionable.** The founder hit this with four venues connected and ~$460k of
  holdings, so "connect an exchange API key" is already done. And **there is no live-holding toggle
  anywhere in the composer**: the only `onToggle` call site is on ADDED STRATEGIES (`onToggle(a.id);` :7141); the
  per-key switch (`onClick={() => onTogglePerKey(k.id)}` :6878, inside `{perKeySources.map((k) => {` :6853 — ⚠️ the original cited `:5619`, which was the added row's `TrustTierLabel` even at `c4bbe51e`; the real per-key switch was `:5458` there) toggles data sources, which never enter `scenarioAum`. The component says
  so itself — *"Per-coin holdings are NOT rendered — they live on the Holdings tab (CONSTIT-03)"*
  (:6784-6785) and *"live holdings are FIXED context — they cannot be toggled off or reweighted in
  the UI"* (`function handleCommit()` :4253, comment :4254-4255). Same class as WIZFORM-03, but stronger: this instructs the user to use a
  control that was deliberately never built.

- [x] **AUM-04** ⛔ **ROOT CAUSE of the founder's AUM=0 — blank slate was FORCED, not chosen.**
  An allocator with a live book can always reach it. Today one all-or-nothing gate can hide it
  entirely, with no explanation.
  **Mechanism:** blank mode does not merely toggle holdings off, it **removes them from the draft**
  (`holdingsSummary = entryMode === "blank" ? [] : rawHoldingsSummary`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `const holdingsSummary = useMemo(` :954-957),
  so `scenarioAum` is **structurally always 0** in blank mode and the commit gate always refuses. The
  escape hatch — the "From my book" segment — renders only when
  `canEnterBook = hasLiveBook && payload.perKeyDailiesGateSatisfied` (same file :922 — ⚠️ at HEAD Phase 151
  repointed the right-hand side to `payload.bookEntryGateSatisfied ?? false`; render `{canEnterBook && (` :4480,
  arrow-key nav short-circuited `if (!canEnterBook) return;` :4475). `perKeyDailiesGateSatisfied` is **all-or-nothing over
  EVERY eligible key** (`src/lib/queries.ts` — `export function allActiveKeysHavePerKeyDailies(` :3025, eligibility `export function isPerKeyDailiesEligibleKey(key: {` :3061 = every active, non-revoked,
  non-disconnected key, fetched by bare `user_id`).
  **PROD, the founder's own account — 8 active keys:** bybit 155 per-key dailies, okx 100, **deribit ×3
  = 0**, **mt5 ×3 = 0**. One zero ⇒ gate false ⇒ `canEnterBook` false ⇒ composer force-initialised to
  blank ⇒ AUM 0, with the only remedy invisible.
  ⭐ **Two distinct defects here, and the second is the nastier:**
  (a) the gate is all-or-nothing, so a single key with no per-key series hides a $460k book. It was
      ALREADY false from the three deribit keys before MT5 existed.
  (b) **cross-role contamination**: MT5 keys are MANAGER-side (they carry `strategy_id`-keyed series —
      Arctic Fox 135, Alpha Centauri 136, Black Swan 136 — never per-key allocator dailies), yet they
      count toward the ALLOCATOR's book gate. So every MT5 strategy the founder uploads pins their own
      book gate false **permanently**. Connecting a manager key must not disable an allocator surface.

---

### NAV — The allocator can reach their own strategies (founder call 2026-08-04)

- [x] **NAV-01**: There is a way in from the sidebar to **an overview of all my strategies**, and

  ✅ **Phase 149 (5/5 plans, VERIFICATION passed). ✅ **DELIVERED 2026-08-05** — my-strategies overview at discovery parity. Ticked 2026-08-14, audit blocker **B3**. ⚠️ Carried caveat: `grep -rn "my-strategies" e2e/` returns NOTHING — this surface has no e2e coverage (audit W6). Logged to TODOS.md, not silently accepted.**

  clicking one opens its factsheet. Founder verbatim, pointing at the MY WORKSPACE nav (My Allocation
  / Recommendations / Compare / Decks / Add a Strategy): *"Here should be a button, where I click, and
  I have similar to the Crypto SMA ranking, an overview of all my strategies. And when I click on the
  strategy, I get the factsheet."*
  Restated after the scenario session, and this is the sharpest statement of the gap:
  *"Still don't know how to get to the actual factsheet of a key that I upload."*
  ⚠️ There is an **Add a Strategy** entry but no **see my strategies** entry, so the flow is
  write-only from the allocator's side. ⛔ Depends on OWN-02 — a list that links to `notFound()` is
  the dead-end class Phase 142.2 existed to delete (same trap as OWN-04).

  ⭐ **SHARPENED 2026-08-04 — "similar to the Crypto SMA ranking" means RANKING PARITY, not just a
  list.** The founder restated it precisely: *"an overview like the ranking of external strategies, a
  ranking of strategies that the allocator uploaded, so all keys he uploaded and the derived
  strategies in a ranking similar to the ranking of external strategies."* Two things this pins that a
  plain list would miss:
  - **Coverage is per-KEY, not per-published-strategy.** It must show **every key the allocator
    uploaded and the strategies derived from them** — including `private` and `draft` rows, which are
    exactly the ones every existing ranking surface filters out. The founder's own account is the
    proof case: 8 active keys (bybit, okx, deribit ×3, mt5 ×3) and several derived strategies, none of
    which appear on any ranking today.
  - **Ranking PARITY with the external/discovery ranking** — the same metric columns, the same sort
    affordances, and the same rank presentation (`#n` + percentile per DESIGN.md), so the allocator
    can judge their own uploads on the same axes they judge third-party strategies on. A bare list of
    names would technically satisfy "an overview" and would miss the point of the ask.
  ⚠️ **Reuse the existing ranking component//query rather than building a second ranking surface** —
  two ranking implementations would drift, and the founder is explicitly asking for the SAME thing
  pointed at a different row set. The only genuine difference is the visibility predicate
  (own-including-unpublished vs published-only), which is OWN-02's `withPublishedOrOwner` primitive.
  ⚠️ Metrics for `private`/`draft` rows must come from the same analytics the factsheet renders — do
  NOT invent a placeholder or a reduced column set for unpublished rows; that is the
  [[no-invented-data]] class. A row whose analytics have not computed yet shows an honest pending
  state, not zeros.

---

## v2 Requirements

Deferred to a future milestone. Tracked, not in this roadmap.

### CRON — Cron & email reliability (founder-deferred 2026-07-25)

- **CRON-01**: Match-engine cron failures are visible (a `/api/cron/health-check` route) instead of causing silent data staleness.
- **CRON-02**: Founder-LP cron cannot double-email if the lambda dies post-Resend (idempotency row on `(cron_name, year_month)`).
- **CRON-03**: Resend webhook svix-id idempotency store; email correlation-id per-batch not per-email; retry false-alarm on UNIQUE(23505) resolved.
- **CRON-04**: Founder-LP 85s worst case exceeds the 60s `maxDuration` — re-budget or chunk.

### MONEY — Money-path correctness unification (runner-up milestone, deferred)

- **MONEY-01**: `_compute_portfolio_analytics` + `equity_reconstruction.py` absorbed into the unified backbone (independent Sharpe/TWR stacks today).
- **MONEY-02**: Frontend TS bespoke annualization (`portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) + `match.py` unified.
- **MONEY-03**: quantstats price-detection sign-flip closed on the strategy-analytics path (P114 fixed only portfolio/verify).
- **MONEY-04**: Blend annualization defaults unknown-`asset_class` → crypto for the RISK basis.
- **MONEY-05**: Short-window CAGR over-annualization flagged `insufficient_window` without changing CAGR.

### OPS — Observability depth

- **OPS-01**: Circuit-breaker state/ops dashboard.
- **OPS-02**: Job-queue depth + age metrics.
- **OPS-03**: `Idempotency-Key` header support for normally-unsafe POSTs (would make teaser retry-safe — needs a Python-side dedup store + TTL, a new persistence contract).
- **OPS-04**: Adaptive/load-aware rate limiting driven by the breaker signal.

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rate-limiting the seven routes named "unlimited" in `TODOS.md` | **Already shipped** (2026-04-10 → 2026-07-23). Verified by grep + `git log -S"checkLimit"`. Re-doing it would be a no-op diff. |
| Adding fetch timeouts to the seam | **Already shipped** in both clients via `AbortSignal.timeout()`. Only the budget UNIFICATION (SEAM-02) is in scope. |
| A new circuit-breaker / retry npm dependency (`cockatiel`, `opossum`, `p-retry`) | Both breakers are in-memory-only and would still need a hand-written Redis adapter — an abstraction over logic we must write anyway. `@upstash/*` is already installed and proven. |
| Changing the in-worker per-kind watchdog (`reset_stalled_compute_jobs`) | Sound as-is; handles "job hung on a LIVE worker," a different failure mode. |
| Reaper in the worker loop or a Vercel cron | Worker loop shares the failure domain it backstops and re-exposes WEDGE-01; Vercel cron hits the plan cron-slot ceiling (a documented past cause of prod going dark). pg_cron only. |
| "Janitor also fixes the shared-test-DB fence flake" as an acceptance criterion | UNVERIFIED — the flake was root-caused to a different table/layer with a shipped WORKER-04 fix. Not inherited by inference. |
| `cron/warm-analytics` rate limiting | Cron route, service-key gated, different threat model. |
| Python-side limiters beyond `routers/match.py` | `match.py` is the only verified Python-side gap; broader defense-in-depth was not in the brief. |
| Global rate-limit middleware | Routes need different key identities (per-user / per-IP / per-user+strategy). HOF composes; middleware flattens. |
| Retrying credential writes (`validateKey`, `encryptKey`) or `flow_type: teaser` | Non-idempotent by construction. An ANTI-feature — a retry double-writes credentials or mints duplicate leads. |

---

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEAM-01 | Phase 140 | Complete |
| SEAM-02 | Phase 140 | Complete |
| SEAM-03 | Phase 140 | Complete |
| SEAM-04 | Phase 140 | Complete |
| SEAM-05 | Phase 141 | Complete |
| SEAM-06 | Phase 141 | Complete |
| JOB-01 | Phase 142 | Complete |
| JOB-02 | Phase 142 | Complete |
| JOB-03 | Phase 142 | Complete |
| JOB-04 | Phase 143 | Pending |
| JOB-05 | Phase 144 | Complete (2026-08-17, PR #688) |
| JOB-08 | Phase 144 | Complete (WON'T-FIX w/ measurement, 2026-08-17, PR #688) |
| JOB-06 | Phase 145 | Complete (2026-08-18, PR #689) |
| JOB-07 | Phase 142 | Pending |
| MT5-01..04, MT5-11, MT5-12 | Phase 142.2 | **Complete** — shipped v0.53.0.0 (PR #660) 2026-08-04 |
| MT5-05 | Phase 142.2 | ⛔ **OPEN and NOT COMPLETABLE without MT5-13.** Live run 2026-08-04 reached "Your verified factsheet is ready" (gate work confirmed live), but submit fails permanently: the ccxt-only permissions probe rejects MT5 and the failure is mis-rendered as a retryable `KEY_NETWORK_TIMEOUT`. Founder retried 5×. |
| MT5-06..10 | Phase 155 (v1.17) | Pending — re-homed from v1.16 Phase 142.3 into v1.17 (originally split out of 142.2 on 2026-08-03 at the D-14 valve); LAST by design — live funded account, real trading day, stable surface |
| OWN-01 | — | **Already met** (CONTRIB-03, verified in code 2026-08-04) — no phase needed |
| OWN-02, OWN-04 | Phase 148 (v1.17) | Pending — ⛔ NOT folded into 142.3 (OWN scope fence held); OWN-04 strictly after OWN-02 within the phase; OWN-02's acceptance is ADVERSARIAL — after an owner views their draft, an anon request for the same id must still 404 (public `unstable_cache`d route) |
| OWN-03 | Phase 150 (v1.17 — own phase, split 2026-08-04 so the money-path review is isolated) | Pending — **current behaviour now ESTABLISHED, not unverified**: portfolio correctly does NOT auto-update. Founder call — the deliverable is a **wizard question** (own-capital vs verifying-a-team), NOT an auto-add. ⚠️ first WRITING requirement in the OWN set → money-path review; ⭐ 2026-08-05 founder direction: cull profile step to essentials in the same pass |
| OWN-05 | Phase 150 (v1.17) | Pending (added 2026-08-05) — allocator renames OWN private/draft strategies; owner-authz only; public codename redaction contract untouched |
| MT5-13 | **SHIPPED v0.53.0.1** (PR #662, merged `135b6164`) | ✅ Closed 2026-08-04. mt5 branch added to the internal probe (structural read-only triple); permanent probe failures split off `KEY_NETWORK_TIMEOUT` onto `KEY_SCOPE_CHECK_UNAVAILABLE` (no Retry control). Railway `git_sha` confirmed matching before the retry. **MT5-05 discharged the same day** — see OWN-03 for the PROD evidence |
| MT5-14 | Phase 153.2 (v1.17) | ✅ **Complete 2026-08-09** (153.2-04). MT5 is declarable via the narrow `WIZARD_EXCHANGE_CODES` set and **preselected** from `detectedExchange`, so the venue is never asked twice; the chip is a `<span>`, not a disabled button (D-15). The no-widening pin was re-cut consciously in the same task — both negatives kept and the POSITIVE flag-ON assertion added, so it can no longer pass merely by asserting absence. `CRYPTO_EXCHANGES` stays mt5-free and the public marketing exchange count did not move. This row and the checkbox at `:460` now agree (was warning W-153.2-1, the same class as D-153.2-A) |
| MT5-15 | Phase 155 (v1.17) | Pending — ALL THREE MT5 strategies on PROD are `complete_with_warnings`; ⚠️ NOT investigated. Do not read `MT5-05 ✅` as 'the numbers are audited'. ⛔ MT5-07 does NOT close this |
| WIZCONT-01 | Phase 154 (v1.17) | ✅ Done (154-05) — the overlay defers mounting until the draft query answers, so it can no longer mount a `null` draft; resume banner in `WizardClient`; CSV short-circuit pinned by an explicit truth table. ⚠️ The diagnosis named ONE overlay renderer; **there are five** — `DashboardChrome.tsx:78` was missed by the entry, PATTERNS.md and RESEARCH.md alike and caught only by a failing test. ⚠️ `e2e/wizard-resume.spec.ts` authored + CI-wired but NOT observed green; no browser pass; founder confirmation of the landing step outstanding |
| WIZCONT-02 | Phase 154 (v1.17) | ✅ Done (154-03 DB + 154-06 app/UI) — **MT5 only**; three residuals recorded in the entry (no ccxt venue identity; the RPC parameter is unvalidated so the value is "what the server passed"; the fence reads the column service-role because it is not on the SELECT allowlist). Phase 156 owns the last two. |
| WIZFORM-01 | Phase 153.2 (v1.17) | ✅ **Complete 2026-08-09** (153.2-01/02/03/05). Every rule the client can evaluate refuses inline at its own field; the submit button is never `disabled` for a validation reason and a refused submit names the count, names the first field and puts the cursor in it, opening the collapsed disclosure first; `AllocateDialog` derives its invalid border from the ARIA state (D-12). ⭐ **153.2-05 closed the last path**: a field-level refusal raised by `finalize-wizard` is routed back to its field by `FIELD_BY_CODE` instead of rendering a terminal envelope, with a totality assertion making an unmapped `METADATA_*` code a RED test rather than a silent fallback. This row and the checkbox at `:656` now agree (was D-153.2-A) |
| WIZFORM-02 | Phase 153.1 / 153.2 / **153.7** (v1.17) | ✅ **COMPLETE 2026-08-14 — closed by Phase 153.7 (3 plans).** All FOUR `missing` items from `153-VERIFICATION.md` are discharged: the derived population now covers every user-reachable code (root `analytics-service/**` minus three pinned exclusions; the `error_code =` assignment shape AND the four-callee `service_error(...)` call family with per-callee argument slots), **17 → 37** codes, cross-checked exactly against an independent Python `ast` census; all 37 are dispositioned (8 verdict rows replay-tested through `classifyKeyValidationError`, 12 individually-measured exemptions); the boundary decision is written down IN FULL in `EXPECTED_EMITTED_CODES`' re-cut docblock with every exclusion carrying its own reason and count pin; and 153.7-03 coded the last three `finalize-wizard` rejections — `KNOWN_CODELESS_FINALIZE_REJECTIONS` **3 → 0**, `expectedSites` 29 → 32, and `EXPECTED_FINALIZE_REJECTION_SITES` **never edited** at 32, so 32 − 32 = 0 proves nothing was invented. ⭐ The other half of the criterion — *driven from the EMITTING SITES* — is falsified three ways, not asserted: a tmpdir `service_error(...)` code with no disposition reds (153.7-01), deleting a verdict row reds the coverage law AND its replay AND both key routes (153.7-02 FL-1, 153.7-03 FL-B), and neutering one finalize arm reds three independent oracles while the 32 total holds (153.7-03 FL-A). ⚠️ **RESIDUE, NAMED NOT HIDDEN — and it is FIVE codes, not six (corrected 2026-08-14, verification W-153.7-4).** Five analytics-service codes still render `UNKNOWN` on NON-wizard surfaces: the five admin/simulator terminal arms. ⛔ `KEY_UNDECRYPTABLE` on `keys/[id]/permissions` is **NOT** one of them and never was — MEASURED, that route's terminal answers `PROBE_FAILED` / `PROBE_BACKEND_UNAVAILABLE` / `PROBE_TIMEOUT` / `PROBE_RATE_LIMITED` / `CIRCUIT_OPEN`, and `UNKNOWN` is not in its vocabulary at all (`route.ts:562-565`). What is wrong on that path is the **accuracy of a remedy sentence** — `KEY_UNDECRYPTABLE`'s only real remedy is to reconnect the key, and the arm says *"Could not check key scopes. Try again."* — which is a different defect in the same class, and is what the TODOS.md entry has said correctly all along. The permissions route IS reachable from a wizard surface, and that was MEASURED before ticking too: its consumer `KeyPermissionBadge` never builds a `wizardErrors` envelope — it renders the route's own `{ code, error }` as text — so no `UNKNOWN` card is rendered there on any code. Both residues are recorded as SEPARATE TODOS.md items. Prior state below, kept as history. — ⭐ **153.7-01 (2026-08-14) — MECHANISM LANDED, REQUIREMENT STILL OPEN, deliberately.** The coverage law's population is now derived from every user-reachable code (root `analytics-service/**` minus three pinned exclusions; both the `error_code =` assignment shape AND the four-callee `service_error(...)` call family with per-callee argument slots), taking it 17 → **37** codes, cross-checked exactly against an independent Python `ast` census. `seam-venue-vocabulary.invariant.test.ts` is therefore **RED BY DESIGN** with exactly one failing test naming the **20** codes that have neither a verdict row nor a recorded no-verdict. ⛔ Do NOT tick this requirement on the strength of the mechanism: 153.7-02 writes the 20 dispositions and 153.7-03 closes the three code-less `finalize-wizard` rejections. Prior state below. **Partial — NOT complete.** 153.1-05 coded the eleven `validatePayload` arms and 153.1-06 wired the derived-roster invariant; 153.2-05 coded the limiter's two deny arms, taking `KNOWN_CODELESS_FINALIZE_REJECTIONS` 5 → 3. ⛔ **Three rejections still answer code-less** (500 draft-load, 500 finalize-RPC, 502 upstream-shape) and each needs a NEW copy member — see `D-153.2-D` in the 153.2 deferred ledger. The invariant reds in both directions, so the debt cannot grow while it waits |
| WIZFORM-03 | Phase 153.1 / 153.2 / 153.4 (v1.17) | ✅ **COMPLETE — verified at HEAD 2026-08-14.** 153.1-03 landed the `fixRequires` class filter and all three venue-conditional entries; 153.2-05 made it live on submit. ⭐ **The previous 'Partial — NOT complete' verdict was STALE, not merely conservative**: it claimed `ConnectKeyStep`/`MultiKeyConnectStep` "still pass neither", and both have passed `surface: "connect"` AND `venue` since Phase 153.4 (`:1082-1089`, `:1847-1854`). Re-measured on close: the venue-conditional class is exactly `KEY_PROBE_FAILED`/`KEY_RATE_LIMIT`/`KEY_NETWORK_TIMEOUT`, and EVERY wizard-copy call site in `src/` supplies a venue — enumerated, not sampled. An MT5 user can no longer read "switch to a different exchange" on the connect step. |
| WIZFORM-04 | Phase 153.2 (v1.17) | ✅ **Complete 2026-08-09** (153.2-04). ⚠️ **Satisfied by REMOVING the call, not by adding retries** — read the requirement's own ⛔ ("the fix is NOT 'add a retry loop'… ask first whether the call is needed at all"), which overrides its headline mention of "bounded automatic retry with backoff". An MT5 submit now makes **zero** live calls to the venue: the scope-broadening probe is skipped for venues whose capability row says they cannot answer it, gated at BOTH call sites (`route.ts:1200` single-key and `:1442` per composite member). ⭐ The security control still fails TOWARD probing — an unresolved venue is probed anyway (`venueSupportsScopeProbe` → `?? true`) — and a permanent probe condition is no longer reported as a transient blip inviting a retry. Seam budgets and `breaker:railway` untouched, as the requirement's ⚠️ demands. This row and the checkbox at `:693` now agree (was warning W-153.2-1) |
| WIZFORM-05 | Phase 153 (v1.17) | **PARTIAL** — 153.3 landed the server half (bounded end-to-end deadline + terminal lease); 153.4-01 minted the client `validate-key-serialized` row at 120 000 ms with `BREAKER_LOCK_TOMBSTONE_S` 60→90 (D-26) — **and the fix round took it 90→100** (153.4 review WR-01: 90 spanned the fetch budget but not the admission→record LIFETIME the A-25 coupling actually has to cover, so the ceiling is `(30 + 100) × 1000 = 130 000` against a 129 250 ms lifetime) — and pinned client > the 105 s server worst case; **153.4-02 made it LIVE** — `budgetKeyFor(exchange)` selects by CAPABILITY (`venueIsSerialized`, never a venue name), `validateKey` spends what it returns, and the three validate routes declare `default-venue` / `serialized-venue` as mutually exclusive `branch` legs so SC-4b takes a MAX (worst case 248 250 ms against a 300 000 ms ceiling). **153.4-03 BUILT D-05's honest long-wait UI** — `src/lib/wizard/validate-budget.ts` (a client-safe twin of both budgets, pinned to `SEAM_BUDGETS` with both sides hand-typed) plus `ValidateWaitCard` (one status label per venue CLASS, an escalation ladder keyed to FRACTIONS of the configured budget, and an unconfirmed `Stop waiting` at >=40% — ⛔ **not** "non-destructive", which was CR-02's refuted premise: the abort stops this browser listening and does not stop the route storing the key). **153.4-04 MOUNTED IT on the single-key connect step** — an `AbortController` on the validate, a 1 s tick, the 300 ms render gate, a `Stop waiting` that aborts the in-flight POST and keeps every field, and a client deadline that emits `SEAM_DEADLINE_EXCEEDED` rather than spinning forever. ⭐ **That deadline is 165 000 ms, not budget + 15 000 ms** — `connectAbortDeadlineMsFor` = validate budget + the 30 000 ms **encrypt** leg + the 15 000 ms grace (153.4 review CR-01). Sized on the validate leg alone it was 135 000 ms, *below* the route's own 158 500 ms worst case, so it fired almost exclusively in the window where validate had already SUCCEEDED and the route was encrypting and storing the key — and then told the user nothing was saved. ⭐ **The `REQUIRES_CONNECT_SURFACE` gate is PAID**: that commit passes `surface: "connect"` and `budgetSeconds` (and `venue`, closing D-17 at this surface) in the same commit that starts emitting the code, so the "Your key details are still on this page." reassurance actually renders. **153.4-05 CLOSED THE CLIENT LEG on the composite surface** — every member panel now carries its own `AbortController`, its own frozen attempt venue, its own budget and its own `Stop waiting`, all driven from ONE step-level 1 s interval; controllers are keyed by `panel.id` so a reorder cannot redirect an abort, and the same `surface` / `budgetSeconds` / `venue` context is paid at the per-panel `buildEnvelope`. Per-panel isolation is asserted four independent ways (scope, budget, abort target, reorder) and three of them were observed to red when the mechanism was neutered. ✅ **Complete 2026-08-11 for both legs:** the server finishes inside a bounded end-to-end deadline (153.3) and the client grants 120 000 ms against a 105 s server worst case (pinned, and asserted to exceed it), so an honest verdict has room to arrive — and when it does not, the surface says so instead of spinning. ⚠️ **What this row does NOT claim.** D-27 leaves 120 000 ms **PROVISIONAL**: it is the founder's stated staleness tolerance, not a measurement, and **Phase 155 (MT5-VERIFY) is what proves it true against a live broker on a trading day** and tightens it from the p50/p95 153.3's instrumentation produces. ✅ **Corrected 2026-08-11 (was stale):** this row used to close "`MultiKeyConnectStep`'s own `EXCHANGES` array still offers no MT5 card, so a serialized venue reaches a composite panel only via the single-key draft carry-over". **The card is there** (`MultiKeyConnectStep.tsx`, behind `MT5_UI_ENABLED`, with the four third-field overrides) — 153.4 review CR-03 landed it, because a draft-carried MT5 panel was posting `passphrase: null` and silently dropping the broker server with no field on screen to put it back. A class guard compares both surfaces' rendered exchange cards with both flags on |
| ABANDON-05 | Phase 153.5 (v1.17) | ✅ **Complete 2026-08-11** (153.5-01/02/03/05). `Mt5Client.restart()` carries **TWO** epoch checks and the load-bearing one is the SECOND — an inline `_mt5_epoch_for` comparison immediately before the ONE permitted `stale.shutdown()`, because the entry check passes trivially on the very path finding #5 lives on (the legitimate heal runs BEFORE the release that bumps). On the fenced path all three interacting cleanup invariants fire in order — dispose the stale socket anyway, dispose the FRESH WR-01 socket nobody is left to receive, restore `self._closed = True` — and only then raise, so the fix cannot introduce two new leaks. ⭐ **The precondition was missing and was fixed in the same phase:** 3 of the 5 production terminal acquisitions held the raw `asyncio.Lock` and never released through `mt5_terminal_lease`, so the epoch would have advanced on NEITHER worker path and finding #5 would have stayed open with every test green (153.5-03; `job_worker` sync-balance, `job_worker` derive read — finding #5's own path — and `allocator_positions` holdings). Zero raw acquisitions survive in `services/`+`routers/`, pinned by an ast class walk over 88 files with a hand-typed floor of 40. **Falsified, not predicted:** deleting the second check reds `test_a_restart_abandoned_mid_reconnect_never_reaches_the_shared_shutdown` on the CALL-LOG oracle (`assert 1 == 0` shutdown calls), and reverting either worker site reds both the ast pin and that path's exact-delta bump assertion. ⛔ Read with the two ACCEPTED limits above (D-43 in particular: a `shutdown()` already dispatched on the wire cannot be un-sent) |
| ABANDON-06 | Phase 153.5 (v1.17) | ✅ **Complete 2026-08-11** (153.5-02/04/05). Closed at the sink by a **lease-occupancy `ContextVar`**, not by a construction-time epoch snapshot: `asyncio.to_thread` copies the caller's `contextvars.Context` at spawn, so an abandoned thread carries the OLD occupancy token while the registry moves on. `Mt5Client.__init__` reads that frozen token and refuses PRE-connect (opening nothing) or POST-connect (**disposing the socket first — a bare raise is Pitfall-6 in a new costume**). ⭐ **The preflight exemption is structural, not a maintained special case:** `job_worker._make_mt5_session` builds its client outside and before the lease, so it holds no lease, therefore carries no token, therefore is exempt — which is why the ContextVar beat the snapshot design, whose mitigation was two opt-in call-site edits plus a hand-typed pin (the per-site opt-out list this phase exists to avoid). A signature test derives the constructor's parameter set from source so re-adding a `fence_construction=` opt-in would be a deliberate act. **Falsified:** deleting the POST-connect re-check (the plausible half-fix) reds BOTH the unit case and the two end-to-end balance cases — `test_a_zombie_construction_disposes_its_own_socket_and_refuses`, plus `test_a_connect_stage_timeout_leaves_no_rpyc_socket_open` in `test_mt5_validate.py` (#6a) and `test_ingestion_mt5.py` (#6b), oracled on the open/close BALANCE rather than on which arm fired. ⛔ Read with ACCEPTED limit 2: this NARROWS the leak to the window between the `wait_for` firing and the bump; it does not close it to zero |
| ABANDON-07 | Phase 153.5 (v1.17) | ✅ **Complete 2026-08-11** (153.5-01/04/05). Closed at the SINK, deliberately — the end-to-end deadline is lexically INSIDE the lease (`exchange.py` encloses the `wait_for`), so the unwind releases the lease and bumps the `terminal_key`-keyed generation, and every subsequent touch by the abandoned probe hits `Mt5Client._assert_live` on all seven fenced verbs (`login`, `account_info`, `terminal_info`, `history_deals_get`, `order_check`, `restart`, `last_error`). ℹ️ **There is no router-path-specific temporal test and that is the design** — a per-call-site temporal pin would be the instance-not-class mistake this milestone has paid for sixteen times. The temporal property is proven generically by `tests/test_mt5_abandon_fence.py`, which drives a REAL `Mt5Client` over the shipped `_connect=` seam through the REAL `mt5_terminal_lease` with the abandonment scheduled by a **test-owned `threading.Event`** (⛔ never a sleep-ordered race — this repo already carries four documented flake mechanisms) and asserts ordering by log INDEX relative to a release marker, never by wall clock. The refusal is **loud as well as raised** (D-39: `asyncio.futures._copy_future_state` silently discards the exception when the destination future is cancelled, so `raise` alone is invisible), is a plain `Exception` with a FIXED message proven disjoint from the live `_WRONG_SERVER_TOKENS`/`_AUTH_TOKENS` tables (D-42 — an operator fault must never become a user accusation), and is classified as **transient at all five caller surfaces** (D-40 — "zero call-site edits" describes the fence, never the disposition; an unhandled plain `Exception` on a FastAPI seam IS a claim, R-1 "service-permanent, do not retry"). **Falsified:** commenting out the epoch comparison reds the runtime guard on the HARM — `a session touch landed AFTER the lease released: [('account_info', 1)]` — while its embedded `neuter_fence=True` control stays green, which is the point |
| PARITY-01 | Phase 153.6 (v1.17) | ✅ Complete (plans 153.6-01 + 153.6-05) — the three twins closed by ONE shared body at `services/mt5_probe.py` (100% covered), both callers rewired; A1/A2/A3 ledger mutations each observed RED on BOTH halves. Guarded by the three-file ast roster `test_mt5_probe_parity_roster.py` with PER-FILE floors (6/7/3, no total) plus `PROBE_VERB_UNITS_IN_HOME_FLOOR = 2` — the predicate fence that catches a collapse a total floor would mask. ⚠️ the roster keys on the BODY, not the name `_probe`: both callers retain legitimate thin forwarders |
| PARITY-02 | Phase 153.6 (v1.17) | ✅ Complete (plans 153.6-01 + 153.6-05) — B1 fence no longer absorbed (`read_terminal`), B2 stage-1 abandon answers 424 not the breaker-counting 503, B3 fence refusals kept out of the `mt5.stage` population with B3-inverse proving real failures still emit. ⛔ B1's oracle is the operator LOG, not status — absorbed and unabsorbed both answer 424, so a status assertion there cannot fail. B2's oracle IS status, verified by mutation before it was written |
| PARITY-03 | Phase 153.6 (v1.17) | ✅ Complete (plan 153.6-02) — deadline 190 500/100 500 on both arms via the arm-agnostic `BREAKER_STORE_WORST_CASE_FAILING_MS = 25 500`; state-quantified oracle "the browser is the last party to give up" in `seam-budgets.invariant.test.ts`, observed RED on both arms pre-fix and RED under the closed-only structural mutation; blind pin re-cut (repo grep for the literal: 1 → 0) |
| PARITY-04 | Phase 153.6 (v1.17), closed by Phase 156 | ✅ **Complete 2026-08-13 — deferred-control threat flag CLEARED.** Code complete + TEST-applied (plans 153.6-03/04, hardened by 153.6-07/09). DB half: `attested_venue`, two re-based SECDEF RPCs, SECURITY INVOKER scrub trigger, `CHECK (attested_venue IS NULL OR attested_venue = exchange)`, date-set census pin, dated-cutoff backfill. Route half: both probe-gate arms read the attestation, no `?? exchange` fallback on the gate path. **Applied to TEST `qmnijlgmdhviwzwfyzlc` 2026-08-12, byte-identical to the file:** 2438 rows → 2320 attested / 118 NULL (all post-cutoff, correctly probed) / 0 pre-cutoff NULL / 0 divergent; CHECK `convalidated=true`; trigger `prosecdef=false`; both RPCs `authenticated`=true `anon`=false. Both gate markers present ⇒ SQL assertions 2/3 and 5a–5e now ARM instead of SKIP. **Three independent migration audits; round 3 CLEAR (0 findings)** with a mutation battery proving the SQL test catches all five mutations that survive the migration's own `$verify$`. ⛔ **RESIDUAL AS SHIPPED (history — restated, NOT deleted, because it is what a future privilege change re-reads):** the wizard RPCs validated nothing and still held `authenticated` EXECUTE, so a caller could mint an `mt5`-attested key and skip the probe — at the cost of breaking their own key's ingestion. 153.6 recorded that this defence was **a property of the venue set, not a control**: it held only while every probe-exempt venue was unsyncable, and a syncable venue joining `scopeProbeSupported:false` (RESEARCH names sFOX) would have made the forgery free, requiring remedy (a) FIRST. ✅ **CLOSED 2026-08-13 by Phase 156 (CONNECT-01..05)** — remedy (a) shipped as TWO migrations with a live PROD gate between them: `20260813150106_wizard_rpcs_service_role_writer.sql` (Migration A, `GRANT EXECUTE … TO service_role`) and `20260814120000_wizard_rpcs_revoke_authenticated.sql` (Migration B, `REVOKE … FROM authenticated`, both bodies `auth.role() = 'service_role'` with zero `auth.uid()`). **Its own stated gate is DISCHARGED:** *"Goes fully ✅ when CI observes assertion 5 green"* — `sql-tests` GREEN (not grey, not cancelled) against TEST twice on 2026-08-13, run `31719652331` (branch, 16:30:00→16:30:30 UTC) and run `31732467687` (`main` post-#680, 19:01:42→19:02:17 UTC), both with the `20260811210000` marker present so 5a–5e ARMED. ⚠️ Those runs executed assertion 5 **as it stood at 153.6**; the inverted 5d and new 5f/5g/5h are state-adaptive and SKIP until Migration B reaches TEST — that pending observation is recorded on **CONNECT-01**, not here. ⛔ Ceiling unchanged: the venue is the one this server observed a successful read-only authentication at, never "cannot be forged". |
| PARITY-05 | Phase 153.6 (v1.17) | ✅ Complete (plan 153.6-06) — `KEY_SCOPE_CHECK_UNREADABLE` minted and wired at all four sites in one commit; RED observed first (5 failed). Both pins re-cut 74 → 75, `.toBe(2)` count and regex shape untouched. `EXPECTED_FINALIZE_REJECTION_SITES = 32` / `KNOWN_CODELESS = 3` / `expectedSites: 29` grep-proven UNMOVED — the D-18 proof this was a fix, not an addition. ⚠️ ledger row E alone reds only `route.test.ts`, which would have licensed the weaker T-153.6-E2 shortcut; rows E-inverse and E-roster were added to close that |
| CONNECT-01 | Phase 156 (v1.17) | ✅ **Complete 2026-08-13 (PR B).** `authenticated` EXECUTE withdrawn from BOTH wizard RPCs by `20260814120000_wizard_rpcs_revoke_authenticated.sql`, whose post-verify (a) re-asserts the REVOKE took. Assertions, all in `supabase/tests/test_api_keys_exchange_not_user_writable.sql` (424 → 838 lines): **5d** INVERTED (`42501` + zero row delta), **5f/5g** the composite twin minted for `add_wizard_composite_key` — the first assertions anywhere in the repo against that door — each paired with a `service_role` positive that reds as an OUTAGE if a REVOKE goes one role too far. Three further `authenticated`-EXECUTE pins inverted by plan 09 (`test_wizard_session_idempotency.sql` §4, `test_wizard_composite_fence.sql` Part 3a, `test_api_keys_venue_identity_uniq.sql` §4). ⭐ **5h is the durable guard, and it is the transferable lesson:** `REVOKE` is NOT durable — Supabase's `pg_default_acl` re-grants `anon` and `authenticated` on any `DROP`+`CREATE` — so 5h arms from a **comment-stripped `pg_get_functiondef`** and the live ACL, never from a comment marker, and re-runs on every PR. Proven on a PG16 fixture by performing a real DROP+CREATE: it was the ONLY assertion that reddened. ⛔ Green-CI trap NEUTRALISED: the SC5 re-stamp preserves `20260811210000` and adds `20260814120000`, and (5a′)/(5a″)/(5h′)/(5a‴) cross-check both markers from two independent sources. ⚠️ **PENDING OBSERVATION, stated rather than assumed:** 5d/5f/5g/5h are **state-adaptive** (gated on `v_revoke_live`) and SKIP on a database without Migration B. TEST does not carry it yet, so `sql-tests` on PR B is green **with those four SKIPping**; they arm on the run after Migration B reaches TEST. Nothing here has been observed armed-and-green in CI |
| CONNECT-02 | Phase 156 (v1.17) | ✅ **Complete 2026-08-13.** Both routes write through `createAdminClient()` (`create-with-key/route.ts` `rpcAdmin`, `composite/add-key/route.ts` twin), fail-closed at 503 `SEAM_MISCONFIGURED` on a missing service key and NEVER falling back to the user-scoped client. **-02b** structural guard: `src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts` reds if either wizard RPC name is reached from a user-scoped client in either route file. **Verified LIVE ON PROD before PR B was authored** — `156-LIVE-ACCEPTANCE.md`, `status: pass`, rows 1–5 (+ optional row 6): row 3 a real single-key connect at 19:02:40 UTC, 14 min after the deploy carrying `25e28d3a` went READY, proven to be the RPC's write rather than a client INSERT because the `strategies` and `api_keys` rows share an identical microsecond timestamp and exactly one strategy carries it; row 4 a 2-member Deribit composite whose SECOND member was minted by `add_wizard_composite_key` 51s later with no new strategy row — the "first member succeeds, later one fails" falsifier, which did not fire. ⚠️ the ROADMAP's SC2 trace is through the WRONG route: the wizard never touches `/api/keys/validate-and-encrypt` (that is a sibling surface for three client-INSERT components whose rows land `attested_venue = NULL` ⇒ PROBED by design, pinned by assertion 5c). The real trace is `ConnectKeyStep`/`MultiKeyConnectStep` → `create-with-key`/`composite/add-key` → `validateKey` → `encryptKey` → the RPC, all in ONE server request under `withAuth`. Honest ceiling: "the venue this server observed a successful read-only authentication at", never "cannot be forged" |
| CONNECT-03 | Phase 156 (v1.17) | ✅ **Complete 2026-08-13.** The wizard works end to end on PROD, single-key AND composite (`156-LIVE-ACCEPTANCE.md` rows 3/4, 2026-08-13; row 6 MT5 as a bonus). ⛔ **Trap B avoided as specified:** both final bodies contain **zero** `auth.uid()` — a retained `IF v_auth_uid IS NOT NULL AND …` would have been a permanent silent no-op under `service_role`. Asserted structurally from a **comment-stripped** `pg_get_functiondef` by both `20260814120000`'s own post-verify and the outside canaries in `test_wizard_composite_fence.sql` / `test_api_keys_venue_identity_uniq.sql`. ⚠️ The comment strip is not incidental: `pg_get_functiondef` returns `prosrc` VERBATIM INCLUDING COMMENTS, and Migration B documents Trap B in its own body — a raw match would have RED-lined against the correct body. **-03b:** ownership moved entirely to the route (`p_user_id` is `withAuth`'s `getUser()`-verified `user.id`), pinned by `create-with-key/route.test.ts` + its composite twin. `test_wizard_composite_fence.sql` Parts 3b/3c were **RE-CUT, not deleted** — post-Migration-B they would have passed VACUOUSLY (catching the role refusal, never reaching the cross-user condition they name), so they now assert `42501` for BOTH a mismatched AND a matching `sub`, which discriminates the Migration B body from the Migration A body. `GRANT EXECUTE … TO service_role` shipped in Migration A — the ownership check cannot survive in the DB (`auth.uid()` is NULL under `service_role`) and must NOT be relaxed (Trap B is a permanent silent no-op); it moves entirely to the route, which makes `p_user_id === user.id` the load-bearing assertion and `test_wizard_composite_fence.sql` Part 3b vacuous until re-cut. ⛔ `GRANT EXECUTE … TO service_role` is mandatory or connect-a-key is a total outage |
| CONNECT-04 | Phase 156 (v1.17) | ✅ **Complete 2026-08-13.** `api_keys_attested_venue_matches_exchange` KEPT — not retired as redundant — and re-asserted present **and** `convalidated` by the post-verify of both `20260813150106_wizard_rpcs_service_role_writer.sql` and `20260814120000_wizard_rpcs_revoke_authenticated.sql`. Assertion 5e (SQLSTATE `23514` discipline) is **byte-untouched** and unmoved relative to its `ELSE`. The prose now states WHY it stays: it was 153.6's whole defence and is now an independently useful fence against a FUTURE writer letting the two columns diverge, independent of who writes — `finalize-wizard/route.ts` ("AND THE CHECK STAYS"), `finalize-wizard/route.test.ts` docblock |
| CONNECT-05 | Phase 156 (v1.17) | ✅ **Complete 2026-08-13 — the PARITY-04 deferred-control threat flag is CLEARED** (see the PARITY-04 row above; its history is restated, not deleted). Five prose sites re-strengthened: the `attested_venue` column comment + both `COMMENT ON FUNCTION` texts (`20260814120000:482-556`, plan 07), `finalize-wizard/route.ts:1213-1234` + its test docblock and `describe` title, `create-with-key/route.ts` (both the transitional paragraph and the CONNECT-02 write docblock) and the `composite/add-key/route.ts` twin (plan 10). ⭐ **One ceiling sentence, worded identically at all four:** *"the venue is the one this server observed a successful read-only authentication at"* — ⛔ never "the venue cannot be forged", which would license removing the probe gate. **Repo grep proof:** the weakened claim survives in `src/` **zero** times; the only surviving hits are Migration B's own post-verify error strings (negated usage — they RAISE when the claim is true) and applied Migration A `20260813150106` (historical). ⛔ `20260811210000` §1b was **never edited** (applied migration, `migration-reviewer` invariant 11) — superseded **by name** in Migration B's header ⛔ (ii). ⚠️ **`venue_account_id` RESTATED, not closed:** the *reachability* half IS now closed (only the server can pass it), the value still has **no in-database oracle** so *"the venue confirmed it"* stays false — logged in `TODOS.md` § Phase 156 (added by plan 10; distinct from A-3, which is about the value's SHAPE not its PROVENANCE). ⚠️ **IN-04 restated accurately:** the RPCs are SECURITY DEFINER owned by `postgres` so their bodies run as `postgres`, NOT as `service_role` — the scrub trigger's `service_role` allowlist entry is **still unused** and Phase 156 does not become its beneficiary. Migration B ⛔ (iv) is the operative paragraph where `20260812083206:517` says the opposite (Rule 7: pick one, say why) |
| STALE-01 | Phase 154 (v1.17) | ✅ Done (154-01 investigation → 154-04 + 154-08 fix) — root cause **ESTABLISHED before planning** per this row's own gate: **M2(ii)**, the client coerced a zero-rows read to `"pending"` (`useStrategySyncPoller.ts:228-229`) so the loop never saw the terminal state; M2(i)/M3/M4 ruled out by PROD evidence (every child job `done`, `attempts=1`, `last_error=null`). Cause is client-side ⇒ the Python/SQL arm (154-07) is a recorded NO-OP, not a bandaid. Fix: `?? "pending"` removed, `sync-progress` widened, both `isComposite` gates removed as a class, `queued:false` honoured, single-key repoll twin added, amber-not-red mid-re-derive. T1/T1b/T2b/T3 green with oracles byte-unchanged (`stale.runtime.test.tsx` zero-line diff). ⚠️ No browser pass on the amber state; SQL gate authored but unrun |
| MT5-GOAL-01 | Phase 155 (v1.17 — umbrella acceptance gate) | **Umbrella** — no implementation work of its own; MT5 'works' only when SCEN-01 + OWN-02 close. Exists so `MT5-05 ✅` is never read as 'MT5 works' |
| SCEN-01 | **Phase 147 (v1.17)** | ⛔ **HIGHEST** — ⭐census corrected: `daily_returns` has **NO production writer**; **0 of 27 REAL** strategies populated vs 15/15 demo seeds. Root-caused: the READER is wrong; use the existing `resolveDailyReturnSeries`. ⚠️`returns_series` is a WEALTH INDEX — must be DIFFERENCED, never forwarded raw |
| SCEN-02 | Phase 152 (v1.17) | Pending — no ownership marker exists; ownership bit deliberately discarded at `src/app/api/strategies/browse/route.ts` (`const isOwnRow = …` :264). ⚠️ additive WIRE change + persisted-schema bump |
| SCEN-03 | Phase 152 (v1.17) | Pending — scenario rows are not clickable at all; ⛔ depends on OWN-02 (Phase 148) for the factsheet link |
| SCEN-04 | Phase 152 (v1.17) | Pending — row numbers carry no labels; founder could not tell what they meant |
| SCEN-05 | Phase 152 (v1.17) | Pending — two identical 'Alpha Centauri' rows in Browse; related to but distinct from WIZCONT-02 |
| AUM-01 | Phase 151 (v1.17) | ⛔ **DESIGN FLAW** — AUM is derived-only, no input anywhere; blank-slate (the primary use case) cannot size or commit. ⚠️ does NOT cause the 0.00 metrics — that is SCEN-01 |
| AUM-02 | Phase 151 (v1.17) | ⛔ **NOT a fence — a CRASH**. Holdings sync is ccxt-only; PROD `sync_error = "'Mt5Session' object has no attribute 'fetch_balance'"` in a USER-VISIBLE column. sFOX same latent bug. ~1–1.5d, medium risk (gateway concurrency) |
| AUM-03 | Phase 151 (v1.17) | ⛔ **Worse than filed** — copy says "toggle on a live holding"; that control **does not exist** in the composer, deliberately (CONSTIT-03) |
| AUM-04 | Phase 151 (v1.17) | ⛔ **ROOT CAUSE of AUM=0** — blank slate was FORCED: all-or-nothing `perKeyDailiesGateSatisfied` hides "From my book". ⭐ MANAGER-side mt5 keys pin the ALLOCATOR's gate false permanently (cross-role contamination) |
| AUM-05 | Phase 151 (v1.17) | Pending — **sFOX will crash the holdings sync identically** (`get_balances` not `fetch_balance`); invisible only because the flag is off. ⛔ close BEFORE sFOX go-live; fix the non-ccxt CLASS not the MT5 instance |
| NAV-01 | Phase 149 (v1.17 — own phase, split 2026-08-04) | Pending — **SHARPENED 2026-08-04: a RANKING at discovery parity**, not a list — every uploaded key + derived strategy incl. private/draft, same columns/sort/`#n`+percentile; REUSE the existing ranking component/query (visibility predicate via `withPublishedOrOwner` is the only difference); honest pending states, never zeros. ⛔ depends on OWN-02 (Phase 148 — strictly before) |
| RATE-01 | Phase 146 | Pending |
| RATE-02 | Phase 146 | Pending |
| RATE-03 | Phase 146 | Pending |
| RATE-04 | Phase 146 | Pending |
| RATE-05 | Phase 146 | Pending |
| PYAPI-01..10 | Phase 140.1 | Complete (9/10; gaps deferred) |
| PYAPIFIX-01..06 | Phase 140.1.1 | Complete |
| PYAPIFIX2-01..06 | Phase 140.1.2 | Complete (PYAPIFIX2-01 Python half only — render half owned by 140.3 / TS-35) |
| SEAMCORE-01..11 | Phase 140.2 | **Complete (11/11, 12 plans / 12 waves, closed 2026-07-27).** Each row was ticked against a falsifier OBSERVED RED at the phase's final tree by plan 140.2-12's re-run, not against a predecessor SUMMARY's claim: -01 (M25/M35/M38/M39) · -02 (M26/M31/M36/M37) · -03 (M29/M41) · -04 (M30) · -05 (M16/M27/M40) · -06 (M33/M34/M42/M43) · -07 (M1–M17, M24, **M14b**) · -08 (M21/M22×3/M22b/M23/M57) · -09 (M14/M15/M16/M18/M19R/M20/M20R against real Redis) · -10 (M32/M47/M48) · -11 (M49/M50/M58). ⚠️ **SEAMCORE-09 carries ONE named residual:** its own wording lists `nx` trip idempotency, and the `nx` flag is no longer falsified by any test (wave 7 put an early return ahead of the lock write) — trip idempotency itself IS falsified, via M19R. Residual handed to Phase 141. |
| SEAMUX-01..09 | Phase 140.3 | Pending (2 plans re-homed in from 140.2; the rest TBD) |

**Inherited-obligation traceability (the `TS-*` rows in `140.1-TS-OBLIGATIONS.md`).** These are not
numbered v1 requirements and so have no row above, but they are phase-owned work and the re-home
moved nine of them. Recorded here so the ownership is reproducible from a committed document rather
than only from a gitignored ledger:

| Obligations | Owner | Status |
|-------------|-------|--------|
| TS-01, TS-03 | Phase 140.1.1 | Complete |
| TS-04 (ROADMAP SC7), TS-06, TS-07, TS-16 | Phase 140.2 (plans 09, 06, —, 06) | **Complete** (2026-07-27, at the 140.2 gate). TS-07 is a **NEGATIVE** obligation — X-6's one-line 429 fix was NOT scheduled by any of the twelve plans, and not doing it IS its terminal state. |
| TS-02, TS-05, TS-08, TS-09, TS-11, TS-12, TS-13, TS-14, TS-15 | **Phase 140.3** (plans `140.3-01`, `140.3-02`) | Pending — **RE-HOMED from 140.2 on 2026-07-26** with the two plans that carry them; **marked RE-HOMED, never SATISFIED**, in `140.1-TS-OBLIGATIONS.md` by plan 140.2-12 on 2026-07-27 — `140.3-01` owns TS-05/08/09, `140.3-02` owns the other six. Neither plan has run. |
| TS-10 | **Phase 141** | Pending — **re-home EXECUTED in the ledger 2026-07-27** by plan 140.2-12: it is a Python edit whose stated justification ("140.2 owns the retry semantics") is false, since retry is Phase 141 and 140.2 is TypeScript-only |
| TS-23 | Phase 140.2 (tolerance half) / Phase 146 (Python migration) | **Split disposition recorded 2026-07-27.** 140.2's half **DONE** — all three 429 wire shapes classified without knowing the route, one pinned case per shape, and a 429 records ZERO in every shape. **Still owed by 146:** the `match.py`/`simulator.py` migration AND the which-shape-wins decision; it must **PRESERVE** the `Retry-After` header 140.1.2 added, not re-derive it. |
| TS-26 | ops | **Handed off 2026-07-27; 140.2 built NOTHING for it, deliberately.** The credential-carrying probe goes on the `warm-analytics` warmer and must **NEVER** extend `/health` (A-12 / O-7: the breaker would block its own recovery probe, and `/health` stays HTTP 200 when config is degraded so the signal cannot become the outage). |
| TS-32 | Phase 140.3 (both halves) | ⛔ **STILL BLOCKED, re-confirmed 2026-07-27.** A superseded plan-14 text claimed the block was "CLEARED by plan 140.2-12"; that plan is now `140.3-01` and **has not run**. |
| TS-33 | **Phase 140.3 — DECIDED 2026-07-27** by plan 140.2-12 | Pending. ONE field (`wizard_session_id`) in the finalize-wizard payload; it is an envelope/consumer change on the surface `140.3-02` already opens, not a render, retry or limiter concern. ⚠️ **Schedule in 140.3's own pass (numbering starts at `140.3-03`); do NOT retrofit into the already-authored `140.3-02`.** Its strictly-after-TS-01 ordering constraint is SATISFIED. |
| TS-34, TS-35, TS-20 | Phase 140.3 | Pending |

**Coverage:**
- v1 requirements: 60 total (18 original + 30 added 2026-07-26 + 6 PYAPIFIX + 6 PYAPIFIX2 from the two review cycles)
- Mapped to phases: 60 ✓ (Phases 140–146 + inserted 140.1 / 140.2 / 140.3, each requirement in exactly one phase)
- **Unchanged by the 2026-07-26 re-home.** Moving two plans from 140.2 to 140.3 touched no numbered
  requirement: those plans carry `TS-*` inherited obligations, not `SEAMCORE-*` rows. All eleven
  `SEAMCORE-01..11` remain wholly owned by 140.2, and all nine `SEAMUX-01..09` by 140.3.
- Unmapped: 0

**Coverage (v1.17 — added 2026-08-04 at roadmap creation; revised same day after NAV-01 was sharpened):**
- In-scope v1.17 requirement IDs: 29 (28 work + 1 umbrella MT5-GOAL-01)
- Mapped to Phases 147–155: 29/29 ✓, each to exactly one phase — 147 SCEN-01 · 148 OWN-02 + OWN-04 ·
  149 NAV-01 · 150 OWN-03 · 151 AUM-01..05 · 152 SCEN-02..05 · 153 WIZFORM-01..04 + MT5-14 ·
  154 WIZCONT-01..02 + STALE-01 · 155 MT5-06..10 + MT5-15 + MT5-GOAL-01 (umbrella acceptance gate)
- Revision 2026-08-04: the approved Phase 148 (OWN-02/03/04 + NAV-01) was split — 148 OWN-02/04
  (owner factsheet, adversarial cache acceptance), 149 NAV-01 (ranking at discovery parity),
  150 OWN-03 (wizard question, money-path review isolated) — after the founder sharpened NAV-01
  to ranking parity. Later phases renumbered +2 (AUM 149→151, SCEN 150→152, WIZFORM 151→153,
  WIZCONT/STALE 152→154, MT5-VERIFY 153→155). All ordering constraints unchanged.
- Revision 2026-08-11: **+3 → 32 in-scope (31 work + 1 umbrella), mapped 32/32 ✓.** `ABANDON-05/06/07`
  were minted AFTER roadmap creation, at Phase 153.5's planning, from the three findings Phase 153.3's
  `/code-review high` deferred; all three map to **Phase 153.5** (the inserted phase 153.3 handed
  them to). The count above is left at its 2026-08-04 value deliberately — it records what was
  in scope at roadmap creation, and this line records the delta
- OWN-01 excluded — already met (evidence above), deliberately NOT re-implemented
- ⛔ SEAM / JOB / RATE / PYAPI* / SEAMCORE / SEAMUX stay v1.16 (PARKED — resume at Phase 143); no v1.17 phase carries them
- Unmapped (v1.17): 0

**Why decimal phases:** 140.1–140.3 repair the surface Phase 140 created, so they must land before
141 builds retry on top of it. Decimal numbering inserts them in execution order without renumbering
141–146 (whose requirement mappings are already committed above).

**Sequencing within the insert:** **140.3 first.** PYAPI-01 is the only CRITICAL and is independent of
the breaker entirely — it must not wait behind a distributed-systems phase. It also settles the
status-code contract (PYAPI-05) that SEAMCORE-01 consumes, so planning it first prevents 140.1 from
shipping a discriminator against a contract about to change. Then 140.1 (owns the error TYPES), then
140.2 (owns how they RENDER).

**Suggested phase shape** (from research; the roadmapper will finalize — phases continue from **140**):
140 SEAM core+breaker → 141 SEAM retry (gated on the SEAM-05 audit) → 142 JOB reaper+DDL →
143 JOB dropped-enqueue sweep → 144 JOB WR-02 → 145 JOB csv-finalize (reproduce-first) →
146 RATE audit+close. Breaker ships BEFORE retry: fail-fast alone carries zero double-execution
risk and can land while the idempotency audit is still being written.

---
*Requirements defined: 2026-07-25*
*Last updated: 2026-07-25 after research synthesis (4 parallel researchers + synthesizer) and the 8 open-decision resolutions above.*
