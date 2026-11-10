import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/auth/requireRolePage";

// Pin to dynamic rendering: the role guard must run on every request. A future
// caching PR that introduced `revalidate > 0` here would be a fail-open
// vulnerability (a cached "manager" render served to a wrong-role visitor).
export const dynamic = "force-dynamic";

/**
 * Phase 199 D-01 (LEAN-01) - manager segment guard for /strategies/[id]/edit.
 *
 * D-01 widens ONLY the /strategies index (to every owner). Until now one layout,
 * `strategies/layout.tsx`, guarded the whole subtree, so the index could not
 * widen without opening these sub-routes too. This layout gives them a guard of
 * their own, so plan 199-09 can widen the index alone. A layout wraps every
 * descendant segment's page (Next 16 docs, layout.md), so it covers
 * [id]/edit/page.tsx. `src/__tests__/strategies-guard-coverage.test.ts` fails
 * when a non-index strategies page has no such guard of its own.
 *
 * CD-10: no allocator surface lives under /strategies/[id].
 * The Phase 110 allocator exception is an overlay, not this route.
 *
 * The role guard is at the top level, OUTSIDE any try/catch: requireRolePage's
 * wrong-role redirect() throws NEXT_REDIRECT and a wrapping catch would swallow
 * it (fail-open). Wrong-role visitors are bounced to their own role home;
 * role='both' owns both surfaces and is never redirected.
 *
 * The parent StrategiesLayout keeps its guard until 199-09 removes it together
 * with the index widening, so these sub-routes are guarded twice meanwhile.
 */
export default async function StrategyIdLayout({
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

  await requireRolePage(supabase, user, "manager");

  return <>{children}</>;
}
