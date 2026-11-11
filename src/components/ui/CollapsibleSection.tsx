"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";
import { useTooltip } from "@/components/ui/Tooltip";
import { termDefinition, type TermKey } from "@/lib/glossary";

type OpenState = "open" | "closed";

/**
 * Broadcast on `window` to ask every CollapsibleSection in the tree to
 * pop open. Used by the factsheet ControlBar's "Reset view" button (see
 * FactsheetView.ControlBar) and any other surface that wants a one-shot
 * "expand everything" affordance.
 */
export const COLLAPSIBLE_OPEN_ALL_EVENT = "collapsible-section:open-all";

/**
 * Generalized collapsible section wrapper — native <details> at the core so
 * it's keyboard-accessible by default, works without JS, and prints with the
 * user's last open/closed state. Persists open/closed via an optional
 * `storageKey` so a reload restores the user's chosen layout.
 *
 * Factsheet-agnostic: analytics are decoupled via the optional `onToggle`
 * callback (the consumer wires its own tracking) rather than a hard import, so
 * any surface (factsheet, scenario composer, ...) can reuse it without dragging
 * in a sibling dependency.
 *
 * Panel-interactivity best practice: collapsing the heaviest below-fold
 * sections lets users focus on what matters. Default varies by section — heavy/
 * optional content can start collapsed.
 */
export function CollapsibleSection({
  id,
  title,
  term,
  subtitle,
  defaultOpen = true,
  storageKey,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  /**
   * Phase 201 (D-01): the registry term the title names. The title sits inside the `<summary>`,
   * which is already the interactive control, so this is Form B: nothing focusable is added to
   * the look. Hover on the title and keyboard focus on the summary both open the registry text,
   * and the summary carries `aria-describedby`. The summary stays the `<details>` element's
   * direct child (a `Tooltip` wrapper around it would break that), so the behaviour comes from
   * `useTooltip` wired onto the summary rather than from a wrapper. (`Term` would nest a
   * focusable inside a summary.)
   */
  term?: TermKey;
  subtitle?: string;
  defaultOpen?: boolean;
  storageKey?: string;
  /**
   * Invoked with the new open boolean ONLY on a user-initiated toggle
   * (after hydration, when the state actually changed). NOT called on the
   * mount-time default-vs-stored reconciliation. Optional — toggling still
   * works and persists when absent.
   */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  // B7 — open/closed persistence routes through the cross-tab primitive
  // (SSR-safe deferred hydration so server HTML matches the first client
  // render, cross-tab StorageEvent sync, fail-loud read/write). The codec is a
  // `rawStringCodec` that stores the literal "open"/"closed" string (no JSON
  // envelope) — byte-compatible with the pre-B7 `setItem(storageKey, "open")`
  // write, so existing stored section states survive. The key is the raw
  // `storageKey` prop unchanged (e.g. `factsheet-collapse:${id}:perf` or
  // `composer-collapse:controls`) — it MUST live under a prefix registered in
  // `storage-namespaces.ts` so the sign-out purge reaches it.
  //
  // The codec is built from `defaultOpen` via useMemo so an ABSENT key
  // (raw === null) yields the section's own default; only the literal "closed"
  // (or "open") overrides it. Disabled when no storageKey is provided so a
  // section without persistence never touches localStorage (and never reads a
  // prefix-only key).
  const codec = useMemo(
    () =>
      rawStringCodec<OpenState>({
        parse: (raw) =>
          raw === "closed" ? "closed" : raw === "open" ? "open" : defaultOpen ? "open" : "closed",
        serialize: (v) => v,
      }),
    [defaultOpen],
  );
  const {
    value: persistedOpen,
    setValue: setPersistedOpen,
    isHydrated: hydrated,
  } = useCrossTabStorage<OpenState>({
    key: storageKey ?? "factsheet-collapse:__unused__",
    initial: defaultOpen ? "open" : "closed",
    codec,
    enabled: Boolean(storageKey),
    sentryArea: "factsheet.section",
  });

  const [open, setOpen] = useState(defaultOpen);
  const { setTriggerEl, show, hide, id: tipId, open: tipOpen, bubble } = useTooltip(term ? termDefinition(term) : "");

  // After the primitive's deferred load completes, adopt the persisted (or
  // cross-tab-synced) open/closed state into the local `open` flag that drives
  // the <details> element. setState in this effect is the standard hydration
  // pattern — we cannot read localStorage at SSR time.
  useEffect(() => {
    if (!hydrated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(persistedOpen === "open");
  }, [hydrated, persistedOpen]);

  // "Reset view" broadcasts COLLAPSIBLE_OPEN_ALL_EVENT so every collapsed
  // section pops back open. We listen here rather than in a parent so
  // sections that were rendered conditionally still register cleanly. Persist
  // the pop-open so the restored layout survives a reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setOpen(true);
      setPersistedOpen("open");
    };
    window.addEventListener(COLLAPSIBLE_OPEN_ALL_EVENT, handler);
    return () => window.removeEventListener(COLLAPSIBLE_OPEN_ALL_EVENT, handler);
  }, [setPersistedOpen]);

  return (
    <details
      id={id}
      open={open}
      onToggle={e => {
        const nextOpen = (e.target as HTMLDetailsElement).open;
        // Only fire analytics for user-initiated toggles (skip the initial
        // mount when we're matching the stored preference).
        if (hydrated && nextOpen !== open) {
          onToggle?.(nextOpen);
        }
        setOpen(nextOpen);
        // Persist the user's choice (no-op when disabled / readOnly inside the
        // primitive). Skip pre-hydration toggles so the mount-time
        // default-vs-stored reconciliation never re-persists.
        if (hydrated) setPersistedOpen(nextOpen ? "open" : "closed");
      }}
      className="group"
    >
      <summary
        aria-describedby={term && tipOpen ? tipId : undefined}
        onFocus={term ? show : undefined}
        onBlur={term ? hide : undefined}
        onMouseLeave={term ? hide : undefined}
        className="flex items-baseline justify-between gap-3 cursor-pointer list-none border-b border-border py-3 mb-4 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm min-h-[44px]"
      >
        <div className="flex items-baseline gap-3">
          <span
            aria-hidden
            className="inline-block w-2 h-2 transition-transform group-open:rotate-90"
            style={{
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              borderLeft: "5px solid var(--color-text-muted)",
            }}
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
            {term ? (
              <span
                ref={setTriggerEl}
                className="inline"
                onMouseEnter={show}
                onMouseLeave={hide}
              >
                {title}
                {bubble}
              </span>
            ) : (
              title
            )}
          </h2>
          {subtitle && (
            <span className="text-fixed-11 text-text-muted normal-case tracking-normal">
              {subtitle}
            </span>
          )}
        </div>
        <span className="text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted">
          {open ? "Hide" : "Show"}
        </span>
      </summary>
      <div className="flex flex-col gap-10">{children}</div>
    </details>
  );
}
