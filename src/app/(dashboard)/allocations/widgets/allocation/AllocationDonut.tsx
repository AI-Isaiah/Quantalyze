"use client";

import { useMemo, useState } from "react";
import type { WidgetProps } from "../../lib/types";
import { AllocationPie } from "@/components/portfolio/AllocationPie";
import { STRATEGY_PALETTE } from "@/lib/utils";
import { displayName } from "@/lib/allocation-helpers";

/**
 * Allocation Donut — wraps the existing AllocationPie component.
 *
 * Extracts slices from data.strategies: each slice uses
 * current_weight * total_aum for the amount and an assigned palette color.
 */
export default function AllocationDonut({ data }: WidgetProps) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const { slices, missingAmountCount, zeroAmountCount, strategyCount } =
    useMemo(() => {
      if (!data?.strategies?.length) {
        return {
          slices: [],
          missingAmountCount: 0,
          zeroAmountCount: 0,
          strategyCount: 0,
        };
      }

      const totalAum = data.analytics?.total_aum ?? 0;

      const allSlices = (data.strategies as Array<{
        strategy_id: string;
        current_weight: number | null;
        allocated_amount: number | null;
        alias: string | null;
        strategy: {
          id: string;
          name: string | null;
          codename: string | null;
          disclosure_tier: string;
        };
      }>).map((row, i) => {
        // audit-2026-05-07 G8.A.10 (P43) — route through the canonical
        // resolver so non-institutional rows (where `name` is now redacted
        // to null at the query layer per P35) render their codename or a
        // synthetic Strategy #<id-prefix> instead of literal "null". The
        // alias-takes-priority rule is preserved inside `displayName`.
        const name = displayName(row);
        // NEW-C09-06 (B14, audit-2026-05-07): track WHY each row falls
        // out of the pie so the footnote reflects truth, not lossy
        // shorthand. "missing" = both allocated_amount AND the
        // current_weight×AUM derivation are unavailable (null/zero AUM).
        // "zero" = the producer reports an explicit 0 — a paused or
        // fully-redeemed strategy. Both are excluded from the pie (a
        // zero-amount slice is meaningless to render), but they need
        // distinct operator copy: missing→data pipeline gap; zero→state
        // change.
        const explicitAmount = row.allocated_amount;
        const derivedAmount =
          row.current_weight != null && totalAum > 0
            ? totalAum * row.current_weight
            : null;
        const amount = explicitAmount ?? derivedAmount ?? 0;
        const hasKnownAmount =
          explicitAmount !== null || derivedAmount !== null;
        return {
          id: row.strategy_id,
          name,
          color: STRATEGY_PALETTE[i % STRATEGY_PALETTE.length],
          amount,
          hasKnownAmount,
        };
      });
      // Visible: amount must be positive (the pie geometry requires it).
      // Track the two reasons a row was excluded so the footnote can
      // distinguish "amount unavailable" from "amount is zero".
      const visibleSlices = allSlices.filter((s) => s.amount > 0);
      const missing = allSlices.filter((s) => !s.hasKnownAmount).length;
      // hasKnownAmount=true AND amount<=0 (the explicit-zero or
      // derived-zero case). Negative amounts on long-only positions
      // shouldn't happen but we count them here as well — they fail the
      // pie filter the same way.
      const zero = allSlices.filter(
        (s) => s.hasKnownAmount && s.amount <= 0,
      ).length;
      return {
        slices: visibleSlices,
        missingAmountCount: missing,
        zeroAmountCount: zero,
        strategyCount: allSlices.length,
      };
    }, [data]);

  const excludedCount = missingAmountCount + zeroAmountCount;

  const toggle = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (slices.length === 0) {
    // NEW-C09-06 (MED-1): distinguish "no data at all" from "data
    // arrived but every row was excluded". The first is an onboarding
    // signal (connect a key); the second is an analytics-pipeline gap
    // (the rows ARE in the payload — they just had no usable amount).
    // Same wording would conflate two states with different operator
    // actions.
    const allExcludedMessage =
      strategyCount > 0
        ? `All ${strategyCount} investments excluded — ${footnoteSuffix(
            missingAmountCount,
            zeroAmountCount,
          )}`
        : "Allocation data unavailable.";
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-text-muted"
        data-testid={
          strategyCount > 0
            ? "allocation-donut-all-excluded"
            : "allocation-donut-empty"
        }
      >
        {allExcludedMessage}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AllocationPie slices={slices} hiddenIds={hiddenIds} onToggle={toggle} />
      {excludedCount > 0 && (
        <p
          className="mt-2 text-[11px] text-text-muted"
          data-testid="allocation-donut-footnote"
        >
          {excludedCount} of {strategyCount} investments excluded —{" "}
          {footnoteSuffix(missingAmountCount, zeroAmountCount)}
        </p>
      )}
    </div>
  );
}

/**
 * NEW-C09-06 / MED-2 (audit-2026-05-07): the footnote distinguishes
 * "missing" (data-pipeline gap; the producer didn't supply an amount)
 * from "zero" (the producer reported an explicit 0 — paused / fully
 * redeemed / closed-out strategy). Mixed cases list both so the
 * allocator can drill into each category from a single line.
 */
function footnoteSuffix(missing: number, zero: number): string {
  if (missing > 0 && zero > 0) {
    return `${missing} amount unavailable, ${zero} at zero`;
  }
  if (zero > 0) return "amount is zero";
  return "amount unavailable";
}
