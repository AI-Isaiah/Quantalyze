/**
 * Phase 167.1.2 plan 15 (item 8, D-16): which `allocator_holdings` rows are a
 * key's CURRENT holdings.
 *
 * The rule, in the same words as plan 10's Python helper
 * (`_fetch_latest_holdings_per_eligible_key`): that key's rows at its own
 * latest asof; ordering is not trusted for correctness.
 *
 * Why per key and not allocator-wide: `getLatestExposureSnapshot` takes the
 * allocator's single latest `asof`, which drops every position of a key that
 * did not poll on that day, so a quiet key would read as flat. Each key keeps
 * its own latest poll instead.
 *
 * Why the key set is not narrowed: every key the allocator owns counts,
 * departed ones included. Phase 167.1 routes a holding whose key is not
 * trusted, or is outside the eligible set, into a DISCLOSED part
 * (`untrusted`, `unknownStatus`, `excludedUntrusted`, `excludedUnknownStatus`
 * in `live-holdings-summary.ts`); dropping those keys here would move their
 * dollars out of the disclosures silently. Plan 10 counts eligible keys only
 * because it computes an equity total (D-07); the two share the grain rule,
 * not the key set.
 *
 * Before D-16 the Open Positions collapse kept the newest row per
 * venue:symbol:type across EVERY date, so a position a key closed before its
 * latest poll survived from its last row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
// Review C4 SFH-C4-01: the D-09 account identity, read-only. The same rule
// decides which departed key's history counts, so Open Positions and the book
// agree on which keys read one exchange account.
import { accountIdentityTokens } from "@/lib/departed-history";

/**
 * Keep, for each `api_key_id`, only the rows whose `asof` equals that key's
 * maximum `asof`. One scan finds each key's maximum, a second keeps the rows
 * at it. Input order is preserved and never relied on: the maximum is
 * computed by comparison, so ascending, descending and shuffled input give
 * the same rows. Rows sharing a key's latest `asof` are all kept.
 */
export function latestHoldingsPerKey<
  T extends { api_key_id: string; asof: string },
>(rows: readonly T[]): T[] {
  const latestByKey = new Map<string, string>();
  for (const r of rows) {
    const current = latestByKey.get(r.api_key_id);
    if (current === undefined || r.asof > current) {
      latestByKey.set(r.api_key_id, r.asof);
    }
  }
  return rows.filter((r) => r.asof === latestByKey.get(r.api_key_id));
}

/**
 * The most rows one read may return before it counts as possibly truncated.
 * PostgREST's `max_rows` is 1000 on this project, and a read at that ceiling
 * returns a silent partial list with no error (the failure
 * `getLatestExposureSnapshot`'s docblock records for the old full-window
 * scan). Every read below also asks for at most this many rows with an
 * explicit `.limit`, so the check does not depend on the server setting.
 */
export const HOLDINGS_ROW_CAP = 1000;

type ReadError = { message: string };

/**
 * Review C4 SFH-C4-02. The action a holdings poll records on success
 * (`_emit_audit` in `run_poll_allocator_positions_job`, job_worker.py), with
 * metadata `{ final_status, row_count, asof }`. It is the poll's own record of
 * what it read, and the one record a poll that read NOTHING leaves:
 * `persist_allocator_holdings` writes no row for an empty list. The daily
 * refresh reads the same event (`_POLL_COMPLETED_ACTION` /
 * `_polled_empty_since`, equity_reconstruction.py).
 */
export const POLL_COMPLETED_ACTION = "allocator.holdings.sync_completed";

/**
 * The key columns the account identity reads (`accountIdentityTokens`). Every
 * one is in `API_KEY_USER_COLUMNS`, so the user-scoped client may select it.
 */
const KEY_IDENTITY_COLUMNS =
  "id, exchange, venue_account_id, account_share_kind, account_shared_with_api_key_id";

type KeyIdentityRow = {
  id: string;
  exchange: string | null;
  venue_account_id: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
};

/**
 * Review C4 round 2 WR-R2-03: a key whose returned rows were written, on
 * `asof`, by a poll that could not read its open positions.
 */
export type PartialRead = { api_key_id: string; asof: string };

/** A key's newest reading: the day, and whether it wrote rows on that day. */
type KeyReading = { day: string; hasRows: boolean };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a clean poll read the key on, or null when `metadata` is not one.
 * Clean means `final_status` is exactly `complete`: a poll with warnings had a read
 * fail, so what it did not write proves nothing. An event without `asof`
 * predates the poll recording its day (C2 round 3, R3-WR-01), so nothing binds
 * it to a day and it is no evidence. `row_count` must be a whole number; it is
 * read only to reject a malformed event.
 */
export function cleanPollDay(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (m.final_status !== "complete") return null;
  const rowCount = m.row_count;
  if (typeof rowCount !== "number" || !Number.isInteger(rowCount) || rowCount < 0) {
    return null;
  }
  const asof = m.asof;
  return typeof asof === "string" && ISO_DAY.test(asof) ? asof : null;
}

/**
 * Review C4 round 2 WR-R2-03. The day a poll that could NOT read the key's open
 * positions stamped its rows with, or null when `metadata` is not such a poll.
 * On a ccxt venue `complete_with_warnings` has one cause: the derivative-side
 * read failed and only the spot rows were saved (`fetch_allocator_holdings`,
 * allocator_positions.py). An event without a recorded day binds to no rows.
 */
export function partialPollDay(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (m.final_status !== "complete_with_warnings") return null;
  const asof = m.asof;
  return typeof asof === "string" && ISO_DAY.test(asof) ? asof : null;
}

/**
 * The bounded read behind Open Positions. Three steps, in the shape of
 * `getLatestExposureSnapshot` (read the latest `asof` first, then the rows at
 * it) but at the per-key grain (D-16):
 *
 * 1. the owner's keys with their account identity columns (allowed by
 *    SEC-005). This is the whole key set the old read covered: every
 *    `allocator_holdings` row names one of the owner's `api_keys` rows (the
 *    FK, which refuses a key delete while holdings exist, and the
 *    `enforce_allocator_holdings_owner_coherence` trigger), and a departed
 *    key is soft-disconnected, so its row stays;
 * 2. per key, that key's latest `asof` (`order(asof desc).limit(1)`) and its
 *    newest clean poll (below);
 * 3. per contributing key, that key's rows at that `asof`.
 *
 * Review C4 SFH-C4-01: between steps 2 and 3, keys that read ONE exchange
 * account (`accountIdentityTokens`, the D-09 identity: a shared non-blank
 * venue account id, or a duplicate / composite_member marker) are one reading
 * of that account. Only the keys whose reading is the account's newest, and
 * wrote rows on that day, contribute. Before this, after a key rotation the
 * old key's last poll still showed a position the account had closed since,
 * because the collapse is by venue:symbol:type and the live key no longer
 * held that symbol. A departed key's rows still stand when no key on its
 * account has read it since (the new key has not polled, or is failing and
 * its last reading is older), and a key whose account is unknown is its own
 * account. Dropping superseded rows moves no dollars out of a disclosure: the
 * newer reading is the account's current value.
 *
 * Steps 2 and 3 each run in parallel across keys. There is no date window: a key
 * that has not polled for a long time still shows its last poll, never flat.
 * Every read runs on the caller's user-scoped client under owner RLS and also
 * filters explicitly by `user_id` / `allocator_id`.
 *
 * Review C4 SFH-C4-02: a key that POLLED but read nothing is not "quiet". A
 * clean poll with zero rows writes no row, so its latest `asof` stayed on the
 * day before its last position closed and an expired Deribit option showed
 * forever. Step 2 therefore also reads the key's newest clean poll event
 * (`POLL_COMPLETED_ACTION`, `audit_log_owner_read`). When that poll read the
 * key on a day AFTER its latest rows, the rows are not what the key holds now,
 * and the key contributes nothing. That covers both ways it happens: the poll
 * read nothing (an emptied account, every option expired), or the poll wrote
 * rows the key no longer owns because another key's upsert took them (the
 * holdings unique index has no `api_key_id`, review C4 WR-02). A poll with
 * warnings, an event with no recorded day and a missing event are no evidence,
 * and the key keeps its latest rows. Known limit: this reads what the poll
 * read. A poll that read an account as empty when it was not (the Bybit UTA
 * parse the daily refresh cross-checks against the key's live equity read)
 * shows that key flat until its next poll; the refresh, whose $0 would be
 * permanent, keeps its stricter proof.
 *
 * Review C4 round 2 WR-R2-03: step 2 also reads the key's newest poll event
 * of ANY outcome. When that poll finished with warnings on the very day of the
 * rows this read returns, it is the poll that wrote them, and it could not read
 * the key's open positions; the key and that day are named in `partialReads`. This is
 * bound to the rows, not to the key's current `sync_status`: a failed poll
 * records `sync_failed` and writes nothing, so the rows and their poll's
 * record both stay, and so does the flag. It clears only when a later poll
 * writes the key's rows again. A key that contributes no rows is never named.
 *
 * Never throws. Returns `{ data, error, partialReads }` so the caller's
 * `assertOk` treats it like any other Supabase result. Any step's error is returned as `error`. A
 * read that reaches `HOLDINGS_ROW_CAP` returns a named error instead of a
 * partial list. A key with no holdings contributes nothing.
 *
 * Why a cap and not the id keyset drain the per-key dailies read uses (review
 * C4 IN-04): each read here is ONE key on ONE day, and a thousand positions on
 * one key on one day is not an account this product serves, so a cap that
 * fails loud is enough. The cost is that such a key fails the whole My
 * Allocation read rather than only its holdings panel.
 */
export async function fetchLatestHoldingsPerKey(
  supabase: SupabaseClient<Database>,
  userId: string,
  columns: string,
): Promise<{
  data: unknown[] | null;
  error: ReadError | null;
  partialReads: PartialRead[];
}> {
  const keysRes = await supabase
    .from("api_keys")
    .select(KEY_IDENTITY_COLUMNS)
    .eq("user_id", userId)
    .limit(HOLDINGS_ROW_CAP);
  if (keysRes.error) return { data: null, error: keysRes.error, partialReads: [] };
  const keys = (keysRes.data ?? []) as KeyIdentityRow[];
  if (keys.length >= HOLDINGS_ROW_CAP) {
    return {
      data: null,
      error: { message: "api_keys id read reached the row cap" },
      partialReads: [],
    };
  }

  // Step 2: each key's newest reading, rows or a clean empty poll.
  const readings = await Promise.all(
    keys.map(
      async (
        key,
      ): Promise<{
        reading: KeyReading | null;
        partialDay: string | null;
        error: ReadError | null;
      }> => {
        const [latestRes, pollRes, newestPollRes] = await Promise.all([
          supabase
            .from("allocator_holdings")
            .select("asof")
            .eq("allocator_id", userId)
            .eq("api_key_id", key.id)
            .order("asof", { ascending: false })
            .limit(1),
          supabase
            .from("audit_log")
            .select("metadata")
            .eq("user_id", userId)
            .eq("action", POLL_COMPLETED_ACTION)
            .eq("entity_type", "api_key")
            .eq("entity_id", key.id)
            .eq("metadata->>final_status", "complete")
            .order("created_at", { ascending: false })
            .limit(1),
          // WR-R2-03: the newest poll of any outcome, to tell whether it
          // wrote the rows below with the positions unread.
          supabase
            .from("audit_log")
            .select("metadata")
            .eq("user_id", userId)
            .eq("action", POLL_COMPLETED_ACTION)
            .eq("entity_type", "api_key")
            .eq("entity_id", key.id)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        if (latestRes.error) return { reading: null, partialDay: null, error: latestRes.error };
        if (pollRes.error) return { reading: null, partialDay: null, error: pollRes.error };
        if (newestPollRes.error) {
          return { reading: null, partialDay: null, error: newestPollRes.error };
        }
        const partialDay = partialPollDay(newestPollRes.data?.[0]?.metadata ?? null);
        const latestAsof = latestRes.data?.[0]?.asof ?? null;
        const cleanPollAsof = cleanPollDay(pollRes.data?.[0]?.metadata ?? null);
        if (cleanPollAsof !== null && (latestAsof === null || cleanPollAsof > latestAsof)) {
          // SFH-C4-02: the key's newest clean poll read it after these rows.
          return {
            reading: { day: cleanPollAsof, hasRows: false },
            partialDay: null,
            error: null,
          };
        }
        return {
          reading: latestAsof ? { day: latestAsof, hasRows: true } : null,
          partialDay,
          error: null,
        };
      },
    ),
  );
  const failedReading = readings.find((r) => r.error !== null);
  if (failedReading) {
    return { data: null, error: failedReading.error, partialReads: [] };
  }

  // SFH-C4-01: one exchange account, one reading. Keys that read the same
  // account (the D-09 identity) are grouped; only the keys holding the
  // group's newest reading day, with rows on it, contribute.
  const identity = accountIdentityTokens(
    keys.map((k) => ({
      id: k.id,
      exchange: typeof k.exchange === "string" ? k.exchange : "",
      venue_account_id: k.venue_account_id ?? null,
      account_share_kind: k.account_share_kind ?? null,
      account_shared_with_api_key_id: k.account_shared_with_api_key_id ?? null,
      disconnected_at: null,
      sync_status: null,
      history_inclusion: null,
      first_returns_day: null,
      last_returns_day: null,
    })),
  );
  const accountOf = (keyId: string): string =>
    identity.get(keyId) ?? `key:${keyId}`;
  const newestByAccount = new Map<string, string>();
  keys.forEach((key, i) => {
    const reading = readings[i].reading;
    if (reading === null) return;
    const account = accountOf(key.id);
    const current = newestByAccount.get(account);
    if (current === undefined || reading.day > current) {
      newestByAccount.set(account, reading.day);
    }
  });
  const toRead: Array<{ keyId: string; asof: string }> = [];
  const partialReads: PartialRead[] = [];
  keys.forEach((key, i) => {
    const reading = readings[i].reading;
    if (
      reading !== null &&
      reading.hasRows &&
      reading.day === newestByAccount.get(accountOf(key.id))
    ) {
      toRead.push({ keyId: key.id, asof: reading.day });
      // WR-R2-03: the rows at this day were written by a poll that could
      // not read the key's open positions.
      if (readings[i].partialDay === reading.day) {
        partialReads.push({ api_key_id: key.id, asof: reading.day });
      }
    }
  });

  // Step 3: the contributing keys' rows at their reading day.
  const perKey = await Promise.all(
    toRead.map(
      async ({ keyId, asof }): Promise<{ rows: unknown[]; error: ReadError | null }> => {
        const rowsRes = await supabase
          .from("allocator_holdings")
          .select(columns)
          .eq("allocator_id", userId)
          .eq("api_key_id", keyId)
          .eq("asof", asof)
          .limit(HOLDINGS_ROW_CAP);
        if (rowsRes.error) return { rows: [], error: rowsRes.error };
        const rows = (rowsRes.data ?? []) as unknown[];
        if (rows.length >= HOLDINGS_ROW_CAP) {
          return {
            rows: [],
            error: {
              message: "allocator_holdings per-key read reached the row cap",
            },
          };
        }
        return { rows, error: null };
      },
    ),
  );

  const failed = perKey.find((k) => k.error !== null);
  if (failed) return { data: null, error: failed.error, partialReads: [] };
  return { data: perKey.flatMap((k) => k.rows), error: null, partialReads };
}
