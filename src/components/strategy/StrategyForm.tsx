"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { STRATEGY_NAMES, STRATEGY_TYPES, SUBTYPES, MARKETS, EXCHANGES } from "@/lib/constants";
import type { Strategy } from "@/lib/types";

// F4 (Phase 122): this legacy StrategyForm connect-key modal renders a HARDCODED
// API Secret field + generic "read-only keys only" copy — it is NOT token-only /
// F3-aware, so it structurally cannot serve sfox (single Bearer token, no secret,
// no per-key scope probe). The wizard ApiKeyForm handles sfox correctly; this
// legacy surface EXCLUDES sfox from its offer instead — even when SFOX_UI_ENABLED
// flips EXCHANGES to include it — so it can never render a secret field + generic
// copy for a sfox connect. Filtered on the canonical lowercase code.
const EXCHANGE_OPTIONS = EXCHANGES.filter((e) => e.toLowerCase() !== "sfox").map(
  (e) => ({ value: e.toLowerCase(), label: e }),
);

/**
 * KEYLINK-01 — what the user is told when the `api_keys` row EXISTS but could
 * not be attached to the strategy.
 *
 * It is deliberately NOT the generic save-failure sentence, and not the
 * validation sentence either. The three outcomes demand three different next
 * actions: a validation failure means the credentials are wrong and should be
 * re-entered; a 2xx with no id means nothing was written at all; here the
 * credentials were accepted AND the row is already saved against the user's key
 * quota, so re-typing them fixes nothing. Naming the half that succeeded is the
 * only way the user can tell that a key now exists in their account.
 *
 * DESIGN.md §Voice: declarative, sentence-case, active voice, no adjective where
 * a fact will do. No number is quoted because none is knowable here — this
 * component reads no retry hint, and inventing a wait would be fabrication.
 */
const KEY_LINK_FAILED_COPY =
  "Your key was saved to your account, but we couldn't attach it to this strategy. Reload the page and try again.";

/**
 * H-0405 (audit-2026-05-07): map a raw Postgres/PostgREST error to a safe,
 * user-facing string. Piping `error.message` straight into the banner leaked
 * internal detail — SQLSTATE 42501 (RLS / SECURITY DEFINER trigger RAISE, such
 * as the cross-tenant api_key_id guard from migration 028/029 which embeds two
 * UUIDs + the migration name), constraint text, and column names. Keep all of
 * that server-side; show the user one of two intent-specific messages.
 *
 * KEYLINK-01: `intent` picks the fallback sentence. The 42501 arm is shared on
 * purpose — "You can only link API keys you own." is already the correct
 * sentence for BOTH a strategy save and a key link, and the redaction itself has
 * to stay in ONE place: it is the security-relevant half, and a second copy of
 * it is a second thing to forget when the guard changes.
 */
function toUserFacingStrategyError(
  error: { code?: string; message?: string },
  intent: "save" | "link" = "save",
): string {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "42501" || message.includes("cross-tenant linkage blocked")) {
    return "You can only link API keys you own.";
  }
  return intent === "link"
    ? KEY_LINK_FAILED_COPY
    : "Couldn't save your strategy. Please try again.";
}

interface StrategyFormProps {
  strategy?: Strategy;
  mode: "create" | "edit";
}

export function StrategyForm({ strategy, mode }: StrategyFormProps) {
  const [name, setName] = useState(strategy?.name ?? STRATEGY_NAMES[0]);
  const [description, setDescription] = useState(strategy?.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(strategy?.category_id ?? "");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  // Load the category list once on mount. We intentionally DON'T auto-pick
  // the first category inside this effect — doing so required referencing
  // `categoryId` and the exhaustive-deps rule would flag it, creating a
  // re-run hazard where the user's manual selection could be clobbered.
  // Instead, we auto-seed the selection below via a separate effect that
  // only fires when `categories` changes from empty → populated.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("discovery_categories")
        .select("id, name")
        .order("sort_order");
      if (!cancelled && data) setCategories(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!categoryId && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(strategy?.strategy_types ?? []);
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>(strategy?.subtypes ?? []);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(strategy?.markets ?? []);
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(strategy?.supported_exchanges ?? []);
  const [leverageRange, setLeverageRange] = useState(strategy?.leverage_range ?? "");
  const [aum, setAum] = useState(strategy?.aum?.toString() ?? "");
  const [maxCapacity, setMaxCapacity] = useState(strategy?.max_capacity?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataSource, setDataSource] = useState<"none" | "api" | "csv">(strategy?.api_key_id ? "api" : "none");
  const [showApiModal, setShowApiModal] = useState(false);
  const [showNoApiWarning, setShowNoApiWarning] = useState(false);
  const [apiExchange, setApiExchange] = useState("binance");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(!!strategy?.api_key_id);
  // KEYLINK-01: the id of the `api_keys` row the SERVER minted for this
  // session's connect. Before this state existed the id was destructured off the
  // response, type-checked, and then DROPPED — nothing ever carried it to a
  // `strategies` row. The key was billed against the user's quota,
  // `strategies.api_key_id` stayed NULL, no sync was ever enqueued, and the
  // button still flipped to "API Key Connected". It seeds from the strategy so
  // this and `apiConnected` can never disagree about WHICH key is attached.
  const [connectedKeyId, setConnectedKeyId] = useState<string | null>(
    strategy?.api_key_id ?? null,
  );
  const router = useRouter();

  function toggleItem(list: string[], item: string, setter: (v: string[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  async function handleApiKeySubmit() {
    setApiLoading(true);
    setApiError(null);
    try {
      // F4 (Phase 122): canonicalize the exchange to lowercase at the ONE point
      // it enters the validate path — the api_keys DB CHECK and the Python
      // /validate-key intercept both key on lowercase, so a display-cased value
      // must never reach either. The Select value is already lowercase today; this
      // is the explicit chokepoint mirroring the wizard routes' toLowerCase().
      //
      // 160-03 / RANK-03: the INSERT this value used to also feed is GONE — the
      // route writes the row now and re-normalizes independently at its own
      // chokepoint (`exchangeNormalized`). This stays because it is what the
      // request body carries, and a component that sends a canonical venue is
      // one less place a stray casing can originate.
      const exchangeCanonical = apiExchange.trim().toLowerCase();
      const res = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: exchangeCanonical,
          api_key: apiKey,
          api_secret: apiSecret,
          passphrase: apiPassphrase || null,
          // 160-03 / RANK-03 — the persist discriminator. With it, the route
          // writes the api_keys row ITSELF, stamping `exchange` AND
          // `attested_venue` from the venue its own validateKey call
          // authenticated against, and returns `{ api_key_id }` with NO
          // ciphertext. The label moves into the body because the server now
          // composes the row; the template is this component's pre-existing
          // default, preserved verbatim.
          persist: true,
          label: `${exchangeCanonical} key`,
        }),
      });
      if (!res.ok) {
        // The route's error bodies are CURATED on every arm — the persist arm
        // scrubs the raw PostgREST message at both log sinks and never places
        // it in the response (160-02, route.ts). The H-0405 leak this component
        // used to guard against was its OWN browser-composed insert error;
        // that writer, and with it that error, no longer exists here.
        const err = await res.json().catch(() => ({ error: "Validation failed" }));
        throw new Error(err.error || "Key validation failed");
      }
      const { api_key_id: newKeyId } = await res.json();

      if (typeof newKeyId !== "string") {
        // Rule 12 / fail loud. A 2xx carrying no id means the server did not
        // persist — reporting the key as connected would leave the user
        // believing a key exists that will never sync.
        throw new Error("Your key was verified but not saved. Please try again.");
      }

      // KEYLINK-01 — PERSIST THE LINK BEFORE CLAIMING IT.
      //
      // In edit mode the `strategies` row already exists, so the attach happens
      // HERE and not at form submit. The button below reads "API Key Connected"
      // the instant this function resolves; a user who then navigates away — or
      // simply never presses Save — must not be looking at a claim the database
      // cannot confirm. Deferring the write to handleSubmit leaves exactly that
      // window open, which is the same false-success one layer down.
      //
      // It also closes the mint loop. `apiConnected` initialises from
      // `strategy?.api_key_id`; for as long as that column stayed NULL, every
      // reload re-enabled the button and every retry minted ANOTHER `api_keys`
      // row against the user's quota.
      //
      // Throwing is the point (this mirrors ApiKeyManager's NEW-C37-03 arm): the
      // catch below leaves `apiConnected` false and puts the reason in
      // `apiError`, so a link that failed can never render as a connected key.
      if (mode === "edit") {
        if (!strategy) {
          // Rule 12 / fail loud. "edit" with no strategy has no row to attach
          // to; skipping the write silently is precisely the false-success this
          // block exists to remove.
          throw new Error(toUserFacingStrategyError({}, "link"));
        }
        const supabase = createClient();
        const { error: linkError } = await supabase
          .from("strategies")
          .update({ api_key_id: newKeyId })
          .eq("id", strategy.id);
        if (linkError) {
          throw new Error(toUserFacingStrategyError(linkError, "link"));
        }
      }

      // Create mode has no row to attach to yet, so the id is held here and
      // rides in on the INSERT that handleSubmit composes (see the payload).
      setConnectedKeyId(newKeyId);
      setApiConnected(true);
      setDataSource("api");
      setShowApiModal(false);
      setApiKey("");
      setApiSecret("");
      setApiPassphrase("");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to connect key");
    } finally {
      setApiLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // If no data source and creating, show warning
    if (mode === "create" && !apiConnected && dataSource !== "csv") {
      setShowNoApiWarning(true);
      return;
    }

    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not authenticated"); setLoading(false); return; }

    const payload = {
      user_id: user.id,
      name,
      description: description || null,
      category_id: categoryId || null,
      strategy_types: selectedTypes,
      subtypes: selectedSubtypes,
      markets: selectedMarkets,
      supported_exchanges: selectedExchanges,
      leverage_range: leverageRange || null,
      aum: aum ? parseFloat(aum) : null,
      max_capacity: maxCapacity ? parseFloat(maxCapacity) : null,
      // KEYLINK-01: create mode has no `strategies` row at connect time, so the
      // id the server minted can only reach the database here. Edit mode is
      // deliberately EXCLUDED — handleApiKeySubmit already wrote that link and
      // threw if it could not, and a second writer for the same column is a
      // second place the two writes can silently disagree.
      ...(mode === "create" && connectedKeyId ? { api_key_id: connectedKeyId } : {}),
    };

    if (mode === "create") {
      const { error } = await supabase.from("strategies").insert(payload);
      if (error) { setError(toUserFacingStrategyError(error)); setLoading(false); return; }
    } else if (strategy) {
      const { error } = await supabase.from("strategies").update(payload).eq("id", strategy.id);
      if (error) { setError(toUserFacingStrategyError(error)); setLoading(false); return; }
    }

    router.push("/strategies");
    router.refresh();
  }

  function proceedWithoutApi() {
    setShowNoApiWarning(false);
    setDataSource("csv");
    // Re-trigger submit
    const form = document.querySelector("form");
    if (form) form.requestSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Strategy Details</h2>
        <div className="space-y-4">
          <Select
            label="Strategy Name"
            options={STRATEGY_NAMES.map((n) => ({ value: n, label: n }))}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe your strategy..."
          />
          <Select
            label="Category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Classification</h2>
        <div className="space-y-4">
          <ChipGroup label="Strategy Types" items={[...STRATEGY_TYPES]} selected={selectedTypes} onToggle={(t) => toggleItem(selectedTypes, t, setSelectedTypes)} />
          <ChipGroup label="Subtypes" items={[...SUBTYPES]} selected={selectedSubtypes} onToggle={(t) => toggleItem(selectedSubtypes, t, setSelectedSubtypes)} />
          <ChipGroup label="Markets" items={[...MARKETS]} selected={selectedMarkets} onToggle={(t) => toggleItem(selectedMarkets, t, setSelectedMarkets)} />
          <ChipGroup label="Exchanges" items={[...EXCHANGES]} selected={selectedExchanges} onToggle={(t) => toggleItem(selectedExchanges, t, setSelectedExchanges)} />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Parameters</h2>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Leverage Range" value={leverageRange} onChange={(e) => setLeverageRange(e.target.value)} placeholder="e.g. 1x - 5x" />
          <Input label="AUM ($)" value={aum} onChange={(e) => setAum(e.target.value)} type="number" placeholder="0" />
          <Input label="Max Capacity ($)" value={maxCapacity} onChange={(e) => setMaxCapacity(e.target.value)} type="number" placeholder="0" />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Data Source</h2>
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 mb-4">
          <p className="text-sm font-medium text-text-primary mb-1">
            Teams with verified API data get 3x more allocator interviews
          </p>
          <p className="text-xs text-text-muted">
            Connecting a read-only exchange API key proves your track record is real.
            Allocators trust verified data significantly more than self-reported PnL.
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={() => setShowApiModal(true)}
            disabled={apiConnected}
          >
            {apiConnected ? "API Key Connected" : "Connect API Key"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDataSource("csv")}
            disabled={dataSource === "csv"}
          >
            {dataSource === "csv" ? "CSV Selected" : "Upload CSV"}
          </Button>
        </div>
        {apiConnected && (
          <p className="text-xs text-positive mt-2">Read-only API key verified and connected.</p>
        )}
        {dataSource === "csv" && !apiConnected && (
          <p className="text-xs text-text-muted mt-2">You can upload your trade CSV after creating the strategy.</p>
        )}
      </Card>

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex gap-3">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : mode === "create" ? "Create Strategy" : "Save Changes"}
        </Button>
      </div>

      {/* API Key Modal */}
      <Modal open={showApiModal} onClose={() => setShowApiModal(false)} title="Connect Exchange API Key">
        <div className="space-y-4">
          <Select
            label="Exchange"
            options={EXCHANGE_OPTIONS}
            value={apiExchange}
            onChange={(e) => setApiExchange(e.target.value)}
          />
          <Input
            label="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Your read-only API key"
            autoComplete="off"
          />
          <Input
            label="API Secret"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="Your API secret"
            type="password"
            autoComplete="off"
          />
          {apiExchange === "okx" && (
            <Input
              label="Passphrase (OKX)"
              value={apiPassphrase}
              onChange={(e) => setApiPassphrase(e.target.value)}
              placeholder="OKX passphrase"
              type="password"
              autoComplete="off"
            />
          )}
          <p className="text-xs text-text-muted">
            Only read-only keys are accepted. Keys with trading or withdrawal permissions will be rejected.
          </p>
          {apiError && <p className="text-sm text-negative">{apiError}</p>}
          <div className="flex gap-3">
            <Button variant="secondary" type="button" onClick={() => setShowApiModal(false)}>Cancel</Button>
            <Button type="button" onClick={handleApiKeySubmit} disabled={apiLoading || !apiKey || !apiSecret}>
              {apiLoading ? "Validating..." : "Connect Key"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* No API Warning Modal */}
      <Modal open={showNoApiWarning} onClose={() => setShowNoApiWarning(false)} title="Connect Your Data">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            You haven&apos;t connected an API key. Strategies with verified exchange data get significantly more attention from allocators.
          </p>
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
            <p className="text-sm font-medium text-text-primary mb-1">
              Teams with verified API data get 3x more allocator interviews
            </p>
            <p className="text-xs text-text-muted">
              Connecting a read-only exchange API key proves your track record is real.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button type="button" onClick={() => { setShowNoApiWarning(false); setShowApiModal(true); }}>
              Connect API Key (recommended)
            </Button>
            <Button type="button" variant="secondary" onClick={proceedWithoutApi}>
              Continue without API key
            </Button>
          </div>
        </div>
      </Modal>
    </form>
  );
}

function ChipGroup({ label, items, selected, onToggle }: {
  label: string; items: string[]; selected: string[]; onToggle: (item: string) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-text-primary mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onToggle(item)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
              selected.includes(item)
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-muted hover:border-accent/50"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
