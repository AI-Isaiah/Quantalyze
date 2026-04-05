import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function StrategiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: strategies } = await supabase
    .from("strategies")
    .select("id, name, status, strategy_types, created_at")
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
            <Link key={s.id} href={`/strategies/${s.id}/edit`}>
              <Card className="hover:shadow-elevated transition-shadow cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-text-primary">{s.name}</h3>
                    <div className="flex gap-1.5 mt-1">
                      {s.strategy_types.map((t: string) => (
                        <Badge key={t} label={t} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge label={s.status} type="status" />
                    <span className="text-xs text-text-muted">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
