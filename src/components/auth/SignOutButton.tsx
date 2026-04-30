"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { purgeAppNamespacedStorage } from "@/lib/storage-namespaces";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    // T-13-02-01 cross-account isolation: purge every app-namespaced
    // localStorage entry before the auth round-trip so a shared device
    // doesn't leak User A's widget layout, scenario draft, wizard state,
    // discovery prefs, etc. into User B's session. The prefix registry
    // (lib/storage-namespaces.ts) is the single source of truth — adding
    // a new key without a registered prefix fails the storage-namespaces
    // unit test in CI before it can ship.
    purgeAppNamespacedStorage();
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
