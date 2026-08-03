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
- [ ] **JOB-05**: The existing orphaned-`running` `compute_jobs` purge transitions rows to a terminal `failed` status instead of bare `DELETE` (so pollers break out and the audit trail survives), at a tightened cadence with the 4h `claimed_at` threshold UNCHANGED; delivered as a NEW migration layered on `20260720120000`, reconciling the TEST-DELETE / PROD-reset split (WR-02).
- [ ] **JOB-06**: The stale 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim is reproduced against current `main` before any fix is scoped (documented pass/fail); the genuinely-open gap — csv-finalize's three-step RPC → RPC → `after()` sequence having no wrapping transaction — is closed by either one SECURITY DEFINER transaction or explicit compensating cleanup + Sentry, so a partial failure leaves no orphan strategy row.
- [ ] **JOB-08**: The retention family's **stale-`pending` gap is decided on measured evidence, not skipped by default**. `retention_compute_jobs_done` (jobid 4), `retention_compute_jobs_failed` (jobid 8) and `retention_compute_jobs_orphaned_running` (jobid 11) exist; **nothing sweeps stale `pending`** — the one status an undrained enqueue cron produces. A committed measurement of the stale-`pending` population **on PROD** exists BEFORE any sweep is scoped, and the outcome is EITHER a sweep added as a fourth swept status using JOB-05's terminal-UPDATE pattern, OR an explicit WON'T-FIX carrying that measurement as evidence — **"population is zero on prod" is a valid, budget-saving outcome** (same measure-first shape as JOB-06). ⛔ The sweep, if built, transitions to a terminal status and NEVER `DELETE`s: a `DELETE` of `pending` under `supabase/migrations/**` auto-applies to PRODUCTION on merge and destroys real queued work. Evidence that the gap is real on the TEST project (where it is certain, since TEST has no draining worker): the `derive-allocator-key-dailies` cron fanned out 1,884 `derive_broker_dailies` rows on 2026-08-02, and because `claim_compute_jobs_with_priority` orders by `next_attempt_at` ASC before `LIMIT p_batch_size`, the backlog sat permanently at the head of the claim queue and starved every live claim test — 10 deterministic `python` failures on ANY branch including main, cleared only by hand. ⛔ Do NOT close this by `cron.unschedule(9)`: `supabase/tests/test_derive_allocator_keys_fanout.sql` assertion 6 requires that cron registered, so unscheduling reddens the `sql-tests` gate instead.
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

- [x] **PYAPIFIX-01**: the `/process-key` duplicate reply and its consumer agree on one contract, proven by a test that exercises the **real** Python response against the **real** TypeScript guard — not two suites each mocking the other. *(H-5: `routers/process_key.py:680-690` emits `queued:true` with `code`/`idempotent`; `finalize-wizard/route.ts:1433-1450` rejects that shape → Sentry + 502.)* ⚠️ **Two corrections, both source-verified:** the guard is **NOT deployed** (Phase 140's commit `57b11813` on this same unmerged branch) so there is no rollout-ordering constraint — choose the fix on contract quality; and **no live caller can trigger the 502 today** (`finalize-wizard`/`keys/sync` contain zero `wizard_session_id`; the duplicate path requires a caller-supplied one per `process_key.py:977-979`). This is contract incoherence with a live trap arm, **not** a production break. Also absorb the unowned **M-11 re-triage**: onboard has no request-level double-submit protection, only job-level dedupe.
- [x] **PYAPIFIX-06**: `error_contract.py`'s remaining guard gaps are closed, breaking a **circular deferral** — no downstream phase can reach them (140.2/140.3 are TypeScript-only by their own CONTEXTs; 146 is a rate-limit phase). **(a)** A `429` carrying `Retry-After` is constructable — today `retry_after` requires `retryable:true` while the CALLER arm raises on it (`_validate`, `:146-155` + ~`:100`), yet `140.1-VERIFICATION.md` gap 1 and obligation TS-23 both mandate migrating the two in-handler 429 sites onto that envelope. **(b)** The `>=500` arm rejects a venue `dependency` — today `service_error(500, "X", dependency="binance", retryable=False)` validates, and **Phase 140.2 keys the breaker on `dependency`**, so a venue name on a 500 poisons a breaker key. *(M-1, M-2 — same function PYAPIFIX-04 already opens; excluding them half-closes the class in the phase whose stated principle is "enforce, don't document".)*
- [x] **PYAPIFIX-02**: A fault at the caller's venue answers **424/retryable** at every site a Python-side change can correct without depending on an unlanded TypeScript obligation, with the remainder (`routers/exchange.py:145`, `:152`, `:505`) enumerated and blocker-named (**BLOCKED-BY: TS-05** — migrating them to `service_error(424)` turns `body.detail` from scalar to object, which `src/lib/analytics-client.ts:177-180` feeds into `classifyKeyValidationError` as `"[object Object]"` → terminal UNKNOWN dead-end render), not 403 — implemented as a **permanent-code ALLOW-LIST** (never a transient denylist), the class closed rather than point-fixed, and no body contradicting itself (`recoverable:false` beside "Try again in a moment"). *(H-1.* ⚠️ **Corrected at source 2026-07-26:** `/exchange/validate-key` does **NOT** already handle this — `read_only is False` appears exactly twice repo-wide (`process_key.py:1297`, `long_fetch.py:331`); the real analog is `long_fetch.py:386-397`. The research's **transient denylist fails unsafe — it is the existing bug's own shape**. `MISSING_SCOPE` **must** be allow-listed (`exchange.py:1047-1058` sets `read_only=False` + that code without `valid=True`, and it is absent from `long_fetch`'s `permanent_codes`) or a permanent scope fault becomes a retryable 424. The review also **missed `process_key.py:358-359`'s `recoverable` set**, which omits `PROBE_FAILED`/`DDOS_PROTECTION` — no status-code change fixes that.)*
- [x] **PYAPIFIX-03**: A failure in code that performs **no network I/O** is attributed to us (500), never to the caller's venue — so it counts, and someone is paged, **at all three sites**. *(H-2: `internal.py:416-431`. ⚠️ **Corrected 2026-07-26 — this is a 3-site class, not 1**: the pattern-mapper found `routers/portfolio.py:2266`, and the **same function's second `create_exchange` at `:2316` already answers 500**, which is in-repo proof the class is real. The instance-not-class defect this programme exists to catch.)*
- [x] **PYAPIFIX-04**: The `body.detail.detail` scalar guarantee is **enforced by a guard**, matching every other rule in `error_contract.py`, because Phase 140.2 renders from it. *(H-3)*
- [x] **PYAPIFIX-05**: Every one of the 12 surviving mutations turns a test RED, re-run and observed first-hand — including the ccxt-subclass narrowing that survived **twice** while making `RateLimitExceeded` answer 500, and `default_platform_key` returning `""`, which makes slowapi **skip limiting entirely** and ships green. *(H-4 + the Medium mutation set.)* **Also folds in M-15** — `tests/test_process_key_200_discriminator.py:416-424` asserts `len(_SHAPES) == 6` against a list literal **in the same file**, and its docstring's claim that a seventh return site reddens it is false. A toothless *Python* test squarely inside this phase's goal, which the "12 survivors" wording would otherwise skip and whose triage destination (140.2) cannot edit Python.

### PYAPIFIX2 — Surviving findings from the 140.1.1 review cycle (Phase 140.1.2)

> From 5 Stage-1 lenses + 5 Stage-2 red teams over `56fb7167..39688d69`. **An adversarial refutation
> pass refuted 4 of 10 findings outright and reduced 3 more** — the list below is only what survived.
> Evidence: `140.1.1-STAGE1-FINDINGS.md`, `140.1.1-STAGE2-FINDINGS.md`, `140.1.1-REVIEW.md`.
> **All five code items are Python; Phase 140.2 is TypeScript-only by its own CONTEXT, so they have
> no other home** — the same circular deferral that forced PYAPIFIX-06 into 140.1.1.

- [x] **PYAPIFIX2-01** *(HIGH)* — ⚠️ **PYTHON HALF CLOSED (7/7 sites carry code+recoverable); RENDER HALF → OB-1, owner 140.3** (ledger row **TS-35** in `140.1-TS-OBLIGATIONS.md` carries it, with `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json` as its parity input). Not a bare tick: ROADMAP SC1 also demands that a Binance-maintenance-shaped failure *no longer renders* as `UNKNOWN`/500 with no retry affordance, and that render assertion is **not delivered by this phase** — `create-with-key/route.ts` returns the status the classifier computed and the upstream status is discarded (RESEARCH C-1), so it can only be fixed in TypeScript. The venue-transient class is closed at **every** consumer of `validate_key_permissions`, including the **live key-connect route**. Today `routers/exchange.py:522` (`/api/validate-key` — used by `create-with-key`, `composite/add-key`, `keys/validate-and-encrypt`) and `routers/portfolio.py:2322` collapse `RATE_LIMITED`/`DDOS_PROTECTION`/`EXCHANGE_UNAVAILABLE`/`NETWORK_UNAVAILABLE`/`PROBE_FAILED` into an opaque 400 with no `code` and no `retryable`. **The arm 140.1.1 fixed serves teaser/csv/internal_report; the unfixed one carries strictly more real traffic.** Traced consequence: `EXCHANGE_UNAVAILABLE` and `NETWORK_UNAVAILABLE` fall through `classifyKeyValidationError`'s substring cascade (`wizardErrors.ts:967-1035`) to **`UNKNOWN`/500 "our team has been notified" with no retry affordance** — the DOGFOOD-3 dead end that cascade exists to kill. Also enumerate `_validate_mt5_key`'s three classified-upstream 400 arms (`exchange.py:335`, `:345`, `:361`), which sit outside TS-32's carve-out.
- [x] **PYAPIFIX2-02** *(reproduce-first)* — **REPRODUCED, then FIXED** (plan 01): `error_kind="transient"` was observed first-hand on **both** codes through the real `Mt5Adapter`, so the gate opened and the fix landed — permanence is now **stated by the adapter** (provenance), not by a fifth string list. A permanent MT5 credential fault is not classified as a recoverable venue fault. `MT5_WRONG_SERVER` (`services/ingestion/mt5.py:104`) and `MT5_MASTER_PASSWORD` (`:224`) are absent from **both** `PERMANENT_VALIDATION_ERROR_CODES` and `long_fetch.py:391`'s local `permanent_codes`, so on the live worker path they yield `error_kind="transient"` → **3 gateway-serialised retries → `failed_final`** for a credential that can never succeed. **MT5 is `ENABLED=true` in production.** The TS side already classifies both as 400 client faults (`wizardErrors.ts:1002/1005`) — **Python and TypeScript hold opposite verdicts on the same codes.** ⚠️ **Reproduce the worker path before scoping** — one red team held that MT5 branches before `create_exchange` and never calls `validate_key_permissions`; "could not reproduce" is a valid, budget-saving outcome.
- [x] **PYAPIFIX2-03** — closed (plan 02): the raw `HTTPException(429)` now goes through `service_error(429, "RATE_LIMITED", retryable=True, retry_after=...)`, giving that builder arm its first consumer; the `error_contract.py` comment it invalidated was inverted in the SAME commit. `/internal` throttling emits the service's own envelope. `routers/internal.py:226` raises a raw `HTTPException(429)` one line from a builder arm that would validate it cleanly — so the 429 arm added in 140.1.1 has **zero call sites** and the response carries no `code`. *(Its consumer additionally launders the 429 into `502 / PROBE_FAILED`, discarding the `Retry-After` — that half is TypeScript and belongs to 140.3.)*
- [x] **PYAPIFIX2-04** — closed (plan 02): all four user-facing 429s carry `Retry-After`. Every **user-facing** 429 carries a `Retry-After`. Four do not: `match.py:1742`, `portfolio.py:1960`, `simulator.py:249` (+ `portfolio.py:2245` on a dead route). This is the 429-shaped hole in the "503 carries `Retry-After`; honour it" rule.
- [x] **PYAPIFIX2-05** — closed (plan 04): `_SHAPES` is bound to the router's AST by a one-to-one containment oracle (router source AST vs live HTTP bodies — two artifacts, never a count). Falsifiability OBSERVED: deleting a row reddens naming the uncovered fingerprint, and the M-15 fence still reddens on a 7th 200-capable return. The 200-discriminator corpus cannot silently shrink. 140.1.1 deleted `test_pyapi_10a_exactly_six_shapes_are_covered` as self-referential — correctly — but it was **also** the only guard on `_SHAPES`, and the AST fence that replaced it does not read `_SHAPES` at all. **Deleting a row was OBSERVED to survive** (141→140 passed). One assertion, bound to the fingerprint set.
- [x] **PYAPIFIX2-06** — closed (plans 02 + 04): all four artifact items corrected, each replacement coordinate RE-DERIVED by reading source at current HEAD (never `old + N`); the fifth item was a scope collision, settled below. The phase's own artifacts state only what they can support. `140.1.1-VERIFICATION.md` must read `gaps_found`: its Direction-2 claim *"no already-correct test was weakened or removed"* is **false** (two tests were deleted; one is missing from the deletions table), and PYAPIFIX-02's carve-out completeness was evidenced by `grep -c "BLOCKED-BY: TS-05" → 1`, which proves a marker exists, not that a list is complete. In `docs/STATUS_CONTRACT.md`: the "not seam-reachable" list's `exchange.py:491` **currently points at a live 424 arm**; S-11's `internal.py:414` is wrong (at HEAD `2c55ece0` the `except Exception:` is `:442` and the `service_error(500, "ADAPTER_INIT_FAILED", ...)` raise is `:471`; the `:421`/`:450` pair quoted here was itself read at `39688d69` and has since drifted — which is the point); `## 1. The four classes` heads a **five**-row table. ⚠️ **Do NOT run a general comment sweep** — the "six refs off by the inserted-line count" diagnosis was **refuted**; most drift pre-dates the phase, so any number recomputed as old+18 would be wrong.
  - ⚠️ **W-1 — location clause corrected.** This requirement originally placed the 6/7→6/10 census *"In `docs/STATUS_CONTRACT.md`"*. **That was false.** The census is a CODE COMMENT at `analytics-service/services/error_contract.py` ≈:158-163. The planner settled the scope collision as a fenced comment-only exception and it landed in plan 02 (`e5aead5d`), with the arithmetic re-derived by AST — **6 of 16** `service_error(500, …)` sites carry `dependency` — never as `7 + 3`. Plan 04 therefore touches no code for this item. Leaving the false location on a ticked requirement would be the identical defect class this requirement exists to correct.

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
    - *Query half* (Plan 140.1-02, commit `ca9a9235`): **both** service-role read sites now scoped — the duplicate pre-check (`routers/process_key.py:930`) and the 23505 race-winner re-fetch (`:1009`), each filtering `strategy_id` AND `wizard_session_id`. The pre-check had to **move** below the `strategy_id is None` branch before it could be scoped at all. A `strategies` id+user_id ownership gate runs ahead of the first read (403 `STRATEGY_NOT_OWNED`), because `strategy_id` is caller-supplied and a scoped read alone is necessary-not-sufficient. Proven by pytest oracles PYAPI-01d (one per read site) and PYAPI-01e; mutation M2 (drop the scoping from the race site only) reddens the race oracle while the pre-check oracle stays green.
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
  - ⚠️ **FINDING-10 open**: `routers/simulator.py:92` is a TENTH IP-keyed route (`simulator:ip:<addr>`) that the plan's do-not-touch list calls "correctly user-keyed". Reported, quarantined by an equality gate, NOT fixed — needs its own plan.
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
    - *`/health` half closed by 140.1-08*: `main.py:768-769` adds `config_ok` (the secret verdict,
      deliberately NOT crossed with the worker-heartbeat `status`) and `config_degraded_secrets`
      (names only), plus `REQUIRED_PLATFORM_SECRETS` + a lifespan startup assertion whose
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
| JOB-05 | Phase 144 | Pending |
| JOB-08 | Phase 144 | Pending |
| JOB-06 | Phase 145 | Pending |
| JOB-07 | Phase 142 | Pending |
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
