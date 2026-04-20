"use client";

/**
 * Allocator-facing exchange connection manager.
 *
 * Lists the allocator's connected read-only exchange API keys, shows sync
 * status via AllocatorSyncStatus (7-state pill + helper line per UI-SPEC
 * D-08), and lets them add new ones. Phase 06 Plan 04 wires:
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
  // f8 (client-only — NOT persisted to DB): captured from the sync route's
  // `already_inflight` response. When syncing AND ≥30s out, the pill renders
  // the Queued helper via AllocatorSyncStatus.
  queued_next_attempt_at: string | null;
  // f4 (client-only — NOT persisted to DB): explicit helper-line override.
  // Populated on handleAddKey / handleSync failure paths. Passed through to
  // AllocatorSyncStatus.helperOverride so it takes precedence over computed
  // helper text.
  helper_override: string | null;
}

/**
 * `initialKeys` may arrive from the server-side `getUserApiKeys` query
 * which (pre Plan 01) projects columns without sync_error. Accept a wider
 * input shape and default missing client-only fields in the merge effect.
 */
type InitialKey = Omit<
  ExchangeConnection,
  "sync_error" | "queued_next_attempt_at" | "helper_override"
> & {
  sync_error?: string | null;
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
  return {
    id: k.id,
    exchange: k.exchange,
    label: k.label,
    is_active: k.is_active,
    sync_status: k.sync_status,
    last_sync_at: k.last_sync_at,
    account_balance_usdt: k.account_balance_usdt,
    created_at: k.created_at,
    sync_error: k.sync_error ?? null,
    // Landmine 8 + f8/f4 preservation: client-only fields carry over across
    // router.refresh() server-state cycles when the row id matches.
    queued_next_attempt_at: prev?.queued_next_attempt_at ?? null,
    helper_override: prev?.helper_override ?? null,
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
  const [, startTransition] = useTransition();

  const supabase = createClient();

  // Landmine 8: router.refresh() re-renders the server component which
  // passes new initialKeys, but useState(initialKeys) only runs on mount.
  // Merge here so server truth wins on sync_status/last_sync_at/sync_error
  // while preserving client-only queued_next_attempt_at + helper_override
  // for matching ids (f8 / f4).
  useEffect(() => {
    setKeys((prev) => {
      const byId = new Map(prev.map((k) => [k.id, k]));
      return initialKeys.map((k) => normalizeInitialKey(k, byId.get(k.id)));
    });
  }, [initialKeys]);

  // D-11: 5s router.refresh() polling while any row is syncing. The poll
  // is transparent — the pill IS the live region; no visual "refreshing"
  // chrome. setInterval is cleared when no rows remain syncing OR on
  // unmount (cleanup function).
  useEffect(() => {
    const hasSyncing = keys.some((k) => k.sync_status === "syncing");
    if (!hasSyncing) return;
    const id = setInterval(() => {
      startTransition(() => router.refresh());
    }, 5000);
    return () => clearInterval(id);
  }, [keys, router, startTransition]);

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
      const newRow = normalizeInitialKey(inserted as InitialKey);
      newRow.sync_status = "syncing";
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

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Exchange connections
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {keys.length === 0
                ? "No exchanges connected yet."
                : `${keys.length} connected · Active Allocation auto-synced`}
            </p>
          </div>
          <Button onClick={() => setShowForm(true)}>+ Connect exchange</Button>
        </div>

        {keys.length === 0 ? (
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
            {keys.map((key) => {
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
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
    </div>
  );
}
