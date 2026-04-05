"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface StrategyActionsProps {
  strategyId: string;
  status: string;
  hasApiKey?: boolean;
}

export function StrategyActions({ strategyId, status, hasApiKey }: StrategyActionsProps) {
  const [loading, setLoading] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showDataGate, setShowDataGate] = useState(false);
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

  function handleSubmitForReview() {
    if (!hasApiKey) {
      setShowDataGate(true);
      return;
    }
    updateStatus("pending_review");
  }

  if (status === "draft") {
    return (
      <>
        <Button
          size="sm"
          onClick={handleSubmitForReview}
          disabled={loading}
        >
          {loading ? "Submitting..." : "Submit for Review"}
        </Button>

        <Modal
          open={showDataGate}
          onClose={() => setShowDataGate(false)}
          title="Connect Your Data"
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Before submitting your strategy for review, you need to provide performance data.
            </p>
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
              <p className="text-sm font-medium text-text-primary mb-1">
                Teams with verified API data get 3x more allocator interviews
              </p>
              <p className="text-xs text-text-muted">
                Connecting a read-only exchange API key proves your track record is real.
                Allocators trust verified data significantly more than self-reported PnL.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  setShowDataGate(false);
                  router.push(`/strategies/${strategyId}/edit`);
                }}
              >
                Connect API Key (recommended)
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDataGate(false);
                  router.push(`/strategies/${strategyId}/edit`);
                }}
              >
                Upload CSV instead
              </Button>
              <button
                onClick={() => setShowDataGate(false)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors pt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </>
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
