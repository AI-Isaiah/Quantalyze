/**
 * Phase 167.1.2 plan 04 (D-01, D-11) — the ONE source of the duplicate-key
 * sentence both key cards show (AllocatorExchangeManager, ApiKeyManager).
 *
 * The daily poll's identity stamper marks a key `account_share_kind =
 * 'duplicate'` when it reads the same exchange account as a live key of the
 * same owner (`account_shared_with_api_key_id`, the holder). Nothing is ever
 * disconnected or deleted for it (D-01): the card names the holder and points
 * at the Disconnect / Delete controls that already sit beside the note.
 *
 * Reader rule, from COMMENT ON COLUMN api_keys.account_share_kind (migration
 * 20260925120000): a marked key reads through its holder only while the
 * holder is WORKING, `disconnected_at IS NULL AND sync_status <> 'revoked'`.
 * The marker is not cleared when the holder departs, so once the holder has
 * been disconnected or revoked the marked key counts on its own and the note
 * says nothing. A NULL `sync_status` counts as working, as in the Python
 * reader `_counted_through_holder` (equity_reconstruction.py), so the two
 * surfaces agree on the same row. ⚠️ That definition of "working" is
 * PROVISIONAL in the COMMENT: a founder decision on it is still owed, and this
 * function, `_counted_through_holder` and the derive gate move together.
 *
 * `'composite_member'` (D-04, a key rotation inside one composite strategy) is
 * legitimate and shows nothing.
 *
 * The note shows the holder's own label (exchange and nickname, or a masked id
 * tail), never an account id and never a user id (T-167.1.2-17).
 */

import { dataSourceLabel } from "@/lib/api-key-label";

/** The fields of a key row the note reads. Every one is in API_KEY_USER_COLUMNS. */
export interface AccountShareNoteKey {
  id: string;
  exchange: string;
  label: string;
  sync_status: string | null;
  disconnected_at: string | null;
  account_shared_with_api_key_id: string | null;
  account_share_kind: string | null;
}

/** Named in the note when the holder row is not in the caller's key list. */
export const ACCOUNT_SHARE_HOLDER_FALLBACK_LABEL = "another of your keys";

/** The reader rule's "working holder" (see the module docstring). */
export function isWorkingHolder(
  holder: Pick<AccountShareNoteKey, "disconnected_at" | "sync_status">,
): boolean {
  return holder.disconnected_at === null && holder.sync_status !== "revoked";
}

function holderLabel(holder: AccountShareNoteKey): string {
  const { exchange, nickname, maskedTail } = dataSourceLabel(holder);
  return `${exchange} — ${nickname ?? maskedTail}`;
}

/**
 * The duplicate sentence for `key`, or `null` when there is nothing to say:
 * the key is unmarked, marked `composite_member`, or its holder is no longer
 * working. `keysById` is the caller's own key list, keyed by id.
 */
export function accountShareNote(
  key: AccountShareNoteKey,
  keysById: ReadonlyMap<string, AccountShareNoteKey>,
): string | null {
  const holderId = key.account_shared_with_api_key_id;
  if (key.account_share_kind !== "duplicate" || holderId === null) return null;
  const holder = keysById.get(holderId);
  if (holder !== undefined && !isWorkingHolder(holder)) return null;
  const label =
    holder === undefined ? ACCOUNT_SHARE_HOLDER_FALLBACK_LABEL : holderLabel(holder);
  return `This key reads the same exchange account as ${label}. Disconnect one of them.`;
}
