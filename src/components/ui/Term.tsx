"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import {
  termDefinition,
  termLabel,
  type TermContext,
  type TermKey,
} from "@/lib/glossary";

/**
 * Phase 201 plan 01 (D-01, D-03, D-19, D-20): the registry-backed term trigger.
 *
 * Two forms (201-UI-SPEC Interaction contract 1):
 *   A. `Term` (this file): a static label in a label position. One tab stop, a
 *      dotted muted underline, the registry definition on hover and keyboard focus.
 *      NEVER nest it inside a button, link, summary, tab or any interactive role.
 *   B. A label that is already a control (sort button, tab, nav link, summary) is
 *      wrapped in `Tooltip` directly with `termDefinition(key)`. The control is
 *      the affordance; nothing is added.
 *
 * Adds no visible text node and no font, size, weight, colour, transform or
 * tracking class: it inherits all of them from the label it wraps.
 *
 * Known limits (recorded, not fixed here, UI-SPEC U-04):
 *   - No Escape-to-dismiss. An Escape handler would call preventDefault inside the
 *     "All Filters" panel and swallow its own Escape-to-close (D-12).
 *   - No tap handler. The touch primitives (TouchTooltip, useTapPin) are frozen; a
 *     browser that focuses a tapped tabIndex=0 span opens the bubble through focus.
 *
 * Print: under a `PlainTerms` ancestor (the tearsheet print view) `Term` renders
 * its plain label with no element at all (D-20).
 */

const PlainTermsContext = createContext(false);

/** Renders every `Term` below it as plain text: no span, no tabIndex, no underline, no bubble. */
export function PlainTerms({ children }: { children: ReactNode }) {
  return (
    <PlainTermsContext.Provider value={true}>
      {children}
    </PlainTermsContext.Provider>
  );
}

const FORM_A_CLASSES =
  "cursor-help underline decoration-dotted decoration-1 decoration-text-muted underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 print:no-underline";

export function Term({
  k,
  context,
  children,
}: {
  k: TermKey;
  context?: TermContext;
  children?: ReactNode;
}) {
  const plain = useContext(PlainTermsContext);
  const label = children ?? termLabel(k);
  if (plain) return <>{label}</>;
  return (
    <Tooltip content={termDefinition(k, context)} className="inline">
      {({ "aria-describedby": describedBy }) => (
        <span
          tabIndex={0}
          data-term={k}
          aria-describedby={describedBy}
          className={FORM_A_CLASSES}
        >
          {label}
        </span>
      )}
    </Tooltip>
  );
}
