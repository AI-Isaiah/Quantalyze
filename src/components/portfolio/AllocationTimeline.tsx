import { Card } from "@/components/ui/Card";
import { formatCurrency } from "@/lib/utils";
import type { AllocationEvent } from "@/lib/types";

interface AllocationTimelineProps {
  events: AllocationEvent[];
  strategyNames: Record<string, string>;
}

export function AllocationTimeline({
  events,
  strategyNames,
}: AllocationTimelineProps) {
  if (events.length === 0) {
    return (
      <Card className="text-center py-8">
        <p className="text-small text-text-muted">
          No allocation events recorded.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <Card key={event.id} padding="sm">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium text-text-primary truncate">
                {strategyNames[event.strategy_id] ?? event.strategy_id}
              </p>
              {event.notes && (
                <p className="text-caption text-text-secondary mt-0.5 truncate">
                  {event.notes}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium ${
                  event.event_type === "deposit"
                    ? "bg-positive/10 text-positive"
                    : "bg-negative/10 text-negative"
                }`}
              >
                {event.event_type}
              </span>
              <span className="text-small font-metric text-text-primary">
                {formatCurrency(event.amount)}
              </span>
              <span className="text-caption text-text-muted whitespace-nowrap">
                {new Date(event.event_date).toLocaleDateString()}
              </span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
