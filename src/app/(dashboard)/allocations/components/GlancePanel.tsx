"use client";

import { useId, type ReactNode } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { formatPercent, formatNumber } from "@/lib/utils";
import { formatUsd } from "@/lib/dollar-validation";
import { formatCloseDay } from "@/lib/factsheet/returns-unit";
import { annualizedCell } from "@/components/strategy/annualized-cell";
import {
  BOOK_FIGURES_SERIES_CAPTION,
  bookEquityUsd,
  holdingsReadDay,
  liveBookFigures,
  unreportedDerivativeCaption,
  unreportedDerivativeCount,
} from "../lib/book-figures";
import { isImpossibleDrawdown, valueColorClass } from "./KpiStrip";

/**
 * Phase 198 plan 01 (D-06, ROUTE-07, SC-2): the Overview's at-a-glance panel. One
 * data panel (square, hairline, flat; DESIGN.md data density), never cards.
 *
 * Every figure comes from `../lib/book-figures`, the module Scenario's live strip
 * also reads, and prints through the same formatters and tone rule as that strip
 * (`valueColorClass` and `isImpossibleDrawdown` are KpiStrip's own exports), so the
 * two surfaces print byte-equal strings for one payload.
 *
 * Research C7: Return and Risk do not depend on `equityHistoryState`. A figure that
 * does not exist prints a bare dash, as Scenario's live strip does. No glance cell
 * points at the Overview's missing-data message, because none of its lines
 * explains a glance figure (198-UAT-01, D-10): a withheld Sharpe carries its own
 * reason through `annualizedCell`. Research C5: Book equity is the sum of the
 * holdings rows, with the count of derivative rows it could not size stated
 * beneath it.
 *
 * The container-query host sits on its own ancestor (an element never queries its
 * own container); the three groups stack below `@lg` of the panel's own width.
 */

type Payload = MyAllocationDashboardPayload;

interface GlancePanelProps {
  liveBaselineMetrics: Payload["liveBaselineMetrics"] | null | undefined;
  holdingsSummary: Payload["holdingsSummary"];
  allKeysStale: boolean;
}

const CELL = "px-4 py-3 min-w-0";
const LABEL =
  "text-micro font-semibold uppercase tracking-wider text-text-muted";
const VALUE = "mt-1 font-mono text-lg font-medium tabular-nums whitespace-nowrap";

function Cell({
  label,
  testId,
  value,
  tone = "",
  children,
}: {
  label: string;
  testId: string;
  value: ReactNode;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className={CELL}>
      <div className={LABEL}>{label}</div>
      <div data-testid={testId} className={`${VALUE} ${tone}`}>
        {value}
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border first:border-t-0 @lg:border-t-0 @lg:border-l @lg:first:border-l-0">
      <p className="px-4 pt-3 text-micro font-mono uppercase tracking-[0.18em] text-text-muted">
        {title}
      </p>
      <div className="grid grid-cols-2">{children}</div>
    </div>
  );
}

export function GlancePanel({
  liveBaselineMetrics,
  holdingsSummary,
  allKeysStale,
}: GlancePanelProps) {
  const titleId = useId();
  const figures = liveBookFigures(liveBaselineMetrics);

  // Stale collapses the three cells exactly as KpiStrip does.
  const ytd = allKeysStale ? null : figures.ytdTwr;
  const sharpe = allKeysStale ? null : figures.sharpe;
  const maxDd = allKeysStale ? null : figures.maxDd;
  const maxDdShown = isImpossibleDrawdown(maxDd) ? null : maxDd;

  const sharpeWithheld = !allKeysStale && figures.sharpeState === "withheld";
  const sharpeContent: ReactNode = sharpeWithheld
    ? annualizedCell("—", figures.sharpeState, figures.sharpeRecord)
    : sharpe === null
      ? "—"
      : annualizedCell(formatNumber(sharpe, 2), figures.sharpeState, figures.sharpeRecord);

  const equity = bookEquityUsd(holdingsSummary);
  const unreportedCaption = unreportedDerivativeCaption(
    unreportedDerivativeCount(holdingsSummary),
  );

  const throughDay = figures.seriesEndDay
    ? formatCloseDay(figures.seriesEndDay)
    : "—";
  const readDayIso = holdingsReadDay(holdingsSummary);
  const readDay = readDayIso ? formatCloseDay(readDayIso) : "—";
  const stamp = [
    throughDay !== "—" ? `Figures through ${throughDay}` : null,
    readDay !== "—" ? `holdings read ${readDay}` : null,
  ]
    .filter((half): half is string => half !== null)
    .join(" · ");

  return (
    <section
      aria-labelledby={titleId}
      className="mb-3 border border-border bg-surface"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3">
        <h2
          id={titleId}
          className="text-micro font-mono uppercase tracking-[0.18em] text-text-muted"
        >
          Book at a glance
        </h2>
        {stamp !== "" && (
          <p className="text-micro font-mono text-text-muted">{stamp}</p>
        )}
      </div>
      <div className="@container">
        <div className="grid grid-cols-1 @lg:grid-cols-3">
          <Group title="Return">
            <Cell
              label="YTD TWR"
              testId="glance-ytd"
              value={formatPercent(ytd)}
              tone={valueColorClass(ytd, 100)}
            />
          </Group>
          <Group title="Risk">
            <Cell
              label="Sharpe"
              testId="glance-sharpe"
              value={sharpeContent}
              tone={valueColorClass(sharpe, 1)}
            />
            <Cell
              label="Max DD 12m"
              testId="glance-maxdd"
              value={formatPercent(maxDdShown)}
              tone={valueColorClass(maxDdShown, 100, true)}
            />
          </Group>
          <Group title="Holdings">
            <Cell
              label="Book equity"
              testId="glance-book-equity"
              value={formatUsd(equity)}
            >
              {unreportedCaption !== null && (
                <div className="mt-1 text-xs text-text-secondary whitespace-normal">
                  {unreportedCaption}
                </div>
              )}
            </Cell>
            <Cell
              label="Positions"
              testId="glance-positions"
              value={holdingsSummary.length.toLocaleString("en-US")}
            />
          </Group>
        </div>
      </div>
      <p className="border-t border-border px-4 py-2 text-micro text-text-muted">
        {BOOK_FIGURES_SERIES_CAPTION}
      </p>
    </section>
  );
}
