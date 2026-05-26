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
 *     after the api_keys INSERT succeeds, the client awaits the POST so
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
  | "queued_next_attempt_at"
  | "helper_override"
> & {
  sync_error?: string | null;
  last_429_at?: string | null;
  disconnected_at?: string | null;
};

interface Props {
  initialKeys: InitialKey[];
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

function normalizeInitialKey(
  k: InitialKey,
  prev?: ExchangeConnection,
): ExchangeConnection {
  // M1 (red-team): if the local state already cleared disconnected_at (the
  // reconnect RPC succeeded and we optimistically set disconnected_at=null +
  // sync_status="syncing"), do NOT let a stale server snapshot from a replica
  // that hasn't caught up yet overwrite it with the old non-null timestamp.
  // Guard: prev had disconnected_at=null AND sync_status="syncing" AND the
  // server is still reporting a non-null disconnected_at → keep local null
  // so the row stays in the active list and the Reconnect button stays
  // disabled. The 5-second poll will pick up the committed server value once
  // the replica propagates; until then, local truth wins.
  const isReconnectInFlight =
    prev !== undefined &&
    prev.disconnected_at === null &&
    prev.sync_status === "syncing" &&
    !prev.pending_insert &&
    k.disconnected_at != null;

  return {
    id: k.id,
    exchange: k.exchange,
    label: k.label,
    is_active: k.is_active,
    // When a reconnect is in-flight, preserve the optimistic sync_status
    // ("syncing") rather than reverting to the stale server value.
    sync_status: isReconnectInFlight ? prev!.sync_status : k.sync_status,
    last_sync_at: k.last_sync_at,
    account_balance_usdt: k.account_balance_usdt,
    created_at: k.created_at,
    sync_error: k.sync_error ?? null,
    last_429_at: k.last_429_at ?? null,
    // M1: preserve local null (reconnect in-flight) against stale server snapshot.
    disconnected_at: isReconnectInFlight ? null : (k.disconnected_at ?? null),
    // Landmine 8 + f8/f4 preservation: client-only fields carry over across
    // router.refresh() server-state cycles when the row id matches.
    queued_next_attempt_at: prev?.queued_next_attempt_at ?? null,
    helper_override: prev?.helper_override ?? null,
    // NEW-C29-02: a row that arrives in the server snapshot is no longer pending.
    // pending_insert is cleared when the server confirms the id (this call
    // happens when the row appears in initialKeys).
    pending_insert: false,
  };
}

export function AllocatorExchangeManager({ initialKeys }: Props) {
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
      const nowIso = new Date().toISOString();
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId ? { ...k, disconnected_at: nowIso } : k,
        ),
      );
    }

    setConfirmDeleteId(null);
    setDeleteHoldingsCount(null);
    setCascadeHoldings(false);
    startTransition(() => router.refresh());
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
          };
        }
        return k;
      });
    });

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
      if (!syncRes.ok) {
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
    try {
      // Call the existing validate-and-encrypt endpoint — same path the
      // strategy-side flow uses. It validates against the exchange via
      // the analytics service and returns encrypted ciphertext.
      const response = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: data.exchange,
          api_key: data.apiKey,
          api_secret: data.apiSecret,
          passphrase: data.passphrase,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFormError(result.error ?? "Validation failed");
        setFormLoading(false);
        return;
      }

      // Store the encrypted key row directly. Insert via supabase client
      // (RLS-scoped to auth.uid()).
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setFormError("Not authenticated");
        setFormLoading(false);
        return;
      }
      const { data: inserted, error: insertErr } = await supabase
        .from("api_keys")
        .insert({
          user_id: user.id,
          exchange: data.exchange,
          label: data.label,
          api_key_encrypted: result.api_key_encrypted,
          api_secret_encrypted: result.api_secret_encrypted,
          passphrase_encrypted: result.passphrase_encrypted ?? null,
          dek_encrypted: result.dek_encrypted ?? null,
          nonce: result.nonce ?? null,
          is_active: true,
          kek_version: result.kek_version ?? 1,
          sync_status: "idle",
        })
        .select(API_KEY_USER_COLUMNS)
        .single();
      if (insertErr || !inserted) {
        setFormError(insertErr?.message ?? "Failed to save key");
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
        if (!syncRes.ok) {
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
                : `${activeKeys.length} connected · Active Allocation auto-synced`}
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
                    <p className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
                      {key.exchange} · Read-only · Balance{" "}
                      {formatUsd(key.account_balance_usdt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
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
                    <p className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
                      {key.exchange} · Disconnected{" "}
                      {formatRelative(key.disconnected_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
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
                  className="ml-6 mt-1 text-[11px] text-text-muted"
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
    </div>
  );
}
