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
import { API_KEY_USER_COLUMNS } from "@/lib/constants";

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
  // H-0395: distinct load-failure state. Without it, a failed api_keys SELECT
  // (RLS regression after a GRANT migration, expired session, network error)
  // left `keys` at [] and the render showed the misleading "No API keys
  // connected" empty state — a user with keys would think they vanished and
  // could re-add a duplicate. We now discriminate failure from genuine-empty
  // and surface a retryable error banner instead of the all-clear empty state.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null);
  // `lastAttemptedKeyId` survives the catch block that clears
  // `syncingKeyId` so the SyncProgress retry button has a stable
  // target. Without it, the retry closure would see null and no-op
  // (pre-existing bug found in Task 1.2 Phase 3 eng review).
  const [lastAttemptedKeyId, setLastAttemptedKeyId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();

  const loadKeys = useCallback(async (opts?: { lastSyncedKeyId?: string }) => {
    const supabase = createClient();
    // Project only the allowlist — never `.select("*")` on api_keys from a
    // user-scoped client. Migration 027 (SEC-005) revokes SELECT on the
    // encrypted columns; `.select("*")` would silently return NULL for them.
    // FINDING-3: destructure error from api_keys SELECT and log on failure.
    // Pre-fix: {error} was discarded; on RLS regression/session expiry/network
    // error the key list silently stayed stale with no log entry and no user
    // feedback. The if(data) guard below still correctly short-circuits on
    // failure — this adds the missing observability.
    const { data, error: keysErr } = await supabase
      .from("api_keys")
      .select(API_KEY_USER_COLUMNS)
      .order("created_at", { ascending: false });
    if (keysErr) {
      console.error("[ApiKeyManager] api_keys fetch failed:", keysErr.message);
      // H-0395: a non-empty error (network/RLS/session) is NOT "no keys".
      // Surface a distinct, retryable error state and keep whatever keys we
      // had — never let the failure collapse into the empty "no keys" UI.
      setLoadError(keysErr.message);
      return;
    }
    // Reached only on a clean response: clear any prior load error so a
    // successful retry restores the normal list / genuine-empty state.
    setLoadError(null);
    if (data) {
      setKeys(data);
      // NEW-C37-04: derive lastSyncAt from the key that was actually synced
      // (opts.lastSyncedKeyId) rather than always from currentKeyId. When the
      // user clicks "Use & Sync" on a not-yet-current key, currentKeyId (a
      // prop) does not change until router.refresh() completes; reading from
      // it here would show the previously-linked key's timestamp immediately
      // after a successful sync of a different key.
      const targetKeyId = opts?.lastSyncedKeyId ?? currentKeyId;
      const targetKey = data.find((k) => k.id === targetKeyId);
      if (targetKey?.last_sync_at) setLastSyncAt(targetKey.last_sync_at);
    }
  }, [currentKeyId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleSyncStatusChange = useCallback((status: SyncStatus) => {
    setSyncStatus(status);
    // complete_with_warnings is a terminal SUCCESS (SyncProgress maps the
    // DB-native value to this UI state; mig 20260707120000 now persists it
    // instead of laundering to 'complete'). Treat it exactly like 'complete',
    // else syncingKeyId is never cleared and every key's Resync/Use button
    // stays disabled ("Syncing…") forever while the panel says "Synced with
    // warnings" — a permanent dead-lock only a reload recovers.
    if (status === "complete" || status === "complete_with_warnings") {
      setSyncingKeyId(null);
      // NEW-C37-04: pass the key that was actually synced so loadKeys can
      // derive lastSyncAt from the correct row, not from currentKeyId.
      loadKeys({ lastSyncedKeyId: lastAttemptedKeyId ?? undefined });
      router.refresh();
    } else if (status === "error") {
      setSyncingKeyId(null);
      // FINDING-8: when the poller times out (SyncProgress fires onStatusChange("error")
      // after POLL_MAX_ATTEMPTS without any syncError from the catch block),
      // syncError stays null and the UI shows "Sync failed" with no detail text.
      // Fill a default message for the timeout case so the user has actionable context.
      setSyncError((prev) => prev ?? "Analytics computation timed out. Please retry or contact support.");
    }
  }, [router, loadKeys, lastAttemptedKeyId]);

  async function handleAddKey(data: {
    exchange: string;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  }) {
    // NEW-C37-02: guard at the top of handleAddKey so two rapid Enter
    // presses (which fire before setLoading(true) re-renders) cannot race
    // to POST /api/keys/validate-and-encrypt and create duplicate api_keys
    // rows. The Connect button is already disabled via `loading`, but Enter
    // inside an <Input> submits the form regardless and setLoading is async.
    if (loading) return;
    setLoading(true);
    setError(null);

    // F6 (phase-119 fold-in): the server validate route normalizes the exchange
    // (WR-01), but the CLIENT performs the api_keys INSERT directly — a mixed-case
    // value ("sFOX") passes validation (burning a live probe) then 23514s on the
    // DB lowercase-only CHECK. Canonicalize once here and reuse for BOTH the
    // validate-and-encrypt body AND the insert. Credential fields are untouched
    // (their .trim() chokepoint lives server-side per the v1.11 dogfood fix).
    const exchange = data.exchange.trim().toLowerCase();

    try {
      // Validate + encrypt atomically (prevents TOCTOU race on key permissions)
      const res = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
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
        exchange,
        label: data.label,
        ...dbFields,
      }).select("id").single();

      if (insertError) throw new Error(insertError.message);

      // Auto-link key to strategy and sync trades
      if (newKey) {
        // NEW-C37-03: surface auto-link errors instead of swallowing them.
        // Pre-fix: the {error} from the strategies.update was discarded; if
        // RLS denied the update (stale cookie / not owner) the sync would
        // run against the OLD api_key_id and present wrong data as success.
        const { error: linkError } = await supabase
          .from("strategies")
          .update({ api_key_id: newKey.id })
          .eq("id", strategyId);
        if (linkError) {
          throw new Error(
            `Failed to link key to strategy: ${linkError.message}`,
          );
        }

        // Auto-sync trades in background (don't block the UI)
        fetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        }).catch((err) => {
          // FINDING-10: log failure so operators can diagnose why a newly-added
          // key never synced. Non-critical UX (user can resync manually), but
          // the empty catch previously left zero evidence of 401/403/500 errors.
          console.warn("[ApiKeyManager] background sync after key add failed:", err);
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
    // C1/FINDING-4: destructure and throw on error so handleSyncTrades
    // cannot proceed to /api/keys/sync against the wrong api_key_id when
    // the link update is denied (RLS violation, stale session, wrong
    // strategyId). Pre-fix: the {error} return was silently discarded —
    // the same pre-fix scenario that NEW-C37-03 fixed for handleAddKey.
    const { error: linkError } = await supabase
      .from("strategies")
      .update({ api_key_id: keyId })
      .eq("id", strategyId);
    if (linkError) {
      throw new Error(`Failed to link key to strategy: ${linkError.message}`);
    }
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
    setLastAttemptedKeyId(keyId);
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
      // NEW-C37-04: pass the key being synced so lastSyncAt reads from
      // the correct row.
      await loadKeys({ lastSyncedKeyId: keyId });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setSyncStatus("error");
      setSyncError(message);
      setError(message);
      setSyncingKeyId(null);
      // Note: lastAttemptedKeyId is intentionally NOT cleared so the
      // retry button below has a target.
    }
  }

  const exchangeIcon: Record<string, string> = {
    binance: "B",
    okx: "O",
    bybit: "By",
    // UX-01 (#30): keep labels in lockstep with the canonical EXCHANGE_TAGS map
    // in AllocatorExchangeManager.tsx — DRB per DESIGN.md 3-letter, no-emoji tag
    // convention. (The two maps can still drift; a shared-constant consolidation
    // is out of scope per locked decision D5.)
    deribit: "DRB",
    // SFOX-09: ships UNCONDITIONALLY (a founder-connected sfox key exists before
    // the public offer flag flips) so the key card renders the mono tag, never
    // the "?" fallback. Mono, no emoji per DESIGN.md.
    sfox: "SFOX",
    // 138-03 (MT5UI-02): same SFOX-09 provenance precedent — a founder-connected
    // mt5 key exists before the go-live offer flag (NEXT_PUBLIC_MT5_ENABLED)
    // flips, so its key card must render the real mono tag, never the "?"
    // fallback. Provenance surface (the user's OWN key), not an offer surface.
    // "MT5" — 3 chars, no emoji per DESIGN.md.
    mt5: "MT5",
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

      {/* H-0395: distinct load-failure state. Shown instead of the
          "No API keys connected" empty state when the api_keys SELECT
          failed, so a load error is never disguised as "you have no keys". */}
      {loadError && !showForm && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-negative">
              Couldn&apos;t load your API keys. Your existing keys are safe — this is a
              connection problem, not a deletion.
            </p>
            <Button size="sm" variant="secondary" onClick={() => loadKeys()}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {keys.length === 0 && !loadError && !showForm && (
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
              <span
                data-testid={`api-key-avatar-${key.exchange}`}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar/10 text-xs font-bold text-text-primary"
              >
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
          onRetry={() => lastAttemptedKeyId && handleSyncTrades(lastAttemptedKeyId)}
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
