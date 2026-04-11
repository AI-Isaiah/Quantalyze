"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import {
  STRATEGY_NAMES,
  STRATEGY_TYPES,
  SUBTYPES,
  MARKETS,
  EXCHANGES,
} from "@/lib/constants";

/**
 * MetadataStep collects the metadata the founder needs to approve a
 * wizard-submitted strategy. `markets` is pre-filled from detected
 * trades when available; `supported_exchanges` is pre-filled from the
 * Step 1 exchange selection.
 */

export interface MetadataDraft {
  name: string | null;
  description: string;
  categoryId: string | null;
  strategyTypes: string[];
  subtypes: string[];
  markets: string[];
  supportedExchanges: string[];
  leverageRange: string;
  aum: string;
  maxCapacity: string;
}

export interface MetadataStepProps {
  strategyId: string;
  wizardSessionId: string;
  /** Pre-populated draft when the user is resuming from a server-side row. */
  initial: MetadataDraft | null;
  /** Market tags detected from real trades in Step 2. */
  detectedMarkets: string[];
  /** Exchange selected at Step 1. */
  detectedExchange: string | null;
  onComplete: (draft: MetadataDraft) => void;
  onBack: () => void;
}

export function MetadataStep({
  initial,
  detectedMarkets,
  detectedExchange,
  onComplete,
  onBack,
}: MetadataStepProps) {
  const [name, setName] = useState<string>(initial?.name ?? STRATEGY_NAMES[0]);
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.categoryId ?? null,
  );
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [strategyTypes, setStrategyTypes] = useState<string[]>(
    initial?.strategyTypes ?? [],
  );
  const [subtypes, setSubtypes] = useState<string[]>(initial?.subtypes ?? []);
  const [markets, setMarkets] = useState<string[]>(initial?.markets ?? []);
  const [supportedExchanges, setSupportedExchanges] = useState<string[]>(
    initial?.supportedExchanges ??
      (detectedExchange ? [capitalize(detectedExchange)] : []),
  );
  const [leverageRange, setLeverageRange] = useState<string>(
    initial?.leverageRange ?? "",
  );
  const [aum, setAum] = useState<string>(initial?.aum ?? "");
  const [maxCapacity, setMaxCapacity] = useState<string>(initial?.maxCapacity ?? "");
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("discovery_categories")
          .select("id, name")
          .order("sort_order");
        if (cancelled) return;
        if (error) {
          setCategoryLoadError("Could not load strategy categories.");
          return;
        }
        setCategories(data ?? []);
        if (!categoryId && data && data.length > 0) {
          setCategoryId(data[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setCategoryLoadError("Could not load strategy categories.");
          console.error("[wizard:MetadataStep] category fetch:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(list: string[], item: string, setter: (v: string[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onComplete({
      name,
      description,
      categoryId,
      strategyTypes,
      subtypes,
      markets,
      supportedExchanges,
      leverageRange,
      aum,
      maxCapacity,
    });
  }

  return (
    <section aria-labelledby="wizard-metadata-heading">
      <h2
        id="wizard-metadata-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        Tell allocators what this strategy is
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        We pre-filled what we could detect from your trades. Fill in the rest so
        allocators can evaluate the fit.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <Select
          label="Strategy codename"
          options={STRATEGY_NAMES.map((n) => ({ value: n, label: n }))}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="One paragraph describing the strategy, edge, and risk framing."
          required
        />

        <Select
          label="Category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value)}
        />
        {categoryLoadError && (
          <p className="text-xs text-negative" role="alert">
            {categoryLoadError} Refresh the page. If this persists, contact
            security@quantalyze.com.
          </p>
        )}

        <InlineChipGroup
          label="Strategy Types"
          items={[...STRATEGY_TYPES]}
          selected={strategyTypes}
          onToggle={(item) => toggle(strategyTypes, item, setStrategyTypes)}
        />

        <InlineChipGroup
          label="Subtypes"
          items={[...SUBTYPES]}
          selected={subtypes}
          onToggle={(item) => toggle(subtypes, item, setSubtypes)}
        />

        <div>
          <InlineChipGroup
            label="Markets"
            items={[...MARKETS]}
            selected={markets}
            onToggle={(item) => toggle(markets, item, setMarkets)}
          />
          {detectedMarkets.length === 0 && (
            <p className="mt-2 text-[11px] text-text-muted">
              We could not identify the markets from your trades — please select
              manually.
            </p>
          )}
          {detectedMarkets.length > 0 && (
            <p className="mt-2 text-[11px] text-text-muted">
              Detected from your trade history: {detectedMarkets.join(", ")}.
            </p>
          )}
        </div>

        <InlineChipGroup
          label="Supported exchanges"
          items={[...EXCHANGES]}
          selected={supportedExchanges}
          onToggle={(item) =>
            toggle(supportedExchanges, item, setSupportedExchanges)
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            label="Leverage range"
            value={leverageRange}
            onChange={(e) => setLeverageRange(e.target.value)}
            placeholder="e.g. 1x–5x"
          />
          <Input
            label="AUM (USD)"
            type="number"
            value={aum}
            onChange={(e) => setAum(e.target.value)}
            placeholder="0"
          />
          <Input
            label="Max capacity (USD)"
            type="number"
            value={maxCapacity}
            onChange={(e) => setMaxCapacity(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" type="button" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" disabled={!description || !categoryId}>
            Review and submit
          </Button>
        </div>
      </form>
    </section>
  );
}

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface InlineChipGroupProps {
  label: string;
  items: string[];
  selected: string[];
  onToggle: (item: string) => void;
}

function InlineChipGroup({ label, items, selected, onToggle }: InlineChipGroupProps) {
  return (
    <div>
      <p className="text-xs font-medium text-text-primary">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              onClick={() => onToggle(item)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-text-muted hover:border-accent/50"
              }`}
              aria-pressed={active}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}
