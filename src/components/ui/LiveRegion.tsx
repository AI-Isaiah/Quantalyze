/**
 * `<LiveRegion>` — a visually-inert ARIA announcement primitive.
 *
 * WHAT THIS IMPLEMENTS, AND WHAT IT DOES NOT DECIDE.
 * This component makes no new design decision. It implements `DESIGN.md`
 * §A11y minimums (DESIGN-05) verbatim:
 *
 *   "ARIA live regions: `role="alert"` on blocking errors; `role="status"` +
 *    `aria-live="polite"` on non-blocking state changes."
 *
 * The alert/status split below IS that rule; it is not a choice made here.
 *
 * AN EXTRACTION, NOT AN INVENTION.
 * The idiom already exists in this tree — `CardShell.tsx:77` renders
 * `<p role="status" aria-live="polite" className="sr-only">` — and recurs
 * ad-hoc at roughly twenty sites, with no reusable primitive in
 * `src/components/ui/`. This is that idiom, hoisted, so a consumer inherits
 * the announcement instead of re-typing it (and instead of omitting it: 27
 * `.tsx` files under `src/` set an error state with ZERO announcement channel
 * file-wide, and three `role="alert"` deletions shipped green in the last
 * milestone range because nothing asserted one).
 *
 * WHY IT IS `sr-only`, ALWAYS.
 * An announcement is a property of the *render*, independent of which
 * component draws the visual. Keeping this element visually empty is what lets
 * it be dropped into an already-designed error card without touching a colour,
 * a spacing token or a typographic class — i.e. without amending a
 * founder-owned `DESIGN.md` decision. The alternative (routing those surfaces
 * through `ErrorEnvelope`, which does carry `role="alert"`) is a visual
 * redesign of each surface and is deliberately out of scope.
 *
 * ⚠️ `className` is a hard-coded literal with no override prop, on purpose.
 * The moment this primitive can carry a visible style, adopting it stops being
 * a no-op and becomes an unreviewed design change at every adoption site at
 * once. `LiveRegion.test.tsx` pins the class to EXACTLY `sr-only`.
 *
 * WHY THE REGION RENDERS BEFORE ITS MESSAGE ARRIVES.
 * `message` may be `null` and the element still renders. Assistive technology
 * announces a *change* to a live region it is already observing; a region that
 * is mounted at the same moment as its text is frequently missed entirely.
 * Returning `null` for an empty message is the obvious "simplification" here
 * and it would silently make the primitive a no-op on first paint.
 */

export interface LiveRegionProps {
  /**
   * The sentence to announce. Pass the SAME sentence the surface already
   * renders visually — this primitive is a second channel for existing copy,
   * never a place to author new copy.
   */
  message: string | null;
  /**
   * `true` for a blocking error (DESIGN-05: `role="alert"`), `false`/omitted
   * for a non-blocking state change (`role="status"` + `aria-live="polite"`).
   */
  assertive?: boolean;
}

export function LiveRegion({ message, assertive = false }: LiveRegionProps) {
  return (
    <p
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      className="sr-only"
    >
      {message}
    </p>
  );
}
