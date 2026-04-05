"use client";

import { STRATEGY_TYPES } from "@/lib/constants";

interface StrategyFiltersProps {
  selectedType: string;
  onTypeChange: (type: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  showExamples: boolean;
  onToggleExamples: () => void;
}

export function StrategyFilters({
  selectedType,
  onTypeChange,
  search,
  onSearchChange,
  showExamples,
  onToggleExamples,
}: StrategyFiltersProps) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-page pb-4">
      <select
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
      >
        <option value="">All Types</option>
        {STRATEGY_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search strategies..."
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted w-64"
      />

      <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer ml-auto">
        <input
          type="checkbox"
          checked={!showExamples}
          onChange={onToggleExamples}
          className="rounded accent-accent"
        />
        Hide examples
      </label>

      {(selectedType || search) && (
        <button
          onClick={() => { onTypeChange(""); onSearchChange(""); }}
          className="text-sm text-accent hover:text-accent-hover"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
