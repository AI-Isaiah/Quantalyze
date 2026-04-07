import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { MatchQueueIndex } from "@/components/admin/MatchQueueIndex";

// /admin/match — triage-first allocator list for the founder match queue.
// Admin-only. Regular allocators bounce back to discovery.
export default async function MatchQueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  return (
    <>
      <PageHeader
        title="Match queue"
        description="Algorithm-scored candidates for each allocator. You pick; the platform ships."
      />
      <MatchQueueIndex />
    </>
  );
}
