"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/**
 * Account types collected at signup. The signup form ALWAYS asks the user
 * to pick one — and after signup the choice is immutable on the client
 * (see `prevent_profile_role_change` trigger in the migration). The
 * `profiles.role` column still allows `'both'` for historical / admin-set
 * rows; signup intentionally does NOT expose that option because "both"
 * is not a coherent first-time user identity — a quant who also wants to
 * allocate asks support.
 */
type SignupRole = "allocator" | "manager";

const SIGNUP_ROLE_OPTIONS: {
  value: SignupRole;
  label: string;
  description: string;
}[] = [
  {
    value: "allocator",
    label: "Allocator",
    description:
      "I'm allocating capital — discover, compare, and connect with managers.",
  },
  {
    value: "manager",
    label: "Quant team / Manager",
    description:
      "I run trading strategies — publish them with verified exchange data.",
  },
];

export function SignupForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SignupRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (role === null) {
      setError("Pick whether you're an allocator or a quant team.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    // `options.data` is mirrored onto auth.users.raw_user_meta_data, which
    // the `handle_new_user` trigger reads when it INSERTs the profile row.
    // Setting `role` here is the only way to seed a profile with the
    // intended role — after signup the role-lock trigger prevents
    // authenticated clients from mutating it.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, role },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      setError("Check your email to confirm your account, then sign in.");
      setLoading(false);
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-text-primary">
          I am...
        </p>
        <div
          role="radiogroup"
          aria-label="Account type"
          className="space-y-2"
        >
          {SIGNUP_ROLE_OPTIONS.map((r) => {
            const checked = role === r.value;
            return (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={checked}
                data-testid={`signup-role-${r.value}`}
                onClick={() => setRole(r.value)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  checked
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/50",
                )}
              >
                <p className="text-sm font-medium text-text-primary">
                  {r.label}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {r.description}
                </p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          This is locked after signup. Contact support to change it later.
        </p>
      </div>
      <Input
        label="Display name"
        name="display_name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Your name"
        required
        autoComplete="name"
      />
      <Input
        label="Email"
        type="email"
        name="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
      />
      <Input
        label="Password"
        type="password"
        name="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 6 characters"
        required
        minLength={6}
        autoComplete="new-password"
      />
      {error && (
        <p className="text-sm text-negative">{error}</p>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
