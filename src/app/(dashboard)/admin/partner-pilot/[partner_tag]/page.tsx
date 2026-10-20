import Link from "next/link";
import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { isValidPartnerTag } from "@/lib/partner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, statusLabelMap } from "@/components/ui/Badge";
import { disclosureTierLabel, labelOf } from "@/lib/display-labels";
import { ScopedBanner } from "@/components/ui/ScopedBanner";
import type { Profile, Strategy, Role } from "@/lib/types";

// /admin/partner-pilot/[partner_tag] — T-1.3 from the cap-intro demo sprint.
// Filtered view of the profiles / strategies / contact_requests tagged with a
// given partner_tag. This is the landing pad after /admin/partner-import runs:
// the founder sees allocator + strategy counts, a forward-looking "pipeline"
// framing, and a prominent button to the filtered eval dashboard.
//
// Framing rule: never render the literal "0 intros" — the hero line leads
// with the forward-looking "N allocators × M strategies = K potential intros"
// number so the demo opens on a promise, not an apology.

// Narrow picks over the canonical `Profile` / `Strategy` types — preferable to
// parallel shadow interfaces, because a new field on Profile will propagate
// here automatically if this page ever reads it. `role` and `disclosure_tier`
// use their canonical string unions, not string-typed fallbacks.
type ProfileLite = Pick<
  Profile,
  "id" | "display_name" | "email" | "role" | "allocator_status"
>;
type StrategyLite = Pick<
  Strategy,
  "id" | "name" | "status" | "disclosure_tier" | "user_id"
>;

// Tab title. The tag is echoed only after it passes `isValidPartnerTag`; no data
// is read here.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ partner_tag: string }>;
}): Promise<Metadata> {
  const { partner_tag } = await params;
  return {
    title: isValidPartnerTag(partner_tag)
      ? `Partner pilot: ${partner_tag}`
      : "Partner pilot",
  };
}

export default async function PartnerPilotPage({
  params,
}: {
  params: Promise<{ partner_tag: string }>;
}) {
  const { partner_tag } = await params;

  if (!isValidPartnerTag(partner_tag)) {
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

  // Manager display names for the strategies' owners, read by id so a manager
  // whose profile is not tagged to this pilot still resolves to a name.
  const managerIds = Array.from(new Set(strategies.map((s) => s.user_id)));
  const managerNameById = new Map<string, string>();
  if (managerIds.length > 0) {
    const { data: managerRows, error: managerError } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", managerIds);
    if (managerError) {
      console.error("[admin/partner-pilot] managerNames query failed", {
        code: managerError.code,
        message: managerError.message,
      });
      throw new Error("Partner pilot: managerNames query failed");
    }
    for (const row of managerRows ?? []) {
      if (row.display_name) managerNameById.set(row.id, row.display_name);
    }
  }

  // Role union narrows the strings below — any future value added to Role in
  // types.ts that isn't handled here will surface as a TypeScript error.
  const ALLOCATOR_ROLES: Role[] = ["allocator", "both"];
  const allocators = profiles.filter((p) => ALLOCATOR_ROLES.includes(p.role));

  const potentialIntros = allocators.length * strategies.length;

  return (
    <>
      <PageHeader
        title="Partner pilot"
        description={`White-label pilot scoped to a subset of managers + allocators. Data is filtered to ${partner_tag}.`}
        meta={
          <span className="inline-flex items-center rounded-md border border-accent/40 bg-accent/5 px-2 py-1 text-caption font-mono text-accent">
            {partner_tag}
          </span>
        }
      />

      <div className="space-y-6">
        {/* Pipeline / hero card. Forward-looking framing — we never render
            "0 intros" literally because it reads as an apology instead of a
            promise. When N intros have shipped, we show a separate bar below. */}
        <ScopedBanner
          tone="accent"
          title={
            <>
              {allocators.length} allocators &times; {strategies.length}{" "}
              strategies ={" "}
              <span className="font-metric tabular-nums">{potentialIntros}</span>{" "}
              potential intros
            </>
          }
          subtitle="Every allocator in this pilot is a candidate for every strategy. Hit the match queue to start shipping — the algorithm has already ranked candidates for each allocator."
          cta={
            <Link href={`/admin/match/eval?partner_tag=${partner_tag}`}>
              <Button>Open filtered eval dashboard &rarr;</Button>
            </Link>
          }
        />

        {/* Intros-shipped bar. Only rendered when strictly > 0 so we never
            display "0 intros" on the partner pilot page. */}
        {introsCount > 0 && (
          <Card>
            <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
              Intros shipped
            </p>
            <p className="mt-2 font-metric tabular-nums text-h3 text-text-primary">
              {introsCount}
            </p>
            <p className="mt-1 text-caption text-text-muted">
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
              <h2 className="text-body font-semibold text-text-primary">
                Allocators
              </h2>
              <span className="text-caption font-metric tabular-nums text-text-muted">
                {allocators.length}
              </span>
            </div>
            {allocators.length === 0 ? (
              <p className="text-small text-text-muted">
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
                      <p
                        className="text-small font-medium text-text-primary truncate"
                        title={a.display_name || a.email || "Unknown allocator"}
                      >
                        {a.display_name || a.email || "Unknown allocator"}
                      </p>
                      {a.email && (
                        // The email is a mid-clip on narrow cards; title= makes
                        // the full address recoverable on hover (it is already
                        // rendered to the admin, so this leaks nothing — T-53-10).
                        <p
                          className="text-caption font-mono text-text-muted truncate"
                          title={a.email}
                        >
                          {a.email}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/admin/match/${a.id}`}
                      className="ml-3 shrink-0 text-caption text-accent hover:text-accent-hover"
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
              <h2 className="text-body font-semibold text-text-primary">
                Strategies
              </h2>
              <span className="text-caption font-metric tabular-nums text-text-muted">
                {strategies.length}
              </span>
            </div>
            {strategies.length === 0 ? (
              <p className="text-small text-text-muted">
                No strategies staged yet.
              </p>
            ) : (
              <ul className="divide-y divide-border -mx-2">
                {strategies.map((s) => {
                  const managerName =
                    managerNameById.get(s.user_id) ?? "Unknown manager";
                  const tierLabel = s.disclosure_tier
                    ? disclosureTierLabel(s.disclosure_tier)
                    : "—";
                  return (
                    <li key={s.id} className="px-2 py-2.5">
                      <p
                        className="text-small font-medium text-text-primary truncate"
                        title={s.name ?? undefined}
                      >
                        {s.name}
                      </p>
                      <p
                        className="text-caption text-text-muted truncate"
                        title={`${labelOf(statusLabelMap, s.status, "Unknown status")} · ${tierLabel} · ${managerName}`}
                      >
                        <Badge type="status" label={s.status} />
                        {" · "}
                        {tierLabel}
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
