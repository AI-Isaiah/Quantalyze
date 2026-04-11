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

// --- /api/validate-key ---
export const ValidateKeyResponseSchema = z.object({
  valid: z.boolean(),
  read_only: z.boolean(),
  exchange: z.string().optional(),
  permissions: z.array(z.string()).optional(),
}).passthrough();

// --- /api/encrypt-key ---
export const EncryptKeyResponseSchema = z.object({
  encrypted_key: z.string(),
  encrypted_secret: z.string(),
  kek_version: z.number().or(z.string()).optional(),
  encrypted_passphrase: z.string().nullable().optional(),
}).passthrough();

// --- /api/fetch-trades ---
export const FetchTradesResponseSchema = z.object({
  trades_fetched: z.number(),
  strategy_id: z.string().optional(),
}).passthrough();

// --- /api/compute-analytics ---
export const ComputeAnalyticsResponseSchema = z.object({
  status: z.string(),
  strategy_id: z.string().optional(),
}).passthrough();

// --- /api/portfolio-analytics ---
export const PortfolioAnalyticsResponseSchema = z.object({
  status: z.string(),
  portfolio_id: z.string().optional(),
}).passthrough();

// --- /api/portfolio-optimizer ---
export const PortfolioOptimizerResponseSchema = z.object({
  status: z.string().optional(),
}).passthrough();

// --- /api/verify-strategy ---
export const VerifyStrategyResponseSchema = z.object({
  verification_id: z.string(),
}).passthrough();

// --- /api/match/recompute ---
export const RecomputeMatchResponseSchema = z.object({
  status: z.string().optional(),
  allocator_id: z.string().optional(),
}).passthrough();

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
