import { Card } from "@/components/ui/Card";
import type { DisclosureTier, ManagerIdentity } from "@/lib/types";

interface ManagerIdentityPanelProps {
  disclosureTier: DisclosureTier;
  manager: ManagerIdentity | null;
  strategyCodename: string;
  className?: string;
}

/**
 * Allow only http(s) URLs through the LinkedIn anchor href. The
 * `profiles.linkedin` column is plain TEXT with no CHECK constraint and
 * `ProfileForm` writes the raw free-text value straight through to
 * Supabase, so a manager (or anyone who phishes one) could store
 * `javascript:fetch(...)` and exfiltrate the viewer's session on click.
 * `rel="noopener noreferrer"` blocks `window.opener` leaks but NOT
 * `javascript:` execution. Audit-2026-05-07 red-team finding (HIGH c8,
 * fingerprint src/components/strategy/ManagerIdentityPanel.tsx:86:red-team)
 * — see also `escapeHref` in src/lib/email.ts:418 for the same pattern in
 * the email pipeline.
 */
function safeLinkedinHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
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
            <p className="text-fixed-10 uppercase tracking-wider text-text-muted font-medium mb-2">
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
          <span className="shrink-0 rounded-sm border border-border bg-page px-3 py-1 text-fixed-11 font-medium text-text-secondary">
            Exploratory
          </span>
        </div>
      </Card>
    );
  }

  const displayName = manager.display_name ?? manager.company ?? strategyCodename;
  const linkedinHref = safeLinkedinHref(manager.linkedin);
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
          <p className="text-fixed-10 uppercase tracking-wider text-text-muted font-medium mb-2">
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
          {linkedinHref && (
            <a
              href={linkedinHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
            >
              LinkedIn profile →
            </a>
          )}
        </div>
        <span className="shrink-0 rounded-sm border border-accent/30 bg-accent/5 px-3 py-1 text-fixed-11 font-medium text-accent">
          Institutional
        </span>
      </div>
    </Card>
  );
}
