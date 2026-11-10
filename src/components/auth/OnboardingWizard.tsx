"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ROLE_HOME_ROUTE } from "@/lib/routing/default-route";

/**
 * Onboarding wizard — collects optional contact info AFTER signup. The
 * role choice was already made at signup (see SignupForm), so this
 * wizard no longer asks for it. After a successful update it pushes
 * ROLE_HOME_ROUTE, the one server route that reads the profile and
 * redirects by role (Phase 199 MANAGERHOME, CD-01).
 *
 * The profile UPDATE here intentionally does NOT include the `role`
 * field. Database trigger `prevent_profile_role_change` blocks the
 * mutation server-side too, but we omit the field client-side as
 * defense-in-depth.
 */
export function OnboardingWizard() {
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

    router.push(ROLE_HOME_ROUTE);
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
