"use client";

// Uses native window.confirm/prompt for Sprint 6 pilot velocity. Sprint 7
// will promote these flows to a proper Modal component (DESIGN.md pattern
// TBD) when the admin surface gains broader adoption and deserves a
// consistent dialog shell. The native prompts are acceptable here because
// the only user of /admin/deletion-requests is the founder running a
// pilot-scale deletion queue.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Approve / Reject actions for a pending deletion-request row.
 *
 * Sprint 6 closeout Task 7.3. Calls POST
 * /api/admin/deletion-requests/[id]/approve|reject (both wrapped by
 * `withRole("admin")`). Emits audit events server-side per ADR-0023.
 *
 * UI pattern: two buttons inline with the row. Approve triggers a
 * confirmation dialog because the action is irreversible
 * (sanitize_user anonymizes the user's PII — we don't un-anonymize).
 * Reject opens a lightweight reason prompt via `window.prompt` so
 * the admin can record a rationale without a modal component.
 */

interface DeletionRequestActionsProps {
  requestId: string;
}

export function DeletionRequestActions({
  requestId,
}: DeletionRequestActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setError(null);
    const ok = window.confirm(
      "Approve this deletion request? This will anonymize the user's PII " +
        "immediately. This action is irreversible.",
    );
    if (!ok) return;

    setPending("approve");
    try {
      const res = await fetch(
        `/api/admin/deletion-requests/${encodeURIComponent(requestId)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Approval failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(null);
    }
  }

  async function handleReject() {
    setError(null);
    const reason = window.prompt(
      "Reason for rejecting this deletion request (optional — up to 1000 chars):",
      "",
    );
    if (reason === null) return; // cancelled

    setPending("reject");
    try {
      const res = await fetch(
        `/api/admin/deletion-requests/${encodeURIComponent(requestId)}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Rejection failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && (
        <p className="text-[11px] text-negative" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={handleReject}
        >
          {pending === "reject" ? "…" : "Reject"}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={pending !== null}
          onClick={handleApprove}
        >
          {pending === "approve" ? "…" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
