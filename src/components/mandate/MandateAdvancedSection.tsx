"use client";

import { useState, type ReactNode } from "react";

interface Props {
  trigger: string;
  children: ReactNode;
}

/**
 * Collapsible accordion wrapper for the Advanced constraints group.
 * Collapsed by default; chevron rotates 180° on expand.
 */
export function MandateAdvancedSection({ trigger, children }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = "mandate-advanced-panel";
  return (
    <div className="mt-8 border-t border-border pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between py-1 text-text-primary hover:text-accent transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted group-hover:text-accent">
          {trigger}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={`transition-transform duration-200 ease-in-out ${
            open ? "rotate-180 text-accent" : "text-text-muted"
          }`}
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="mt-5 space-y-6">
        {children}
      </div>
    </div>
  );
}
