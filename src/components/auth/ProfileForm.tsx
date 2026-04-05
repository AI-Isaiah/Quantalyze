"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { ROLES, type Profile, type Role } from "@/lib/types";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [company, setCompany] = useState(profile.company ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [telegram, setTelegram] = useState(profile.telegram ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [linkedin, setLinkedin] = useState(profile.linkedin ?? "");
  const [role, setRole] = useState<Role>(profile.role);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
        role,
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
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-primary">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Tell allocators about yourself..."
            />
          </div>
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
        <div className="flex gap-3">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRole(r.value)}
              className={cn(
                "flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                role === r.value
                  ? "border-accent bg-accent/5 text-accent"
                  : "border-border text-text-secondary hover:border-accent/50"
              )}
            >
              {r.label}
            </button>
          ))}
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
