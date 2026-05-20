"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { ROLES, type Profile } from "@/lib/types";
import { Textarea } from "@/components/ui/Textarea";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [company, setCompany] = useState(profile.company ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [telegram, setTelegram] = useState(profile.telegram ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [linkedin, setLinkedin] = useState(profile.linkedin ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Role is set at signup and immutable from the client (see
  // `prevent_profile_role_change` trigger). Render it read-only.
  const roleLabel =
    ROLES.find((r) => r.value === profile.role)?.label ?? profile.role;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        company: company || null,
        description: description || null,
        telegram: telegram || null,
        website: website || null,
        linkedin: linkedin || null,
        // `role` intentionally omitted — see comment above.
      })
      .eq("id", profile.id);

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          Personal Info
        </h2>
        <div className="space-y-4">
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <Input
            label="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Tell allocators about yourself..."
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Telegram"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="@username"
            />
            <Input
              label="Website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <Input
            label="LinkedIn"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/in/..."
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Role</h2>
        <div
          className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3"
          data-testid="profile-role-readonly"
        >
          <span className="text-sm font-medium text-text-primary">
            {roleLabel}
          </span>
          <span className="text-xs text-text-muted">
            Set at signup. Contact support to change it.
          </span>
        </div>
      </Card>

      {error && <p className="text-sm text-negative">{error}</p>}
      {success && (
        <p className="text-sm text-positive">Profile updated.</p>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
