import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccreditedInvestorGate } from "@/components/legal/AccreditedInvestorGate";

// Pin to dynamic rendering. The compliance gate must run on every request —
// a future caching PR or `unstable_cache` wrapper that introduced
// `revalidate > 0` here would be a fail-open vulnerability (cached "attested"
// response served to a non-attested user). force-dynamic prevents that.
export const dynamic = "force-dynamic";

/**
 * Layout-level accredited-investor gate for /discovery/*.
 *
 * Server component: runs on every request. Checks whether the current user
 * has attested and, if not, renders the gate in place of the actual discovery
 * children. A signed-in admin is always considered attested (backfilled by
 * migration 012) so the founder does not hit the gate during demos.
 *
 * Fail-closed: if the Supabase read errors (network blip, DB down), we render
 * the gate, NOT the children. Compliance default is "blocked" when the
 * attestation state is uncertain.
 *
 * The `/browse/*` tree intentionally stays un-gated — it's the marketing/SEO
 * surface and must remain accessible to unauthenticated visitors.
 */
export default async function DiscoveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/discovery/crypto-sma");
  }

  let attestedAt: string | null = null;
  try {
    const { data: attestation, error } = await supabase
      .from("investor_attestations")
      .select("attested_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      console.error("[discovery/layout] attestation lookup failed:", error.message);
      return <AccreditedInvestorGate />;
    }
    attestedAt = attestation?.attested_at ?? null;
  } catch (err) {
    console.error("[discovery/layout] attestation lookup threw:", err);
    return <AccreditedInvestorGate />;
  }

  if (!attestedAt) {
    return <AccreditedInvestorGate />;
  }

  return <>{children}</>;
}
