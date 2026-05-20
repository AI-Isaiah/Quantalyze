import Link from "next/link";

/**
 * Strategy not published / unavailable / analytics not yet computed.
 */
export default function FactsheetV2NotFound() {
  return (
    <article className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-text-muted">
        Institutional Factsheet · Not available
      </p>
      <h1 className="mt-2 font-serif text-3xl text-text-primary">
        This factsheet isn&apos;t available
      </h1>
      <p className="mt-4 text-text-2">
        The strategy may not be published yet, may have been removed, or its analytics
        compute may not have finished.
      </p>
      <p className="mt-2 text-text-2">
        If you expect this strategy to be live, check that it has a recent
        <code className="mx-1 font-mono text-[12px]">strategy_analytics</code>
        row with daily returns.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/discovery"
          className="px-4 py-2 text-sm rounded-md bg-accent text-white hover:bg-accent-hover"
        >
          Browse published strategies
        </Link>
      </div>
    </article>
  );
}
