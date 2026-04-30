"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    // T-13-02-01 cross-account isolation: purge user-namespaced
    // localStorage entries so a shared device doesn't leak prefs from
    // user A to user B. supabase.auth.signOut() handles the auth session
    // cookie and `sb-*` keys, but app-owned namespaces are our problem.
    // Currently `discovery_view_preferences:{uid}:{slug}` is the only
    // such namespace; add new prefixes here as they appear.
    if (typeof window !== "undefined") {
      const APP_NAMESPACED_PREFIXES = ["discovery_view_preferences:"];
      Object.keys(window.localStorage)
        .filter((k) =>
          APP_NAMESPACED_PREFIXES.some((p) => k.startsWith(p)),
        )
        .forEach((k) => window.localStorage.removeItem(k));
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign out failed:", error.message);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={handleSignOut}>
      Sign out
    </Button>
  );
}
