"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { EXCHANGES } from "@/lib/constants";
import type { AllocatorPreferences } from "@/lib/preferences";

interface PreferenceFormProps {
  initial: AllocatorPreferences | null;
}

export function PreferenceForm({ initial }: PreferenceFormProps) {
  const router = useRouter();
  const [archetype, setArchetype] = useState(initial?.mandate_archetype ?? "");
  const [ticketSize, setTicketSize] = useState<string>(
    initial?.target_ticket_size_usd != null
      ? String(initial.target_ticket_size_usd)
      : "",
  );
  const [excludedExchanges, setExcludedExchanges] = useState<string[]>(
    initial?.excluded_exchanges ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleExchange(exchange: string) {
    setExcludedExchanges((prev) =>
      prev.includes(exchange)
        ? prev.filter((e) => e !== exchange)
        : [...prev, exchange],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const ticketSizeNum =
      ticketSize.trim() === "" ? null : Number(ticketSize);
    if (ticketSizeNum !== null && Number.isNaN(ticketSizeNum)) {
      setError("Ticket size must be a number");
      setSaving(false);
      return;
    }

    const res = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mandate_archetype: archetype.trim() || null,
        target_ticket_size_usd: ticketSizeNum,
        excluded_exchanges: excludedExchanges,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to save");
      setSaving(false);
      return;
    }

    setSavedAt(new Date().toLocaleTimeString());
    setSaving(false);
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
            Why we ask
          </p>
          <p className="text-sm text-text-secondary leading-relaxed">
            These three answers help us send you better strategy recommendations.
            Everything is optional. Leave any field blank if you&apos;d rather
            tell us in person — we&apos;ll fill it in over time.
          </p>
        </div>

        <Textarea
          label="Mandate (one sentence)"
          placeholder="e.g. diversified crypto SMA, low-drawdown, $10M+ capacity"
          value={archetype}
          onChange={(e) => setArchetype(e.target.value)}
          rows={2}
          maxLength={500}
        />

        <Input
          label="Typical ticket size (USD)"
          type="number"
          placeholder="50000"
          value={ticketSize}
          onChange={(e) => setTicketSize(e.target.value)}
          min={0}
        />

        <div>
          <p className="text-sm font-medium text-text-primary mb-2">
            Excluded exchanges
          </p>
          <p className="text-xs text-text-secondary mb-3">
            If your compliance excludes any of these, we won&apos;t recommend
            strategies that trade on them.
          </p>
          <div className="flex flex-wrap gap-2">
            {EXCHANGES.map((exchange) => {
              const checked = excludedExchanges.includes(exchange);
              return (
                <label
                  key={exchange}
                  className={`flex items-center gap-1.5 text-sm cursor-pointer rounded-md border px-3 py-1.5 transition-colors ${
                    checked
                      ? "border-negative bg-negative/10 text-negative"
                      : "border-border bg-surface text-text-secondary hover:border-border-focus"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleExchange(exchange)}
                    className="sr-only"
                  />
                  {exchange}
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <p className="text-sm text-negative">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save preferences"}
          </Button>
          {savedAt && (
            <span className="text-xs text-text-muted">
              Saved at {savedAt}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
