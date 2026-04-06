"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AddFounderNote } from "./AddFounderNote";

interface Strategy {
  strategy_id: string;
  strategy_name: string;
  relationship_status: "connected" | "paused" | "exited";
  founder_notes: { date: string; author: string; text: string }[];
  last_founder_contact: string | null;
}

interface FounderInsightsProps {
  strategies: Strategy[];
  portfolioId: string;
}

const statusStyles: Record<Strategy["relationship_status"], string> = {
  connected: "bg-positive/10 text-positive",
  paused: "bg-badge-market-neutral/10 text-badge-market-neutral",
  exited: "bg-negative/10 text-negative",
};

export function FounderInsights({ strategies, portfolioId }: FounderInsightsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<string | null>(null);

  if (!strategies.length) {
    return (
      <Card padding="md">
        <h3 className="font-display text-lg text-text-primary mb-2">
          Founder Insights
        </h3>
        <p className="text-sm text-text-muted">No strategies in this portfolio yet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display text-lg text-text-primary">Founder Insights</h3>

      {strategies.map((s) => {
        const expanded = openId === s.strategy_id;
        const latest = s.founder_notes.length
          ? s.founder_notes[s.founder_notes.length - 1]
          : null;

        return (
          <Card key={s.strategy_id} padding="sm">
            <button
              type="button"
              className="w-full flex items-center justify-between text-left"
              onClick={() => setOpenId(expanded ? null : s.strategy_id)}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-text-primary">
                  {s.strategy_name}
                </span>
                <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded ${statusStyles[s.relationship_status]}`}>
                  {s.relationship_status}
                </span>
              </div>
              <svg
                width="16" height="16" viewBox="0 0 16 16" fill="none"
                className={`text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {expanded && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                {s.last_founder_contact && (
                  <p className="text-xs text-text-muted">
                    Last contact:{" "}
                    <span className="font-metric">{new Date(s.last_founder_contact).toLocaleDateString()}</span>
                  </p>
                )}
                {latest ? (
                  <div className="bg-page rounded-lg p-3">
                    <p className="text-xs text-text-muted mb-1">
                      <span className="font-metric">{new Date(latest.date).toLocaleDateString()}</span>{" "}
                      &mdash; {latest.author}
                    </p>
                    <p className="text-sm text-text-secondary">{latest.text}</p>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">No notes yet.</p>
                )}
                <Button size="sm" variant="ghost" onClick={() => setNoteTarget(s.strategy_id)}>
                  + Add Note
                </Button>
              </div>
            )}
          </Card>
        );
      })}

      {noteTarget && (
        <AddFounderNote
          portfolioId={portfolioId}
          strategyId={noteTarget}
          isOpen
          onClose={() => setNoteTarget(null)}
          onSaved={() => setNoteTarget(null)}
        />
      )}
    </div>
  );
}
