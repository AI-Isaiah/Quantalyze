"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  // Red-team 2026-05-17 (red-team:double-click-race, HIGH conf 8): the
  // `loading` state alone can't gate a double-fire because setState is
  // async — two clicks within the same render tick both see loading=null
  // and both fire fetch(). The useRef flag flips synchronously inside the
  // click handler, blocking the second fire before React schedules the
  // re-render. The server-side `.eq('status','pending')` guard is the
  // backstop for cross-tab races; this ref is the client-tab close.
  const inFlightRef = useRef<Set<string>>(new Set());

  if (requests.length === 0) return null;

  // Audit-2026-05-07 C-0135 + C-0136: route manager responses through
  // /api/intro-response so (a) notifyAllocatorIntroStatus fires on every
  // transition (no more silent notification drop) and (b) the writeable
  // column set is whitelisted server-side (no more direct manager UPDATE
  // on admin_note / founder_notes / allocation_amount via Supabase
  // browser client). The previous .select('id') / updated.length===0
  // RLS-zero detection is no longer needed because the server route
  // returns a proper 4xx on the manager-not-owner path.
  async function handleRespond(id: string, action: "accept" | "decline") {
    // Red-team 2026-05-17: synchronous in-flight gate. A double-click
    // within ~16ms (one frame) — or rapid Enter Enter on a focused
    // button — would otherwise pass through React's async setState
    // before the disabled bit flips. The ref check + add happens
    // synchronously inside this event handler, so the second click's
    // entry into handleRespond bails before fetch().
    if (inFlightRef.current.has(id)) return;
    inFlightRef.current.add(id);

    setLoading(id);
    setError(null);
    setConfirmMessage(null);

    let res: Response;
    try {
      res = await fetch("/api/intro-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
    } catch {
      // Red-team 2026-05-17 (red-team:loading-flag-released-too-early):
      // release the in-flight guard + loading state ONLY at the end of
      // a branch that has finished rendering its error/success copy.
      // The network-error branch is terminal — clear here.
      inFlightRef.current.delete(id);
      setLoading(null);
      setError("Failed to update request. Please try again.");
      return;
    }

    if (!res.ok) {
      // Red-team 2026-05-17 (red-team:loading-flag-released-too-early,
      // MED conf 8): set the error copy BEFORE releasing the loading
      // flag. The previous order called setLoading(null) before the
      // error-banner setState, leaving a 100-200ms gap where the button
      // was re-enabled with no error text rendered — a frustrated user
      // could double-click into a still-pending error render and fire
      // another fetch. Setting error first means the next render flushes
      // the banner in the same paint as the button re-enable.
      // The 409 branch is mapped to the same permission-style copy
      // ("refresh and try again") because the server uses 409 to signal
      // "request resolved elsewhere — refresh".
      if (res.status === 401 || res.status === 403 || res.status === 409) {
        setError(
          "Your account may not have permission to respond to this request. Refresh and try again, or contact the team if the problem persists.",
        );
      } else {
        setError("Failed to update request. Please try again.");
      }
      inFlightRef.current.delete(id);
      setLoading(null);
      return;
    }

    if (action === "accept") {
      setConfirmMessage("Our team will connect you within 48h.");
    }

    inFlightRef.current.delete(id);
    setLoading(null);
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
