import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/auth/requireRolePage";

// Pin to dynamic rendering — the role guard must run on every request. A
// future caching PR that introduced `revalidate > 0` here would be a
// fail-open vulnerability (a cached "manager" render served to a wrong-role
// visitor). force-dynamic prevents that. Mirrors discovery/layout.tsx.
export const dynamic = "force-dynamic";

/**
 * Phase 109 ROLE-04 — manager segment layout for the whole /portfolios/* subtree.
 *
 * A `layout.tsx` is the outermost component in its route segment: it wraps
 * `page.js` AND every descendant segment's page (Next 16 docs,
 * layout.md — "layout.js is the outermost component in a route segment.
 * It wraps template.js, error.js, loading.js, not-found.js, and page.js";
 * layouts-and-pages.md — `children` is populated with the route segments the
 * layout is wrapping). A sibling `page.tsx` guard does NOT cover nested routes,
 * so this layout — not a per-index-page guard — is the single guard site for
 * the subtree: portfolios (index) + [id] + [id]/manage + [id]/documents.
 *
 * The role guard is at the top level, OUTSIDE any try/catch: requireRolePage's
 * wrong-role redirect() throws NEXT_REDIRECT (redirect.md) and a wrapping catch
 * would swallow it (fail-open). Wrong-role visitors are bounced to their own
 * role home; role='both' owns both surfaces and is never redirected.
 */
export default async function PortfoliosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/portfolios");
  }

  await requireRolePage(supabase, user, "manager");

  return <>{children}</>;
}
