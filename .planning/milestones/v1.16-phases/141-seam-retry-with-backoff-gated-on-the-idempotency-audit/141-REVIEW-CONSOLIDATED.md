# Phase 141 — Consolidated Review Findings (deduped)

**Date:** 2026-07-31
**Campaign:** 8 agents — 3 specialist reviewers (code-review, silent-failure, type-design),
2 analysis lenses (test-coverage w/ real mutations, comment/citation accuracy),
5 adversarial red teams (CR-02 onboard, CR-03+CR-01 harm, tenant isolation,
concurrency/races, stale-draft UX) + 1 completeness critic.

**Headline:** ZERO user-facing defects. ZERO data-integrity defects. Every blocking
claim was refuted under adversarial scrutiny. The retry MECHANISM is sound; the
audit ARTIFACT's evidence is wrong in several places, and the backoff DESIGN
ignores a contract that Phase 140.5 built specifically for it.

**Nothing is live.** `origin/main` has no `seam-retry-registry.ts` and no
`retriesOverride` — production performs zero seam retries today. Branch
`feat/v1.16-141-jobs-rate-retry` is 29 commits ahead, no open PR.

---

## RULED OUT — checked, clean (do NOT re-litigate in 141.1)

Recording these so the next reader does not redo the work. Each was a live
hypothesis killed by evidence.

| Claim | Verdict | Why it died |
|---|---|---|
| `onboard` retried without dedup → orphan SV row (CR-02) | **REFUTED** | `strategies.wizard_session_id` cannot be NULL on that path: `create-with-key:194` 400s unless `isUuid` BEFORE the RPC; composite + CSV RPCs stamp it; pre-F6 drafts purged daily by `cleanup_abandoned_wizard_drafts`. Surviving NULL producers (admin import, pre-2026-07-28 CSV) unreachable from `SubmitStep`. |
| 3 analytics verdicts unsafe to retry (CR-01) | **REFUTED (verdict)** | `audit_log` append-only, no unique key; the only 2 counting consumers key on `entity_type='process_key'` + a legacy type — neither sees `bridge_run`/`simulator_run`/`optimizer_run`. No billing/quota/lockout reads it. `optimizer_suggestions` is a single-column whole-value overwrite by row id from a deterministic pure pandas/numpy fn → byte-identical. **Premise CONFIRMED though — see B1.** |
| `failed_retry` index gap = seam double-enqueue (CR-03) | **REFUTED (analogy)** | The cited `sync-progress:31` hazard is kind `stitch_composite` via a DIRECT Supabase RPC from a Vercel route — no `resilientFetch`, not seam-retryable. Different endpoint/kind/mechanism. Blast radius doubly bounded: claim fn can't run both rows concurrently; both carry the same `verification_id` → duplicate short-circuits. Class pre-exists 141. |
| Tenant isolation / auth defect | **CLEAN** | Pre-check runs strictly AFTER the ownership gate (`:1316` → `:1432`, linear). `_caller_owns_strategy` returns False identically for unowned/nonexistent → no oracle. Fails closed on blank user_id. Retry does NOT widen auth: 4xx never retries; token + ownership re-evaluated live on attempt 2 → a key revoked between attempts is caught. |
| Stale-draft → "You've already submitted this strategy" | **REFUTED (harm)** | `SubmitStep` is the ONBOARD surface. Resync consumers (`ApiKeyManager:104`, `SyncPreviewStep:731`) read only `res.ok`/`body.ok`/`composite`. Duplicate body carries `ok:true` → normal kickoff. Sync runs correctly with the fixed key. Zero rendered difference. |
| Vercel function timeout → hard 504 | **NON-ISSUE** | All 15 seam routes pin `maxDuration = 300`. Worst case post-retry 60.5s (`optimize-weights`). `keys-permissions` deliberately held at `retries: 0` for the 10× composite path. |
| Amended pre-existing tests silently weakened a guarantee | **NONE FOUND** | 13 `retriesOverride: 0` insertions isolate one-attempt mechanics; the "one retried request records TWO breaker failures" case IS pinned. `test_process_key.py` retires PYAPI-09d deliberately; replacement is STRONGER on filter shape. |
| Self-referential oracles / vacuous tests | **NONE FOUND** | Every expected value hand-typed. Jitter pinned at BOTH extremes via `Math.random` spy. Anti-vacuity fences explicit. 4 key mutations reddened correctly. |
| Non-seam side effects (email/webhook/Slack) on retried routes | **NONE** | No `resend`/`send_email`/`slack`/`webhook` on `process_key.py`. Retries happen INSIDE `resilientFetch`, so route-level effects run once. |

---

## A. DESIGN — the reason this is a phase, not a patch

### A1. The retry ignores the upstream's contractual `Retry-After` — HIGH
`analytics-service/services/error_contract.py:131-152` makes `Retry-After` **mandatory**
on every SERVICE-TRANSIENT 503, from `RETRY_AFTER_SECONDS = {"mt5-gateway": 30, "supabase": 15}`,
with a validator that raises if a site disagrees. A 503 is retry-eligible
(`resilient-fetch.ts:2153`). The loop waits `250–500ms` and re-attacks.
**The service says "come back in 15s"; we come back in 0.375s.** The retry is
near-certain to fail AND burns a second breaker failure to learn it.

`Retry-After` appears nowhere in `seam-retry-registry.ts`, `141-RESEARCH.md`, or `141-REVIEW.md`.

⚠️ **Phase 140.5 shipped `Retry-After` propagation specifically as a HARD PREREQUISITE
for 141.** We built the input and did not consume it.

Design decision needed: honor `Retry-After` when present; if it exceeds the remaining
budget, fail fast rather than sleep-then-fail. (429 is already correctly excluded —
`attributability: "caller", counts: false`.)

### A2. `BREAKER_FAILURE_THRESHOLD = 5` never recalibrated for per-attempt counting — MED-HIGH
The per-attempt latch reset is deliberate and tested, but was reasoned only from the
under-trip direction. A doubly-failing request records 2 failures, so the **global**
`breaker:railway` key trips in ~2.5 user requests instead of 5 — and `breakerKeysFor`
appends `BREAKER_KEY` to every call site, so that key gates all 15 routes **including
the anonymous teaser**. Retry halved time-to-global-outage; no threshold, cooldown, or
window was revisited. Arguably the right direction (contain faster) — but it is an
undecided tradeoff, not an intentional one.

### A3. Server-side compute is not cancelled when the client deadline expires — MED
On a client `AbortSignal.timeout`, the FastAPI handler keeps computing (nothing awaits
`request.is_disconnected()`), so the retry adds a **second concurrent full compute** for
the 4 heavy budgets while the first still burns CPU. The breaker only contains this after
5 counted failures; 1–4 concurrent slow requests double Railway load precisely when it is
slowest. Cost/CPU appear nowhere in the 141 planning set.

---

## B. SEAM-05 DELIVERABLE — evidence correctness (the artifact IS the product)

The registry is designed so "the evidence IS the entry" and audit/enforcement cannot
drift. Wrong evidence is therefore a defective deliverable, even where no verdict
changes and no user is harmed — a future reader extends the allowlist by reasoning
from these strings.

- **B1.** Three analytics YES verdicts claim *"no persisted server-side write on the
  request path"* — false for `bridge` (`portfolio.py:2047,2123,2167`), `simulator`
  (`simulator.py:442,490`), `portfolio-optimizer` (`portfolio.py:1836-1838` UPDATE +
  `:1863` audit). Only `optimize-weights` is accurate. **Re-derive each with its actual
  traced finding + why the retry is still safe.** Verdicts stay; rows stay flipped.
  *(Raised independently by 3 agents.)*
- **B2.** `resync` evidence claims *"The SEQUENTIAL-retry class is closed."* False for
  the 15s-timeout sub-case: the pre-check filters `status='draft'`, but the worker
  (30s tick) advances SV#1 to `validated` with ~40% probability **within the blip**,
  so the pre-check misses and a 2nd draft row is inserted. Exactly one job still
  (index holds). Not user-visible; self-heals next resync.
- **B3.** `onboard` evidence states a **conditional as a fact** ("Caller-supplied
  wizard_session_id ⇒ idempotent_by_session=true") that the flow_type-keyed gate cannot
  verify. Record WHY the id is guaranteed (the `isUuid` 400 gate + 2 stamping RPCs +
  7-day draft purge) so a future NULL producer trips the recorded reasoning.
- **B4.** onboard/resync "exactly one SV row and one job" holds only while the job is in
  the 3 indexed statuses — `failed_retry` is outside the index predicate. Qualify.
- **B5.** Wrong migration id on BOTH flow verdicts: cites `20260418194206`, which creates
  the **allocator** index. Real one is `20260416125430` (or cite the constraint name,
  which does not rot).
- **B6.** `runPortfolioOptimizer` and `findReplacementCandidates` descriptions belong to a
  **different endpoint** — both describe `optimize-weights` behaviour ("returns null on
  degenerate input", "weighted-covariance compute"). Optimizer actually raises 404/400 and
  accepts a 3rd `weights` input; bridge reads every numeric input from Supabase and scores
  via Sharpe/correlation/drawdown, not covariance. Re-derive from each own handler.
- **B7.** Stale line coords: `resilient-fetch.ts:502`→**548**; `:1934-1937`→**1953-1955**;
  `keys/sync/route.ts:563-599`→**610-625**.
- **B8.** Add `src/lib/seam-retry-registry.ts` to `SEAM_CITATION_SURFACE`
  (`seam-citations.invariant.test.ts:106`) — the repo's existing guard banning bare
  `file:line` on the seam surface. The most citation-dense file in the phase is outside it,
  which is how B5/B7 shipped. Convert coords to symbol anchors.
- **B9.** Three now-false comments in `resilient-fetch.ts` (`:1482`, `:1919`, `:2001`):
  "Every SEAM_BUDGETS row still carries `retries: 0`" / "0 for every row today". Five rows
  are 1. Plus `:553-559` overstates the belt ("NOT what turns retry on" — true only for
  `postProcessKey`, which always passes an explicit override).
- **B10.** `test_resync_retry_single_job.sql:40` claims all fixture work runs inside
  `BEGIN…ROLLBACK`, but the 4 pre-clean DELETEs precede `BEGIN;` and commit under psql
  autocommit. Deliberate (recovering a prior aborted run) but self-contradictory — a false
  invariant claim in a file whose purpose is pinning invariants.

---

## C. REGISTRY-BYPASS AXIS — one hole, seen by 3 lenses

`retriesOverride?: number` is **optional** and falls back to `SEAM_BUDGETS[key].retries`
(`resilient-fetch.ts:1921`). So "absence ⇒ no-retry by construction" is true only INSIDE
the two client wrappers that spell `?? 0`. At the transport boundary, absence falls back
to the row — and five rows are now 1.

- **C1.** A new `resilientFetch("process-key-enqueue", …, { body: { flow_type: "teaser" }})`
  inherits `retries: 1` with the registry never consulted, and it typechecks. `budgetKey`
  and the body's `flow_type` are independent params; `validate-and-encrypt:221` is a live
  precedent for hand-picking a budget key while hand-writing a flow_type. **No live caller
  today** (all 3 direct callers land on retries-0 budgets). Remedy: make `retriesOverride`
  **required** `0 | 1` and drop the row fallback (+3 call sites), or expose accessors
  (`retriesForFlow` / `retriesForAnalytics`) holding the single `?? 0`.
- **C2.** No call-site census on the retry axis. `resilient-fetch.wiring.test.ts` exists
  precisely so an unclassified NEW call site "would be discovered by nothing" cannot happen
  for budget keys (`EXPECTED_BINDINGS` B-1…B-13). Phase 141 added a **second** classification
  axis with no equivalent census. *The fix pattern already exists in-repo and was not applied
  — the instance-not-class shape.*
- **C3.** **MEASURED:** deleting BOTH `retriesOverride` lines (all of plan 141-04's wiring)
  leaves **558 tests green across 11 files**, because the rows were flipped to mirror the
  registry exactly. The belt's INDEPENDENCE is pinned nowhere. Add a test that puts row and
  registry in DISAGREEMENT (force `process-key-sync.retries = 1`, assert teaser still
  single-fetch).
- **C4.** Maps are exported **mutable** with a type annotation, not `as const satisfies`.
  `RETRY_SAFE_FLOW_TYPES.teaser = {retries:1, evidence:""}` and `delete …onboard` both
  typecheck clean (compiled). Nothing frozen. `FlowType` exhaustiveness is NOT truly pinned
  (both sides hand-typed to the same list of 4); `budgetKeyFor` is a ternary with fall-through,
  so a 5th flow silently lands on `process-key-enqueue` (row = 1). The docblock at `:37-39`
  claims an enforcement that does not exist for flow_types.

---

## D. TEST HARDENING

- **D1.** **MEASURED:** hoisting the per-attempt deadline above the loop → **125 tests green**.
  In production that mutation is severe and silent: attempt 2 fires with an already-fired
  abort signal, so the retry becomes a **no-op for the timeout class** — the dominant
  Railway-blip class. The mock still sees 2 `fetch` calls, so nothing reddens. Add:
  `calls[0][1].signal !== calls[1][1].signal`, plus a fake-timer case proving attempt 2 gets
  a fresh full budget.
- **D2.** **MEASURED:** swapping `sleep()` and the pre-attempt-2 `isBreakerOpen` re-check →
  21/21 green. The comment claims the order is load-bearing (breaker may open DURING the
  backoff — a CONCURRENT caller). Harness already has `shared.mode.staleReadOnce` to script it.
- **D3.** `SEAM_RETRY_BACKOFF_MS` / `SEAM_RETRY_JITTER_MAX_MS` have no literal pin in
  `seam-constants.pin.test.ts`, unlike every sibling constant. (Indirectly falsifiable via
  jitter bounds — convention drift, not a hole.)
- **D4.** `seam-constants.pin.test.ts:335` uses `it.each(Object.keys(RETRY_SAFE_ANALYTICS))` —
  emptying the map yields ZERO cases → green. Add `expect(Object.keys(...).length).toBe(4)`.
- **D5.** The `status='draft'` filter has a shape pin (exact-filters dict) but no BEHAVIOUR pin.
  Untested user-facing case: a COMPLETED resync verification exists → a genuinely new resync
  must still queue, not answer WIZARD_DUPLICATE. ~10 lines against the existing stateful fake.
- **D6.** No test exercises `bridge` at its production configuration in `resilient-fetch.test.ts`.
- **D7.** Attempt 2's request identity is never asserted (same URL/Authorization/X-Service-Key/
  body). One `expect(calls[1]).toEqual(calls[0])` minus `signal` closes it AND catches D1.

---

## E. ACCOUNTING

- **E1.** SC-4b's `storeMs` term was not multiplied by `(1 + retries)` though `requestMs` was.
  `STORE_COMMANDS_PER_SEAM_CALL.failing = 3` is now stale: a retried failing call issues up to
  **6** commands (attempt-1 mget + trip get/set, pre-attempt-2 mget, attempt-2 get/set) —
  a ~12,750ms under-charge per retried leg, in the **unsafe** direction. **No ceiling breached**
  (worst route ~56,000ms vs 300,000ms). The file's own guard comment says "a future edit that
  adds a store round trip has to come back here" — 141 was that edit. *(Raised by 3 agents.)*
  Also stale: `:81` "with every row at `retries: 0`".

---

## F. OBSERVABILITY / OPS

- **F1.** **flag-monitor denominator bias.** `cron/flag-monitor/route.ts:49-51` is the repo's
  ONLY error-rate alert (`ALERT=0.005`, 15-min window, emails founder). Numerator = Sentry
  `level:error`; denominator = `audit_log` rows. A transient failure that now succeeds on
  attempt 2 emits **zero** Sentry events and zero 5xx while the denominator is unchanged →
  thresholds calibrated pre-retry under-report Railway degradation by exactly the retry
  success rate. Compounding: the `process_key.entry` audit emit at `process_key.py:1002`
  precedes BOTH dedup pre-checks, so a retried onboard/resync **deterministically** writes a
  2nd `entity_type='process_key'` row into that denominator even on the duplicate
  short-circuit — biasing `errorRate` DOWNWARD. **Retries suppress the alert precisely during
  the degradation that triggers them.**
- **F2.** The counting-5xx arm (`resilient-fetch.ts:2154-2163`) has **no `console.error` and no
  Sentry capture** — it does `recordOnce` then `continue`. The transport arm logs to Vercel
  only. The discarded attempt-1 diagnosis vanishes. Pre-threshold degradation is now materially
  quieter than on 2026-07-30 and nothing records the shift.
- **F3.** Zero ops surface. 25 runbooks in `docs/runbooks/`, the Vercel→Railway breaker appears
  in **none**. The only "circuit breaker" hit is `compute-queue.md:160` — a DIFFERENT breaker
  (Python per-API-key 429 cooldown), so on-call gets the wrong mental model. Nothing documents
  fail-open semantics, the Upstash keys, `seam.breaker.open`, or that the seam now makes up to
  2 attempts.
- **F4.** When attempt 1's own failure is the threshold-th, attempt 2's re-check throws
  `CircuitOpenError` and the caller loses attempt 1's 503 body (`dependency`, `human_message`)
  — the freshest diagnosis. Pre-141 the caller received that 503. Log the discarded status
  alongside the throw.
- **F5.** `flag-monitor` filters `path:/api/process-key`, a route that does not exist under
  `src/app/api/`. Pre-existing staleness the retry makes more consequential.

---

## G. OBLIGATIONS BOOKED TO 141, UNDISCHARGED

- **G1.** `TODOS.md:121` — 141 converts `recoverable` from a render hint into an automated
  retry input; TS-35's W-4 rider says the `unknown ⇒ true` polarity **must be RE-DERIVED at
  that moment**. No re-derivation artifact exists.
- **G2.** `TODOS.md:365` — LO-02 / TS-39 (`decodeBreakerLock` unbounded span → `Retry-After: 1e17`),
  routed to 141, not done.
- **G3.** `TODOS.md:483` now factually false ("the path 141 adds (unreachable today)" — 141 added it).
- **G4.** `TODOS.md` is untouched in the range and has **no phase-141 deferrals section**, unlike
  every prior v1.16 phase.
- **G5.** `141-REVIEW.md` was left **untracked** — the phase's own review artifact never committed.
- **G6.** CHANGELOG/VERSION/package.json untouched. Matches `CONTRIBUTING.md:68-71` (ship-time step),
  but 140 earned `[0.50.0.0]` and 140.3 `[0.50.1.0]`, and 141 turns retry ON for five budgets.

---

## H. MINOR — TODOS.md, non-blocking

- **H1.** Retry doubles per-tenant rate-limiter consumption during exactly the incidents it fires
  in (`/api/optimize-weights` 20/min, `/process-key` 100/hr). User sees "rate limited" for what is
  upstream degradation. Worth a recorded decision.
- **H2.** `resilient-fetch.ts:2160` `continue`s past a counting-status `Response` without
  `res.body?.cancel()` — undici buffers the full body until the attempt's signal fires.
- **H3.** `admittedAtMs` captured once at `:1967`, outside the loop, so attempt 2's failure is
  judged against a pre-loop admission instant and cannot re-arm a just-expired lock. Fail-open,
  consistent with A-25 doctrine. Know it; don't fix it.
- **H4.** `keys/sync/route.ts:619` forwards `status: "draft"` where the legacy contract promised
  `"syncing"`, and 200 where it promised 202. Nobody reads it today — but this is what would turn
  the stale-draft item into a real defect if a future consumer branches on it.
- **H5.** Pre-check `.limit(1)` has no `ORDER BY` → planner-dependent row when ≥2 drafts exist.
  Add `ORDER BY created_at DESC`; consider bounding to the retry window
  (`timeoutMs × (1+retries) + backoff`) so it recognises a RETRY, not any historical draft.
- **H6.** The 10-param `_enqueue_compute_job_internal` still uses `SELECT id INTO STRICT` on the
  lost-race re-read; the 7-param overload was deliberately de-STRICT-ed for exactly that, and a
  comment claims the two are "verbatim". Effectively unreachable for `process_key_long`. Latent
  divergence, pre-existing, not 141.
- **H7.** `H-0562` (multi-worker durability) cited in the registry is not in `TODOS.md`, so a
  reader asked to confirm "still OPEN" has nowhere to look.

---

## Suggested 141.1 shape

**Wave 1 (design — needs decisions):** A1 `Retry-After`, A2 breaker threshold, A3 cancellation stance.
**Wave 2 (SEAM-05 deliverable):** B1–B10 — re-derive evidence from traced source, add the citation guard.
**Wave 3 (construction + tests):** C1–C4 registry-bypass closure, D1–D7 test hardening, E1 accounting.
**Wave 4 (ops):** F1–F5 observability + runbook, G1–G6 obligations/housekeeping.
**TODOS.md:** all of H.

**Do not re-litigate the RULED OUT table.**
