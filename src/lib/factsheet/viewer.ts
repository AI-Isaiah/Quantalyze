/**
 * Phase 196 / D-01, D-02 — who is reading this factsheet, decided per request.
 *
 * The answer picks the chrome around the document (a back link and the next
 * step the viewer's role allows, or the visitor header for a reader with no
 * session). It is an AFFORDANCE decision only: `/api/intro` and `/allocations`
 * keep their own server checks, so a wrong answer here can show a button that
 * then refuses, never grant an action.
 *
 * ⛔ A RENDER-PROP INPUT, NEVER A PAYLOAD FIELD. The factsheet payload is the
 * object the id-keyed `unstable_cache` serves to every later reader, so a
 * viewer's identity, role or ownership folded into it, or into the cache key,
 * would be published to everyone (T-150-27, T-196-10). The page calls this
 * AFTER the lane decision and hands the result to the chrome only.
 *
 * Two role systems exist and are not merged here: this reads `profiles.role`
 * plus `isProfileApproved` (the predicate `/api/intro` and `requireRolePage`
 * enforce), while `canViewAum` keeps reading `user_app_roles` (194 D-22).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProfileApproved } from "@/lib/approval";
import { captureToSentry } from "@/lib/sentry-capture";

export type FactsheetViewer =
  | { kind: "anon" }
  | { kind: "signed_in"; userId: string; isOwner: boolean; canAllocate: boolean };

/**
 * `user` is the server-validated result of `auth.getUser()` (null = no
 * session); `ownerId` is the strategy's `user_id` from the server read. The
 * owner is never offered the allocator actions, and needs no profile read to
 * say so. A read error or a missing profile row fails closed
 * (`canAllocate: false`) and is reported, so a blip can hide an affordance but
 * never grant one. `canAllocate` also needs an `investor_attestations` row with
 * a non-null `attested_at`, the test /discovery's layout applies.
 */
export async function resolveFactsheetViewer(
  supabase: SupabaseClient,
  user: { id: string } | null,
  ownerId: string | null | undefined,
): Promise<FactsheetViewer> {
  if (!user) return { kind: "anon" };
  const isOwner = ownerId != null && user.id === ownerId;
  if (isOwner) {
    return { kind: "signed_in", userId: user.id, isOwner: true, canAllocate: false };
  }

  let canAllocate = false;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role, allocator_status, manager_status, is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      captureToSentry(error, {
        tags: { area: "factsheet-viewer", stage: "profile-read" },
      });
    } else if (data) {
      const role = (data as { role: string | null }).role;
      const approvedAllocator =
        isProfileApproved(data as Parameters<typeof isProfileApproved>[0]) &&
        (role === "allocator" || role === "both");
      if (approvedAllocator) {
        // The intro / allocate actions sat behind /discovery's accredited-
        // investor gate before Phase 196 (CR-01): same test, same fail-closed
        // default. A read error or a missing row means "not attested".
        const { data: attestation, error: attError } = await supabase
          .from("investor_attestations")
          .select("attested_at")
          .eq("user_id", user.id)
          .maybeSingle();
        if (attError) {
          captureToSentry(attError, {
            tags: { area: "factsheet-viewer", stage: "attestation-read" },
          });
        } else {
          canAllocate = attestation?.attested_at != null;
        }
      }
    }
  } catch (err) {
    captureToSentry(err, {
      tags: { area: "factsheet-viewer", stage: "profile-read" },
    });
  }
  return { kind: "signed_in", userId: user.id, isOwner: false, canAllocate };
}
