import { redirect } from "next/navigation";

/**
 * Legacy `/strategies/new` route. Task 1.2 replaced the inverted
 * StrategyForm flow with the 4-step wizard at
 * `/strategies/new/wizard`. This file just redirects so any existing
 * bookmarks, dashboard links, or email CTAs land on the new flow.
 *
 * QA report 2026-05-21 ISSUE-013: the unconditional `redirect()` stripped
 * the `?source=csv` query param on its way through, so any direct nav to
 * `/strategies/new?source=csv` landed on the API wizard and the user was
 * told to paste an API key. The fix forwards the source param through
 * the redirect so the wizard renders the right branch.
 *
 * The underlying StrategyForm component stays in the repo for the
 * `/strategies/[id]/edit` page (which is a distinct "edit an existing
 * strategy" flow).
 */
interface NewStrategyPageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function NewStrategyPage({
  searchParams,
}: NewStrategyPageProps) {
  const sp = await searchParams;
  const target =
    sp?.source === "csv"
      ? "/strategies/new/wizard?source=csv"
      : "/strategies/new/wizard";
  redirect(target);
}
