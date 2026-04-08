import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// /admin/partner-pilot/[partner_tag] — T-1.3 from the cap-intro demo sprint.
// Filtered view of the profiles / strategies / contact_requests tagged with a
// given partner_tag. This is the landing pad after /admin/partner-import runs:
// the founder sees allocator + strategy counts, a forward-looking "pipeline"
// framing, and a prominent button to the filtered eval dashboard.
//
// Framing rule: never render the literal "0 intros" — the hero line leads
// with the forward-looking "N allocators × M strategies = K potential intros"
// number so the demo opens on a promise, not an apology.

const PARTNER_TAG_RE = /^[a-z0-9-]+$/;

interface ProfileLite {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  allocator_status: string | null;
}

interface StrategyLite {
  id: string;
  name: string;
  status: string;
  disclosure_tier: string | null;
  user_id: string;
}

export default async function PartnerPilotPage({
  params,
}: {
  params: Promise<{ partner_tag: string }>;
}) {
  const { partner_tag } = await params;

  if (!PARTNER_TAG_RE.test(partner_tag)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  const [profilesRes, strategiesRes, contactsRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, email, role, allocator_status")
      .eq("partner_tag", partner_tag)
      .order("role", { ascending: true }),
    admin
      .from("strategies")
      .select("id, name, status, disclosure_tier, user_id")
      .eq("partner_tag", partner_tag)
      .order("name", { ascending: true }),
    admin
      .from("contact_requests")
      .select("id, status", { count: "exact", head: true })
      .eq("partner_tag", partner_tag),
  ]);

  const profiles = (profilesRes.data ?? []) as ProfileLite[];
  const strategies = (strategiesRes.data ?? []) as StrategyLite[];
  const introsCount = contactsRes.count ?? 0;

  const allocators = profiles.filter(
    (p) => p.role === "allocator" || p.role === "both",
  );
  const managers = profiles.filter((p) => p.role === "manager" || p.role === "both");

  const potentialIntros = allocators.length * strategies.length;

  return (
    <>
      <PageHeader
        title="Partner pilot"
        description={`White-label pilot scoped to a subset of managers + allocators. Data is filtered to ${partner_tag}.`}
        meta={
          <span className="inline-flex items-center rounded-md border border-accent/40 bg-accent/5 px-2 py-1 text-xs font-mono text-accent">
            {partner_tag}
          </span>
        }
      />

      <div className="space-y-6">
        {/* Pipeline / hero card. Forward-looking framing — we never render
            "0 intros" literally because it reads as an apology instead of a
            promise. When N intros have shipped, we show a separate bar below. */}
        <Card className="border-l-4 border-accent">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Pipeline
          </p>
          <p className="mt-2 font-display text-[32px] leading-tight text-text-primary">
            {allocators.length} allocators &times; {strategies.length} strategies ={" "}
            <span className="font-metric tabular-nums">{potentialIntros}</span>{" "}
            potential intros
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            Every allocator in this pilot is a candidate for every strategy.
            Hit the match queue to start shipping — the algorithm has
            already ranked candidates for each allocator.
          </p>
          <div className="mt-4">
            <Link href={`/admin/match/eval?partner_tag=${partner_tag}`}>
              <Button>Open filtered eval dashboard &rarr;</Button>
            </Link>
          </div>
        </Card>

        {/* Intros-shipped bar. Only rendered when strictly > 0 so we never
            display "0 intros" on the partner pilot page. */}
        {introsCount > 0 && (
          <Card>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
              Intros shipped
            </p>
            <p className="mt-2 font-metric tabular-nums text-[32px] text-text-primary">
              {introsCount}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Contact requests tagged to{" "}
              <span className="font-mono text-text-primary">{partner_tag}</span>
              .
            </p>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Allocators list with per-row "Open match queue" links. */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-text-primary">
                Allocators
              </h2>
              <span className="text-xs font-metric tabular-nums text-text-muted">
                {allocators.length}
              </span>
            </div>
            {allocators.length === 0 ? (
              <p className="text-sm text-text-muted">
                No allocators staged yet. Import a CSV from{" "}
                <Link
                  href="/admin/partner-import"
                  className="text-accent hover:text-accent-hover"
                >
                  /admin/partner-import
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border -mx-2">
                {allocators.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between px-2 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {a.display_name || a.email || a.id.slice(0, 8)}
                      </p>
                      {a.email && (
                        <p className="text-xs font-mono text-text-muted truncate">
                          {a.email}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/admin/match/${a.id}`}
                      className="ml-3 shrink-0 text-xs text-accent hover:text-accent-hover"
                    >
                      Open match queue &rarr;
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Strategies list. */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-text-primary">
                Strategies
              </h2>
              <span className="text-xs font-metric tabular-nums text-text-muted">
                {strategies.length}
              </span>
            </div>
            {strategies.length === 0 ? (
              <p className="text-sm text-text-muted">
                No strategies staged yet.
              </p>
            ) : (
              <ul className="divide-y divide-border -mx-2">
                {strategies.map((s) => {
                  const managerName =
                    managers.find((m) => m.id === s.user_id)?.display_name ||
                    s.user_id.slice(0, 8);
                  return (
                    <li key={s.id} className="px-2 py-2.5">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {s.name}
                      </p>
                      <p className="text-xs text-text-muted truncate">
                        <span className="font-mono">{s.status}</span>
                        {" · "}
                        <span className="font-mono">
                          {s.disclosure_tier ?? "—"}
                        </span>
                        {" · "}
                        {managerName}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
