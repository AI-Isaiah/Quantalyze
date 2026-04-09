import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * `<CardShell>` — fixed-height card primitive used on the authenticated
 * /portfolios/[id] dashboard. Cards never disappear; only their content
 * does, so the dashboard layout stays stable as analytics streams in.
 *
 * Editorial pages (/demo) do NOT use `<CardShell>` — they use the 3-block
 * layout with hairline dividers (see `DESIGN.md` "Meeting hero" rule).
 */

export type CardShellStatus = "loading" | "ready" | "stale" | "unavailable";

export interface CardShellProps {
  status: CardShellStatus;
  /** Optional title shown in the card header. Plain text only — no icons. */
  title?: string;
  /** Optional ARIA label override; defaults to `title`. */
  ariaLabel?: string;
  /**
   * Tooltip-equivalent text shown next to the stale dot. Should contain the
   * computed_at timestamp in human-readable form.
   */
  staleHint?: string;
  /** Body content rendered in the `ready` and `stale` states. */
  children?: ReactNode;
  /** Tailwind class additions. */
  className?: string;
}

const STATUS_LABELS: Record<CardShellStatus, string> = {
  loading: "Loading…",
  ready: "",
  stale: "Stale",
  unavailable: "Data unavailable",
};

export function CardShell({
  status,
  title,
  ariaLabel,
  staleHint,
  children,
  className,
}: CardShellProps) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className={cn(
        "bg-surface rounded-xl border border-border shadow-card p-6 min-h-[140px] flex flex-col",
        className,
      )}
    >
      {title && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          {status === "stale" && (
            <span
              role="status"
              aria-live="polite"
              title={staleHint}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted"
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full bg-text-muted"
              />
              {STATUS_LABELS.stale}
            </span>
          )}
        </header>
      )}

      {status === "loading" && (
        <div
          aria-hidden="true"
          className="flex-1 space-y-2"
        >
          <div className="h-4 w-3/4 rounded bg-page" />
          <div className="h-4 w-1/2 rounded bg-page" />
        </div>
      )}

      {status === "unavailable" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-text-muted">— {STATUS_LABELS.unavailable}</p>
        </div>
      )}

      {(status === "ready" || status === "stale") && (
        <div className="flex-1">{children}</div>
      )}
    </section>
  );
}
