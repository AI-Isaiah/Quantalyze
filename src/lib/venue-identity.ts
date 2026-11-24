import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEventAsUser } from "@/lib/audit";

/**
 * Phase 225 ONEACCOUNTONCE, plan 06 (CONN-03, MT5D-08): the one broker-server
 * vocabulary the connect routes use, written once for TypeScript and pinned
 * against its Python twin (`analytics-service/services/account_identity.py`:
 * `normalise_venue_server`, `same_venue_server`, `pick_same_account_holder`) by
 * ONE hand-typed fixture, `analytics-service/tests/fixtures/venue_server_identity.json`,
 * which both runtimes replay whole.
 *
 * WHY THE SERVER EXISTS. An MT5 login is only unique within one broker server:
 * the same number on two brokers is two accounts. The server is stored beside
 * the login in `api_keys.venue_server` (migration 20261123180000), normalised.
 *
 * WHY NULL IS A WILDCARD. A key connected before the column existed, or by a
 * poll whose session carried no server, has none. CONTEXT Q2: such a key
 * "matches on login alone, as today". Matching a null as "any server" errs
 * toward REFUSING a connect, which is the safe side: a missed duplicate is the
 * failure this phase exists to prevent, a refused look-alike is a retry.
 *
 * NORMAL FORM, agreed by three implementations. Space, tab, CR and LF are
 * trimmed from both ends, then the text is lower-cased, and blank becomes null.
 * That is the SQL `NULLIF(lower(btrim(x, E' \t\r\n')), '')` of
 * `swap_account_slot` and the CHECK `api_keys_venue_server_valid`, NOT
 * `String.prototype.trim`, which also strips a vertical tab, a form feed and a
 * no-break space the database keeps. A value longer than 128 characters (code
 * points, as `char_length` counts them) after trimming is null too, so the CHECK
 * never meets a value it refuses and the key matches as a wildcard. A value
 * that is not a string is null: a number must never be stringified into an
 * identity.
 *
 * THE THREE PICK TIERS. Among a login's live keys, the one the new key is "the
 * same account as" is chosen by tier: (1) an exact server, (2) a null server on
 * either side, (3) any key on the login, but ONLY in `after_index_refusal`
 * mode. Tier 3 exists because the live login-only unique index
 * (`api_keys_user_exchange_venue_account_uniq`) refuses a write on a login
 * regardless of server, and the caller still has to name the key that refused
 * it. It goes dead once the server-aware index ships (plan 10), after which the
 * index never refuses a different-server write and the fence mode is the only
 * one a caller reaches. Inside a tier the smallest id wins, so the pick never
 * depends on row order.
 */

/** Same cap as the CHECK `api_keys_venue_server_valid` and the Python twin. */
export const MAX_VENUE_SERVER_LENGTH = 128;

const EDGE_WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/**
 * Normalise a raw broker server to the stored form, or null. Total: never
 * throws, never stringifies a non-string.
 */
export function normaliseVenueServer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(EDGE_WHITESPACE, "").toLowerCase();
  if (text === "") return null;
  // Spread counts code points, as the database's char_length does.
  if ([...text].length > MAX_VENUE_SERVER_LENGTH) return null;
  return text;
}

/** Two servers are the same account when equal or when either is null. */
export function sameVenueServer(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b;
}

export type PickMode = "fence" | "after_index_refusal";

function smallestId<T extends { id: string }>(
  rows: readonly T[],
  qualifies: (row: T) => boolean,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (qualifies(row) && (best === null || row.id < best.id)) best = row;
  }
  return best;
}

/**
 * Pick the live key a new key on the same login is "the same account as", or
 * null. `server` must already be normalised; the rows' `venue_server` come from
 * the database and are normalised there.
 */
export function pickSameAccountHolder<
  T extends { id: string; venue_server: string | null },
>(rows: readonly T[], server: string | null, mode: PickMode): T | null {
  const tiers: Array<(row: T) => boolean> = [
    (row) => row.venue_server === server,
    (row) => sameVenueServer(row.venue_server, server),
  ];
  if (mode === "after_index_refusal") tiers.push(() => true);
  for (const qualifies of tiers) {
    const hit = smallestId(rows, qualifies);
    if (hit !== null) return hit;
  }
  return null;
}

export type SameLoginKeyRow = {
  id: string;
  venue_server: string | null;
  is_active: boolean;
  sync_status: string | null;
  disconnected_at: string | null;
  account_shared_with_api_key_id: string | null;
  account_share_kind: string | null;
};

/**
 * The live keys of one owner on one login. The `userId` filter is the tenant
 * boundary (the admin client crosses RLS by design), so it is mandatory in the
 * signature and no row of another owner can come back. Returns the read error
 * instead of throwing, and never logs it: the caller scrubs it with its own
 * request secrets.
 */
export async function readLiveSameLoginKeys(
  admin: SupabaseClient,
  args: { userId: string; exchange: string; venueAccountId: string },
): Promise<{ rows: SameLoginKeyRow[]; error: unknown }> {
  try {
    const { data, error } = await admin
      .from("api_keys")
      .select(
        "id, venue_server, is_active, sync_status, disconnected_at, account_shared_with_api_key_id, account_share_kind",
      )
      .eq("user_id", args.userId)
      .eq("exchange", args.exchange)
      .eq("venue_account_id", args.venueAccountId)
      .is("disconnected_at", null)
      .order("id");
    if (error) return { rows: [], error };
    return { rows: (data ?? []) as SameLoginKeyRow[], error: null };
  } catch (error) {
    return { rows: [], error };
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

/**
 * Move a failing holder's slot to a working key of the same owner through
 * `public.swap_account_slot` (MT5D-08, Q1): one transaction stamps the new key
 * and marks the old holder a duplicate of it. Nothing is disconnected.
 *
 * On success the demoted key is audited as a duplicate (venue and the new
 * holder's key id only: never a login, a server or a user id, T-167.1.2-17) and
 * a recompose is queued. Neither follow-up can undo a swap that landed: an audit
 * is fire-and-forget and an enqueue failure is logged and still answers ok.
 * The RPC error is returned, never logged: it can carry the login.
 *
 * The server is normalised here as well, so an over-length or blank value
 * reaches the RPC as "no server" and never as a refusal token or a raw 23514.
 */
export async function swapAccountSlot(
  admin: SupabaseClient,
  args: {
    userId: string;
    exchange: string;
    newKeyId: string;
    oldHolderId: string;
    venueAccountId: string;
    venueServer: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const server = normaliseVenueServer(args.venueServer);
  const rpcArgs: Record<string, string> = {
    p_new_key: args.newKeyId,
    p_old_holder: args.oldHolderId,
    p_venue_account_id: args.venueAccountId,
  };
  if (server !== null) rpcArgs.p_venue_server = server;

  try {
    const { error } = await admin.rpc("swap_account_slot", rpcArgs);
    if (error) return { ok: false, error };
  } catch (error) {
    return { ok: false, error };
  }

  logAuditEventAsUser(admin, args.userId, {
    action: "api_key.account_duplicate_detected",
    entity_type: "api_key",
    entity_id: args.oldHolderId,
    metadata: { venue: args.exchange, holder_api_key_id: args.newKeyId },
  });

  // The curve composed before the swap may count the account under the wrong
  // key, and nothing else enqueues a compose for it. Best effort: the swap has
  // landed, so a failure is logged (class and code only) and never undoes it.
  try {
    const { error } = await admin.rpc("enqueue_compute_job", {
      p_strategy_id: null,
      p_allocator_id: args.userId,
      p_kind: "derive_allocator_equity",
    });
    if (error) {
      console.error(
        `[venue-identity] recompose enqueue after a slot swap failed for api_key ${args.oldHolderId}: code=${errorCode(error)}`,
      );
    }
  } catch (error) {
    console.error(
      `[venue-identity] recompose enqueue after a slot swap threw for api_key ${args.oldHolderId}: code=${errorCode(error)}`,
    );
  }
  return { ok: true };
}
