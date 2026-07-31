# Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit — Context

**Gathered:** 2026-07-31
**Status:** Ready for planning
**Source:** /gsd:discuss-phase 141 (interactive)

<domain>
## Phase Boundary

Transient Railway blips on the Vercel→Railway seam self-heal via a bounded retry — but ONLY for calls that carry a **traced idempotency proof**, so a retry can never double-execute a side effect. Scope is the two seam chokepoints already built in Phase 140 (`src/lib/analytics-client.ts` and `src/lib/process-key-client.ts`); retry must respect the Phase-140 breaker and reuse the existing unified timeout budgets. Requirements: SEAM-05, SEAM-06.

**In scope:** the committed retry-safety audit (SC1), the bounded retry loop on allowlisted calls (SC2), the `teaser`-never-retried contract + regression pin (SC3), the breaker-open zero-retry guarantee (SC4).
**Not in scope (own phases):** the JOB integrity work (142–145), the RATE audit (146). No new retry surfaces beyond the two seam clients.
</domain>

<decisions>
## Implementation Decisions

### Retry policy (LOCKED — discuss 2026-07-31; deadline CORRECTED post-research)
- **Exactly ONE retry**, **fixed backoff + jitter** (jitter to avoid synchronized retry storms across concurrent callers).
- **Deadline: Design A — widen the retried call's total deadline.** Research CORRECTED my earlier premise: the seam constants do NOT reserve retry backoff (the ~4250ms is the breaker STORE's worst case, not a retry line — no retry-time reservation exists). A retried call therefore gets a full second attempt + backoff, extending its total time. Enabled **ONLY for allowlisted proven-safe calls on routes with headroom** (e.g. `resync` on keys/sync fits ~42.75k vs the 300k ceiling); **never** the finalize-wizard composite branch or keys-permissions (they would breach). Both attempts get the full per-attempt timeout.
- **Re-check the breaker before attempt 2** — a retry must not fire (and amplify an outage) if the breaker opened between attempts (SC4).
- The retry respects the Phase-140 breaker and the unified per-flow budgets.

### Allowlist / audit mechanism (LOCKED — discuss 2026-07-31)
- The SC1 audit artifact is a **typed code registry** that is simultaneously the **committed audit** AND the **runtime enforcement**. One source of truth — the documented retry-safety verdict and the runtime allowlist cannot drift.
- The retry wrapper reads this registry; **anything not present-and-proven-safe defaults to no-retry by construction** (SC1's "everything unproven defaults to no-retry" is enforced by the map's absence semantics, not a separate rule).
- Each registry entry carries its **traced server-side side-effect evidence** (what proves the call idempotent) alongside the yes/no verdict.

### Locked by success criteria + research (NOT re-litigated)
- **Default posture:** unproven → no-retry (SC1).
- **`teaser` is provably never retried** (SC3). A regression test pins it: two identical `teaser` calls → TWO `strategy_verifications` rows, so a future refactor can't silently start retrying it and mint duplicate verifications / `public_token`s / leads. `teaser` is deliberately NON-idempotent (per research SUMMARY).
- **`resync` (allowlisted ONLY AFTER a dedup fix) retries with ZERO duplicate rows** (SC2; discuss 2026-07-31). Research found resync's compute_job is already idempotent (`compute_jobs_one_inflight_per_kind_strategy`), BUT a retry currently mints a duplicate DRAFT `strategy_verifications` row (resync mints its own session id — `process_key.py:1018` — so it lacks onboard's `wizard_session_id` dedup). **This phase MUST make resync's draft SV write idempotent** (dedup on resync's own key) so a retried resync yields exactly ONE compute_job AND ZERO duplicate SV rows. SC2 asserts both, against the real `compute_jobs` index + the deduped SV write. resync is added to the allowlist only after this dedup lands.
- **Breaker open → zero retry attempts** (SC4) — no bypass path; retries cannot amplify an outage.

### Audit coverage (the registry MUST classify all of these)
- The `/process-key` flow types: `teaser`, `onboard`, `resync`, `csv` (`src/lib/process-key-client.ts:51`).
- The analytics seam functions, including the previously-unaudited set the ROADMAP names: `recomputeMatch`, `computePortfolioAnalytics`, the optimizer, the simulator, the bridge.
- **`_get_recompute_lock` is PROCESS-LOCAL** (`analytics-service/routers/match.py:120` — `dict[str, asyncio.Lock]`, in-memory per worker process), NOT distributed. The audit must record this as evidence (a process-local lock does not serialize retries across worker instances; combined with the single-instance worker deployment it bounds — but does not by itself prove — recompute idempotency). Resolve each recompute-path verdict on the compute_jobs contract, not the lock alone.

### Registry verdicts (research 2026-07-31 — planner confirms + traces each with evidence)
- `teaser` → **NO** (mints a fresh `uuid4()` session + SV row / `public_token` / lead every call — `process_key.py:936`).
- `onboard` → **YES** (caller `wizard_session_id` → duplicate pre-check + `_resume_duplicate_job`, deduped by two unique indexes).
- `resync` → **YES, but only after the draft-SV dedup above lands**.
- `csv` → planner/research finalize (classify with evidence; default no-retry if unproven).
- `recomputeMatch` → **NO** (`_get_recompute_lock` process-local; no unique index on `match_batches`, H-0562 open) — unproven → no-retry.
- `computePortfolioAnalytics` → **no callers** — record as such (nothing to retry).
- optimizer / simulator / bridge → **YES** (pure compute, no persisted server-side write).
- validate / encryptKey → **NO / out-of-scope** (credential writes).
- **Registry keying (critical):** `budgetKeyFor` is many-to-one — `process-key-sync` serves teaser+csv, `process-key-enqueue` serves onboard+resync. The retry decision for the process-key seam MUST key on **`flow_type`** (via a `retriesOverride` `postProcessKey` passes into `resilientFetch`), NEVER on `budgetKey` (keying on budgetKey would retry `teaser`). The analytics seam keys on its 1:1 `budgetKey`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner) MUST read these before planning or implementing.**

### Phase spec + requirements
- `.planning/ROADMAP.md` — Phase 141 section (goal + 4 success criteria)
- `.planning/REQUIREMENTS.md` — SEAM-05, SEAM-06
- `.planning/research/SUMMARY.md` — research-corrected scope (retry-safety is per-`flow_type`; `teaser` deliberately non-idempotent; seam timeouts already exist)

### Seam clients (the two retry chokepoints — Phase 140 output)
- `src/lib/analytics-client.ts` — Vercel→Railway analytics seam (breaker + budget already wired)
- `src/lib/process-key-client.ts` — `/process-key` seam; `FlowType` union at :51, budget selection at :64
- `src/lib/seam-budgets.invariant.test.ts`, `src/lib/seam-constants.pin.test.ts` — the timeout/retry-backoff budget math (~4.3s reserved for retries; the retry loop must fit inside it)
- `src/lib/seam-discriminator.ts`, `src/lib/seam-errors.ts` — breaker verdict + typed seam errors the retry loop branches on

### Idempotency evidence
- `src/lib/process-key-onboard-contract.ts` — the `WIZARD_DUPLICATE` + `idempotent: true` contract (SC2's proof for onboard/resync)
- `analytics-service/routers/match.py:109-135` — `_get_recompute_lock` (process-local; audit input for recomputeMatch)
- `supabase/migrations/**` — the `compute_jobs` partial-unique-index (`strategies_user_wizard_session_source_uniq` and the tenant-scope uniq) that backs the exactly-one-side-effect guarantee
</canonical_refs>

<specifics>
## Specific Ideas / Concrete Constraints
- The typed registry is the deliverable for SC1 — pick a home consistent with the existing seam-lib layout (e.g. `src/lib/seam-retry-registry.ts` or similar); the retry wrapper (`withSeamRetry` or equivalent) reads it.
- The `teaser` regression pin (SC3) counts `strategy_verifications` rows across two identical calls — it must be a real DB-observing test, not a mock tautology.
- SC2's "exactly ONE server-side effect" must be proven against the REAL `compute_jobs` partial-unique-index + `WIZARD_DUPLICATE`, not a stubbed idempotency check.
</specifics>

<deferred>
## Deferred Ideas
None — the phase boundary is fixed by the ROADMAP. (Distributed-lock hardening for `_get_recompute_lock`, if the audit finds it insufficient, is a JOB-group / future-phase concern, not 141.)
</deferred>

---

*Phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit*
*Context gathered: 2026-07-31 via /gsd:discuss-phase (interactive)*
