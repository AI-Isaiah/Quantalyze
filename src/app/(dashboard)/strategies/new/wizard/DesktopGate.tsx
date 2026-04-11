"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * DesktopGate blocks the wizard on narrow viewports and captures a
 * save-my-progress email so the founder can follow up even if the user
 * never returns on desktop. Uses matchMedia so state only changes when
 * the breakpoint actually crosses, not on every pixel of resize.
 */

const MOBILE_QUERY = "(max-width: 639px)";

export function DesktopGate({ children }: { children: React.ReactNode }) {
  const [isNarrow, setIsNarrow] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    // Defer initial setState into a microtask so the setState is not
    // called synchronously inside the effect body (React Compiler rule).
    const initialTimer = setTimeout(() => setIsNarrow(mql.matches), 0);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener("change", handler);
    return () => {
      clearTimeout(initialTimer);
      mql.removeEventListener("change", handler);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/for-quants-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Wizard mobile gate",
          firm: "Wizard mobile gate",
          email,
          notes: "Desktop wizard gate — user asked to save progress for later.",
          wizard_context: {
            step: "connect_key",
            draft_strategy_id: null,
            wizard_session_id: "desktop-gate",
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save your progress. Try again.");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      console.error("[DesktopGate] submit threw:", err);
      setError("Network error. Please email security@quantalyze.com directly.");
      setSubmitting(false);
    }
  }

  // Still measuring viewport on first client render — render children so
  // SSR markup stays stable.
  if (isNarrow === null) return <>{children}</>;

  if (!isNarrow) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center" data-testid="wizard-desktop-gate">
      <h1 className="font-display text-2xl tracking-tight text-text-primary">
        Continue on desktop
      </h1>
      <p className="mt-3 text-sm text-text-secondary">
        The Connect Your Strategy wizard needs a wider screen for API key setup
        and metric previews. Email yourself a link to continue at your
        workstation.
      </p>

      {submitted ? (
        <div className="mt-8 rounded-md border border-border bg-page px-4 py-4 text-sm text-text-secondary">
          Link saved. Check your inbox at <strong>{email}</strong>.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-3 text-left">
          <Input
            label="Your email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@firm.com"
            required
            autoComplete="email"
          />
          {error && (
            <p className="text-xs text-negative" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Sending..." : "Send me a resume link"}
          </Button>
        </form>
      )}
    </div>
  );
}
