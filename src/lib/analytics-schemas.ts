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
