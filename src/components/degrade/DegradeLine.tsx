import Link from "next/link";
import type { ReactNode } from "react";
import { ExchangesPageLink } from "@/app/(dashboard)/allocations/components/EquityHistoryRebuilding";
import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { contactHref } from "@/lib/contact";
import {
  ACTION_SENTENCES,
  type ActionId,
  type DegradeId,
  type DegradeSegment,
} from "@/lib/degrade-warnings";

/**
 * Phase 199 plan 03 (D-04, CD-05) — renders one registry entry's segments.
 *
 * `id` is the registry id and is written to `data-degrade-id`, the marker the
 * scan test uses to attribute a render site to its entry. `segments` come from
 * `degradeSegments(id, args)`; this component never composes copy itself.
 *
 *   - a string renders as text (React text nodes, never markup);
 *   - `{ label }` is a key label: semibold `text-text-primary` (600 weight, the
 *     one key-label look, as `MissingDataMessage`);
 *   - `{ action }` renders the vocabulary sentence, with the link its kind names:
 *     exchanges → `ExchangesPageLink`, contact → `ContactPointerText`, edit → a
 *     link to the strategy's edit page (needs `strategyId`), csv → the shipped CSV
 *     wizard link. `deselect` renders as plain text until the Scenario plan wires
 *     its handler. A link kind that cannot be built (edit with no strategy id)
 *     falls back to plain text rather than a dead link.
 *
 * No client directive and no data fetch: usable from server and client trees.
 */
export function DegradeLine({
  id,
  segments,
  element: Tag = "span",
  className,
}: {
  id: DegradeId;
  segments: readonly DegradeSegment[];
  element?: "span" | "p" | "div";
  className?: string;
}) {
  return (
    <Tag data-degrade-id={id} className={className}>
      {segments.map((segment, i) => (
        <Segment key={i} segment={segment} />
      ))}
    </Tag>
  );
}

function Segment({ segment }: { segment: DegradeSegment }): ReactNode {
  if (typeof segment === "string") return segment;
  if ("label" in segment) {
    return (
      <span className="font-semibold text-text-primary">{segment.label}</span>
    );
  }
  return <Action id={segment.action} strategyId={segment.strategyId} />;
}

function Action({ id, strategyId }: { id: ActionId; strategyId?: string }) {
  const action = ACTION_SENTENCES[id];
  const { sentence } = action;
  switch (action.link) {
    case "exchanges":
      return <LinkedPhrase sentence={sentence} phrase={action.phrase} link={<ExchangesPageLink />} />;
    case "contact":
      return (
        <ContactPointerText
          text={sentence}
          href={contactHref({ topic: "support", strategy: strategyId })}
        />
      );
    case "edit":
      if (!strategyId) return <>{sentence}</>;
      return (
        <LinkedPhrase
          sentence={sentence}
          phrase={action.phrase}
          link={
            <Link
              href={`/strategies/${encodeURIComponent(strategyId)}/edit`}
              className="text-accent underline underline-offset-4"
            >
              {action.phrase}
            </Link>
          }
        />
      );
    case "csv":
      return (
        <LinkedPhrase
          sentence={sentence}
          phrase={action.phrase}
          link={
            <Link
              href="/strategies/new/wizard?source=csv"
              className="text-accent underline underline-offset-4"
            >
              {action.phrase}
            </Link>
          }
        />
      );
    case "deselect":
    case "none":
      return <>{sentence}</>;
  }
}

/**
 * The sentence with its first occurrence of `phrase` swapped for `link`. The
 * link component renders the phrase itself (`ExchangesPageLink` prints
 * "Exchanges page"), so the text around it is kept character for character.
 */
function LinkedPhrase({
  sentence,
  phrase,
  link,
}: {
  sentence: string;
  phrase: string;
  link: ReactNode;
}) {
  const at = sentence.indexOf(phrase);
  if (at === -1) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      {link}
      {sentence.slice(at + phrase.length)}
    </>
  );
}
