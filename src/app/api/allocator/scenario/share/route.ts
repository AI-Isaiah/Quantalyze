/**
 * Phase 25 / Plan 03 / SHARE-01 — allocator scenario share-link GENERATE.
 *
 *   POST /api/allocator/scenario/share  → mint a revocable read-only share link
 *
 * Owner write under RLS — the user-scoped supabase client. The
 * `scenario_shares` table (migration 20260622120000) carries the
 * `scenario_shares_owner` policy `FOR ALL USING (created_by = auth.uid())
 * WITH CHECK (created_by = auth.uid() AND EXISTS(owned scenario))`, so the
 * client binds every read/write to the caller AND the DB itself rejects sharing
 * a scenario the caller does not own (CR-01). `created_by` is ALWAYS the
 * authenticated user — never the body (the body schema carries only
 * `scenario_id`; the atomic RPC sources `created_by` from `auth.uid()` inside
 * its body). The RLS WITH CHECK is defense-in-depth (T-25-08).
 *
 * CR-01 ownership (three layers): (1) this route SELECTs the scenario via the
 * RLS-scoped client BEFORE minting — 0 rows → 404, so an allocator cannot mint
 * a link for another tenant's scenario_id; (2) the table RLS WITH CHECK
 * owner-coherence EXISTS clause; (3) the read RPC's `s.allocator_id =
 * sh.created_by` predicate. Defense-in-depth because the read path is SECURITY
 * DEFINER (RLS does not protect its body).
 *
 * Token discipline (T-25-12): the route mints a 256-bit token via
 * `mintShareToken()` and persists ONLY its sha256 hash (`token_hash`). The RAW
 * token is externalised exactly once — in the returned `{ url }` — and is never
 * logged, never re-fetched, and never stored.
 *
 * One active share per scenario, atomically (WR-02): the
 * `create_scenario_share` SECURITY INVOKER RPC (migration 25-01) revokes any
 * prior active row and inserts the new one in ONE transaction, so a failed
 * insert can never leave the scenario with zero active shares (the prior link
 * dead with no replacement). The partial unique index from migration 25-01
 * (`UNIQUE (scenario_id) WHERE revoked_at IS NULL`) is the structural backstop.
 *
 * Conventions copied verbatim from
 * `src/app/api/allocator/scenario/saved/route.ts`:
 *   - B15 ordering: auth (wrapper) → body read/parse → zod validate (400, no
 *     token burned) → rate-limit AFTER validation → user-scoped write.
 *   - Redacted DB-error envelope (F5a/F5b, T-25-09): console.error +
 *     captureToSentry server-side, a stable UI-facing message — NEVER echo
 *     error.message (leaks schema/column names).
 *   - NO_STORE_HEADERS on EVERY response (success + error).
 *   - Rate-limit-misconfig → 503 (not a misleading 429), T-25-10.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { isUuid } from "@/lib/utils";
import { mintShareToken } from "@/lib/scenario-share-token";
import {
  isBookOnlyDraft,
  type ScenarioDraft,
} from "@/app/(dashboard)/allocations/lib/scenario-state";

export const runtime = "nodejs";

// The origin the share URL is built from. Sourced from NEXT_PUBLIC_APP_URL
// (the demo-pdf precedent, portfolio-pdf/[id]/route.ts:17) — NEVER a hardcoded
// host. Read per-request (not captured at module load) so the resolved origin
// always reflects the running environment. Falls back to localhost only in dev
// where the env var is unset.
function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// The body carries ONLY the scenario_id (uuid). `created_by` is NEVER read from
// the body — it is sourced from auth (T-25-08). The uuid is validated with the
// codebase-canonical `isUuid` (UUID_RE) used by every other allocator route
// that takes a client id (saved/[id]/route.ts), NOT zod v4's `.uuid()`: this
// Next.js ships zod 4, whose `.uuid()` enforces RFC-4122 version/variant bits
// and would reject Postgres-shaped ids that `gen_random_uuid()` and the test
// fixtures legitimately produce. A malformed / absent scenario_id → 400 before
// any token is minted or any rate-limit token is burned.
const ShareBodySchema = z.object({
  scenario_id: z.string().refine(isUuid, { message: "Invalid scenario id" }),
});

export const POST = withAllocatorAuth(
  async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch (err) {
      console.error("[scenario-share] body read failed:", err);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let json: unknown;
    try {
      json = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      json = null;
    }

    const parsed = ShareBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const scenarioId = parsed.data.scenario_id;

    // B15 limiter-ordering — consume the token only AFTER validation. A 400
    // does NOT burn one of the caller's own tokens, and no token is minted
    // before this point.
    const rl = await checkLimit(userActionLimiter, `scenario_share:${user.id}`);
    if (!rl.success) {
      if (isRateLimitMisconfigured(rl)) {
        return NextResponse.json(
          { error: "Rate limiter unavailable" },
          {
            status: 503,
            headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
          },
        );
      }
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
        },
      );
    }

    const supabase = await createClient();

    // CR-01 OWNERSHIP PROBE (layer 1 of 3) — confirm the CALLER OWNS the
    // scenario BEFORE minting a share. The FK on scenario_shares.scenario_id
    // only checks the scenario EXISTS, not that the caller owns it; without
    // this probe an authenticated allocator could POST a victim's scenario_id
    // (a UUID enumerable from their own saved-list / compare responses) and mint
    // a working public share link for a scenario they do not own — exposing
    // another tenant's name/draft/series to an anonymous recipient. The
    // user-scoped client is RLS-bound to `scenarios_owner`
    // (allocator_id = auth.uid()), so this SELECT returns 0 rows for any
    // scenario the caller does not own → 404. We return 404 (not 403) so the
    // response does not reveal whether the scenario exists for another tenant
    // (no existence oracle, mirroring saved/[id] + revoke). The DB-level table
    // RLS WITH CHECK and the read RPC owner-coherence predicate (layers 2+3) are
    // the defence-in-depth backstops — RLS does not protect the SECURITY DEFINER
    // RPC body, so this write-time check cannot be the only gate.
    const { data: ownedScenario, error: ownershipError } = await supabase
      .from("scenarios")
      // P61-BUG-2: `draft` is read alongside `id` so the book-only gate below
      // can inspect addedStrategies without a second query. Owner-scoped RLS
      // read of the caller's own row — no new disclosure.
      .select("id, draft")
      .eq("id", scenarioId)
      .maybeSingle();

    if (ownershipError) {
      console.error("scenario_share ownership probe error", {
        user: user.id,
        message: ownershipError.message,
      });
      captureToSentry(ownershipError, { tags: { area: "scenario-share" } });
      return NextResponse.json(
        { error: "Share failed", message: "Couldn't create a share link. Try again." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (!ownedScenario) {
      // 0 rows (RLS-scoped) → the caller does not own this scenario (or it does
      // not exist) → 404, NOT 403 (no existence oracle). No share is created.
      return NextResponse.json(
        { error: "Scenario not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    // P61-BUG-2 — refuse to mint a share for a BOOK-ONLY draft (no added
    // strategies). The public share page resolves ONLY published added-strategy
    // series (the live-book boundary: the owner's private per-key book series
    // are deliberately never exposed there), so a book-only share is a dead
    // link by construction. Fail loud at the source with the reason instead of
    // minting it. Defensive JSONB read: a missing/misshapen draft also has
    // nothing resolvable to share, so it takes the same branch.
    // MEMBER-03 — ONE definition of book-only across mint/resolve/compare: the
    // gate reads the SAME null-safe `isBookOnlyDraft` predicate the compare and
    // share surfaces use (explicit book members + zero added strategies), never
    // an ad-hoc inline check that could drift per-surface. The defensive
    // "nothing resolvable" path (a null/misshapen/empty-added draft) is checked
    // FIRST and short-circuits, so a null draft never reaches the predicate; and
    // because `isBookOnlyDraft` is null-safe on undefined `memberKeyIds`, a
    // pre-v4 owner blob (membership underived) returns false — not a throw — and
    // is still caught by the same defensive branch.
    const draft = (ownedScenario as { draft?: ScenarioDraft | null }).draft ?? null;
    const draftAdded = draft?.addedStrategies;
    const nothingShareable = !Array.isArray(draftAdded) || draftAdded.length === 0;
    if (nothingShareable || isBookOnlyDraft(draft as ScenarioDraft)) {
      return NextResponse.json(
        {
          error: "Nothing shareable",
          code: "book_only_draft",
          message:
            "This scenario is built only on your private book sources, which are never shown on a public link. Add catalog strategies to share a computable projection.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    // Mint AFTER the limiter + ownership probe. The raw token lives only in the
    // URL below; only its hash is persisted (T-25-12).
    const { raw, hash } = mintShareToken();

    // WR-02 ATOMICITY: revoke-prior + insert-new in ONE transaction via the
    // create_scenario_share SECURITY INVOKER RPC (migration 25-01). Previously
    // this was a pre-revoke UPDATE then a separate INSERT — two non-atomic
    // statements where a failed insert after a successful pre-revoke left the
    // scenario with NO active share (the prior link dead, no replacement). The
    // RPC folds both writes into a single function transaction, so a failed
    // insert rolls back the revoke too — the "one active share per scenario"
    // invariant is never violated by a partial write. The RPC runs SECURITY
    // INVOKER (RLS-gated as the caller); created_by is sourced from auth.uid()
    // INSIDE the function body (never a parameter), so a body-supplied
    // created_by can never reach the row (T-25-08), and the RLS WITH CHECK
    // (created_by = auth.uid() AND the caller owns the scenario, CR-01) is the
    // DB-level backstop.
    // The cast-through-unknown pattern (csv-finalize/route.ts precedent):
    // `database.types.ts` has NOT been regenerated for create_scenario_share
    // (the migration is unshipped), so a typed `.rpc()` call would fail
    // compilation. Centralise the cast here; delete it when the types
    // regeneration lands. The RPC returns the new share row id (UUID) as `data`.
    const { data: shareId, error } = await (
      supabase.rpc as unknown as (
        fn: "create_scenario_share",
        args: { p_scenario_id: string; p_token_hash: string },
      ) => Promise<{ data: string | null; error: { code?: string; message?: string } | null }>
    )("create_scenario_share", {
      p_scenario_id: scenarioId,
      p_token_hash: hash,
    });

    if (error) {
      // F5a/F5b / T-25-09 — redact. Log + Sentry server-side; stable UI-facing
      // message to the client. NEVER echo error.message.
      console.error("scenario_share error", { user: user.id, message: error.message });
      captureToSentry(error, { tags: { area: "scenario-share" } });
      return NextResponse.json(
        { error: "Share failed", message: "Couldn't create a share link. Try again." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // Fire-and-forget audit (the scenario.* family). Self-owned, RLS-scoped.
    // entity = the shared scenario. Metadata carries NO token / draft content —
    // only the new share row id (the RPC returns the bare UUID), mirroring the
    // saved-route privacy posture. The pre-revoke of any prior link is implicit
    // in re-sharing — folded into the same RPC transaction — and is NOT a
    // separate event (emitting scenario.share.revoke here would double-log one
    // user gesture).
    logAuditEvent(supabase, {
      action: "scenario.share",
      entity_type: "scenario",
      entity_id: scenarioId,
      metadata: { share_id: shareId as string },
    });

    // The raw token appears ONLY here. No audit log carries the token or any
    // draft content (mirrors the saved-route privacy posture).
    return NextResponse.json(
      { url: `${resolveAppUrl()}/scenario-share/${raw}` },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  },
);
