"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { STRATEGY_PALETTE } from "@/lib/utils";
import { WidgetState } from "../../components/WidgetState";
import { isWidgetStateV2Enabled } from "@/lib/widget-state-flag";

/**
 * PR1 QA — Allocation by style widget.
 *
 * Faithful port of designer-bundle/project/src/app.jsx (AllocationBreakdown,
 * lines 530-575): groups holdings by style tag, sums their weights, and
 * renders a header + stacked bar + legend list. Replaces the AllocationDonut
 * (pie chart) for the default Overview tile so the page matches the
 * prototype's "Allocation by style" surface.
 *
 * Style tag derivation: each strategy's `strategy_types[]` is a string array
 * (e.g. ["Market Neutral", "Equity L/S"]). We use the first entry as the
 * canonical style tag — matching the prototype's single-tag-per-holding
 * model. Strategies with no tag fall under "Other".
 *
 * Cash share: if Σweights < 0.99, the difference is shown as "X.X% cash";
 * otherwise the header reads "fully deployed". Mirrors the designer's exact
 * wording so the page reads identically when populated.
 */

type StrategyRow = {
  strategy_id: string;
  current_weight: number | null;
  strategy: {
    strategy_types: string[];
  };
};

const OTHER_TAG = "Other";

export default function AllocationByStyleWidget({ data }: WidgetProps) {
  const { entries, totalWeight, colorByTag } = useMemo(() => {
    const rows = (data?.strategies ?? []) as StrategyRow[];

    const weightByTag = new Map<string, number>();
    for (const row of rows) {
      const tag = row.strategy?.strategy_types?.[0]?.trim() || OTHER_TAG;
      const w = row.current_weight ?? 0;
      if (w <= 0) continue;
      weightByTag.set(tag, (weightByTag.get(tag) ?? 0) + w);
    }

    const sorted = Array.from(weightByTag.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    const total = sorted.reduce((s, [, w]) => s + w, 0);

    // Stable color per tag — assigned in descending-weight order so the
    // largest slice always reads as the accent green and downstream colors
    // step through STRATEGY_PALETTE deterministically.
    const colors = new Map<string, string>();
    sorted.forEach(([tag], i) => {
      colors.set(tag, STRATEGY_PALETTE[i % STRATEGY_PALETTE.length]);
    });

    return { entries: sorted, totalWeight: total, colorByTag: colors };
  }, [data?.strategies]);

  const cashPct = totalWeight < 0.99 ? (1 - totalWeight) * 100 : 0;
  const subtitle =
    totalWeight < 0.99
      ? `${entries.length} ${entries.length === 1 ? "style" : "styles"} · ${cashPct.toFixed(1)}% cash`
      : `${entries.length} ${entries.length === 1 ? "style" : "styles"} · fully deployed`;

  // Phase 11 / UI-BLOCK-01 — wire WidgetState v2 behind the feature flag.
  // The widget already renders a card with header chrome that surfaces
  // "No active allocations" sub-copy when entries is empty (line 107
  // ternary), so the empty branch is a presentational sub-copy swap
  // rather than a separate render path. mode="success" passthrough
  // proves the primitive is consumed in production while preserving
  // byte-identical visual output.
  const v2 = isWidgetStateV2Enabled();
  const card = (
    <div
      role="region"
      aria-label="Allocation by style"
      data-testid="allocation-by-style"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg, 8px)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Allocation by style
        </h3>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            marginTop: 2,
          }}
        >
          {entries.length === 0 ? "No active allocations" : subtitle}
        </div>
      </div>

      {entries.length > 0 ? (
        <div style={{ padding: 16 }}>
          {/* Stacked bar — visual summary of relative weights */}
          <div
            aria-hidden
            style={{
              display: "flex",
              height: 10,
              borderRadius: 4,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            {entries.map(([tag, w]) => (
              <div
                key={tag}
                title={`${tag}: ${(w * 100).toFixed(1)}%`}
                style={{
                  width: `${w * 100}%`,
                  background: colorByTag.get(tag) ?? "#64748B",
                }}
              />
            ))}
          </div>
          {/* Legend list — matches the prototype's per-style row */}
          <div style={{ marginTop: 14 }}>
            {entries.map(([tag, w]) => (
              <div
                key={tag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-grid-gap)",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: colorByTag.get(tag) ?? "#64748B",
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 13 }}>{tag}</span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {(w * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (v2) {
    return <WidgetState mode="success">{card}</WidgetState>;
  }
  return card;
}
