"use client";

import { useState, useCallback } from "react";
import { STRATEGY_TYPES, SUBTYPES, MARKETS, EXCHANGES } from "@/lib/constants";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

// --- Types ---

export type SortKey =
  | "computed_at"
  | "cumulative_return"
  | "cagr"
  | "sharpe"
  | "max_drawdown"
  | "volatility"
  | "aum";

export type SortDir = "asc" | "desc";
export type ViewMode = "table" | "grid";

export interface RangeFilter {
  from: string;
  to: string;
}

export interface AdvancedFilters {
  types: string[];
  subtypes: string[];
  markets: string[];
  exchanges: string[];
  minTrackRecord: string;
  aum: RangeFilter;
  maxCapacity: RangeFilter;
  cumulativeReturn: RangeFilter;
  cagr: RangeFilter;
  maxDrawdown: RangeFilter;
  volatility: RangeFilter;
  sharpe: RangeFilter;
  sixMonth: RangeFilter;
  threeMonth: RangeFilter;
  calmar: RangeFilter;
}

export const EMPTY_ADVANCED_FILTERS: AdvancedFilters = {
  types: [],
  subtypes: [],
  markets: [],
  exchanges: [],
  minTrackRecord: "",
  aum: { from: "", to: "" },
  maxCapacity: { from: "", to: "" },
  cumulativeReturn: { from: "", to: "" },
  cagr: { from: "", to: "" },
  maxDrawdown: { from: "", to: "" },
  volatility: { from: "", to: "" },
  sharpe: { from: "", to: "" },
  sixMonth: { from: "", to: "" },
  threeMonth: { from: "", to: "" },
  calmar: { from: "", to: "" },
};

export interface CustomizeSettings {
  defaultView: ViewMode;
  defaultSortKey: SortKey;
  defaultSortDir: SortDir;
  hideExamples: boolean;
}

export const DEFAULT_CUSTOMIZE: CustomizeSettings = {
  defaultView: "table",
  defaultSortKey: "sharpe",
  defaultSortDir: "desc",
  hideExamples: false,
};

// --- Props ---

interface StrategyFiltersProps {
  search: string;
  onSearchChange: (search: string) => void;
  showExamples: boolean;
  onToggleExamples: () => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  sortDir: SortDir;
  onSortDirChange: (dir: SortDir) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  advancedFilters: AdvancedFilters;
  onAdvancedFiltersChange: (filters: AdvancedFilters) => void;
}

// --- Sort options ---

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "computed_at", label: "Last Date" },
  { value: "cumulative_return", label: "Return" },
  { value: "cagr", label: "CAGR" },
  { value: "sharpe", label: "Sharpe" },
  { value: "max_drawdown", label: "Max DD" },
  { value: "volatility", label: "Volatility" },
  { value: "aum", label: "AUM" },
];

const SORT_DIR_OPTIONS: { value: SortDir; label: string }[] = [
  { value: "desc", label: "High to low" },
  { value: "asc", label: "Low to high" },
];

// --- Helpers ---

function hasActiveAdvancedFilters(f: AdvancedFilters): boolean {
  if (f.types.length > 0) return true;
  if (f.subtypes.length > 0) return true;
  if (f.markets.length > 0) return true;
  if (f.exchanges.length > 0) return true;
  if (f.minTrackRecord !== "") return true;
  const ranges: RangeFilter[] = [
    f.aum, f.maxCapacity, f.cumulativeReturn, f.cagr,
    f.maxDrawdown, f.volatility, f.sharpe, f.sixMonth,
    f.threeMonth, f.calmar,
  ];
  return ranges.some((r) => r.from !== "" || r.to !== "");
}

function countActiveFilters(f: AdvancedFilters): number {
  let count = f.types.length + f.subtypes.length + f.markets.length + f.exchanges.length;
  if (f.minTrackRecord !== "") count++;
  const ranges: RangeFilter[] = [
    f.aum, f.maxCapacity, f.cumulativeReturn, f.cagr,
    f.maxDrawdown, f.volatility, f.sharpe, f.sixMonth,
    f.threeMonth, f.calmar,
  ];
  count += ranges.filter((r) => r.from !== "" || r.to !== "").length;
  return count;
}

// --- Checkbox group ---

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const checked = selected.includes(opt);
          return (
            <label
              key={opt}
              className={`flex items-center gap-1.5 text-sm cursor-pointer rounded-md border px-2.5 py-1.5 transition-colors ${
                checked
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-text-secondary hover:border-border-focus"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (checked) {
                    onChange(selected.filter((s) => s !== opt));
                  } else {
                    onChange([...selected, opt]);
                  }
                }}
                className="sr-only"
              />
              {opt}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// --- Range input pair ---

function RangeInput({
  label,
  range,
  onChange,
}: {
  label: string;
  range: RangeFilter;
  onChange: (range: RangeFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-text-secondary w-28 shrink-0">{label}</span>
      <input
        type="number"
        placeholder="From"
        value={range.from}
        onChange={(e) => onChange({ ...range, from: e.target.value })}
        className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted"
      />
      <span className="text-text-muted text-xs">to</span>
      <input
        type="number"
        placeholder="To"
        value={range.to}
        onChange={(e) => onChange({ ...range, to: e.target.value })}
        className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted"
      />
    </div>
  );
}

// --- Icons ---

function TableIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className={active ? "text-accent" : "text-text-muted"}
    >
      <rect x="1" y="1" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="12" x2="17" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7" y1="1" x2="7" y2="17" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className={active ? "text-accent" : "text-text-muted"}
    >
      <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// --- Main component ---

export function StrategyFilters({
  search,
  onSearchChange,
  showExamples,
  onToggleExamples,
  sortKey,
  onSortKeyChange,
  sortDir,
  onSortDirChange,
  viewMode,
  onViewModeChange,
  advancedFilters,
  onAdvancedFiltersChange,
}: StrategyFiltersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilters>(advancedFilters);

  const openFilters = useCallback(() => {
    setDraft(advancedFilters);
    setFiltersOpen(true);
  }, [advancedFilters]);

  const applyFilters = useCallback(() => {
    onAdvancedFiltersChange(draft);
    setFiltersOpen(false);
  }, [draft, onAdvancedFiltersChange]);

  const clearAll = useCallback(() => {
    onAdvancedFiltersChange(EMPTY_ADVANCED_FILTERS);
    onSearchChange("");
    setFiltersOpen(false);
  }, [onAdvancedFiltersChange, onSearchChange]);

  const activeCount = countActiveFilters(advancedFilters);
  const hasAdvanced = hasActiveAdvancedFilters(advancedFilters);

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-page pb-4">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search strategies..."
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted w-64"
        />

        {/* All Filters button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={openFilters}
          className="relative"
        >
          All Filters
          {activeCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold w-4.5 h-4.5 min-w-[18px] px-1">
              {activeCount}
            </span>
          )}
        </Button>

        {/* Hide examples toggle */}
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={!showExamples}
            onChange={onToggleExamples}
            className="rounded accent-accent"
          />
          Hide examples
        </label>

        {/* Sort by */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-text-muted">Sort:</span>
          <select
            value={sortKey}
            onChange={(e) => onSortKeyChange(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={sortDir}
            onChange={(e) => onSortDirChange(e.target.value as SortDir)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary"
          >
            {SORT_DIR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Customize button */}
        <Button variant="ghost" size="sm" onClick={() => setCustomizeOpen(true)}>
          Customize
        </Button>

        {/* View toggle */}
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange("table")}
            className={`p-1.5 rounded transition-colors ${viewMode === "table" ? "bg-accent/10" : "hover:bg-page"}`}
            aria-label="Table view"
          >
            <TableIcon active={viewMode === "table"} />
          </button>
          <button
            onClick={() => onViewModeChange("grid")}
            className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-accent/10" : "hover:bg-page"}`}
            aria-label="Grid view"
          >
            <GridIcon active={viewMode === "grid"} />
          </button>
        </div>

        {/* Clear link */}
        {(search || hasAdvanced) && (
          <button
            onClick={clearAll}
            className="text-sm text-accent hover:text-accent-hover"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* All Filters slide-out panel */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setFiltersOpen(false)}
          />
          {/* Panel */}
          <div className="relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">All Filters</h2>
              <button
                onClick={() => setFiltersOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M15 5L5 15M5 5l10 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Types */}
              <CheckboxGroup
                label="Types"
                options={STRATEGY_TYPES}
                selected={draft.types}
                onChange={(types) => setDraft({ ...draft, types })}
              />

              {/* Subtypes */}
              <CheckboxGroup
                label="Subtypes"
                options={SUBTYPES}
                selected={draft.subtypes}
                onChange={(subtypes) => setDraft({ ...draft, subtypes })}
              />

              {/* Markets */}
              <CheckboxGroup
                label="Markets"
                options={MARKETS}
                selected={draft.markets}
                onChange={(markets) => setDraft({ ...draft, markets })}
              />

              {/* Exchanges */}
              <CheckboxGroup
                label="Exchanges"
                options={EXCHANGES}
                selected={draft.exchanges}
                onChange={(exchanges) => setDraft({ ...draft, exchanges })}
              />

              {/* Track Record */}
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Min Track Record
                </p>
                <select
                  value={draft.minTrackRecord}
                  onChange={(e) => setDraft({ ...draft, minTrackRecord: e.target.value })}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary w-full"
                >
                  <option value="">Any</option>
                  <option value="30">1 month+</option>
                  <option value="90">3 months+</option>
                  <option value="180">6 months+</option>
                  <option value="365">1 year+</option>
                  <option value="730">2 years+</option>
                </select>
              </div>

              {/* Capital Metrics */}
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Capital Metrics
                </p>
                <div className="space-y-2.5">
                  <RangeInput
                    label="AUM ($)"
                    range={draft.aum}
                    onChange={(aum) => setDraft({ ...draft, aum })}
                  />
                  <RangeInput
                    label="Max Capacity ($)"
                    range={draft.maxCapacity}
                    onChange={(maxCapacity) => setDraft({ ...draft, maxCapacity })}
                  />
                </div>
              </div>

              {/* Performance Metrics */}
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Performance Metrics
                </p>
                <div className="space-y-2.5">
                  <RangeInput
                    label="Return %"
                    range={draft.cumulativeReturn}
                    onChange={(cumulativeReturn) => setDraft({ ...draft, cumulativeReturn })}
                  />
                  <RangeInput
                    label="CAGR %"
                    range={draft.cagr}
                    onChange={(cagr) => setDraft({ ...draft, cagr })}
                  />
                  <RangeInput
                    label="Max DD %"
                    range={draft.maxDrawdown}
                    onChange={(maxDrawdown) => setDraft({ ...draft, maxDrawdown })}
                  />
                  <RangeInput
                    label="Volatility %"
                    range={draft.volatility}
                    onChange={(volatility) => setDraft({ ...draft, volatility })}
                  />
                  <RangeInput
                    label="Sharpe"
                    range={draft.sharpe}
                    onChange={(sharpe) => setDraft({ ...draft, sharpe })}
                  />
                  <RangeInput
                    label="6M %"
                    range={draft.sixMonth}
                    onChange={(sixMonth) => setDraft({ ...draft, sixMonth })}
                  />
                  <RangeInput
                    label="3M %"
                    range={draft.threeMonth}
                    onChange={(threeMonth) => setDraft({ ...draft, threeMonth })}
                  />
                  <RangeInput
                    label="Calmar"
                    range={draft.calmar}
                    onChange={(calmar) => setDraft({ ...draft, calmar })}
                  />
                </div>
              </div>
            </div>

            {/* Apply button */}
            <div className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex items-center gap-3">
              <Button variant="primary" onClick={applyFilters} className="flex-1">
                Apply filters
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(EMPTY_ADVANCED_FILTERS);
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Customize modal */}
      <CustomizeModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        sortKey={sortKey}
        onSortKeyChange={onSortKeyChange}
        sortDir={sortDir}
        onSortDirChange={onSortDirChange}
        showExamples={showExamples}
        onToggleExamples={onToggleExamples}
      />
    </>
  );
}

// --- Customize modal ---

function CustomizeModal({
  open,
  onClose,
  viewMode,
  onViewModeChange,
  sortKey,
  onSortKeyChange,
  sortDir,
  onSortDirChange,
  showExamples,
  onToggleExamples,
}: {
  open: boolean;
  onClose: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  sortDir: SortDir;
  onSortDirChange: (dir: SortDir) => void;
  showExamples: boolean;
  onToggleExamples: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Customize View">
      <div className="space-y-5">
        {/* Default view */}
        <div>
          <p className="text-sm font-medium text-text-primary mb-2">Default view</p>
          <div className="flex gap-2">
            <button
              onClick={() => onViewModeChange("table")}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                viewMode === "table"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-text-secondary hover:border-border-focus"
              }`}
            >
              Table
            </button>
            <button
              onClick={() => onViewModeChange("grid")}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                viewMode === "grid"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-text-secondary hover:border-border-focus"
              }`}
            >
              Grid
            </button>
          </div>
        </div>

        {/* Default sorting */}
        <div>
          <p className="text-sm font-medium text-text-primary mb-2">Default sorting</p>
          <div className="flex gap-2">
            <select
              value={sortKey}
              onChange={(e) => onSortKeyChange(e.target.value as SortKey)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary flex-1"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={sortDir}
              onChange={(e) => onSortDirChange(e.target.value as SortDir)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary flex-1"
            >
              {SORT_DIR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Hide examples */}
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={!showExamples}
            onChange={onToggleExamples}
            className="rounded accent-accent"
          />
          Hide examples
        </label>

        <div className="pt-2">
          <Button variant="primary" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
