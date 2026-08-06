"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import { buildEnvelope, type ErrorEnvelope as ErrorEnvelopeShape } from "@/lib/envelope";

/**
 * Phase 150 / OWN-05 — the owner relabels their own private or draft strategy.
 *
 * Same dialog shape as MarkOwnershipDialog (Modal + status machine +
 * router.refresh(), writing through the route rather than from the browser),
 * with two properties specific to this form:
 *
 *   1. VALIDATION IS INLINE AND THE CTA STAYS CLICKABLE. `Save name` is never
 *      greyed for a validation problem: pressing it surfaces the message AT the
 *      field and moves focus there. Greying it would leave a blocked action with
 *      no remedy attached, which the no-disabled-buttons direction forbids. The
 *      in-flight label is a separate concern and is kept.
 *
 *   2. THE CLIENT NEVER SHORTENS THE OWNER'S NAME. PATCH /api/strategies/{id}/name
 *      REJECTS an over-long name (400 `name too long`) instead of silently
 *      capping it — a deliberate divergence from the alias route, because
 *      quietly dropping the tail of a proper name the owner will see rendered
 *      back is a fail-quiet. Capping the input here would hide that contract, so
 *      the field accepts what the user types and the cap surfaces as a message.
 *
 * Only TRIM is applied before sending, matching the route's own normalisation
 * exactly, so a name that is legal after trimming is never rejected locally.
 *
 * The route's two documented 400 arms land INLINE at the field rather than in
 * the envelope: they are field-level problems with a field-level remedy, and
 * this phase's forms must not re-introduce the terminal-envelope class for
 * those. Every other failure is the canonical envelope.
 *
 * D-17 (private/draft only) is enforced on the SERVER — the route's UPDATE
 * chain filters on status, so a published row answers 404. The render gates on
 * both surfaces are defence in depth, not the gate.
 */

/** UI-SPEC product cap. `strategies.name` itself is uncapped TEXT in the DB. */
const MAX_NAME_LENGTH = 80;

const ERROR_EMPTY = "Enter a name.";
const ERROR_TOO_LONG = "Keep it under 80 characters.";

/** The route's two field-level refusals, mapped to their inline copy. */
const ROUTE_FIELD_ERRORS: Record<string, string> = {
  "invalid name": ERROR_EMPTY,
  "name too long": ERROR_TOO_LONG,
};

export function RenameStrategyDialog({
  open,
  onClose,
  strategyId,
  currentName,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  currentName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(currentName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [envelope, setEnvelope] = useState<ErrorEnvelopeShape | null>(null);

  // Re-opening re-reads the row's current name and clears any prior failure, so
  // a host that keeps this mounted across rows never shows the previous name.
  useEffect(() => {
    if (!open) return;
    setName(currentName);
    setFieldError(null);
    setStatus("idle");
    setEnvelope(null);
  }, [open, currentName, strategyId]);

  function failField(message: string) {
    setFieldError(message);
    inputRef.current?.focus();
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      failField(ERROR_EMPTY);
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      failField(ERROR_TOO_LONG);
      return;
    }

    setFieldError(null);
    setEnvelope(null);
    setStatus("loading");

    try {
      const res = await fetch(`/api/strategies/${strategyId}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        if (res.status === 400) {
          const body = (await res.json()) as { error?: unknown };
          const inline =
            typeof body.error === "string"
              ? ROUTE_FIELD_ERRORS[body.error]
              : undefined;
          if (inline) {
            failField(inline);
            setStatus("idle");
            return;
          }
        }
        setEnvelope(buildEnvelope("UNKNOWN", crypto.randomUUID()));
        setStatus("idle");
        return;
      }

      setStatus("idle");
      onClose();
      router.refresh();
    } catch {
      setEnvelope(buildEnvelope("UNKNOWN", crypto.randomUUID()));
      setStatus("idle");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rename strategy">
      <Field
        label="Name"
        hint="Only you see this name. Public surfaces keep showing the codename."
        error={fieldError ?? undefined}
      >
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-negative"
        />
      </Field>
      {envelope && (
        <div className="mt-4">
          <ErrorEnvelope envelope={envelope} />
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {/* Never disabled for a validation problem — only while in flight. */}
        <Button
          type="button"
          onClick={handleSave}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Saving..." : "Save name"}
        </Button>
      </div>
    </Modal>
  );
}
