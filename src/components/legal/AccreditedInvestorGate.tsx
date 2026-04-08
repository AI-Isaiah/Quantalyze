"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * The accredited-investor self-attestation gate. Rendered by the discovery
 * layout when the current user has no row in `investor_attestations`. Form
 * POSTs to /api/attestation; on success, the layout re-runs its server-side
 * check and renders the actual discovery content.
 *
 * Legal content is templated (Termly/iubenda baseline) and reviewed by a
 * fintech lawyer in Sprint 7 per the plan's P-3 gate.
 */
export function AccreditedInvestorGate() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/attestation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      if (!res.ok) {
        const msg = await res.text();
        setError(msg || "Unable to record attestation. Please try again.");
        setSubmitting(false);
        return;
      }
      // Soft-reload so the layout re-reads investor_attestations and
      // renders the real discovery children.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-12">
      <Card className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary">
          Accredited Investor Acknowledgment
        </h1>
        <p className="mt-3 text-sm text-text-secondary leading-relaxed">
          The strategies listed on this platform are made available to accredited
          or qualified investors only. Before viewing, please confirm the
          following:
        </p>

        <ul className="mt-4 space-y-2 text-sm text-text-secondary list-disc pl-5">
          <li>
            I qualify as an accredited investor (or the equivalent in my
            jurisdiction) per applicable securities regulations.
          </li>
          <li>
            I understand that past performance does not guarantee future results
            and that cryptocurrency trading involves substantial risk of loss.
          </li>
          <li>
            I understand that strategies shown are monitored via read-only
            exchange APIs. Managers retain custody of their assets. The platform
            provides analytics only — no pooling, no fund administration.
          </li>
          <li>
            I understand that introduction requests are routed through the
            platform team and that managers may decline an introduction.
          </li>
        </ul>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="flex items-start gap-3 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
            />
            <span>
              I confirm the statements above and acknowledge that I am an
              accredited or qualified investor.
            </span>
          </label>

          {error && (
            <p className="text-sm text-negative" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <a
              href="/legal/disclaimer"
              className="text-xs text-text-muted underline hover:text-text-secondary"
            >
              Read the full disclaimer
            </a>
            <Button type="submit" disabled={!accepted || submitting}>
              {submitting ? "Recording..." : "Continue to discovery"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
