/**
 * Dashboard-note initial read (PI-04, Phase 100, v1.10).
 *
 * Owner-scoped, secretless RLS read for the /allocations whole-book note that
 * backs `DashboardNoteCard` (plan 100-01). This helper is OWNED by plan 100-04
 * (the wave-2 page wiring) — it is NOT part of plan 100-02's watchlist-read.ts
 * export contract; keeping it colocated here avoids touching that module.
 *
 * Error discipline mirrors the watchlist-read / Phase-98 exposure read layer:
 * a PostgREST error THROWS (reaching allocations/error.tsx). Zero rows and a
 * query failure are DISTINCT states and are NEVER collapsed — a transient
 * RLS/network/schema-drift failure must not read as "you have no note".
 * `.maybeSingle()` returns `{ data: null, error: null }` for the 0-row case
 * (there is a unique (user_id, scope_kind, scope_ref) key), so the honest-empty
 * default only fires when the read genuinely succeeded with no persisted note.
 *
 * Trust boundary: the caller passes its USER Supabase client (owner RLS:
 * user_notes user_id = auth.uid()) plus an explicit `.eq("user_id", …)` gate as
 * defence-in-depth. The admin client is NEVER used here (it would bypass RLS).
 * The `userId` MUST be the `auth.getUser()`-derived id, never a client param.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type SupabaseUserClient = SupabaseClient<Database>;

/** Initial content + last-saved stamp for the DashboardNoteCard. */
export interface DashboardNote {
  initialContent: string;
  initialLastSavedAt: Date | null;
}

/**
 * PI-04 — read the allocator's whole-book dashboard note
 * (scope_kind='dashboard', scope_ref='allocations'). Returns the honest-empty
 * `{ initialContent: "", initialLastSavedAt: null }` when no note exists;
 * THROWS on any PostgREST error.
 */
export async function getDashboardNote(
  supabase: SupabaseUserClient,
  userId: string,
): Promise<DashboardNote> {
  const { data, error } = await supabase
    .from("user_notes")
    .select("content, updated_at")
    .eq("user_id", userId)
    .eq("scope_kind", "dashboard")
    .eq("scope_ref", "allocations")
    .maybeSingle();

  if (error) throw error;

  return {
    initialContent: data?.content ?? "",
    initialLastSavedAt: data?.updated_at ? new Date(data.updated_at) : null,
  };
}
