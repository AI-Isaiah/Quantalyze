/**
 * The seam retry-safety registry — the SC1 idempotency-audit artifact AND the
 * runtime retry allowlist, in ONE file (Phase 141 / SEAM-05).
 *
 * ⚠️ LOAD-BEARING LEAF. This module is dependency-free: **zero VALUE imports,
 * zero env reads, zero module-load side effects.** The only two imports are
 * `import type` (erased at build) so the leaf carries no runtime edge. Keep it
 * that way. Two independent constraints force the purity (both are pinned by
 * `seam-retry-registry.test.ts`, mirroring `seam-discriminator.purity.test.ts`):
 *
 *   1. BUNDLE BOUNDARY. Plan 04 consults this registry from `postProcessKey`,
 *      whose graph is reachable from the `"use client"` connect-key wizard. A
 *      VALUE import of `resilient-fetch.ts` here would drag `@upstash/redis`,
 *      `@upstash/ratelimit` and a `Redis.fromEnv()` module-load side effect into
 *      the BROWSER bundle. `import type` erases, so it does not.
 *   2. MOCK SURVIVAL. Every route test mocks the seam clients wholesale with no
 *      `importActual`. A predicate reached THROUGH such a mock evaluates to
 *      `undefined` and throws a TypeError from inside a catch block. Nothing
 *      mocks this leaf, so it holds under every existing mock shape — a property
 *      that survives only while it imports nothing worth mocking.
 *
 * ── (a) WHY AUDIT AND ALLOWLIST ARE THE SAME ARTIFACT (SC1 anti-drift) ────────
 *
 * A retry-safety AUDIT that lives in a doc and a retry ALLOWLIST that lives in
 * code drift the moment either is edited without the other — and a drift here is
 * a call retried on evidence that no longer holds. So the evidence IS the entry:
 * every YES verdict carries its traced server-side proof inline as a required,
 * non-empty `evidence` string, and every NO verdict is itself an evidence string
 * (the `RETRY_AUDIT_NO_*` maps). The documented audit and the runtime gate are
 * physically one thing and cannot diverge.
 *
 * ── ABSENCE ⇒ NO-RETRY, BY CONSTRUCTION ──────────────────────────────────────
 *
 * The YES maps are `Readonly<Partial<Record<…>>>` — PARTIAL is the load-bearing
 * half here, and it is why the annotation is not `as const`'s narrow key type
 * (see IMMUTABLE, below). The wrapper reads `RETRY_SAFE_*[key]?.retries ?? 0`
 * (plan 04), so a flow_type or wrapper with no entry simply gets zero retries.
 * There is no separate "default no-retry" rule to forget — everything unproven
 * is no-retry because the map has no row for it.
 *
 * ── WHAT ACTUALLY FORCES A VERDICT (141.1 / D-11) ────────────────────────────
 *
 * The sentence that used to stand here claimed that "a new flow_type or wrapper
 * added without an audit verdict reddens the exhaustiveness pin in the test,
 * forcing a verdict before it can ship". That was PARTLY FALSE on the day it was
 * written: the pin compared YES∪NO against a HAND-TYPED list, so both sides
 * agreed by copy-paste and a 5th `FlowType` reddened NOTHING. The claim is now
 * true — and it is true in TWO STEPS, which is worth stating because step 1
 * alone looks like the whole mechanism and does not by itself force a verdict:
 *
 *   1. COMPILE. `seam-retry-registry.test.ts` carries the house
 *      `Exclude`-to-`never` assertions (the `for-quants-lead` form): the
 *      hand-typed `EXPECTED_ALL_FLOW_KEYS` / `EXPECTED_ALL_ANALYTICS_KEYS` must
 *      COVER `FlowType` / `SeamBudgetKey`, so a new union member breaks
 *      `npm run typecheck` until the list names it. `budgetKeyFor` in
 *      `process-key-client.ts` breaks in the same pass, on its `never`-defaulted
 *      switch arm.
 *   2. RUN. Naming the new member in that list is exactly what then REDDENS the
 *      runtime exhaustiveness pin, because YES∪NO no longer equals the list. The
 *      only route back to green is an actual verdict in a YES or a NO map.
 *
 * Neither step alone forces the verdict. The chain does.
 *
 * ── IMMUTABLE AT BOTH LEVELS (141.1 / D-11, threat T-141.1-11) ───────────────
 *
 * The four maps used to be exported with a widening TYPE ANNOTATION and nothing
 * else, so `RETRY_SAFE_FLOW_TYPES.teaser = { retries: 1, evidence: "" }` and
 * `delete RETRY_SAFE_FLOW_TYPES.onboard` both typechecked clean and both took at
 * runtime. A pushed row is a legitimate retry verdict from that moment on — for
 * `teaser` that is the double-minted verification/public_token/lead this whole
 * registry exists to prevent. Both levels are now closed:
 *
 *   · COMPILE — `as const satisfies Partial<Record<…>>` at each literal (the
 *     `audit.ts` house form), read back out through a `Readonly<…>` annotation.
 *     `satisfies` keeps the key/value validity check at the literal, where the
 *     error points at the offending row; the `Readonly<…>` annotation is what
 *     makes the assignment and the `delete` compile ERRORS while KEEPING the
 *     widened `Partial<Record<FlowType, …>>` index the consumers need — both
 *     `process-key-client` and `analytics-client` index these maps with the FULL
 *     union and rely on a miss yielding `undefined`. Both former mutation
 *     vectors are pinned as `@ts-expect-error` fixtures in the test.
 *   · RUNTIME — `freezeVerdicts` below freezes the map AND its entries. A
 *     type-level `readonly` is erased at build; a pushed row from plain JS or
 *     from behind an `as any` is not, and that is the vector the docblock's
 *     "immutable" claim has to cover to be worth making.
 *
 * ── (b) WHY TWO GRAINS ────────────────────────────────────────────────────────
 *
 * The two seams disambiguate differently and MUST be keyed differently:
 *
 *   · process-key seam → keyed by `FlowType`. `budgetKeyFor` is MANY-TO-ONE:
 *     `process-key-sync` serves BOTH teaser and csv; `process-key-enqueue` serves
 *     BOTH onboard and resync. Keying the retry decision on `budgetKey` would
 *     retry `teaser` the moment `csv` were allowed onto the sync budget — the SC3
 *     landmine. The decision is therefore made on `flow_type` (plan 04 threads a
 *     `retriesOverride` from `postProcessKey` into `resilientFetch`).
 *   · analytics seam → keyed by `SeamBudgetKey`, which is 1:1 with the wrapper
 *     function, so the budget key IS the seam-function identity.
 *
 * ── (c) THE GRAIN EXCLUSIONS ──────────────────────────────────────────────────
 *
 * `keys-permissions`, `process-key-enqueue`, `process-key-sync` and
 * `process-key-unified-dormant` are `SeamBudgetKey`s but are DELIBERATELY absent
 * from the analytics maps: they are ROUTE budgets, not analytics-seam-function
 * verdicts. The process-key seam is audited at `flow_type` grain (above), and
 * `keys-permissions` is protected by its `SEAM_BUDGETS` row staying `retries: 0`
 * (pinned in plan 04). Listing them here would be auditing the same seam twice at
 * two grains — the exclusion is by design, not an oversight.
 *
 * 141.1 / D-11 — THIS EXCLUSION LIST IS NOW ENFORCED, not merely described.
 * `seam-retry-registry.test.ts` types the same four keys as `RouteBudgetKey` and
 * subtracts them from `SeamBudgetKey` before asserting analytics coverage, so a
 * FOURTEENTH budget key must be classified as an analytics wrapper (→ a verdict
 * here) or as a route budget (→ that list) before `npm run typecheck` passes.
 * Doing neither is no longer a silent exclusion. Edit the two together.
 */

import type { FlowType } from "./process-key-client";
import type { SeamBudgetKey } from "./resilient-fetch";

/**
 * A retry-safe verdict. `retries` is the literal type `1` — exactly one retry is
 * locked for this phase (CONTEXT: "with EXACTLY ONE retry there is a single
 * interval"). Widening to N>1 is a deliberate type change, not a data edit.
 */
export interface RetrySafeEntry {
  readonly retries: 1;
  /** The traced server-side proof — the SC1 audit text, co-located with the gate. */
  readonly evidence: string;
}

/**
 * Freeze a verdict map AND the entries inside it (141.1 / D-11).
 *
 * ⚠️ THE ENTRY LEVEL IS NOT DECORATION. A SHALLOW `Object.freeze` closes the
 * ADD vector (`RETRY_SAFE_FLOW_TYPES.teaser = …`) but leaves the REPOINT vector
 * open: `RETRY_SAFE_ANALYTICS.bridge.retries = 5` would still take, and five
 * retries on a handler that appends an audit row per attempt is the same
 * elevation T-141.1-11 names — reached through a row that is already a legal
 * YES, so no key-set pin would see it. Freezing one level and calling the result
 * "immutable" is the shape of over-claim this phase exists to remove, so both
 * levels are frozen and both are asserted in `seam-retry-registry.test.ts`.
 *
 * The `typeof … === "object"` arm is what lets ONE helper serve BOTH map shapes:
 * the YES maps hold `RetrySafeEntry` objects, the NO maps hold bare strings
 * (primitives are already immutable and `Object.freeze` on one is a no-op, but
 * skipping them keeps the intent explicit rather than incidental).
 *
 * `Object.freeze` is a global — no import, so the leaf-purity constraint at the
 * top of this file survives it (`seam-retry-registry.test.ts` pins that).
 */
function freezeVerdicts<T extends object>(map: T): Readonly<T> {
  for (const entry of Object.values(map)) {
    if (typeof entry === "object" && entry !== null) Object.freeze(entry);
  }
  return Object.freeze(map);
}

/**
 * `/process-key` flow_types that ARE retry-safe. PRESENT ⇒ retry once; ABSENT ⇒
 * no-retry by construction. Exactly TWO entries — `teaser` and `csv` are proven
 * NO and live in `RETRY_AUDIT_NO_FLOW_TYPES`.
 */
export const RETRY_SAFE_FLOW_TYPES: Readonly<
  Partial<Record<FlowType, RetrySafeEntry>>
> = freezeVerdicts({
  onboard: {
    retries: 1,
    evidence:
      "A non-NULL wizard_session_id makes idempotent_by_session true at the " +
      "flow-type gate in process_key.py, and the idempotent_by_session pre-check " +
      "there routes a hit to _resume_duplicate_job, which returns the shared " +
      "WIZARD_DUPLICATE reply. PROVENANCE OF THAT ANTECEDENT — recorded here " +
      "rather than stated as a fact, so a future producer able to emit a " +
      "NULL/non-uuid session id visibly trips this reasoning instead of silently " +
      "invalidating it: (a) the isUuid 400 gate in create-with-key rejects a " +
      "non-uuid session id BEFORE the RPC; (b) the two stamping RPCs (composite " +
      "and CSV creation) stamp strategies.wizard_session_id at creation " +
      "[established, RULED OUT row 1]; (c) cleanup_abandoned_wizard_drafts " +
      "atomically purges 7-day-old drafts, so pre-F6 NULL-carrying drafts do not " +
      "survive to be finalized. DEDUP: the SV row is deduped by the FULL " +
      "(non-partial) unique index strategy_verifications_strategy_wizard_session_uniq " +
      "— no predicate, so no status qualification applies to the SV half. The " +
      "compute job is deduped on (strategy_id, kind) by the PARTIAL unique index " +
      "compute_jobs_one_inflight_per_kind_strategy, whose predicate admits only " +
      "the statuses pending, running and done_pending_children — so 'exactly one " +
      "job' holds ONLY while the job sits in those three indexed statuses; " +
      "failed_retry is outside the predicate. PRODUCERS — this verdict covers " +
      "BOTH emitters of flow_type=onboard, and the provenance above holds for " +
      "only one of them. (1) strategies/finalize-wizard, via postProcessKey, " +
      "threads the draft's wizard_session_id into the same context field the CSV " +
      "routes use; it is the path the provenance argument was derived from and " +
      "the only path on which this allowlist entry actually activates (it lands " +
      "on the process-key-enqueue budget). (2) keys/validate-and-encrypt emits a " +
      "hand-written onboard body through the seam core on the " +
      "process-key-unified-dormant budget and sends NO wizard_session_id at all, " +
      "so idempotent_by_session would be FALSE there. That producer is " +
      "nonetheless retry-safe because no retry can reach it: its budget row is " +
      "pinned at zero retries by the EXPECTED_RETRIES table in " +
      "seam-constants.pin.test.ts, and its handler is dormant " +
      "(zero callers as of 2026-07-31 — a dated, falsifiable claim, anchored to " +
      "that pin so a flip reddens rather than rots). D-08 gives that call site an explicit " +
      "retriesOverride of 0 in this same change. If either anchor moves, this " +
      "producer must be re-audited before onboard keeps its YES.",
  },
  resync: {
    retries: 1,
    evidence:
      "resync mints a SERVER-side uuid4 session in the resync branch of " +
      "process_key.py, so it lacks onboard's wizard_session_id dedup. WHAT HOLDS: " +
      "the compute job is deduped on (strategy_id, kind) by the partial unique " +
      "index compute_jobs_one_inflight_per_kind_strategy, so a retried resync " +
      "yields exactly ONE job — qualified, as on onboard, to the three statuses " +
      "its predicate admits (pending, running, done_pending_children); " +
      "failed_retry is outside it. Phase-141 plan-01 added a strategy-scoped " +
      "draft-SV pre-check keyed on (strategy_id, flow_type='resync', " +
      "status='draft') → duplicate path. RESIDUAL, STATED PLAINLY: that pre-check " +
      "does NOT close the SEQUENTIAL-retry class for the 15s-timeout sub-case. " +
      "The filter is status='draft', and the worker's 30s tick advances SV#1 out " +
      "of draft; when that transition lands inside the blip window the pre-check " +
      "matches nothing and a SECOND draft SV row is inserted. The blast radius is " +
      "bounded and recorded: still exactly one compute job (the partial index " +
      "holds — both attempts carry the same (strategy_id, kind)), not " +
      "user-visible, and it self-heals on the next resync. The concurrent-tab " +
      "race (two SELECTs pass before either INSERT) remains a documented " +
      "out-of-scope residual. Allowlisted ONLY AFTER that plan-01 dedup landed " +
      "(wave ordering).",
  },
} as const satisfies Partial<Record<FlowType, RetrySafeEntry>>);

/**
 * `/process-key` flow_types that are NOT retry-safe — evidence-only NO verdicts.
 * These are the SC1 audit's negative half; their presence here (not mere absence
 * from the YES map) is what the exhaustiveness pin checks, so removing a NO
 * verdict without adding a YES one reddens.
 */
export const RETRY_AUDIT_NO_FLOW_TYPES: Readonly<
  Partial<Record<FlowType, string>>
> = freezeVerdicts({
  teaser:
    "Deliberately NON-idempotent. Every teaser submission unconditionally mints a " +
    "fresh uuid4 wizard_session_id at the teaser uuid4 mint in process_key.py, so " +
    "idempotent_by_session is always false at the flow-type gate there; each call " +
    "writes a NEW strategy_verifications row plus a NEW public_token and a NEW " +
    "lead. A retry double-mints all three — the anti-feature named in " +
    "REQUIREMENTS Out of Scope. SC3 pins the YES-map ABSENCE of this key.",
  csv:
    "validate is side-effect-free and finalize is 23505-fenced by the composite " +
    "unique index strategies_user_wizard_session_source_uniq (a duplicate submit " +
    "re-fetches the existing strategy and answers 200), so csv COULD be " +
    "allowlisted at flow_type grain — but csv shares the process-key-sync budget " +
    "row with teaser, so the blast radius of a mistake outweighs the marginal " +
    "value (RESEARCH A5). Default no-retry for this phase.",
} as const satisfies Partial<Record<FlowType, string>>);

/**
 * Analytics-seam wrapper functions that ARE retry-safe, keyed by their 1:1
 * `SeamBudgetKey`. Exactly FOUR entries.
 *
 * ⚠️ THREE OF THE FOUR DO WRITE (141.1 / D-04). The pre-141.1 text claimed all
 * four were writeless; the re-derivation from the four handlers found audit
 * appends on three of them and an in-place UPDATE on one. The verdicts did not
 * change — what changed is that each entry now states its ACTUAL traced writes
 * and WHY the retry is safe GIVEN those writes. Only `optimize-weights` is
 * genuinely writeless, and it is the only entry permitted to say so (pinned in
 * `seam-retry-registry.test.ts`, because a future allowlist extension reasoning
 * from a reverted-false claim is exactly how a wrong YES ships).
 *
 * ⚠️ ALL FOUR CARRY THE D-03 COST. A retry on any of these budgets adds a SECOND
 * concurrent full compute while attempt 1 still burns CPU, because nothing on
 * the FastAPI side awaits `request.is_disconnected()`. That is a known, ACCEPTED
 * consequence of this phase — server-side request cancellation is deferred to
 * its own phase with its own soak — and it is recorded per entry so it cannot be
 * inherited silently.
 */
export const RETRY_SAFE_ANALYTICS: Readonly<
  Partial<Record<SeamBudgetKey, RetrySafeEntry>>
> = freezeVerdicts({
  bridge: {
    retries: 1,
    evidence:
      "findReplacementCandidates → the portfolio_bridge handler in portfolio.py. " +
      "WRITES: three log_audit_event sites, all action='bridge.score_candidates', " +
      "entity_type='bridge_run', each wrapped in try/except per H-0815 (an " +
      "audit-emit failure must never 500 a successful run). EXACTLY ONE fires per " +
      "request — incumbent-has-no-returns, empty-candidates, or happy path — so a " +
      "retry appends exactly one extra row. There are no non-audit writes: every " +
      "other Supabase interaction in that handler is a .select() read. WHY THE " +
      "RETRY IS STILL SAFE: audit_log is append-only with no unique key, and " +
      "bridge_run has NO counting consumer (the campaign's established RULED OUT " +
      "finding; the primary counting consumer, the flag-monitor cron, keys on " +
      "entity_type='process_key'). CORRECTIONS to the pre-141.1 text, which " +
      "described a different function: the scorer is NOT a weighted covariance — " +
      "find_replacement_candidates in bridge_scoring.py scores a composite of " +
      "three deltas (Sharpe, average correlation, max drawdown) at weights " +
      "0.4/0.3/0.3; and its numeric inputs are NOT caller-supplied — the router " +
      "READS them from Supabase (portfolio_strategies weights + " +
      "strategy_analytics series), the caller supplying only portfolio_id, " +
      "user_id and underperformer_strategy_id. COST (D-03): the retry adds a " +
      "second concurrent full compute while attempt 1 still burns CPU, because " +
      "nothing on the FastAPI side awaits request.is_disconnected() — accepted, " +
      "cancellation deferred.",
  },
  simulator: {
    retries: 1,
    evidence:
      "simulateAddCandidate → the portfolio_simulator handler in simulator.py. " +
      "WRITES: two log_audit_event sites, both entity_type='simulator_run' — the " +
      "failure path (action='simulator.run.failed') and the happy path " +
      "(action='simulator.run'). No non-audit writes exist anywhere in that " +
      "router. WHY THE RETRY IS STILL SAFE: simulator_run has no counting " +
      "consumer (RULED OUT), and the failure-path row cannot be doubled by a seam " +
      "retry AT ALL — it rides a retryable=False 500, which the seam classifies " +
      "SERVICE-PERMANENT and therefore neither counts nor retries. Only the " +
      "happy-path row can double, and only in the narrow case where attempt 1 " +
      "timed out AFTER the server had already committed it. COST (D-03): the " +
      "retry adds a second concurrent full compute while attempt 1 still burns " +
      "CPU, because nothing on the FastAPI side awaits request.is_disconnected() " +
      "— accepted, cancellation deferred.",
  },
  "portfolio-optimizer": {
    retries: 1,
    evidence:
      "runPortfolioOptimizer → the portfolio_optimizer handler in portfolio.py. " +
      "WRITES: (1) a single-column, whole-value UPDATE of " +
      "portfolio_analytics.optimizer_suggestions addressed by the row id of the " +
      "latest COMPLETE snapshot; (2) an append-only audit row, " +
      "action='optimizer.run', entity_type='optimizer_run' (whose user id falls " +
      "back to the all-zeros sentinel when the portfolio's user_id is NULL, " +
      "M-0623). WHY THE RETRY IS STILL SAFE: the UPDATE is idempotent BY " +
      "CONSTRUCTION, not by luck — it replaces one column's whole value, " +
      "addressed by primary key, with the output of a deterministic scorer over " +
      "inputs re-read from the same rows. There is no +=, no array append, no " +
      "counter, so attempt 2 writes the same bytes to the same row. NAMED " +
      "RESIDUAL (the handler's own note calls this an in-place UPDATE of an " +
      "append-only snapshot and routes the redesign to H-0573): if a NEW COMPLETE " +
      "portfolio_analytics row lands between attempts, attempt 2 retargets the " +
      "newer row id — still a whole-value overwrite, still no accumulation, and " +
      "the newer row is the one the UI reads anyway. The audit append has no " +
      "counting consumer (RULED OUT). CORRECTIONS to the pre-141.1 text: this " +
      "endpoint takes a THIRD input, req.weights (phantom keys dropped by its own " +
      "validator), and it RAISES 404 on a missing or unowned portfolio — it does " +
      "not return null; 'returns null on degenerate input' is optimize-weights' " +
      "documented behaviour, not this one's. COST (D-03): the retry adds a second " +
      "concurrent full compute while attempt 1 still burns CPU, because nothing " +
      "on the FastAPI side awaits request.is_disconnected() — accepted, " +
      "cancellation deferred.",
  },
  "optimize-weights": {
    retries: 1,
    evidence:
      "optimizeScenarioWeights → the optimize_weights_endpoint in optimizer.py. " +
      "This is the ONE analytics entry whose claim survived the 141.1 " +
      "re-derivation intact, and the only entry permitted to carry it: pure " +
      "compute over caller-supplied series, no persisted server-side write on the request path. " +
      "The handler builds a series dict from the request, calls optimize_weights, " +
      "and returns; the optimizer service module holds no Supabase client, no " +
      "audit emit and no write of any kind. It is also the endpoint that answers " +
      "weights=null (ok=false) on degenerate or under-sampled input rather than a " +
      "fabricated vector — the behaviour the pre-141.1 text mis-attached to " +
      "runPortfolioOptimizer. COST (D-03): the retry adds a second concurrent " +
      "full compute while attempt 1 still burns CPU, because nothing on the " +
      "FastAPI side awaits request.is_disconnected() — accepted, cancellation " +
      "deferred.",
  },
} as const satisfies Partial<Record<SeamBudgetKey, RetrySafeEntry>>);

/**
 * Analytics-seam wrapper functions that are NOT retry-safe — evidence-only NO
 * verdicts. Exactly FIVE entries; together with the four YES entries they cover
 * all nine analytics wrappers (the exhaustiveness pin).
 */
export const RETRY_AUDIT_NO_ANALYTICS: Readonly<
  Partial<Record<SeamBudgetKey, string>>
> = freezeVerdicts({
  "validate-key":
    "validateKey — runs a live exchange probe against caller credentials; " +
    "non-idempotent by construction, REQUIREMENTS Out of Scope. A retry re-probes " +
    "the venue.",
  "encrypt-key":
    "encryptKey — a credential WRITE; non-idempotent by construction, REQUIREMENTS " +
    "Out of Scope. A retry double-writes credentials.",
  "match-recompute":
    "recomputeMatch inserts match_batches. _get_recompute_lock is PROCESS-LOCAL " +
    "(match.py — dict[str, asyncio.Lock], in-memory per worker process), NOT " +
    "distributed: it bounds the single-process race but does NOT serialize retries " +
    "across worker instances, and there is NO unique constraint on match_batches. " +
    "H-0562 (multi-worker durability) is OPEN. Unproven ⇒ no-retry (the SEAM-05 " +
    "explicit lock resolution).",
  "portfolio-analytics":
    "computePortfolioAnalytics — ZERO callers at HEAD; the portfolio-analytics " +
    "row's notes in SEAM_BUDGETS records 'ZERO CALLERS TODAY'. A dead path is " +
    "recorded as such per SC1 and is never allowlisted; if a caller appears it " +
    "must be audited before allowlisting.",
  "match-eval":
    "evalMatch — read-only admin sweep, likely safe but low value; default " +
    "no-retry (RESEARCH discretion).",
} as const satisfies Partial<Record<SeamBudgetKey, string>>);
