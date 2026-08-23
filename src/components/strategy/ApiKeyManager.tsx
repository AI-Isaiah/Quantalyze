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
 * 140.3-08 / SEAMUX-04 (C-9) — what the user is told when a sync could not be
 * started and the response carried no reviewed copy of its own.
 *
 * REPLACES a sentence that told the user the analytics service was unavailable
 * and then instructed them to check that one of our own server-side environment
 * variables was configured. That is a DESIGN.md §Voice violation and an
 * information-disclosure smell: it tells a user something they can neither act
 * on nor should know, and it names our infrastructure to anyone who can trip the
 * arm. The deleted string is NOT reproduced here — the acceptance grep for it
 * scans this file, and a comment quoting it would keep the grep red forever
 * while the copy was genuinely gone.
 *
 * DESIGN.md §Voice: declarative, sentence-case, active voice, no exclamation, no
 * adjective where a number exists. There is no number to give here — this
 * component reads no `Retry-After` (that is SEAMUX-06, plan `140.3-09`), so
 * inventing a wait would be the fabrication the rule exists to prevent.
 *
 * "Your key is saved" is a fact at BOTH call sites, not reassurance: the
 * background sync is reached only after the route returned an `api_key_id`
 * (160-02 — the server wrote the row and told us its id; a response without
 * one throws before this copy can be shown), and the explicit sync runs only
 * after `handleLinkKey` resolved without error.
 */
const SYNC_UNAVAILABLE_COPY =
  "We couldn't start the sync. Your key is saved — retry in a moment, and contact support if it keeps failing.";

/**
 * The user-facing message for a non-2xx `/api/keys/sync` response.
 *
 * Shared by BOTH call sites deliberately: a class fixed two different ways is a
 * class a reviewer cannot audit, and "3 of 5 sites" is this programme's
 * signature failure.
 *
 * Two things it does that reading `res.json()` directly does not:
 *
 *  1. **Branches on `content-type` BEFORE the JSON read.** A proxy or gateway
 *     answers an outage with an HTML error page; `res.json()` on that throws a
 *     `SyntaxError` INSIDE the failure path, replacing the real failure with a
 *     parse error.
 *  2. **Reads `human_message` as well as `error`.** These are two different
 *     envelopes from the same route and BOTH are live. The route's own arms emit
 *     `{ error }` (400 / 404 / 429 / the composite-probe 503); every envelope
 *     `postProcessKey` builds emits `{ code, human_message }` — including the
 *     breaker's 503, whose sentence `140.3-04` consolidated onto ONE production
 *     source precisely so it reaches users. Reading `error` alone rendered
 *     "Trade sync failed" over the top of it.
 */
async function syncFailureMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body: unknown = await res.json().catch(() => null);
    if (body !== null && typeof body === "object") {
      const fields = body as Record<string, unknown>;
      if (typeof fields.error === "string" && fields.error) return fields.error;
      if (typeof fields.human_message === "string" && fields.human_message) {
        return fields.human_message;
      }
    }
  }
  return SYNC_UNAVAILABLE_COPY;
}

/**
 * Did this 2xx actually enqueue a job?
 *
 * `/api/keys/sync` stamps `ok: true` on its three structured success branches
 * ONLY. Its drift fallback returns the unrecognised upstream body through
 * un-stamped, and says why in the route: *"marking an unrecognized shape ok:true
 * would falsely signal success"*. So the one 2xx that means "no job was
 * enqueued" is exactly the one that must not start a poll for it.
 */
function isSyncEnqueued(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    (body as Record<string, unknown>).ok === true
  );
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

    // F6 (phase-119 fold-in): canonicalize the exchange to lowercase before it
    // leaves this component. The DB CHECK admits lowercase venue codes only, so
    // a mixed-case value ("sFOX") used to pass validation (burning a live probe)
    // and then 23514 on the INSERT. Credential fields are untouched (their
    // .trim() chokepoint lives server-side per the v1.11 dogfood fix).
    //
    // 160-02 / RANK-03: the INSERT this canonicalization used to also feed is
    // GONE — the route writes the row now, and it re-normalizes independently
    // at its own chokepoint (route.ts, `exchangeNormalized`). This stays because
    // it is what the request body carries, and a component that sends a
    // canonical venue is one less place a stray casing can originate.
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
          // 160-02 / RANK-03 — the persist discriminator. With it, the route
          // writes the api_keys row ITSELF, stamping `exchange` AND
          // `attested_venue` from the venue its own validateKey call
          // authenticated against, and returns `{ api_key_id }` with NO
          // ciphertext. It is REQUIRED: a body without `persist: true` is
          // refused with 409 `STALE_CLIENT`, so no arm of this route returns key
          // material to a browser. The label goes in the body now because the
          // server composes the row.
          persist: true,
          label: data.label,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Validation failed" }));
        throw new Error(err.error || "Key validation failed");
      }

      // Step 3: consume the id of the row the SERVER wrote. This component no
      // longer inserts into api_keys — a browser-composed INSERT could claim
      // any venue, and the venue is what decides the annualization factor
      // (√365 crypto vs √252 traditional) downstream. Plan 160-05 revokes the
      // client's INSERT grant outright once this has soaked on PROD.
      const { api_key_id: newKeyId } = await res.json();

      if (typeof newKeyId !== "string") {
        // Rule 12 / fail loud. A 2xx carrying no id means the server did not
        // persist. Continuing would report the key as added while it is
        // unlinked and will never sync — precisely the false-success that
        // NEW-C37-03 and B-06 below exist to prevent.
        throw new Error("Your key was verified but not saved. Please try again.");
      }

      const supabase = createClient();

      // NEW-C37-03: surface auto-link errors instead of swallowing them.
      // Pre-fix: the {error} from the strategies.update was discarded; if
      // RLS denied the update (stale cookie / not owner) the sync would
      // run against the OLD api_key_id and present wrong data as success.
      const { error: linkError } = await supabase
        .from("strategies")
        .update({ api_key_id: newKeyId })
        .eq("id", strategyId);
      if (linkError) {
        throw new Error(
          `Failed to link key to strategy: ${linkError.message}`,
        );
      }

      // Auto-sync trades in background (don't block the UI).
      //
      // 140.3-08 / SEAMUX-05 (B-06) — observe the HTTP OUTCOME, not just a
      // transport rejection. This was `fetch(…).catch(…)`, and the comment
      // beside it claimed it handled 401/403/500 errors. It could not:
      // `.catch()` fires ONLY when the request never completes, so every one
      // of those — and a breaker 503 — RESOLVED the promise and was invisible.
      // The user was told the key was added and nothing ever said the sync had
      // not started.
      //
      // Still NOT awaited: "don't block the UI" is a real requirement and the
      // add-key flow continues below regardless. The outcome is observed
      // INSIDE the promise chain and routed to the same SyncProgress surface
      // an explicit sync failure uses, so a failed background sync cannot be
      // read as a completed one.
      //
      // `lastAttemptedKeyId` is set so SyncProgress's Retry button has a
      // target; without it the retry closure would see null and no-op (the
      // pre-existing bug the state's own comment above records).
      setLastAttemptedKeyId(newKeyId);
      fetch("/api/keys/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await syncFailureMessage(res));
          // Same enqueue-evidence requirement as the explicit sync below —
          // one shape at both members of the class, not two.
          const body: unknown = await res.json().catch(() => null);
          if (!isSyncEnqueued(body)) throw new Error(SYNC_UNAVAILABLE_COPY);
        })
        .catch((err: unknown) => {
          // FINDING-10: keep the operator log — it is how a never-synced key
          // gets diagnosed, and the caught value goes HERE rather than to the
          // DOM (140.3-07's B-27 discipline).
          console.warn("[ApiKeyManager] background sync after key add failed:", err);
          setSyncStatus("error");
          setSyncError(
            err instanceof Error ? err.message : SYNC_UNAVAILABLE_COPY,
          );
        });

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
        throw new Error(await syncFailureMessage(res));
      }

      // 140.3-08 / SEAMUX-05 (B-15) — a 2xx is not evidence that a job was
      // enqueued, and this line used to assume it was. `/api/keys/sync` answers
      // an unrecognised upstream shape with a deliberately UN-stamped
      // passthrough, so the one response meaning "nothing was enqueued" was the
      // one that started a 15-minute poll for it, ending in a timeout that
      // blamed the computation.
      //
      // The fix is NOT entering the state. A wall-clock backstop would only time
      // the symptom out — the poll would still run, and the user would still be
      // told their analytics were computing when nothing was.
      const body: unknown = await res.json().catch(() => null);
      if (!isSyncEnqueued(body)) {
        throw new Error(SYNC_UNAVAILABLE_COPY);
      }

      // A job IS enqueued -- analytics may still be computing.
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
