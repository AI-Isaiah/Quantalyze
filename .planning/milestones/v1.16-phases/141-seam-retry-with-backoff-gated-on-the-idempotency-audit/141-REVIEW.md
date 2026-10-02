---
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
reviewed: 2026-07-31T00:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - src/lib/resilient-fetch.ts
  - src/lib/seam-retry-registry.ts
  - src/lib/process-key-client.ts
  - src/lib/analytics-client.ts
  - analytics-service/routers/process_key.py
findings:
  critical: 3
  warning: 6
  info: 6
  total: 15
status: issues_found
---

# Phase 141: Code Review Report

**Reviewed:** 2026-07-31
**Depth:** deep (cross-file, cross-language: TS seam core → TS clients → Python handler → SQL RPC/index definitions)
**Files Reviewed:** 5 primary source files (plus traced call chains into `finalize-wizard/route.ts`, `keys/sync/route.ts`, `portfolio.py`, `simulator.py`, `optimizer.py`, `services/audit.py`, `services/ingestion/long_fetch.py`, and four migrations)
**Status:** issues_found

## Summary

The **mechanism** is sound and I could not break it. I specifically tried to find a path where teaser or CSV retries, and there isn't one:

- `postProcessKey` keys the override on `flow_type`, not `budgetKey`, with an explicit `?? 0` (`process-key-client.ts:453`). `teaser`/`csv` are absent from `RETRY_SAFE_FLOW_TYPES`, so they resolve to 0 regardless of what the `process-key-sync` row says. Both belts are real and independent.
- Every `resilientFetch` call site was enumerated (6 total). The four that do *not* pass an override (`finalize-wizard:174`, `keys/[id]/permissions:231`, `keys/validate-and-encrypt:221`, plus the core itself) all land on rows that stayed `retries: 0`. No caller silently inherits a `retries: 1` row.
- The breaker gate is total: the entry check throws above the fetch `try`, and the pre-attempt-2 re-check (`resilient-fetch.ts:2025-2030`) is the identical gate re-run after the backoff, also above the `try`, so nothing in the loop can swallow `CircuitOpenError`.
- Per-attempt latch reset (`recorded = false`, :2034) is correct; the closure handed to `instrumentBody` carries the last attempt's latch, which is the right attribution.
- SC-4b headroom holds with room to spare on every route (worst branch ≈ 150 s against a 300 s ceiling).

The **gate** is where this phase fails. Phase 141's entire safety argument is "retry only where the SEAM-05 audit proved idempotency", and the audit evidence in `seam-retry-registry.ts` is **factually wrong in three separate places**, each of which was verified against the actual server code and migration DDL rather than against the plan. Three of the four analytics YES verdicts claim "no persisted server-side write on the request path" when those endpoints INSERT an `audit_log` row (and one also UPDATEs `portfolio_analytics`). The `onboard` verdict rests on a premise (`caller-supplied wizard_session_id`) that one of its two live callers structurally does not satisfy. And the compute-job dedup both flow verdicts lean on excludes `failed_retry` — a hole this repo already documented and mitigated *in the client* precisely because an automatic re-POST would double-enqueue.

The registry is *designed* to be self-falsifying ("the evidence IS the entry"). That design is good. It just wasn't executed against the server — the evidence strings were written from the plan, not traced.

## Critical Issues

### CR-01: Three of four analytics retry verdicts are allowlisted on false evidence — the endpoints DO write persisted rows on the request path

**File:** `src/lib/seam-retry-registry.ts:139-164` (and the mirrored justifications in `src/lib/resilient-fetch.ts:489-519`)

**Issue:**
`RETRY_SAFE_ANALYTICS` allowlists `bridge`, `simulator`, `portfolio-optimizer` and `optimize-weights` with evidence of the form *"pure compute … no persisted server-side write on the request path."* Traced to the handlers, that is false for three of the four:

| budgetKey | endpoint | persisted write on the request path |
|---|---|---|
| `portfolio-optimizer` | `routers/portfolio.py:1636` | `supabase.table("portfolio_analytics").update({"optimizer_suggestions": …})` (:1837) **and** `log_audit_event(action="optimizer.run", …)` (:1863) |
| `bridge` | `routers/portfolio.py:1898` | `log_audit_event(action="bridge.score_candidates", …)` (:2047 / :2123) |
| `simulator` | `routers/simulator.py` | `log_audit_event(…)` (:442, :490) |
| `optimize-weights` | `routers/optimizer.py:42` | none found — this one verdict is correct |

`services/audit.py` is unambiguous: `log_audit_event` **writes a row to `audit_log`** via the service-role `log_audit_event_service` RPC. It is append-only and carries no idempotency key, so one retried request produces **two** audit rows for one user action.

`portfolio-optimizer` is the worst case: it both re-writes `portfolio_analytics.optimizer_suggestions` (the file's own comment at :1826-1833 calls this "an in-place UPDATE of an append-only snapshot", H-0573) and emits a second `optimizer.run` audit event. Note the timing: a retry fires on a *deadline* or *transport reset*, which can occur **after** the server has already committed both. So this is not a theoretical window — it is the ordinary lost-response case.

`audit_log` is a compliance artifact (ADR-0023 §8, service-role-only RPC, attribution-spoof gated). Duplicating it misstates what the user did, and the endpoint that gained the retry (`portfolio-optimizer`) is rate-limited at 10/hour precisely because it is expensive.

**Fix:** Either correct the verdicts to NO for the three endpoints that write, or keep them YES with *honest* evidence that argues the writes are tolerable under replay — and say so explicitly rather than asserting there are none.

```ts
// src/lib/seam-retry-registry.ts
export const RETRY_SAFE_ANALYTICS: Partial<Record<SeamBudgetKey, RetrySafeEntry>> = {
  // KEEP — verified no writes on the request path (routers/optimizer.py has no
  // .insert/.update/.rpc and does not import log_audit_event).
  "optimize-weights": { retries: 1, evidence: "optimizeScenarioWeights — pure compute over caller-supplied series; routers/optimizer.py performs NO DB write and emits NO audit event." },
};

export const RETRY_AUDIT_NO_ANALYTICS: Partial<Record<SeamBudgetKey, string>> = {
  // … existing five …
  "portfolio-optimizer":
    "runPortfolioOptimizer is NOT pure compute. portfolio.py:portfolio_optimizer " +
    "UPDATEs portfolio_analytics.optimizer_suggestions in place (H-0573) AND emits " +
    "log_audit_event(action='optimizer.run') — an append-only audit_log INSERT with no " +
    "idempotency key. A retry after a lost response double-writes the audit row.",
  bridge:
    "findReplacementCandidates emits log_audit_event(action='bridge.score_candidates') " +
    "(portfolio.py, H-0815 invariant: every successful bridge exit MUST emit an audit row). " +
    "audit_log has no idempotency key; a retry double-writes it.",
  simulator:
    "simulateAddCandidate emits log_audit_event on both the reject and happy paths " +
    "(simulator.py:442, :490). Same audit_log duplication as bridge.",
};
```
and flip the corresponding `SEAM_BUDGETS` rows (`bridge`, `simulator`, `portfolio-optimizer`) back to `SEAM_RETRIES`, plus `EXPECTED_RETRIES` in `seam-constants.pin.test.ts`.

---

### CR-02: `onboard` is allowlisted unconditionally, but one of its two live callers does not supply `wizard_session_id` — and no dedup pre-check covers onboard-without-a-session

**File:** `src/lib/seam-retry-registry.ts:85-96`; `src/app/api/strategies/finalize-wizard/route.ts:1586-1588`; `analytics-service/routers/process_key.py:1439` (the new `if body.flow_type == "resync":` gate)

**Issue:**
The `onboard` YES evidence opens with a **conditional premise**: *"Caller-supplied wizard_session_id ⇒ idempotent_by_session=true."* The retry gate does not check that premise — it keys on `flow_type === "onboard"` alone.

The premise fails on a live path. `finalize-wizard` forwards the session id with a **conditional spread**:

```ts
// finalize-wizard/route.ts:1586
...(args.wizardSessionId !== null ? { wizard_session_id: args.wizardSessionId } : {}),
```

and `wizardSessionId` is `null` whenever `strategies.wizard_session_id` is NULL — which the route's own comment (:672-676) says happens for *"a draft that predates F6, or one minted by a path that does not stamp it"* (the column is nullable per migration 20260602190000).

On that path, in `process_key.py`:
- `wizard_session_id = body.context.get("wizard_session_id") or str(uuid.uuid4())` (:1018) → a **fresh server uuid4 per call**;
- `idempotent_by_session = … and bool(body.context.get("wizard_session_id"))` (:1033) → **False**;
- the `:1350` idempotent-by-session pre-check therefore never fires;
- the new `2b` pre-check added by this phase is gated on `body.flow_type == "resync"` (:1439), so it does not fire either;
- the draft INSERT succeeds (no 23505 — the unique index is on `(strategy_id, wizard_session_id)` and the uuid4 is fresh), minting a **second `strategy_verifications` row**;
- `enqueue_compute_job` then returns the *first* attempt's job id, whose `metadata.verification_id` points at the **first** verification.

Result of one retry: a permanently orphaned `draft` verification row, **and** the `verification_id` returned to the client is the orphan's — while the worker writes its results to the other one. This is exactly the harm phase 141 plan-01 built the resync pre-check to close, left open on the onboard twin.

**Fix:** Gate the retry on the premise, not on the flow name. The cheapest correct fix is to make the override conditional on a session id actually being present:

```ts
// process-key-client.ts — postProcessKey
// onboard's retry-safety is CONDITIONAL on a caller-supplied wizard_session_id
// (process_key.py:1033 — idempotent_by_session). finalize-wizard omits it when
// strategies.wizard_session_id is NULL, and no dedup pre-check covers that case.
const sessionId = args.context["wizard_session_id"];
const retrySafe =
  args.flow_type === "onboard"
    ? typeof sessionId === "string" && sessionId.length > 0
    : true;
// …
retriesOverride: retrySafe ? (RETRY_SAFE_FLOW_TYPES[args.flow_type]?.retries ?? 0) : 0,
```

Alternatively, extend the `2b` pre-check to `body.flow_type in ("resync", "onboard")` when `not idempotent_by_session` — but that is a broader change and does not remove the need to state the condition in the registry evidence.

---

### CR-03: the compute-job dedup both flow verdicts rely on excludes `failed_retry` — the seam retry is the automatic re-POST the client mitigation exists to prevent

**File:** `src/lib/seam-retry-registry.ts:92-94` (onboard) and `:100-101` (resync); `analytics-service/routers/process_key.py:1417-1420` (the new comment's dedup claim)

**Issue:**
Both YES verdicts state, without qualification, that the compute job is *"deduped on (strategy_id, kind) by `compute_jobs_one_inflight_per_kind_strategy`"*. The live definition of that index and of the RPC behind it both restrict the dedup to three statuses:

```sql
-- supabase/migrations/20260416125430_contact_request_metadata.sql:156-160
CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_strategy
  ON compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND kind <> 'compute_intro_snapshot'
    AND status IN ('pending', 'running', 'done_pending_children');

-- supabase/migrations/20260716090000_…:233-237 (_enqueue_compute_job_internal)
WHERE strategy_id = p_strategy_id AND kind = p_kind
  AND status IN ('pending', 'running', 'done_pending_children')
```

`failed_retry` is **not** in either set. The repo already knows this and already mitigates it — in the client, for exactly this reason:

> `src/app/api/strategies/[id]/sync-progress/route.ts:33-36` — *"NB (F-3): that index EXCLUDES `failed_retry`, so a re-POST during a retry backoff would **INSERT A SECOND stitch**, not no-op. The client therefore SUPPRESSES the manual Retry whenever it observes `jobStatus === "failed_retry"`."*

The seam retry has no equivalent suppression and is not observable to that client guard. Reachability is concrete: attempt 1 hits the 15 s `process-key-enqueue` deadline; inside those 15 s the worker claims the job, hits a transient error and lands in `failed_retry` with a backoff; the retry fires at t ≈ 15.5 s and enqueues a **second `process_key_long` job** for the same strategy. Two concurrent long-fetch jobs = duplicate broker fetch and duplicate ingestion — and when the first job's backoff elapses and it transitions `failed_retry → running`, it collides with the second job on the partial unique index.

This applies to **both** `onboard` and `resync`, and it is not fixed by the `2b` pre-check: that path calls `_resume_duplicate_job`, which calls the same `enqueue_compute_job` RPC with the same status set.

**Fix:** Either narrow the allowlist until the dedup covers `failed_retry`, or make the seam retry non-eligible while a `failed_retry` job exists. The evidence strings must at minimum stop asserting an unqualified dedup:

```ts
// seam-retry-registry.ts — both entries
"Compute job deduped on (strategy_id, kind) by " +
"compute_jobs_one_inflight_per_kind_strategy (created migration 20260411144407, " +
"redefined 20260416125430) — BUT ONLY over status IN ('pending','running'," +
"'done_pending_children'). `failed_retry` is EXCLUDED, so a retry that lands during " +
"a job's retry backoff INSERTS A SECOND process_key_long job (the same hole " +
"sync-progress/route.ts F-3 mitigates by suppressing the client Retry CTA). " +
"NOT retry-safe until that window is closed."
```

## Warnings

### WR-01: the resync draft-SV pre-check is defeated by the worker advancing the row out of `draft` inside the retry window

**File:** `analytics-service/routers/process_key.py:1439-1447`

**Issue:** The pre-check matches `.eq("status", "draft")`. `services/ingestion/long_fetch.py` transitions the verification `draft → validated` (:449) as soon as `adapter.validate()` returns. The retry window is `timeoutMs (15 000 ms) + SEAM_RETRY_BACKOFF_MS + jitter ≈ 15.5 s` — ample time for the worker to claim the job and complete validation. When it has, the pre-check SELECT returns nothing, the INSERT proceeds (fresh server uuid4, so no 23505), and a **second** `strategy_verifications` row is minted. The registry's claim that *"the SEQUENTIAL-retry class is closed"* (`seam-retry-registry.ts:106`) is therefore too strong.

**Fix:** Widen the pre-check to the non-terminal verification statuses rather than `draft` alone — i.e. match the set the resume path already treats as live work — or key the dedup on the existence of a non-terminal `process_key_long` compute_job for the strategy instead of on the SV status. Whichever is chosen, correct the evidence string so it states the window it actually closes.

### WR-02: the resync pre-check has no time bound, so a permanently-`draft` verification changes the reply shape for every future user-initiated sync

**File:** `analytics-service/routers/process_key.py:1439-1447`

**Issue:** `long_fetch.py:359-372` transitions a write-capable-key rejection **back to `draft`** with error metadata rather than to a terminal status. Such a row satisfies the new pre-check forever. From then on every user-initiated "Sync now" for that strategy takes the duplicate path, so `keys/sync/route.ts:610` returns **200** with `code: "WIZARD_DUPLICATE"` and `status: existing["status"]` = `"draft"` instead of **202** `status: "syncing"`. The current consumers (`ApiKeyManager.isSyncEnqueued`, `SyncPreviewStep`) only test `res.ok` / `body.ok === true`, so nothing breaks today — but the wire contract for a normal resync silently changed for those strategies, and any future consumer reading `status` gets `"draft"`.

**Fix:** Bound the pre-check to the retry window it exists for (e.g. `created_at > now() - interval '2 minutes'`), so a stale draft cannot capture unrelated later syncs. Add a route test pinning that a fresh resync on a strategy with an old draft still returns 202 `syncing`.

### WR-03: `SEAM_BUDGETS[key].retries` is unvalidated, unlike `retriesOverride` — a row edit bypasses the "exactly one retry" policy

**File:** `src/lib/resilient-fetch.ts:1904-1921`, `:2010-2011`

**Issue:** `retriesOverride` is validated to the integer 0 or 1 with a `SeamConfigError` above the classification window. The row value it falls back to (`SEAM_BUDGETS[budgetKey].retries`, typed plain `number`) is validated nowhere. A row set to `3` produces four attempts with no config fault and no diagnostic; a row set to `-1` skips the loop entirely and falls through to the `"retry loop exited without returning — unreachable"` throw at :2182, which both clients then render as a generic `UPSTREAM_NETWORK_ERROR` 502 — an unreachable-by-comment path that is reachable by data. This matters more now than pre-141 because this phase's whole workflow is "flip rows".

**Fix:** Validate the resolved value, not just the override:

```ts
const retries = retriesOverride ?? SEAM_BUDGETS[budgetKey].retries;
if (!Number.isInteger(retries) || retries < 0 || retries > 1) {
  console.error(`[resilient-fetch] ${budgetKey}: CONFIG fault — SEAM_BUDGETS row declares retries ${String(retries)}; only 0 and 1 are legal.`);
  throw new SeamConfigError(`[resilient-fetch] ${budgetKey}: invalid row retries ${String(retries)} — expected the integer 0 or 1`);
}
```

### WR-04: the retry halves the effective per-tenant rate-limit budget on the two 10/hour analytics endpoints

**File:** `src/lib/analytics-client.ts:434`; `analytics-service/routers/portfolio.py:1637-1639`, `:1899-1901`

**Issue:** `/api/portfolio-optimizer` and `/api/portfolio-bridge` are decorated `@limiter.limit("10/hour", key_func=tenant_or_platform_key)`. slowapi counts on handler entry, so a 5xx from the handler has already consumed a token; the retry consumes a second. During a Railway degradation a user's 10/hour becomes an effective 5/hour and they hit a 429 — a user-facing throttle caused by the mitigation. `/api/optimize-weights` (20/min) has the same shape with more headroom. This interaction is not mentioned in the registry evidence or the plan.

**Fix:** If these rows survive CR-01, either raise the per-tenant ceilings in step with `(1 + retries)` or record the halving explicitly in the evidence so the next limit audit (TS-22 / Phase 146) sees it.

### WR-05: a one-shot request body would be consumed by attempt 1 and turn attempt 2 into a spurious breaker failure

**File:** `src/lib/resilient-fetch.ts:1470`, `:2064-2075`

**Issue:** `ResilientFetchInit` is `Omit<RequestInit, "signal">`, so `body` may be a `ReadableStream`, `FormData` or any one-shot `BodyInit`. The loop re-passes the same `requestInit` object to `fetch` on attempt 2. Both current clients send `JSON.stringify(...)` strings, which are re-sendable, so this is latent — but if a future caller passes a stream, attempt 2 throws `TypeError: body already used`, which lands in the transport catch, is classified as a transport failure, and **records a second breaker failure** against a fault that is entirely local. Nothing in the type system or the docblock forbids it.

**Fix:** Refuse a non-replayable body above the classification window when `retries > 0`:

```ts
if (retries > 0 && requestInit.body != null && typeof requestInit.body !== "string") {
  throw new SeamConfigError(
    `[resilient-fetch] ${budgetKey}: retries>0 requires a replayable (string) body — a one-shot BodyInit cannot be re-sent on attempt 2.`,
  );
}
```

### WR-06: `process-key-enqueue`'s row now carries `retries: 1`, so a future direct caller inherits a retry with no registry verdict

**File:** `src/lib/resilient-fetch.ts:556`; `src/lib/seam-retry-registry.ts:54-62`

**Issue:** The registry's grain-exclusion note says the process-key budgets are excluded from the analytics maps and that `keys-permissions` is *"protected by its `SEAM_BUDGETS` row staying `retries: 0`"*. It says nothing equivalent about `process-key-enqueue`, whose row is now `1`. Today the only caller (`postProcessKey`) always passes an explicit override, so the row is inert — but a new `resilientFetch("process-key-enqueue", …)` call site would silently get a retry without any flow-type verdict, which is the exact many-to-one hazard the flow-type keying exists to prevent. There is no ESLint rule or test that would catch it.

**Fix:** Either keep the row at `SEAM_RETRIES` and teach the SC-4b arithmetic to read the registry's flow-type verdict for that row, or add an invariant test asserting that `process-key-enqueue` and `process-key-sync` have exactly one `resilientFetch` call site each and that it is inside `process-key-client.ts`.

## Info

### IN-01: four docblocks in the seam core still describe the pre-141 dormant state

**File:** `src/lib/resilient-fetch.ts:1481-1487`, `:1919-1921`, `:2001-2003`, `:236`

**Issue:** All still assert that retry is dormant: *"Every `SEAM_BUDGETS` row still carries `retries: 0`, so the loop below is DORMANT"*; *"Plan 141-04 wires the callers; until then nothing passes it and production behaviour is unchanged"*; *"the row's seeded value (0 for every row today…)"*; *"At retries=0 — every row today…"*. Five rows now carry `1` and both clients are wired. A reader trusting these would conclude the loop cannot fire.

**Fix:** Replace each with the post-activation statement (which rows are `1`, and that the *override* is what gates flow-typed callers).

### IN-02: three citations in the new artifacts point at the wrong file or line

**File:** `src/lib/seam-retry-registry.ts:93-94`, `:101`, `:187`, `:105`

**Issue:**
- `compute_jobs_one_inflight_per_kind_strategy (migration 20260418194206)` — cited twice. `20260418194206` is `scoring_weight_overrides.sql`, which only *mentions* the index. It is created in `20260411144407_compute_jobs_queue.sql:179` and redefined in `20260416125430_contact_request_metadata.sql:156`.
- `resilient-fetch.ts:502` for the portfolio-analytics "no callers" note — :502 is inside the `simulator` row; the note is at :547-548.
- `keys/sync/route.ts:563-599` for the WIZARD_DUPLICATE translation — that range is the docblock; the branch is :610-631.

Per the repo's own 140.5-07 rule these should be symbol-anchored, not `file:line`.

**Fix:** Re-anchor to symbols (`_enqueue_compute_job_internal`, `SEAM_BUDGETS["portfolio-analytics"].notes`, `unifiedKeysSyncHandler`) and correct the migration filename.

### IN-03: SC-4b does not charge the extra breaker `mget` the retry path performs

**File:** `src/lib/seam-budgets.invariant.test.ts:651-657`

**Issue:** The store term is `STORE_COMMANDS_PER_SEAM_CALL[state] × STORE_COMMAND_WORST_CASE_MS × seamCalls`. The retry loop performs a *second* `isBreakerOpen` before attempt 2 (`resilient-fetch.ts:2025`), which the arithmetic does not count. No route breaches its ceiling with the correction applied, so this is an under-charge in a safety invariant rather than a live breach.

**Fix:** Scale the store term by `(1 + retries)` per leg, mirroring the request term.

### IN-04: a retried response's body is neither consumed nor cancelled

**File:** `src/lib/resilient-fetch.ts:2154-2162`

**Issue:** On a counting status that is not the last attempt, `res` is discarded via `continue` with its body unread — and on a 503, `readDependencyBody` has already `res.clone()`d it, so both branches of the tee are left dangling. undici holds the socket until GC. Correctness is unaffected; noted because it only became reachable in this phase.

**Fix:** `void res.body?.cancel().catch(() => {})` before `continue`.

### IN-05: the resync pre-check picks nondeterministically when more than one draft exists

**File:** `analytics-service/routers/process_key.py:1440-1447`

**Issue:** `.limit(1)` with no `.order()` — PostgREST returns an arbitrary row. The comment acknowledges the two-draft residual (concurrent tabs) but not that which one is resumed is then unspecified.

**Fix:** Add `.order("created_at", desc=False)` so the resumed row is the one the first attempt created.

### IN-06: the ME-04 teaser breaker-key containment is still marked "Recorded for Phase 141" but was not addressed

**File:** `src/lib/resilient-fetch.ts:585-594`

**Issue:** The `process-key-sync` row's comment says containment of the anonymous teaser's failures onto a dedicated breaker key is *"Recorded for Phase 141"*. Phase 141 did not touch it (correctly — it is a cross-language change and this phase's fence is zero Python beyond the resync pre-check), leaving a forward reference to a phase that is now closing.

**Fix:** Re-point the deferral to a live owner (Phase 142+ or `TODOS.md`) so it does not read as done.

---

_Reviewed: 2026-07-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
