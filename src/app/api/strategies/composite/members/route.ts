import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { isUuid } from "@/lib/utils";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { getCorrelationId } from "@/lib/correlation-id";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * GET /api/strategies/composite/members?strategy_id=<uuid> — WIZ-01.
 *
 * The multi-key wizard's server read of composite membership: an authenticated
 * OWNER fetches their composite draft's existing member keys so a re-mounted
 * MultiKeyConnectStep (WIZ-02/WIZ-05) can rehydrate rather than drop all key
 * state. It returns ONLY non-secret member metadata — exchange, nickname,
 * active window, verified flag, and the non-secret api_key_id UUID that WIZ-02's
 * secretless resubmit needs to address each key.
 *
 * SECURITY (T-94-01): the response is secretless BY CONSTRUCTION. The embedded
 * `.select()` enumerates only non-secret columns (never `SELECT *`, never the
 * api_keys secret/envelope columns), and every member object is built
 * FIELD-BY-FIELD — a DB row is never spread. A load-bearing route test plants
 * sentinel ciphertext on the mocked rows and asserts neither the secret column
 * names nor their values ever serialize.
 *
 * OWNER-SCOPE (T-94-02/T-94-03): withAuth authenticates; an explicit
 * `strategies WHERE id=? AND user_id=?` guard gives a clean 403 that is
 * BYTE-IDENTICAL for not-found and not-owned (no existence oracle) — a plain
 * RLS-scoped read alone is silently empty for a non-owner and can't distinguish
 * "empty membership" from "not yours". The member read additionally rides the
 * existing `strategy_keys_owner` + `api_keys` owner RLS (defense in depth).
 *
 * NO migration, NO new RLS policy, NO SECURITY DEFINER RPC: the existing owner
 * RLS fully covers this read, and a DEFINER read is exactly the surface that
 * could bypass RLS and leak ciphertext (research-verified).
 *
 * NO rate limiter: userActionLimiter buckets are for mutations. This read is
 * idempotent, RLS-bounded, and fires on every wizard step re-mount — rate-
 * limiting it would break legitimate rehydration.
 */
export const GET = withAuth(async (req: NextRequest, user: User) => {
  const strategyId = req.nextUrl.searchParams.get("strategy_id");

  if (!isUuid(strategyId)) {
    return NextResponse.json(
      { code: "UNKNOWN" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const supabase = await createClient();

    // 1. Ownership guard — no existence oracle. A missing row (not-found OR
    //    not-owned) returns a byte-identical 403 so a caller can't probe which
    //    strategy_ids exist. This mirrors set_wizard_composite_members' own
    //    `WHERE id=? AND user_id=?` guard.
    const { data: owned, error: ownerErr } = await supabase
      .from("strategies")
      .select("id")
      .eq("id", strategyId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (ownerErr) {
      // Log the inbound correlation_id (UX-02 sends it; the client DISPLAYS it
      // in the WIZARD_KEYS_LOAD_FAILED envelope) so a user who copies the shown
      // id can find THIS failure in the server logs. The id is not a secret.
      const correlationId = await getCorrelationId();
      console.error(
        `[strategies/composite/members] ownership probe error [correlation_id=${correlationId}]:`,
        ownerErr.message,
      );
      return NextResponse.json(
        { code: "UNKNOWN" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (!owned) {
      return NextResponse.json(
        { code: "UNKNOWN" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    // 2. Member read — RLS-scoped embedded select naming ONLY non-secret
    //    columns. The api_keys join pulls exchange + label (nickname) and
    //    NOTHING else; the secret/envelope columns are never named.
    //
    //    The client's TYPE is cast to the untyped `SupabaseClient` here because
    //    the generated `Database` types (database.types.ts) predate the
    //    strategy_keys migration and don't yet know the table (type-drift
    //    tracked under audit-2026-05-07; existing readers use the untyped ADMIN
    //    client, which we deliberately avoid). Crucially this casts the TYPE
    //    only — the runtime instance is still the RLS-scoped, cookie-auth user
    //    client from createClient(), so `strategy_keys_owner` + api_keys owner
    //    RLS remain fully enforced (T-94-02 defense in depth).
    const { data, error } = await (supabase as unknown as SupabaseClient)
      .from("strategy_keys")
      .select("seq, api_key_id, window_start, window_end, api_keys ( exchange, label )")
      .eq("strategy_id", strategyId)
      .order("seq", { ascending: true });

    if (error) {
      const correlationId = await getCorrelationId();
      console.error(
        `[strategies/composite/members] member read error [correlation_id=${correlationId}]:`,
        error.message,
      );
      return NextResponse.json(
        { code: "UNKNOWN" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // Build the response FIELD-BY-FIELD — belt-and-suspenders: a DB row is
    // NEVER spread, so even an over-broad select could not leak. `verified` is
    // true by construction: add-key read-only-validates every key before
    // minting its strategy_keys row, so membership ⇒ verified.
    // api_key_id is a to-one FK into api_keys (api_keys.id PK), so PostgREST
    // returns a single embedded object at runtime; the untyped client can't
    // infer to-one vs to-many, hence the cast through `unknown`.
    const rows = (data ?? []) as unknown as Array<{
      seq: number;
      api_key_id: string;
      window_start: string | null;
      window_end: string | null;
      api_keys: { exchange: string | null; label: string | null } | null;
    }>;

    const members = rows.map((m) => ({
      seq: m.seq,
      api_key_id: m.api_key_id,
      exchange: m.api_keys?.exchange ?? null,
      nickname: m.api_keys?.label ?? null,
      window_start: m.window_start,
      window_end: m.window_end,
      verified: true,
    }));

    return NextResponse.json(
      { ok: true, members },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    // Never forward the raw message — it can carry internal detail (H-0305).
    const message = err instanceof Error ? err.message : "Member read failed";
    const correlationId = await getCorrelationId();
    console.error(
      `[strategies/composite/members] caught exception [correlation_id=${correlationId}]:`,
      message,
    );
    return NextResponse.json(
      { code: "UNKNOWN" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
