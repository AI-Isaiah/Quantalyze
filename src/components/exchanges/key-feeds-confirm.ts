import type { KeyFeed } from "@/lib/key-feeds";

/**
 * Phase 213 plan 06: the feeds-aware Disconnect confirm's read and wording,
 * extracted byte-for-byte from AllocatorExchangeManager so the Profile key
 * manager and the /strategies "No strategy yet" row's Disconnect confirm share
 * ONE implementation (CONTEXT decision (b): reuse, no second confirm). Nothing
 * here changed in the move; AllocatorExchangeManager's testids and tests are
 * the pin.
 */

export const FEEDS_UNCHECKED_COPY = "Could not check which strategies this key feeds.";
export const FEEDS_UNREADABLE_NAME = "a strategy we could not read";
// Same bound as ApiKeyManager's reads of these two routes.
export const FEEDS_READ_BOUND_MS = 15_000;

/** A `KeyFeed` as the browser accepts it; anything else makes the read fail. */
export function parseKeyFeed(value: unknown): KeyFeed | null {
  if (value === null || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : v === null ? null : undefined);
  const strategy_id = text(f.strategy_id);
  const name = text(f.name);
  const status = text(f.status);
  if (strategy_id === undefined || name === undefined || status === undefined) return null;
  if (f.kind !== "single" && f.kind !== "composite") return null;
  return { strategy_id, name, status, kind: f.kind };
}

/**
 * One bounded GET that never throws. Answers the parsed JSON body, or a
 * `failure` string (a non-2xx answer, a rejected fetch, the bound, a body that
 * is not JSON). The abort also stops a body that never finishes.
 */
export async function readJson(url: string): Promise<{ body: unknown } | { failure: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FEEDS_READ_BOUND_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: abort.signal });
    if (!res.ok) return { failure: `answered HTTP ${res.status}` };
    return { body: (await res.json()) as unknown };
  } catch (err) {
    return { failure: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `feeds` of `GET /api/keys/[id]/memberships` (the ownership-checked read
 * the Disconnect / Delete confirm uses), or "unreadable": a non-2xx answer, a
 * non-JSON body, a missing or malformed `feeds`, a rejected fetch or the bound.
 * Never throws.
 */
export async function readKeyFeedsForConfirm(keyId: string): Promise<KeyFeed[] | "unreadable"> {
  const answer = await readJson(`/api/keys/${encodeURIComponent(keyId)}/memberships`);
  let failure: string;
  if ("failure" in answer) {
    failure = `the membership read ${answer.failure}`;
  } else {
    const list =
      answer.body !== null && typeof answer.body === "object"
        ? (answer.body as { feeds?: unknown }).feeds
        : undefined;
    const parsed = Array.isArray(list) ? list.map(parseKeyFeed) : null;
    if (parsed !== null && !parsed.includes(null)) return parsed as KeyFeed[];
    failure = "the membership answer carried no well-formed feeds array";
  }
  console.error("[AllocatorExchangeManager] feeds read before a disconnect failed; the confirm says it could not check:", failure);
  return "unreadable";
}

export type DeleteFeedsState =
  | { state: "checking" }
  | { state: "unchecked" }
  | { state: "ok"; feeds: KeyFeed[] };

/**
 * What the Disconnect / Delete confirm says about the fed strategies. The two
 * actions differ, so the wording follows the action: a Disconnect keeps the key
 * and its links (neutral naming), a hard delete (the cascade box ticked) removes
 * the key, so a single-key strategy loses its key and a composite loses this
 * member. A failed read says it could not check.
 */
export function deleteFeedsNote(check: DeleteFeedsState, hardDelete: boolean): { text: string; tone: "muted" | "warning" } {
  if (check.state === "checking") {
    return { text: "Checking which strategies this key feeds…", tone: "muted" };
  }
  if (check.state === "unchecked") {
    return { text: FEEDS_UNCHECKED_COPY, tone: "warning" };
  }
  if (check.feeds.length === 0) {
    return { text: "This key feeds no strategy.", tone: "muted" };
  }
  const nameOf = (f: KeyFeed) =>
    f.name !== null && f.name.trim() !== "" ? f.name : FEEDS_UNREADABLE_NAME;
  if (!hardDelete) {
    return { text: `This key feeds: ${check.feeds.map(nameOf).join(", ")}.`, tone: "muted" };
  }
  const losses = check.feeds
    .map((f) => `${nameOf(f)} ${f.kind === "single" ? "loses its key" : "loses this member"}`)
    .join("; ");
  return { text: `Deleting this key: ${losses}.`, tone: "warning" };
}
