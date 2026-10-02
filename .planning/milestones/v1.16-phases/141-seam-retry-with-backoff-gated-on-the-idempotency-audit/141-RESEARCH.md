# Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit — Research

**Researched:** 2026-07-31
**Domain:** Vercel→Railway seam resilience — bounded retry gated on a per-flow_type / per-seam-function idempotency audit
**Confidence:** HIGH (all findings traced to source at current HEAD on `feat/v1.16-production-resilience`; zero new packages)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Retry policy:** exactly ONE retry, **fixed backoff + jitter** (jitter to avoid synchronized retry storms across concurrent callers).
- Must fit **inside the existing seam-budget reservation** (CONTEXT claims the constants "already reserve ~4.3s of retry backoff"). **Do NOT widen the timeout budget** — the retry loop consumes the already-reserved backoff, it does not add to the deadline. ⚠️ See **Open Question 1** — this claim is only partially borne out by the code; the planner must reconcile it against the current SC-4b arithmetic before writing tasks.
- The retry respects the Phase-140 breaker and the unified per-flow budgets.
- **Allowlist / audit = ONE typed code registry** that is simultaneously the committed SC1 audit AND the runtime enforcement. The documented verdict and the runtime allowlist cannot drift.
- The retry wrapper reads this registry; **anything not present-and-proven-safe defaults to no-retry by construction** (absence semantics, not a separate rule).
- Each registry entry carries its **traced server-side side-effect evidence** alongside the yes/no verdict.
- **Default posture:** unproven → no-retry (SC1).
- **`teaser` provably never retried** (SC3). Regression pin: two identical `teaser` calls → TWO `strategy_verifications` rows. `teaser` is deliberately NON-idempotent.
- **`resync` (allowlisted) retries with exactly ONE server-side effect** under an injected single transient failure (SC2) — proven against the real `compute_jobs` partial-unique-index + the `WIZARD_DUPLICATE` idempotency contract.
- **Breaker open → zero retry attempts** (SC4) — no bypass path.
- **Audit MUST classify:** `/process-key` flow_types `teaser`/`onboard`/`resync`/`csv`; analytics seam functions `recomputeMatch`, `computePortfolioAnalytics`, optimizer, simulator, bridge.
- **`_get_recompute_lock` is PROCESS-LOCAL** (`match.py` — `dict[str, asyncio.Lock]`, in-memory per worker). The audit must record this as evidence and resolve each recompute-path verdict on the `compute_jobs` contract, not the lock alone.

### Claude's Discretion
- Home for the registry (e.g. `src/lib/seam-retry-registry.ts` or similar), consistent with existing seam-lib layout.
- Wrapper name (`withSeamRetry` or equivalent).

### Deferred Ideas (OUT OF SCOPE)
- None. Distributed-lock hardening for `_get_recompute_lock`, if the audit finds it insufficient, is a JOB-group / future-phase concern, not 141.
- No new retry surfaces beyond the two seam clients. No Python changes required (this is a TypeScript-only phase; the Python side is AUDIT INPUT, already landed).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEAM-05 | Committed retry-safety audit artifact maps every seam function and `/process-key` `flow_type` to retry-safe yes/no with traced server-side side-effect evidence, incl. the unaudited `recomputeMatch`/`computePortfolioAnalytics`/optimizer/simulator/bridge set, and resolves whether `_get_recompute_lock` is distributed or process-local. | The **Idempotency Audit** table below is the traced artifact; the registry (`## The Typed Registry`) is its committed, runtime-enforced form. `_get_recompute_lock` resolved: **process-local** (`match.py:_recompute_lock: dict[str, asyncio.Lock]`). |
| SEAM-06 | Bounded retry (1 attempt) with fixed backoff + jitter enabled ONLY for allowlisted entries from SEAM-05, respects the open breaker with no bypass, provably NEVER retries `teaser`. | Retry loop belongs in `resilientFetch` (see Q1); breaker-open short-circuits BEFORE any attempt (`resilient-fetch.ts:1853-1856`); teaser exclusion enforced by registry absence + SC3 pin. |
</phase_requirements>

## Summary

Phase 140 already built everything the retry sits on: `resilientFetch` (the single Vercel→Railway transport), the shared `breaker:railway`/per-dependency breaker, the unified `SEAM_BUDGETS` table (each row already carries a `retries` field seeded to `0`), and the SC-4b headroom invariant that models `timeoutMs × calls × (1 + retries)` per route. Phase 141 raises `retries` from 0 to 1 **only where the SEAM-05 idempotency audit proves the server-side effect is deduplicated** — and adds a typed registry that is both the committed audit and the runtime gate.

The heart of the phase is the audit. The verdicts, traced to source:

| Target | Retry-safe? | Single strongest evidence |
|--------|-------------|---------------------------|
| `teaser` | **NO** | `process_key.py:936-938` mints a **fresh `uuid4()`** wizard_session_id + `TEASER_ANCHOR_STRATEGY_ID` on every call → every submission writes a NEW `strategy_verifications` row (deliberately non-idempotent). A retry mints a duplicate verification/`public_token`/lead. |
| `onboard` | **YES** | Carries a caller-supplied `wizard_session_id` → `idempotent_by_session=true` (`:1033`) → duplicate pre-check + `_resume_duplicate_job` re-enqueue, deduped by `strategy_verifications_strategy_wizard_session_uniq` (SV row) AND `enqueue_compute_job` (job). |
| `resync` | **QUALIFIED YES** | The **compute job** is idempotent — `enqueue_compute_job` dedupes on `(strategy_id, kind)` via `compute_jobs_one_inflight_per_kind_strategy`. ⚠️ But resync carries NO wizard_session_id (`:1018` mints a fresh uuid4), so `idempotent_by_session=false` and a retry that re-reaches the server mints a **duplicate `strategy_verifications` DRAFT row**. The money-bearing effect (the sync job) is single; the draft SV row is not. |
| `csv` | **NO (default) / mixed** | `csv-validate` is validate-only (no persist, safe) but `csv-finalize` creates a `strategies`+`strategy_verifications` row. Finalize is NOW guarded by `strategies_user_wizard_session_source_uniq` (23505 fence, migration `20260728120000`), but the two share ONE budget key and ONE flow_type. Leave `csv` no-retry unless the planner splits validate/finalize. |
| analytics: `recomputeMatch` | writes; guarded by process-local lock + no unique constraint on `match_batches` → **NO (unproven)** | `_get_recompute_lock` is process-local (`dict[str, asyncio.Lock]`); H-0562 is the open multi-worker durability gap. Single-worker deployment bounds but does not PROVE idempotency. |
| analytics: `computePortfolioAnalytics` | **NO — ZERO callers** | The TS wrapper is unreachable (`resilient-fetch.ts:502` note). Record "no callers" per SC1; do not allowlist a dead path. |
| analytics: optimizer (`runPortfolioOptimizer`, `optimizeScenarioWeights`), simulator, bridge | **YES (compute-only reads)** | Pure compute over caller-supplied series/ids; return `weights: null` on degenerate input; no persisted write on the request path. Idempotent by having no side effect. |

**Primary recommendation:** Enable `retries: 1` on **`process-key-enqueue`** (serves onboard+resync, both job-idempotent) and on the analytics **compute-only** budgets (`bridge`, `simulator`, `portfolio-optimizer`, `optimize-weights`). Keep `process-key-sync` (teaser+csv), `validate-key`, `encrypt-key`, `match-recompute`, `match-eval`, `keys-permissions`, `portfolio-analytics` at `retries: 0`. Gate the retry DECISION on `flow_type` for the process-key seam (NOT budgetKey — it conflates teaser+csv and onboard+resync), and on function identity for the analytics seam. Enforce teaser-never via registry absence, pinned by SC3.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Retry loop (re-issue on transient failure) | Frontend Server (Vercel lambda, `resilientFetch`) | — | The seam IS the Vercel→Railway boundary; retry is a client-of-Railway concern. Zero Python changes. |
| Retry-eligibility decision | Frontend Server (registry consulted by the two seam clients) | — | Only the caller knows the `flow_type` / function identity; `resilientFetch` sees only `budgetKey`, which is many-to-one over flow_types. |
| Idempotency PROOF (the side effect being single) | API / Database (Python `process_key.py` + Postgres partial-unique indexes) | — | Retry-safety is a property the SERVER guarantees; the TS side only decides whether to lean on it. Already landed in Phase 140.1. |
| Breaker short-circuit (SC4) | Frontend Server (`isBreakerOpen` before fetch) | Database (Upstash breaker store) | Already built; retry must sit UNDER it, never around it. |

## Standard Stack

No new packages. This phase is a surgical edit to existing Phase-140 seam infrastructure plus one new registry module and its tests.

| Existing module | Role in this phase |
|-----------------|--------------------|
| `src/lib/resilient-fetch.ts` | Owns `resilientFetch` (the retry loop's home), `SEAM_BUDGETS` (the per-row `retries` field, seeded 0), `SEAM_RETRIES` seed constant, `isBreakerOpen` (SC4 gate). |
| `src/lib/analytics-client.ts` | Nine analytics wrappers; each has a 1:1 `budgetKey`. Consults registry by function/budget identity. |
| `src/lib/process-key-client.ts` | `postProcessKey`; `FlowType` union at `:51`; `budgetKeyFor` at `:64` (maps flow_type→budgetKey, MANY-TO-ONE). Consults registry by `args.flow_type`. |
| `src/lib/seam-errors.ts` | `CircuitOpenError` (must NOT be retried), `SeamBodyReadError`. Dependency-free leaf. |
| `src/lib/seam-discriminator.ts` | `seamBreakerVerdict` — classifies which failures COUNT; the retry loop should retry only the same COUNTING/transient classes (transport, deadline, 503, other-5xx), never a 4xx caller fault or a `CircuitOpenError`. |

**Registry home (Claude's discretion, recommended):** a new dependency-free leaf `src/lib/seam-retry-registry.ts` following the exact shape convention of `process-key-onboard-contract.ts` and `seam-discriminator.ts` (zero imports, zero env reads, zero module-load side effects). This is required because the wizard/browser bundle reachability and wholesale-mock survival constraints that force `seam-errors.ts` and `seam-discriminator.ts` to be leaves apply identically here if the registry is ever consulted from a `"use client"`-reachable path.

## Package Legitimacy Audit

**Not applicable** — this phase installs zero external packages. The "no new circuit-breaker / retry npm dependency (`cockatiel`, `opossum`, `p-retry`)" exclusion is locked in REQUIREMENTS.md ("Out of Scope"): both breakers are Upstash-backed and would still need a hand-written adapter. Retry is a ~15-line loop.

## Q1 — Where the retry loop belongs

### Current call structure

Both clients delegate transport to ONE function, `resilientFetch(budgetKey, path, init)` (`resilient-fetch.ts:1775`). Its sequence:

```
resilientFetch:
  1. validate timeoutMsOverride / ANALYTICS_SERVICE_URL   → throw SeamConfigError (no retry: config fault)
  2. breaker = await isBreakerOpen(budgetKey)
     if breaker.open → throw CircuitOpenError            ← SC4 GATE (before any fetch)
  3. admittedAtMs = Date.now(); recordOnce latch
  4. deadline = AbortSignal.timeout(timeoutMs)
  5. try { res = await fetch(url, {..., signal: deadline}) }
     catch (transport/deadline) → recordOnce(verdict); throw err   ← COUNTING failure
  6. verdict = seamBreakerVerdict(res.status, await readDependencyBody(res))
     if verdict.counts → recordOnce(verdict.breakerKey)            ← 503/other-5xx COUNTING
  7. return instrumentBody(res, ...)   // json()/text() read inside the window; body-read abort also counts
```

**The retry loop belongs around steps 4–6 inside `resilientFetch`**, NOT in the two clients. Reasons:
- `resilientFetch` is the ONE place that owns the deadline, the breaker check, and the failure classification — the three things a retry must respect.
- Putting it in the clients would duplicate it (the exact drift class SEAM-01 exists to end) and would sit OUTSIDE the breaker/classification, risking a bypass of SC4.

### The retry-eligibility problem (critical — budgetKey is NOT flow_type)

`resilientFetch` knows only `budgetKey`. But `budgetKeyFor` (`process-key-client.ts:64-68`) is **many-to-one**:

```
teaser  → process-key-sync      onboard → process-key-enqueue
csv     → process-key-sync      resync  → process-key-enqueue
```

So `process-key-sync` serves **teaser (UNSAFE) AND csv**, and `process-key-enqueue` serves **onboard AND resync**. Setting `SEAM_BUDGETS["process-key-sync"].retries = 1` would retry **teaser** — a direct SC3 violation. Therefore:

- The per-row `retries` field is **safe for the analytics seam** (each wrapper has a 1:1 budgetKey — `validate-key`, `bridge`, `match-recompute`, …) and **safe for `process-key-enqueue`** (both onboard+resync are job-idempotent).
- It is **NOT sufficient for `process-key-sync`**. The retry DECISION for the process-key seam must be made on `flow_type`, which only `postProcessKey` knows.

**Recommended mechanism:** add an explicit, optional retry input to `ResilientFetchInit` (mirroring the existing `timeoutMsOverride` escape hatch), e.g. `retriesOverride?: number`. `postProcessKey` computes retry-eligibility from the registry keyed on `args.flow_type` and passes `retriesOverride` accordingly; `analyticsRequest` passes it keyed on the wrapper's function/budget identity. `resilientFetch` resolves `retries = init.retriesOverride ?? SEAM_BUDGETS[budgetKey].retries`. This keeps the registry consultation at the layer that knows the flow_type, and keeps the SC-4b arithmetic reading the row (the invariant already reads `SEAM_BUDGETS[b.key].retries`, so the override must ALSO be reflected — see Open Question 1).

### What "reserved backoff / do not widen the deadline" resolves to (READ Open Question 1)

The CONTEXT says the constants "already reserve ~4.3s of retry backoff" and "the retry loop consumes the already-reserved backoff, it does not add to the deadline." **The code only partially supports this:**

- `4250 ms` in the codebase is `STORE_COMMAND_WORST_CASE_MS` (the breaker's OWN Upstash store worst case: `(1+1)×2000 + 1×250`), **not** a seam-retry backoff reservation. There is NO pre-existing seam-retry backoff line in `SEAM_BUDGETS`. `[VERIFIED: seam-constants.pin.test.ts:432-444, resilient-fetch.ts:288-309]`
- The SC-4b invariant models a retry as a **full extra timeout window**: `timeoutMs × calls × (1 + retries)` (`seam-budgets.invariant.test.ts:631`). Under that model, `retries: 1` roughly DOUBLES a route's worst case, and the invariant header states explicitly: *"at retries=1 finalize-wizard's composite branch is already at 427,500 ms failing and BREACHES, which is a fact Phase 141 must plan around."* `[VERIFIED: seam-budgets.invariant.test.ts:95-101]`

So there are two mutually-exclusive designs, and the planner MUST pick one and reconcile the invariant:

- **Design A (what the code models today):** each attempt gets its own fresh `timeoutMs` deadline. Worst case ≈ `timeoutMs × (1+retries) + backoff`. Simple; matches SC-4b as written. **Cost:** any route already near the ceiling (finalize-wizard composite `keys-permissions × 10`) can never be allowlisted. This CONTRADICTS the locked "do not widen the deadline."
- **Design B (what CONTEXT's words say):** ONE shared deadline covers both attempts + the fixed backoff; the retry re-issues within the remaining budget. Honours "do not widen." **Cost:** the SC-4b `(1+retries)` multiplier is then WRONG (it over-states) and must be changed to model `timeoutMs + backoff`; each attempt gets less than the full timeout, which for a 15s enqueue may be too tight for a real re-issue.

**Recommended framing for the planner:** the LOCKED constraint is "do not widen the deadline," which is Design B in spirit. But the actually-allowlisted routes under the primary recommendation (keys/sync=resync single 15s call; finalize-wizard single-key onboard) have ample headroom EVEN under Design A: keys/sync at retries=1 = `15000×2 + store(~12750) ≈ 42750 ms` vs a 300 000 ms ceiling. So the pragmatic path is **Design A arithmetic (keep SC-4b as-is) restricted to routes with headroom, and NEVER allowlist a fan-out route (`keys-permissions` on finalize-wizard composite).** If the planner wants the strict "do not widen" guarantee, that is a larger change to SC-4b and to how `resilientFetch` shares the deadline. This tension must be an explicit decision in the plan, not discovered at execution.

## Q2 — The SC1 idempotency audit (the heart of the phase)

### `/process-key` flow_types

Server entry: `process_key.py::process_key` (`:822`). `_is_long_fetch` (`:603-609`) = `flow_type in {onboard, resync}` → enqueue-and-return-202; `{teaser, csv}` run the 5-method pipeline INLINE.

**`teaser` — NOT retry-safe. Server-side effect traced:**
- `:936-938`: for teaser, the server UNCONDITIONALLY overwrites `context["strategy_id"] = TEASER_ANCHOR_STRATEGY_ID` and **`context["wizard_session_id"] = str(uuid.uuid4())`** — a fresh UUID per submission.
- `:1033`: `idempotent_by_session = flow_type != "teaser" and bool(context.get("wizard_session_id"))` → **always `False` for teaser**.
- Consequence: teaser never consults the duplicate pre-check; each submission writes a NEW `strategy_verifications` row (draft → the pipeline runs → the teaser preview + `public_token` + lead capture). A retry at the seam that re-reaches the server mints a SECOND verification, a SECOND `public_token`, and a SECOND lead. This is exactly the ANTI-feature named in REQUIREMENTS "Out of Scope." `[VERIFIED: analytics-service/routers/process_key.py:936-938, :1033]`

**`onboard` — retry-safe. Traced:**
- Carries a caller-supplied `wizard_session_id` → `idempotent_by_session = True`.
- Duplicate pre-check reads `strategy_verifications` scoped by `strategy_id` (`:1353`, PYAPI-01d); a hit routes to `_resume_duplicate_job` (`:643-714`) which re-calls `enqueue_compute_job` (deduped on `(strategy_id, kind)` over non-terminal statuses) and returns the shared `_wizard_duplicate_reply` (`code: WIZARD_DUPLICATE`, `idempotent: true`, HTTP 200).
- Two independent unique constraints back this: `strategy_verifications_strategy_wizard_session_uniq` (migration `20260726000225`, tenant-scoped SV-row dedup) and the `compute_jobs` partial-unique index (job dedup).
- The TS consumer contract is pinned by `process-key-onboard-contract.ts::isProcessKeyOnboardResponse` + the cross-process parity test. A retry that re-reaches the server hits the duplicate path → exactly one SV row, exactly one job. `[VERIFIED: process_key.py:643-714, migration 20260726000225, process-key-onboard-contract.ts]`

**`resync` — QUALIFIED retry-safe (the SC2 subject — read carefully):**
- `/api/keys/sync` sends `context: {strategy_id, user_id}` with **NO `wizard_session_id`**. Server mints a fresh uuid4 (`:1018`) → `idempotent_by_session = False` (`:1024-1032` explains this is by construction: "a server-minted session id never consults, and never emits, the idempotent-hit path. Each resync/teaser submission is its own verification; downstream sync_trades enqueues still dedupe on (strategy_id, kind)").
- **The money-bearing effect (the compute job) IS idempotent:** `enqueue_compute_job` dedupes on `(strategy_id, kind)` via `compute_jobs_one_inflight_per_kind_strategy`/`_allocator` partial-unique indexes (migration `20260418194206:151`; RPC pinned by `supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql`).
- **⚠️ The `strategy_verifications` DRAFT row is NOT idempotent for resync** — a retry that re-reaches the server mints a SECOND draft SV row (fresh uuid4, misses the pre-check).
- **Verdict:** resync is safe **for the effect SC2 measures** (exactly ONE compute_job), which is what the ROADMAP SC2 wording targets ("exactly ONE server-side effect — proven against the real compute_jobs partial-unique-index"). The registry entry for resync MUST record the duplicate-draft-SV-row as a KNOWN, tolerated secondary effect (a resync draft row is cosmetic bookkeeping, not money-bearing and not lead/`public_token` minting). If the planner deems the duplicate draft row unacceptable, resync must be demoted to no-retry — but that contradicts SC2's own example. **This nuance is the phase's sharpest landmine; surface it in the plan.** `[VERIFIED: process_key.py:1018, :1024-1035; migration 20260418194206:145-165]`

**`csv` — NOT retry-safe by default (mixed):**
- `csv-validate` (step=`validate`, no strategy_id) → `_run_validate_only` (`:1050-1055`): adapter.validate() only, NO persisted row. Safe in isolation.
- `csv-finalize` (step=`finalize`) → `finalize_csv_strategy` RPC (`:1096-1106`): creates `strategies` + `strategy_verifications` rows. Now guarded by `strategies_user_wizard_session_source_uniq` (23505 fence, migration `20260728120000`); a repeat finalize raises 23505 and the handler re-fetches the existing strategy at 200 (`:1124-1150`) — so finalize IS idempotent via the index.
- **But** both share `flow_type: "csv"` and the `process-key-sync` budget key (also shared with teaser). Since teaser lives on that budget row, the row must stay `retries: 0`, and a flow_type-level `csv` allowlist entry would retry BOTH validate and finalize. Finalize is index-guarded; validate is side-effect-free; so `csv` COULD be allowlisted at flow_type grain. **Recommendation: leave `csv` no-retry for this phase** (default posture) unless the planner explicitly wants it — the incremental value is low and the teaser-adjacency raises the SC3 blast radius. `[VERIFIED: process_key.py:1050-1067, :1093-1150; migration 20260728120000]`

### Analytics seam functions (analytics-client.ts wrappers)

| Function | Endpoint | Writes? | Idempotent? | Verdict |
|----------|----------|---------|-------------|---------|
| `recomputeMatch` | `/api/match/recompute` | YES — inserts `match_batches` | Guarded by process-local `_recompute_lock` (`match.py`, `dict[str, asyncio.Lock]`) + force-throttle `_force_lock`; **NO unique constraint on `match_batches`**. H-0562 (multi-worker durability) is OPEN. | **NO (unproven).** Single-worker deployment bounds the race but does not PROVE cross-instance idempotency. Default no-retry. |
| `computePortfolioAnalytics` | `/api/portfolio-analytics` | YES (upserts `strategy_analytics`) | N/A | **NO — ZERO CALLERS.** The wrapper is unreachable (`resilient-fetch.ts:502` records "no callers"). Record "no callers, not allowlisted" per SC1. |
| `runPortfolioOptimizer` | `/api/portfolio-optimizer` | No persisted write on request path (compute + return) | Pure compute over `(portfolio_id, user_id)` | **YES** — idempotent by having no side effect. |
| `optimizeScenarioWeights` | `/api/optimize-weights` | No | Pure compute over caller-supplied series; returns `weights: null` on degenerate input | **YES** |
| `simulateAddCandidate` | `/api/simulator` | No | Pure compute | **YES** |
| `findReplacementCandidates` (bridge) | `/api/portfolio-bridge` | No | Weighted-covariance compute | **YES** |
| `validateKey` / `encryptKey` | `/api/validate-key`, `/api/encrypt-key` | Credential write / live exchange probe | Non-idempotent by construction (REQUIREMENTS "Out of Scope") | **NO** — a retry double-writes credentials. Explicitly forbidden. |
| `evalMatch` | `/api/match/eval` | Read/sweep | admin eval | **Discretion** — read-only sweep, likely safe, but low value; default no-retry. |

**`_get_recompute_lock` resolution (SEAM-05 explicit ask):** it is **PROCESS-LOCAL**, not distributed. `match.py::_recompute_lock: dict[str, asyncio.Lock]` (in-memory per worker), created on first use, held across `skip-check → score → match_batches insert`. The module comment itself names the limitation: "Process-local: this closes the finding's stated single-process race (the match engine runs one worker today). Multi-worker durability (a Postgres advisory lock or a UNIQUE constraint on match_batches) is the separately-tracked H-0562." **Audit conclusion:** a process-local lock does NOT serialize retries across worker instances; combined with the single-instance worker deployment it BOUNDS but does not by itself PROVE recompute idempotency. Therefore `recomputeMatch` defaults to no-retry (unproven). `[VERIFIED: analytics-service/routers/match.py:_recompute_lock, _get_recompute_lock]`

## Q3 — The typed registry shape

Recommended: a dependency-free leaf `src/lib/seam-retry-registry.ts`, following `process-key-onboard-contract.ts` conventions.

```typescript
// Keyed at TWO grains because the two seams disambiguate differently:
//   - process-key seam: by FlowType (budgetKey is many-to-one over flow_types)
//   - analytics seam:   by SeamBudgetKey (1:1 with the wrapper function)

export interface RetrySafeEntry {
  readonly retries: 1;               // exactly one, locked
  readonly evidence: string;         // the traced server-side proof (the SC1 audit text)
}

// PRESENT ⇒ retry-safe. ABSENT ⇒ no-retry, by construction (SC1 default posture).
export const RETRY_SAFE_FLOW_TYPES: Partial<Record<FlowType, RetrySafeEntry>> = {
  onboard: { retries: 1, evidence: "wizard_session_id ⇒ idempotent_by_session; SV row deduped by strategy_verifications_strategy_wizard_session_uniq, job by compute_jobs_one_inflight_per_kind_strategy (process_key.py:643-714)." },
  resync:  { retries: 1, evidence: "compute job deduped on (strategy_id,kind) via compute_jobs_one_inflight_per_kind_strategy. KNOWN tolerated secondary effect: a retry mints a duplicate DRAFT strategy_verifications row (server-minted uuid4, process_key.py:1018) — cosmetic, non-money-bearing." },
  // teaser: ABSENT — deliberately non-idempotent (process_key.py:936-938). SC3 pins this absence.
  // csv:    ABSENT — validate is side-effect-free but finalize+teaser share the budget row; default no-retry.
};

export const RETRY_SAFE_ANALYTICS: Partial<Record<SeamBudgetKey, RetrySafeEntry>> = {
  bridge:                { retries: 1, evidence: "pure weighted-covariance compute, no persisted write." },
  simulator:             { retries: 1, evidence: "pure compute, no persisted write." },
  "portfolio-optimizer": { retries: 1, evidence: "pure compute, returns null on degenerate input." },
  "optimize-weights":    { retries: 1, evidence: "pure compute over caller series." },
  // validate-key/encrypt-key: ABSENT — credential writes, non-idempotent (Out of Scope).
  // match-recompute: ABSENT — writes match_batches under a PROCESS-LOCAL lock, no unique constraint; H-0562 open.
  // portfolio-analytics: ABSENT — zero callers; recorded as such.
};
```

- **"Absence → no-retry" falls out of the type** because the maps are `Partial<Record<…>>`; the wrapper does `registry[key]?.retries ?? 0`. A flow/function not listed simply has no entry → 0 retries. No separate rule.
- **Evidence carried inline** as the `evidence` string on each entry — this IS the SC1 audit artifact, co-located with the runtime gate, so they cannot drift.
- **How the wrapper consults it:** `postProcessKey` reads `RETRY_SAFE_FLOW_TYPES[args.flow_type]` and passes `retriesOverride` into `resilientFetch`. `analyticsRequest` reads `RETRY_SAFE_ANALYTICS[options.budgetKey]`. Do NOT let `resilientFetch` read the registry directly — it only has `budgetKey`, which cannot distinguish teaser from csv.
- **Consistency pin:** a test must assert `RETRY_SAFE_ANALYTICS`'s keys ⊆ the routes whose `SEAM_BUDGETS` row also carries `retries: 1` (or, if the row stays 0 and the override does the work, assert the override path), and that `teaser`/`csv` are absent from `RETRY_SAFE_FLOW_TYPES` — the SC3 belt.

## Q4 — Testing the guarantees

### SC2 — allowlisted retry, exactly one server-side effect (against the REAL index)

The guarantee spans three layers, so it decomposes into three pinned tests (a single end-to-end is impractical across Vercel→Railway→Postgres):

1. **TS unit (retry loop mechanics):** inject a SINGLE transient failure at the seam (mock `fetch` to reject once with a deadline/network error, then resolve). Assert `resilientFetch` issues exactly TWO `fetch` calls for an allowlisted budget and ONE for a non-allowlisted one, and that the second attempt observes the fixed-backoff+jitter delay. Use fake timers for the backoff. This is the SEAM-06 mechanics proof.
2. **Python/SQL (idempotency of the effect):** the `compute_jobs` `(strategy_id, kind)` dedup is ALREADY pinned by `supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql`. Add/extend a Python test that calls `process_key(flow_type=resync)` TWICE for the same `strategy_id` (simulating the retry re-reaching the server) and asserts **exactly one non-terminal `compute_jobs` row** — against a real Postgres test DB (per MEMORY: RLS/SQL gates live in `supabase/tests/test_*.sql`; `*_live.py` do NOT run in CI, so prefer a `.sql` gate or a pytest that runs against the test Supabase project). Assert the duplicate DRAFT SV row is the KNOWN tolerated secondary effect (do not assert one SV row — that would fail).
3. Composition note: SC2's "exactly ONE server-side effect" = exactly one compute_job. Write the assertion against the JOB, not the SV row, and comment WHY (resync mints its own SV row by construction).

### SC3 — teaser never retried (two pins, both required)

- **TS pin (the retry gate):** assert `RETRY_SAFE_FLOW_TYPES.teaser === undefined` and that `postProcessKey({flow_type:"teaser", ...})` under an injected single transient failure issues exactly ONE `fetch` (no retry). This is the regression that stops a future refactor from silently retrying teaser.
- **DB pin (the WHY — non-idempotency is real, not a mock tautology):** a Python/DB test that calls `process_key(flow_type=teaser)` TWICE and asserts **TWO `strategy_verifications` rows** result (distinct fresh uuid4 session ids). This proves the server is genuinely non-idempotent, so the TS no-retry rule is load-bearing, not decorative. CONTEXT `<specifics>` requires this be a real DB-observing test, not a mock.

### SC4 — breaker open → zero retries

- Seed the breaker OPEN (use the existing `src/test/helpers/upstash-breaker.ts` seed helper + `encodeBreakerLock`). Call an ALLOWLISTED path; assert `resilientFetch` throws `CircuitOpenError` and issues ZERO `fetch` calls. The gate already exists structurally (`isBreakerOpen` before the fetch, `resilient-fetch.ts:1853-1856`); the test proves the retry loop does not wrap or bypass it. Also assert the retry loop does NOT catch/retry a `CircuitOpenError` thrown mid-loop (if the breaker trips between attempt 1 and the retry, the retry must re-check and abort, not swallow).

### Non-vacuity / mutation guards (this repo's bar — see MEMORY "money-math oracles")

- The SC-4b invariant already reddens if a row's `retries` is raised without ceiling headroom — reuse it as the guard that a naively-allowlisted fan-out route breaches. `seam-constants.pin.test.ts:283-296` currently pins every row's `retries` to 0; **those pins MUST be updated in the same commit** for any row this phase flips to 1, or CI reddens. That is the intended tripwire — do not delete it, edit it deliberately.

## The Typed Registry — consistency with SC-4b

⚠️ **Binding interaction:** `seam-constants.pin.test.ts` has TWO negative pins that this phase must deliberately edit (not delete):
- `"%s.retries is 0 — the per-row NEGATIVE pin"` (`:283-296`) — the `it.each` over every budget key asserting `retries === 0`.
- `"SEAM_RETRIES is 0 — a NEGATIVE pin"` (`:339-350`).

If the design flips `SEAM_BUDGETS[...].retries` to 1 (Design A on `process-key-enqueue` etc.), the per-row pin must move to the new expected value for exactly those rows, and the SC-4b headroom must be re-checked for each. If the design uses `retriesOverride` and leaves the rows at 0, the SC-4b arithmetic does NOT see the retry and would UNDER-state the worst case — so the override MUST also be modelled in the invariant. **Prefer flipping the ROW** for allowlisted 1:1 analytics budgets and `process-key-enqueue`, so SC-4b stays honest, and use the `flow_type` registry only as the belt that prevents `process-key-sync` (teaser) from ever being flipped. This keeps the headroom arithmetic reading a single source (`SEAM_BUDGETS[b.key].retries`).

## Runtime State Inventory

Not applicable — this is a code + test phase with no rename/migration/stored-state component. No new migrations (the idempotency indexes this phase LEANS ON already exist and are AUDIT INPUT, landed in Phase 140.1/140.4). Verified: `git status` shows no pending migration for 141; the phase is TypeScript-only per CONTEXT.

## Common Pitfalls

### Pitfall 1: Setting `retries` on `process-key-sync` to enable csv retry
**What goes wrong:** teaser rides the SAME budget row → teaser gets retried → SC3 violated, duplicate leads/`public_token`s minted.
**How to avoid:** decide retry for the process-key seam on `flow_type`, never `budgetKey`. Keep `process-key-sync` at `retries: 0`. Pin `teaser`/`csv` absent from the flow registry.

### Pitfall 2: Allowlisting a fan-out route and breaching the lambda ceiling
**What goes wrong:** `keys-permissions` at `retries: 1` puts finalize-wizard's composite branch at ~300–427k ms against a 300k ceiling — lambda killed mid-request during an outage (the mitigation becoming the outage).
**How to avoid:** never allowlist `keys-permissions`; let SC-4b redden if anyone tries. Only allowlist single-call routes with headroom.

### Pitfall 3: Treating resync's SV draft row as a violation of "exactly one side effect"
**What goes wrong:** the SC2 test asserts ONE `strategy_verifications` row for resync and fails, or the reviewer demotes resync to no-retry, contradicting SC2's own example.
**How to avoid:** SC2's "one server-side effect" = one compute_job. Assert against the JOB. Record the duplicate draft SV row as a known tolerated secondary effect in the registry evidence.

### Pitfall 4: Retrying a non-transient failure or a CircuitOpenError
**What goes wrong:** retrying a 4xx caller fault (bad key) wastes budget and can double a partial write; retrying a `CircuitOpenError` bypasses SC4.
**How to avoid:** retry ONLY the COUNTING/transient classes `seamBreakerVerdict` already identifies (transport throw, deadline, 503, other-5xx). Never retry a `SeamConfigError`, `CircuitOpenError`, or any 4xx.

### Pitfall 5: Retrying a body-read failure after the server already acted
**What goes wrong:** for `onboard`/`resync` the server may have ENQUEUED before the response body aborted; a retry re-reaches an idempotent server (fine). But for a hypothetically-allowlisted non-idempotent path it would double-execute.
**How to avoid:** the allowlist is the ONLY thing that makes body-read-abort retry safe — because the server dedups. Keep the allowlist strictly to server-dedup-proven flows. This is why SC1 gates SC2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| vitest | SC2/SC3/SC4 TS tests | ✓ | ^4.1.2 | — |
| @upstash/redis (real-Redis lane) | SC4 breaker-open test | ✓ (test:redis / vitest.redis.config.ts) | installed | fake breaker helper for non-Redis lane |
| Postgres test DB (Supabase test project `qmnijlgmdhviwzwfyzlc`) | SC2/SC3 DB pins | ✓ via `supabase/tests/*.sql` in CI | — | none (a mock would violate CONTEXT's "real DB, not a mock tautology") |
| pytest (analytics-service) | SC2/SC3 Python halves | ✓ | — | — |

**Missing dependencies with no fallback:** none. All test infrastructure exists.

## Validation Architecture

`nyquist_validation: true` (`.planning/config.json`). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 (TS) + pytest (analytics-service) + Supabase SQL gates |
| Config file | `vitest.config.ts`; real-Redis lane `vitest.redis.config.ts` |
| Quick run command | `npx vitest run src/lib/seam-retry-registry.test.ts src/lib/resilient-fetch.test.ts` |
| Full suite command | `npm run test` (sharded in CI with `--coverage`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEAM-05 | Registry maps every flow_type + analytics fn with evidence; `_get_recompute_lock` resolved process-local | unit | `npx vitest run src/lib/seam-retry-registry.test.ts` | ❌ Wave 0 |
| SEAM-06 (SC2) | allowlisted retry → exactly 2 fetches, 1 compute_job | unit + DB | `npx vitest run src/lib/resilient-fetch.retry.test.ts` + `supabase/tests/test_resync_retry_single_job.sql` | ❌ Wave 0 |
| SEAM-06 (SC3) | teaser absent from registry → 1 fetch; two teaser calls → 2 SV rows | unit + DB | `npx vitest run` (registry + retry) + pytest `test_teaser_non_idempotent` | ❌ Wave 0 |
| SEAM-06 (SC4) | breaker open → 0 fetches, CircuitOpenError | unit (real+fake Redis) | `npm run test:redis -- resilient-fetch.retry` | ❌ Wave 0 |
| SC-4b headroom | no allowlisted route breaches maxDuration | invariant | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ✅ exists (update pins) |

### Sampling Rate
- **Per task commit:** the quick run above + `seam-constants.pin.test.ts` (the retries pins).
- **Per wave merge:** `npm run test` full suite + `npm run test:redis`.
- **Phase gate:** full suite green + SC-4b invariant green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/seam-retry-registry.ts` + `.test.ts` — the SC1 registry (SEAM-05).
- [ ] `src/lib/resilient-fetch.retry.test.ts` — SC2 mechanics + SC4 breaker-open + single-transient injection (add to existing `resilient-fetch.test.ts` if preferred).
- [ ] `supabase/tests/test_resync_retry_single_job.sql` OR pytest — SC2 real-index proof (may extend `test_enqueue_compute_job_dedupe_non_terminal.sql`).
- [ ] pytest `test_teaser_non_idempotent` (or `.sql`) — SC3 two-rows DB pin.
- [ ] Update `seam-constants.pin.test.ts` retries pins for any flipped row, in the same commit.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (treated as enabled by default). This phase touches a money-bearing, partly-unauthenticated (teaser) seam, so:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | Breaker check stays INSIDE the route handler AFTER auth (`resilientFetch` docblock `:1759-1764`) — the retry must not hoist it. |
| V5 Input Validation | no (no new input surface) | — |
| V11 Business Logic / anti-automation | yes | The teaser-never-retry rule IS a business-logic control: a retry mints duplicate leads/`public_token`s. SC3 pins it. Retry must never amplify the anonymous teaser path (already the WIDEST breaker key, `process-key-sync` note `:513-542`). |

| Threat Pattern | STRIDE | Mitigation |
|----------------|--------|------------|
| Retry storm amplifying a Railway outage | Denial of Service | SC4: breaker open → zero retries; fixed backoff + JITTER prevents synchronized re-issue across concurrent callers. |
| Duplicate lead/verification minting via teaser retry | Tampering / abuse | teaser absent from registry (SC3); DB pin proves non-idempotency is real. |
| Double credential write via validateKey/encryptKey retry | Tampering | absent from registry (Out of Scope); non-idempotent by construction. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The CONTEXT's "~4.3s reserved retry backoff" refers to no actual seam-retry line; the real reservation model is SC-4b's `×(1+retries)`. | Q1 / Open Q1 | If a hidden reservation exists, the Design A/B framing is moot — but I found none in `SEAM_BUDGETS` or the pin tests. |
| A2 | A duplicate resync DRAFT `strategy_verifications` row is a tolerable (non-money-bearing) secondary effect. | Q2 resync | If the product treats draft SV rows as user-visible/billable, resync must be demoted — contradicting SC2's example. Needs founder/planner confirmation. |
| A3 | The match engine runs a SINGLE worker in production, so `recomputeMatch`'s process-local lock bounds (not proves) idempotency → default no-retry is correct. | Q2 analytics | If multi-worker, recompute is even less safe — verdict unchanged (still no-retry). Low risk. |
| A4 | `computePortfolioAnalytics` still has zero callers at HEAD. | Q2 analytics | If a caller appears, it must be audited before allowlisting; recorded as "no callers." |
| A5 | `csv` is best left no-retry (validate side-effect-free, finalize index-guarded, but shares budget with teaser). | Q2 csv | Low value if wrong; can be added later with a flow-grain entry. |

## Open Questions

1. **Design A vs Design B for the deadline (THE central tension).**
   - What we know: LOCKED constraint = "do not widen the deadline" (Design B). Current code = SC-4b models `×(1+retries)` (Design A). The "~4.3s reserved backoff" figure appears to be a misattribution of the breaker STORE's 4250ms worst case.
   - What's unclear: whether the planner keeps SC-4b as-is (Design A, restrict allowlist to routes with headroom) or re-works `resilientFetch` + SC-4b to share one deadline (Design B).
   - Recommendation: **Design A restricted to headroom-safe routes** (keys/sync=resync ≈ 42.75k ms vs 300k ceiling; finalize-wizard single-key onboard fits; all compute-only analytics fit). Never allowlist `keys-permissions`. If the founder wants the strict "do not widen" guarantee, scope Design B as an explicit task with an SC-4b rewrite. Flag this decision to `/gsd:discuss-phase` — it is a locked-constraint-vs-code contradiction.

2. **Is resync's duplicate draft SV row acceptable?** (A2). Needs an explicit yes/no before the SC2 test is written, since it determines what "exactly one side effect" asserts against.

3. **Does the retry loop re-check the breaker before the second attempt?** Recommendation: YES — if attempt 1's failure trips the breaker, the retry must throw `CircuitOpenError` rather than fire, tightening SC4. Confirm in the plan.

## Sources

### Primary (HIGH confidence — read at HEAD)
- `src/lib/resilient-fetch.ts` — `resilientFetch` (retry home), `SEAM_BUDGETS` (`.retries` field), `isBreakerOpen` (SC4 gate), `SEAM_RETRIES` seed, breaker store constants.
- `src/lib/analytics-client.ts` — nine wrappers, 1:1 budgetKeys.
- `src/lib/process-key-client.ts` — `FlowType` (`:51`), `budgetKeyFor` (`:64`, many-to-one).
- `src/lib/seam-budgets.invariant.test.ts` — SC-4b `×(1+retries)` model; explicit "retries=1 breaches finalize-wizard composite" warning.
- `src/lib/seam-constants.pin.test.ts` — the `retries === 0` negative pins to edit.
- `src/lib/seam-discriminator.ts` / `seam-errors.ts` — verdict classes; CircuitOpenError (never retry).
- `src/lib/process-key-onboard-contract.ts` — WIZARD_DUPLICATE / idempotent contract.
- `analytics-service/routers/process_key.py` — `:603-609` `_is_long_fetch`, `:643-714` `_resume_duplicate_job`, `:936-938` teaser fresh-uuid mint, `:1018`/`:1024-1035` resync server-minted session, `:1050-1150` csv paths.
- `analytics-service/routers/match.py` — `_recompute_lock` / `_get_recompute_lock` (process-local, H-0562 open).
- Migrations: `20260418194206` (compute_jobs partial-unique per kind/strategy/allocator), `20260726000225` (strategy_verifications tenant-scoped uniq), `20260728120000` (strategies_user_wizard_session_source_uniq).
- `.planning/ROADMAP.md` Phase 141 (4 success criteria); `.planning/REQUIREMENTS.md` SEAM-05/06 + Out-of-Scope.

## Metadata

**Confidence breakdown:**
- Retry loop location (Q1): HIGH — single transport function, traced end to end.
- Idempotency audit (Q2): HIGH — every verdict traced to source line + migration.
- Budget/deadline tension (Open Q1): MEDIUM — the LOCKED "do not widen" contradicts the current SC-4b model; the reconciliation is a genuine planner decision, not a fact.
- Registry shape (Q3): HIGH — follows established leaf conventions.
- Testing (Q4): HIGH — decomposition maps to existing test lanes.

**Research date:** 2026-07-31
**Valid until:** 2026-08-14 (stable subsystem; the two open questions are decisions, not moving facts)
