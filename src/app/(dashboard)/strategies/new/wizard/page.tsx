import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DesktopGate } from "./DesktopGate";
import { WizardClient } from "./WizardClient";

/**
 * /strategies/new/wizard — the Task 1.2 onboarding wizard entry point.
 *
 * Server Component. Responsibilities:
 *   1. Auth gate. `(dashboard)` layout already enforces authenticated
 *      access, but we check again because this route is load-bearing
 *      for SEC-005 — an unauthenticated drop-in would bypass the key
 *      creation flow.
 *   2. Load the most recent wizard draft for the current user (if any)
 *      so WizardClient can decide whether to show the Resume banner
 *      or start fresh.
 *   3. Wrap the client island in DesktopGate which renders the
 *      save-my-progress email form on <640px viewports.
 */

export const metadata: Metadata = {
  title: "Connect Your Strategy | Quantalyze",
  description:
    "Connect a read-only exchange API key to verify your strategy and list it for allocators.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface InitialDraft {
  id: string;
  name: string | null;
  description: string | null;
  category_id: string | null;
  strategy_types: string[] | null;
  subtypes: string[] | null;
  markets: string[] | null;
  supported_exchanges: string[] | null;
  leverage_range: string | null;
  aum: number | null;
  max_capacity: number | null;
  api_key_id: string | null;
}

interface WizardPageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function WizardPage({ searchParams }: WizardPageProps) {
  // Read `?source=csv` from the server-side searchParams so we can pass a
  // stable key down to <WizardClient> and force a remount on the API↔CSV
  // boundary. Reading on the client via useSearchParams() does NOT remount
  // the component on same-route query-string nav (the bug the user hit
  // when clicking "Upload a CSV track record instead" from ConnectKeyStep):
  // useSearchParams() updates the value, but useState lazy initializers
  // (which set `step` from `source` once on mount) never re-run, so `step`
  // gets stuck on `"connect_key"` even after `source` flips to `"csv"`.
  // Keying the client island by `source` here gives Next a stable signal
  // to remount the subtree when the query string crosses the branch.
  const sp = await searchParams;
  const source: "api" | "csv" = sp?.source === "csv" ? "csv" : "api";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/strategies/new/wizard");
  }

  // Pull the most recent wizard draft (if any). The WizardClient will
  // decide whether to show the Resume banner based on whether this
  // row matches the localStorage pointer.
  const { data: draft } = await supabase
    .from("strategies")
    .select(
      "id, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, api_key_id, created_at",
    )
    .eq("user_id", user.id)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const initialDraft: InitialDraft | null = draft ?? null;

  return (
    <DesktopGate>
      {/*
        Suspense boundary is mandatory: WizardClient calls useSearchParams()
        which, under Next 16 + React 19, bails the WHOLE client tree (up to
        the nearest Suspense or the root layout) to CSR when a route is
        statically rendered. With no boundary here, the boundary becomes the
        root layout — meaning EVERY paint up to root re-runs client-side.
        That re-run created a hydration window where WizardClient mounted
        with searchParams=null (SSR's view), computed source="api", then
        the client re-resolved searchParams to "csv" but the step state had
        already been initialized to "connect_key" — and neither the api nor
        csv step rendered cleanly afterward. The user-visible symptom: the
        wizard chrome (header + step pills + footer) rendered fine but the
        CsvUploadStep body was empty.

        `force-dynamic` does NOT skip this requirement in Next 16 — the
        Suspense gate applies to client-side searchParams resolution
        regardless of server-render mode. Wrapping WizardClient in its own
        Suspense scopes the CSR bail-out to the wizard subtree only and
        gives React 19 a stable hydration anchor for the step state.

        fallback={null} matches the previous SSR markup (the wizard chrome
        is inside WizardClient, so a non-null fallback would briefly flash a
        different shell). The chrome is cheap to render so a momentary
        blank is acceptable; if we ever want a skeleton, mirror the chrome
        exactly to avoid layout shift.
      */}
      <Suspense key={source} fallback={null}>
        <WizardClient key={source} initialDraft={initialDraft} />
      </Suspense>
    </DesktopGate>
  );
}
