/**
 * Zod contract for the POST body of /api/bridge.
 *
 * audit-2026-05-07 M-0884: the route previously did presence-only validation
 * (`if (!portfolio_id || !underperformer_strategy_id)`), so any non-empty
 * string — "-", "undefined", a crafted slug — passed through to Supabase.
 * Parameterized queries make injection inert, but a non-UUID id silently
 * misses on the FK / returns a generic shape rather than surfacing the bad
 * input as a 400 at the boundary. This mirrors `SimulatorRequestSchema`
 * (../api/simulatorSchema.ts) so the two sibling compute-proxy routes share
 * one validation discipline.
 *
 * Kept NON-strict (extra keys ignored, not rejected) for byte-parity with the
 * sister simulator schema; both fields are FK targets that must be UUIDs in
 * the producing tables.
 */

import { z } from "zod";

export const BridgeRequestSchema = z.object({
  portfolio_id: z.string().uuid(),
  underperformer_strategy_id: z.string().uuid(),
});

export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;
