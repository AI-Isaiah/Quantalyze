import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import {
  FOR_QUANTS_LEADS_FULL_VIEW_CAP,
  listForQuantsLeads,
} from "@/lib/for-quants-leads-admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { ForQuantsLeadsTable } from "@/components/admin/ForQuantsLeadsTable";

// Founder CRM triage for /api/for-quants-lead submissions.
export default async function ForQuantsLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const { show } = await searchParams;
  const showAll = show === "all";
  const { rows, hitCap } = await listForQuantsLeads({ showAll });

  return (
    <>
      <PageHeader
        title="Request-a-Call leads"
        description="Public /for-quants submissions. Mark as processed once you've reached out."
      />
      <ForQuantsLeadsTable
        leads={rows}
        showAll={showAll}
        hitCap={hitCap}
        fullViewCap={FOR_QUANTS_LEADS_FULL_VIEW_CAP}
      />
    </>
  );
}
