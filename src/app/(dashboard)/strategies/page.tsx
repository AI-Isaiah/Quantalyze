import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StrategyActions } from "@/components/strategy/StrategyActions";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function StrategiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: strategies } = await supabase
    .from("strategies")
    .select("id, name, status, strategy_types, review_note, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="My Strategies"
        actions={
          <Link href="/strategies/new">
            <Button>New Strategy</Button>
          </Link>
        }
      />

      {(!strategies || strategies.length === 0) ? (
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">No strategies yet.</p>
          <Link href="/strategies/new">
            <Button>Create your first strategy</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <Link href={`/strategies/${s.id}/edit`} className="font-medium text-text-primary hover:text-accent transition-colors">
                    {s.name}
                  </Link>
                  <div className="flex gap-1.5 mt-1">
                    {s.strategy_types.map((t: string) => (
                      <Badge key={t} label={t} />
                    ))}
                  </div>
                  {s.review_note && s.status === "draft" && (
                    <p className="mt-2 text-xs text-negative bg-negative/5 rounded px-2 py-1">
                      Review feedback: {s.review_note}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <Badge label={s.status} type="status" />
                  <StrategyActions strategyId={s.id} status={s.status} />
                  <span className="text-xs text-text-muted">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
