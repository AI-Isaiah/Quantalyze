"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ApiKeyForm } from "./ApiKeyForm";
import { SyncProgress, type SyncStatus } from "./SyncProgress";
import type { ApiKey } from "@/lib/types";

interface ApiKeyManagerProps {
  strategyId: string;
  currentKeyId: string | null;
  defaultExchange?: string;
}

/**
 * Strip the non-DB fields (`valid`, `read_only`) that come back from the
 * validate-and-encrypt endpoint. Kept as a standalone helper so both the
 * strategy form and the key manager consume the response identically.
 */
function stripValidationFields(
  response: Record<string, unknown>,
): Record<string, unknown> {
  const copy = { ...response };
  delete copy.valid;
  delete copy.read_only;
  return copy;
}

export function ApiKeyManager({ strategyId, currentKeyId, defaultExchange }: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();

  const loadKeys = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("api_keys")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setKeys(data);
      const current = data.find((k) => k.id === currentKeyId);
      if (current?.last_sync_at) setLastSyncAt(current.last_sync_at);
    }
  }, [currentKeyId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleSyncStatusChange = useCallback((status: SyncStatus) => {
    setSyncStatus(status);
    if (status === "complete") {
      setSyncingKeyId(null);
      loadKeys();
      router.refresh();
    } else if (status === "error") {
      setSyncingKeyId(null);
    }
  }, [router, loadKeys]);

  async function handleAddKey(data: {
    exchange: string;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  }) {
    setLoading(true);
    setError(null);

    try {
      // Validate + encrypt atomically (prevents TOCTOU race on key permissions)
      const res = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: data.exchange,
          api_key: data.apiKey,
          api_secret: data.apiSecret,
          passphrase: data.passphrase || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Validation failed" }));
        throw new Error(err.error || "Key validation failed");
      }

      const encrypted = await res.json();

      // Step 3: Store encrypted key in Supabase (only DB columns, not validation fields).
      // The response includes `valid` + `read_only` for UI signalling but they
      // don't belong in the `api_keys` row, so we strip them before insert.
      const dbFields = stripValidationFields(encrypted);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: newKey, error: insertError } = await supabase.from("api_keys").insert({
        user_id: user.id,
        exchange: data.exchange,
        label: data.label,
        ...dbFields,
      }).select("id").single();

      if (insertError) throw new Error(insertError.message);

      // Auto-link key to strategy and sync trades
      if (newKey) {
        await supabase.from("strategies").update({ api_key_id: newKey.id }).eq("id", strategyId);

        // Auto-sync trades in background (don't block the UI)
        fetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        }).catch(() => {
          // Non-critical: user can resync later
        });
      }

      setShowForm(false);
      await loadKeys();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      setLoading(false);
    }
  }

  async function handleLinkKey(keyId: string) {
    const supabase = createClient();
    await supabase.from("strategies").update({ api_key_id: keyId }).eq("id", strategyId);
    router.refresh();
  }

  async function handleDeleteKey(keyId: string) {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("api_keys").delete().eq("id", keyId);
    setConfirmDelete(null);
    if (deleteError) {
      setError("Failed to delete key: " + deleteError.message);
      return;
    }
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
    router.refresh();
  }

  async function handleSyncTrades(keyId: string) {
    setSyncingKeyId(keyId);
    setSyncStatus("syncing");
    setSyncError(null);
    setError(null);

    try {
      // Link key to strategy first
      await handleLinkKey(keyId);

      // Fetch trades
      const res = await fetch("/api/keys/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId }),
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const err = await res.json().catch(() => ({ error: "Sync failed" }));
          throw new Error(err.error || "Trade sync failed");
        }
        throw new Error("Analytics service unavailable. Ensure SUPABASE_SERVICE_ROLE_KEY is configured.");
      }

      // API returned success -- analytics may still be computing.
      // SyncProgress will poll strategy_analytics to track completion.
      setSyncStatus("computing");
      await loadKeys();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setSyncStatus("error");
      setSyncError(message);
      setError(message);
      setSyncingKeyId(null);
    }
  }

  const exchangeIcon: Record<string, string> = {
    binance: "B",
    okx: "O",
    bybit: "By",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Exchange API Keys</h2>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Add Key
          </Button>
        )}
      </div>

      {showForm && (
        <ApiKeyForm
          onSubmit={handleAddKey}
          onCancel={() => { setShowForm(false); setError(null); }}
          loading={loading}
          error={error}
          defaultExchange={defaultExchange}
        />
      )}

      {keys.length === 0 && !showForm && (
        <Card>
          <p className="text-sm text-text-muted text-center py-4">
            No API keys connected. Add a read-only exchange key to import your trading data.
          </p>
        </Card>
      )}

      {keys.map((key) => (
        <Card key={key.id}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar/10 text-xs font-bold text-text-primary">
                {exchangeIcon[key.exchange] ?? "?"}
              </span>
              <div>
                <p className="text-sm font-medium text-text-primary">{key.label}</p>
                <p className="text-xs text-text-muted">
                  {key.exchange.charAt(0).toUpperCase() + key.exchange.slice(1)}
                  {key.last_sync_at && ` · Last synced ${new Date(key.last_sync_at).toLocaleDateString()}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {key.id === currentKeyId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSyncTrades(key.id)}
                  disabled={!!syncingKeyId}
                >
                  {syncingKeyId === key.id ? "Syncing\u2026" : "Resync"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSyncTrades(key.id)}
                  disabled={!!syncingKeyId}
                >
                  {syncingKeyId === key.id ? "Syncing\u2026" : "Use & Sync"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(key.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {/* Sync progress indicator */}
      {syncStatus !== "idle" && (
        <SyncProgress
          strategyId={strategyId}
          syncStatus={syncStatus}
          lastSyncAt={lastSyncAt}
          syncError={syncError}
          onRetry={() => syncingKeyId && handleSyncTrades(syncingKeyId)}
          onStatusChange={handleSyncStatusChange}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete API Key"
      >
        <p className="text-sm text-text-secondary mb-4">
          This will permanently remove this API key. Trade data already imported will not be affected.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => confirmDelete && handleDeleteKey(confirmDelete)}>Delete</Button>
        </div>
      </Modal>

      {error && !showForm && syncStatus !== "error" && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
