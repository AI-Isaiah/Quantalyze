import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { MatchEvalDashboard } from "@/components/admin/MatchEvalDashboard";

export default async function MatchEvalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  return (
    <>
      <PageHeader
        title="Match engine eval"
        description="Is the algorithm actually helping you ship better intros? Compare picks against your ground truth."
      />
      <MatchEvalDashboard />
    </>
  );
}
