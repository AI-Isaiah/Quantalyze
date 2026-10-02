"use client";

/**
 * Phase 149 / NAV-01 — the page-level empty state (zero strategies AND zero
 * bare keys).
 *
 * The inherited in-table "No strategies match your filters." message
 * (StrategyTable) is a FILTER message and is the wrong claim for a genuinely
 * empty account, so the page swaps the whole table out for this panel.
 *
 * The CTA is a client ACTION, never an href. Quoting the Sidebar comment that
 * establishes why (Sidebar.tsx:129-136):
 *
 *   Phase 110 CONTRIB-01 (ROLE-02 scoped exception) — the allocator brings a
 *   strategy to track/compose. A CLIENT ACTION (opens the
 *   ContributionWizardOverlay hosted at the DashboardChrome level), NOT an
 *   href: the wizard route sits under the Phase-109 manager-guarded
 *   /strategies subtree, so a Link would redirect-bounce the allocator.
 *
 * That chrome-level host is unreachable from `{children}`, so this panel mounts
 * its OWN overlay with local state — the AllocationsTabs:1010-1018 precedent.
 *
 * No icon, no illustration: DESIGN.md bans icon-first cheerful empty states.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ContributionWizardOverlay } from "@/app/(dashboard)/allocations/components/ContributionWizardOverlay";
import { Button } from "@/components/ui/Button";

export function MyStrategiesEmptyState() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="border border-border bg-surface rounded-lg px-6 py-8">
      <p className="text-body font-medium text-text-primary">
        No strategies yet.
      </p>
      <p className="mt-2 text-small text-text-secondary">
        Connect an exchange API key or upload a CSV to see your strategies
        ranked here. First metrics arrive ~10–15 minutes after a key connects.
      </p>
      <div className="mt-6">
        <Button onClick={() => setWizardOpen(true)}>Add a Strategy</Button>
      </div>
      <ContributionWizardOverlay
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => {
          setWizardOpen(false);
          // Re-run the RSC page so the brand-new strategy replaces this panel
          // with the ranking it belongs in.
          router.refresh();
        }}
      />
    </div>
  );
}
