"use client";

import { useMemo } from "react";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";

/**
 * DefaultChangeNote (POLISH-03) — the one-time union→intersection education note.
 *
 * When the intersection default actually truncates the union (the selected
 * members have differing spans), a returning allocator could be surprised that
 * the composer opened on the common period rather than the full range. This note
 * says so plainly and offers a one-click escape hatch back to the full range.
 *
 * Shown ONLY when `isHydrated && !dismissed && intersectionTruncatesUnion`
 * (Pitfall 3): never when spans coincide (nothing changed for the user), and —
 * because the render is gated on `isHydrated` — never as a one-frame flash for a
 * returning-dismissed user. The dismissal boolean persists per-browser at the
 * registered composer-namespaced key (Plan 01) through the hardened
 * `useCrossTabStorage` primitive (deferred hydration so server HTML ===
 * first client render; cross-tab sync; sign-out purge; Sentry breadcrumbs). Raw
 * `localStorage` is banned here (B25 lint) — the primitive owns all storage IO.
 *
 * This is an informational note, NOT a warning-tier alert: root is a polite
 * status live region (never the assertive alert role, which DESIGN.md reserves
 * for blocking errors). No icons — the `×` is a text glyph. Only DESIGN.md
 * tokens; no raw font px.
 */
export interface DefaultChangeNoteProps {
  /** N = the engine member count; interpolated into the verbatim copy. */
  memberCount: number;
  /**
   * True when the effective/intersection window is narrower than the union of
   * the selected set — the only condition under which the note is meaningful.
   */
  intersectionTruncatesUnion: boolean;
  /** The escape hatch — apply the existing Full-range preset. */
  onShowFullRange: () => void;
}

export function DefaultChangeNote({
  memberCount,
  intersectionTruncatesUnion,
  onShowFullRange,
}: DefaultChangeNoteProps) {
  // Boolean persistence via the SAME idiom CollapsibleSection uses for its
  // open/closed flag (rawStringCodec + useCrossTabStorage), swapped to a
  // "true"/"false" boolean. An absent key parses to `false` (not dismissed).
  const codec = useMemo(
    () =>
      rawStringCodec<boolean>({
        parse: (raw) => raw === "true",
        serialize: (v) => (v ? "true" : "false"),
      }),
    [],
  );
  const {
    value: dismissed,
    setValue: setDismissed,
    isHydrated,
  } = useCrossTabStorage<boolean>({
    key: "composer.coverageDefaultChangeNoteDismissed",
    initial: false,
    codec,
    sentryArea: "composer.default-change-note",
  });

  // Gate on isHydrated so the note never flashes before the stored dismissal is
  // known (Pitfall 3), and only when the intersection genuinely truncated.
  if (!isHydrated || dismissed || !intersectionTruncatesUnion) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="scenario-default-change-note"
      className="mt-6 flex items-start justify-between gap-3 rounded-md border border-border bg-surface-subtle px-4 py-3"
    >
      <p className="text-fixed-13 leading-relaxed text-text-secondary">
        Now showing the common period where all{" "}
        <span className="font-mono tabular-nums">{memberCount}</span> overlap ·{" "}
        <button
          type="button"
          onClick={onShowFullRange}
          className="rounded-sm font-medium text-accent transition-colors duration-150 ease-out hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none"
        >
          Show full range
        </button>
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-sm px-1 text-fixed-13 text-text-muted transition-colors duration-150 ease-out hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none"
      >
        ×
      </button>
    </div>
  );
}
