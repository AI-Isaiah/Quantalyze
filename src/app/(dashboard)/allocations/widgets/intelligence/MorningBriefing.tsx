"use client";

import type { WidgetProps } from "../../lib/types";

export function MorningBriefing({ data }: WidgetProps) {
  const narrative: string | null | undefined =
    data?.analytics?.narrative_summary;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h3
          className="font-display text-base font-normal"
          style={{ color: "#1A1A2E", fontSize: 16 }}
        >
          Morning Briefing
        </h3>
        <span className="text-xs" style={{ color: "#718096" }}>
          {today}
        </span>
      </div>

      <div className="flex-1">
        {narrative ? (
          <p
            className="text-sm leading-relaxed"
            style={{ color: "#4A5568", fontFamily: "var(--font-body)" }}
          >
            {narrative}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#718096" }}>
            Portfolio briefing not yet generated.
          </p>
        )}
      </div>
    </div>
  );
}
