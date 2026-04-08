"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface RemoveStrategyButtonProps {
  portfolioId: string;
  portfolioName: string;
  strategyId: string;
  strategyName: string;
}

export function RemoveStrategyButton({
  portfolioId,
  portfolioName,
  strategyId,
  strategyName,
}: RemoveStrategyButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("portfolio_strategies")
      .delete()
      .eq("portfolio_id", portfolioId)
      .eq("strategy_id", strategyId);

    if (deleteError) {
      setError("Failed to remove strategy. Please try again.");
      setStatus("error");
      return;
    }

    setStatus("idle");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-text-muted hover:text-negative transition-colors"
      >
        Remove
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Remove Strategy">
        <p className="text-sm text-text-secondary">
          Remove <span className="font-medium text-text-primary">{strategyName}</span> from{" "}
          <span className="font-medium text-text-primary">{portfolioName}</span>? This does
          not delete the strategy or any allocation history.
        </p>
        {error && <p className="text-sm text-negative mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleConfirm}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Removing..." : "Remove"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
