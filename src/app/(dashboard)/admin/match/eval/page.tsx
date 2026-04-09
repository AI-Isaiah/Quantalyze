import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { isValidPartnerTag } from "@/lib/partner";
import { PageHeader } from "@/components/layout/PageHeader";
import { MatchEvalDashboard } from "@/components/admin/MatchEvalDashboard";

export default async function MatchEvalPage({
  searchParams,
}: {
  searchParams: Promise<{ partner_tag?: string }>;
}) {
  const { partner_tag } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  // Validate partner_tag server-side — if it's malformed, drop it rather
  // than passing an invalid value through to the dashboard fetch.
  const safePartnerTag = isValidPartnerTag(partner_tag) ? partner_tag : undefined;

  return (
    <>
      <PageHeader
        title="Match engine eval"
        description={
          safePartnerTag
            ? `Hit rate scoped to partner pilot: ${safePartnerTag}`
            : "Is the algorithm actually helping you ship better intros? Compare picks against your ground truth."
        }
      />
      <MatchEvalDashboard partnerTag={safePartnerTag} />
    </>
  );
}
