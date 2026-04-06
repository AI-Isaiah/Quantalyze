"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";

type RequestStatus = "pending" | "intro_made" | "completed" | "declined";

const STATUS_MESSAGES: Record<RequestStatus, string> = {
  pending: "Pending review",
  intro_made: "Introduction in progress",
  completed: "Introduction completed",
  declined: "Request declined",
};

export function RequestIntroButton({ strategyId }: { strategyId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [uiState, setUiState] = useState<"idle" | "loading" | "sent" | "checking" | "error">("checking");
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkExisting() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUiState("idle"); return; }

      const { data } = await supabase
        .from("contact_requests")
        .select("id, status")
        .eq("allocator_id", user.id)
        .eq("strategy_id", strategyId)
        .maybeSingle();

      if (data) {
        setUiState("sent");
        setRequestStatus(data.status as RequestStatus);
      } else {
        setUiState("idle");
      }
    }
    checkExisting();
  }, [strategyId]);

  async function handleSubmit() {
    setUiState("loading");
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("Please sign in to request an intro.");
      setUiState("error");
      return;
    }

    const { error } = await supabase.from("contact_requests").insert({
      allocator_id: user.id,
      strategy_id: strategyId,
      message: message || null,
    });

    if (error) {
      if (error.code === "23505") {
        setUiState("sent");
        setRequestStatus("pending");
        return;
      }
      setError("Failed to send request. Please try again.");
      setUiState("error");
      return;
    }

    setUiState("sent");
    setRequestStatus("pending");
  }

  // When a request exists, show status inline instead of just "Intro Requested"
  if (uiState === "sent" && requestStatus) {
    return (
      <div className="flex items-center gap-2">
        <Badge label={requestStatus} type="status" />
        <span className="text-xs text-text-muted">
          {STATUS_MESSAGES[requestStatus]}
        </span>
      </div>
    );
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={uiState === "checking"}
      >
        {uiState === "checking" ? "..." : "Request Intro"}
      </Button>

      <Modal open={open && uiState !== "sent"} onClose={() => setOpen(false)} title="Request Introduction">
        <p className="text-sm text-text-secondary mb-4">
          The team will review your request and facilitate an introduction
          with the strategy manager.
        </p>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="What are you looking for? (optional)"
          className="mb-4"
        />
        {error && <p className="text-sm text-negative mb-4">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={uiState === "loading"}>
            {uiState === "loading" ? "Sending..." : "Send Request"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
