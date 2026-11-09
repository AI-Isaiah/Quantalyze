"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";

type OpenState = "open" | "closed";

/**
 * ⛔ Under the REGISTERED `factsheet-collapse:` prefix (`storage-namespaces.ts`), not the
 * UI-SPEC's `factsheet:advanced-open`: only a key under a registered prefix is reached by the
 * sign-out purge, so any other spelling would outlive the session (T-196-22). One key for the
 * viewer, not per strategy: a reader who opens Advanced finds it open on every factsheet.
 */
const ADVANCED_STORAGE_KEY = "factsheet-collapse:advanced";

/** Only the literals "open" and "closed" mean anything. Anything else (another script's write,
 *  a stale format, a cross-tab garbage value) reads closed, never throws (T-196-23). */
const advancedCodec = rawStringCodec<OpenState>({
  parse: (raw) => (raw === "open" ? "open" : "closed"),
  serialize: (v) => v,
});

/**
 * Phase 196 (D-04, LEAN-05) — the one "Advanced" disclosure under the factsheet's
 * opening view (summary strip, one equity figure, one metrics table).
 *
 * Native `<details>` / `<summary>`, the CollapsibleSection idiom: keyboard and
 * screen-reader support for free, and it prints. Collapsed on the server render.
 *
 * ⛔ THE CONTENTS MOUNT ON FIRST OPEN, NOT ON FIRST RENDER. A closed `<details>`
 * still mounts and renders its children (they are only hidden), so without this a
 * closed Advanced would pay for every chart on the page — the cost the opening view
 * exists to remove. `everOpened` is sticky: once opened, the contents stay mounted
 * through a close, so reopening is instant and no chart state is lost.
 *
 * Remembered per viewer through the cross-tab primitive (deferred hydration: the server and
 * the first client render are both closed, the stored state is adopted after hydration, so the
 * first paint never depends on storage). With storage unavailable or throwing the primitive
 * falls back to in-memory state, so it renders closed and still opens and closes in-session.
 *
 * ⛔ It does NOT listen for the open-all event: "Reset view" pops the sections open
 * but must never open Advanced (the sections inside Advanced still answer it).
 */
export function AdvancedDisclosure({
  sections,
  hasRailContent = true,
  children,
}: {
  /** The titles of the sections actually rendered inside, in order. Built by the
   *  caller from the same conditions that mount each section, so the contents line
   *  never names a section that is not there. */
  sections: { id: string; title: string }[];
  /** Whether the Detailed metrics rail has anything to show. With no section and no rail there
   *  is nothing to disclose, so the whole disclosure is omitted (D-04: an empty Advanced is not
   *  rendered, never an empty frame). Defaults to true, the case of every record. */
  hasRailContent?: boolean;
  children: ReactNode;
}) {
  const {
    value: persisted,
    setValue: setPersisted,
    isHydrated,
  } = useCrossTabStorage<OpenState>({
    key: ADVANCED_STORAGE_KEY,
    initial: "closed",
    codec: advancedCodec,
    sentryArea: "factsheet.advanced",
  });
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  // Adopt the stored (or cross-tab-synced) state once the deferred load has run. localStorage
  // cannot be read at SSR time, so setState in this effect is the standard hydration pattern.
  useEffect(() => {
    if (!isHydrated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(persisted === "open");
  }, [isHydrated, persisted]);

  // Adjust-state-during-render: the sticky flag follows `open` without an effect.
  if (open && !everOpened) setEverOpened(true);

  if (sections.length === 0 && !hasRailContent) return null;

  const contentsLine = [...sections.map((s) => s.title), ...(hasRailContent ? ["Detailed metrics"] : [])].join(" · ");

  return (
    <details
      id="factsheet-advanced"
      // The SC-5 census hook (scripts/factsheet-census/count.ts) sits on the row itself: the
      // counter dedupes by element, so the Advanced row is ONE section, not a wrapper plus its
      // details.
      data-census-section="advanced"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        // Skip pre-hydration toggles so the mount-time reconciliation never re-persists.
        if (isHydrated) setPersisted(next ? "open" : "closed");
      }}
      className="group mt-12"
    >
      <summary className="factsheet-v2-no-print flex items-baseline justify-between gap-3 cursor-pointer list-none border-t-2 border-text py-4 min-h-[44px] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <span
            aria-hidden
            className="inline-block w-2 h-2 shrink-0 transition-transform duration-150 ease-out group-open:rotate-90"
            style={{
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              borderLeft: "5px solid var(--color-text-muted)",
            }}
          />
          <h2 className="text-h3 font-semibold text-text-primary">Advanced</h2>
          <span className="text-caption text-text-secondary">{contentsLine}</span>
        </div>
        <span className="shrink-0 text-micro font-mono uppercase tracking-[0.18em] text-text-muted">
          {open ? "Hide" : "Show"}
        </span>
      </summary>
      {everOpened && (
        <div data-advanced-contents className="mt-6">
          {children}
        </div>
      )}
    </details>
  );
}
