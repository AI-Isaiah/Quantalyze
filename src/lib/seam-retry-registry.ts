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
 * The YES maps are `Partial<Record<…>>`. The wrapper reads
 * `RETRY_SAFE_*[key]?.retries ?? 0` (plan 04), so a flow_type or wrapper with no
 * entry simply gets zero retries. There is no separate "default no-retry" rule
 * to forget — everything unproven is no-retry because the map has no row for it.
 * A new flow_type or wrapper added without an audit verdict reddens the
 * exhaustiveness pin in the test, forcing a verdict before it can ship.
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
 * `/process-key` flow_types that ARE retry-safe. PRESENT ⇒ retry once; ABSENT ⇒
 * no-retry by construction. Exactly TWO entries — `teaser` and `csv` are proven
 * NO and live in `RETRY_AUDIT_NO_FLOW_TYPES`.
 */
export const RETRY_SAFE_FLOW_TYPES: Partial<Record<FlowType, RetrySafeEntry>> = {
  onboard: {
    retries: 1,
    evidence:
      "Caller-supplied wizard_session_id ⇒ idempotent_by_session=true. The " +
      "duplicate SELECT pre-check (process_key.py:1351) routes a hit to " +
      "_resume_duplicate_job (process_key.py:643-714), which returns the shared " +
      "WIZARD_DUPLICATE reply. SV row deduped by " +
      "strategy_verifications_strategy_wizard_session_uniq (migration " +
      "20260726000225); compute job deduped on (strategy_id, kind) by " +
      "compute_jobs_one_inflight_per_kind_strategy (migration 20260418194206). A " +
      "retry that re-reaches the server yields exactly one SV row and one job.",
  },
  resync: {
    retries: 1,
    evidence:
      "Compute job deduped on (strategy_id, kind) by " +
      "compute_jobs_one_inflight_per_kind_strategy (migration 20260418194206). " +
      "resync mints a SERVER-side uuid4 session (process_key.py:1018) so it lacks " +
      "onboard's wizard_session_id dedup; phase-141 plan-01 added a strategy-scoped " +
      "draft-SV pre-check keyed on (strategy_id, flow_type='resync', status='draft') " +
      "→ duplicate path, so a retried resync yields exactly ONE draft SV row too. " +
      "The SEQUENTIAL-retry class is closed; the concurrent-tab race (two SELECTs " +
      "pass before either INSERT) remains a documented out-of-scope residual. " +
      "Allowlisted ONLY AFTER that plan-01 dedup landed (wave ordering).",
  },
};

/**
 * `/process-key` flow_types that are NOT retry-safe — evidence-only NO verdicts.
 * These are the SC1 audit's negative half; their presence here (not mere absence
 * from the YES map) is what the exhaustiveness pin checks, so removing a NO
 * verdict without adding a YES one reddens.
 */
export const RETRY_AUDIT_NO_FLOW_TYPES: Partial<Record<FlowType, string>> = {
  teaser:
    "Deliberately NON-idempotent. Every teaser submission unconditionally mints a " +
    "fresh uuid4 wizard_session_id (process_key.py:936-938), so " +
    "idempotent_by_session is always false (process_key.py:1033); each call writes " +
    "a NEW strategy_verifications row plus a NEW public_token and a NEW lead. A " +
    "retry double-mints all three — the anti-feature named in REQUIREMENTS Out of " +
    "Scope. SC3 pins the YES-map ABSENCE of this key.",
  csv:
    "validate is side-effect-free and finalize is 23505-fenced (migration " +
    "20260728120000, re-fetches the existing strategy at 200), so csv COULD be " +
    "allowlisted at flow_type grain — but csv shares flow_type AND the " +
    "process-key-sync budget row with teaser, so the blast radius of a mistake " +
    "outweighs the marginal value (RESEARCH A5). Default no-retry for this phase.",
};

/**
 * Analytics-seam wrapper functions that ARE retry-safe, keyed by their 1:1
 * `SeamBudgetKey`. Exactly FOUR entries — each pure compute over caller-supplied
 * inputs with no persisted server-side write on the request path.
 */
export const RETRY_SAFE_ANALYTICS: Partial<Record<SeamBudgetKey, RetrySafeEntry>> = {
  bridge: {
    retries: 1,
    evidence:
      "findReplacementCandidates — pure weighted-covariance compute over " +
      "caller-supplied inputs; no persisted server-side write on the request path.",
  },
  simulator: {
    retries: 1,
    evidence:
      "simulateAddCandidate — pure compute; no persisted server-side write on the " +
      "request path.",
  },
  "portfolio-optimizer": {
    retries: 1,
    evidence:
      "runPortfolioOptimizer — pure compute over (portfolio_id, user_id), returns " +
      "null on degenerate input; no persisted server-side write on the request path.",
  },
  "optimize-weights": {
    retries: 1,
    evidence:
      "optimizeScenarioWeights — pure compute over caller-supplied series; no " +
      "persisted server-side write on the request path.",
  },
};

/**
 * Analytics-seam wrapper functions that are NOT retry-safe — evidence-only NO
 * verdicts. Exactly FIVE entries; together with the four YES entries they cover
 * all nine analytics wrappers (the exhaustiveness pin).
 */
export const RETRY_AUDIT_NO_ANALYTICS: Partial<Record<SeamBudgetKey, string>> = {
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
    "computePortfolioAnalytics — ZERO callers at HEAD (resilient-fetch.ts:502 " +
    "records 'no callers'). A dead path is recorded as such per SC1 and is never " +
    "allowlisted; if a caller appears it must be audited before allowlisting.",
  "match-eval":
    "evalMatch — read-only admin sweep, likely safe but low value; default " +
    "no-retry (RESEARCH discretion).",
};
