"use client";

import type { WidgetProps } from "../../lib/types";

/**
 * Morning Briefing widget — renders the deterministic narrative produced by
 * `generate_narrative()` in the analytics service.
 *
 * The narrative is a single string with sentences joined by ". ". We split
 * it into semantic sections for better readability:
 *   - Headline: first 1-2 sentences (MTD return + top contributor)
 *   - Monthly breakdown: sentences starting with "In <Month>"
 *   - Optimizer recommendation: sentence starting with "If you trim"
 *   - Remaining context: everything else (correlation, risk concentration)
 */

function splitNarrative(raw: string): {
  headline: string[];
  monthly: string[];
  recommendation: string | null;
  context: string[];
} {
  // Split on ". " but preserve the period
  const sentences = raw
    .split(/\.\s+/)
    .map((s) => s.replace(/\.+$/, "").trim())
    .filter(Boolean);

  const headline: string[] = [];
  const monthly: string[] = [];
  let recommendation: string | null = null;
  const context: string[] = [];

  for (const sentence of sentences) {
    if (sentence.startsWith("In ") && /returned [+-]?\d/.test(sentence)) {
      monthly.push(sentence);
    } else if (sentence.startsWith("If you trim")) {
      recommendation = sentence;
    } else if (
      sentence.startsWith("Your portfolio returned") ||
      sentence.startsWith("driven primarily by")
    ) {
      headline.push(sentence);
    } else {
      context.push(sentence);
    }
  }

  return { headline, monthly, recommendation, context };
}

export function MorningBriefing({ data }: WidgetProps) {
  const narrative: string | null | undefined =
    data?.analytics?.narrative_summary;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (!narrative) {
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
          <p className="text-sm" style={{ color: "#718096" }}>
            Portfolio briefing not yet generated.
          </p>
        </div>
      </div>
    );
  }

  const { headline, monthly, recommendation, context } =
    splitNarrative(narrative);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
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

      <div className="flex flex-1 flex-col gap-3">
        {/* Headline */}
        {headline.length > 0 && (
          <p
            className="text-sm leading-relaxed"
            style={{ color: "#4A5568", fontFamily: "var(--font-body)" }}
          >
            {headline.join(", ")}.
          </p>
        )}

        {/* Context (correlation, risk) */}
        {context.length > 0 && (
          <p
            className="text-sm leading-relaxed"
            style={{ color: "#4A5568", fontFamily: "var(--font-body)" }}
          >
            {context.join(". ")}.
          </p>
        )}

        {/* Monthly breakdown */}
        {monthly.length > 0 && (
          <div>
            <p
              className="mb-1.5 text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "#718096" }}
            >
              Monthly breakdown
            </p>
            <ul className="space-y-1">
              {monthly.map((sentence, i) => (
                <li
                  key={i}
                  className="text-sm leading-relaxed"
                  style={{ color: "#4A5568", fontFamily: "var(--font-body)" }}
                >
                  {sentence}.
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Optimizer recommendation */}
        {recommendation && (
          <div
            className="mt-auto rounded-md px-3 py-2"
            style={{ backgroundColor: "rgba(27,107,90,0.06)" }}
          >
            <p
              className="text-sm leading-relaxed"
              style={{ color: "#1B6B5A", fontFamily: "var(--font-body)" }}
            >
              {recommendation}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
