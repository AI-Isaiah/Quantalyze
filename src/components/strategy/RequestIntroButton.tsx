"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";

export function RequestIntroButton({ strategyId }: { strategyId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "checking" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkExisting() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setStatus("idle"); return; }

      const { data } = await supabase
        .from("contact_requests")
        .select("id")
        .eq("allocator_id", user.id)
        .eq("strategy_id", strategyId)
        .maybeSingle();

      setStatus(data ? "sent" : "idle");
    }
    checkExisting();
  }, [strategyId]);

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
        setStatus("sent");
        return;
      }
      setError("Failed to send request. Please try again.");
      setStatus("error");
      return;
    }

    setStatus("sent");
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={status === "sent" || status === "checking"}
      >
        {status === "checking" ? "..." : status === "sent" ? "Intro Requested" : "Request Intro"}
      </Button>

      <Modal open={open && status !== "sent"} onClose={() => setOpen(false)} title="Request Introduction">
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
          <Button onClick={handleSubmit} disabled={status === "loading"}>
            {status === "loading" ? "Sending..." : "Send Request"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
