"use client";

import { useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/**
 * Phase 200 D-03 / D-04 (ROUTE-09): the confirm in front of a re-point.
 *
 * `Use & Sync` on a key the strategy does not use today changes which exchange
 * account the strategy reads trades from, and with it every number on the
 * factsheet. The manager reads which strategy changes from which key to which
 * key, and either presses `Change key` or refuses. `ApiKeyManager` writes
 * `strategies.api_key_id` only from `onConfirm`; `onCancel` (the Cancel button,
 * the Close control, Escape) writes nothing.
 *
 * The labels arrive already resolved (`apiKeyLabelById`), so this component
 * never sees a key id. `currentLabel` is null when the strategy has no key
 * linked yet, so a first link is confirmed too.
 *
 * Focus starts on Cancel: the confirm never defaults to confirming, so a stray
 * Enter refuses the change. `Modal` focuses its header Close control by default,
 * which also refuses, but that is an accident of markup; this pins it.
 *
 * Writes nothing and calls no route itself, so a link failure still surfaces
 * through the sync panel's own error line, exactly as before the dialog.
 */
export function ConfirmKeyChangeDialog({
  open,
  strategyName,
  currentLabel,
  nextLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  strategyName: string;
  currentLabel: string | null;
  nextLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // `Button` takes no ref, so the footer holds it and finds Cancel by attribute.
  const footerRef = useRef<HTMLDivElement>(null);

  // A child's effect runs before its parent's, so `Modal` has called
  // `showModal()` by the time this runs; the focus lands inside the open dialog.
  useEffect(() => {
    if (open) footerRef.current?.querySelector<HTMLButtonElement>("[data-initial-focus]")?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title="Change this strategy's key?">
      <p className="text-sm text-text-secondary mb-4">
        {currentLabel === null
          ? `No key is linked yet. ${strategyName} will read trades from ${nextLabel}.`
          : `${strategyName} will read trades from ${nextLabel} instead of ${currentLabel}.`}
      </p>
      <div ref={footerRef} className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onCancel} data-initial-focus>
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm}>
          Change key
        </Button>
      </div>
    </Modal>
  );
}
