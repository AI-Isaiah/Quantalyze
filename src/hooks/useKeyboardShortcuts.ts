"use client";

import { useEffect, useRef } from "react";

interface Shortcut {
  key: string; // Single character
  handler: () => void;
  requireNoModifiers?: boolean; // Default true
}

/**
 * Simple keyboard shortcuts for power-user admin UIs.
 *
 * Ignores events when the user is typing in an input/textarea/contenteditable,
 * and when any modifier key is pressed (Ctrl/Cmd/Alt/Shift) unless explicitly
 * allowed. This keeps it out of the way of browser shortcuts AND screen reader
 * virtual-cursor navigation.
 *
 * The listener is attached ONCE on mount and dispatches against the latest
 * shortcut handlers via a ref. Without this, every parent re-render would
 * tear down and reattach the listener, AND stale closures could fire
 * handlers bound to old state (e.g., `s` opening Send Intro for the
 * previously-selected candidate).
 *
 * Use with caution; single-letter shortcuts can conflict with assistive tech.
 * This is an admin-only surface, so the tradeoff is acceptable.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  const shortcutsRef = useRef(shortcuts);

  // Keep the ref pointed at the latest handlers without re-attaching the listener.
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore if typing in a text field
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      // Ignore if any modifier pressed
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      for (const shortcut of shortcutsRef.current) {
        if (e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []); // Install once — handlers are fetched from the ref at dispatch time
}
