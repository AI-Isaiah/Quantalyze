"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { cn, SUPPORTED_EXCHANGES } from "@/lib/utils";

type RequestStatus = "pending" | "intro_made" | "completed" | "declined";

const STATUS_MESSAGES: Record<RequestStatus, string> = {
  pending: "Pending review",
  intro_made: "Introduction in progress",
  completed: "Introduction completed",
  declined: "Request declined",
};

const ASSET_CLASS_OPTIONS = ["Spot", "Perp", "Mixed"] as const;
const EXCHANGE_OPTIONS = SUPPORTED_EXCHANGES.map((e) =>
  e === "okx" ? "OKX" : e[0].toUpperCase() + e.slice(1),
);
const AUM_RANGE_OPTIONS = ["<$500k", "$500k-$2M", "$2M-$10M", ">$10M"] as const;

type AssetClass = (typeof ASSET_CLASS_OPTIONS)[number] | "";
type AumRange = (typeof AUM_RANGE_OPTIONS)[number] | "";

export function RequestIntroButton({ strategyId }: { strategyId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [mandateOpen, setMandateOpen] = useState(false);
  const [mandateFreeform, setMandateFreeform] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("");
  const [preferredExchanges, setPreferredExchanges] = useState<string[]>([]);
  const [aumRange, setAumRange] = useState<AumRange>("");
  const [uiState, setUiState] = useState<"idle" | "loading" | "sent" | "checking" | "error">("checking");
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkExisting() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUiState("idle"); return; }

      const { data } = await supabase
        .from("contact_requests")
        .select("id, status")
        .eq("allocator_id", user.id)
        .eq("strategy_id", strategyId)
        .maybeSingle();

      if (data) {
        setUiState("sent");
        setRequestStatus(data.status as RequestStatus);
      } else {
        setUiState("idle");
      }
    }
    checkExisting();
  }, [strategyId]);

  function toggleExchange(exchange: string) {
    setPreferredExchanges((prev) =>
      prev.includes(exchange)
        ? prev.filter((e) => e !== exchange)
        : [...prev, exchange],
    );
  }

  function buildMandateContext(): Record<string, unknown> | null {
    const ctx: Record<string, unknown> = {};
    if (mandateFreeform.trim()) ctx.freeform = mandateFreeform.trim();
    if (assetClass) ctx.preferred_asset_class = assetClass;
    if (preferredExchanges.length > 0) ctx.preferred_exchange = preferredExchanges;
    if (aumRange) ctx.aum_range = aumRange;
    return Object.keys(ctx).length > 0 ? ctx : null;
  }

  async function handleSubmit() {
    setUiState("loading");
    setError(null);

    try {
      const mandate_context = buildMandateContext();
      const body: Record<string, unknown> = {
        strategy_id: strategyId,
        message: message || null,
      };
      if (mandate_context) body.mandate_context = mandate_context;

      const res = await fetch("/api/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        setUiState("sent");
        setRequestStatus("pending");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to send request. Please try again.");
        setUiState("error");
        return;
      }

      setUiState("sent");
      setRequestStatus("pending");
    } catch {
      setError("Failed to send request. Please try again.");
      setUiState("error");
    }
  }

  // When a request exists, show status inline instead of just "Intro Requested"
  if (uiState === "sent" && requestStatus) {
    return (
      <div className="flex items-center gap-2">
        <Badge label={requestStatus} type="status" />
        <span className="text-xs text-text-muted">
          {STATUS_MESSAGES[requestStatus]}
        </span>
      </div>
    );
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={uiState === "checking"}
      >
        {uiState === "checking" ? "..." : "Request Intro"}
      </Button>

      <Modal open={open && uiState !== "sent"} onClose={() => setOpen(false)} title="Request Introduction">
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

        {/* Collapsible mandate context section */}
        <div className="mb-4 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setMandateOpen((v) => !v)}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            aria-expanded={mandateOpen}
          >
            <span
              className={cn(
                "inline-block text-xs transition-transform",
                mandateOpen ? "rotate-90" : "rotate-0",
              )}
            >
              ▶
            </span>
            Add mandate context (optional)
          </button>

          {mandateOpen && (
            <div className="mt-3 space-y-3">
              <Textarea
                value={mandateFreeform}
                onChange={(e) => setMandateFreeform(e.target.value)}
                rows={2}
                placeholder="Mandate details: horizon, constraints, style preferences..."
                maxLength={2000}
              />

              <div>
                <label
                  htmlFor="mandate-asset-class"
                  className="block text-xs font-medium text-text-primary mb-1"
                >
                  Preferred asset class
                </label>
                <select
                  id="mandate-asset-class"
                  value={assetClass}
                  onChange={(e) => setAssetClass(e.target.value as AssetClass)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">— No preference —</option>
                  {ASSET_CLASS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block text-xs font-medium text-text-primary mb-1">
                  Preferred exchanges
                </span>
                <div className="flex flex-wrap gap-2">
                  {EXCHANGE_OPTIONS.map((ex) => {
                    const selected = preferredExchanges.includes(ex);
                    return (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => toggleExchange(ex)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors",
                          selected
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border bg-surface text-text-secondary hover:text-text-primary",
                        )}
                        aria-pressed={selected}
                      >
                        {ex}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="mandate-aum-range"
                  className="block text-xs font-medium text-text-primary mb-1"
                >
                  AUM range
                </label>
                <select
                  id="mandate-aum-range"
                  value={aumRange}
                  onChange={(e) => setAumRange(e.target.value as AumRange)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">— No preference —</option>
                  {AUM_RANGE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-negative mb-4">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={uiState === "loading"}>
            {uiState === "loading" ? "Sending..." : "Send Request"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
