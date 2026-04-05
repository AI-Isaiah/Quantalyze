"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ApiKeyForm } from "./ApiKeyForm";
import type { ApiKey } from "@/lib/types";

interface ApiKeyManagerProps {
  strategyId: string;
  currentKeyId: string | null;
}

export function ApiKeyManager({ strategyId, currentKeyId }: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    const supabase = createClient();
    const { data } = await supabase
      .from("api_keys")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setKeys(data);
  }

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

      // Step 3: Store encrypted key in Supabase (only DB columns, not validation fields)
      const { valid, read_only, ...dbFields } = encrypted;
      const supabase = createClient();
      const { error: insertError } = await supabase.from("api_keys").insert({
        exchange: data.exchange,
        label: data.label,
        ...dbFields,
      });

      if (insertError) throw new Error(insertError.message);

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
        const err = await res.json().catch(() => ({ error: "Sync failed" }));
        throw new Error(err.error || "Trade sync failed");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
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
                <span className="text-xs text-accent font-medium">Connected</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSyncTrades(key.id)}
                  disabled={syncingKeyId === key.id}
                >
                  {syncingKeyId === key.id ? "Syncing..." : "Use & Sync"}
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

      {error && !showForm && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
