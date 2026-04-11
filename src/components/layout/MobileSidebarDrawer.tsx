"use client";

import { useEffect, useRef, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

interface MobileSidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  isAllocator?: boolean;
  populatedSlugs?: string[];
  /** Ref to the hamburger button in MobileTopBar so focus returns to
   *  it when the drawer closes. Restoration is the a11y pattern that
   *  keeps keyboard users oriented after a dialog dismiss. */
  triggerRef: RefObject<HTMLButtonElement | null>;
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
  populatedSlugs,
  triggerRef,
}: MobileSidebarDrawerProps) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);

  // Close on route change. Guarded so the initial mount with open=false
  // doesn't trigger onClose on first paint.
  useEffect(() => {
    if (open && previousPathname.current !== pathname) {
      onClose();
    }
    previousPathname.current = pathname;
  }, [pathname, open, onClose]);

  // Escape key + body scroll lock + initial focus when the drawer opens.
  // Focus restoration on close goes to the hamburger via triggerRef.
  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
          is unchanged between the two variants. */}
      <div
        ref={panelRef}
        className="absolute inset-y-0 left-0 w-[260px] shadow-xl"
      >
        <Sidebar
          populatedSlugs={populatedSlugs}
          isAdmin={isAdmin}
          isAllocator={isAllocator}
          variant="drawer"
        />
      </div>
    </div>
  );
}
