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

export interface AllocatorPreferences {
  user_id: string;
  // Self-editable
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
}

/** Fields a regular allocator can write to about themselves. */
export const SELF_EDITABLE_PREFERENCE_FIELDS = [
  "mandate_archetype",
  "target_ticket_size_usd",
  "excluded_exchanges",
] as const;

/** Fields only the admin (founder) can write to about another user. */
export const ADMIN_ONLY_PREFERENCE_FIELDS = [
  "max_drawdown_tolerance",
  "min_track_record_days",
  "min_sharpe",
  "max_aum_concentration",
  "preferred_strategy_types",
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
    if (input.excluded_exchanges.some((e) => typeof e !== "string")) return "excluded_exchanges must be string[]";
  }
  return null;
}

/** Validate admin-editable input. Includes self-editable fields plus admin-only numerics and arrays. */
export function validateAdminEditableInput(input: Partial<AllocatorPreferences>): string | null {
  // Re-use the self-editable validation first
  const selfError = validateSelfEditableInput(input);
  if (selfError) return selfError;

  // Admin-only numeric bounds
  const numericFields: [keyof AllocatorPreferences, number, number][] = [
    ["max_drawdown_tolerance", 0, 1],
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

  // Admin-only array fields
  const arrayFields: (keyof AllocatorPreferences)[] = [
    "preferred_strategy_types",
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
 * Read the current user's preferences. Returns null if no row exists OR if the
 * `allocator_preferences` table doesn't exist yet (migration 011 not applied).
 *
 * The schema-missing path is treated as "no preferences yet" so the page can
 * render the empty form instead of crashing with a 500. Other errors still throw.
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
    // PGRST205 = table not in schema cache (migration 011 not applied yet)
    if (error.code === "PGRST205") {
      console.warn(
        "[preferences] allocator_preferences table missing — apply migration 011",
      );
      return null;
    }
    throw error;
  }
  return data as AllocatorPreferences | null;
}
