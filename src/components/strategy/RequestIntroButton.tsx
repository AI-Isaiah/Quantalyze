"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function RequestIntroButton({ strategyId }: { strategyId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("Please sign in to request an intro.");
      setStatus("error");
      return;
    }

    const { error } = await supabase.from("contact_requests").insert({
      allocator_id: user.id,
      strategy_id: strategyId,
      message: message || null,
    });

    if (error) {
      if (error.code === "23505") {
        setError("You have already requested an intro for this strategy.");
      } else {
        setError(error.message);
      }
      setStatus("error");
      return;
    }

    setStatus("sent");
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={status === "sent"}
      >
        {status === "sent" ? "Intro Requested" : "Request Intro"}
      </Button>

      <Modal open={open && status !== "sent"} onClose={() => setOpen(false)} title="Request Introduction">
        <p className="text-sm text-text-secondary mb-4">
          The team will review your request and facilitate an introduction
          with the strategy manager.
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="What are you looking for? (optional)"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 mb-4"
        />
        {error && <p className="text-sm text-negative mb-4">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={status === "loading"}>
            {status === "loading" ? "Sending..." : "Send Request"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
