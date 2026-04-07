"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

interface AddFounderNoteProps {
  portfolioId: string;
  strategyId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddFounderNote({
  portfolioId,
  strategyId,
  isOpen,
  onClose,
  onSaved,
}: AddFounderNoteProps) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("portfolio_strategies")
      .select("founder_notes")
      .eq("portfolio_id", portfolioId)
      .eq("strategy_id", strategyId)
      .single();

    if (fetchError) {
      setError("Failed to load existing notes.");
      setStatus("error");
      return;
    }

    const existing = (data?.founder_notes as { date: string; author: string; text: string }[]) ?? [];
    const newNote = { date: new Date().toISOString(), author: "You", text: text.trim() };

    const { error: updateError } = await supabase
      .from("portfolio_strategies")
      .update({ founder_notes: [...existing, newNote] })
      .eq("portfolio_id", portfolioId)
      .eq("strategy_id", strategyId);

    if (updateError) {
      setError("Failed to save note.");
      setStatus("error");
      return;
    }

    setText("");
    setStatus("idle");
    onSaved();
    onClose();
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="Add Founder Note">
      <form onSubmit={handleSubmit}>
        <Textarea
          label="Note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Strategy observations, founder call notes..."
          rows={4}
          required
        />
        {error && <p className="text-sm text-negative mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={status === "loading" || !text.trim()}>
            {status === "loading" ? "Saving..." : "Save Note"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
