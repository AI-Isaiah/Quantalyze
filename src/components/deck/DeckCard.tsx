import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { DeckWithCount } from "@/lib/types";

interface DeckCardProps {
  deck: DeckWithCount;
}

export function DeckCard({ deck }: DeckCardProps) {
  return (
    <Link href={`/discover?deck=${deck.slug}`}>
      <Card className="hover:border-accent/40 transition-colors h-full">
        <h3 className="font-semibold text-text-primary truncate">
          {deck.name}
        </h3>
        {deck.description && (
          <p className="mt-1 text-sm text-text-secondary line-clamp-2">
            {deck.description}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
          <span>
            {deck.strategy_count} {deck.strategy_count === 1 ? "strategy" : "strategies"}
          </span>
          <span>{new Date(deck.created_at).toLocaleDateString()}</span>
        </div>
      </Card>
    </Link>
  );
}
