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
