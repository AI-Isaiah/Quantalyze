"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { RenameStrategyDialog } from "@/components/strategy/RenameStrategyDialog";
import type { Strategy } from "@/lib/types";

/**
 * Phase 200 / D-09, D-10, D-11 — the one place a manager renames a strategy.
 *
 * The block shows the current name, a `Rename…` control that opens the existing
 * `RenameStrategyDialog` (which writes through `PATCH /api/strategies/[id]/name`),
 * and what the public sees, computed by `publicNamePreview` on the server page
 * and passed in. It never says a codename hides the name; it states what the
 * public surfaces compute.
 *
 * D-10: the route's private/draft gate is not widened. The Rename control is
 * rendered only for the two renameable statuses (an `includes` check over that
 * list, never a published-status equality, so a status added later is read-only
 * by default). Any other status shows the name read-only with the reason.
 * The route filters on status as well, so this gate is defence in depth.
 */

const RENAMEABLE_STATUSES: ReadonlyArray<Strategy["status"]> = [
  "private",
  "draft",
];

export const NAME_LOCKED_SENTENCE =
  "Names can change only while a strategy is private or a draft. An admin reviews the name before publication.";

export function StrategyNameBlock({
  strategyId,
  name,
  status,
  preview,
}: {
  strategyId: string;
  name: string;
  status: Strategy["status"];
  preview: { factsheet: string; discovery: string };
}) {
  const [open, setOpen] = useState(false);
  const canRename = RENAMEABLE_STATUSES.includes(status);
  const published = status === "published";

  const factsheetLine = published
    ? `The public factsheet shows ${preview.factsheet}.`
    : `A shared factsheet link shows ${preview.factsheet}.`;
  const discoveryLine = published
    ? `Discovery shows other signed-in viewers ${preview.discovery}.`
    : `Discovery shows it as ${preview.discovery} once published.`;
  // The dialog is where the NEW name is typed, so its hint must not quote the
  // current one (WR-05): the name saved there is what the factsheet then shows.
  // The dialog only opens for a private or draft strategy, so this is the
  // unpublished wording.
  const dialogNote = `The name you save is what a shared factsheet link shows. ${discoveryLine}`;

  return (
    <section
      aria-label="Strategy name"
      className="mb-6 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-caption text-text-muted">Name</p>
          <p
            data-testid="strategy-name"
            className="truncate text-body font-medium text-text-primary"
          >
            {name}
          </p>
        </div>
        {canRename && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
          >
            Rename…
          </Button>
        )}
      </div>
      {!canRename && (
        <p className="mt-2 text-caption text-text-secondary">
          {NAME_LOCKED_SENTENCE}
        </p>
      )}
      <div className="mt-3 space-y-1 text-caption text-text-secondary">
        <p data-testid="preview-factsheet">{factsheetLine}</p>
        <p data-testid="preview-discovery">{discoveryLine}</p>
      </div>
      {canRename && (
        <RenameStrategyDialog
          open={open}
          onClose={() => setOpen(false)}
          strategyId={strategyId}
          currentName={name}
          publicNote={dialogNote}
        />
      )}
    </section>
  );
}
