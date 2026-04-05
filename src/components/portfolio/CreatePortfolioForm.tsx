"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "next/navigation";

export function CreatePortfolioForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("Please sign in to create a portfolio.");
      setStatus("error");
      return;
    }

    const { error: insertError } = await supabase.from("portfolios").insert({
      user_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
    });

    if (insertError) {
      setError("Failed to create portfolio. Please try again.");
      setStatus("error");
      return;
    }

    setName("");
    setDescription("");
    setStatus("idle");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create Portfolio</Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Create Portfolio">
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Momentum Portfolio"
              required
            />
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this portfolio for? (optional)"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-negative mt-3">{error}</p>}
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={status === "loading" || !name.trim()}>
              {status === "loading" ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
