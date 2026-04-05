"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface StrategyActionsProps {
  strategyId: string;
  status: string;
}

export function StrategyActions({ strategyId, status }: StrategyActionsProps) {
  const [loading, setLoading] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const router = useRouter();

  async function updateStatus(newStatus: string) {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("strategies")
      .update({ status: newStatus, review_note: null })
      .eq("id", strategyId);
    setLoading(false);
    setConfirmArchive(false);
    if (!error) router.refresh();
  }

  if (status === "draft") {
    return (
      <Button
        size="sm"
        onClick={() => updateStatus("pending_review")}
        disabled={loading}
      >
        {loading ? "Submitting..." : "Submit for Review"}
      </Button>
    );
  }

  if (status === "pending_review") {
    return (
      <span className="text-xs text-badge-market-neutral font-medium">
        Awaiting Review
      </span>
    );
  }

  if (status === "published") {
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmArchive(true)}
          disabled={loading}
        >
          Archive
        </Button>
        <Modal
          open={confirmArchive}
          onClose={() => setConfirmArchive(false)}
          title="Archive Strategy"
        >
          <p className="text-sm text-text-secondary mb-4">
            This will remove the strategy from discovery. You can restore it later.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => updateStatus("archived")} disabled={loading}>
              {loading ? "Archiving..." : "Archive"}
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  if (status === "archived") {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => updateStatus("draft")}
        disabled={loading}
      >
        Restore to Draft
      </Button>
    );
  }

  return null;
}
