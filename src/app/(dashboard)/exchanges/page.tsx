import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserApiKeys } from "@/lib/queries";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { AllocatorExchangeManager } from "@/components/exchanges/AllocatorExchangeManager";

export const dynamic = "force-dynamic";

export default async function AllocatorExchangesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/exchanges");

  const admin = createAdminClient();
  const keys = await getUserApiKeys(user.id);

  // Find the allocator's "active" portfolio (the one synced from exchanges).
  // For the seeded demo this is always "Active Allocation".
  const { data: activePortfolio } = await admin
    .from("portfolios")
    .select("id, name")
    .eq("user_id", user.id)
    .ilike("name", "Active Allocation")
    .maybeSingle();

  return (
    <main className="max-w-[960px] mx-auto p-6 pb-20">
      <PageHeader
        title="Connected exchanges"
        description="Upload read-only exchange API keys to automatically sync your real positions and build your Active Allocation portfolio. No manual data entry — your invest and divest events are detected directly from your exchange account."
      />

      {activePortfolio ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Real portfolio
              </p>
              <Link
                href={`/portfolios/${(activePortfolio as { id: string }).id}`}
                className="mt-1 block text-base font-semibold text-text-primary hover:text-accent"
              >
                {(activePortfolio as { name: string }).name}
              </Link>
              <p className="mt-1 text-xs text-text-muted">
                This portfolio&apos;s positions, allocations, and
                invest/divest events are derived automatically from the
                exchange connections below.
              </p>
            </div>
            <Link
              href={`/portfolios/${(activePortfolio as { id: string }).id}`}
              className="text-xs px-3 py-2 rounded-md border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            >
              Open portfolio →
            </Link>
          </div>
        </Card>
      ) : null}

      <AllocatorExchangeManager initialKeys={keys} />
    </main>
  );
}
