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

const EXCHANGE_OPTIONS = EXCHANGES.map((e) => ({ value: e.toLowerCase(), label: e }));

interface StrategyFormProps {
  strategy?: Strategy;
  mode: "create" | "edit";
}

export function StrategyForm({ strategy, mode }: StrategyFormProps) {
  const [name, setName] = useState(strategy?.name ?? STRATEGY_NAMES[0]);
  const [description, setDescription] = useState(strategy?.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(strategy?.category_id ?? "");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    async function loadCategories() {
      const supabase = createClient();
      const { data } = await supabase.from("discovery_categories").select("id, name").order("sort_order");
      if (data) {
        setCategories(data);
        if (!categoryId && data.length > 0) setCategoryId(data[0].id);
      }
    }
    loadCategories();
  }, []);
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
  const router = useRouter();

  function toggleItem(list: string[], item: string, setter: (v: string[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  async function handleApiKeySubmit() {
    setApiLoading(true);
    setApiError(null);
    try {
      const res = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: apiExchange,
          api_key: apiKey,
          api_secret: apiSecret,
          passphrase: apiPassphrase || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Validation failed" }));
        throw new Error(err.error || "Key validation failed");
      }
      const encrypted = await res.json();
      const { valid, read_only, ...dbFields } = encrypted;

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error: insertError } = await supabase.from("api_keys").insert({
        user_id: user.id,
        exchange: apiExchange,
        label: `${apiExchange} key`,
        ...dbFields,
      });
      if (insertError) throw new Error(insertError.message);

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
    };

    if (mode === "create") {
      const { error } = await supabase.from("strategies").insert(payload);
      if (error) { setError(error.message); setLoading(false); return; }
    } else if (strategy) {
      const { error } = await supabase.from("strategies").update(payload).eq("id", strategy.id);
      if (error) { setError(error.message); setLoading(false); return; }
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
