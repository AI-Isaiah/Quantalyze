"use client";

import { Modal } from "@/components/ui/Modal";

/** Keyboard shortcut hint modal triggered by `?`. */
export function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  const shortcuts: Array<{ keys: string[]; label: string }> = [
    { keys: ["j"], label: "Next candidate" },
    { keys: ["k"], label: "Previous candidate" },
    { keys: ["s"], label: "Open Send Intro panel" },
    { keys: ["u"], label: "Mark as keep (thumbs up)" },
    { keys: ["d"], label: "Mark as skip (thumbs down)" },
    { keys: ["r"], label: "Recompute now" },
    { keys: ["?"], label: "Show this help" },
    { keys: ["Esc"], label: "Close open panel" },
  ];
  return (
    <Modal open onClose={onClose} title="Keyboard shortcuts">
      <p className="text-sm text-text-secondary mb-4">
        Shortcuts only fire on the match-queue page and only on desktop
        (1024px+). They&rsquo;re suppressed whenever a modal or input has
        focus.
      </p>
      <dl className="space-y-2">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.label}
            className="flex items-center justify-between border-b border-border pb-2 last:border-b-0"
          >
            <dt className="text-sm text-text-primary">{shortcut.label}</dt>
            <dd className="flex items-center gap-1">
              {shortcut.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex items-center rounded border border-border bg-page px-2 py-0.5 font-mono text-[11px] text-text-primary"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
