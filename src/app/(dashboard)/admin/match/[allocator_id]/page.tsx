import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { AllocatorMatchQueue } from "@/components/admin/AllocatorMatchQueue";

export default async function AllocatorMatchQueuePage({
  params,
}: {
  params: Promise<{ allocator_id: string }>;
}) {
  const { allocator_id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  return <AllocatorMatchQueue allocatorId={allocator_id} />;
}
