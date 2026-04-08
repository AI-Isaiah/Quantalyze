import { Card } from "@/components/ui/Card";
import type { DisclosureTier, ManagerIdentity } from "@/lib/types";

interface ManagerIdentityPanelProps {
  disclosureTier: DisclosureTier;
  manager: ManagerIdentity | null;
  strategyCodename: string;
  className?: string;
}

/**
 * Shown on strategy detail + factsheet + tear sheet. The content depends on
 * `disclosure_tier`:
 *
 *   institutional — full manager identity (name, bio, years, AUM, LinkedIn)
 *   exploratory   — codename only + "identity disclosed on accepted intro" blurb
 *
 * Server-side redaction lives in `getStrategyDetail()` / `getPublicStrategyDetail()`
 * — the caller MUST NOT pass a populated `manager` object for an exploratory
 * strategy. This component trusts its caller to redact.
 */
export function ManagerIdentityPanel({
  disclosureTier,
  manager,
  strategyCodename,
  className,
}: ManagerIdentityPanelProps) {
  if (disclosureTier === "exploratory" || !manager) {
    return (
      <Card className={className}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
              Manager
            </p>
            <h3 className="text-lg font-semibold text-text-primary">
              {strategyCodename}
            </h3>
            <p className="mt-2 text-sm text-text-secondary">
              Pseudonymous strategy. The manager&apos;s identity is disclosed
              once an allocator requests an introduction and the manager accepts.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-page px-3 py-1 text-[11px] font-medium text-text-secondary">
            Exploratory
          </span>
        </div>
      </Card>
    );
  }

  const displayName = manager.display_name ?? manager.company ?? strategyCodename;
  const detailLines: string[] = [];
  if (manager.years_trading) {
    detailLines.push(`${manager.years_trading}+ years trading`);
  }
  if (manager.aum_range) {
    detailLines.push(`${manager.aum_range} AUM`);
  }
  if (manager.company && manager.display_name) {
    detailLines.push(manager.company);
  }

  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
            Manager
          </p>
          <h3 className="text-lg font-semibold text-text-primary">
            {displayName}
          </h3>
          {detailLines.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">
              {detailLines.join(" · ")}
            </p>
          )}
          {manager.bio && (
            <p className="mt-3 text-sm text-text-secondary leading-relaxed">
              {manager.bio}
            </p>
          )}
          {manager.linkedin && (
            <a
              href={manager.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
            >
              LinkedIn profile →
            </a>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-[11px] font-medium text-accent">
          Institutional
        </span>
      </div>
    </Card>
  );
}
