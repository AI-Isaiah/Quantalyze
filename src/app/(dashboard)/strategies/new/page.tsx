import { redirect } from "next/navigation";

/**
 * Legacy `/strategies/new` route. Task 1.2 replaced the inverted
 * StrategyForm flow with the 4-step wizard at
 * `/strategies/new/wizard`. This file just redirects so any existing
 * bookmarks, dashboard links, or email CTAs land on the new flow.
 *
 * The underlying StrategyForm component stays in the repo for the
 * `/strategies/[id]/edit` page (which is a distinct "edit an existing
 * strategy" flow). It will be fully removed in Sprint 3.
 */
export default function NewStrategyPage() {
  redirect("/strategies/new/wizard");
}
