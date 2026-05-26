// Allocator preferences (Quantalyze perfect-match engine)
//
// In v1, only 3 fields are self-editable by allocators:
//   - mandate_archetype: free text 1-line description ("diversified crypto SMA, low-DD")
//   - target_ticket_size_usd: typical allocation size
//   - excluded_exchanges: compliance-driven exclusions
//
// All other preference fields (max_drawdown_tolerance, min_sharpe, etc.) are
// admin-only — the founder fills them in over time from conversations. They live
// in the same allocator_preferences row but are protected by the API whitelist.
//
// See docs/superpowers/plans/2026-04-07-perfect-match-engine.md Phase 1 Task 2.

import type { SupabaseClient } from "@supabase/supabase-js";
import { STRATEGY_TYPES, SUBTYPES } from "./constants";

export interface AllocatorPreferences {
  user_id: string;
  // Self-editable (v1)
  mandate_archetype: string | null;
  target_ticket_size_usd: number | null;
  excluded_exchanges: string[] | null;
  // Admin-only (not exposed via the self-edit API)
  max_drawdown_tolerance: number | null;
  min_track_record_days: number | null;
  min_sharpe: number | null;
  max_aum_concentration: number | null;
  preferred_strategy_types: string[] | null;
  preferred_markets: string[] | null;
  founder_notes: string | null;
  edited_by_user_id: string | null;
  updated_at: string;
  // Phase 2 — mandate columns (migration 061)
  max_weight: number | null;
  correlation_ceiling: number | null;
  liquidity_preference: "high" | "medium" | "low" | null;
  style_exclusions: string[] | null;
  mandate_edited_at: string | null;
  // Phase 3 — scoring weight overrides (migration 062). Phase 4 writes this
  // via the feedback engine; not exposed in SELF_EDITABLE_PREFERENCE_FIELDS.
  scoring_weight_overrides: Record<string, number> | null;
}

/** Fields a regular allocator can write to about themselves. */
export const SELF_EDITABLE_PREFERENCE_FIELDS = [
  "mandate_archetype",
  "target_ticket_size_usd",
  "excluded_exchanges",
  // Phase 2 promotions (D-03, D-06, D-07)
  "max_weight",
  "preferred_strategy_types",
  "correlation_ceiling",
  "max_drawdown_tolerance",
  "liquidity_preference",
  "style_exclusions",
] as const;

/** Fields only the admin (founder) can write to about another user. */
export const ADMIN_ONLY_PREFERENCE_FIELDS = [
  "min_track_record_days",
  "min_sharpe",
  "max_aum_concentration",
  "preferred_markets",
  "founder_notes",
] as const;

/** Default fallbacks used by the match engine when an allocator has no preferences row. */
export const DEFAULT_PREFERENCES: Partial<AllocatorPreferences> = {
  max_drawdown_tolerance: 0.30,
  min_track_record_days: 180,
  min_sharpe: 0.5,
  target_ticket_size_usd: 50000,
  max_aum_concentration: 0.20,
  preferred_strategy_types: [],
  preferred_markets: [],
  excluded_exchanges: [],
};

/** Whitelist a record to only the self-editable fields. Used by the self-edit API. */
export function pickSelfEditableFields(
  input: Record<string, unknown>,
): Partial<AllocatorPreferences> {
  const out: Record<string, unknown> = {};
  for (const key of SELF_EDITABLE_PREFERENCE_FIELDS) {
    if (key in input) out[key] = input[key];
  }
  return out as Partial<AllocatorPreferences>;
}

/** Whitelist a record to fields the admin can edit. */
export function pickAdminEditableFields(
  input: Record<string, unknown>,
): Partial<AllocatorPreferences> {
  const out: Record<string, unknown> = {};
  for (const key of [...SELF_EDITABLE_PREFERENCE_FIELDS, ...ADMIN_ONLY_PREFERENCE_FIELDS]) {
    if (key in input) out[key] = input[key];
  }
  return out as Partial<AllocatorPreferences>;
}

/** Validate self-editable input. Returns an error string or null. */
export function validateSelfEditableInput(input: Partial<AllocatorPreferences>): string | null {
  if (input.mandate_archetype !== undefined && input.mandate_archetype !== null) {
    if (typeof input.mandate_archetype !== "string") return "mandate_archetype must be a string";
    if (input.mandate_archetype.length > 500) return "mandate_archetype must be 500 characters or less";
  }
  if (input.target_ticket_size_usd !== undefined && input.target_ticket_size_usd !== null) {
    if (typeof input.target_ticket_size_usd !== "number") return "target_ticket_size_usd must be a number";
    if (!Number.isFinite(input.target_ticket_size_usd)) return "target_ticket_size_usd must be finite";
    if (input.target_ticket_size_usd < 0) return "target_ticket_size_usd must be non-negative";
    if (input.target_ticket_size_usd > 1_000_000_000) return "target_ticket_size_usd is unrealistically large";
  }
  if (input.excluded_exchanges !== undefined && input.excluded_exchanges !== null) {
    if (!Array.isArray(input.excluded_exchanges)) return "excluded_exchanges must be an array";
    // NEW-C07-01 (audit-2026-05-26 security+red-team): cap count and
    // per-element length. Without these guards an authenticated allocator
    // can PUT 500k single-char entries or a handful of multi-MB strings,
    // inflating the allocator_preferences row to multi-MB TOAST and
    // making every `getOwnPreferences` SELECT * expensive. The caps mirror
    // the UI's exchange chip model (≤100 exchange codes, each ≤100 chars).
    if (input.excluded_exchanges.length > 100) return "excluded_exchanges must have at most 100 entries";
    for (const e of input.excluded_exchanges) {
      if (typeof e !== "string") return "excluded_exchanges must be string[]";
      if (e.length > 100) return "excluded_exchanges entries must be 100 characters or less";
    }
  }
  // max_weight — Phase 2 (MANDATE-01). 0.05-0.50 per D-17.
  if (input.max_weight !== undefined && input.max_weight !== null) {
    if (typeof input.max_weight !== "number") return "max_weight must be a number";
    if (!Number.isFinite(input.max_weight)) return "max_weight must be finite";
    if (input.max_weight < 0.05 || input.max_weight > 0.50) return "max_weight must be between 0.05 and 0.50";
  }
  // correlation_ceiling — 0-1 per D-17.
  if (input.correlation_ceiling !== undefined && input.correlation_ceiling !== null) {
    if (typeof input.correlation_ceiling !== "number") return "correlation_ceiling must be a number";
    if (!Number.isFinite(input.correlation_ceiling)) return "correlation_ceiling must be finite";
    if (input.correlation_ceiling < 0 || input.correlation_ceiling > 1) return "correlation_ceiling must be between 0 and 1";
  }
  // max_drawdown_tolerance — now self-editable (D-06). 0-1 per D-17.
  if (input.max_drawdown_tolerance !== undefined && input.max_drawdown_tolerance !== null) {
    if (typeof input.max_drawdown_tolerance !== "number") return "max_drawdown_tolerance must be a number";
    if (!Number.isFinite(input.max_drawdown_tolerance)) return "max_drawdown_tolerance must be finite";
    if (input.max_drawdown_tolerance < 0 || input.max_drawdown_tolerance > 1) return "max_drawdown_tolerance must be between 0 and 1";
  }
  // liquidity_preference — enum per D-05.
  if (input.liquidity_preference !== undefined && input.liquidity_preference !== null) {
    if (typeof input.liquidity_preference !== "string") return "liquidity_preference must be a string";
    if (!["high", "medium", "low"].includes(input.liquidity_preference)) return "liquidity_preference must be high, medium, or low";
  }
  // style_exclusions — subset of SUBTYPES per D-04.
  if (input.style_exclusions !== undefined && input.style_exclusions !== null) {
    if (!Array.isArray(input.style_exclusions)) return "style_exclusions must be an array";
    const allowed: readonly string[] = SUBTYPES;
    for (const v of input.style_exclusions) {
      if (typeof v !== "string") return "style_exclusions must be string[]";
      if (!allowed.includes(v)) return `style_exclusions contains invalid value: ${v}`;
    }
  }
  // preferred_strategy_types — now self-editable (D-03). Subset of STRATEGY_TYPES.
  if (input.preferred_strategy_types !== undefined && input.preferred_strategy_types !== null) {
    if (!Array.isArray(input.preferred_strategy_types)) return "preferred_strategy_types must be an array";
    const allowed: readonly string[] = STRATEGY_TYPES;
    for (const v of input.preferred_strategy_types) {
      if (typeof v !== "string") return "preferred_strategy_types must be string[]";
      if (!allowed.includes(v)) return `preferred_strategy_types contains invalid value: ${v}`;
    }
  }
  return null;
}

/** Validate admin-editable input. Includes self-editable fields plus admin-only numerics and arrays. */
export function validateAdminEditableInput(input: Partial<AllocatorPreferences>): string | null {
  // Re-use the self-editable validation first
  const selfError = validateSelfEditableInput(input);
  if (selfError) return selfError;

  // Admin-only numeric bounds. max_drawdown_tolerance moved to
  // validateSelfEditableInput (D-06); it's validated via the selfError
  // path above.
  const numericFields: [keyof AllocatorPreferences, number, number][] = [
    ["min_sharpe", -5, 10],
    ["min_track_record_days", 0, 10_000],
    ["max_aum_concentration", 0, 1],
  ];
  for (const [field, lo, hi] of numericFields) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number") return `${field} must be a number`;
    if (!Number.isFinite(value)) return `${field} must be finite`;
    if (value < lo || value > hi) return `${field} must be between ${lo} and ${hi}`;
  }

  // Admin-only array fields. preferred_strategy_types moved to
  // validateSelfEditableInput (D-03); it's validated via the selfError
  // path above.
  const arrayFields: (keyof AllocatorPreferences)[] = [
    "preferred_markets",
  ];
  for (const field of arrayFields) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) return `${field} must be an array`;
    if (value.some((v) => typeof v !== "string")) return `${field} must be string[]`;
  }

  // founder_notes: free text, cap length
  if (input.founder_notes !== undefined && input.founder_notes !== null) {
    if (typeof input.founder_notes !== "string") return "founder_notes must be a string";
    if (input.founder_notes.length > 10_000) return "founder_notes must be 10,000 characters or less";
  }

  return null;
}

/**
 * Read the current user's preferences. Returns null if no row exists yet
 * (legitimate first-visit: allocator hasn't saved any preferences).
 *
 * NEW-C07-03 (audit-2026-05-26 silent-failure): PGRST205 (table/schema missing
 * — migration 011 not applied, or a PostgREST schema-reload race) used to be
 * swallowed as "no preferences yet" and return null. That causes the UI to
 * render a blank empty form (200 {preferences:null}) instead of surfacing a
 * fault, so an allocator who saved a full mandate sees it gone with no error.
 * A subsequent PUT fails the RPC and surfaces a generic 500 — read says "no
 * preferences", write says "save failed", and neither flags the missing table.
 *
 * Fix: distinguish "no row for user" (legit null) from "table/schema missing"
 * (infra fault). For PGRST205 we log to stderr + Sentry, then throw so the
 * route's existing catch returns a 500. Other errors still throw directly.
 */
export async function getOwnPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<AllocatorPreferences | null> {
  const { data, error } = await supabase
    .from("allocator_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === "PGRST205") {
      // NEW-C07-03: schema-missing is an infra fault, not a "no row yet".
      // Log loudly so ops is alerted, then throw so the route returns 500.
      console.error(
        "[preferences] allocator_preferences table missing in schema cache — apply migration 011",
        { code: error.code, message: error.message },
      );
      // F-02 (specialist-review 2026-05-26): the prior `void import(...)` pattern
      // detaches the Sentry promise before captureException resolves. On a Vercel
      // cold-finish the lambda can be reaped before Sentry flushes — same failure
      // mode fixed in audit.ts NEW-C10-03. Await the import chain so the
      // `waitUntil` window stays open until the capture settles, then throw.
      await import("@sentry/nextjs").then((Sentry) => {
        try {
          Sentry.captureException(
            new Error("allocator_preferences table missing from PostgREST schema cache (PGRST205)"),
            { tags: { pgrst_schema_missing: "true" }, extra: { userId } },
          );
        } catch {
          // Sentry SDK threw — swallow so the original throw is not masked.
        }
      }).catch(() => {});
      throw error;
    }
    throw error;
  }
  return data as AllocatorPreferences | null;
}
