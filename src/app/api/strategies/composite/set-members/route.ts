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
    return NextResponse.json(
      { code: "KEY_RATE_LIMIT", error: "Too many requests" },
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
