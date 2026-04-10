"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface StrategyRow {
  strategy_id: string;
  strategy: {
    id: string;
    name: string;
    codename: string | null;
    disclosure_tier: string;
  };
}

export function AliasEditor({
  row,
  portfolioId,
  initial,
  canonical,
}: {
  row: StrategyRow;
  portfolioId: string;
  initial: string | null;
  canonical: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-strategies/alias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          strategy_id: row.strategy_id,
          alias: value.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(initial ?? "");
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    const shown = initial?.trim() || canonical;
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href={`/strategies/${row.strategy.id}`}
          className="font-medium text-text-primary hover:text-accent transition-colors truncate"
          title={canonical}
        >
          {shown}
        </Link>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-text-muted hover:text-accent transition-colors"
          aria-label={`Rename ${shown}`}
          title="Rename this investment"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <path d="M11.5 2.5l2 2L6 12l-3 .5L3.5 9.5z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        placeholder={canonical}
        autoFocus
        maxLength={120}
        disabled={saving}
        className="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-sm font-medium bg-surface focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="text-xs px-2 py-1 rounded border border-accent bg-accent text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {saving ? "..." : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary"
      >
        Cancel
      </button>
      {error && <span className="text-[10px] text-negative">{error}</span>}
    </div>
  );
}
