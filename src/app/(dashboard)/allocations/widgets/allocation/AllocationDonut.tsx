"use client";

import { useMemo, useState } from "react";
import type { WidgetProps } from "../../lib/types";
import { AllocationPie } from "@/components/portfolio/AllocationPie";
import { STRATEGY_PALETTE } from "@/lib/utils";

/**
 * Allocation Donut — wraps the existing AllocationPie component.
 *
 * Extracts slices from data.strategies: each slice uses
 * current_weight * total_aum for the amount and an assigned palette color.
 */
export default function AllocationDonut({ data }: WidgetProps) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const slices = useMemo(() => {
    if (!data?.strategies?.length) return [];

    const totalAum = data.analytics?.total_aum ?? 0;

    return (data.strategies as Array<{
      strategy_id: string;
      current_weight: number | null;
      allocated_amount: number | null;
      alias: string | null;
      strategy: { name: string; codename: string | null; disclosure_tier: string };
    }>).map((row, i) => {
      const name =
        row.alias?.trim() ||
        (row.strategy.disclosure_tier === "exploratory" && row.strategy.codename) ||
        row.strategy.name;
      const amount =
        row.allocated_amount ??
        (row.current_weight != null && totalAum > 0
          ? totalAum * row.current_weight
          : 0);
      return {
        id: row.strategy_id,
        name,
        color: STRATEGY_PALETTE[i % STRATEGY_PALETTE.length],
        amount,
      };
    }).filter((s) => s.amount > 0);
  }, [data]);

  const toggle = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (slices.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Allocation data unavailable.
      </div>
    );
  }

  return (
    <AllocationPie slices={slices} hiddenIds={hiddenIds} onToggle={toggle} />
  );
}
