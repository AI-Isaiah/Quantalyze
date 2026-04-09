import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { AllocatorMatchQueue } from "@/components/admin/AllocatorMatchQueue";
import { ALLOCATOR_ACTIVE_ID } from "@/lib/demo";

// Never cache — we want the friend to see the latest match batch each time
// they hit refresh, even if the hourly recompute ran in between.
export const dynamic = "force-dynamic";

/**
 * Public, read-only preview of the founder's match queue.
 *
 * Mounts the real AllocatorMatchQueue with `forceReadOnly` and a public
 * API source, so the friend can watch the full match workflow without
 * any risk of firing real actions (no keyboard shortcuts, no Send Intro,
 * no decisions, no recompute). The URL is intentionally `/demo/founder-view`
 * NOT `/demo/admin` — "admin" in a shareable public URL is a trust-collapse
 * signal when the link gets forwarded to a colleague.
 */

export default function DemoFounderViewPage() {
  return (
    <>
      <PageHeader
        title="Founder view"
        description="Read-only preview of the match queue from the founder's perspective. This is what we use to review, rank, and route intros on behalf of allocators."
      />

      <p className="mb-6 text-sm text-text-muted">
        Back to{" "}
        <Link href="/demo" className="underline hover:text-text-primary">
          the allocator view
        </Link>
        .
      </p>

      <AllocatorMatchQueue
        allocatorId={ALLOCATOR_ACTIVE_ID}
        forceReadOnly
        sourceApiPath="/api/demo/match"
      />
    </>
  );
}
