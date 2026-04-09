import type { ReactNode } from "react";

type Tone = "accent" | "neutral" | "warning" | "success";

interface ScopedBannerProps {
  tone: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  cta?: ReactNode;
}

const TONE_CLASSES: Record<Tone, string> = {
  accent: "border-l-4 border-accent bg-accent/5",
  neutral: "border-l-4 border-border bg-surface",
  warning: "border-l-4 border-negative bg-negative/5",
  success: "border-l-4 border-positive bg-positive/5",
};

/**
 * A prominent, full-width, left-border-accented banner used for filter
 * scope indicators, read-only previews, pipeline hero cards, and success
 * confirmations. Ensures the trust-critical filtered vs. unfiltered
 * symmetry on the eval dashboard stays enforced at the component level —
 * a drift in structure would otherwise depend on author memory.
 */
export function ScopedBanner({ tone, title, subtitle, cta }: ScopedBannerProps) {
  return (
    <div className={`${TONE_CLASSES[tone]} px-4 py-3 flex items-center justify-between gap-4`}>
      <div className="min-w-0 flex-1">
        <div className="font-display text-lg text-text-primary truncate">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 text-sm text-text-secondary">{subtitle}</div>
        ) : null}
      </div>
      {cta ? <div className="shrink-0">{cta}</div> : null}
    </div>
  );
}
