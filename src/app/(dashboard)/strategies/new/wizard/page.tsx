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

export default async function WizardPage() {
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
      <WizardClient initialDraft={initialDraft} />
    </DesktopGate>
  );
}
