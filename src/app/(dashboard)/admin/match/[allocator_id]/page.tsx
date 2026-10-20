import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import { AllocatorMatchQueue } from "@/components/admin/AllocatorMatchQueue";

/**
 * Tab title. The allocator's name is read with the service-role client, so
 * the page's own admin gate runs first: a signed-out or non-admin caller gets
 * the fixed title and causes no profile read. Only `display_name` is selected.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ allocator_id: string }>;
}): Promise<Metadata> {
  const { allocator_id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser(supabase, user))) {
    return { title: "Match queue" };
  }

  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("display_name")
    .eq("id", allocator_id)
    .maybeSingle();
  if (error) {
    captureToSentry(new Error(error.message), {
      tags: { route: "admin/match/[allocator_id]/page", stage: "generate-metadata" },
    });
  }
  if (error || !data?.display_name) return { title: "Match queue" };
  return { title: `Match queue for ${data.display_name}` };
}

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
