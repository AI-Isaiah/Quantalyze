import { redirect } from "next/navigation";

// FLOW-02 (Phase 32): the legacy Strategy-Sandbox surface is retired into the
// unified composer. /scenarios now 307-redirects to the composer deep-link.
// Next.js 16 `redirect()` from next/navigation serves a 307 (temporary, NOT
// CDN-cacheable) by default and returns `never`, so no `return` is needed.
// The old role gate + RLS-bypassing admin-client institutional-universe read
// are gone — a net security improvement (the C-0017 leak vector is removed at
// the source). The redirect target `/allocations` keeps its own auth via the
// dashboard layout + page guards.
export default function ScenariosPage() {
  redirect("/allocations?tab=scenario");
}
