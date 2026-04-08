"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { displayStrategyName, type DisplayableStrategy } from "@/lib/strategy-display";

interface IntroRequest {
  id: string;
  status: string;
  message: string | null;
  created_at: string;
  strategy_id: string;
  founder_notes: string | null;
  profiles: { display_name: string; company: string | null } | null;
  strategies: DisplayableStrategy | null;
}

export function PendingIntros({ requests }: { requests: IntroRequest[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function handleRespond(id: string, action: "accept" | "decline") {
    setLoading(id);
    setError(null);
    setConfirmMessage(null);

    const supabase = createClient();
    const newStatus = action === "accept" ? "intro_made" : "declined";

    const { error: updateError } = await supabase
      .from("contact_requests")
      .update({
        status: newStatus,
        responded_at: new Date().toISOString(),
      })
      .eq("id", id);

    setLoading(null);

    if (updateError) {
      setError("Failed to update request. Please try again.");
      return;
    }

    if (action === "accept") {
      setConfirmMessage("Our team will connect you within 48h.");
    }

    router.refresh();
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Intro Requests
        </h2>
        {pendingCount > 0 && (
          <span className="bg-accent text-white text-[10px] rounded-full px-1.5 py-0.5">
            {pendingCount} pending
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-negative mb-3">{error}</p>
      )}
      {confirmMessage && (
        <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="text-sm text-accent font-medium">{confirmMessage}</p>
        </div>
      )}

      <div className="space-y-3">
        {requests.map((r) => (
          <Card key={r.id} padding="sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">
                    {r.profiles?.display_name ?? "Unknown allocator"}
                  </p>
                  {r.profiles?.company && (
                    <span className="text-xs text-text-muted">
                      ({r.profiles.company})
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  Interested in{" "}
                  <span className="font-medium text-text-secondary">
                    {displayStrategyName(r.strategies)}
                  </span>
                </p>
                {r.message && (
                  <p className="text-xs text-text-secondary mt-2 bg-page rounded p-2">
                    {r.message}
                  </p>
                )}
                {r.founder_notes && (
                  <p className="text-xs text-accent mt-1 bg-accent/5 rounded px-2 py-1 border border-accent/10">
                    Founder note: {r.founder_notes}
                  </p>
                )}
                <p className="text-[10px] text-text-muted mt-1">
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge label={r.status} type="status" />
                {r.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleRespond(r.id, "accept")}
                      disabled={loading === r.id}
                    >
                      {loading === r.id ? "..." : "Accept"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRespond(r.id, "decline")}
                      disabled={loading === r.id}
                    >
                      Decline
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
