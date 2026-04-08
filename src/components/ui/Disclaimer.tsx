import { cn } from "@/lib/utils";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

type DisclaimerVariant = "footer" | "strategy" | "factsheet" | "custody";

interface DisclaimerProps {
  variant?: DisclaimerVariant;
  className?: string;
}

const TEXT: Record<DisclaimerVariant, string> = {
  footer:
    "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss.",
  strategy: `Data verified from exchange API. ${PLATFORM_NAME} does not independently audit trading strategies. Past performance is not indicative of future results.`,
  factsheet: `This document is for informational purposes only and does not constitute financial advice, an offer to sell, or a solicitation to buy any securities or investment products. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of total loss. Data verified from exchange API — ${PLATFORM_NAME} does not independently audit trading strategies.`,
  custody: `Strategy monitored via read-only exchange API. Manager retains asset custody. ${PLATFORM_NAME} provides analytics only — no pooling, no fund administration, no custody of client assets.`,
};

export function Disclaimer({ variant = "footer", className }: DisclaimerProps) {
  const text = TEXT[variant];

  return (
    <p
      className={cn(
        "text-xs text-text-muted leading-relaxed",
        variant === "footer" && "text-center py-6 border-t border-border mt-12",
        variant === "strategy" && "mt-8 px-1",
        variant === "factsheet" && "mt-6 pt-4 border-t border-border",
        variant === "custody" &&
          "rounded-md border border-border bg-page px-4 py-3 text-text-secondary",
        className,
      )}
    >
      {text}
    </p>
  );
}
