"use client";

import { forwardRef } from "react";

interface MobileTopBarProps {
  onMenuClick: () => void;
  menuOpen: boolean;
}

/**
 * Minimal mobile-only top bar hosting the hamburger button + product
 * name. Hidden on md+ so desktop is unaffected. Sticky so it stays at
 * the top of the scrollable <main> container as the user scrolls the
 * dashboard.
 *
 * The hamburger button is the trigger for MobileSidebarDrawer —
 * DashboardChrome owns the open/close state and passes a ref so the
 * drawer can restore focus to this button on close.
 */
export const MobileTopBar = forwardRef<HTMLButtonElement, MobileTopBarProps>(
  function MobileTopBar({ onMenuClick, menuOpen }, ref) {
    return (
      <div className="md:hidden sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-surface px-3">
        <button
          ref={ref}
          type="button"
          onClick={onMenuClick}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-sidebar-drawer"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-primary transition-colors hover:bg-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 6h14M3 10h14M3 14h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className="font-display text-base text-text-primary">
          Quantalyze
        </span>
      </div>
    );
  },
);
