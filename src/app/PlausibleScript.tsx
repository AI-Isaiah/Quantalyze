"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

import { isSharePath } from "@/lib/scrub-share-path";

/**
 * Phase 164 / SHARE-01 — the site-wide Plausible tag, WITHDRAWN on the
 * recipient share lane.
 *
 * ⭐ THIS IS THE GENUINELY NEW LEAK CHANNEL UNDER RULING D-01, and it is worth
 * stating why rather than assuming it. Plausible sends `location.href` on every
 * event (`N.u = location.href` in the live bundle). While the token was a query
 * parameter that was harmless — Plausible does not surface query strings. As a
 * PATH SEGMENT the token is the pathname, so a recipient opening a private link
 * would hand a live capability to a third-party analytics host on page load.
 * The query-param analysis in PITFALLS.md never had to consider this.
 *
 * ⛔ WHY OMISSION AND NOT `data-exclude`. The plan proposed switching to
 * Plausible's `exclusions` script extension and adding
 * `data-exclude="/factsheet-share/*"`. That mechanism was carried as [ASSUMED]
 * (the research session had no network). VERIFIED 2026-08-28 by fetching the
 * real artefacts, and it is the wrong tool for TWO measured reasons:
 *
 *   1. IT IS PAGEVIEW-ONLY. `https://plausible.io/js/script.exclusions.tagged-events.js`
 *      (HTTP 200, 4497 bytes) gates the exclusion behind `if ("pageview" === m)`.
 *      A tagged event fired anywhere on the lane still posts `location.href`
 *      with the token intact. The wildcard semantics ARE as assumed
 *      (`*` → `[^\s/]*`, anchored) — that half of the research held up.
 *   2. IT IS REMOVED FROM THE CURRENT SCRIPT. Plausible's script-update guide
 *      (docs/script-update-guide.md, §10, fetched 2026-08-28) lists
 *      "Removed: `data-exclude` and `data-include`" for the October-2025
 *      script, and points at docs/excluding.md — whose page exclusion is a
 *      SERVER-SIDE dashboard Shield. A Shield stops Plausible RECORDING the
 *      hit; it does not stop the browser SENDING it. For a capability token
 *      that is not a mitigation at all: the secret has already crossed the
 *      trust boundary. Worse, the migration is silent — regenerating the
 *      snippet from Plausible's site settings would drop the attribute with no
 *      error and reopen the channel.
 *
 * Not loading the script is stronger than both and depends on nothing a third
 * party can deprecate: no script means no pageview, no tagged event, and no
 * `location.href` in any request.
 *
 * ⛔ IT IS ALSO NOT "no tagged events exist today, so pageview-only is fine".
 * That is an accident of the current tree (measured: zero
 * `plausible-event-name=` sites in `src/`), and an accident is not a
 * mitigation — the same Pitfall-6 reasoning that refuses to count the CSP's
 * missing PostHog host as a control.
 *
 * WHY A CLIENT COMPONENT. A layout cannot know the pathname server-side —
 * layouts do not re-render on navigation, so Next deliberately withholds it
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`
 * §Pathname, Next 16.2.11). `usePathname` in a Client Component is the
 * documented mechanism, and it resolves during the server render of this
 * component too, so the tag is absent from the SSR HTML as well as after
 * hydration.
 *
 * ⚠️ `usePathname` needs a `Suspense` boundary only when `cacheComponents` is
 * enabled (same doc). It is not enabled here — and `src/app/layout.tsx` already
 * carries the note that turning it on requires reworking that file's
 * `force-dynamic` pin. Whoever does that must revisit this component too.
 */

/** The tracker build. Exported so the test pins the exact src the DOM gets,
 *  rather than a substring typed twice. */
export const PLAUSIBLE_SCRIPT_SRC =
  "https://plausible.io/js/script.tagged-events.js";

export function PlausibleScript({ domain }: { domain: string }) {
  const pathname = usePathname();
  // Fail-closed on an unknown pathname: `usePathname` is typed non-null, but a
  // null here would otherwise sail through `isSharePath` and load the tracker.
  if (!pathname || isSharePath(pathname)) return null;

  return (
    <Script
      defer
      data-domain={domain}
      src={PLAUSIBLE_SCRIPT_SRC}
      strategy="afterInteractive"
    />
  );
}
