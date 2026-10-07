/**
 * Phase 164.6.6.3.5 DOMAINONE — the one contract module for the /contact form.
 *
 * Every page, client component and route that links to, renders or accepts a
 * contact message imports its paths, topics, labels, sources and href builder
 * from here, so no surface types `/contact?topic=…` or a topic list by hand.
 *
 * ⛔ CONTACT_TOPICS and CONTACT_SOURCES equal the CHECK lists on
 * `for_quants_leads` (`for_quants_leads_topic_check`,
 * `for_quants_leads_source_check`, migration 20261008120000). The two are
 * hand-typed in separate languages, so
 * src/__tests__/contact-topics-migration-parity.test.ts pins them; add a value to
 * one side and that test is red until the other side moves.
 *
 * Labels and the link text are copied verbatim from 164.6.6.3.5-UI-SPEC.md
 * (Topic options, New shared pieces) and pinned by contact.test.ts.
 *
 * No `server-only` and no `"use client"`: server pages, client components and API
 * routes all import this file, so it carries no runtime dependency.
 */

/** The one contact page. */
export const CONTACT_PATH = "/contact";

/** The topics a contact message can carry, in the UI-SPEC select order. */
export const CONTACT_TOPICS = [
  "general",
  "support",
  "security",
  "privacy",
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** The Topic select's option labels, verbatim from the UI-SPEC. */
export const CONTACT_TOPIC_LABELS = {
  general: "General question",
  support: "Account or strategy support",
  security: "Security report",
  privacy: "Privacy or data request",
} as const satisfies Record<ContactTopic, string>;

/**
 * Which form wrote a `for_quants_leads` row. `request_call` rows are
 * deduplicated per email per UTC day; `contact_form` rows never are.
 */
export const CONTACT_SOURCES = ["request_call", "contact_form"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/**
 * The exact substring every pointer sentence contains and the renderer links.
 */
export const CONTACT_FORM_LINK_TEXT = "contact form";

/**
 * The prefill fence (D-02): an id from a link is accepted only in this shape.
 * Same charset `/api/for-quants-lead` enforces on `wizard_session_id`; UUIDs and
 * `cid-…` tokens match.
 */
export const CONTACT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The `reference` column's length cap (`for_quants_leads_reference_len_check`).
 * parseContactPrefill never composes a longer string.
 */
export const CONTACT_REFERENCE_MAX = 200;

type MaybeValue = string | null | undefined;

/**
 * The ONE builder of every pointer href. Query keys are exactly `topic`, `ref`,
 * `draft`, `strategy`, in that order. A value that is undefined, null or empty
 * is omitted, never sent empty. Values are `encodeURIComponent`ed, so a pointer
 * can never smuggle in a second parameter.
 */
export function contactHref(params: {
  topic: ContactTopic;
  ref?: MaybeValue;
  draft?: MaybeValue;
  strategy?: MaybeValue;
}): string {
  const pairs: Array<[string, MaybeValue]> = [
    ["topic", params.topic],
    ["ref", params.ref],
    ["draft", params.draft],
    ["strategy", params.strategy],
  ];
  const query = pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join("&");
  return `${CONTACT_PATH}?${query}`;
}

/** The raw shape Next.js hands a page for each query key. */
type RawParam = string | string[] | undefined;

export interface ContactPrefill {
  /** A valid topic, else `general`. */
  topic: ContactTopic;
  /** Each id, only when it passed the fence; otherwise undefined. */
  ref: string | undefined;
  draft: string | undefined;
  strategy: string | undefined;
  /**
   * The Reference field's initial value: `<ref>`, `draft <draft>`,
   * `strategy <strategy>`, single-space separated, only the present parts.
   * Empty string when nothing valid arrived.
   */
  reference: string;
}

function acceptId(raw: RawParam): string | undefined {
  // A repeated query key arrives as an array: treat it as absent, never as the
  // first (or last) of several.
  if (typeof raw !== "string") return undefined;
  return CONTACT_ID_RE.test(raw) ? raw : undefined;
}

/**
 * Validate the raw searchParams of /contact. A value that fails its fence is
 * dropped silently (nothing is echoed), which keeps the page from reflecting
 * arbitrary text from a link.
 *
 * Three ids of the maximum 64 characters would compose to more than the 200
 * characters `for_quants_leads_reference_len_check` allows, so a later part that
 * would overflow is dropped rather than truncated mid-id: a clipped id points at
 * nothing, and the field stays editable for a paste.
 */
export function parseContactPrefill(raw: {
  topic?: RawParam;
  ref?: RawParam;
  draft?: RawParam;
  strategy?: RawParam;
}): ContactPrefill {
  const topic = (CONTACT_TOPICS as readonly string[]).includes(
    typeof raw.topic === "string" ? raw.topic : "",
  )
    ? (raw.topic as ContactTopic)
    : "general";

  const ref = acceptId(raw.ref);
  const draft = acceptId(raw.draft);
  const strategy = acceptId(raw.strategy);

  const parts: string[] = [];
  let length = 0;
  for (const part of [
    ref,
    draft === undefined ? undefined : `draft ${draft}`,
    strategy === undefined ? undefined : `strategy ${strategy}`,
  ]) {
    if (part === undefined) continue;
    const next = length === 0 ? part.length : length + 1 + part.length;
    if (next > CONTACT_REFERENCE_MAX) continue;
    parts.push(part);
    length = next;
  }

  return { topic, ref, draft, strategy, reference: parts.join(" ") };
}
