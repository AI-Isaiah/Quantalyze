"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { STRATEGY_TYPES, SUBTYPES, MARKETS, EXCHANGES, DISCOVERY_CATEGORIES } from "@/lib/constants";
import type { Strategy } from "@/lib/types";

interface StrategyFormProps {
  strategy?: Strategy;
  mode: "create" | "edit";
}

export function StrategyForm({ strategy, mode }: StrategyFormProps) {
  const [name, setName] = useState(strategy?.name ?? "");
  const [description, setDescription] = useState(strategy?.description ?? "");
  const [categorySlug, setCategorySlug] = useState<string>(
    DISCOVERY_CATEGORIES[0].slug
  );
  const [selectedTypes, setSelectedTypes] = useState<string[]>(strategy?.strategy_types ?? []);
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>(strategy?.subtypes ?? []);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(strategy?.markets ?? []);
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(strategy?.supported_exchanges ?? []);
  const [leverageRange, setLeverageRange] = useState(strategy?.leverage_range ?? "");
  const [aum, setAum] = useState(strategy?.aum?.toString() ?? "");
  const [maxCapacity, setMaxCapacity] = useState(strategy?.max_capacity?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function toggleItem(list: string[], item: string, setter: (v: string[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not authenticated"); setLoading(false); return; }

    // Resolve category slug to ID
    const { data: catData } = await supabase
      .from("discovery_categories")
      .select("id")
      .eq("slug", categorySlug)
      .single();

    const payload = {
      user_id: user.id,
      name,
      description: description || null,
      category_id: catData?.id ?? null,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Strategy Details</h2>
        <div className="space-y-4">
          <Input label="Strategy Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe your strategy..."
          />
          <Select
            label="Category"
            options={DISCOVERY_CATEGORIES.map((c) => ({ value: c.slug, label: c.name }))}
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
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

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex gap-3">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : mode === "create" ? "Create Strategy" : "Save Changes"}
        </Button>
      </div>
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
