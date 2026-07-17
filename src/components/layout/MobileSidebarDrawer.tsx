"use client";

import { useEffect, useRef, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, type NavAction } from "./Sidebar";

interface MobileSidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  isAllocator?: boolean;
  isManager?: boolean;
  populatedSlugs?: string[];
  /** Ref to the hamburger button in MobileTopBar so focus returns to
   *  it when the drawer closes. Restoration is the a11y pattern that
   *  keeps keyboard users oriented after a dialog dismiss. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Phase 09.1 Plan 11 / R5 — passed through to Sidebar so the
   *  drawer-mounted nav also surfaces the My Allocation badge. */
  flaggedCount?: number;
  /** Phase 110 CONTRIB-01 — forwarded to the drawer's Sidebar so the
   *  "Add a Strategy" client action works from the mobile drawer too. */
  onNavAction?: (action: NavAction) => void;
}

/**
 * Slide-in drawer that mounts the full Sidebar on mobile. Preserves
 * the existing 3-tab bottom MobileNav while exposing the complete
 * allocator workspace (My Allocation, Connections, Scenarios,
 * Recommendations) behind a hamburger button in the top bar.
 *
 * Close interactions: backdrop click, Escape key, route change. We
 * auto-close on pathname change because the Sidebar renders <Link>
 * tags — tapping a nav item triggers Next.js navigation, the pathname
 * updates, and the drawer folds away cleanly without intercepting
 * the click ourselves.
 *
 * Body scroll is locked while the drawer is open so backdrop swipes
 * don't scroll the dashboard underneath. The lock is restored on
 * unmount even if onClose is never called (e.g., component unmounts
 * mid-open during a navigation).
 */
export function MobileSidebarDrawer({
  open,
  onClose,
  isAdmin,
  isAllocator,
  isManager,
  populatedSlugs,
  triggerRef,
  flaggedCount,
  onNavAction,
}: MobileSidebarDrawerProps) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);
  // WR-03 fix: track previous open state so focus restoration only fires
  // on the actual close transition (open=true → open=false), not on
  // initial mount with open=false. Initialized to `open` so the first
  // effect sees prevOpen === open and skips the focus call.
  const prevOpenRef = useRef(open);

  // Close on route change. Guarded so the initial mount with open=false
  // doesn't trigger onClose on first paint.
  useEffect(() => {
    if (open && previousPathname.current !== pathname) {
      onClose();
    }
    previousPathname.current = pathname;
  }, [pathname, open, onClose]);

  // Escape key + Tab focus trap + body scroll lock + initial focus when
  // the drawer opens. Focus restoration on close goes to the hamburger
  // via triggerRef — but only on the actual close transition (was-open
  // → not-open), so the initial mount with open=false does not steal
  // focus from the route's natural tab-stop (WR-03).
  //
  // Audit 2026-05-07 G11.C.2: the dialog declares `aria-modal="true"`
  // but pre-audit code never enforced focus containment. Repeated Tab
  // presses leaked focus to underlying-page elements that were
  // visually hidden behind the backdrop — WCAG 2.1.2 (No Keyboard
  // Trap) and the ARIA Authoring Practices for modal dialogs both
  // require focus containment when aria-modal=true. We now intercept
  // Tab / Shift+Tab and cycle focus among focusable descendants of
  // panelRef.
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) {
      if (wasOpen) triggerRef.current?.focus();
      return;
    }
    const FOCUSABLE_SELECTOR =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      // Note: we don't filter by `offsetParent`/visibility — the
      // drawer is conditionally rendered ('if (!open) return null;')
      // so any element in the DOM at this point is visible. Filtering
      // by computed visibility breaks under jsdom (no layout) and
      // costs us nothing in production.
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        // No focusable descendants — keep focus on the panel itself so
        // keyboard users don't escape to the underlying page.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab from the first focusable wraps to the last.
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab from the last focusable wraps to the first.
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus first nav link in the drawer so keyboard users land inside
    // the dialog instead of on whatever had focus before the hamburger.
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    firstFocusable?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 md:hidden"
      id="mobile-sidebar-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Main navigation"
    >
      {/* Backdrop — tapping anywhere outside the panel closes. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      {/* Drawer panel — slides in from the left edge. 260px matches
          the desktop sidebar width so the Sidebar component layout
          is unchanged between the two variants.
          tabIndex=-1 makes the panel a programmatic focus target so
          the focus-trap fallback (audit 2026-05-07 G11.C.2) can park
          focus on the panel itself when it has no focusable
          descendants — keyboard users still can't escape the
          aria-modal dialog. */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 w-[260px] shadow-xl outline-none"
      >
        <Sidebar
          populatedSlugs={populatedSlugs}
          isAdmin={isAdmin}
          isAllocator={isAllocator}
          isManager={isManager}
          variant="drawer"
          flaggedCount={flaggedCount}
          onNavAction={onNavAction}
        />
      </div>
    </div>
  );
}
