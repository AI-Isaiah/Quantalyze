"use client";

/**
 * Allocator-facing exchange connection manager.
 *
 * Lists the allocator's connected read-only exchange API keys, shows sync
 * status via AllocatorSyncStatus (7-state pill + helper line), and lets
 * them add new ones. Wires:
 *
 *   - Real "Sync now" button that POSTs to /api/allocator/holdings/sync
 *     (INGEST-06 / D-10) with optimistic sync_status='syncing' and
 *     graceful 4xx / 5xx / network-error surfacing via the row-scoped
 *     aria-live helper line.
 *   - AWAITED first-run sync inside handleAddKey (INGEST-07 / D-09 / f4):
 *     once the server-written row is read back (160-03), the client awaits the POST so
 *     a 403/500 surfaces in the row's helper line — NOT a silent stuck
 *     "Syncing…" pill. On failure, pill reverts to 'idle' and
 *     helper_override is set to "Sync request failed — click Sync now
 *     to retry".
 *   - f8: on 200 already_inflight responses, next_attempt_at is captured
 *     into row state and surfaces via AllocatorSyncStatus's Queued helper
 *     when the cooldown is ≥30s out. This covers the per-exchange
 *     circuit-breaker contagion from strategy-side 429s.
 *   - 5s router.refresh() polling loop (D-11) active only while any row
 *     is syncing; cleared on unmount.
 *   - Landmine 8: useEffect(() => setKeys(...), [initialKeys]) MERGE
 *     effect syncs server-refreshed rows into local state while preserving
 *     client-only fields (queued_next_attempt_at, helper_override).
 */

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ApiKeyForm } from "@/components/strategy/ApiKeyForm";
import { UpdateMt5SecretDialog } from "@/components/strategy/UpdateMt5SecretDialog";
import { createClient } from "@/lib/supabase/client";
import { API_KEY_USER_COLUMNS } from "@/lib/constants";
import { computeRetryAtSeconds } from "@/lib/allocator-cooldowns";
import { AllocatorSyncStatus } from "./AllocatorSyncStatus";

interface ExchangeConnection {
  id: string;
  exchange: string;
  label: string;
  is_active: boolean;
  // Nullable to match the DB column (api_keys.sync_status is nullable —
  // rows freshly inserted before the first sync tick have null).
  sync_status: string | null;
  last_sync_at: string | null;
  account_balance_usdt: number | null;
  created_at: string;
  // Landmine 3: sync_error surfaces under the pill in the aria-live helper
  // line for `error` / `complete_with_warnings` states.
  sync_error: string | null;
  // ISSUE-006 / migration 068: last_429_at is stamped by the Python worker
  // on ccxt 429s. Used to compute the `rate_limited` pill's retry-in-Ns
  // countdown via EXCHANGE_COOLDOWN_SECONDS (client-side mirror of the
  // Python EXCHANGE_COOLDOWNS map in job_worker.py).
  last_429_at: string | null;
  // Migration 075: soft-disconnect timestamp. NULL = connected (renders in
  // the main list with Sync now + Disconnect). Non-null = disconnected
  // (renders in the "Disconnected keys" section with a Reconnect button;
  // workers skip the key on the next cron tick).
  disconnected_at: string | null;
  // Migration 20260920120000 (Phase 164.5.3 / MT5CREDS), exposing the
  // column added by migration 20260812083206 (Phase 154/WIZCONT-02). The
  // non-secret MT5 account identity the credential in this row was
  // connected with; NULL for every ccxt venue. Rendered in both the active
  // and disconnected sections for exchange === "mt5" only.
  venue_account_id: string | null;
  // f8 (client-only — NOT persisted to DB): captured from the sync route's
  // `already_inflight` response. When syncing AND ≥30s out, the pill renders
  // the Queued helper via AllocatorSyncStatus.
  queued_next_attempt_at: string | null;
  // f4 (client-only — NOT persisted to DB): explicit helper-line override.
  // Populated on handleAddKey / handleSync failure paths. Passed through to
  // AllocatorSyncStatus.helperOverride so it takes precedence over computed
  // helper text.
  helper_override: string | null;
  // NEW-C29-02 (client-only — NOT persisted to DB): true for rows optimistically
  // inserted before the DB replica confirms them. The merge effect retains rows
  // with this flag until their id appears in the server snapshot, preventing
  // a router.refresh() that resolves before replica propagation from dropping
  // the row from local state.
  pending_insert?: boolean;
  // Phase 164.9.1 round-2 review (R2-3), client-only: true only while
  // handleReconnect is running for this row. Set in its optimistic update and
  // cleared in its `finally`, so it records a reconnect this tab started rather
  // than guessing one from `syncing` + a null disconnected_at, a guess that also
  // matched a row disconnected from elsewhere and held it active for good.
  reconnect_in_flight?: boolean;
}

/**
 * `initialKeys` may arrive from the server-side `getUserApiKeys` query
 * which (pre Plan 01) projects columns without sync_error. Accept a wider
 * input shape and default missing client-only fields in the merge effect.
 */
type InitialKey = Omit<
  ExchangeConnection,
  | "sync_error"
  | "last_429_at"
  | "disconnected_at"
  | "venue_account_id"
  | "queued_next_attempt_at"
  | "helper_override"
> & {
  sync_error?: string | null;
  last_429_at?: string | null;
  disconnected_at?: string | null;
  venue_account_id?: string | null;
};

interface Props {
  initialKeys: InitialKey[];
  // DOGFOOD-2: true when the allocator has at least one row in
  // allocator_holdings. The connected-case affirmative subtitle must not
  // assert an active allocation that holdings can't back — the per-key
  // account_balance_usdt is real and still renders, but the subtitle is gated
  // on holdings presence. This is a page-load-time signal (server-derived in
  // profile/page.tsx); it does not need to live-update with the 5s sync poll —
  // router.refresh() re-reads it.
  //
  // DOGFOOD-2 fail-loud (Phase 110.1 FIX 2): tri-state. `true` = holdings
  // present; `false` = confirmed zero holdings; `null` = the head-count
  // FAILED (transient RLS/network). On `null` the subtitle must NOT assert
  // "no open positions yet" — that affirmative-negative would falsely claim a
  // flat book when the count simply errored. Show a neutral "connected"
  // subtitle instead (mirror of the H-0499 no-affirmative-on-error rule).
  hasHoldings: boolean | null;
}

// Exchange tag: 3-letter code, tier-colored. No emoji in the UI per
// DESIGN.md. Colors pull from the app's accent + neutral palette.
const EXCHANGE_TAGS: Record<
  string,
  { label: string; bg: string; fg: string }
> = {
  binance: { label: "BNB", bg: "#FEF3C7", fg: "#92400E" },
  okx: { label: "OKX", bg: "#1F2937", fg: "#F9FAFB" },
  bybit: { label: "BYB", bg: "#FFE4D6", fg: "#C2410C" },
  kraken: { label: "KRK", bg: "#EDE9FE", fg: "#5B21B6" },
  deribit: { label: "DRB", bg: "#DBEAFE", fg: "#1E3A8A" },
  coinbase: { label: "CBS", bg: "#DBEAFE", fg: "#1D4ED8" },
  // SFOX-09: sfox has no bright brand colour — a neutral slate pairing
  // (slate-100 bg / near-black navy fg, well past WCAG AA at ~17:1), distinct
  // from every entry above. Ships UNCONDITIONALLY, independent of the SFOX-08
  // offer flag: a founder-connected sfox key must render before the flag flips.
  sfox: { label: "SFOX", bg: "#F1F5F9", fg: "#0F172A" },
  // 138-03 (MT5UI-02): mt5 has no bright brand colour — REUSE the sfox neutral
  // slate pairing verbatim (slate-100 bg / near-black navy fg, well past WCAG AA;
  // NO new hex this phase per UI-SPEC constraint 3). Same SFOX-09 rationale:
  // ships UNCONDITIONALLY, independent of the go-live offer flag, so a
  // founder-connected mt5 key renders the real mono tag before the flag flips.
  // This is a provenance surface (the user's OWN key), not an offer surface.
  mt5: { label: "MT5", bg: "#F1F5F9", fg: "#0F172A" },
};

function formatRelative(iso: string | null): string {
  if (!iso) return "Never synced";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "Never synced";
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

const SYNC_FAILED_HELPER =
  "Sync request failed — click Sync now to retry";

// Phase 164.9.1 round-1 review (silent-failure-hunter HIGH-1). The sync route
// answers 409 when the key is disconnected (the RPC's P0001
// api_key_disconnected). Retrying cannot succeed, so SYNC_FAILED_HELPER's
// "click Sync now to retry" would loop the user forever. The route's own
// sentence is shown when it sent one; this is the fallback with the same
// meaning.
const SYNC_DISCONNECTED_HELPER =
  "This API key is disconnected. Reconnect it before syncing holdings.";

function disconnectedRefusalMessage(body: unknown): string {
  const error =
    body !== null && typeof body === "object"
      ? (body as { error?: unknown }).error
      : undefined;
  return typeof error === "string" && error.length > 0
    ? error
    : SYNC_DISCONNECTED_HELPER;
}

// Phase 164.9.1 round-1 review (silent-failure-hunter LOW-1). An
// `already_inflight` answer leaves api_keys.sync_status as it was (migration
// 067's shape: the RPC reports the queued job, it does not restate the key's
// status). So the next 5s refresh used to hand back the stored `idle` or
// `complete`, the pill left "Syncing…" and the "Queued — retry in Ns" helper
// vanished while the job was still queued. The hold below keeps the optimistic
// `syncing` until the queued job has had its turn: it ends when the server
// reports anything other than idle/complete (an error surfaces at once), when
// last_sync_at moves (the job ran), or QUEUED_HOLD_GRACE_MS after the job's
// next_attempt_at, whichever comes first. The RPC was not changed to write
// `syncing` on that path: a job that finishes between the look-up and such a
// write would leave the key stuck at `syncing`, which disables Sync now.
const QUEUED_HOLD_GRACE_MS = 120_000;

function isQueuedHold(k: InitialKey, prev?: ExchangeConnection): boolean {
  if (prev === undefined || prev.sync_status !== "syncing") return false;
  // Round-2 review (R2-3): a disconnected key runs no queued job, so there is
  // nothing to wait for, and holding `syncing` would disable its Reconnect.
  if (k.disconnected_at != null) return false;
  if (prev.queued_next_attempt_at === null) return false;
  const queuedAt = Date.parse(prev.queued_next_attempt_at);
  if (!Number.isFinite(queuedAt)) return false;
  if (Date.now() >= queuedAt + QUEUED_HOLD_GRACE_MS) return false;
  const server = k.sync_status ?? "idle";
  if (server !== "idle" && server !== "complete") return false;
  return k.last_sync_at === prev.last_sync_at;
}

function normalizeInitialKey(
  k: InitialKey,
  prev?: ExchangeConnection,
): ExchangeConnection {
  // M1 (red-team): while this tab's own reconnect is running (the optimistic
  // update set disconnected_at=null + sync_status="syncing"), do NOT let a
  // server snapshot taken before the reconnect RPC committed overwrite it with
  // the old non-null timestamp; keep local null so the row stays in the active
  // list. Round-2 review (R2-3): the guard keys on the explicit
  // `reconnect_in_flight` flag, which handleReconnect clears on every exit.
  // It used to be inferred from `syncing` + a null disconnected_at, which also
  // matched a row disconnected in another tab during a sync or a queued hold,
  // and then kept that row active and "Syncing…" until the page was reloaded.
  const isReconnectInFlight =
    prev?.reconnect_in_flight === true && k.disconnected_at != null;
  const disconnectedAt = isReconnectInFlight
    ? null
    : (k.disconnected_at ?? null);
  // Round-2 review (R2-1, R2-2): the client-only helper and queued timestamp
  // describe the section the row was in. When a refresh moves the row between
  // the active and the Disconnected lists (a disconnect or a reconnect made
  // elsewhere), drop them: an active row's "click Sync now to retry" is wrong
  // under a row with no Sync now button, and a 409's "Reconnect it" is wrong on
  // a row that is connected again. Overrides set together with their section
  // (the 409 path, "Reconnect failed") stay, because the row does not move.
  const changedSection =
    prev !== undefined && (prev.disconnected_at === null) !== (disconnectedAt === null);

  return {
    id: k.id,
    exchange: k.exchange,
    label: k.label,
    is_active: k.is_active,
    // When a reconnect is in-flight, preserve the optimistic sync_status
    // ("syncing") rather than reverting to the stale server value.
    sync_status:
      isReconnectInFlight || isQueuedHold(k, prev)
        ? prev!.sync_status
        : k.sync_status,
    last_sync_at: k.last_sync_at,
    account_balance_usdt: k.account_balance_usdt,
    created_at: k.created_at,
    sync_error: k.sync_error ?? null,
    last_429_at: k.last_429_at ?? null,
    // M1: preserve local null (reconnect in-flight) against stale server snapshot.
    disconnected_at: disconnectedAt,
    venue_account_id: k.venue_account_id ?? null,
    // Landmine 8 + f8/f4 preservation: client-only fields carry over across
    // router.refresh() server-state cycles when the row id matches, unless the
    // row changed section (R2-1, R2-2 above).
    queued_next_attempt_at: changedSection
      ? null
      : (prev?.queued_next_attempt_at ?? null),
    helper_override: changedSection ? null : (prev?.helper_override ?? null),
    reconnect_in_flight: prev?.reconnect_in_flight === true,
    // NEW-C29-02: a row that arrives in the server snapshot is no longer pending.
    // pending_insert is cleared when the server confirms the id (this call
    // happens when the row appears in initialKeys).
    pending_insert: false,
  };
}

export function AllocatorExchangeManager({ initialKeys, hasHoldings }: Props) {
  const router = useRouter();
  const [keys, setKeys] = useState<ExchangeConnection[]>(() =>
    initialKeys.map((k) => normalizeInitialKey(k)),
  );
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteHoldingsCount, setDeleteHoldingsCount] = useState<number | null>(
    null,
  );
  const [cascadeHoldings, setCascadeHoldings] = useState(false);
  // Phase 164.5.3 / MT5CREDS Plan 05 — the id of the MT5 key whose password
  // is being corrected. Shared dialog with ApiKeyManager (cross-directory
  // import is fine — the dialog belongs to neither card exclusively).
  // Distinct from Reconnect: this credential is WRONG and needs
  // re-validation, not a retry of the stored one.
  const [updatingKeyId, setUpdatingKeyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const supabase = createClient();

  async function openDeleteConfirm(keyId: string) {
    setDeleteError(null);
    setCascadeHoldings(false);
    setDeleteHoldingsCount(null);
    setConfirmDeleteId(keyId);
    // Fetch holdings count so the modal can prompt before submit. RLS
    // grants owners SELECT on allocator_holdings (migration 066 STEP 3).
    const { count, error } = await supabase
      .from("allocator_holdings")
      .select("*", { count: "exact", head: true })
      .eq("api_key_id", keyId);
    if (error) {
      setDeleteError(`Could not check holdings: ${error.message}`);
      setDeleteHoldingsCount(0);
      return;
    }
    setDeleteHoldingsCount(count ?? 0);
  }

  async function handleDeleteKey(keyId: string) {
    setDeleteLoading(true);
    setDeleteError(null);

    // Split by user intent: "delete N holdings" checkbox gates hard-delete.
    // Unchecked → migration 075 soft-disconnect (key + holdings preserved,
    // worker crons skip, UI renders Reconnect).
    // Checked → migration 069 cascade-delete (key + holdings wiped).
    if (cascadeHoldings) {
      const { error } = await supabase.rpc("delete_allocator_api_key", {
        p_api_key_id: keyId,
        p_cascade_holdings: true,
      });
      setDeleteLoading(false);
      if (error) {
        setDeleteError("Could not disconnect this key. Please try again.");
        return;
      }
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } else {
      const { error } = await supabase.rpc("disconnect_allocator_api_key", {
        p_api_key_id: keyId,
      });
      setDeleteLoading(false);
      if (error) {
        setDeleteError("Could not disconnect this key. Please try again.");
        return;
      }
      // Stamp locally so the row re-renders in the Disconnected section
      // without waiting for router.refresh() to round-trip. Server truth
      // wins on the next merge via prevInitialKeys.
      // Round-2 review (R2-1, R2-3): the row leaves the active list, so the
      // active row's client-only state goes with it. A kept "Sync request
      // failed — click Sync now to retry" would show under a row with no Sync
      // now button, and a kept optimistic `syncing` (a queued hold) would show
      // Reconnect disabled as "Reconnect in progress".
      const nowIso = new Date().toISOString();
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId
            ? {
                ...k,
                disconnected_at: nowIso,
                sync_status: "idle",
                queued_next_attempt_at: null,
                helper_override: null,
                reconnect_in_flight: false,
              }
            : k,
        ),
      );
    }

    setConfirmDeleteId(null);
    setDeleteHoldingsCount(null);
    setCascadeHoldings(false);
    startTransition(() => router.refresh());
  }

  // A 409 from the sync route means the key is disconnected on the server,
  // whatever this tab believed. Move the row to the Disconnected section, where
  // its Reconnect button is, and say why there. `fallbackDisconnectedAt` is the
  // timestamp to show until the next refresh brings the server's own.
  function markRefusedAsDisconnected(
    keyId: string,
    body: unknown,
    fallbackDisconnectedAt: string | null,
  ) {
    const message = disconnectedRefusalMessage(body);
    setKeys((prev) =>
      prev.map((k) =>
        k.id === keyId
          ? {
              ...k,
              sync_status: "idle",
              queued_next_attempt_at: null,
              disconnected_at:
                k.disconnected_at ??
                fallbackDisconnectedAt ??
                new Date().toISOString(),
              helper_override: message,
            }
          : k,
      ),
    );
  }

  async function handleReconnect(keyId: string) {
    // M2 (red-team): capture the original disconnected_at BEFORE the optimistic
    // update so the revert path can restore it exactly. Pre-fix: revert stamped
    // `new Date().toISOString()` — the "Disconnected Nd ago" label showed
    // "just now" even when the key had been disconnected for days.
    let originalDisconnectedAt: string | null = null;
    setKeys((prev) => {
      // Read the current value while atomically applying the optimistic update.
      // Optimistic: clear disconnected_at + flip to syncing so the pill
      // renders immediately. Server reset of sync_error + sync_status='idle'
      // lands via the reconnect RPC; the subsequent sync POST (mirrors
      // handleAddKey) flips sync_status to 'syncing' on the server.
      return prev.map((k) => {
        if (k.id === keyId) {
          originalDisconnectedAt = k.disconnected_at;
          return {
            ...k,
            disconnected_at: null,
            sync_status: "syncing",
            sync_error: null,
            helper_override: null,
            reconnect_in_flight: true,
          };
        }
        return k;
      });
    });

    // Round-2 review (R2-3): `finally` ends the in-flight guard on every exit
    // (success, the RPC-failure revert, a 409, a failed or thrown sync POST),
    // so a later server snapshot, a disconnect made elsewhere included, is
    // believed again. A snapshot taken before the RPC committed and arriving
    // after this returns is corrected by the next 5s poll.
    try {
      const { error: rpcErr } = await supabase.rpc(
        "reconnect_allocator_api_key",
        { p_api_key_id: keyId },
      );
      if (rpcErr) {
        // SF-F3: log the RPC error before reverting so operators can see
        // whether this is a permissions failure, network blip, deleted row,
        // or constraint violation — previously rpcErr was silently absorbed
        // with only a generic UI string, leaving no operator signal.
        console.error("[AllocatorExchangeManager] handleReconnect RPC failed:", {
          keyId,
          code: rpcErr.code,
          message: rpcErr.message,
          hint: rpcErr.hint,
        });
        // Revert on failure — restore the original disconnected_at so the
        // "Disconnected Nd ago" label stays accurate (M2 fix).
        setKeys((prev) =>
          prev.map((k) =>
            k.id === keyId
              ? {
                  ...k,
                  // M2: use the captured original timestamp, not a fresh one.
                  disconnected_at:
                    originalDisconnectedAt ?? new Date().toISOString(),
                  sync_status: "idle",
                  helper_override: "Reconnect failed — try again",
                }
              : k,
          ),
        );
        return;
      }

      // Kick off an immediate sync so the user doesn't wait for tomorrow's
      // cron tick. Mirrors handleAddKey f4: 4xx/5xx surface via helper line.
      try {
        const syncRes = await fetch("/api/allocator/holdings/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key_id: keyId }),
        });
        if (syncRes.status === 409) {
          // The reconnect RPC answered OK, yet the sync says the key is still
          // (or again) disconnected. Put the row back where its Reconnect button
          // is and say so, rather than inviting a Sync now that cannot succeed.
          const body = await syncRes.json().catch(() => null);
          markRefusedAsDisconnected(keyId, body, originalDisconnectedAt);
        } else if (!syncRes.ok) {
          setKeys((prev) =>
            prev.map((k) =>
              k.id === keyId
                ? {
                    ...k,
                    sync_status: "idle",
                    helper_override: SYNC_FAILED_HELPER,
                  }
                : k,
            ),
          );
        }
      } catch (syncErr) {
        // SF-F4: log the network/fetch error so operators can distinguish a
        // transient network partition from a config regression — previously a
        // bare catch {} absorbed TypeError/DOMException with no signal.
        console.error("[AllocatorExchangeManager] handleReconnect sync POST failed:", syncErr);
        setKeys((prev) =>
          prev.map((k) =>
            k.id === keyId
              ? {
                  ...k,
                  sync_status: "idle",
                  helper_override: SYNC_FAILED_HELPER,
                }
              : k,
          ),
        );
      }

      startTransition(() => router.refresh());
    } finally {
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId && k.reconnect_in_flight
            ? { ...k, reconnect_in_flight: false }
            : k,
        ),
      );
    }
  }

  // Landmine 8: router.refresh() re-renders the server component which
  // passes new initialKeys, but useState(initialKeys) only runs on mount.
  // Merge here so server truth wins on sync_status/last_sync_at/sync_error
  // while preserving client-only queued_next_attempt_at + helper_override
  // for matching ids (f8 / f4). Done during render (not an effect) so the
  // merged state is visible on the same commit — avoids the cascading-render
  // penalty of setState-in-useEffect (react-hooks/set-state-in-effect).
  //
  // NEW-C29-02: make the merge ADDITIVE — preserve locally-inserted rows
  // flagged pending_insert=true until the server snapshot contains a row
  // with the same id. Without this, a router.refresh() that resolves
  // before the DB replica propagates the new row drops it from local state
  // (appears to vanish for 1-2s then reappears on the next 5s poll tick).
  const [prevInitialKeys, setPrevInitialKeys] = useState(initialKeys);
  if (prevInitialKeys !== initialKeys) {
    setPrevInitialKeys(initialKeys);
    setKeys((prev) => {
      const byId = new Map(prev.map((k) => [k.id, k]));
      const serverIds = new Set(initialKeys.map((k) => k.id));
      const merged = initialKeys.map((k) => normalizeInitialKey(k, byId.get(k.id)));
      // Retain any locally-inserted rows that haven't appeared on the server yet.
      // SF-F8: use === true (not truthy) so that undefined (absent field) is
      // explicitly non-matching. The cast was redundant — pending_insert is
      // already declared optional on ExchangeConnection — and masked the risk
      // that a future interface removal would silently break the merge logic
      // (undefined && ... evaluates falsy without a type error).
      const pending = prev.filter(
        (k) => k.pending_insert === true && !serverIds.has(k.id),
      );
      return [...pending, ...merged];
    });
  }

  // D-11: 5s router.refresh() polling — always-on while the tab is
  // visible, so server-side transitions into ANY non-terminal state
  // (`revoked`, `rate_limited`, `error`, `complete_with_warnings`) surface
  // without a manual reload. Previously gated on `hasSyncing`, which left
  // the pill stuck on its last-rendered value whenever the row was idle
  // at render time — breaking SC3's "≤5s flip" contract for the common
  // case where the worker silently invalidates a key (ISSUE-005).
  // The `visibilitychange` listener re-runs the poll the moment the tab
  // comes back into focus so users see fresh state on return.
  useEffect(() => {
    const tick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      startTransition(() => router.refresh());
    };
    const id = setInterval(tick, 5000);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", tick);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", tick);
      }
    };
  }, [router, startTransition]);

  async function handleSync(apiKeyId: string) {
    // D-10 optimistic syncing: pill flips immediately so the click feels
    // responsive. Clear prior helper_override / queued_next_attempt_at so a
    // fresh click restarts the UX cleanly.
    setKeys((prev) =>
      prev.map((k) =>
        k.id === apiKeyId
          ? {
              ...k,
              sync_status: "syncing",
              sync_error: null,
              queued_next_attempt_at: null,
              helper_override: null,
            }
          : k,
      ),
    );
    try {
      const res = await fetch("/api/allocator/holdings/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key_id: apiKeyId }),
      });
      const json = (await res.json().catch(() => null)) ?? {};
      if (res.status === 409) {
        markRefusedAsDisconnected(apiKeyId, json, null);
        startTransition(() => router.refresh());
        return;
      }
      if (!res.ok) {
        // 4xx/5xx — row-scoped error surfaced via aria-live helper line.
        // Revert optimistic syncing so the Sync now button re-enables.
        setKeys((prev) =>
          prev.map((k) =>
            k.id === apiKeyId
              ? {
                  ...k,
                  sync_status:
                    k.sync_status === "syncing" ? "idle" : k.sync_status,
                  helper_override: SYNC_FAILED_HELPER,
                }
              : k,
          ),
        );
        return;
      }
      // f8: on 200 already_inflight the server includes next_attempt_at
      // from the queued job. Capture so AllocatorSyncStatus can render
      // "Queued — exchange cooldown, retry in {N}s" when ≥30s out.
      if (json.already_inflight && typeof json.next_attempt_at === "string") {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === apiKeyId
              ? {
                  ...k,
                  sync_status: "syncing",
                  queued_next_attempt_at: json.next_attempt_at,
                  helper_override: null,
                }
              : k,
          ),
        );
        return;
      }
      // 200 { ok: true, job_id } — pill stays syncing; the 5s poll tick
      // advances to `complete` once the worker lands.
    } catch {
      // Network error — revert optimistic syncing and surface the error.
      setKeys((prev) =>
        prev.map((k) =>
          k.id === apiKeyId
            ? {
                ...k,
                sync_status: "idle",
                helper_override: SYNC_FAILED_HELPER,
              }
            : k,
        ),
      );
    }
  }

  async function handleAddKey(data: {
    exchange: string;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  }) {
    setFormError(null);
    setFormLoading(true);
    // F6 (phase-119 fold-in): the server validate route normalizes the exchange
    // (WR-01), but a mixed-case value ("sFOX") reaching the wire is still worth
    // preventing at the source. Canonicalize once here.
    //
    // 160-03 / RANK-03: this used to feed BOTH the fetch body and a
    // browser-composed INSERT. The INSERT is gone — the route writes the row
    // and re-normalizes independently at its own chokepoint — so the sole
    // consumer is the request body. Credential fields are untouched (their
    // .trim() chokepoint lives server-side per the v1.11 dogfood fix).
    const exchange = data.exchange.trim().toLowerCase();
    try {
      // Call the validate-and-encrypt endpoint in PERSIST mode — the same arm
      // the strategy-side flows use since 160-02. It validates against the
      // exchange via the analytics service and then writes the api_keys row
      // ITSELF, stamping `exchange` AND `attested_venue` from the single venue
      // binding it authenticated against. The response carries the row id and
      // the verdict only: no ciphertext returns to the browser on this path.
      const response = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          api_key: data.apiKey,
          api_secret: data.apiSecret,
          passphrase: data.passphrase,
          persist: true,
          label: data.label,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFormError(result.error ?? "Validation failed");
        setFormLoading(false);
        return;
      }

      const newKeyId = result.api_key_id;
      if (typeof newKeyId !== "string") {
        // Rule 12 / fail loud. A 2xx carrying no id means the server did not
        // persist. Rendering an optimistic row here would put a key on screen
        // that does not exist and can never sync.
        setFormError("Your key was verified but not saved. Please try again.");
        setFormLoading(false);
        return;
      }

      // The optimistic render needs the FULL row, and the persist response is
      // deliberately minimal, so read the server-written row back by id. The
      // projection is the migration-027 SELECT allowlist constant — never a
      // re-typed column list, because a column drifting off the allowlist
      // fails as a 42501 in production and nowhere else.
      const { data: inserted, error: refetchErr } = await supabase
        .from("api_keys")
        .select(API_KEY_USER_COLUMNS)
        .eq("id", newKeyId)
        .single();
      if (refetchErr || !inserted) {
        // Curated, and honest about the split outcome: the key IS saved (the
        // route returned an id), only this view could not load it. The
        // pre-conversion code piped `insertErr.message` — a raw PostgREST
        // string carrying SQLSTATE, relation and column names — straight into
        // the form banner (H-0405 class).
        setFormError(
          "Your key was saved, but we couldn't load it here. Refresh the page to see it.",
        );
        setFormLoading(false);
        return;
      }

      // Optimistically render the new row as syncing, then close the modal
      // BEFORE awaiting the POST (so the f4 error surfaces on the row's
      // aria-live helper line rather than blocking the modal). Finally,
      // await the sync request per f4.
      // NEW-C29-02: stamp pending_insert=true so the merge effect retains this
      // row even if router.refresh() resolves before the replica propagates it.
      const newRow: ExchangeConnection = {
        ...normalizeInitialKey(inserted as InitialKey),
        sync_status: "syncing",
        pending_insert: true,
      };
      setKeys((prev) => [newRow, ...prev]);
      setShowForm(false);
      setFormLoading(false);

      // D-09 / INGEST-07 / f4: AWAIT the POST. On non-2xx / network error,
      // revert pill to 'idle' and surface "Sync request failed" via the
      // row's aria-live helper line. No more fire-and-forget.
      try {
        const syncRes = await fetch("/api/allocator/holdings/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key_id: inserted.id }),
        });
        const syncJson = (await syncRes.json().catch(() => null)) ?? {};
        if (syncRes.status === 409) {
          markRefusedAsDisconnected(inserted.id, syncJson, null);
        } else if (!syncRes.ok) {
          setKeys((prev) =>
            prev.map((k) =>
              k.id === inserted.id
                ? {
                    ...k,
                    sync_status: "idle",
                    helper_override: SYNC_FAILED_HELPER,
                  }
                : k,
            ),
          );
        } else if (
          syncJson.already_inflight &&
          typeof syncJson.next_attempt_at === "string"
        ) {
          // f8: first-run landed in already_inflight due to per-exchange
          // circuit-breaker contagion. Surface the Queued helper.
          setKeys((prev) =>
            prev.map((k) =>
              k.id === inserted.id
                ? {
                    ...k,
                    sync_status: "syncing",
                    queued_next_attempt_at: syncJson.next_attempt_at,
                  }
                : k,
            ),
          );
        }
        // 200 { ok, job_id } — row already syncing; next poll tick advances.
      } catch {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === inserted.id
              ? {
                  ...k,
                  sync_status: "idle",
                  helper_override: SYNC_FAILED_HELPER,
                }
              : k,
          ),
        );
      }

      // Pull server truth so sync_status transitions (syncing → complete)
      // propagate into the manager's state.
      startTransition(() => router.refresh());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
      setFormLoading(false);
    }
  }

  // Migration 075: split active vs disconnected. Active rows render with
  // Sync + Disconnect; disconnected rows render under a separate section
  // with Reconnect. Derived each render — keys list is small (rarely >10).
  const activeKeys = keys.filter((k) => k.disconnected_at === null);
  const disconnectedKeys = keys.filter((k) => k.disconnected_at !== null);

  // DOGFOOD-2: only assert an active allocation when holdings actually back it.
  // When keys are connected but allocator_holdings is empty, show an honest
  // state instead — either the first sync is still in flight, or no positions
  // are open. anySyncing distinguishes those two cases.
  const anySyncing = activeKeys.some((k) => k.sync_status === "syncing");
  // DOGFOOD-2 FIX 2 (fail-loud): hasHoldings === null means the holdings
  // head-count failed server-side. Do NOT fall through to "no open positions
  // yet" (an affirmative-negative the failed count cannot support) — show a
  // neutral "connected" subtitle that asserts nothing about the book state.
  const connectedSubtitle =
    hasHoldings === true
      ? `${activeKeys.length} connected · Active Allocation auto-synced`
      : hasHoldings === null
        ? `${activeKeys.length} connected`
        : anySyncing
          ? `${activeKeys.length} connected · first sync in progress`
          : `${activeKeys.length} connected · no open positions yet`;

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Exchange connections
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {activeKeys.length === 0
                ? "No exchanges connected yet."
                : connectedSubtitle}
            </p>
          </div>
          <Button onClick={() => setShowForm(true)}>+ Connect exchange</Button>
        </div>

        {activeKeys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-bg-secondary p-8 text-center">
            <p className="text-sm text-text-secondary">
              Upload a read-only API key from Binance, OKX, Bybit, or
              Deribit to start tracking your positions automatically.
            </p>
            <p className="mt-2 text-xs text-text-muted">
              Keys are validated against the exchange and encrypted with a
              per-user KEK before storage. Trading and withdrawal keys are
              rejected.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {activeKeys.map((key) => {
              const tag = EXCHANGE_TAGS[key.exchange] ?? {
                label: key.exchange.slice(0, 3).toUpperCase(),
                bg: "#F1F5F9",
                fg: "#475569",
              };
              return (
                <div
                  key={key.id}
                  className="flex items-center gap-4 bg-surface px-4 py-3"
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md font-metric text-xs font-bold tabular-nums"
                    style={{ backgroundColor: tag.bg, color: tag.fg }}
                    aria-label={key.exchange}
                  >
                    {tag.label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {key.label}
                    </p>
                    <p className="text-fixed-10 text-text-muted uppercase tracking-wider mt-0.5">
                      {key.exchange} · Read-only · Balance{" "}
                      {formatUsd(key.account_balance_usdt)}
                    </p>
                    {key.exchange === "mt5" && (
                      <p className="text-xs text-text-secondary font-metric mt-0.5">
                        MT5 account {key.venue_account_id ?? "—"}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-fixed-10 uppercase tracking-wider text-text-muted font-semibold">
                      Last sync
                    </p>
                    <p className="text-xs text-text-secondary font-metric mt-0.5">
                      {formatRelative(key.last_sync_at)}
                    </p>
                  </div>
                  <AllocatorSyncStatus
                    syncStatus={key.sync_status}
                    syncError={key.sync_error}
                    lastSyncAt={key.last_sync_at}
                    exchange={key.exchange}
                    retryAtSeconds={computeRetryAtSeconds(
                      key.exchange,
                      key.last_429_at,
                    )}
                    queuedNextAttemptAt={key.queued_next_attempt_at}
                    helperOverride={key.helper_override}
                  />
                  <Button
                    variant="primary"
                    disabled={key.sync_status === "syncing"}
                    aria-label={`Sync ${key.exchange} now`}
                    title={
                      key.sync_status === "syncing"
                        ? "Sync in progress"
                        : undefined
                    }
                    onClick={() => handleSync(key.id)}
                  >
                    Sync now
                  </Button>
                  {key.exchange === "mt5" && (
                    <Button
                      variant="secondary"
                      aria-label={`Update password for ${key.exchange} key`}
                      onClick={() => setUpdatingKeyId(key.id)}
                    >
                      Update password
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    aria-label={`Disconnect ${key.exchange} key`}
                    onClick={() => openDeleteConfirm(key.id)}
                  >
                    Disconnect
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {disconnectedKeys.length > 0 ? (
        <Card>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-text-primary">
              Disconnected
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {disconnectedKeys.length} key
              {disconnectedKeys.length === 1 ? "" : "s"} stopped syncing.
              Historical holdings stay reflected in past performance.
            </p>
          </div>
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {disconnectedKeys.map((key) => {
              const tag = EXCHANGE_TAGS[key.exchange] ?? {
                label: key.exchange.slice(0, 3).toUpperCase(),
                bg: "#F1F5F9",
                fg: "#475569",
              };
              return (
                <div
                  key={key.id}
                  className="flex items-center gap-4 bg-surface px-4 py-3 opacity-75"
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md font-metric text-xs font-bold tabular-nums"
                    style={{ backgroundColor: tag.bg, color: tag.fg }}
                    aria-label={key.exchange}
                  >
                    {tag.label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {key.label}
                    </p>
                    <p className="text-fixed-10 text-text-muted uppercase tracking-wider mt-0.5">
                      {key.exchange} · Disconnected{" "}
                      {formatRelative(key.disconnected_at)}
                    </p>
                    {/* Round-1 review (HIGH-1): a disconnected row carries a
                        helper line too. Without it the sync refusal's reason and
                        "Reconnect failed — try again" were set on this row and
                        never shown. */}
                    <div
                      role="status"
                      aria-live="polite"
                      data-testid="allocator-disconnected-helper"
                      className="text-xs text-text-muted mt-1"
                    >
                      {key.helper_override ? (
                        <span>{key.helper_override}</span>
                      ) : null}
                    </div>
                    {key.exchange === "mt5" && (
                      <p className="text-xs text-text-secondary font-metric mt-0.5">
                        MT5 account {key.venue_account_id ?? "—"}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-fixed-10 uppercase tracking-wider text-text-muted font-semibold">
                      Last sync
                    </p>
                    <p className="text-xs text-text-secondary font-metric mt-0.5">
                      {formatRelative(key.last_sync_at)}
                    </p>
                  </div>
                  {/* NEW-C29-01: guard against double-click firing the RPC twice.
                      sync_status is already flipped to "syncing" optimistically
                      before the RPC in handleReconnect, so this disabled check
                      prevents a second click from queuing a duplicate RPC +
                      sync POST and racing against the first. */}
                  <Button
                    variant="primary"
                    disabled={key.sync_status === "syncing"}
                    aria-label={`Reconnect ${key.exchange} key`}
                    title={
                      key.sync_status === "syncing"
                        ? "Reconnect in progress"
                        : undefined
                    }
                    onClick={() => handleReconnect(key.id)}
                  >
                    Reconnect
                  </Button>
                  {key.exchange === "mt5" && (
                    <Button
                      variant="secondary"
                      aria-label={`Update password for ${key.exchange} key`}
                      onClick={() => setUpdatingKeyId(key.id)}
                    >
                      Update password
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            How exchange sync works
          </h3>
          <ol className="mt-3 space-y-2 text-xs text-text-secondary list-decimal list-inside">
            <li>
              Create a <strong>read-only</strong> API key on your exchange.
              Disable trading and withdrawal permissions.
            </li>
            <li>
              Upload it here. Quantalyze validates the key against the
              exchange, confirms it&apos;s read-only, and encrypts it
              with a per-user KEK before storing.
            </li>
            <li>
              Our analytics service reads your positions and trade history
              on a daily schedule. It groups related trades into strategy
              positions and writes them into your Active Allocation
              portfolio.
            </li>
            <li>
              Deposits and withdrawals on the exchange become{" "}
              <code>allocation_events</code> with{" "}
              <code>source=&apos;auto&apos;</code>. Your invest/divest
              lifecycle is captured with zero manual entry.
            </li>
          </ol>
        </div>
      </Card>

      {showForm ? (
        <Modal
          open={showForm}
          onClose={() => {
            setShowForm(false);
            setFormError(null);
          }}
          title="Connect exchange"
        >
          <ApiKeyForm
            onSubmit={handleAddKey}
            onCancel={() => {
              setShowForm(false);
              setFormError(null);
            }}
            loading={formLoading}
            error={formError}
          />
        </Modal>
      ) : null}

      {(() => {
        // Derive venue label from the row being confirmed. Reuses key.exchange
        // (already the identifier used in EXCHANGE_TAGS + aria-labels) and
        // capitalises via a simple first-letter-upper transform. No new
        // mapping table — the row already carries the canonical string.
        const confirmRow = confirmDeleteId
          ? keys.find((k) => k.id === confirmDeleteId)
          : null;
        const venueLabel = confirmRow
          ? confirmRow.exchange.charAt(0).toUpperCase() +
            confirmRow.exchange.slice(1)
          : "";
        return (
          <Modal
            open={!!confirmDeleteId}
            onClose={() => {
              if (deleteLoading) return;
              setConfirmDeleteId(null);
              setDeleteError(null);
              setDeleteHoldingsCount(null);
              setCascadeHoldings(false);
            }}
            title={`Disconnect ${venueLabel}?`}
          >
            <p className="text-sm text-text-secondary">
              We&apos;ll stop syncing this key. Your historical holdings stay
              available for audit and are reflected in past performance.
            </p>

            {deleteHoldingsCount === null ? (
              <p className="mt-3 text-xs text-text-muted">Checking holdings…</p>
            ) : deleteHoldingsCount === 0 ? (
              <p className="mt-3 text-xs text-text-muted">
                No historical holdings are tied to this key.
              </p>
            ) : (
              <div className="mt-3">
                <label className="flex items-start gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={cascadeHoldings}
                    disabled={deleteLoading}
                    onChange={(e) => setCascadeHoldings(e.target.checked)}
                    aria-describedby="cascade-holdings-help"
                  />
                  <span>
                    Also delete {deleteHoldingsCount} historical holding
                    {deleteHoldingsCount === 1 ? "" : "s"} from this key
                  </span>
                </label>
                <p
                  id="cascade-holdings-help"
                  className="ml-6 mt-1 text-fixed-11 text-text-muted"
                >
                  {cascadeHoldings
                    ? "Checked: holdings are permanently deleted and excluded from all historical metrics."
                    : "Unchecked: holdings are kept for audit continuity and reflected in past performance."}
                </p>
              </div>
            )}

            {deleteError ? (
              <p
                role="alert"
                className="mt-3 text-xs text-negative bg-negative/5 border border-negative/20 rounded px-3 py-2"
              >
                {deleteError}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={deleteLoading}
                onClick={() => {
                  setConfirmDeleteId(null);
                  setDeleteError(null);
                  setDeleteHoldingsCount(null);
                  setCascadeHoldings(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleteLoading || deleteHoldingsCount === null}
                onClick={() =>
                  confirmDeleteId && handleDeleteKey(confirmDeleteId)
                }
              >
                {deleteLoading ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          </Modal>
        );
      })()}

      <UpdateMt5SecretDialog
        open={!!updatingKeyId}
        apiKeyId={updatingKeyId ?? ""}
        onClose={() => setUpdatingKeyId(null)}
        onUpdated={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
