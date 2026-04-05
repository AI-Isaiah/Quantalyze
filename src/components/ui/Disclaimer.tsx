import { cn } from "@/lib/utils";

interface DisclaimerProps {
  variant?: "footer" | "strategy" | "factsheet";
  className?: string;
}

const TEXT: Record<DisclaimerProps["variant"] & string, string> = {
  footer:
    "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss.",
  strategy:
    "Data verified from exchange API. Quantalyze does not independently audit trading strategies. Past performance is not indicative of future results.",
  factsheet:
    "This document is for informational purposes only and does not constitute financial advice, an offer to sell, or a solicitation to buy any securities or investment products. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of total loss. Data verified from exchange API — Quantalyze does not independently audit trading strategies.",
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
        className,
      )}
    >
      {text}
    </p>
  );
}
