"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { AllocatorExchangeManager } from "@/components/exchanges/AllocatorExchangeManager";

export interface ExchangesTabContentProps {
  initialKeys: ComponentProps<typeof AllocatorExchangeManager>["initialKeys"];
  activePortfolio: { id: string; name: string } | null;
}

export function ExchangesTabContent({
  initialKeys,
  activePortfolio,
}: ExchangesTabContentProps) {
  return (
    <section className="space-y-6">
      <p className="text-sm text-text-secondary max-w-prose">
        Upload read-only exchange API keys to automatically sync your real
        positions and build your Active Allocation portfolio. No manual data
        entry — your invest and divest events are detected directly from your
        exchange account.
      </p>

      {activePortfolio ? (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Real portfolio
              </p>
              <Link
                href={`/portfolios/${activePortfolio.id}`}
                className="mt-1 block text-base font-semibold text-text-primary hover:text-accent"
              >
                {activePortfolio.name}
              </Link>
              <p className="mt-1 text-xs text-text-muted">
                This portfolio&apos;s positions, allocations, and invest/divest
                events are derived automatically from the exchange connections
                below.
              </p>
            </div>
            <Link
              href={`/portfolios/${activePortfolio.id}`}
              className="text-xs px-3 py-2 rounded-md border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            >
              Open portfolio →
            </Link>
          </div>
        </Card>
      ) : null}

      <AllocatorExchangeManager initialKeys={initialKeys} />
    </section>
  );
}
