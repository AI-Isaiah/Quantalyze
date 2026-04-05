"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { ROLES, type Role } from "@/lib/types";

export function OnboardingWizard() {
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<Role>("manager");
  const [company, setCompany] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleComplete() {
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const { error, data: updated } = await supabase
      .from("profiles")
      .update({
        role,
        company: company || null,
        telegram: telegram || null,
        website: website || null,
      })
      .eq("id", user.id)
      .select();

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!updated || updated.length === 0) {
      setError("Profile not found. Please try signing out and back in.");
      setLoading(false);
      return;
    }

    const destination =
      role === "allocator"
        ? "/discovery/crypto-sma"
        : "/strategies";
    router.push(destination);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {step === 1 && (
        <>
          <div className="space-y-3">
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                className={cn(
                  "w-full rounded-lg border p-4 text-left transition-colors",
                  role === r.value
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/50"
                )}
              >
                <p className="text-sm font-medium text-text-primary">
                  {r.label}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {r.description}
                </p>
              </button>
            ))}
          </div>
          <Button onClick={() => setStep(2)} className="w-full">
            Continue
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <Input
            label="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Your company name (optional)"
          />
          <Input
            label="Telegram"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username (optional)"
          />
          <Input
            label="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://... (optional)"
          />
          {error && (
            <p className="text-sm text-negative">{error}</p>
          )}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setStep(1)}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              onClick={handleComplete}
              disabled={loading}
              className="flex-1"
            >
              {loading ? "Saving..." : "Get started"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
