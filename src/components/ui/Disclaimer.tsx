import { cn } from "@/lib/utils";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

type DisclaimerVariant = "footer" | "strategy" | "factsheet" | "custody";

/**
 * Subset of `Strategy.trust_tier` accepted here. `null`/`undefined` is treated
 * the same as `self_reported` so the disclaimer never invents an "exchange API"
 * claim for a strategy that hasn't been verified that way.
 */
type DisclaimerTrustTier = "api_verified" | "csv_uploaded" | "self_reported" | null | undefined;

interface DisclaimerProps {
  variant?: DisclaimerVariant;
  /**
   * Drives the data-provenance sentence on `strategy` and `factsheet` variants.
   * Omit for `footer`/`custody` (which carry no provenance claim).
   */
  trustTier?: DisclaimerTrustTier;
  className?: string;
}

const FOOTER_TEXT =
  "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss.";

const CUSTODY_TEXT = `Strategy monitored via read-only exchange API. Manager retains asset custody. ${PLATFORM_NAME} provides analytics only — no pooling, no fund administration, no custody of client assets.`;

const FACTSHEET_PREAMBLE =
  "This document is for informational purposes only and does not constitute financial advice, an offer to sell, or a solicitation to buy any securities or investment products. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of total loss.";

const PROVENANCE: Record<NonNullable<DisclaimerTrustTier>, string> = {
  api_verified: `Data verified from exchange API. ${PLATFORM_NAME} does not independently audit trading strategies.`,
  csv_uploaded: `Performance data uploaded by the manager as a daily-return series and not independently verified by ${PLATFORM_NAME} or by an exchange API.`,
  self_reported: `Performance data is self-reported by the manager and not independently verified by ${PLATFORM_NAME}.`,
};

function provenanceFor(tier: DisclaimerTrustTier): string {
  return PROVENANCE[tier ?? "self_reported"];
}

export function Disclaimer({ variant = "footer", trustTier, className }: DisclaimerProps) {
  let text: string;
  switch (variant) {
    case "footer":
      text = FOOTER_TEXT;
      break;
    case "custody":
      text = CUSTODY_TEXT;
      break;
    case "strategy":
      text = `${provenanceFor(trustTier)} Past performance is not indicative of future results.`;
      break;
    case "factsheet":
      text = `${FACTSHEET_PREAMBLE} ${provenanceFor(trustTier)}`;
      break;
  }

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
