"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { AllocatorExchangeManager } from "@/components/exchanges/AllocatorExchangeManager";
import type { Role } from "@/lib/types";

export interface ExchangesTabContentProps {
  initialKeys: ComponentProps<typeof AllocatorExchangeManager>["initialKeys"];
  activePortfolio: { id: string; name: string } | null;
  // DOGFOOD-2: forwarded to AllocatorExchangeManager to gate the
  // "Active Allocation auto-synced" affirmative on real holdings presence.
  // Tri-state (FIX 2): null = the holdings head-count failed → neutral
  // subtitle, never the affirmative-negative "no open positions yet".
  hasHoldings: boolean | null;
  // Phase 200 D-06: the profile's role. The manager is shown to every role that
  // can hold keys, and the role picks where a key's feeds links go.
  role: Role;
}

export function ExchangesTabContent({
  initialKeys,
  activePortfolio,
  hasHoldings,
  role,
}: ExchangesTabContentProps) {
  return (
    <section className="space-y-6">
      <p className="text-sm text-text-secondary max-w-prose">
        {role === "manager" ? (
          "Read-only exchange API keys your strategies read trades from."
        ) : (
          <>
            Upload read-only exchange API keys to automatically sync your real
            positions and build your Active Allocation portfolio. No manual data
            entry — your invest and divest events are detected directly from your
            exchange account.
          </>
        )}
      </p>

      {activePortfolio ? (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Real portfolio
              </p>
              <Link
                href="/allocations"
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
              href="/allocations"
              className="text-xs px-3 py-2 rounded-md border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            >
              Open My Allocation →
            </Link>
          </div>
        </Card>
      ) : null}

      <AllocatorExchangeManager
        initialKeys={initialKeys}
        hasHoldings={hasHoldings}
        role={role}
      />
    </section>
  );
}
