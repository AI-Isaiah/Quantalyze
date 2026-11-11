"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { cn, UI_EXCHANGE_CODES } from "@/lib/utils";
import { captureToSentry } from "@/lib/sentry-capture";
import { AccreditedInvestorGate } from "@/components/legal/AccreditedInvestorGate";
import {
  INTRO_ATTESTATION_CHECK_FAILED,
  INTRO_ATTESTATION_REQUIRED,
} from "@/lib/intro/refusal-codes";

type RequestStatus = "pending" | "intro_made" | "completed" | "declined";

const STATUS_MESSAGES: Record<RequestStatus, string> = {
  pending: "Pending review",
  intro_made: "Introduction in progress",
  completed: "Introduction completed",
  declined: "Request declined",
};

const SEND_FAILED_MESSAGE =
  "Your request was not sent. Check your connection and try again.";
const ATTESTATION_CHECK_FAILED_MESSAGE =
  "We could not check your attestation. Try again in a minute.";

const ASSET_CLASS_OPTIONS = ["Spot", "Perp", "Mixed"] as const;
// UI_EXCHANGE_CODES (not SUPPORTED_EXCHANGES): this is a user-facing chip
// group showing the exchanges we OFFER. As of Phase 69 that set includes
// Deribit (the wizard card + /security#deribit-readonly guide shipped); it
// stays decoupled from SUPPORTED_EXCHANGES so funding-only/boundary surfaces
// don't auto-widen — OQ4 gate.
const EXCHANGE_OPTIONS = UI_EXCHANGE_CODES.map((e) =>
  e === "okx" ? "OKX" : e[0].toUpperCase() + e.slice(1),
);
const AUM_RANGE_OPTIONS = ["<$500k", "$500k-$2M", "$2M-$10M", ">$10M"] as const;

type AssetClass = (typeof ASSET_CLASS_OPTIONS)[number] | "";
type AumRange = (typeof AUM_RANGE_OPTIONS)[number] | "";

/**
 * `needsAttestation` (194.2 D-04) comes from `resolveFactsheetViewer`: an approved allocator with
 * no recorded accredited-investor attestation. The attest step is a step INSIDE the request: the
 * button keeps its label, and the one `Modal` swaps its body between the request form and the
 * attest step, so only one dialog is ever open and the typed message and mandate fields (all kept
 * in this component's state) survive the swap. The component must stay in one stable tree position
 * across `needsAttestation` flipping after `router.refresh()`, or this state would be lost.
 */
export function RequestIntroButton({
  strategyId,
  needsAttestation = false,
}: {
  strategyId: string;
  needsAttestation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Which body the Modal shows. `attestResubmit` is true on the reactive path (the route refused a
  // send), where confirming must also re-send; the proactive path only opens the request form.
  const [view, setView] = useState<"form" | "attest">("form");
  const [attestResubmit, setAttestResubmit] = useState(false);
  // The prop only flips once the server re-renders; this keeps the step from reappearing before then.
  const [attestedHere, setAttestedHere] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const focusMessageOnForm = useRef(false);
  const [message, setMessage] = useState("");
  const [mandateOpen, setMandateOpen] = useState(false);
  const [mandateFreeform, setMandateFreeform] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("");
  const [preferredExchanges, setPreferredExchanges] = useState<string[]>([]);
  const [aumRange, setAumRange] = useState<AumRange>("");
  const [uiState, setUiState] = useState<"idle" | "loading" | "sent" | "checking" | "error">("checking");
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // React state cannot stop a second click delivered before the re-render
  // that disables the button; this ref can. The server's 409 on a unique
  // violation remains the cross-tab backstop.
  const inFlight = useRef(false);

  useEffect(() => {
    async function checkExisting() {
      // A failed read must not leave the button disabled for good: fall back to idle
      // (the server's 409 on a unique violation is the backstop for a duplicate).
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setUiState("idle"); return; }

        const { data, error: readError } = await supabase
          .from("contact_requests")
          .select("id, status")
          .eq("allocator_id", user.id)
          .eq("strategy_id", strategyId)
          .maybeSingle();
        if (readError) throw new Error(`contact_requests read failed: ${readError.message}`);

        if (data) {
          setUiState("sent");
          setRequestStatus(data.status as RequestStatus);
        } else {
          setUiState("idle");
        }
      } catch (err) {
        captureToSentry(err, { tags: { area: "request-intro-existing-check" }, level: "warning" });
        setUiState("idle");
      }
    }
    checkExisting();
  }, [strategyId]);

  // After the proactive attest the request form opens in the attest step's place; put the cursor
  // where the user types.
  useEffect(() => {
    if (view === "form" && focusMessageOnForm.current) {
      focusMessageOnForm.current = false;
      messageRef.current?.focus();
    }
  }, [view]);

  function openFromButton() {
    if (needsAttestation && !attestedHere) {
      setAttestResubmit(false);
      setView("attest");
    } else {
      setView("form");
    }
    setOpen(true);
  }

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
    if (inFlight.current) return;
    inFlight.current = true;
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
        if (res.status === 403 && data.code === INTRO_ATTESTATION_REQUIRED) {
          // Reactive branch (a stale page): not a failure. Swap the open modal to the attest step.
          setUiState("idle");
          setAttestedHere(false);
          setAttestResubmit(true);
          setView("attest");
          return;
        }
        if (data.code === INTRO_ATTESTATION_CHECK_FAILED) {
          setError(ATTESTATION_CHECK_FAILED_MESSAGE);
          setUiState("error");
          return;
        }
        setError(data.error ?? SEND_FAILED_MESSAGE);
        setUiState("error");
        return;
      }

      setUiState("sent");
      setRequestStatus("pending");
    } catch {
      setError(SEND_FAILED_MESSAGE);
      setUiState("error");
    } finally {
      inFlight.current = false;
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
        onClick={openFromButton}
        disabled={uiState === "checking"}
        aria-busy={uiState === "checking"}
      >
        Request intro
      </Button>

      <Modal
        open={open && uiState !== "sent"}
        onClose={() => setOpen(false)}
        title={view === "attest" ? "Attest to request introductions" : "Request an introduction"}
      >
        {view === "attest" ? (
          <AccreditedInvestorGate
            variant="modal"
            confirmLabel="Confirm and request intro"
            onDismiss={() => {
              // Reactive: back to the form, fields intact, nothing sent, no error line.
              // Proactive: nothing was typed or sent, so the dialog simply closes.
              if (attestResubmit) {
                setAttestResubmit(false);
                setView("form");
              } else {
                setOpen(false);
              }
            }}
            onAttested={() => {
              setAttestedHere(true);
              setView("form");
              if (attestResubmit) {
                setAttestResubmit(false);
                void handleSubmit();
              } else {
                focusMessageOnForm.current = true;
              }
            }}
          />
        ) : (
          <>
            <p className="text-sm text-text-secondary mb-4">
              The team will review your request and facilitate an introduction
              with the strategy manager.
            </p>
            <Textarea
              ref={messageRef}
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
                    placeholder="Mandate details: horizon, constraints, preferred styles..."
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
                Close without sending
              </Button>
              <Button onClick={handleSubmit} disabled={uiState === "loading"}>
                {uiState === "loading" ? "Sending…" : "Send request"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
