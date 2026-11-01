/**
 * Phase 167.1.2 plan 04 (D-01, D-11) — the ONE source of the duplicate-key
 * sentence both key cards show (AllocatorExchangeManager, ApiKeyManager).
 *
 * The daily poll's identity stamper marks a key `account_share_kind =
 * 'duplicate'` when it reads the same exchange account as a live key of the
 * same owner (`account_shared_with_api_key_id`, the holder). Nothing is ever
 * disconnected or deleted for it (D-01): the card names the holder and says we
 * count that account once, because one exchange account behind several logins
 * is intended (Phase 183 D-02).
 *
 * Reader rule, D-18 (founder, 2026-09-27), stated in COMMENT ON COLUMN
 * api_keys.account_share_kind (migration 20260927180000): a marked key reads
 * through its holder only while the holder is WORKING, i.e. `is_active` is
 * true, `disconnected_at` is null and `sync_status` is null or not one of
 * 'revoked', 'sign_in_failed', 'error'. A NULL `sync_status` (a key that has
 * not synced yet) counts as working, as in the allocator's eligible-key
 * predicate. The marker is not cleared when the holder departs or starts
 * failing, so once the holder is inactive or failing the marked key counts on
 * its own and the note says nothing: the account is counted by the healthy
 * key instead of by nobody. This function and the KEY_NOT_DEPARTED test in
 * set_departed_key_history_inclusion move together.
 *
 * `'composite_member'` (D-04, a key rotation inside one composite strategy) is
 * legitimate and shows nothing.
 *
 * The note shows the holder's own label (exchange and nickname, or a masked id
 * tail), never an account id and never a user id (T-167.1.2-17).
 *
 * Phase 183 D-02 — what the note says, and when it says nothing:
 *   - The note states a fact and names no control, so 167.1.2 REVIEW WR-01's
 *     per-card verb is retired with the remedy. The founder's reason: one
 *     account behind several logins is intended, so telling the owner to
 *     remove a key is wrong.
 *   - It shows only where the derive's account-group resolution counts the
 *     pair once: both keys work (D-18), a working key is always eligible, and
 *     the marker puts the two in one group, of which exactly one key is
 *     counted. So the sentence is true wherever it renders, on the strategy
 *     key card as well as the Exchanges page: every owner's keys are composed
 *     into that owner's book nightly whatever the owner's role, and no
 *     strategy sums the pair.
 *   - WR-02 is kept (D-18 applied to the MARKED key): a marked key that is
 *     disconnected, inactive or failing shows its own status, not this note.
 *   - SF-L1 is kept: a holder absent from the caller's key list cannot be
 *     judged working, so the note says nothing.
 *   - The Overview's rebuilding-panel line for two keys on one account is a
 *     different sentence, for a real double count, and is not this note
 *     (D-03 leaves it as is).
 */

import { dataSourceLabel } from "@/lib/api-key-label";

/** The fields of a key row the note reads. Every one is in API_KEY_USER_COLUMNS. */
export interface AccountShareNoteKey {
  id: string;
  exchange: string;
  label: string;
  is_active: boolean;
  sync_status: string | null;
  disconnected_at: string | null;
  account_shared_with_api_key_id: string | null;
  account_share_kind: string | null;
}

/**
 * Last-sync statuses that make a holder NOT working (D-18). The SQL twin is the
 * `v_sync_status NOT IN (...)` tuple in set_departed_key_history_inclusion
 * (migration 20260927180000); account-share-note.test.ts reads that tuple out
 * of the migration and the function snapshot and asserts they equal this set.
 */
export const NOT_WORKING_SYNC_STATUSES: ReadonlySet<string> = new Set([
  "revoked",
  "sign_in_failed",
  "error",
]);

/** The reader rule's "working holder" (see the module docstring). */
export function isWorkingHolder(
  holder: Pick<AccountShareNoteKey, "is_active" | "disconnected_at" | "sync_status">,
): boolean {
  return (
    holder.is_active === true &&
    holder.disconnected_at === null &&
    (holder.sync_status === null || !NOT_WORKING_SYNC_STATUSES.has(holder.sync_status))
  );
}

function holderLabel(holder: AccountShareNoteKey): string {
  const { exchange, nickname, maskedTail } = dataSourceLabel(holder);
  return `${exchange} — ${nickname ?? maskedTail}`;
}

/**
 * The duplicate sentence for `key`, or `null` when there is nothing to say:
 * the key is unmarked or marked `composite_member`, the key itself is not
 * working, its holder is not in `keysById`, or its holder is not working.
 * `keysById` is the caller's own key list, keyed by id.
 */
export function accountShareNote(
  key: AccountShareNoteKey,
  keysById: ReadonlyMap<string, AccountShareNoteKey>,
): string | null {
  const holderId = key.account_shared_with_api_key_id;
  if (key.account_share_kind !== "duplicate" || holderId === null) return null;
  if (!isWorkingHolder(key)) return null;
  const holder = keysById.get(holderId);
  if (holder === undefined || !isWorkingHolder(holder)) return null;
  return `This key reads the same exchange account as ${holderLabel(holder)}. We count that account once.`;
}
