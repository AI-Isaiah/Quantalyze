/**
 * Signed-in factsheet bar (Phase 196, D-01 / D-02, UI-SPEC "Viewer bar").
 *
 * Sits above the document, outside `FactsheetBody`, so the document's own
 * layout work never collides with it. A server component: the viewer is decided
 * per request by the page and arrives as a prop, never through the payload.
 *
 * Every signed-in viewer gets the back link. The actions beside it follow the
 * Viewer-State Matrix: an approved allocator gets the allocation step and the
 * intro request; the owner gets Edit strategy; anyone else gets none. The
 * actions are affordances only, and the routes they reach keep their own server
 * checks.
 *
 * A link that navigates carries the `Button` class set and is never a
 * `<button>` with a router push (UI-SPEC). `Add to my allocation` targets the
 * Phase 198 add-flow deep link (My allocation with an `add` parameter), which opens the flow
 * pre-filled and validates the id server-side.
 */
import Link from "next/link";
import { BackLink } from "@/components/factsheet/BackLink";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { buttonClassName } from "@/components/ui/Button";
import type { BackTarget } from "@/lib/factsheet/origin";
import type { FactsheetViewer } from "@/lib/factsheet/viewer";

export function ViewerBar({
  backTarget,
  viewer,
  strategyId,
}: {
  backTarget: BackTarget | null;
  viewer: Extract<FactsheetViewer, { kind: "signed_in" }>;
  strategyId: string;
}) {
  const hasActions = viewer.canAllocate || viewer.isOwner;
  return (
    <header className="factsheet-v2-no-print bg-surface border-b border-border">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-2 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Back">
          <BackLink target={backTarget} />
        </nav>
        {hasActions && (
          <div role="group" aria-label="Actions for this strategy" className="flex flex-wrap items-center gap-2">
            {viewer.canAllocate && (
              <>
                <Link
                  href={`/allocations?add=${encodeURIComponent(strategyId)}`}
                  className={buttonClassName({ variant: "secondary", size: "md" })}
                >
                  Add to my allocation
                </Link>
                <RequestIntroButton strategyId={strategyId} />
              </>
            )}
            {viewer.isOwner && (
              <Link
                href={`/strategies/${encodeURIComponent(strategyId)}/edit`}
                className={buttonClassName({ variant: "secondary", size: "md" })}
              >
                Edit strategy
              </Link>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
