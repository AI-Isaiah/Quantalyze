import type { ReactNode } from "react";

type Tone = "accent" | "neutral" | "warning" | "success";

interface ScopedBannerProps {
  tone: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  cta?: ReactNode;
}

// Full-border envelope treatment per the codified ErrorEnvelope contract
// (DESIGN.md "Error Envelope": `rounded-md border border-<sev>/30 bg-<sev>/5`).
// The colored-left-border stripe is banned (DESIGN.md AI-slop table) — identity
// is carried by the full border + fill tint, not a left rule.
const TONE_CLASSES: Record<Tone, string> = {
  accent: "border border-accent/30 bg-accent/5",
  neutral: "border border-border bg-surface",
  warning: "border border-negative/30 bg-negative/5",
  success: "border border-positive/30 bg-positive/5",
};

/**
 * A prominent, full-width, full-border envelope banner used for filter
 * scope indicators, read-only previews, pipeline hero cards, and success
 * confirmations. Ensures the trust-critical filtered vs. unfiltered
 * symmetry on the eval dashboard stays enforced at the component level —
 * a drift in structure would otherwise depend on author memory.
 */
export function ScopedBanner({ tone, title, subtitle, cta }: ScopedBannerProps) {
  return (
    <div className={`rounded-md ${TONE_CLASSES[tone]} px-4 py-3 flex items-center justify-between gap-4`}>
      <div className="min-w-0 flex-1">
        {/* No `truncate`: the title can be a trust-critical partner scope tag
            (e.g. a long `acme-capital-management-pilot-2026` slug) that must be
            shown in full — silently ellipsing it on narrow viewports breaks the
            scope-identification promise (H-0408). `min-w-0` on the parent lets
            it wrap instead of overflowing. */}
        <div className="font-display text-lg text-text-primary break-words">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 text-sm text-text-secondary">{subtitle}</div>
        ) : null}
      </div>
      {cta ? <div className="shrink-0">{cta}</div> : null}
    </div>
  );
}
