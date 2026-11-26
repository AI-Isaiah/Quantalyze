import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { RotateSecretResponseSchema } from "@/lib/analytics-schemas";
import { pgConstraintName, VENUE_IDENTITY_CONSTRAINT } from "@/lib/api/pgConstraintName";
import { logAuditEvent } from "@/lib/audit";
import { isLiveKey } from "@/lib/departed-history";
import { pickSameAccountHolder, readLiveSameLoginKeys } from "@/lib/venue-identity";

/**
 * Phase 228 (CONN-02) — the ONE owner-scoped write of a rotated MT5 secret,
 * shared by `PATCH /api/keys/[id]/rotate-secret` and the MT5 same-account arm
 * of `POST /api/strategies/create-with-key` (TWIN-8 one-builder rule). Moved
 * unchanged in effect from the rotate-secret route's persist arm.
 *
 * It takes the admin client (D-07: `api_keys` UPDATE is fully REVOKEd from
 * `authenticated`, so a user-scoped `.update()` would 42501) and returns a
 * typed result, never a response: each caller maps the result to its own
 * literals. It logs nothing and captures nothing; errors are returned and the
 * caller scrubs them with its own per-request secrets (the `swapAccountSlot`
 * posture).
 *
 * ⛔ The UPDATE is filtered on `id` + `user_id` + `exchange = 'mt5'`. The admin
 * client crosses RLS, so the explicit `user_id` filter is the tenant boundary;
 * every caller has ALSO proven ownership with its own owner-scoped read first.
 *
 * Known limit (recorded, not fixed here; Phase 228 CONTEXT): the write sets
 * `sync_status: 'idle'` and `sync_error: null` unconditionally, with no
 * compare-and-set. A sync that started with the OLD password can still mark the
 * key failed after this write lands; the next sync clears it. Guarding that
 * needs the poll writers, which this module does not own.
 */
export type PersistRotatedSecretResult =
  | { kind: "ok" }
  | { kind: "venue_collision" }
  | { kind: "holder_read_failed"; error: unknown }
  | { kind: "write_failed"; error: unknown }
  | { kind: "write_zero_rows" };

export async function persistRotatedMt5Secret(args: {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  userId: string;
  keyId: string;
  keyRow: {
    venue_account_id: string | null;
    is_active: boolean;
    disconnected_at: string | null;
  };
  parsed: z.infer<typeof RotateSecretResponseSchema>;
}): Promise<PersistRotatedSecretResult> {
  const { admin, supabase, userId, keyId, keyRow, parsed } = args;

  // CR-01 (164.5.3 review) — D-07's own precedent, `reconnect_allocator_api_key`
  // (20260422101911), clears THREE fields on a validated success, not two:
  // `disconnected_at`, `sync_error`, AND `sync_status = 'idle'` — "so the next
  // tick picks the key up fresh". The allocator worker's failure arm writes
  // `sync_status` to `'revoked'` or `'error'` (`_map_exception_to_sync_status`)
  // and NEVER writes it back; both ledger-refresh enqueuers carry
  // `sync_status IS DISTINCT FROM 'revoked'` as an eligibility predicate, so a
  // `'revoked'` key stayed excluded from the automated fan-out FOREVER even
  // after its password was corrected. `sync_status: "idle"` is written
  // unconditionally alongside the clear below so the two facts ("the credential
  // is right" / "the key is eligible again") cannot separate.
  //
  // ⛔ NOT restoring `is_active`, and NOT clearing `disconnected_at` (WR-03) —
  // both DELIBERATE, decided from the code rather than assumed:
  //
  //   `is_active` — `cron.py`'s ONLY writer of `is_active: false` is
  //   `cron_sync`'s credential-failure branch, reached through
  //   `_sync_single_key`, which takes the non-ccxt "deferred" branch for
  //   `exchange='mt5'` BEFORE ever calling `validate_key_permissions`.
  //   `is_active` is therefore never false for an MT5 row on any measured code
  //   path, so restoring it here would be speculative code for a state that
  //   cannot occur.
  //
  //   `disconnected_at` — the ONLY writer is the `disconnect_allocator_api_key`
  //   RPC, called from the user-initiated Disconnect button. Every
  //   `disconnected_at` is a deliberate user action, so clearing it here would
  //   silently reconnect a key the owner parked on purpose (WR-03). The separate
  //   Reconnect affordance clears all three fields together.
  //
  // `history_inclusion` (167.1.2 C4 review CR-01) — reset to NULL ONLY when
  // this write returns the key to live. The write sets `sync_status = 'idle'`
  // and touches neither `disconnected_at` nor `is_active`, so the key is live
  // afterwards exactly when `isLiveKey` (src/lib/departed-history.ts, the same
  // predicate the key card and the derive job read) holds for the pre-read's
  // `is_active` and `disconnected_at` with `sync_status` 'idle'. A DISCONNECTED
  // or inactive key stays departed, so the owner's include/exclude choice for
  // it still applies and is kept.
  //
  // Known limits, recorded rather than fixed here: (1) no recompose is enqueued
  // for a revoked key whose non-NULL choice this resets; the next derive for
  // this owner composes it as live. (2) The liveness fields are read BEFORE the
  // broker probe, so a Disconnect that lands during the probe is not seen: the
  // reset follows the pre-read state.
  const returnsKeyToLive = isLiveKey({
    is_active: keyRow.is_active,
    sync_status: "idle",
    disconnected_at: keyRow.disconnected_at,
  });
  const attemptPersist = (includeVenueAccountId: boolean) =>
    admin
      .from("api_keys")
      .update({
        api_key_encrypted: parsed.api_key_encrypted,
        api_secret_encrypted: parsed.api_secret_encrypted,
        passphrase_encrypted: parsed.passphrase_encrypted,
        dek_encrypted: parsed.dek_encrypted,
        nonce: parsed.nonce,
        kek_version: parsed.kek_version,
        sync_error: null,
        sync_status: "idle",
        // Phase 167.1.2 plan 09 (PR B review round 2, RLS audit MEDIUM): this
        // update is how a REVOKED key returns to live, and it does not go
        // through reconnect_allocator_api_key. COMMENT ON COLUMN
        // api_keys.history_inclusion binds every such path: a departed-history
        // choice made for one departure never carries over to the next. Only
        // on that path: see `returnsKeyToLive` above (C4 review CR-01).
        ...(returnsKeyToLive ? { history_inclusion: null } : {}),
        // Backfill ONLY when the pre-read row had no identifier yet — never
        // overwrite an existing value. It is, by construction, the same login:
        // D-03 forbids changing it, and the Python seam validates against the
        // row's OWN stored login.
        ...(includeVenueAccountId ? { venue_account_id: parsed.venue_account_id } : {}),
      })
      .eq("id", keyId)
      .eq("user_id", userId)
      .eq("exchange", "mt5")
      .select("id");

  let shouldBackfillVenueAccountId = keyRow.venue_account_id === null;
  // Phase 225 (CONN-03, RESEARCH W4): the login backfill used to lean on the
  // login-only unique index's 23505 to refuse a second slot holder. Once the
  // server-aware index ships that index stops firing against a server-stamped
  // holder, and this write carries no server, so the index would admit a second
  // holder beside it. The fence lives here: when another live key of the SAME
  // owner already reads this login on any server (a null server is the
  // wildcard, Q2), the login is not backfilled and the password is saved
  // without it. A read error FAILS CLOSED (225 PR-2 review SF-M1 / IN-11): it is
  // returned before the write, because a read fault would admit a second
  // holder. The 23505 retry below stays for the race.
  if (shouldBackfillVenueAccountId) {
    const { rows, error: holderReadError } = await readLiveSameLoginKeys(admin, {
      userId,
      exchange: "mt5",
      venueAccountId: parsed.venue_account_id,
    });
    if (holderReadError) {
      return { kind: "holder_read_failed", error: holderReadError };
    }
    if (pickSameAccountHolder(rows, null, "fence") !== null) {
      shouldBackfillVenueAccountId = false;
    }
  }
  let { data: updatedRows, error: updateErr } = await attemptPersist(
    shouldBackfillVenueAccountId,
  );

  // WR-02 (164.5.3 review) — a venue-identity 23505 used to discard the WHOLE
  // correction, including the sync_error / sync_status clear. Two legacy MT5
  // rows sharing one account reach this on the backfill alone. Re-issue the
  // SAME statement WITHOUT `venue_account_id` on that one condition — the
  // password fix and the status clear still land. Only a SECOND collision (or
  // any other error) reaches the arms below.
  if (
    shouldBackfillVenueAccountId &&
    updateErr &&
    updateErr.code === "23505" &&
    pgConstraintName(updateErr) === VENUE_IDENTITY_CONSTRAINT
  ) {
    ({ data: updatedRows, error: updateErr } = await attemptPersist(false));
  }

  if (updateErr) {
    // Pitfall 1 — the venue-identity backfill collides with a DIFFERENT live
    // row for the same account, and the retry above either did not apply or
    // collided again.
    if (
      updateErr.code === "23505" &&
      pgConstraintName(updateErr) === VENUE_IDENTITY_CONSTRAINT
    ) {
      return { kind: "venue_collision" };
    }
    return { kind: "write_failed", error: updateErr };
  }
  if (!updatedRows || updatedRows.length === 0) {
    // The row vanished (or changed venue) between the ownership read and the
    // write — a genuine TOCTOU; the write's outcome cannot be verified.
    return { kind: "write_zero_rows" };
  }

  logAuditEvent(supabase, {
    action: "api_key.rotate_secret",
    entity_type: "api_key",
    entity_id: keyId,
  });

  return { kind: "ok" };
}
