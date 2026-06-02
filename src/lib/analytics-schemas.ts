/**
 * Zod schemas for analytics service responses.
 *
 * Contract validation at the Next.js/Python boundary. Every response from
 * analyticsRequest() is validated against these schemas so contract drift
 * (field renames, type changes) fails loudly instead of rendering wrong
 * numbers in the UI.
 *
 * When the Python side adds or renames a field, the parse will fail with a
 * descriptive ZodError — much better than silently showing undefined in the
 * allocator dashboard.
 *
 * ## Two styles coexist
 *
 * - **Loose `.passthrough()` style** (original): warns on shape drift,
 *   accepts unknown extra fields. Used by the legacy analytics endpoints.
 * - **Strict `contract_version` style** (added Sprint 2 Task 2.9): the
 *   response MUST include `contract_version: 1` as a literal. Parse fails
 *   hard on mismatch. Used by new endpoints starting with the compute
 *   queue tick (`TickJobsResponseSchema`). This is the direction the
 *   codebase is migrating toward; existing endpoints will migrate in
 *   follow-up PRs.
 *
 * When adding a new analytics endpoint, prefer the strict style.
 */

import { z } from "zod";
import { exchangeEnum } from "./closed-sets";

// --- /api/validate-key ---
export const ValidateKeyResponseSchema = z.object({
  valid: z.boolean(),
  read_only: z.boolean(),
  exchange: z.string().optional(),
  permissions: z.array(z.string()).optional(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat; /api/validate-key result is read for UI display only, never spread into a write

// --- /api/encrypt-key ---
// The analytics service uses envelope encryption: every credential (key,
// secret, passphrase) is bundled into a single JSON blob encrypted by a
// per-row DEK (api_key_encrypted), and the DEK itself is KEK-encrypted
// (dek_encrypted). api_secret_encrypted / passphrase_encrypted / nonce
// stay null by design. Matches analytics-service/services/encryption.py.
//
// NEW-C40-01: Drop .passthrough() and use .strip() (default) so unknown
// Python fields are silently stripped instead of flowing through into the
// api_keys INSERT. A future analytics-service field addition (e.g.
// key_fingerprint, correlation_id, kek_alg) would previously cause
// PostgREST PGRST204 "Could not find column X" and hard-fail ALL key
// creation. Stripping at the schema boundary matches the named-destructure
// pattern already in create-with-key/route.ts:158-168.
//
// NEW-C40-02: kek_version is typed INTEGER NOT NULL in the DB. Accept only
// integers so a string like "v1" / "1.0" / "2 " fails loudly at parse time
// rather than producing an opaque 22P02 insert error. z.coerce.number()
// coerces a pure-numeric string "1" while rejecting "v1" / "1.0", matching
// create-with-key's own defensive `typeof kek_version === "number" ? ... : 1`
// pattern (route.ts:164-167). Integer+positive constraint mirrors the DB column.
export const EncryptKeyResponseSchema = z.object({
  api_key_encrypted: z.string(),
  api_secret_encrypted: z.string().nullable(),
  passphrase_encrypted: z.string().nullable(),
  dek_encrypted: z.string(),
  nonce: z.string().nullable(),
  kek_version: z.coerce.number().int().positive(),
});

// --- /api/fetch-trades ---
export const FetchTradesResponseSchema = z.object({
  trades_fetched: z.number(),
  strategy_id: z.string().optional(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat; only trades_fetched is read, never spread into a write

// --- /api/compute-analytics ---
export const ComputeAnalyticsResponseSchema = z.object({
  status: z.string(),
  strategy_id: z.string().optional(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat status envelope; never spread into a write

// --- /api/portfolio-analytics ---
export const PortfolioAnalyticsResponseSchema = z.object({
  status: z.string(),
  portfolio_id: z.string().optional(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat status envelope; never spread into a write

// --- /api/portfolio-optimizer ---
// Audit-2026-05-07 M-0332 (type-design-analyzer c8): model `suggestions`
// in the schema so a Python contract change (e.g. rename
// suggestions→recommendations) fails the parse instead of silently
// emitting an empty array via the route's `Array.isArray(undefined)`
// fallback. Suggestions themselves are open-shaped because the Python
// side fans out per-candidate fields; we pin the wrapper contract.
export const PortfolioOptimizerResponseSchema = z.object({
  status: z.string().optional(),
  ok: z.boolean().optional(),
  portfolio_id: z.string().optional(),
  suggestions: z.array(z.record(z.string(), z.unknown())).optional(),
  persisted: z.boolean().optional(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat; suggestions are open-shaped by design (Python fans out per-candidate), wrapper pinned, never spread into a write

// --- /api/verify-strategy ---
// `results` + `matched_strategy_id` are CONSUMED by verify-strategy/route.ts:396
// (`results` is spread into the strategy_verifications.metrics_snapshot JSONB
// column; matched_strategy_id is folded in). Model them explicitly so the
// write-fed shape is typed and the schema default-STRIPS the unconsumed
// top-level twr/sharpe/return_* forward-compat fields instead of passing them
// through — closing the boundary honestly (B9; corrects a prior `.passthrough()`
// whose escape rationale wrongly claimed "never spread into a write": `results`
// IS spread into a write, but into a JSONB sink so there was no PGRST204 break).
export const VerifyStrategyResponseSchema = z.object({
  verification_id: z.string(),
  results: z.record(z.string(), z.unknown()).nullable().optional(),
  matched_strategy_id: z.string().nullable().optional(),
});

// --- /api/match/recompute ---
// Every branch carries a `status` discriminator so callers can switch on a
// single field instead of probing key presence. `.passthrough()` is retained
// for forward-compat with per-branch extra fields.
export const RecomputeMatchResponseSchema = z.object({
  status: z.enum(["disabled", "skipped", "ok"]),
  allocator_id: z.string().optional(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat per-branch extras; discriminated on status, never spread into a write

// ─────────────────────────────────────────────────────────────────────
// Strict primitive responses (Sprint 2 Task 2.9 and later)
//
// Parse failures THROW instead of warning. Used for RPC return values
// that are single primitives (UUIDs, counts) rather than objects — no
// contract_version needed because there is nothing to version.
// ─────────────────────────────────────────────────────────────────────

/**
 * --- enqueue_compute_job RPC response (Supabase RPC, not Railway HTTP) ---
 *
 * Returned by `supabase.rpc('enqueue_compute_job', { ... })`. The RPC
 * returns a UUID (the new or existing in-flight job id). Supabase wraps
 * RPC responses as `{ data: <uuid>, error: null }` — this schema
 * describes the inner `data` value only. Zod parse runs against the
 * `data` field inside `src/lib/compute-queue.ts::enqueueComputeJob`.
 */
export const EnqueueComputeJobResponseSchema = z.string().uuid();
export type EnqueueComputeJobResponse = z.infer<typeof EnqueueComputeJobResponseSchema>;

/**
 * --- get_user_compute_jobs RPC row (Supabase RPC, not Railway HTTP) ---
 *
 * Returned by `supabase.rpc('get_user_compute_jobs', { ... })`. The RPC
 * (migration 032 STEP 16 + migration 111 user_message + audit-2026-05-07
 * residual COALESCE filter) returns a SETOF rows shaped exactly as the
 * `RETURNS TABLE(...)` declaration in PL/pgSQL.
 *
 * audit-2026-05-07 M-0782: strict-versioned schema for the RPC response
 * so a future migration that adds, removes, or reorders a column fails
 * loudly at parse time instead of silently changing the contract.
 *
 * Current consumer status (api-contract specialist 2026-05-16):
 * This schema is parse-only via the live-DB Vitest contract test in
 * `src/__tests__/compute-jobs-audit-2026-05-07-residual.test.ts`. NO
 * production code path calls `supabase.rpc('get_user_compute_jobs')`
 * today — the admin UI under `src/app/(dashboard)/admin/compute-jobs/`
 * reads via service-role `.from('compute_jobs')`. The "fail loud on
 * drift" guarantee is therefore conditional on CI running the live-DB
 * suite. Wiring this RPC into a real read path (e.g. a user-facing
 * job-status surface) would convert the schema from regression-test-
 * only to a real boundary parser.
 *
 * Two notes on field semantics:
 *
 *  - `last_error` is hard-redacted to `null` inside the RPC body. The
 *    field is preserved in the shape (vs. omitted entirely) so admin UI
 *    code that reads via the service-role direct query path can share
 *    a row type with the user-facing path. We model it as `z.null()` —
 *    a parse against a real value would fail and flag the redaction
 *    layer regressing, which is exactly the regression we want to
 *    detect.
 *
 *  - `user_message` was added by migration 111 and is `string | null`
 *    depending on the row's `(status, error_kind)` combination — null
 *    for healthy / in-flight rows, populated for failures.
 */
export const GetUserComputeJobsRowSchema = z
  .object({
    id: z.string().uuid(),
    strategy_id: z.string().uuid().nullable(),
    portfolio_id: z.string().uuid().nullable(),
    kind: z.string(),
    parent_job_ids: z.array(z.string().uuid()),
    status: z.enum([
      "pending",
      "running",
      "done",
      "done_pending_children",
      "failed_retry",
      "failed_final",
    ]),
    attempts: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    next_attempt_at: z.string(),
    claimed_at: z.string().nullable(),
    claimed_by: z.string().nullable(),
    // Hard-redacted to null inside the RPC body (mig 032 STEP 16). A
    // parse failure here means the redaction layer regressed — exactly
    // what we want surfaced.
    last_error: z.null(),
    error_kind: z.enum(["transient", "permanent", "unknown"]).nullable(),
    idempotency_key: z.string().max(128).nullable(),
    exchange: exchangeEnum.nullable(),
    trade_count: z.number().int().nonnegative().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    metadata: z.unknown().nullable(),
    user_message: z.string().nullable(),
  })
  // Strict: a future migration that appends a column must update this
  // schema in the same PR. Without .strict(), Zod silently strips
  // unknown fields and contract drift goes undetected.
  .strict();
export type GetUserComputeJobsRow = z.infer<typeof GetUserComputeJobsRowSchema>;

export const GetUserComputeJobsResponseSchema = z.array(
  GetUserComputeJobsRowSchema,
);
export type GetUserComputeJobsResponse = z.infer<
  typeof GetUserComputeJobsResponseSchema
>;

// ─────────────────────────────────────────────────────────────────────
// Versioned object responses (Sprint 2 Task 2.9 and later)
//
// Parse failures THROW. `contract_version` is a strict literal; drift
// throws loudly instead of rendering wrong data. New object-shape
// endpoints use this style. When bumping the version, update the literal
// here and fan out the consumer updates in the same PR.
// ─────────────────────────────────────────────────────────────────────

/**
 * --- /api/jobs/tick (Railway worker tick endpoint) ---
 *
 * Called every 60s by pg_cron (and every 5min by the Vercel fallback
 * cron when pg_cron's HTTP path fails). Claims up to N ready jobs via
 * `claim_compute_jobs` and runs each through the dispatch table. Returns
 * a summary of the tick. FIRST VERSIONED ENDPOINT.
 */
export const TickJobsResponseSchema = z
  .object({
    contract_version: z.literal(1),
    claimed: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    failed_retry: z.number().int().nonnegative(),
    failed_final: z.number().int().nonnegative(),
    reclaimed: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    worker_id: z.string().min(1),
  })
  // Strict: reject unknown extra fields rather than silently stripping.
  // This is the "fail loud on contract drift" guarantee the comment above
  // promises. Without .strict(), Zod strips unknowns and a future Python
  // change that adds a field like `secrets_leaked: "..."` would parse
  // fine and render as if nothing happened.
  .strict();
export type TickJobsResponse = z.infer<typeof TickJobsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────
// Bridge response (Sprint 4 Phase 3)
//
// /api/portfolio-bridge response. Each candidate matches the strict
// BridgeCandidate shape in types.ts; parse failures on a known field throw.
// B9 (folds M-0907 / L-0043): the WRAPPER is intentionally `.passthrough()`
// (forward-compat, read-only — never spread into a write; the harmful WRITE-path
// mirror NEW-C40-01 on EncryptKeyResponseSchema was converted to strip). So this
// is NOT the "strict schema" the original docblock claimed — the passthrough
// carries an inline B9 sanctioned-exception and the candidates are fully typed
// by BridgeCandidateSchema.
// ─────────────────────────────────────────────────────────────────────

// audit-2026-05-07 M-0908: single source of truth for the bridge fit
// label set. The TS literal union previously declared in types.ts is
// derived from this schema via z.infer so adding a tier (e.g. 'Excellent
// fit') only requires updating one list — and Record<BridgeFitLabel,…>
// lookups in ReplacementCard stay exhaustive at compile time.
export const BridgeFitLabelSchema = z.enum([
  "Strong fit",
  "Good fit",
  "Moderate fit",
  "Weak fit",
]);
export type BridgeFitLabel = z.infer<typeof BridgeFitLabelSchema>;

const BridgeCandidateSchema = z.object({
  strategy_id: z.string(),
  strategy_name: z.string(),
  sharpe_delta: z.number(),
  dd_delta: z.number(),
  corr_delta: z.number(),
  composite_score: z.number(),
  fit_label: BridgeFitLabelSchema,
});

export const BridgeResponseSchema = z.object({
  candidates: z.array(BridgeCandidateSchema),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat wrapper; candidates are strictly typed (BridgeCandidateSchema), wrapper never spread into a write

export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

// ─────────────────────────────────────────────────────────────────────
// Phase 15 / CSV-01..CSV-02 — CSV upload + finalize responses
//
// Loose `.passthrough()` style (matches the legacy analytics endpoints)
// because the analytics-service envelope shape will pick up additional
// metadata fields in Phase 16 / OBSERV-06 (`correlation_id` becomes a
// real value rather than null). Strict `.strict()` here would force
// every Phase 16 envelope expansion to bump the schema in lockstep.
// ─────────────────────────────────────────────────────────────────────

/** Phase 15 / CSV-01..CSV-02 — analytics-service /api/csv/validate response. */
export const CsvValidateResponseSchema = z.object({
  ok: z.boolean(),
  preview: z
    .object({
      row_count: z.number(),
      date_range: z.tuple([z.string(), z.string()]),
      columns_detected: z.array(z.string()),
      first_rows: z.array(z.record(z.string(), z.unknown())),
      last_rows: z.array(z.record(z.string(), z.unknown())),
    })
    .nullable(),
  errors: z.array(
    z.object({
      rule: z.string(),
      row: z.number(),
      message: z.string(),
    }),
  ),
  correlation_id: z.string().nullable(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat; Phase 16 envelope expansion (correlation_id), rendered only, never spread into a write

export type CsvValidateResponse = z.infer<typeof CsvValidateResponseSchema>;

/**
 * Phase 15 / CSV-01 — Next.js /api/strategies/csv-finalize response.
 *
 * Returned by the route after a successful `finalize_csv_strategy` RPC
 * call. The `status` field is bound to the post-finalize value of the
 * strategy_verifications row (typically `pending_review` / `validated`).
 */
export const CsvFinalizeResponseSchema = z.object({
  strategy_id: z.string(),
  status: z.string(),
}).passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: forward-compat; only strategy_id/status are read, never spread into a write

export type CsvFinalizeResponse = z.infer<typeof CsvFinalizeResponseSchema>;
