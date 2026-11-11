"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="backdrop:bg-black/40 bg-transparent p-0 m-auto"
    >
      <div className="bg-surface rounded-xl border border-border shadow-elevated w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h3 font-semibold text-text-primary">{title}</h2>
          {/* 44x44 matches the ui/Button md size the dialogs' own buttons use
              and the 44px e2e target bar (WCAG 2.5.8's minimum is 24px).
              -my-3 -mr-3 (12px) keeps the glyph and the header height where
              they were, inside the card's 24px padding. */}
          <button
            onClick={onClose}
            className="-my-3 -mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
