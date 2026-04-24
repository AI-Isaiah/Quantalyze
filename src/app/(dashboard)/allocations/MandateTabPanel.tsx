"use client";

import Link from "next/link";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 09.1 D-06 — Mandate tab body.
 * Plan 02 stub: link to existing /profile?tab=mandate MandateForm so the tab
 * is functional immediately — allocators have a working route to edit their
 * mandate today.
 * Plan 10 decides whether to (a) move the form here, (b) iframe it, or
 * (c) keep the link + add a live MandateSnapshot widget.
 *
 * Props mirror MyAllocationDashboardPayload so Plan 10 can wire snapshot
 * data without changing the AllocationsTabs render site.
 */
export function MandateTabPanel(_props: MyAllocationDashboardPayload) {
  return (
    <div
      data-tab-panel="mandate"
      className="rounded-lg border border-border bg-surface p-8 text-sm text-text-secondary"
    >
      <p className="mb-3">Edit your mandate in the profile surface.</p>
      <Link
        href="/profile?tab=mandate"
        className="text-accent hover:underline"
      >
        Open Mandate form →
      </Link>
      <p className="mt-4 text-xs">
        MandateSnapshot widget shipping in Plan 10 (D-06).
      </p>
    </div>
  );
}
