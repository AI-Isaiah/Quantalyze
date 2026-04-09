import { type ReactNode } from "react";
import { cn, formatPercent } from "@/lib/utils";

/**
 * `<EditorialHero>` — the verdict block at the top of /demo.
 *
 * One editorial line in Instrument Serif, one product descriptor in DM Sans,
 * four hero numbers in Geist Mono tabular-nums. Optional CTA slot for the
 * "Download IC Report" button. NO card border, NO icons, NO Health Score.
 *
 * Mobile: at 320px the headline reflows to 24/32; numbers stay on a 2x2
 * grid; CTA stretches full-width.
 */

export interface EditorialHeroNumbers {
  portfolioTwr: number | null;
  benchmarkTwr: number | null;
  portfolioMaxDrawdown: number | null;
  benchmarkMaxDrawdown: number | null;
  benchmarkLabel?: string;
}

export interface EditorialHeroProps {
  /** The single editorial claim (e.g. "Beat BTC on the way up. And on the way down."). */
  headline: string;
  /** One-line product descriptor under the headline. */
  descriptor?: string;
  /** Hero numbers — if all are null the numbers block is hidden. */
  numbers: EditorialHeroNumbers;
  /** Optional CTA slot — typically the Download IC Report button. */
  cta?: ReactNode;
  /** Pass-through className for layout containers. */
  className?: string;
}

function MetricCell({
  label,
  value,
  negative,
}: {
  label: string;
  value: number | null;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-metric tabular-nums text-2xl sm:text-3xl",
          value == null
            ? "text-text-muted"
            : negative
              ? "text-negative"
              : "text-text-primary",
        )}
      >
        {formatPercent(value)}
      </p>
    </div>
  );
}

export function EditorialHero({
  headline,
  descriptor,
  numbers,
  cta,
  className,
}: EditorialHeroProps) {
  const benchmarkLabel = numbers.benchmarkLabel ?? "BTC";
  const allNumbersNull =
    numbers.portfolioTwr == null &&
    numbers.benchmarkTwr == null &&
    numbers.portfolioMaxDrawdown == null &&
    numbers.benchmarkMaxDrawdown == null;

  return (
    <section
      aria-labelledby="editorial-hero-headline"
      className={cn("flex flex-col gap-6", className)}
    >
      <div>
        <h1
          id="editorial-hero-headline"
          className="font-display text-3xl sm:text-4xl md:text-5xl leading-tight text-text-primary"
        >
          {headline}
        </h1>
        {descriptor && (
          <p className="mt-3 text-sm sm:text-base text-text-secondary max-w-2xl">
            {descriptor}
          </p>
        )}
      </div>

      {!allNumbersNull && (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:max-w-xl">
          <MetricCell label="Portfolio TWR" value={numbers.portfolioTwr} />
          <MetricCell label={`${benchmarkLabel} TWR`} value={numbers.benchmarkTwr} />
          <MetricCell
            label="Portfolio drawdown"
            value={numbers.portfolioMaxDrawdown}
            negative
          />
          <MetricCell
            label={`${benchmarkLabel} drawdown`}
            value={numbers.benchmarkMaxDrawdown}
            negative
          />
        </dl>
      )}

      {cta && <div className="flex flex-wrap items-center gap-3">{cta}</div>}
    </section>
  );
}
