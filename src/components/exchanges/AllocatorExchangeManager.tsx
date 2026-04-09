"use client";

/**
 * Allocator-facing exchange connection manager.
 *
 * Lists the allocator's connected read-only exchange API keys, shows sync
 * status, and lets them add new ones. Clicking "Sync now" triggers a
 * background sync via the analytics service that reads positions/trades
 * from the exchange and derives:
 *   - portfolio_strategies rows (which strategies are currently held)
 *   - allocation_events rows (invest/divest events, source='auto')
 *
 * For the seed-backed demo, the two pre-seeded keys (Binance + OKX) are
 * already wired up and the sync endpoint is a no-op that refreshes
 * `last_sync_at` — the Active Allocation portfolio is already populated.
 * Adding a new key uses the same encrypt + validate path as the
 * strategy-side ApiKeyManager so the production flow is identical.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ApiKeyForm } from "@/components/strategy/ApiKeyForm";
import { createClient } from "@/lib/supabase/client";

interface ExchangeConnection {
  id: string;
  exchange: string;
  label: string;
  is_active: boolean;
  // Nullable to match the DB column (api_keys.sync_status is nullable
  // — rows freshly inserted before the first sync tick have null).
  sync_status: string | null;
  last_sync_at: string | null;
  account_balance_usdt: number | null;
  created_at: string;
}

interface Props {
  initialKeys: ExchangeConnection[];
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

export function AllocatorExchangeManager({ initialKeys }: Props) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const supabase = createClient();

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
        .select(
          "id, exchange, label, is_active, sync_status, last_sync_at, account_balance_usdt, created_at",
        )
        .single();
      if (insertErr || !inserted) {
        setFormError(insertErr?.message ?? "Failed to save key");
        setFormLoading(false);
        return;
      }
      setKeys((prev) => [inserted as ExchangeConnection, ...prev]);
      setShowForm(false);
      setFormLoading(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
      setFormLoading(false);
    }
  }

  async function handleSync(keyId: string) {
    setSyncingId(keyId);
    // Optimistic: mark as syncing, then resolve after a brief delay and
    // refresh last_sync_at. For the seeded demo this is a no-op; in
    // production this would fire a backend endpoint that queues a trade
    // pull + derives new allocation_events rows.
    try {
      const now = new Date().toISOString();
      await supabase
        .from("api_keys")
        .update({ last_sync_at: now, sync_status: "idle" })
        .eq("id", keyId);
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId
            ? { ...k, last_sync_at: now, sync_status: "idle" as string | null }
            : k,
        ),
      );
      // Simulate sync latency for UX realism
      await new Promise((r) => setTimeout(r, 800));
      startTransition(() => router.refresh());
    } finally {
      setSyncingId(null);
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
                  <Button
                    variant="secondary"
                    onClick={() => handleSync(key.id)}
                    disabled={syncingId === key.id}
                  >
                    {syncingId === key.id ? "Syncing…" : "Sync now"}
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
