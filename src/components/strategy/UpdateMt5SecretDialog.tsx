"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import {
  buildEnvelope,
  type ErrorEnvelope as ErrorEnvelopeShape,
} from "@/lib/envelope";
import {
  recogniseDashboardDialogCode,
  type DashboardDialogRoute,
} from "@/lib/wizardErrors";
import { newCorrelationId } from "@/lib/correlation-id-client";

/**
 * 161-10 / WIZERR-07 — THE ROUTE THIS DIALOG WRITES THROUGH, named once.
 *
 * The literal is the roster key in `DASHBOARD_DIALOG_ROUTE_CODES`
 * (src/lib/wizardErrors.ts), which is what makes recognition PER-ROUTE: this
 * dialog admits the codes `PATCH /api/keys/[id]/rotate-secret` emits and not
 * the whole vocabulary.
 */
const ROUTE: DashboardDialogRoute = "keys/[id]/rotate-secret";

/**
 * Phase 164.5.3 / MT5CREDS Plan 05 — the founder-visible half of D-04's
 * credential-update path (`PATCH /api/keys/[id]/rotate-secret`, Plan 04).
 *
 * Shared by BOTH founder-visible key cards (ApiKeyManager and
 * AllocatorExchangeManager) so the fetch/error-envelope logic exists in
 * exactly ONE place rather than being duplicated across two card files. A
 * distinct action from "Reconnect" everywhere it appears: Reconnect assumes
 * the stored credential is already correct and never re-validates; this
 * dialog corrects a wrong credential and the route re-validates it against
 * the live broker BEFORE persisting anything (D-04) — a failed validation
 * mutates nothing.
 *
 * ⛔ D-03: the ONLY field is the new password. No login, no broker-server
 * field, anywhere — the route recovers both server-side from the row's own
 * stored ciphertext, so changing the account identity is what Delete + Add
 * Key remains for.
 *
 * ⛔ CREDENTIAL HANDLING: `newSecret` never leaves component state except on
 * the one PATCH call, is never logged, and is scrubbed on every close path
 * and whenever this dialog is re-pointed at a different key (the same
 * NEW-C29-03 idiom `ApiKeyForm.tsx` already uses for its own secret field).
 */
export interface UpdateMt5SecretDialogProps {
  open: boolean;
  apiKeyId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function UpdateMt5SecretDialog({
  open,
  apiKeyId,
  onClose,
  onUpdated,
}: UpdateMt5SecretDialogProps) {
  const [newSecret, setNewSecret] = useState("");
  // Reveal toggle for the password field — the `ApiKeyForm.tsx` idiom
  // (type="password"/"text" toggle, aria-pressed, aria-label).
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [envelope, setEnvelope] = useState<ErrorEnvelopeShape | null>(null);

  // Re-opening this dialog, or re-pointing it at a different key (the host
  // owns `open`/`apiKeyId` and keeps this component mounted across rows),
  // clears any prior failure AND the typed secret. Mirrors
  // `RenameStrategyDialog.tsx`'s during-render session-reset idiom so a
  // reopened dialog never shows a stale error or leaks a previous row's
  // plaintext credential into a new session.
  const openSession = `${open}:${apiKeyId}`;
  const [lastSession, setLastSession] = useState(openSession);
  if (openSession !== lastSession) {
    setLastSession(openSession);
    setNewSecret("");
    setShowSecret(false);
    setSubmitting(false);
    setEnvelope(null);
  }

  function handleClose() {
    // NEW-C29-03 idiom: zero the plaintext secret on every close path
    // (Cancel, the Modal's own X, or Escape — all route through onClose).
    setNewSecret("");
    setShowSecret(false);
    onClose();
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setEnvelope(null);

    // Minted BEFORE the request and SENT on it — the same
    // `correlation-id-client` helper `RenameStrategyDialog.tsx` uses.
    const correlationId = newCorrelationId("rotate-secret");

    try {
      const res = await fetch(`/api/keys/${apiKeyId}/rotate-secret`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify({ new_secret: newSecret }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          code?: unknown;
        } | null;
        // 161-10 / WIZERR-07 — the ONE guarded cast (Pitfall 4): an
        // unrostered or unreadable code answers UNKNOWN by design rather
        // than by accident. No local wire-code table here — the roster
        // lives once, in DASHBOARD_DIALOG_ROUTE_CODES.
        setEnvelope(
          buildEnvelope(
            recogniseDashboardDialogCode(ROUTE, body?.code),
            correlationId,
          ),
        );
        setSubmitting(false);
        return;
      }

      setNewSecret("");
      setShowSecret(false);
      setSubmitting(false);
      onUpdated();
      onClose();
    } catch {
      setEnvelope(buildEnvelope("UNKNOWN", correlationId));
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Update password">
      <p className="text-sm text-text-secondary mb-4">
        Enter the new MT5 investor password. We re-validate it against your
        broker before saving — nothing changes if it doesn&apos;t work.
      </p>
      <div className="relative">
        <label
          htmlFor="mt5-new-secret"
          className="block text-caption font-medium text-text-secondary mb-1"
        >
          New password
        </label>
        <input
          id="mt5-new-secret"
          type={showSecret ? "text" : "password"}
          value={newSecret}
          onChange={(e) => setNewSecret(e.target.value)}
          autoComplete="off"
          className="min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 py-2.5 pr-16 text-body text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="button"
          onClick={() => setShowSecret((s) => !s)}
          aria-pressed={showSecret}
          aria-label={showSecret ? "Hide password" : "Show password"}
          className="absolute bottom-0 right-0 flex h-[44px] items-center px-3 text-micro font-mono uppercase tracking-[0.14em] text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
        >
          {showSecret ? "Hide" : "Show"}
        </button>
      </div>
      {envelope && (
        <div className="mt-4">
          <ErrorEnvelope envelope={envelope} />
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || newSecret.trim().length === 0}
        >
          {submitting ? "Updating..." : "Update password"}
        </Button>
      </div>
    </Modal>
  );
}
