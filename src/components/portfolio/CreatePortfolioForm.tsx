"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "next/navigation";

/**
 * /portfolios — generic "Build collections of strategies for comparison."
 *
 * Post-v0.4.0 pivot, the allocator's REAL book is created via the
 * /allocations flow (exchange-linked api_keys → portfolio_strategies),
 * NOT through this form. The /portfolios page docblock is explicit:
 * "Allocators no longer use this page directly… their real book lives
 * on /allocations, their what-if exploration lives on /scenarios."
 *
 * Migration 023 added a partial UNIQUE index `(user_id) WHERE
 * is_test=false`, so a user with one real portfolio cannot create a
 * second real one. This form's purpose is now scenario / comparison /
 * test-portfolio creation, so we explicitly insert with `is_test=true`
 * to (a) match v0.4.0 product semantics and (b) avoid the partial
 * UNIQUE collision that broke every 2nd Create attempt prior to this
 * fix (FIX-LIST P163, atomic ID G8.F.1).
 *
 * If a future surface needs to create the user's *real* portfolio,
 * that surface MUST set `is_test=false` explicitly and handle the
 * 23505 unique-violation path (i.e., "you already have a real
 * portfolio") with a deliberate UX, not a generic toast.
 */
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
      // Test/scenario portfolio. See file-level docblock for why this is
      // NOT a real-book write path post-v0.4.0.
      is_test: true,
    });

    if (insertError) {
      // Migration 023's partial UNIQUE index applies only to is_test=false
      // rows. With is_test=true above, we should never see 23505 here, but
      // keep a friendlier message for anyone reverting / extending this
      // form: surface the unique-violation path explicitly so the next
      // author isn't debugging a generic "Failed to create" toast.
      if (
        typeof insertError.code === "string" &&
        insertError.code === "23505"
      ) {
        setError(
          "You already have a portfolio with this configuration. Please rename it or update the existing one.",
        );
      } else {
        setError("Failed to create portfolio. Please try again.");
      }
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
            <p className="text-xs text-text-muted">
              Saved as a test/scenario portfolio for comparison. Your real
              allocations live on the My Allocation page.
            </p>
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
