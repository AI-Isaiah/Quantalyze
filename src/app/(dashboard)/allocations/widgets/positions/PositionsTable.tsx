"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { WidgetProps } from "../../lib/types";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
  type ColumnDef,
} from "@tanstack/react-table";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Row type — one row per strategy in the portfolio
// ---------------------------------------------------------------------------

interface PositionRow {
  name: string;
  weight: number | null;
  allocated: number | null;
  cagr: number | null;
  sharpe: number | null;
  maxDd: number | null;
  sortino: number | null;
  vol: number | null;
  winRate: number | null;
  calmar: number | null;
  alpha: number | null;
  beta: number | null;
}

// ---------------------------------------------------------------------------
// Formatting wrappers — thin adapters over shared utils for the "--" fallback
// these columns need (instead of the em-dash used by formatPercent).
// ---------------------------------------------------------------------------

function fmtPct(v: number | null): string {
  if (v == null) return "--";
  return formatPercent(v);
}

function fmtRatio(v: number | null): string {
  if (v == null) return "--";
  return formatNumber(v);
}

function fmtUsd(v: number | null): string {
  if (v == null) return "--";
  return formatCurrency(v);
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const col = createColumnHelper<PositionRow>();

const ALL_COLUMNS: ColumnDef<PositionRow, unknown>[] = [
  col.accessor("name", {
    header: "Strategy",
    cell: (info) => (
      <span className="font-sans text-sm text-[#1A1A2E] truncate block max-w-[180px]">
        {info.getValue()}
      </span>
    ),
    enableHiding: false,
    size: 160,
    minSize: 100,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("weight", {
    header: "Weight",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtPct(info.getValue())}</span>,
    size: 80,
    minSize: 60,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("allocated", {
    header: "Allocated",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtUsd(info.getValue())}</span>,
    size: 100,
    minSize: 70,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("cagr", {
    header: "CAGR",
    cell: (info) => {
      const v = info.getValue();
      const color = v == null ? "#718096" : v >= 0 ? "#16A34A" : "#DC2626";
      return <span className="font-metric tabular-nums text-sm" style={{ color }}>{fmtPct(v)}</span>;
    },
    size: 80,
    minSize: 60,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("sharpe", {
    header: "Sharpe",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtRatio(info.getValue())}</span>,
    size: 72,
    minSize: 56,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("maxDd", {
    header: "Max DD",
    cell: (info) => {
      const v = info.getValue();
      return <span className="font-metric tabular-nums text-sm" style={{ color: v != null ? "#DC2626" : "#718096" }}>{fmtPct(v)}</span>;
    },
    size: 80,
    minSize: 60,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("sortino", {
    header: "Sortino",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtRatio(info.getValue())}</span>,
    size: 72,
    minSize: 56,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("vol", {
    header: "Vol",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtPct(info.getValue())}</span>,
    size: 72,
    minSize: 56,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("winRate", {
    header: "Win Rate",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtPct(info.getValue())}</span>,
    size: 80,
    minSize: 60,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("calmar", {
    header: "Calmar",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtRatio(info.getValue())}</span>,
    size: 72,
    minSize: 56,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("alpha", {
    header: "Alpha",
    cell: (info) => {
      const v = info.getValue();
      const color = v == null ? "#718096" : v >= 0 ? "#16A34A" : "#DC2626";
      return <span className="font-metric tabular-nums text-sm" style={{ color }}>{fmtPct(v)}</span>;
    },
    size: 72,
    minSize: 56,
  }) as ColumnDef<PositionRow, unknown>,
  col.accessor("beta", {
    header: "Beta",
    cell: (info) => <span className="font-metric tabular-nums text-sm">{fmtRatio(info.getValue())}</span>,
    size: 72,
    minSize: 56,
  }) as ColumnDef<PositionRow, unknown>,
];

// Column IDs excluding "name" (always visible)
const TOGGLEABLE_COLUMN_IDS = [
  "weight", "allocated", "cagr", "sharpe", "maxDd",
  "sortino", "vol", "winRate", "calmar", "alpha", "beta",
];

const COLUMN_LABELS: Record<string, string> = {
  weight: "Weight",
  allocated: "Allocated",
  cagr: "CAGR",
  sharpe: "Sharpe",
  maxDd: "Max DD",
  sortino: "Sortino",
  vol: "Vol",
  winRate: "Win Rate",
  calmar: "Calmar",
  alpha: "Alpha",
  beta: "Beta",
};

// ---------------------------------------------------------------------------
// Responsive default visibility based on tile width
// ---------------------------------------------------------------------------

function defaultVisibility(width: number): VisibilityState {
  if (width < 300) {
    return {
      weight: true, allocated: false, cagr: false, sharpe: false, maxDd: false,
      sortino: false, vol: false, winRate: false, calmar: false, alpha: false, beta: false,
    };
  }
  if (width < 450) {
    return {
      weight: true, allocated: false, cagr: true, sharpe: false, maxDd: false,
      sortino: false, vol: false, winRate: false, calmar: false, alpha: false, beta: false,
    };
  }
  if (width < 600) {
    return {
      weight: true, allocated: true, cagr: true, sharpe: true, maxDd: false,
      sortino: false, vol: false, winRate: false, calmar: false, alpha: false, beta: false,
    };
  }
  // >= 600: all visible
  return {
    weight: true, allocated: true, cagr: true, sharpe: true, maxDd: true,
    sortino: true, vol: true, winRate: true, calmar: true, alpha: true, beta: true,
  };
}

// ---------------------------------------------------------------------------
// Gear dropdown for column visibility
// ---------------------------------------------------------------------------

function ColumnVisibilityDropdown({
  visibility,
  onToggle,
}: {
  visibility: VisibilityState;
  onToggle: (colId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-7 h-7 rounded border border-[#E2E8F0] bg-white text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA] transition-colors"
        aria-label="Toggle columns"
        data-testid="column-visibility-toggle"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="currentColor"/>
          <path d="M13.36 5.44a1.5 1.5 0 0 1 .58 2.04l-.14.24a1.5 1.5 0 0 1-2.04.58l-.02-.01a.26.26 0 0 0-.26 0 .26.26 0 0 0-.13.22v.02a1.5 1.5 0 0 1-1.5 1.5h-.29a1.5 1.5 0 0 1-1.5-1.5v-.03a.26.26 0 0 0-.39-.22 1.5 1.5 0 0 1-2.04-.58l-.15-.26a1.5 1.5 0 0 1 .58-2.04.26.26 0 0 0 0-.45 1.5 1.5 0 0 1-.58-2.04l.14-.24a1.5 1.5 0 0 1 2.04-.58.26.26 0 0 0 .39-.22v-.02a1.5 1.5 0 0 1 1.5-1.5h.29a1.5 1.5 0 0 1 1.5 1.5v.03c0 .1.05.18.13.22a.26.26 0 0 0 .26 0 1.5 1.5 0 0 1 2.04.58l.15.26a1.5 1.5 0 0 1-.58 2.04.26.26 0 0 0 0 .45Z" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-[#E2E8F0] bg-white shadow-md py-1">
          {TOGGLEABLE_COLUMN_IDS.map((id) => (
            <label
              key={id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#1A1A2E] hover:bg-[#F8F9FA] cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={visibility[id] !== false}
                onChange={() => onToggle(id)}
                className="accent-[#1B6B5A] h-3.5 w-3.5"
                data-testid={`col-toggle-${id}`}
              />
              {COLUMN_LABELS[id]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PositionsTable widget
// ---------------------------------------------------------------------------

export default function PositionsTable({ data, width }: WidgetProps) {
  // Build rows from data.strategies
  const rows = useMemo<PositionRow[]>(() => {
    if (!data?.strategies?.length) return [];

    const strats = data.strategies as Array<{
      strategy_id: string;
      current_weight: number | null;
      allocated_amount: number | null;
      alias: string | null;
      strategy: {
        name: string;
        codename: string | null;
        disclosure_tier: string;
        strategy_analytics: {
          cagr: number | null;
          sharpe: number | null;
          volatility: number | null;
          max_drawdown: number | null;
          sortino?: number | null;
          calmar?: number | null;
          win_rate?: number | null;
          alpha?: number | null;
          beta?: number | null;
        } | null;
      };
    }>;

    return strats.map((row) => {
      const a = row.strategy.strategy_analytics;
      const name =
        (row.alias && row.alias.trim()) ||
        (row.strategy.disclosure_tier === "exploratory" && row.strategy.codename) ||
        row.strategy.name;
      return {
        name,
        weight: row.current_weight,
        allocated: row.allocated_amount,
        cagr: a?.cagr ?? null,
        sharpe: a?.sharpe ?? null,
        maxDd: a?.max_drawdown ?? null,
        sortino: a?.sortino ?? null,
        vol: a?.volatility ?? null,
        winRate: a?.win_rate ?? null,
        calmar: a?.calmar ?? null,
        alpha: a?.alpha ?? null,
        beta: a?.beta ?? null,
      };
    });
  }, [data]);

  // Column visibility — initialize from responsive width
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    defaultVisibility(width),
  );

  const [sorting, setSorting] = useState<SortingState>([]);

  const toggleColumn = useCallback((colId: string) => {
    setColumnVisibility((prev) => ({ ...prev, [colId]: prev[colId] === false ? true : false }));
  }, []);

  const table = useReactTable({
    data: rows,
    columns: ALL_COLUMNS,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange",
  });

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#718096]">
        No positions data available
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar: gear icon */}
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-[#E2E8F0]">
        <ColumnVisibilityDropdown
          visibility={columnVisibility}
          onToggle={toggleColumn}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table
          className="w-full border-collapse"
          style={{ width: table.getCenterTotalSize() }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="relative select-none whitespace-nowrap border-b border-[#E2E8F0] bg-[#F8F9FA] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[#718096]"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="flex items-center gap-1 hover:text-[#1A1A2E] transition-colors cursor-pointer"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " \u2191", desc: " \u2193" }[header.column.getIsSorted() as string] ?? ""}
                      </button>
                    )}

                    {/* Resize handle */}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-[#1B6B5A] active:bg-[#1B6B5A]"
                      style={{ opacity: header.column.getIsResizing() ? 1 : 0 }}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
                style={{ height: 44 }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-2 whitespace-nowrap"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
