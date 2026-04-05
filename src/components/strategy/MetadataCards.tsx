import { Card } from "@/components/ui/Card";
import type { Strategy } from "@/lib/types";

export function MetadataCards({ strategy }: { strategy: Strategy }) {
  const items = [
    { label: "Exchanges", value: strategy.supported_exchanges.join(", ") || "—" },
    { label: "Types", value: strategy.strategy_types.join(", ") || "—" },
    { label: "Subtypes", value: strategy.subtypes.join(", ") || "—" },
    { label: "Markets", value: strategy.markets.join(", ") || "—" },
    { label: "Leverage", value: strategy.leverage_range || "—" },
    { label: "Avg Turnover", value: strategy.avg_daily_turnover ? `$${(strategy.avg_daily_turnover / 1000).toFixed(0)}K/d` : "—" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
      {items.map((item) => (
        <Card key={item.label} padding="sm">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            {item.label}
          </p>
          <p className="mt-1 text-sm font-medium text-text-primary truncate">
            {item.value}
          </p>
        </Card>
      ))}
    </div>
  );
}
