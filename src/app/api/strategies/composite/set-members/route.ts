import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { isUuid } from "@/lib/utils";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { keyWindowsSchema } from "@/lib/composite/keyWindowsSchema";
import { getCorrelationId } from "@/lib/correlation-id";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/composite/set-members — the multi-key wizard's
 * "Continue" handoff (Phase 88 / ONB-03). It re-validates the full keys[]
 * SERVER-SIDE with the SAME `keyWindowsSchema` the client runs — one spec, two
 * surfaces, zero drift by construction — then writes membership WHOLESALE via
 * the SECURITY DEFINER `set_wizard_composite_members` RPC.
 *
 * The route never trusts client validation (T-88-16): a crafted payload that
 * "passed" the browser (overlapping windows, or a key with no api_key_id) is
 * rejected here before the RPC. Validation failures return a uniform
 * { code: 'MULTI_KEY_WINDOWS_INVALID' } — the purpose-built WizardErrorCode the
 * client maps to the window-specific copy — zod issue details are NOT echoed
 * (the client computes its field-level messages locally from the same schema).
 *
 * seq is intentionally NOT sent to the RPC: it is derived server-side from
 * window_start order (Pitfall 2 — one derivation, both sides agree). The
 * incoming keys[] carry seq only so the shared schema's monotonicity rule can
 * run; the p_members payload strips it.
 */

/**
 * Map a Postgres error from `set_wizard_composite_members` to a uniform
 * { status, code } pair. The RPC's guards RAISE for ownership / no-draft
 * (insufficient_privilege / 42501) and for a single-key target (a plain
 * RAISE) — both are caller-shaped faults, so they classify to 4xx. The raw
 * RPC message is never forwarded (H-0305); detail stays in the server log.
 */
function classifyMembersRpcError(code: string | undefined): {
  status: number;
  code: string;
} {
  if (code === "42501") {
    // auth.uid mismatch, strategy not owned by caller, or no composite draft.
    return { status: 403, code: "UNKNOWN" };
  }
  // Composite-guard RAISE (e.g. target is a single-key strategy) or any other
  // RPC-side rejection — a client-shaped fault.
  return { status: 409, code: "GUARD_BLOCKED" };
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "MULTI_KEY_WINDOWS_INVALID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { strategy_id, keys } = body as Record<string, unknown>;

  if (!isUuid(strategy_id)) {
    return NextResponse.json(
      { code: "MULTI_KEY_WINDOWS_INVALID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Server-side re-validation via the SHARED schema (no forked overlap/order
  // logic here). Zod issue details are deliberately NOT echoed — the uniform
  // { code } posture holds and the client derives field messages locally.
  const parsed = keyWindowsSchema.safeParse({ keys });
  if (!parsed.success) {
    return NextResponse.json(
      { code: "MULTI_KEY_WINDOWS_INVALID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // The shared schema keeps api_key_id OPTIONAL (the live UI accumulates
  // windows before a key is minted). The route additionally REQUIRES a valid
  // api_key_id on every member: an unvalidated key must never reach the write.
  const members = parsed.data.keys;
  const everyKeyMinted = members.every((k) => isUuid(k.api_key_id));
  if (members.length === 0 || !everyKeyMinted) {
    return NextResponse.json(
      { code: "MULTI_KEY_WINDOWS_INVALID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Rate-limit consumed only AFTER validation passes (B15 limiter-ordering), so
  // a malformed request does not burn one of the caller's own tokens. Route-
  // distinct key so member writes don't share the add-key bucket.
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-composite-set-members:${user.id}`,
  );
  if (!rl.success) {
    // ⭐ 164.2-05 / criterion 4 — `RATE_LIMITED`, and this route is where the
    // exchange-blaming code was LEAST defensible of the four.
    //
    // The body used to carry `KEY_RATE_LIMIT`, whose copy says *"The exchange
    // asked us to slow down … a transient, exchange-side throttle"* and whose
    // second fix line offers *"try a different exchange account"*. This
    // endpoint PERSISTS DATE WINDOWS. It never calls
    // `classifyKeyValidationError`, never reaches a venue on any path, and the
    // bucket that denied one line above is `userActionLimiter` keyed
    // `strategies-composite-set-members:<uid>` — ours, per USER. The sentence
    // named a party provably not involved, and its remedy could not clear the
    // bucket. `MultiKeyConnectStep`'s own catch arm records the identical
    // finding for this route's transport failure ("it never touches an exchange
    // on any path"); this is the same fact on the deny arm.
    //
    // `RATE_LIMITED` needed no new copy — it already said *"the cap is ours,
    // not your exchange's"*. Wiring, not authoring.
    //
    // ⚠️ THE OLDER SHAPE IS DELIBERATELY KEPT. This is a bare
    // `NextResponse.json` rather than `rateLimitDenyJson`, so — unlike its
    // three siblings — a limiter MISCONFIGURATION still answers 429 here
    // instead of 503. That is a POSTURE defect with its own owner
    // (`seam-ratelimit-posture.invariant.test.ts` records which routes route
    // their deny); converting it is not a copy fix and is out of this plan's
    // scope. ⚠️ One live consequence, measured rather than assumed: because the
    // code sits inside a `NextResponse.json` literal beside `status: 429`, THIS
    // route's 429 is the only one of the four visible to the derived scanner in
    // `wizardErrors.invariant.test.ts` — pinned there so nobody "simplifies"
    // the other three onto a derivation that sees nothing.
    return NextResponse.json(
      { code: "RATE_LIMITED", error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // Wholesale membership write. seq is intentionally OMITTED — the RPC derives
  // it from window_start ASC order (Pitfall 2: one derivation, both sides
  // agree). Only the non-secret member shape crosses the boundary.
  const p_members = members.map((k) => ({
    api_key_id: k.api_key_id,
    window_start: k.window_start,
    window_end: k.window_end,
  }));

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_wizard_composite_members", {
      p_user_id: user.id,
      p_strategy_id: strategy_id,
      p_members,
    });

    if (error) {
      // Log the inbound correlation_id (the wizard sends it and DISPLAYS it in
      // its error copy) so a user copying the shown id can find THIS failure in
      // the server logs. The id is not a secret; it is not added to the body.
      const correlationId = await getCorrelationId();
      console.error(
        `[strategies/composite/set-members] RPC error [correlation_id=${correlationId}]:`,
        error.message,
        error.code,
      );
      const mapped = classifyMembersRpcError(error.code);
      return NextResponse.json(
        { code: mapped.code },
        { status: mapped.status, headers: NO_STORE_HEADERS },
      );
    }

    // set_wizard_composite_members RETURNS INTEGER (the member count written).
    const member_count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(member_count)) {
      return NextResponse.json(
        { code: "UNKNOWN" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: true, member_count },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    // Never forward the raw message — it can carry internal detail (H-0305).
    const message = err instanceof Error ? err.message : "Member write failed";
    const correlationId = await getCorrelationId();
    console.error(
      `[strategies/composite/set-members] caught exception [correlation_id=${correlationId}]:`,
      message,
    );
    return NextResponse.json(
      { code: "UNKNOWN" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
