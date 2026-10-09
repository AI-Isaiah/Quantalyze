import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStrategyDetailV2 } from "@/lib/queries";
import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";
import { readCompositeV2Joint, withV2Joint } from "./composite-joint";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) {
    return { title: "Strategy Not Found | Quantalyze" };
  }
  return {
    title: `${result.strategy.name} — v2 | Quantalyze`,
    description: `${result.strategy.name} — Verified quantitative strategy on Quantalyze.`,
  };
}

/**
 * Skip-link mechanism for the 7-panel scroll.
 *
 * Renders OUTSIDE <StrategyV2Shell> so the links appear at the very top of
 * the route's tab order. Each link targets the matching
 * `<section data-panel id="panel-{key}">` element rendered inside the shell.
 * The CSS in `globals.css` (.strategy-v2-skip-link) keeps them visually
 * hidden until they receive keyboard focus.
 */
const SKIP_LINKS: { href: string; label: string }[] = [
  { href: "#panel-overview", label: "Skip to Overview" },
  { href: "#panel-headline-equity", label: "Skip to Headline metrics" },
  { href: "#panel-drawdown", label: "Skip to Drawdown" },
  { href: "#panel-returns-distribution", label: "Skip to Returns distribution" },
  { href: "#panel-rolling", label: "Skip to Rolling metrics" },
  { href: "#panel-trades", label: "Skip to Trades & positions" },
  { href: "#panel-exposure", label: "Skip to Exposure & greeks" },
];

export default async function StrategyV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) notFound();
  // Phase 170.5 (D-07): a composite's greeks come from the factsheet's own
  // builder, because the light read cannot reach a composite's series. Only a
  // composite pays for the (uncached) build.
  const detail =
    result.panel7Inputs.benchmark_joint?.kind === "needs_builder"
      ? withV2Joint(result, await readCompositeV2Joint(id))
      : result;
  return (
    <>
      <nav aria-label="Page sections" className="strategy-v2-skip-nav">
        {SKIP_LINKS.map((sl) => (
          <a key={sl.href} href={sl.href} className="strategy-v2-skip-link">
            {sl.label}
          </a>
        ))}
      </nav>
      <StrategyV2Shell detail={detail} />
    </>
  );
}
