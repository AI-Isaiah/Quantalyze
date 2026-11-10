import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Pin to dynamic rendering. This layout no longer guards a role, but the page
// under it reads the viewer's role and builds role furniture on every request:
// a cached render would serve one viewer's controls (a manager's Edit link) to
// another. force-dynamic prevents that. Mirrors discovery/layout.tsx.
export const dynamic = "force-dynamic";

/**
 * Phase 199 D-01 (LEAN-01) - session check for the whole /strategies/* subtree.
 *
 * Until Phase 199 this layout was the single manager guard for the subtree
 * (Phase 109 ROLE-04). D-01 opens the /strategies INDEX to every strategy owner
 * (allocators, managers and `both`), so this layout calls no `requireRolePage`
 * and redirects no role. It keeps only the session check.
 *
 * The sell-side sub-routes stay manager-only through two guard layouts of
 * their own, which Next 16 wraps around every descendant page (layout.md:
 * "layout.js is the outermost component in a route segment. It wraps
 * template.js, error.js, loading.js, not-found.js, and page.js"):
 *   - `strategies/new/layout.tsx`   -> /strategies/new and /strategies/new/wizard
 *   - `strategies/[id]/layout.tsx`  -> /strategies/[id]/edit
 * `src/__tests__/strategies-guard-coverage.test.ts` fails when a non-index
 * strategies page has no such guard of its own, and also fails when this layout
 * or the index page calls `requireRolePage` (T-199-29).
 *
 * The index page reads `profiles.role` itself and decides its furniture per role;
 * its DB-error discipline mirrors `requireRolePage` (a read error throws, a role
 * is never guessed).
 */
export default async function StrategiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/strategies");
  }

  return <>{children}</>;
}
