import { scrubSharePath } from "@/lib/scrub-share-path";

// Phase 221 SENTRYSCRUB2 — the one Sentry event scrub, for every runtime.
//
// This module holds `scrubSentryEvent` and its private helpers, moved here from
// `src/instrumentation.ts` so that ONE function serves every runtime that
// initialises Sentry: the server `register()` imports it today, and a browser
// init may import it unchanged (CONTEXT [Code layout]: one scrub, never a copy
// that drifts).
//
// That makes it browser-reachable, so it must NEVER import the server-only
// marker module, anything under `next/`, a Node built-in or the Sentry SDK (a
// type-only import included), and it must have no module-scope side effects.
// Its only import is `scrubSharePath`, which itself imports nothing. Only
// `scrubSentryEvent` is exported; every helper stays module-private.

// ---------------------------------------------------------------------------
// Phase 164 / SHARE-01 — keep the recipient capability token out of Sentry.
// ---------------------------------------------------------------------------

/**
 * The fixed message a replacement event carries when a share token could not
 * be removed from the original in place and nothing up to the event root was
 * writable. It contains spaces, so it can never read as a 43-character token.
 */
const SENTRY_WITHHELD_EVENT_MESSAGE = "[beforeSend] event content withheld: a share token could not be removed in place";

/**
 * The fixed message for the OTHER way a replacement event comes about: the walk
 * itself threw (a bug, or a shape the guards cannot see), which says nothing
 * about a token. Kept distinct so a scrub bug cannot pass for a token case.
 */
const SENTRY_WITHHELD_CAUGHT_MESSAGE = "[beforeSend] event content withheld: the scrub itself failed";

type WithheldReason = "root" | "caught";

type SlotRead = { ok: true; value: unknown } | { ok: false };

/**
 * Read `holder[key]` without ever throwing. A throwing getter or a hostile
 * Proxy yields `{ ok: false }`; the caller treats an unreadable slot as dirty.
 */
function guardedRead(holder: unknown, key: string | number): SlotRead {
  try {
    return { ok: true, value: (holder as Record<string | number, unknown>)[key] };
  } catch {
    return { ok: false };
  }
}

/**
 * Scrub one string slot. Returns whether the slot is clean afterwards.
 *
 * Writes ONLY when `scrubSharePath` changed the string, so a frozen object
 * holding no token is left untouched (D-06). A completed write is read back:
 * a setter that swallows the assignment, or a sloppy-mode silent failure,
 * would otherwise pass for a scrubbed slot while the token is still there
 * (D-07).
 */
function scrubSlot(holder: unknown, key: string | number): boolean {
  const read = guardedRead(holder, key);
  if (!read.ok) return false;
  if (typeof read.value !== "string") return true;
  const next = scrubSharePath(read.value);
  if (next === read.value) return true;
  try {
    (holder as Record<string | number, unknown>)[key] = next;
  } catch {
    return false;
  }
  const back = guardedRead(holder, key);
  return back.ok && back.value === next;
}

/**
 * The one key a rebuilt object carries so a reader of the Sentry event can see
 * that its content was reconstructed, not delivered as captured. A string
 * value, because a tag value must be a string.
 */
const SCRUB_REBUILT_MARKER_KEY = "scrub_rebuilt";

/**
 * What the walk knows about the event it is cleaning, for the content-free log
 * line a rebuild writes (Phase 209 / WR-11): the event id, and the top-level
 * channel (`tags`, `extra`, `breadcrumbs`, ...) the rebuild happened under.
 * Neither carries event content.
 */
type WalkContext = { eventId: string | null; channel: string | null };

/**
 * A fresh, fully scrubbed copy of `source`, built only from reads that
 * succeed: every readable string goes through `scrubSharePath`, a slot whose
 * read throws is OMITTED, and nested objects and arrays are copied the same
 * way. The copy shares no frozen or getter-only state with the original, so it
 * is always writable and can carry no token that `scrubSharePath` can find.
 * Past the depth cap a nested value is dropped rather than copied unscrubbed.
 * Every omission (an unreadable key, a depth drop, a throwing `ownKeys`) is
 * counted in `tally`, so the caller can say how much the copy lost.
 */
function rebuildScrubbed(
  source: unknown,
  depth: number,
  tally: { omitted: number },
): unknown {
  let isArray = false;
  let keys: string[] = [];
  try {
    isArray = Array.isArray(source);
    keys = Object.keys(source as object);
  } catch {
    // A revoked Proxy: nothing readable, so an empty shell.
    tally.omitted++;
  }
  const out: Record<string, unknown> = isArray
    ? ([] as unknown as Record<string, unknown>)
    : {};
  for (const key of keys) {
    const read = guardedRead(source, key);
    if (!read.ok) {
      tally.omitted++;
      continue;
    }
    const value = read.value;
    if (typeof value === "string") out[key] = scrubSharePath(value);
    else if (value !== null && typeof value === "object") {
      if (depth < 8) out[key] = rebuildScrubbed(value, depth + 1, tally);
      else tally.omitted++;
    } else out[key] = value;
  }
  return out;
}

/**
 * Replace `parent[key]` with a scrubbed REBUILD of what it held (Phase 209 /
 * WR-06), not an empty value: a container that could not be cleaned in place
 * used to be wiped whole, so one stuck tag took every alert-routing tag with
 * it. An unreadable slot has nothing to rebuild and becomes an empty object.
 * An object carries `SCRUB_REBUILT_MARKER_KEY`, whose value is how much the
 * rebuild omitted ("0" when nothing, else "omitted=N"; WR-11); an array keeps
 * its shape so the event stays structurally valid for ingest. Verified by
 * reading it back, and returns whether the replacement took.
 */
function withholdSlot(
  parent: unknown,
  key: string | number,
  child: unknown,
  ctx: WalkContext,
): boolean {
  const tally = { omitted: 0 };
  let fresh: unknown;
  if (child === undefined) {
    fresh = {};
    tally.omitted++;
  } else {
    fresh = rebuildScrubbed(child, 0, tally);
  }
  if (!Array.isArray(fresh)) {
    (fresh as Record<string, unknown>)[SCRUB_REBUILT_MARKER_KEY] =
      tally.omitted === 0 ? "0" : `omitted=${tally.omitted}`;
  }
  try {
    (parent as Record<string | number, unknown>)[key] = fresh;
  } catch {
    return false;
  }
  const back = guardedRead(parent, key);
  if (!(back.ok && back.value === fresh)) return false;
  // Content-free on purpose: the event id, the top-level channel and a count,
  // never a nested key or a value.
  console.error("[beforeSend] an unscrubbable value was rebuilt in place", {
    event_id: ctx.eventId,
    channel: ctx.channel,
    omitted: tally.omitted,
  });
  return true;
}

/**
 * Clean the object at `parent[key]`, or rebuild it at THIS parent when it
 * cannot be cleaned. Returns false only when the rebuild could not be written
 * either, which escalates the problem one level up (D-08: the nearest writable
 * parent). A child that is not an object has nothing to walk; string slots are
 * `scrubSlot`'s job.
 */
function cleanOrWithhold(
  parent: unknown,
  key: string | number,
  ctx: WalkContext,
  clean: (child: unknown) => boolean,
): boolean {
  const read = guardedRead(parent, key);
  if (!read.ok) return withholdSlot(parent, key, undefined, ctx);
  const child = read.value;
  if (child === null || typeof child !== "object") return true;
  if (clean(child)) return true;
  return withholdSlot(parent, key, child, ctx);
}

/** The two PostgREST error fields that never ride a Sentry event (SCRB-01). */
const POSTGREST_DROP_KEYS = ["details", "hint"] as const;

/**
 * How many levels below `extra.__serialized__` the arm walks. The SDK
 * normalises a captured object to depth 3 (`normalizeToSize`), so anything
 * deeper is already the string "[Object]" and holds no key to drop.
 */
const POSTGREST_DROP_MAX_DEPTH = 3;

/**
 * Delete `details` and `hint` from `target` and from every nested object under
 * it, down to `POSTGREST_DROP_MAX_DEPTH`, never throwing. A key whose read
 * yields `undefined` has nothing to drop and is not written to. Otherwise the
 * `delete` is attempted (also when the read threw) and the key is read back.
 * Returns false when either key is still present or unreadable afterwards, or
 * when a nested slot could not be read or walked (fail closed: the caller then
 * rebuilds this object, which omits what it cannot read).
 */
function dropDetailsAndHint(target: unknown, depth = 0): boolean {
  let clean = true;
  for (const key of POSTGREST_DROP_KEYS) {
    const read = guardedRead(target, key);
    if (read.ok && read.value === undefined) continue;
    try {
      delete (target as Record<string, unknown>)[key];
    } catch {
      // Frozen, sealed or non-configurable: the read-back below decides.
    }
    const back = guardedRead(target, key);
    if (!(back.ok && back.value === undefined)) clean = false;
  }
  if (depth >= POSTGREST_DROP_MAX_DEPTH) return clean;
  let keys: string[];
  try {
    // A Proxy `ownKeys` trap can throw.
    keys = Object.keys(target as object);
  } catch {
    return false;
  }
  for (const key of keys) {
    const read = guardedRead(target, key);
    if (!read.ok) {
      clean = false;
    } else if (
      read.value !== null &&
      typeof read.value === "object" &&
      !dropDetailsAndHint(read.value, depth + 1)
    ) {
      clean = false;
    }
  }
  return clean;
}

/**
 * Phase 221 / SCRB-01, CONTEXT [Scrub placement]. Drops `details` and `hint`
 * from `event.extra.__serialized__`: the SDK writes a non-Error capture (a
 * PostgREST `{ code, message, details, hint }` object passed straight to
 * `Sentry.captureException`) there whole, and the direct capture sites bypass
 * `scrubCaptureInput`. It mirrors `scrubSeamErrorForCapture`, which omits the
 * same two keys.
 *
 * ⛔ CORRECTED 2026-11-27 (Phase 221 round 1 / WR-02): this docblock said the
 * drop was TOP LEVEL only and that a wrapped PostgREST object was Phase 247
 * SENTRYHELD's. Phase 247 owns two callers and no part of this event shape, and
 * a browser unhandled rejection wrapping `{ error: { details } }` has no call
 * site to fix. The arm now walks nested objects too, down to
 * `POSTGREST_DROP_MAX_DEPTH` (the SDK's own normalise depth). Still not covered:
 * `details` passed in a caller's own `extra`, which is not under
 * `__serialized__`.
 *
 * Never throws and never leaves a key behind it could not verify gone: a slot
 * that cannot be cleaned in place is rebuilt at the nearest writable parent
 * (`__serialized__` at `extra`, else `extra` at the event), and the settle read
 * at the end drops the two keys again from the rebuilt copy, because
 * `rebuildScrubbed` copies every readable key. Returns false only when nothing
 * up to the event root is writable; the existing root-withheld replacement then
 * ships, and its marker message names a share token. That wording is an accepted
 * residual, because an SDK-built event is a fresh mutable object and a frozen
 * root is a test-only shape.
 */
function dropPostgrestFields(event: unknown, ctx: WalkContext): boolean {
  ctx.channel = "extra";
  try {
    const extraRead = guardedRead(event, "extra");
    // An unreadable `extra` is left to the walk, which marks the key dirty and
    // withholds at the root (today's behaviour for a throwing getter).
    if (!extraRead.ok) return true;
    const extra = extraRead.value;
    if (extra === null || typeof extra !== "object") return true;
    if (!cleanOrWithhold(extra, "__serialized__", ctx, dropDetailsAndHint)) {
      // `extra` itself is not writable: rebuild it at the event.
      if (!withholdSlot(event, "extra", extra, ctx)) return false;
    }
    // Settle: whatever sits at `extra.__serialized__` now, a rebuilt copy
    // included, must hold neither key.
    const settledExtra = guardedRead(event, "extra");
    if (!settledExtra.ok) return false;
    if (settledExtra.value === null || typeof settledExtra.value !== "object") return true;
    const settled = guardedRead(settledExtra.value, "__serialized__");
    if (!settled.ok) return false;
    if (settled.value === null || typeof settled.value !== "object") return true;
    return dropDetailsAndHint(settled.value);
  } finally {
    // The walk sets the channel per top-level key.
    ctx.channel = null;
  }
}

/**
 * Phase 209 / IN-05. The keys of the event's `sdkProcessingMetadata` that hold
 * LIVE SDK objects (a `Scope` whose `_client` is the running client, about 300
 * nodes deep). With `traceLifecycle: "static"` a transaction carries them, and
 * the SDK deletes `sdkProcessingMetadata` before it serialises the envelope, so
 * scrubbing them buys nothing while a write or a rebuild would corrupt live
 * state. Only these two are skipped, and only at that one path:
 * `dynamicSamplingContext` is still walked because it feeds the envelope
 * header's `trace` block.
 */
const SDK_LIVE_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "capturedSpanScope",
  "capturedSpanIsolationScope",
]);

/**
 * Scrub every string ANYWHERE inside a loose value, in place — nested objects
 * and arrays included. Non-strings untouched. Returns whether the whole
 * subtree is clean: false means something could be neither cleaned nor
 * verified (a frozen or getter-only slot holding a token, an unreadable
 * getter), and the caller then withholds this record at ITS parent.
 *
 * ⛔ THE SHALLOW VERSION LEAKED A LIVE TOKEN, MEASURED. This walked only the
 * top level and scrubbed `typeof value === "string"`, so any string one level
 * down survived. Captured off the wire from a real production build
 * (/qa 2026-08-28), driving a genuine 500 on `/factsheet-share/<token>` into a
 * local Sentry ingest and reading the transmitted bytes:
 *
 *     contexts.trace.data.http.target  /factsheet-share/QAuatNINEzzzz…  <- RAW
 *     contexts.trace.data.http.route   /factsheet-share/[token]         <- ok
 *
 * `http.target` is the OpenTelemetry semantic convention for the raw request
 * target, and Next's instrumentation sets it. `contexts.trace.data` is an
 * object, so the shallow walk skipped the whole subtree while `request.url`,
 * `transaction`, `extra.path` and `spans[].description` were all correctly
 * scrubbed one field away.
 *
 * ⚠️ Enumerating fields is what failed here, twice — `tags` was the first miss,
 * also found in production. So this recurses instead of naming more paths: a
 * future SDK version that adds another nested URL field is covered without an
 * edit. Depth is capped because `beforeSend` must never throw (a throw there
 * drops the event); 8 is far past any real Sentry event shape.
 *
 * Phase 209 / SC2: the walk itself is now total. Every read is guarded, every
 * write is verified, and a throw can no longer escape it (a frozen object used
 * to throw out of here and lose the whole report).
 */
function scrubRecordStrings(
  record: unknown,
  ctx: WalkContext,
  depth = 0,
  skip?: ReadonlySet<string>,
): boolean {
  if (record == null || typeof record !== "object" || depth > 8) return true;
  let clean = true;
  const scrubChild = (key: string | number): void => {
    if (skip?.has(String(key))) return;
    if (depth === 0) ctx.channel = scrubSharePath(String(key));
    const read = guardedRead(record, key);
    if (!read.ok) {
      clean = false;
      return;
    }
    if (typeof read.value === "string") {
      if (!scrubSlot(record, key)) clean = false;
    } else if (
      !cleanOrWithhold(record, key, ctx, (child) =>
        scrubRecordStrings(
          child,
          ctx,
          depth + 1,
          depth === 0 && key === "sdkProcessingMetadata"
            ? SDK_LIVE_OBJECT_KEYS
            : undefined,
        ),
      )
    ) {
      clean = false;
    }
  };
  if (Array.isArray(record)) {
    const length = guardedRead(record, "length");
    if (!length.ok || typeof length.value !== "number") return false;
    for (let i = 0; i < length.value; i++) scrubChild(i);
    return clean;
  }
  let keys: string[];
  try {
    // A Proxy `ownKeys` trap can throw.
    keys = Object.keys(record);
  } catch {
    return false;
  }
  for (const key of keys) scrubChild(key);
  return clean;
}

/**
 * The minimal event delivered when a share token could not be removed from the
 * original anywhere up to the event root, or when the walk itself threw. It
 * carries a fixed marker message per `reason`, a short allow-list of
 * content-free scalars, the exception TYPE, a reason tag and a fingerprint, and
 * nothing else: no message, exception value, breadcrumb, request, extra or
 * original tag content. For the `caught` reason `thrown` is the CLASS NAME of
 * what threw (Phase 209 / WR-10), so a scrub bug is findable; it carries no
 * message and no content.
 *
 * `type` is copied because the SDK takes the envelope item type from the
 * RETURNED object: a replacement from `beforeSendTransaction` that lost its
 * `type: "transaction"` would ship as a spurious error issue.
 */
function buildWithheldEvent(
  source: unknown,
  reason: WithheldReason,
  thrown?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    message:
      reason === "root"
        ? SENTRY_WITHHELD_EVENT_MESSAGE
        : SENTRY_WITHHELD_CAUGHT_MESSAGE,
  };
  const copy = (key: string): void => {
    const read = guardedRead(source, key);
    if (!read.ok) return;
    if (typeof read.value === "number") out[key] = read.value;
    else if (typeof read.value === "string") out[key] = scrubSharePath(read.value);
  };
  for (const key of [
    "event_id",
    "timestamp",
    "level",
    "platform",
    "environment",
    "release",
    "type",
  ]) {
    copy(key);
  }
  // The exception TYPE only (a short class name, through the share-path scrub):
  // it is what tells two withheld errors apart, and it never carries a value.
  const exception = guardedRead(source, "exception");
  const values = exception.ok ? guardedRead(exception.value, "values") : null;
  const first = values?.ok ? guardedRead(values.value, 0) : null;
  const typeRead = first?.ok ? guardedRead(first.value, "type") : null;
  const excType =
    typeRead?.ok && typeof typeRead.value === "string"
      ? scrubSharePath(typeRead.value)
      : null;
  if (excType !== null) out.exception = { values: [{ type: excType }] };
  // A reason tag and a fingerprint, so withheld errors neither read as one
  // anonymous constant nor group into a single Sentry issue across causes.
  out.tags = {
    scrub_withheld: reason,
    ...(thrown !== undefined ? { scrub_error: thrown } : {}),
  };
  out.fingerprint =
    excType !== null
      ? ["beforeSend-withheld", reason, excType]
      : ["beforeSend-withheld", reason];
  // Content-free: the event id and the reason, nothing from the event body.
  console.error("[beforeSend] withheld event", {
    event_id: typeof out.event_id === "string" ? out.event_id : null,
    reason,
    ...(thrown !== undefined ? { error: thrown } : {}),
  });
  if (out.type === "transaction") {
    copy("start_timestamp");
    const contexts = guardedRead(source, "contexts");
    const trace = contexts.ok ? guardedRead(contexts.value, "trace") : null;
    const traceId = trace?.ok ? guardedRead(trace.value, "trace_id") : null;
    const spanId = trace?.ok ? guardedRead(trace.value, "span_id") : null;
    if (
      traceId?.ok &&
      spanId?.ok &&
      typeof traceId.value === "string" &&
      typeof spanId.value === "string"
    ) {
      out.contexts = {
        trace: { trace_id: traceId.value, span_id: spanId.value },
      };
    }
  }
  return out;
}

/**
 * Route every URL-shaped field of a Sentry event through the share-path
 * scrubber, in place, and return the event.
 *
 * ⛔ THIS IS THE ONLY REDACTION POINT FOR THE SHARE TOKEN ON THE SENTRY
 * CHANNEL, and it is net-new: there was no `beforeSend`, `beforeBreadcrumb` or
 * any other scrub anywhere in `src/` before phase 164. Under ruling D-01 the
 * token is a PATH SEGMENT, so it rides `request.url`, the transaction name,
 * breadcrumb messages and span descriptions — all of which Sentry sends to a
 * third-party event store.
 *
 * ⛔ SENTRY IS SERVER-ONLY IN THIS REPO. There is no client `Sentry.init` (no
 * `sentry.client.config.*`, no browser bundle initialisation) — verified at
 * phase 164. **Introducing one RE-OPENS the browser channel**: client-side
 * breadcrumbs record `location.href` on every navigation, and Session Replay
 * records the URL bar outright. A client init MUST adopt this same
 * `beforeSend` (and Replay's own URL masking) or the token leaks by a route
 * this function never sees. Do not add one without doing that.
 *
 * ⛔ CORRECTED 2026-11-27 (Phase 221 SENTRYSCRUB2, SCRB-02): a client init now exists.
 * `src/instrumentation-client.ts` runs this same function as `beforeSend` and
 * `beforeSendTransaction`. Replay and browser tracing are off, session envelopes
 * are filtered out, and `dataCollection` drops every URL query.
 * `src/instrumentation-client.test.ts` pins the identity. The paragraph above is
 * kept as lineage and its rule still binds any future browser integration: each
 * one needs its own scrub proof.
 *
 * WHY STRUCTURAL: the event is handled as `unknown`, not as `@sentry/nextjs`'s
 * `ErrorEvent` / `TransactionEvent`. `@sentry/nextjs` is a DYNAMIC import in
 * this file (it loads only when `SENTRY_DSN` is set), so pulling its types
 * into module scope would add a static type-only dependency for no benefit.
 *
 * ⛔ CORRECTED 2026-11-27 (Phase 221 SENTRYSCRUB2): this function moved here
 * from `src/instrumentation.ts`. "This file" in the paragraph above means
 * `src/instrumentation.ts`, which still loads `@sentry/nextjs` dynamically; this
 * module imports no SDK at all. The paragraph is kept as lineage.
 *
 * CONTRACT (Phase 209 / SC2, corrected — an earlier version promised that a
 * shape change "degrades to an unscrubbed field and never to a throw", which
 * was false: a frozen object threw and the SDK drops the event when
 * `beforeSend` throws). Every read and every write is guarded. A string is
 * written only when scrubbing changed it, and each write is read back. EVERY
 * top-level key of the event is walked (strings and nested values alike), so no
 * channel is exempt by omission. A token that cannot be removed in place is
 * rebuilt: its containing value is replaced, at the nearest writable parent,
 * by a scrubbed copy of every readable entry (unreadable keys omitted, objects
 * marked with `scrub_rebuilt`), and a content-free line is logged. When
 * nothing up to the root is writable, a minimal replacement event carrying
 * `SENTRY_WITHHELD_EVENT_MESSAGE` is returned instead of `null`. The original
 * event is never returned unscrubbed, and a report is never lost.
 *
 * The mutation is deliberate — Sentry's `beforeSend` contract is "return the
 * event (possibly modified) or null to drop it", and cloning a large event on
 * every error would be waste for no gain. The replacement event is the one
 * case where a different object comes back.
 */
export function scrubSentryEvent<T>(event: T): T {
  if (event === null || typeof event !== "object") return event;
  try {
    // ONE guarded walk of every top-level key, not a list of named channels.
    // The named-channel version missed `request.headers`, `request.data`,
    // `exception.values[].value`, `message`, `user`, `fingerprint` and every
    // `contexts` entry but `trace` (Phase 209 / WR-02), the same
    // enumerate-the-fields failure the `scrubRecordStrings` docblock records.
    // The SDK's own `url` tag (QUANTALYZE-16) and `contexts.trace.data.http.target`
    // (/qa 2026-08-28) are covered by this walk too, not by a line of their own.
    const eventId = guardedRead(event, "event_id");
    const ctx: WalkContext = {
      eventId: eventId.ok && typeof eventId.value === "string" ? eventId.value : null,
      channel: null,
    };
    // Phase 221 / SCRB-01: before the walk, so the walk then scrubs whatever
    // this arm rebuilt for share tokens too.
    const armClean = dropPostgrestFields(event, ctx);
    const rootClean = scrubRecordStrings(event, ctx) && armClean;
    return rootClean
      ? event
      : (buildWithheldEvent(event, "root") as unknown as T);
  } catch (err) {
    // Last resort for what the guards cannot see (for example
    // `Array.isArray` on a revoked Proxy throws). Still a delivered event.
    // The class name of what threw rides into the replacement and the log
    // line (WR-10): without it a future bug in the walk would degrade every
    // event to the same anonymous marker and nothing would say why.
    return buildWithheldEvent(
      event,
      "caught",
      scrubSharePath(err instanceof Error ? err.name : typeof err),
    ) as unknown as T;
  }
}
