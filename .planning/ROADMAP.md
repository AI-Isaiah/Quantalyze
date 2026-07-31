# Roadmap: Quantalyze

## Current Milestone: v1.16 Production Resilience & Reliability (Phases 140–146)

**Goal:** Give the live money-bearing plumbing failure handling — so a hung Railway request, a
silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real investor
factsheet on a spinner that never resolves.

**Scope:** 18 v1 requirements (SEAM-01..06, JOB-01..07, RATE-01..05) per
`.planning/REQUIREMENTS.md` (written against the research-CORRECTED scope in
`.planning/research/SUMMARY.md`, not the original milestone prose). CRON + MONEY groups deferred
(founder 2026-07-25). Phase numbering continues from 140 (v1.15 ended at 139).

**Ordering rationale (non-negotiable, from research):**
- **Breaker (140) ships BEFORE retry (141)** — fail-fast alone carries zero double-execution risk
  and can land while the SEAM-05 idempotency audit is still being written; retry without a breaker
  actively amplifies an outage.
- **SEAM before JOB** — JOB's sweeps use SEAM's timeout-vs-upstream-vs-network error taxonomy to
  decide re-enqueue vs terminal-fail.
- **Every JOB reaper/sweep lands in pg_cron** — never the worker loop (same failure domain as the
  crash it backstops; re-exposes WEDGE-01) and never Vercel cron (plan cron-slot ceiling, a
  documented past cause of prod going dark).
- **142 before 143** — both sweep the same `strategies`/`strategy_analytics`/`compute_jobs`
  triangle; built in sequence as one non-racing mechanism, not two competing crons.
- **RATE last** — mechanical, and its gap list must come from a fresh kickoff grep, not from
  anything upstream.

## Phases

- [x] **Phase 140: SEAM — Shared resilience core + circuit breaker** - Both Vercel→Railway chokepoints fail fast through one Upstash-backed breaker with unified timeout budgets and a clean 503 envelope (no retry yet) (completed 2026-07-25)
- [x] **Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity** (INSERTED) - Tenant-scope the wizard-session leak, make 4xx/5xx attributable at the source, per-tenant `/process-key` throttling, complete idempotency (completed 2026-07-26)
- [x] **Phase 140.1.1: PYAPI-FIX — close Phase 140.1's own review findings** (INSERTED) - Cross-language duplicate-reply contract incoherence (a live 502 arm, but no caller reaches it today); 4 Python High findings; `error_contract.py`'s two remaining guard gaps that no downstream phase can reach; and every test the review's 36 injected mutations proved toothless (12 survived) (completed 2026-07-26)
- [x] **Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route** (INSERTED) - The class 140.1.1 closed on teaser/csv is still open on `/api/validate-key`, where a venue blip renders as `UNKNOWN`/500 "team notified"; plus MT5 permanent-code misclassification (reproduce-first), the raw 429, four 429s missing `Retry-After`, the `_SHAPES` corpus fence, and artifact corrections (completed 2026-07-30; VERIFICATION **passed** 6/6; shipped to main @ 4f45dcab)
- [x] **Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity** (INSERTED) - Record on attributability not `>=500`, cover the body read, bound the store, pin every constant to a literal, verify against real Redis (completed 2026-07-27; 12/12 plans; 7/7 success criteria SATISFIED, SC4 with a named residual; 56 ledger rows re-run at the final tree, 55 RED + 1 GREEN with its replacement RED)
- [x] **Phase 140.3: SEAMUX — Client & wizard seam error surface** (INSERTED) - One source of truth for codes/copy, observe every HTTP outcome, never blame the user for our outage, non-destructive retry (shipped 2026-07-30, PR #651; VERIFICATION **gaps_found** 15/16 — 2 named residuals accepted as tracked tech-debt: **SEAMUX-03** (9 of 15 seam-importing routes still emit bare `{error}` not the typed `{code}` envelope — ⚠️user-facing error attribution) + poll-disjointness pin blind to `wizardFetch` (test-hygiene). See TODOS "v1.16 carried-forward residuals". ⏳ **G4–G7 gap-closure series is coding these arms route-by-route; G7 (2026-07-31) wire-audited `/api/strategies/csv-validate` and found per-arm machine codes ALREADY on the wire — 0 codeless arms — the VERIFICATION `grep -cE 'code:\s*"'` counted 0 only because this route carries `code` positionally through `csvErrorBody`; receipt is the extended `src/__tests__/csv-validate-route.test.ts` (arm-agnostic `json.code` sweep + SENTINEL_PII guard). SEAMUX-03 aggregate NOT yet closed.**)
- [x] **Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open** (INSERTED) - Fabricated observations, destructive controls, our-fault-rendered-as-theirs, and the guards that cannot fail (shipped 2026-07-30, PR #652 + CR-01; VERIFICATION was `gaps_found` 39/43 but its user-facing gap is **STALE/RESOLVED** — verified 2026-07-31 that the `SEAM_MISCONFIGURED`→`UNKNOWN` translate hop IS present in current code at `ConnectKeyStep.tsx:496` + `MultiKeyConnectStep.tsx:829` (`recogniseSeamErrorCode`); the fix landed after the VERIFICATION was written. Only a non-blocking `analytics-client` scrub-test ledger-row residual (doc-hygiene) remains. See TODOS)
- [x] **Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth** (INSERTED) - What the codebase says about itself is true; ⭐carries `Retry-After` travels, a HARD PREREQUISITE for 141 (completed 2026-07-30)
- [ ] **Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit** - Committed retry-safety audit, then bounded retry ONLY for allowlisted calls; teaser provably never retried
- [ ] **Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL** - Writer-stamped transition timestamp + pg_cron reaper to terminal `failed` + threshold-math CI invariant + WEDGE-01 regression test
- [ ] **Phase 143: JOB — Dropped-enqueue reconciliation sweep** - pg_cron sweep finds strategies with data but NO compute-job row (the "`after()` never ran" hole) and idempotently re-enqueues + alerts
- [ ] **Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence** - New migration layered on 20260720120000: terminal `failed` instead of bare DELETE, tightened cadence, 4h threshold unchanged
- [ ] **Phase 145: JOB — csv-finalize atomicity (reproduce-first)** - Reproduce the stale 42501 claim before scoping; close the real non-transactional finalize gap so a partial failure leaves no orphan strategy
- [ ] **Phase 146: RATE — Audit + close the two verified gaps** - Kickoff re-grep gap list; limit `admin/match/eval` + Python `routers/match.py`; audit the seven existing limiter VALUES; `withRateLimit` HOF

## Phase Details

### Phase 140: SEAM — Shared resilience core + circuit breaker
**Goal**: A hung or dying Railway fails fast at BOTH seam chokepoints with a clean typed error — never a lambda held until platform kill, never a cascade-500
**Depends on**: Nothing (first phase of milestone)
**Requirements**: SEAM-01, SEAM-02, SEAM-03, SEAM-04
**Success Criteria** (what must be TRUE):
  1. With Railway mocked to hang, a `keys/sync` request (via `postProcessKey()`) AND an `admin/match/*` request (via `analyticsRequest()`) each return a typed error within their documented timeout budget instead of holding the lambda open — both chokepoints route through the ONE shared `resilient-fetch` core.
  2. After repeated Railway failures, a seam call from a DIFFERENT module context (simulating a second Fluid Compute instance) short-circuits with the typed `503 CIRCUIT_OPEN` envelope + human message without touching Railway — breaker state lives in the shared Upstash store (`breaker:railway`), never per-instance memory.
  3. When Upstash itself errors, seam calls still attempt the real Railway request — the breaker fails OPEN, so a broken breaker can never itself become the outage (deliberate divergence from the rate limiter's fail-closed).
  4. A CI test asserts `timeout × (1 + retries) < maxDuration` for every route calling either chokepoint, driven from ONE exported per-call-site budget table (replacing the divergent 30s / hardcoded-60s ad-hoc budgets).
  5. No route handler calling either client surfaces a raw fetch/breaker error as a 500 — every failure arrives as the typed envelope (the cascade-500 escape in `analytics-client.ts` callers is retrofitted shut).
**Plans**: 7 plans, 4 waves
Plans:
- [x] 140-01-PLAN.md — resilient-fetch core: SEAM_BUDGETS table + Upstash breaker (fail-OPEN) + full unit contract (wave 1)
- [x] 140-02-PLAN.md — both clients through the ONE core + CIRCUIT_OPEN envelope + SC-1c wiring test (wave 2)
- [x] 140-03-PLAN.md — admin/match Class-1: typed arms, err.message leak closed, SC-1b seam test (wave 3)
- [x] 140-04-PLAN.md — wizard Class-2: type-checked SERVICE_UNAVAILABLE_RETRY before substring cascade (wave 3)
- [x] 140-05-PLAN.md — Class-3 five routes: CIRCUIT_OPEN arms + optimizer refund + dormant fetch through core (wave 3)
- [x] 140-06-PLAN.md — third seam (permissions) through core + B-route maxDuration pins + SC-1a seam test (wave 3)
- [x] 140-07-PLAN.md — SC-4 budget invariant test + no-raw-analytics-fetch ESLint rule + phase gate (wave 4)

> **Phases 140.1–140.3 repair the surface Phase 140 shipped.** Five review rounds against the
> verified Phase 140 tree found 46 + ~120 original-code defects; five ad-hoc fix batches were
> **discarded wholesale** (`wip/v1.16-phase140-fix-archive`) because repairs without the
> plan→plan-check gate ran ~1:1 fix-to-defect. Evidence per finding:
> `.planning/phases/140-seam-shared-resilience-core-circuit-breaker/140-FINDINGS-CONSOLIDATED.md`.
> **PART 2 ("TRAPS") is binding on every plan in these three phases** — it is what survives of the
> discarded batches and it documents how each naive fix breaks.
>
> **They must land before Phase 141.** 141 builds retry on top of the breaker; retry over a breaker
> that under-counts (SEAMCORE-02) or trips on caller faults (SEAMCORE-01) amplifies outages.
>
> **Contract between the three:** 140.1 owns what the service EMITS (status codes, body shapes,
> limiter identity) · 140.2 owns the error TYPES · 140.3 owns how they RENDER. They share almost no
> files, which is what makes independent planning safe — the coupling is what produced the fix-batch
> collisions.



### Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity (INSERTED)

**Goal**: The analytics service tells the truth about whose fault a failure is, cannot leak one tenant's verification to another, and cannot be denied platform-wide by an anonymous caller
**Depends on**: Phase 140 (the seam core exists; this phase fixes what it consumes)
**Requirements**: PYAPI-01..10
**Success Criteria** (what must be TRUE):
  1. Two tenants submitting a colliding `wizard_session_id` each see only their own verification — an RLS/SQL gate under `supabase/tests/` fails if the uniqueness constraint is not tenant-scoped, and the duplicate pre-check cannot return a foreign row.
  2. An exchange-side fault (maintenance, revoked key, IP-allowlist change) and a bad-credential fault each answer **4xx**; only a genuine service-side fault answers 5xx — so a single user's broken key can no longer contribute to a platform-wide breaker trip.
  3. An anonymous caller hammering the public teaser cannot exhaust the `/process-key` allowance for authenticated tenants — throttling is bounded per tenant, not by one bucket keyed on the shared internal token.
  4. On `/process-key`, an unauthenticated request is rejected before validation and before throttling — it can neither enumerate feature flags nor consume throttle budget.
  5. No replay can return "duplicate" for work that was never enqueued, and no state exists from which the client is told to retry with no path to success.
  6. A missing or stale platform secret produces an operator signal; no response body echoes caller credentials; validation detail and throttle responses arrive machine-readable (`Retry-After`, structured `detail`).
**Plans**: 9 plans, 5 waves
Plans:
- [x] 140.1-01-PLAN.md — PYAPI-01 SQL half: tenant-scoped composite unique index + RED-first supabase/tests gate (wave 1)
- [x] 140.1-02-PLAN.md — PYAPI-01 query half + PYAPI-09: pre-check move/scoping/ownership, enqueue-aware duplicate path, RPC dedupe fence (wave 1)
- [x] 140.1-03-PLAN.md — PYAPI-05 contract artifact + R-2 helper; remap exchange.py S-01..S-07 + internal.py S-08..S-12 (wave 1)
- [x] 140.1-04-PLAN.md — PYAPI-05 remap match/simulator/portfolio S-13..S-20 + main.py S-23 JSONResponse literal (wave 2)
- [x] 140.1-05-PLAN.md — PYAPI-10: ok discriminator on all six 200 shapes; scope rejection 200→403 (wave 2)
- [x] 140.1-06-PLAN.md — PYAPI-04 auth-first middleware + PYAPI-02 HMAC tenant-claim limiter + TS mint (wave 3)
- [x] 140.1-07-PLAN.md — PYAPI-03: delete 3 private limiters, rekey all 9 IP-keyed routes, flow-cost table (wave 4)
- [x] 140.1-08-PLAN.md — PYAPI-07 scalar-detail 422 handler + PYAPI-08 machine-readable 429 + PYAPI-06 operator signal (wave 4)
- [x] 140.1-09-PLAN.md — Phase gate: CI-mirror runs, M1-M8 mutation ledger, TS-obligations artifact, PROD wedge count (wave 5)

### Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route + the surviving 140.1.1 review findings (INSERTED)

**Goal**: The venue-transient class is closed on the route real users actually hit, and every finding that survived adversarial refutation is closed or explicitly, reasonedly deferred
**Depends on**: Phase 140.1.1 (closes findings against its 25 commits)
**Requirements**: PYAPIFIX2-01..06
**Evidence**: `140.1.1-STAGE1-FINDINGS.md` (5 lenses) + `140.1.1-STAGE2-FINDINGS.md` (5 red teams) + `140.1.1-REVIEW.md` (36 mutations, 30 caught, 6 survived). **An adversarial refutation pass refuted 4 of 10 findings outright and reduced 3 more — this scope is only what survived.**
**Success Criteria** (what must be TRUE):
  1. **A venue-transient fault answers a typed, classifiable error at EVERY consumer of `validate_key_permissions` — including `/api/validate-key`, the live key-connect route.** Today `routers/exchange.py:522` and `routers/portfolio.py:2322` collapse `RATE_LIMITED`/`DDOS_PROTECTION`/`EXCHANGE_UNAVAILABLE`/`NETWORK_UNAVAILABLE`/`PROBE_FAILED` into an opaque 400 with no `code` and no `retryable`. **The arm 140.1.1 fixed serves teaser/csv/internal_report; the unfixed one carries strictly more real traffic.** A test must prove that a Binance-maintenance-shaped failure during key-connect no longer renders as `UNKNOWN`/500 *"our team has been notified"* with no retry affordance. ⚠️ **DISPOSITION (140.1.2 plan 04): PYTHON HALF CLOSED (7/7 sites carry code+recoverable); RENDER HALF → OB-1, owner 140.3** (ledger row `TS-35`) — the *renders* assertion in this criterion is a TypeScript assertion (`create-with-key/route.ts` returns the classifier-computed status and discards the upstream one, RESEARCH C-1), so this criterion is HALF met by this phase, deliberately and on the record.
  2. **A permanent MT5 credential fault is never retried as a transient venue fault** — or the phase records, with evidence, that the path is unreachable. `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` are absent from both `PERMANENT_VALIDATION_ERROR_CODES` and `long_fetch.py:391`'s local set, so the live worker path burns 3 gateway-serialised retries on a credential that can never succeed — while TypeScript already calls both 400 client faults. **Reproduce-first: "could not reproduce" is a valid outcome** (one red team held MT5 never reaches `validate_key_permissions`).
  3. **`/internal` throttling emits the service's own envelope**, giving the 429 builder arm added in 140.1.1 its first call site — today `routers/internal.py:226` raises a raw `HTTPException(429)` one line away from it, so the arm has zero callers and the response carries no `code`.
  4. **Every user-facing 429 carries a `Retry-After`** — `match.py:1742`, `portfolio.py:1960`, `simulator.py:249` currently do not.
  5. **The 200-discriminator corpus cannot silently shrink.** Deleting a `_SHAPES` row was OBSERVED to survive (141→140 passed) after 140.1.1 correctly removed a self-referential guard that was *also* the only corpus fence.
  6. **The phase's artifacts state only what they can support**: `140.1.1-VERIFICATION.md` reads `gaps_found` (its "no already-correct test was removed" claim is false, and PYAPIFIX-02's carve-out was evidenced by a `grep -c` that proves a marker exists, not that a list is complete); and in `docs/STATUS_CONTRACT.md` the "not seam-reachable" list no longer points at a **live 424 arm** (`exchange.py:491`), S-11's line ref is correct, the "four classes" heading matches its five-row table, and the dependency census is right. ⚠️ **No general comment sweep** — the "refs off by the inserted-line count" diagnosis was **refuted**; most drift pre-dates the phase, so any number recomputed as old+18 would be wrong.
**Plans**: 4 plans / 3 waves
Plans:
- [x] 140.1.2-01-PLAN.md — PYAPIFIX2-02: gated reproduce-first MT5 permanence (adapter-provenance fix or NOT-REPRODUCIBLE exit) (wave 1)
- [x] 140.1.2-02-PLAN.md — PYAPIFIX2-03 /internal 429 → service_error + PYAPIFIX2-04 Retry-After ×4 + the fenced census-comment exception + TS-34 (wave 1)
- [x] 140.1.2-03-PLAN.md — PYAPIFIX2-01: venue-transient class closed 7/7 via flat scalar-detail shape + machine code; TS-32 corrected + TS-35 added (wave 2)
- [x] 140.1.2-04-PLAN.md — PYAPIFIX2-05 _SHAPES↔AST fence + PYAPIFIX2-06 artifact truth + phase gate (wave 3)

### Phase 140.1.1: PYAPI-FIX — H-5 duplicate-reply contract break + close the 12 surviving mutations (INSERTED)

**Goal**: Phase 140.1's own review findings are closed — nothing it shipped breaks a live consumer, and every test the review's mutations proved toothless now bites
**Depends on**: Phase 140.1 (closes findings against its 41 commits)
**Requirements**: PYAPIFIX-01..06
**Evidence**: `.planning/phases/140.1-.../140.1-REVIEW.md` — `issues_found`, 0 critical / 24 warning / 12 info, **36 mutations injected, 12 SURVIVED**. Each survivor is proof of a toothless test, not an inference.
**Success Criteria** (what must be TRUE):
  1. **The `/process-key` duplicate reply and its consumer agree on ONE contract.** ⚠️ *De-escalated 2026-07-26 — this is NOT a live break.* Source-verified: **no live caller can trigger the 502 today** — `finalize-wizard/route.ts` and `keys/sync/route.ts` contain ZERO `wizard_session_id`; the duplicate path requires a caller-supplied one (`process_key.py:977-979`); csv arms return before the pre-check; `create-with-key`/`composite/add-key` use it only in direct SQL RPCs. It is **contract incoherence with a live 502 arm** — a trap for the next caller, and 140.2/140.3 add callers. Fix it for coherence, not urgency. `routers/process_key.py:680-690` emits `queued:true` WITH `code`/`idempotent`; the guard at `src/app/api/strategies/finalize-wizard/route.ts:1433-1450` rejects exactly that shape (`if ("code" in r || "idempotent" in r) return false;` — "mixed envelope = bug"), and the miss arm emits Sentry + **HTTP 502**. A test must exercise the REAL Python reply against the REAL TS guard — today both suites are green **because each mocks the other**, which is precisely how this landed. *(Verified at source: the guard is Phase 140's own commit `57b11813` on this SAME unmerged branch — NOT deployed, and 140.1 never touched that file. So there is no rollout-ordering constraint; pick the fix direction on contract quality. At base `43449cc6` both duplicate arms hardcoded `"queued": False`, which the guard's `queued=false` branch accepts — that branch permits `code`/`idempotent`. The regression is solely that PYAPI-09 made `queued` sometimes true while keeping them.)*
  2. **Venue-transient faults are 424/retryable, not 403** — via a **permanent-code ALLOW-LIST**, never a transient denylist. No response body may say `recoverable:false` beside "Try again in a moment." *(Corrected 2026-07-26 at source: (a) the claim that `/exchange/validate-key` "already gets this right" is **FALSE** — `read_only is False` appears exactly twice repo-wide, `process_key.py:1297` and `long_fetch.py:331`; that route never evaluates it. The real analog is `long_fetch.py:386-397`. (b) The research's proposed **transient denylist fails unsafe — it is literally the existing bug's shape**; `long_fetch` uses a permanent allow-list, follow that. (c) `MISSING_SCOPE` **must** be in the allow-list — `exchange.py:1047-1058` sets `read_only=False` + `error_code="MISSING_SCOPE"` and returns without `valid=True`, and it is absent from `long_fetch`'s `permanent_codes`, so a permanent scope fault would otherwise become a retryable 424. (d) The review both over- and under-counted: its "two sites" are one predicate + its single return, and it **missed `process_key.py:358-359`'s `recoverable` set**, which omits `PROBE_FAILED`/`DDOS_PROTECTION` — no status-code change fixes that.)*
  3. **`create_exchange` failures are 500, not 424 — at all THREE sites.** `internal.py:416-431` (S-11) classifies them as "problem at the venue", but that function performs **no network I/O** — every real failure (ccxt `TypeError`, `ImportError`, OOM) is ours. As 424 it is breaker-inert AND 4xx, so **nobody is ever paged**. *(Corrected 2026-07-26: the pattern-mapper found this is a **3-site class, not 1** — `routers/portfolio.py:2266` is a third, and the **same function's second `create_exchange` at `:2316` already answers 500**, which is in-repo proof the class is real. This is exactly the instance-not-class defect the mapper exists to catch; a point-fix would have shipped.)*
  4. **The `body.detail.detail` scalar guarantee is ENFORCED, not documented.** `error_contract.py:158-181` is what Phase 140.2 renders from; today lists and dicts emit verbatim (proven by execution). Every other class rule in that module is a hard guard.
  5. **Every one of the 12 surviving mutations turns a test RED**, re-run and observed first-hand. Named in the review; they include S-06's split pinned by a single ccxt subclass (narrowing `except ccxt.BaseError` survived **twice**, and under it `RateLimitExceeded` answers 500 — the exact A-01/C-12 defect this programme exists to fix), `RETRY_AFTER_SECONDS["supabase"]` (15→900 survived), `default_platform_key` returning `""` (**makes slowapi skip limiting entirely** and ships green), and the 429's `Retry-After` value.
  6. **`error_contract.py`'s remaining guard gaps are closed — the circular deferral is broken.** *(Added 2026-07-26 from two red teams; no downstream phase can fix these — 140.2/140.3 are TypeScript-only by their own CONTEXTs and 146 is a rate-limit phase, so they currently have NO reachable owner.)* **(a)** A `429` carrying `Retry-After` is **constructable**: today `retry_after` requires `retryable:true` while the CALLER arm raises on `retryable:true` (`_validate`, `error_contract.py:146-155` + ~`:100`) — yet `140.1-VERIFICATION.md` gap 1 and obligation TS-23 both MANDATE migrating the two in-handler 429 sites onto that envelope. **(b)** The `>=500` arm rejects a venue `dependency`: today `service_error(500, "X", dependency="binance", retryable=False)` validates, and **Phase 140.2 keys the breaker on `dependency`** — a venue name on a 500 poisons a breaker key.
**Plans**: 7 plans / 4 waves
Plans:
- [x] 140.1.1-01-PLAN.md — PYAPIFIX-04+06: all 4 error_contract guard gaps (429 arm, 500-dep membership, scalar detail, retry_after source) + doc reconciliation (wave 1) — **DONE** 2026-07-26, 5 commits `0a195a5f..7454330c`; criteria 4 + 6a/6b observably true; 48 new tests, all RED-first; suite 4668/96 skipped, mypy 89 files clean
- [x] 140.1.1-02-PLAN.md — PYAPIFIX-02: permanent-code allow-list, 424 pre-gate + recoverable fix, TRAP-9 fence unedited, M-4 carve-out BLOCKED-BY: TS-05 (wave 1)
- [x] 140.1.1-03-PLAN.md — PYAPIFIX-01 Python half: predicate extraction to src/lib leaf + committed fixture proven equal to real TestClient bodies (wave 1) — **DONE** 2026-07-26, 2 commits `82f84f28` (extraction, 59 route tests green UNEDITED) + `0c45da2c` (fixture + 6 contract tests). `src/lib/process-key-onboard-contract.ts` has **0 imports**, both symbols exported, one implementation repo-wide; fixture **tracked in git** (5 cases, 2 positive / 3 negative), positives proven equal to REAL full-stack `main.app` TestClient replies on BOTH duplicate arms; falsifiability probe RED observed → reverted → GREEN. No Python production file touched. Suite 4704/96 skipped, mypy 89 files clean, tsc 0, lint 0 errors. **Wave 1 COMPLETE — `wave_0_complete: true`, plan 05 unblocked.**
- [x] 140.1.1-04-PLAN.md — PYAPIFIX-03: create_exchange class 3/3 sites -> 500 retryable:false + M-14 log companions (wave 2) — **DONE** 2026-07-26, 6 commits `9adbedae..6b754def` (3 RED/GREEN pairs). **Class closed at 3/3, not the review's 1 or RESEARCH's 2**: `routers/internal.py:421` (B1), `routers/exchange.py:447` (B2), `routers/portfolio.py:2269` (B3 — named by NOBODY, found only by the pattern-mapper because British "initialise" defeats the grep). All three raise `service_error(500, "ADAPTER_INIT_FAILED", retryable=False)` with ONE shared copy; **no `dependency` on any** (plan 01's C3 guard makes the old shape unconstructable); no `Retry-After`. `EXCHANGE_INIT_FAILED` retired at **0** raise sites; `grep "Failed to initiali" routers/` → **0**. `ValueError` → 400 preserved and newly pinned at all three. B4 (`portfolio.py:2513`) and B5–B8 byte-unchanged. **M-14 closed at 2/2** (`main.py:695` + `:722`), with the absent-header 0-event fence proved falsifiable by a neuter probe (dedent → 1 failed / 3 passed, reverted). 2 new test files, +12 tests. Suite **4716/96 skipped/0 failed**, mypy 89 files clean, 0 new `type: ignore`.
- [x] 140.1.1-05-PLAN.md — PYAPIFIX-01 TS half: widen guard + 3 new invariants, parity test, both-direction neuter proof, TS-OBLIGATIONS reconciliation, M-11 record (wave 2) — **DONE** 2026-07-26, 3 commits `8865400c` (RED parity test) → `2f776271` (GREEN widening + TS-03 comment inversion, same commit per the ledger's own warning) → `58441952` (route.test rewrite). **PYAPIFIX-01 CLOSED.** The mixed-envelope rejection is deleted and the union widened, with THREE compensating invariants (non-empty `code`; `idempotent` ⇒ `true` AND `code === "WIZARD_DUPLICATE"`, one-directional by design; `verification_id` string retained), each pinned by a negative fixture case in BOTH languages. **RED observed first (3 failed / 6 passed) — and richer than predicted: N2 (`code:""`) was ACCEPTED pre-widening, proving invariant 1 is genuinely new teeth, not a trade.** ⭐ **The oracle is BIDIRECTIONAL, both directions observed first-hand:** neutering `_wizard_duplicate_reply` (`"code"`→`"codes"`) ⇒ pytest **2 failed** (*"only in reply: ['codes']; only in fixture: ['code']"*); neutering the predicate (`return true` first) ⇒ vitest **4 failed** (every negative wrongly accepted). Both restored from scratch copies OUTSIDE the repo, tree clean, `grep -rn MUTANT` → 0. `grep -c "vi.mock"` on the parity test → **0**. `route.test.ts:1474` **REWRITTEN not deleted** (59 → 61, 0 deleted) with TWO retained negatives. Coverage gate (OQ-6) settled by measurement: 84.36/78.37/81.43/86.49 vs 80/72/74/82; full frontend suite **8878 passed / 0 failed**; tsc 0; lint 0 errors. Python re-verified after the cycles: **4716/96/0**, mypy 89 files clean. Ledger reconciled: TS-01/TS-03 **DONE-IN-140.1.1**, TS-02 sharpened, TS-23 **UNBLOCKED**, TS-32 (M-4 ↔ TS-05 pairing) + TS-33 (M-11) added, 31→33, TS-04..22/24..31 byte-unchanged. **M-11 DECIDED, not implemented.** **WAVE 2 COMPLETE.**
- [x] 140.1.1-06-PLAN.md — PYAPIFIX-05 batch 1: survivors #1/#2/#6/#7/#12 + M-15 AST fence, mutation re-runs observed RED (wave 3) — **DONE** 2026-07-26, 3 commits `33f03757` (ccxt family) → `803198ec` (#6/#7/#12) → `0ff9446e` (M-15 AST fence). **6 mutation cycles / 8 runs, EVERY result OBSERVED FIRST-HAND — zero "asserted only" rows.** #1 `except ccxt.BaseError`→`NetworkError` ⇒ **3 failed / 5 passed** (`PermissionDenied must answer 424, got 500`); #2 →`ExchangeNotAvailable` ⇒ **6 failed / 2 passed** (`RateLimitExceeded must answer 424, got 500`) — both `assert 500 == 424`. The parametrisation straddles BOTH ccxt roots (7 subclasses) so no single narrowing satisfies it, with the non-ccxt `RuntimeError` control INSIDE the table so an `except Exception` widening also fails. #6 `"supabase": 15`→`900` ⇒ **4 failed / 0 passed** `assert '900' == '15'` at all four sites (≥1 red per file, targeted node ids only); the verbatim mt5-gateway idiom is now applied 4×. #7 `_KEK_ALERT_WINDOW_S 300.0`→`1e18` ⇒ **1 failed** `assert 1 == 2` — the test is now a **driven three-phase clock** (1 inside / still 1 inside / **2 after the LITERAL 300 s expires**), because the old free-running-clock count assertion was satisfied by any window longer than the test. #12 junk copy ⇒ **1 failed** — the human sentence is pinned by EQUALITY against a literal, the `!= AUTH_FAILED_DETAIL` guard kept. **M-15 DELETED** (`len(_SHAPES) == 6` against a same-file list literal, plus its false docstring) and replaced by an **AST-fingerprint SET** derived from `routers/process_key.py`'s own source — 8 fingerprints, never a count (C-20: the six was a coincidence of one collapse cancelling one expansion) — with a 200-capable filter (no `status_code=` or literal 200) that excludes the 401/403/422/**424** arms, asserted from both sides. **All three probes observed:** (a) a 7th 200 return ⇒ **1 failed / 16 passed** naming `dict:code,mutant,ok`; (b) 3 blank lines above the handler ⇒ **17 passed**; (c) `return JSONResponse(status_code=418, …)` ⇒ **17 passed**. Every restore from a `cp` scratch copy under `/tmp` — **zero** `git stash`/`git checkout`/`git clean`. Wave-3 gate: **4724 passed / 96 skipped / 0 failed** (4716 + 7 + 1, reconciles exactly), mypy --strict 89 files clean, **0** new `# type: ignore`, `grep -rn MUTANT` → 0, **zero production files modified**. **WAVE 3 COMPLETE.**
- [x] 140.1.1-07-PLAN.md — PYAPIFIX-05 batch 2: slowapi #3/#4/#5 on 0.1.10 + claim-parser #8-#11 (both #11 sites) + phase-wide gates (wave 4) — **DONE** 2026-07-26, 3 commits `b7e7023c` (#3/#4 behavioural) → `d5a49fef` (#5 tight band) → `39688d69` (#8-#11 new file). **8 mutation runs, EVERY RED OBSERVED FIRST-HAND — zero "asserted only", zero non-reddening findings. With batch 1 this is 13/13 phase-wide = ROADMAP criterion 5 COMPLETE.** ⭐ **slowapi synced 0.1.9 → the CI pin `0.1.10` BEFORE any #3/#4/#5 cycle** and both dependent internals re-confirmed on it (`if all(args)` empty-key skip at `extension.py:506-527`; `view_rate_limit` = `(limit, [key, scope])` at `:530`); env left at 0.1.10. #3 `default_platform_key` → `return ""` ⇒ **3 failed / 65 passed** incl. **`never answered 429 within 4 calls`**; #4 → per-request `uuid4().hex` ⇒ **3 failed / 65 passed** incl. the stability assertion + the same missing 429. The old oracle was `assert _key_func is default_platform_key` — object IDENTITY, true for any body — so the new gate drives **real HTTP requests** through a throwaway app whose route declares NO `key_func` (no production route exercises the singleton default at all), decorated ONCE at module scope, bounded-and-driven; the `:483` identity assertion is RETAINED. #5 `_retry_after_seconds` → `return 1` ⇒ **2 failed** — `0 < 1 <= 3600` passed the old bound, so a `> window * 0.9` band was added at **BOTH** weak sites (route A `/api/verify-strategy` AND route B `/api/csv/validate`, different routers), derived from the test-declared limit string, never from the function under test; mutation hits the computation (`main.py:458-487`), oracle reads the header (`:526`). **New file `tests/test_tenant_claim_parsing.py` (14 tests) — the four guards had NO test at all, not weak tests.** #8 drop the 512 bound ⇒ **2 failed** (`a 513-char claim was ACCEPTED` + `ran hmac.new 1 time(s)`) — ⚠️ the fixture is a **correctly-minted, VALID, merely oversized** 513-char claim because 513 chars of junk would NOT redden (rsplit raises, the never-raise except swallows it, `is None` holds either way); the spy substitutes rate_limit's `hmac` MODULE attribute, with a negative control asserting an ordinary claim reaches the MAC exactly once. #9 `rsplit`→`split` ⇒ **3 failed**; #10 drop the empty-payload guard ⇒ **3 failed**, mutant bucket literally `'claimtest:t:'`. **#11 closed 2 of 2**: `:333` ⇒ **1 failed** (the `:417` test GREEN), `:417` ⇒ **1 failed** (the `:333` test GREEN) — the asymmetry is the proof of independent coverage. Zero symbols imported from the module under test except the 3 functions under test; every expectation a literal or stdlib-minted. **PHASE-WIDE GATE (all five, first-hand):** pytest **4743 passed / 96 skipped / 0 failed** (4724 + 5 + 0 + 14, reconciles exactly) · collection **4837**, 0 errors, and the 4837-vs-4839 delta traced to 2 PRE-EXISTING module-level `allow_module_level` skips rather than assumed · `mypy --strict` **89 files clean** · `npx tsc --noEmit` **0** · full `npm run test:coverage` **8878 passed / 0 failed** (697 files) with all four thresholds clear · `npm run lint` **0 errors** · **0** new `# type: ignore` phase-wide · `grep -rn MUTANT` → 0 · **zero production files modified**. **WAVE 4 COMPLETE — PHASE 140.1.1 EXECUTION COMPLETE (7/7 plans).**

### Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity (INSERTED)

**Goal**: The breaker counts the failures it exists for, ignores the ones it must not, and every constant governing it is falsifiable
**Depends on**: Phase 140 (the core), Phase 140.1 (consumes its status contract — do not ship a discriminator against a contract 140.1 is changing)
**Requirements**: SEAMCORE-01..11
**Success Criteria** (what must be TRUE):
  1. A stalling upstream that returns headers fast and the body slow **records a failure** — the recording window covers the body read, and the deadline surfaces as a typed seam error, not a raw `DOMException`.
  2. A caller fault (malformed service URL, bad timeout override) and an exchange-attributable upstream error each record **zero** breaker failures; a genuine service fault records one — including when the body is `text/plain`.
  3. Mutating any breaker constant or any per-route timeout budget turns a test **RED**. Today 10 simultaneous semantic mutations produce a byte-identical pass; this criterion is the direct inversion of that.
  4. The breaker's Redis-side semantics (sliding-window decay, weighted carry-over, `nx` trip idempotency) are verified against **real Redis**, not a fixed-window fake that cannot execute the deployed Lua.
  5. A degraded or hung breaker store cannot hold a lambda past its declared budget, and the budget invariant accounts for store round trips in the closed, open and failing states.
  6. Adding an import to the shared error leaf, swapping a call site's budget key, or routing a health warmer through the core each fail a test — the structural invariants are enforced, not documented.
  7. **`analytics-client.ts` mints the `X-Tenant-Claim` header, flipping the SIX rekeyed Python routes reachable from that client — five live, one dead — from `platform:<path>` to genuine per-tenant throttling.** ⚠️ *Corrected 2026-07-27 by plan 140.2-09, which delivered it.* This criterion previously read **"flipping all nine rekeyed Python routes"**, which is false and was false when written. The behaviour-derived answer comes from a reproducible sweep — `grep -rn "key_func=partial(tenant_or_platform_key" analytics-service/routers/` → 9 sites, each route path then grepped across `src/` and the hit READ: **6 reachable** from `analytics-client` (`validate-key`, `encrypt-key`, `optimize-weights`, `portfolio-optimizer`, `portfolio-bridge` **live**; `portfolio-analytics` reachable but its wrapper `computePortfolioAnalytics` has **zero production callers**, so it flips a dead path) and **3 unreachable from that client by construction**: `fetch-trades` is reached only by an eslint-allowlisted debug raw fetch, and `csv/validate` and `verify-strategy` have their TS routes re-targeted to `/process-key` (which was already per-tenant since 140.1), leaving the Python routes of those names with zero TS callers. Those three are **unaffected** by TS-04 and need a separate owner if they are ever to be flipped. (Inherited obligation **TS-04** from Phase 140.1, which completed the Python half — the same key function provably returns `optimize_weights:t:<user>` the instant a claim appears, and the cross-language HMAC link is proven end-to-end. Until this lands, PYAPI-02's per-tenant guarantee holds for `/process-key` ONLY. ⚠️ *Corrected 2026-07-26:* the claimless arm at `services/rate_limit.py:169-185` is `platform:<path>` **per route**, so the nine sit in **nine separate** platform-wide buckets, not one shared one — exhausting `/api/optimize-weights` does not touch the other eight. Also **not a merge regression**: pre-phase these routes were IP-keyed behind Vercel egress NAT, i.e. already effectively platform-wide. TS-04 makes them better; its absence does not make them worse.) A test must prove a request from tenant A cannot consume tenant B's allowance on at least one of the nine. *Satisfied on all FIVE live routes, not the minimum one, by `src/lib/analytics-client.test.ts` — which drives each wrapper twice with two server-derived identities and reproduces the Python bucket decision (`verify_tenant_claim` + `tenant_or_platform_key`, transcribed by hand) to show `<scope>:t:tenant-a` vs `<scope>:t:tenant-b` rather than one shared `platform:<path>`. It also refuses the payload-splice forgery. The zero-signature-change shortcut — satisfying the clause via `runPortfolioOptimizer`/`findReplacementCandidates` alone, both of which already carried an actor id — was available and deliberately NOT taken: it would have left the two busiest key-connect endpoints and the 20/minute optimizer on a platform bucket.*
**Plans**: 12 plans / 12 waves (`workflow.use_worktrees=false`, so waves order the work sequentially on the main tree rather than parallelising it)

> ⚠️ **Was 14 plans / 14 waves.** On 2026-07-26, during the plan-checker review, the developer re-homed
> two consumer-surface plans to Phase 140.3: `140.2-12` → `140.3-01` (TS-05/08/09) and `140.2-13` →
> `140.3-02` (TS-02/11–15). Old plan 14 became plan 12 (wave 12). **This is a re-home, not a scope
> cut** — the work and its six Falsifiability Ledger rows (M51–M56) moved intact and are recorded in
> `140.3-CONTEXT.md`'s handover note. The 140.2 ledger is correspondingly **55 rows**, not 57.

Plans:
- [x] 140.2-01-PLAN.md — SRH spike, then the real-Redis lane + `frontend-seam-redis` CI gate, and the six mutation rows only that lane can observe (SEAMCORE-09 / SC4)
- [x] 140.2-02-PLAN.md — the literal-pinned constant + budget oracle, the route-row deep compare, **and cutting the self-referential fake at all 4 `fakeRatelimitFor` sites** (SEAMCORE-07 / SC3) — ✅ **both oracle layers closed; `opts.limiter.tokens` → 0 in src/; M14b measured 1-failed → 7-failed across the cut; 20/20 rows OBSERVED RED**
- [x] 140.2-03-PLAN.md — 13/13 budget-key pins **+ a roster mechanism that fails on a 14th**, leaf purity, warmer exclusion (SEAMCORE-08 / SC6)
- [x] 140.2-04-PLAN.md — fixed-point alias taint in `no-raw-analytics-fetch` + all four URL shapes (SEAMCORE-08)
- [x] 140.2-05-PLAN.md — the try block in ONE pass: body-read window, URL/deadline hoist, `redirect: "error"`, override validation (SEAMCORE-02, SEAMCORE-11 / SC1)
- [x] 140.2-06-PLAN.md — attributability discriminator + per-dependency breaker keying + OB-8 (SEAMCORE-01 / SC2)
- [x] 140.2-07-PLAN.md — bounded store, the A-09 sentinel, single-read breaker state, no-re-arm, store-aware budget arithmetic (SEAMCORE-03/04/05 / SC5)
- [x] 140.2-08-PLAN.md — the redaction leaf at 15 log sites + 10 Sentry captures, and the breaker transition event (SEAMCORE-06)
- [x] 140.2-09-PLAN.md — `X-Tenant-Claim` minted from `analytics-client`, five live routes flipped (SC7 / TS-04)
- [x] 140.2-10-PLAN.md — composite fan-out capped at the query; the budget table models the branch actually taken (SEAMCORE-10)
- [x] 140.2-11-PLAN.md — one defined outcome for non-JSON 2xx / 204 / 205 / 304 across both clients; `CircuitOpenError` validation (SEAMCORE-11)
- [x] 140.2-12-PLAN.md — the Falsifiability Ledger re-run at the final tree, phase gates, artifact reconciliation — **DONE** 2026-07-27. **56 rows re-executed at `48e6e3e2` (55 as planned + M19R), 55 RED and 1 GREEN.** ⚠️ **M19 (`nx: true → nx: false`) NO LONGER REDDENS** — wave 7's `existing.expiresAtMs > now` early return now fires ahead of the lock write, so a sequential second trip never reaches `set(..., nx)` and the flag became unobservable by R-3. The property (trip idempotency) is still enforced and is still falsifiable via the replacement row **M19R**, which was OBSERVED RED; the `nx` flag ITSELF is now unfalsified and is handed to Phase 141. **M14b's two-test receipt reconfirmed at the final tree** (pin + the behavioural trip-count case, 8 failures total) and all four `fakeRatelimitFor` sites re-verified by code text as taking the hand-typed default — the wave-2 cut held. Gates: coverage 84.57 / 78.52 / 81.78 / 86.68 vs 80 / 72 / 74 / 82 on 9303 passed / 287 skipped (724 files); `tsc` 0; `lint` 0 errors (cache cleared); real-Redis lane 7/7 with its executed-case fence matching; **zero `.py` in the phase diff**; zero new type suppressions; `SEAM_RETRIES` still 0.

*(Re-homed to Phase 140.3 on 2026-07-26: the former 140.2-12 → `140.3-01`, the former 140.2-13 → `140.3-02`. **This is a re-home, not a scope cut** — recorded here so the 14 → 12 drop is not read as work that was dropped.)*

#### Success-criterion adjudication — plan 140.2-12, 2026-07-27

Each verdict is backed by a named receipt observed first-hand at the final tree, or by an explicit
reason. A phase that reports 7/7 by softening a criterion is the failure this programme exists to end.

| SC | Verdict | Evidence |
|---|---|---|
| **SC1** | **SATISFIED** | `resilient-fetch.test.ts > headers arrive, the body then aborts ⇒ exactly ONE recorded failure and a typed SeamBodyReadError`. Falsifier **M26** RED at the final tree — 12 cases across 4 files, incl. `expected DOMException{…} to be an instance of SeamBodyReadError`. |
| **SC2** | **SATISFIED** | Six attributability-class cases in `resilient-fetch.test.ts` + 65 cases in `seam-discriminator.test.ts`. **Both** `text/plain` readings covered (500 ⇒ ZERO, 503 ⇒ ONE on the residual global key). Falsifiers **M25** (3 RED), **M38** (3 RED), **M35** (3 RED), **M39** (4 RED). |
| **SC3** | **SATISFIED** | 69 cases in `seam-constants.pin.test.ts`. **M1–M13 each RED individually**; **M14/M14b/M15/M16/M17** RED; **M24** RED. "Any breaker constant" verified by MEASUREMENT, not by reading the pin file: five supplementary probes beyond the ledger — `BREAKER_LOCK_TOMBSTONE_S`, `BREAKER_STORE_RETRIES`, `BREAKER_STORE_BACKOFF_MS`, `BREAKER_KEY`, `SEAM_RETRIES` — were each mutated and each reddened (3 / 6 / 4 / 3 / 16 cases). **All ten exported breaker and store constants are falsifiable.** |
| **SC4** | **SATISFIED — with one named residual, and adjudicated on evidence rather than on plan 140.2-01's memo.** | The SRH verdict was PASS-EVALSHA, so the PASS arm applies, and it was re-verified first-hand rather than inherited: the lane ran 7/7 against the two digest-pinned containers, its anti-vacuity fence (`EXPECTED_CASES = 7`) matched the 7 cases executed, and **seven mutations were OBSERVED RED against real Redis executing the deployed Lua** — M14 (R-2), M15 (R-5), M16 (R-7), M18 (R-4), M19R (R-3), M20 (R-1), M20R (R-1). Decay and weighted carry-over (M15/M16) and trip idempotency (M19R) are all falsified. ⚠️ **RESIDUAL, stated rather than absorbed: the `nx` flag named in the criterion's own wording is NOT itself falsified any more** (see M19 above). Trip idempotency is; the `nx` mechanism is NOT redundant and is NOT a second layer — it is ORTHOGONAL. The wave-7 early return requires the read to have SEEN a live lock; `nx` guards the case that return structurally cannot reach, namely two Fluid Compute instances that both read `null` and both write. (Wording corrected post-review per W-1: `140.2-VALIDATION.md` §8 called it "a real behavioural difference and a real open falsifier gap" and the ledger was right. **Closed in the review-fix pass** — the `staleReadOnce` hook in `resilient-fetch.test.ts` makes the concurrent read reachable and M19 (`nx: true → nx: false`) was OBSERVED RED again; the same pass also closed HI-01, the tombstone branch that had no exclusion at all, and W-2's `written`-gates-the-emit property.) ⚠️ **Also outside this phase's control:** the 140.1 review recorded `rulesets: []` on this repo — i.e. **possibly no branch protection at all**, which would make `frontend-seam-redis` a gate in the workflow that nothing enforces at merge, along with every other CI gate. **Recorded for the founder; not acted on.** |
| **SC5** | **SATISFIED** | 45 SC-4b cases (15 routes × 3 breaker states), each against the route's **on-disk** `maxDuration`. Falsifiers **M27** (1 RED — the A-09 sentinel), **M29** (1), **M30** (4), **M40** (2), **M41** (24 RED **including the OPEN state**, `expected 360750 to be less than 300000`). |
| **SC6** | **SATISFIED — and two clauses were ADDITIVE work, not tightenings.** | (a) leaf purity — **M21** RED; (b) warmer exclusion — **M23** RED (3 cases); (c) budget-key bindings — **M22** ×3 RED plus **M22b**, which reddens EXACTLY ONE assertion (the roster-completeness mechanism) while all thirteen individual pins stay green. ⚠️ **SC6's health-warmer clause had NO existing guard to extend** — ESLint sets `no-raw-analytics-fetch` to `"off"` on both warmer paths, so this phase BUILT that guard rather than tightening one. The phase is not credited with tightening something that did not exist. |
| **SC7** | **SATISFIED at the CORRECTED scope — 6 reachable / 5 live, not "all nine".** | The corrected wording is in place above (criterion 7), placed by plan 140.2-09 which delivered it, with the reproducible sweep recorded. Delivered scope is the honest one: **five live routes**, not the zero-signature-change shortcut via `runPortfolioOptimizer`/`findReplacementCandidates` that the literal wording would have permitted. Falsifiers **M28** (16 RED), **M44** (48 RED), **M45** (17 RED), **M46** (4 RED), including `two different tenants land in two DIFFERENT per-tenant buckets` and `a claim minted with the WRONG secret degrades to the platform bucket`. |

**Also stated rather than implied:** **SEAMCORE-06's "every Sentry capture" clause is ADDITIVE.** The
seam captured NOTHING to Sentry before this phase — `captureException` / `captureMessage` across the
core, both clients and the three seam routes is zero. Ten `captureToSentry` calls became safe by one
edit at the chokepoint. **No leak was plugged; a mechanism was built.** Falsifiers **M34** (6 RED),
**M33** (3 RED), **M42** (1 RED), **M43** (2 RED).

### Phase 140.3: SEAMUX — Client & wizard seam error surface (INSERTED)

**Goal**: When the seam fails, every surface says something true, offers a way forward that isn't destructive, and tells us it happened
**Depends on**: Phase 140.2 (renders the error TYPES that phase owns), Phase 140.1 (codes originate there)
**Requirements**: SEAMUX-01..09
**Success Criteria** (what must be TRUE):
  1. With the breaker open, every seam-touching surface renders the breaker's own copy — not "our team has been notified", not "we fetched your trades", not "check your credentials", not "validation failed" with zero rows. No surface asserts work happened, or didn't, that the client cannot know.
  2. Drift between any two production copies of a seam error string fails a test; a code emitted by a route is a code the wizard classifier recognises.
  3. Every seam call site fails on an unrecognised or unparseable body rather than treating it as success — in particular, an unrecognised 200 never starts a poll for a job that was never enqueued.
  4. A recoverable seam error always offers a retry; that retry is never the only route to a destructive control (**TRAP-4** — five clicks of our own copy must not destroy a composite draft); `Retry-After` is honoured for the breaker's 503, not only for 429.
  5. A publish or permission gate fed by a drifted analytics response **fails closed** — a key holding trade/withdraw scope can never publish as read-only-verified.
  6. Funnel events carry the specific error code (an outage is distinguishable from a bad file) from every wizard variant, and failures reach Sentry wherever the copy claims they do.
  7. **A failed recompute never leaves the previous result on screen as if it were current.** With suggestions already loaded and the seam then failing, no ranked allocation, weight set or candidate list remains rendered with live action controls — the money-decision hazard B-26 documents, whose fix shape already exists in `WeightOptimizerSection.tsx`.
**Plans**: 17 plans / 16 waves (waves are sequential — `use_worktrees` is false, so they express dependency order, not parallelism). Plans 01 and 02 were re-homed from 140.2 on 2026-07-26; 03–16 planned 2026-07-27. Plan 13 was split into **13a + 13b** at revision round 2 (both wave 13, sequential) — a context measure, never a scope reduction. ⚠️ **This phase's own planning pass must start numbering at `140.3-03`** — slots 01 and 02 are taken. See `140.3-CONTEXT.md`'s handover note for the six ledger rows (M51–M56) and the two hard cross-phase prerequisites that arrived with them.

Plans:
- [x] 140.3-01-PLAN.md — the three Class-5 `typeof body.detail` sites × two contracts; two `WizardErrorCode` union members (TS-05/08/09) — *re-homed from 140.2-12; needs `seam-discriminator.ts` from 140.2-06.* ⚠️ **AMENDED 2026-07-27 at the planning gate:** the membership was a DIFFERENT 3 — `ScenarioCommitDrawer.tsx` dropped (correction C-2: gated on `409/portfolio_fingerprint_stale`; its route imports no seam module), `PortfolioImpactPanel.tsx` added (C-3: a real member, and the file the plan wrongly cited as the safe template). `STATUS_CONTRACT.md` §2.1 corrected in the same task; M51 re-pointed.
- [x] 140.3-02-PLAN.md — `/process-key` consumers branch on `ok`; `X-User-Access-Token` forwarded and scrubbed (TS-01/02/11/12/13/14/15) — *re-homed from 140.2-13; needs `seam-redaction.ts` from 140.2-08 (a SAFETY ordering: the token is a live user JWT)*
- [x] 140.3-03-PLAN.md — the fail-CLOSED publish gate at **both** members of the unchecked-cast class (`finalize-wizard` + `keys/[id]/permissions`, which caches its unvalidated verdict for 60 s) — SEAMUX-07. *Scheduled at the earliest free wave: a security gate, not error rendering.*
- [x] 140.3-04-PLAN.md — `src/lib/seam-copy.ts` leaf + purity guard + cross-copy pin; all 10 production emitters re-pointed; **the 12 test literals deliberately untouched (C-1 / TRAP-9)** — SEAMUX-01
- [x] 140.3-05-PLAN.md — `CIRCUIT_OPEN` becomes a first-class code at `SubmitStep`; `classifyKeyValidationError` reads `body.code` above the cascade; the S-5 parity test (TS-35) — SEAMUX-01/02/08
- [x] 140.3-06-PLAN.md — **THE PHASE'S ONLY PYTHON EDIT.** `400 → 424` at all 7 `VenueTransientHTTPException` sites + fixture + `EXPECTED_STATUS` in one commit (TS-32). Gated by `mypy --strict` + `pytest`.
- [x] 140.3-07-PLAN.md — discard the invalidated result at **both** live B-26 members (`PortfolioOptimizer`, `KeyPermissionBadge`) + `ReplacementPanel` pinned negatively — SEAMUX-09
- [x] 140.3-08-PLAN.md — observe the HTTP outcome at every seam call site (`ApiKeyManager` ×2, `AllocatorMatchQueue`, `WeightOptimizerSection`); kill the `SUPABASE_SERVICE_ROLE_KEY` copy — SEAMUX-05
- [x] 140.3-09-PLAN.md — **PLUMBING first**: a wait field on `WizardErrorContext` and `ErrorEnvelope` (SC4 is unrepresentable today); `Retry-After` honoured for the breaker's 503; TS-34's status half — SEAMUX-06
- [x] 140.3-10-PLAN.md — **the C-8 unit as ONE task**: codes on `keys/sync`'s five arms + the TRAP-3-live transport split + TRAP-4's confirmation. Table-wide TRAP-4 guard — SEAMUX-03/06
- [x] 140.3-11-PLAN.md — TS-19 (both admin routes stop flattening) then TS-18 (render the 424 as a named, recoverable venue state) — SEAMUX-03/04
- [x] 140.3-12-PLAN.md — the copy honesty pass: **7 false-claim strings across 5 codes** (2 more than any source document listed) + TS-09's real copy + TS-17 — SEAMUX-04
- [x] 140.3-13a-PLAN.md — funnel specificity at every wizard variant (`MultiKeyConnectStep` emits nothing today) + **decides the ONE capture policy** + Sentry at 4 of 9 routes (admin/match ×2, `keys/[id]/permissions`, `verify-strategy`) — SEAMUX-08
- [x] 140.3-13b-PLAN.md — the SAME policy applied verbatim at the remaining 5 routes (strategies ×3, `portfolio-optimizer`, `scenario/optimize`) + the **joint 9-of-9 audit** and the mutations — SEAMUX-08. *(13a+13b are a CONTEXT split of one plan, both at wave 13, sequential via `depends_on`; the 9-of-9 obligation is held jointly and neither half may close SEAMUX-08 alone. ⚠️ `csv-validate`'s test lives at `src/__tests__/csv-validate-route.test.ts`, not beside its route.)*
- [x] 140.3-14-PLAN.md — TS-37 (1 of 4 `COMPOSITE_MEMBERSHIP_UNKNOWN` arms gets a permanent code, `KNOWN_FINALIZE_CODES` same commit) + TS-33 (`wizard_session_id`, ONE field) — SEAMUX-03/04
- [x] 140.3-15-PLAN.md — TS-38 (`SEAM_MISCONFIGURED` stops wearing the upstream's envelope) + TS-20 (`correlation_id` reaches the render slot) — SEAMUX-03/04
- [x] 140.3-16-PLAN.md — **phase gate**: negative pins on the four already-strong properties; all 26 ledger rows re-run at the FINAL tree; 7 criteria / 9 requirements / 19 obligations adjudicated. Has a blocking human checkpoint (copy vs DESIGN.md; the destructive path proven in a real flow).

### Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open (INSERTED)

**Goal**: The surfaces stop asserting things we did not measure, stop offering a destructive control as the way forward, and stop attributing our own faults to the user or their venue — and the guards that claim these classes are closed can actually fail.
**Depends on**: Phase 140.3 (renders the error types; this phase closes the rim 140.1-140.3 left open)
**Requirements**: SEAMRIM-01..NN (to be derived at planning from `.planning/reviews/140-SYNTHESIS.md`)

**Why this phase exists**: the end-of-milestone review (14 registers, 5 specialists + 7 red teams + 2 mutation samples, `.planning/reviews/`) adjudicated all 94 original Phase-140 findings at HEAD: **58 CLOSED / 26 PARTIAL / 8 OPEN / 2 SUPERSEDED**. Cluster A (seam core) has **zero OPEN**; cluster B (wizard/client) is 10 CLOSED against **14 PARTIAL + 4 OPEN**. Two independent mutation samples (28 mutations) measured **93% of sampled CLOSED verdicts genuinely guarded** — so the core is real and the rim is where the work is.

⚠️ **The coverage law governs planning** (measured across everything since Phase 140):
| fix mechanism | measured coverage |
|---|---|
| forced through a shared artefact (chokepoint / leaf / table / component) | **100%** |
| hand-typed roster or allow-list | 9/37 codes · 8/15 files · 2/3 codes |
| per-site edit, no artefact | 1/8 · 2/56 · **0/32** |
Any remedy landing in row 2 or 3 is **partial by construction** and must say so.

**Plans:** 14 plans in 4 waves

Plans:
- [ ] 140.4-01-PLAN.md — C-3a: `strategyGate` refuses an unrepresentable span (row 1, both consumers) + the admin publish route's 7 unchecked reads — SEAMRIM-01 *(wave 1)*
- [ ] 140.4-03-PLAN.md — C-2: the CSV double-submit — a `(user_id, wizard_session_id, source)` partial index, the CSV writer, the SQL receipt with its cross-source control, the 23505 arm, the copy — SEAMRIM-03 *(wave 1)*
- [ ] 140.4-04-PLAN.md — the raw-5xx `ast` census (12 sites / 9 triples) against a multiplicity-preserving quarantine; re-runs the mutation that was GREEN — SEAMRIM-09 *(wave 1)*
- [ ] 140.4-05-PLAN.md — a visually-inert `<LiveRegion>` primitive + the 3 measured-regressing surfaces (3 of 27, partial by construction) — SEAMRIM-10 *(wave 1)*
- [ ] 140.4-02-PLAN.md — C-3b: the wizard's 7 unchecked gate reads + a runtime receipt that read-failed ≠ genuinely-empty — SEAMRIM-02 *(wave 2)*
- [ ] 140.4-06-PLAN.md — C-5a: `captureToSentry` returns its promise (copy `audit.ts`), `after()` at the breaker's three sinks, the limiter's timeout sentinel recorded — SEAMRIM-04 *(wave 2)*
- [ ] 140.4-07-PLAN.md — scrub tail A: `keys/sync` (6), `csv-finalize` (6), `verify-strategy` (3) = 15 sites — SEAMRIM-06 *(wave 2)*
- [ ] 140.4-08-PLAN.md — scrub tail B: the remaining 6 import-edge routes (12 sites) + `ratelimit.ts`'s Upstash-token log — SEAMRIM-06 *(wave 3)*
- [ ] 140.4-09-PLAN.md — C-1 (LOW): `csv-validate`'s static 502 + the text-carrying-channel alias rule + the thrown twin — SEAMRIM-06 *(wave 3)*
- [ ] 140.4-11-PLAN.md — C-4: the destructive control must be EARNED — invert the roster into a property (verified count is 1, not 9) — SEAMRIM-07 *(wave 3)*
- [ ] 140.4-14-PLAN.md — the `no-unchecked-supabase-read` ESLint ratchet, scoped to the proven-clean glob — SEAMRIM-11 *(wave 3)*
- [ ] 140.4-10-PLAN.md — derive `SEAM_FILES` from the IMPORT EDGE + `derived == SEAM_ROUTE_BUDGETS` + registry rows and floor — SEAMRIM-06 *(wave 4)*
- [ ] 140.4-12-PLAN.md — the wire↔render vocabulary: translation becomes authoritative; the nested envelope is read — SEAMRIM-08 *(wave 4)*
- [ ] 140.4-13-PLAN.md — C-5b: adopt `rateLimitDenyJson` at the 12 seam call sites + a derived-population posture guard — SEAMRIM-05 *(wave 4)*

### Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth (INSERTED)

**Goal**: What the codebase SAYS about itself is true — in user copy, in comments, in citations, and in the tests that stand in for the contract — so the next phase can trust what it reads.
**Depends on**: Phase 140.4 (SEAMRIM closes the behavioural rim; this closes the descriptive one)
**Requirements**: SEAMPROSE-01..NN (derive at planning from `.planning/reviews/140-SYNTHESIS.md` WP-3, WP-10, WP-12, WP-13, WP-14, WP-15)

**Why this phase exists**: 140.4's planner audited its own source coverage and found six in-scope items it could not fit without recreating the context pressure that forced 140.3's 13a/13b split. **Not a difficulty judgement** — none lacks information or has a dependency conflict. They share almost no files with 140.4's waves, and file-disjointness is what made 140.1–140.3 independently plannable.

**Carried scope:**
1. **The comment/citation-rot class** (CONTEXT §6 of 140.4 named it IN SCOPE; moved here deliberately) — 881 citations, 18 provably past-EOF (15 in two files outside these phases); `keys/[id]/permissions` documents *"5 minutes"* vs `revalidate: 60`; `sentry-capture.ts` claims *"the seam captures nothing to Sentry"* when it is **41 sites across all 15 routes**; the contract registry says *"exactly three predicates"* (five) and *"the six seam files"* (eight, and the guard's own docblock says EIGHT). ⚠️ **7 of 17 comment findings were 140.2 comments falsified by 140.3 commits in the same range** — no phase re-measures what its predecessor wrote down.
2. ⭐ **`Retry-After` travels** — honoured at **1 of 4** surfaces; chokepoint is `process-key-client`, then 5 `buildEnvelope` threads. **HARD PREREQUISITE FOR PHASE 141** — retry-with-backoff consumes `Retry-After`, so 141 must not land on plumbing that reaches one surface in four.
3. `SERVICE_UNREACHABLE` at the three transport catches; the dead `"timed out"`/`"timeout"` branch (**B-02, a confirmed OPEN finding** — the commonest Railway outage still renders `UNKNOWN`); `fetchLivePermissions` carrying `{status, code, retryAfterSeconds}`; `PERMISSION_DENIED` + scope codes in `VENUE_WIRE_CODE_TO_VERDICT`.
4. Harness fidelity: `vi.unstubAllGlobals()` + env snapshot in `src/test-setup.ts`; `ci.yml`'s skip regex; `/\bimport\s*\(/` in the four purity pattern sets.
5. `mintTenantClaim(payload: string, secret: string)` — two adjacent same-typed strings (**latent type hazard, NOT a live attacker path** — orchestrator-resolved); `probe_error: z.boolean()`; `SeamBreakerVerdict` as a discriminated union.
6. Test fidelity: the six wrong 429 shapes, the `500 + retryable:true` body `_validate` refuses to construct, the 424 tested where it cannot arrive.
7. ⭐ **DEF-140.4-C — forwarded upstream 4xx renders as "your CSV is invalid"** (`.planning/phases/140.4-*/deferred-items.md`). Found in a **live browser QA pass** (2026-07-29) uploading a real founder CSV, and independently rediscovered server-side by 140.4's code reviewer as CR-02. The fix round closed the **502** arm and the duplicated title/body (`CsvValidationEnvelope.tsx:56,69` rendered `human_message` as heading AND cause when `errors.length === 0`). **Still live: the `!result.ok` arm forwards upstream verbatim, so a 401 — and equally 403/404/409 — lands on `CSV_VALIDATION_FAILED`.** Deliberately not point-fixed in 140.4: this is the instance-not-class shape that phase exists to stop. Close it as ONE rule over every forwarded upstream status. Also open on the same panel: the copy promises a per-row breakdown that does not render when there are no row-level errors.
8. **The plan-to-plan hand-off hole, twice in 140.4** — a defect class this phase should consider guarding, not just fixing. `SEAM_MISCONFIGURED` reached two wizard clients as `UNKNOWN` because plan 12's GREEN landed before plan 13's and neither plan's `## OPEN` named it; `eslint.config.mjs:175-181` still cited a blocker plan 12 had already removed (measured 0 violations). Both are "plan A's premise falsified by plan B in the same phase, with no re-measurement." Note the fixer's own residual: **no guard asserts that every wizard client consuming a `rateLimitDenyJson` route consults the shared wire→wizard table**, so the hole reopens at whichever client lacks the hop.

**Binding inheritance**: 140.4's CONTEXT §2 (coverage law) and §3 (a grep proves a state; only a guard proves it is held) apply unchanged.

⚠️ **Two false premises 140.4 left corrected — do not re-derive them from stale docblocks**: (a) the wire→wizard table and the client rosters are **NOT disjoint** — `KNOWN_KICKOFF_CODES` shares `RATE_LIMITED` — so the safety property is **agreement**, not disjointness; (b) `VALIDATION.md`'s "no guard to falsify" claim for the thrown twin was false (row M109), and the surviving "no row possible" count is **two**, not three.

**Plans:** 8/8 plans complete

Plans:
- [ ] **W1** · 01 — harness fidelity flip + `source-scan.ts` + purity needles *(lands ALONE: the leak closure is TRAP-8 sequence-sensitive, and it creates the comment-handling module every later guard imports)*
- [ ] **W2** · 02 — `wizardErrors` vocabulary owner + B-02 + venue codes *(publishes the §4a interface plan 05 consumes)*
- [ ] **W2** · 03 — `Retry-After` travels + `SERVICE_UNREACHABLE` at all five transport catches ⭐ *HARD PREREQUISITE FOR 141*
- [ ] **W2** · 04 — citation/prose corrections, repo-wide
- [ ] **W3** · 05 — the CSV class fix ⭐ *DEF-140.4-C and the §6 hand-off hole closed as ONE defect at row 1*
- [ ] **W3** · 06 — test fidelity + spec-disabling guard
- [ ] **W3** · 07 — type invariants
- [ ] **W4** · 08 — seam-surface conversion remainder + the citation guard + ALL guard registrations + phase gate *(guard lands AFTER conversions — "fix before guard"; single owner of `contracts-registry.test.ts`, which kills the same-wave floor-bump conflict that made plans 10 and 13 collide in 140.4)*

### Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit
**Goal**: Transient Railway blips self-heal — but ONLY for calls with a traced idempotency proof, so a retry can never double-execute a side effect
**Depends on**: Phase 140 (retry must respect the breaker and use the unified budgets)
**Requirements**: SEAM-05, SEAM-06
**Success Criteria** (what must be TRUE):
  1. A committed in-repo audit artifact maps every seam function and `/process-key` `flow_type` to retry-safe yes/no with traced server-side side-effect evidence — including the previously-unaudited `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge set — and resolves whether `_get_recompute_lock` is distributed or process-local. Everything unproven defaults to no-retry.
  2. Under an injected single transient failure, an allowlisted call (e.g. `flow_type: resync`) succeeds on retry with exactly ONE server-side effect — proven against the real `compute_jobs` partial-unique-index + `WIZARD_DUPLICATE` contract.
  3. `flow_type: teaser` is provably never retried, and a regression test pins the contract (two identical teaser calls → TWO `strategy_verifications` rows) so a future refactor can't quietly start retrying it and minting duplicate verifications/`public_token`s/leads.
  4. With the breaker open, zero retry attempts fire — no bypass path exists, so retries cannot amplify an outage.
**Plans**: TBD

### Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL
**Goal**: A mid-job worker crash can no longer strand a `strategy_analytics` row on `computing` forever — a wizard poll or page refresh sees a real terminal outcome
**Depends on**: Phase 141 (SEAM error taxonomy informs re-enqueue-vs-terminal decisions; JOB sequenced after SEAM)
**Requirements**: JOB-01, JOB-02, JOB-03, JOB-07
**Success Criteria** (what must be TRUE):
  1. A `strategy_analytics` row stuck in `computing` past the derived threshold with NO active `compute_jobs` row is transitioned by a recurring pg_cron reaper to a TERMINAL `failed` state carrying a user-recoverable message — superseding the one-off `reset_stuck_computing_rows.py` script.
  2. A row with a fresh `updated_at` but an old `computing_started_at` IS reaped, and a row with an old `updated_at` but a fresh `computing_started_at` is NOT — proving the reaper keys on the dedicated writer-stamped `computing_started_at` (set in the SAME statement that sets `computation_status='computing'`), never the 106-janitor-revert `updated_at`/`computed_at` mistake.
  3. A CI invariant (mirroring `test_every_kind_has_watchdog_headroom`) fails if any relevant handler's batch-inclusive worst case exceeds the reaper threshold — the threshold is re-derived from `strategy_analytics`'s own batch-tail math, never copied from the `compute_jobs` 4h number.
  4. A large synthetic backlog does not stall worker `healthz` past `STALE_THRESHOLD` — the JOB-07 regression test proving no reaper/sweep work runs on the worker's shared asyncio event loop (the WEDGE-01 crash class this janitor exists to clean up after).
**Plans**: TBD
**Note**: JOB-07 is a cross-cutting constraint — Phases 143/144/145 must also keep their mechanisms off the worker loop (pg_cron by construction), but the REQ-ID and its regression test land here only.

### Phase 143: JOB — Dropped-enqueue reconciliation sweep
**Goal**: "`after()` never ran at all" enqueue drops — architecturally invisible from inside the route handler — are detected by absence and healed
**Depends on**: Phase 142 (same three-table triangle; scheduled as one non-racing mechanism)
**Requirements**: JOB-04
**Success Criteria** (what must be TRUE):
  1. A strategy with persisted daily-returns data but NO `compute_jobs` row of ANY status and no terminal `strategy_analytics` row, past a grace window, is re-enqueued by a pg_cron sweep and a Sentry alert fires — the hole the in-closure `writeFailedStrategyAnalyticsPlaceholder` guard structurally cannot catch.
  2. Running the sweep twice in a row produces no duplicate job (re-enqueue is idempotent via the existing partial unique index).
  3. A strategy inside the grace window, or with any existing job row, or with a terminal analytics row, is never touched by the sweep.
**Plans**: TBD
**Note**: Constrained by JOB-07 (Phase 142) — sweep runs in pg_cron, never the worker loop. Needs a short design pass on "what counts as orphaned" per strategy source (csv vs wizard vs resync) before it becomes one migration.

### Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence
**Goal**: An orphaned `running` compute job terminates VISIBLY — pollers break out, the audit trail survives — resolving the founder's open WR-02 DELETE-vs-reset call
**Depends on**: Phase 143 (JOB sequence; independent mechanism on `compute_jobs`)
**Requirements**: JOB-05
**Success Criteria** (what must be TRUE):
  1. An orphaned `running` `compute_jobs` row (past the UNCHANGED 4h `claimed_at` threshold) transitions to a terminal `failed` status instead of being DELETEd — so a wizard poller sees a real outcome and the row survives for audit until the existing 30/90-day retention crons delete it.
  2. Detection latency drops from ~24h to the tightened cadence (e.g. hourly) while a legitimate batch-tail job under 4h is never touched — the threshold, not the frequency, is what protects live jobs (the WORKER-04 2h→4h lesson).
  3. The change ships as a NEW migration layered on `20260720120000` (the shipped migration is never edited), reconciling the TEST-DELETE / PROD-reset split into ONE behavior.
**Plans**: TBD
**Note**: The "fence flake also clears" claim is observation-only, NOT an acceptance criterion (research correction #4). Constrained by JOB-07 (pg_cron only).

### Phase 145: JOB — csv-finalize atomicity (reproduce-first)
**Goal**: A mid-request csv-finalize failure leaves no orphan strategy row — and no budget is spent re-fixing the likely-stale 42501 bug
**Depends on**: Phase 144 (JOB sequence; order-independent within JOB — last because its scope needs the reproduction result first)
**Requirements**: JOB-06
**Success Criteria** (what must be TRUE):
  1. A documented reproduction attempt of the 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim against current `main` exists (committed pass/fail) BEFORE any fix is scoped — "could not reproduce" is a valid, budget-saving outcome.
  2. A fault injected between `finalize_csv_strategy`, `persist_csv_daily_returns`, and the `after()` enqueue leaves no orphan strategy row — either the steps share one SECURITY DEFINER transaction, or explicit compensating cleanup runs + Sentry alerts (the choice recorded per the reproduction outcome and the CONTRIB-02 `p_terminal_status` owner-only variant's survival).
  3. Happy-path csv-finalize behavior is unchanged — including the CONTRIB-02 owner-only private-finalize path if the RPCs are folded.
**Plans**: TBD
**Note**: Constrained by JOB-07 (any cleanup mechanism stays off the worker loop).

### Phase 146: RATE — Audit + close the two verified gaps
**Goal**: Every authed route hitting the Python service has the RIGHT rate limit — and a newly-added route can't silently ship with none
**Depends on**: Nothing upstream (mechanical; sequenced last so its gap list comes from a fresh grep)
**Requirements**: RATE-01, RATE-02, RATE-03, RATE-04, RATE-05
**Success Criteria** (what must be TRUE):
  1. A committed kickoff re-grep artifact lists every `src/app/api` route calling either seam client × its `checkLimit` status — the authoritative gap list, replacing the stale `TODOS.md` route list (which named seven routes that were already limited).
  2. Burst requests to `admin/match/eval` beyond a per-`user.id` limit sized to real eval-tooling cadence receive `429` + `Retry-After`.
  3. Requests hitting Railway's `routers/match.py` (`/recompute`, `/eval`) directly — bypassing Vercel with a leaked `X-Service-Key` — are rejected `429` by server-side slowapi limits mirroring `portfolio.py`'s pattern (defense-in-depth).
  4. A committed audit of the seven existing limiter VALUES against real Python-side cost exists, with adjustments applied where a value was wrong — the substantive remaining RATE question.
  5. A `withRateLimit(handler, limiter)` HOF exists and composes alongside `withAuth`/`withRole`, wired on the routes this phase touches — so the no-CI-gate hand-wiring weakness has a structural successor.
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 140. SEAM core + breaker | 7/7 | Complete   | 2026-07-25 |
| 140.1. PYAPI contract/status/limiter (INSERTED) | 9/9 | Complete | 2026-07-26 |
| 140.1.1. PYAPI-FIX (INSERTED) | 7/7 | Complete    | 2026-07-26 |
| 141. SEAM retry (audit-gated) | 0/? | Not started | - |
| 142. JOB reaper + DDL | 0/? | Not started | - |
| 143. JOB dropped-enqueue sweep | 0/? | Not started | - |
| 144. JOB WR-02 terminal UPDATE | 0/? | Not started | - |
| 145. JOB csv-finalize atomicity | 0/? | Not started | - |
| 146. RATE audit + close | 0/? | Not started | - |

## Requirement Coverage (v1.16)

| Phase | Requirements |
|-------|--------------|
| 140 | SEAM-01, SEAM-02, SEAM-03, SEAM-04 |
| 141 | SEAM-05, SEAM-06 |
| 142 | JOB-01, JOB-02, JOB-03, JOB-07 |
| 143 | JOB-04 |
| 144 | JOB-05 |
| 145 | JOB-06 |
| 146 | RATE-01, RATE-02, RATE-03, RATE-04, RATE-05 |

18/18 v1 requirements mapped, each to exactly one phase. No orphans.

---

## Shipped Milestones

> Collapsed index — one line per shipped milestone. Full per-milestone detail
> lives in `.planning/MILESTONES.md` and the `.planning/milestones/` archives.
> (Rebuilt 2026-07-25 from MILESTONES.md after a truncation accident; the prior
> inline v1.12/v1.13 detail sections were duplicative of their archives.)

- ✅ **v0.14.0.0 — Sprint 8: Bridge V2**
- ✅ **v0.15.0.0 — Sprint 9: Demo-to-Production**
- ✅ **v0.16.0.0 — Phase 11: Onboarding & Security Readiness**
- ✅ **v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2**
- ✅ **v1.0.0 — API-Key Rewrite** (Diagnose → Fix → Unify → Ship to LPs)
- ✅ **v1.1.0 — Scenario Analysis** (Surface → Honesty → Persist → Read → Quant)
- ✅ **v1.2 — Allocator Cohesion** (tag `v1.2` @ `11775460`)
- ✅ **v1.2.1 — scenario-tab-hardening** (tag `v1.2.1` @ `e5e4f3d2`)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** (tag `v1.2.2` @ `43e57dd0`)
- ✅ **v1.3 — Mobile & Adaptive UI** (2026-06-28)
- ✅ **v1.4 — Frontend Excellence** (tag `v1.4` @ `4c4ca537`)
- ✅ **v1.5 — Scenario Coverage-Window Blend** (tag `v1.5` @ `f8b502e7`)
- ✅ **v1.6 — Scenario Series-Space Purification** (tag `v1.6` @ `f78f036b`)
- ✅ **v1.7 — Deribit Exchange Coverage & Carry-Forward Burn-Down** (tag `v1.7` @ `9a1e7b8e`)
- ✅ **v1.8 — Flow-Aware Time-Weighted Returns + Native-Unit NAV** (tag `v1.8` @ `eb8e357e`)
- ✅ **v1.9 — Multi-Key Composite Strategy** (tag `v1.9` @ `044bee50`). Archive: `milestones/v1.9-ROADMAP.md`.
- ✅ **v1.9.1 — Composite Onboarding Hardening** (tag `v1.9.1` @ `be215b15`). Archive: `milestones/v1.9.1-ROADMAP.md`.
- ✅ **v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification** (2026-07-15). Archive: `milestones/v1.10-ROADMAP.md`.
- ✅ **v1.11 — Scenario Composer v2** (tag `v1.11` @ `a42f4bcf`, Phases 109–117). Every source is a daily-series constituent under a coherent manager/allocator role model. Archive: `milestones/v1.11-ROADMAP.md`.
- ✅ **v1.12 — sFOX Verified Integration (Foundation, flag-OFF)** (tag `v1.12` @ `92be47af`, Phases 118–123). Live sFOX `api_verified` foundation shipped dormant; go-live re-homed to v1.13. Archive: `milestones/v1.12-ROADMAP.md`.
- ✅ **v1.13 — Infra: sFOX go-live foundation + worker rebuild** (tag `v1.13`, Phases 125–130, shipped FLAG-OFF 2026-07-19, closed 2026-07-22). Railway static-egress + worker rebuild + trust-tier SECDEF. Archive: `milestones/v1.13-ROADMAP.md`.
- ✅ **v1.14 — Smoothed options MTM (third factsheet basis)** (tag `v1.14` @ `0adde939`, v0.48.0.x, Phases 131–133, shipped + flipped LIVE 2026-07-23; PRs #633 + #635). Additive third `pnl_basis` `smoothed_mtm` (daily ΔMTM redistribution, total-preserving; cash/MTM byte-identical). Archive: `milestones/v1.14-ROADMAP.md`. Review: `v1.14-BIG-REVIEW.md` (SHIP).
- ✅ **v1.15 — MetaTrader 5: live api_verified account sync** (tag `v1.15`, v0.49.0.0→v0.49.4.0, Phases 134–139, shipped DARK 2026-07-24 + flipped LIVE 2026-07-25; PRs #636 + #637/#640/#641/#642). Self-hosted Wine gateway + `mt5linux` net client → deal-ledger equity reconstruction → the ONE backbone with `api_verified`; √252 traditional; 3-field creds. Prod gateway private+live, Vantage acct 26547876 soaked green, flags flipped LIVE. Archive: `milestones/v1.15-ROADMAP.md` + `v1.15-REQUIREMENTS.md`. Audit: `v1.15-MILESTONE-AUDIT.md`.

## Current position

**v1.16 Production Resilience & Reliability** — roadmap created 2026-07-25, Phases 140–146.
Next: `/gsd:plan-phase 140`.

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
