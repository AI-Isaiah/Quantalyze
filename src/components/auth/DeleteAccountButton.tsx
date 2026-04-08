"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * GDPR Art. 17 account-deletion request. Writes a row to
 * `data_deletion_requests` and emails the founder. Deletion itself is handled
 * manually within 30 days — this is an intake surface, not an automated
 * destructive action. See /legal/privacy for the documented SLA.
 */
export function DeleteAccountButton() {
  const [state, setState] = useState<"idle" | "confirming" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/account/deletion-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const msg = await res.text();
        setError(msg || "Unable to record deletion request.");
        setState("confirming");
        return;
      }
      setState("sent");
    } catch {
      setError("Network error. Please try again.");
      setState("confirming");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-md border border-border bg-page px-4 py-3 text-sm text-text-secondary">
        Deletion request received. We&apos;ll confirm by email within 72 hours
        and complete the deletion within 30 days per our privacy policy.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          Delete my account
        </h3>
        <p className="mt-1 text-xs text-text-secondary">
          Requests the deletion of your account and all personal data per GDPR
          Article 17. Deletion is completed manually within 30 days. Read the{" "}
          <a
            href="/legal/privacy"
            className="underline hover:text-text-primary"
          >
            privacy policy
          </a>
          .
        </p>
      </div>

      {state === "idle" && (
        <Button variant="danger" onClick={() => setState("confirming")}>
          Request account deletion
        </Button>
      )}

      {(state === "confirming" || state === "submitting") && (
        <div className="rounded-md border border-negative/30 bg-negative/5 p-4">
          <p className="text-sm text-text-primary font-medium">
            This cannot be undone once completed.
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Your profile, strategies, portfolios, and historical match data
            will be removed. Confirm to submit the request.
          </p>
          {error && (
            <p className="mt-2 text-xs text-negative" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="danger"
              onClick={submit}
              disabled={state === "submitting"}
            >
              {state === "submitting" ? "Submitting..." : "Confirm deletion request"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setState("idle");
                setError(null);
              }}
              disabled={state === "submitting"}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
