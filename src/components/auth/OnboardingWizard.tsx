"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Role } from "@/lib/types";

/**
 * Onboarding wizard — collects optional contact info AFTER signup. The
 * role choice was already made at signup (see SignupForm), so this
 * wizard no longer asks for it. The role is loaded from the profile so
 * the post-onboarding routing (allocator → /discovery/crypto-sma,
 * everyone else → /strategies) keeps working.
 *
 * The profile UPDATE here intentionally does NOT include the `role`
 * field. Database trigger `prevent_profile_role_change` blocks the
 * mutation server-side too, but we omit the field client-side as
 * defense-in-depth.
 */
export function OnboardingWizard() {
  const [role, setRole] = useState<Role | null>(null);
  const [company, setCompany] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled && profile?.role) {
        setRole(profile.role as Role);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Role intentionally omitted — set at signup, immutable from client.
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
      role === "allocator" ? "/discovery/crypto-sma" : "/strategies";
    router.push(destination);
    router.refresh();
  }

  return (
    <div className="space-y-6">
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
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button onClick={handleComplete} disabled={loading} className="w-full">
        {loading ? "Saving..." : "Get started"}
      </Button>
    </div>
  );
}
