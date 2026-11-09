"use client";

/**
 * Factsheet back link (Phase 196, D-01 / ROUTE-04).
 *
 * The page resolves the origin server-side (`parseOrigin` + `backTargetFor`)
 * and passes the result in; this component never reads the query itself, so a
 * viewer-supplied value cannot reach an href here.
 *
 * With no origin the server render and first client paint read "Go to
 * Discovery" (a plain same-origin link, so the control is never dead without
 * JS). After hydration, a same-origin referrer plus history to go back to
 * switches the label to "Back" and the click to the browser's history. An
 * off-site or empty referrer stays on "Go to Discovery": the control never
 * navigates off-site.
 */
import { useSyncExternalStore, type MouseEvent } from "react";
import Link from "next/link";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";
import type { BackTarget } from "@/lib/factsheet/origin";

const LINK_CLASS =
  "text-body text-text-secondary hover:text-text-primary transition-colors duration-150 ease-out min-h-[44px] inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

/** True only for a parseable referrer on this site, with history to return to. */
function hasSameOriginHistory(): boolean {
  try {
    if (!document.referrer) return false;
    const referrerOrigin = new URL(document.referrer).origin;
    return (
      referrerOrigin === window.location.origin && window.history.length > 1
    );
  } catch {
    // Malformed referrer: stay on the fixed same-origin link.
    return false;
  }
}

// The referrer and history length do not change for the life of the page, so
// there is nothing to subscribe to. useSyncExternalStore gives the server (and
// the hydration pass) the fixed `false` and then the real client reading.
const subscribeNever = () => () => {};
const serverSnapshot = () => false;

export function BackLink({ target }: { target: BackTarget | null }) {
  const useHistory = useSyncExternalStore(
    subscribeNever,
    hasSameOriginHistory,
    serverSnapshot,
  );

  if (target !== null) {
    return (
      <Link href={target.href} className={LINK_CLASS}>
        <span aria-hidden="true">←</span>
        {" "}
        {target.label}
      </Link>
    );
  }

  const onClick = useHistory
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        window.history.back();
      }
    : undefined;

  return (
    <Link
      href={DEFAULT_AUTHENTICATED_ROUTE}
      onClick={onClick}
      className={LINK_CLASS}
    >
      <span aria-hidden="true">←</span>
      {" "}
      {useHistory ? "Back" : "Go to Discovery"}
    </Link>
  );
}
