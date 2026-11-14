import { scrubSharePath } from "@/lib/scrub-share-path";
import { scrubSeamErrorForCapture } from "@/lib/seam-redaction";

// [#15] Env keys whose absence SILENTLY disables a production feature (no other
// loud signal exists). Surfaced once at startup so a missing key is visible in
// the deploy log instead of only when a customer-facing function quietly
// doesn't run — the exact failure mode behind the RESEND_API_KEY founder-LP
// incident. Warn-only: never crash a deploy over a soft-skip key. Keys that
// already fail loudly on their own (e.g. the Upstash limiter, which fail-CLOSEs
// + warns in prod) are intentionally omitted to avoid double-noise.
export const SOFT_SKIP_PROD_KEYS = [
  "RESEND_API_KEY", // email (founder-LP report, alert digests) silently skipped
  "SENTRY_DSN", // error tracking silently off
  "POSTHOG_API_KEY", // admin usage-metrics panel renders empty
  "NEXT_PUBLIC_POSTHOG_KEY", // /for-quants funnel events no-op
] as const;

export function warnUnsetSoftSkipKeys() {
  if (process.env.VERCEL_ENV !== "production") return;
  const unset = SOFT_SKIP_PROD_KEYS.filter((k) => !process.env[k]);
  if (unset.length > 0) {
    console.warn(
      `[startup] soft-skip features DISABLED in production — unset env keys: ${unset.join(", ")}. ` +
        `Set them in Vercel → Settings → Environment Variables if these features should run.`,
    );
  }
}

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
 * WHY STRUCTURAL: the event is handled as `unknown`, not as `@sentry/nextjs`'s
 * `ErrorEvent` / `TransactionEvent`. `@sentry/nextjs` is a DYNAMIC import in
 * this file (it loads only when `SENTRY_DSN` is set), so pulling its types
 * into module scope would add a static type-only dependency for no benefit.
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
    const rootClean = scrubRecordStrings(event, ctx);
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

/**
 * ⚠️ DUPLICATED, ON PURPOSE, AND THE DUPLICATION IS THE LESSER EVIL.
 *
 * The canonical floor is `MIN_SECRET_LENGTH` in `src/lib/strategy-share-token.ts`,
 * which is module-private. It cannot be imported here: that module validates the
 * secret at MODULE SCOPE and THROWS when it is missing, so importing it from the
 * instrumentation boot path would turn this soft, informative check into a crash
 * of the entire `register()` hook — the opposite of what a boot-time diagnostic is
 * for, and it would take the Sentry init down with it in exactly the environment
 * that most needs error reporting.
 *
 * If you change the floor, change BOTH. There is no test that couples them,
 * because writing one requires importing the throwing module.
 */
const SHARE_TOKEN_SECRET_MIN_LENGTH = 32;

/**
 * Phase 164 / D-02, second half — boot-time VISIBILITY for the share secret.
 *
 * The first half is the module-load throw in `src/lib/strategy-share-token.ts`:
 * any route importing the token module fails hard without a valid secret. That
 * is the hard stop, but it only fires when someone REQUESTS a share route. This
 * check fires at process start, so the misconfiguration is in the deploy log
 * before anyone clicks Copy Link — which is the failure class this milestone
 * exists to remove.
 *
 * ⛔ `SHARE_TOKEN_SECRET` is deliberately NOT in `SOFT_SKIP_PROD_KEYS`. That
 * list is documented as warn-only and never-crash-a-deploy; this secret's
 * ruling is the exact opposite (fail LOUD, hard stop at module load). Putting
 * it on the soft list would demote the ruling.
 *
 * Returns the operator message, or `null` when there is nothing to report.
 * Production-only: a local dev box without the var is normal, and the module
 * throw already covers anyone who actually exercises the lane.
 *
 * ⚠️ The message names the variable and its LENGTH — never its value.
 */
export function shareTokenSecretBootError(): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  const secret = process.env.SHARE_TOKEN_SECRET;
  if (secret && secret.length >= SHARE_TOKEN_SECRET_MIN_LENGTH) return null;
  const state = secret
    ? `set but only ${secret.length} characters long`
    : "UNSET";
  return (
    `[startup] SHARE_TOKEN_SECRET is ${state} in production — every strategy ` +
    `share link (mint, revoke and the recipient route) will fail until it is ` +
    `fixed. Remedy: generate a value of at least ${SHARE_TOKEN_SECRET_MIN_LENGTH} ` +
    `characters (\`openssl rand -base64 48\`) and set it in Vercel → Settings → ` +
    `Environment Variables scoped to Production ONLY. Each environment gets a ` +
    `DISTINCT secret. ⚠️ Setting or rotating it invalidates every outstanding ` +
    `share link in that environment.`
  );
}

export async function register() {
  warnUnsetSoftSkipKeys();
  let Sentry: typeof import("@sentry/nextjs") | null = null;
  if (process.env.SENTRY_DSN) {
    Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.VERCEL_ENV ?? "development",
      // Phase 209 / CR-01 (D-17). Sentry 11 defaults to span STREAMING, which
      // never calls `beforeSendTransaction`: streamed spans shipped the raw
      // share token (`http.target`, span names). The scrub below is wired to
      // that hook, so the lifecycle is pinned to the static one. Without this
      // line the next SDK default change silently re-opens the channel.
      traceLifecycle: "static",
      // Phase 209 / CR-02 (D-18). The default Console integration copies every
      // `console.*` call into a breadcrumb on the next captured event, and the
      // seam LOG renderer keeps `details`/`hint` on purpose (D-03). So console
      // crumbs are dropped. The console trail still lives in the Vercel logs.
      // A message-pattern filter was rejected: the raw arguments ride under
      // `data` too.
      beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
      // Phase 164 / SHARE-01 — both hooks, because a share token reaches
      // Sentry by two independent routes: an ERROR event (request.url,
      // breadcrumbs) and a TRANSACTION event (the transaction name and its
      // span descriptions). Wiring only `beforeSend` would leave the tracing
      // channel — sampled at 10% above — leaking on its own schedule.
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
    });
  }

  const shareSecretError = shareTokenSecretBootError();
  if (shareSecretError) {
    // console.error first and unconditionally: it is the channel that works
    // even when Sentry itself is unconfigured, which is a plausible state for
    // a deploy that is already missing an env var.
    console.error(shareSecretError);
    Sentry?.captureMessage(shareSecretError, "error");
  }
}

/**
 * 164.6.5 review round 1 / WR-07 — the wizard's per-page-load id, read off
 * `X-Wizard-Page-Load-Id` (`src/lib/wizard/wizard-correlation.ts`).
 *
 * Plan 07 made the wizard's `X-Correlation-Id` per-REQUEST and moved the
 * stable page-load id onto this header, so this is the one server reader
 * that still lets two failures from one open tab be grouped in Sentry.
 *
 * The value is CLIENT-SUPPLIED, so it is shape-checked before it becomes a
 * tag: the same allowlist `CORRELATION_ID_SHAPE` applies in
 * `src/lib/correlation-id.ts` (no CR, LF, NUL or whitespace). That module is
 * `server-only` and reads `next/headers`, which this hook does not need, so
 * the pattern is restated here rather than imported. Anything else is null,
 * never echoed.
 *
 * ⛔ CORRECTED 2026-09-25 (164.6.5 review round 2 / R2-SFH-11): "anything
 * else is null" is kept above as lineage. An ABSENT header is still `null`
 * (an old bundle that never sends it). A PRESENT header that fails the shape
 * check — empty, whitespace, CR/LF, too long, or an array — is now the fixed
 * sentinel `WIZARD_PAGE_LOAD_ID_MALFORMED`, so Sentry can tell "no header"
 * from "a bad header" (a client bug). The sentinel's angle brackets are
 * outside the shape allowlist, so no client value can ever read as it, and
 * the client's own value is still never echoed.
 */
const WIZARD_PAGE_LOAD_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;
const WIZARD_PAGE_LOAD_ID_MALFORMED = "<malformed>";

/**
 * Next's DOCUMENTED type for an `onRequestError` header value is
 * `string | string[]` (`node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/instrumentation.md`; `NodeJS.Dict<string | string[]>` in
 * `next/dist/server/instrumentation/types.d.ts`). 164.6.5 review round 2 /
 * IN-03: this used to take `string | undefined` and call `.trim()`, so an array
 * would have thrown INSIDE the error hook and lost the capture. Node joins
 * duplicate custom headers into one string, so it did not fire; the narrowed
 * signature is what hid it. An array is not one page-load id, so it is
 * malformed.
 */
function wizardPageLoadIdTag(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return WIZARD_PAGE_LOAD_ID_MALFORMED;
  const trimmed = raw.trim();
  return WIZARD_PAGE_LOAD_ID_SHAPE.test(trimmed)
    ? trimmed
    : WIZARD_PAGE_LOAD_ID_MALFORMED;
}

/**
 * Phase 209 / WR-01. A server reader that does `throw error` on a PostgREST
 * `{ code, message, details, hint }` result throws a PLAIN OBJECT. Next's
 * `getProperError` cannot treat that as an Error (no `name`), so it wraps it as
 * `new Error(JSON.stringify(obj))` and that wrapper reaches `onRequestError`.
 * Its MESSAGE is then the whole row dump, `details` and `hint` included, and
 * `beforeSend` never sees it as a field. So a wrapped plain object is rebuilt
 * here from the capture renderer (no `details`/`hint`), keeping the stack and
 * the digest. Anything that is not such a wrapper is returned untouched.
 */
function scrubWrappedPlainObjectError<E extends { digest?: string }>(error: E): E {
  // Only the exact shape Next produces: a PLAIN `Error` (no subclass, no
  // `cause`) whose message is JSON. A subclass, or an error with a cause, is a
  // real error that happens to start with "{", and rebuilding it would drop its
  // name and cause.
  if (
    !(error instanceof Error) ||
    error.constructor !== Error ||
    error.name !== "Error" ||
    "cause" in error ||
    !error.message.startsWith("{")
  ) {
    return error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    // Not JSON: an ordinary error whose message happens to start with "{".
    return error;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return error;
  }
  // A PostgREST-shaped row has a string `code` or `message`. An arbitrary JSON
  // body (an upstream response, say) does not, and must keep its message.
  const { code, message } = parsed as { code?: unknown; message?: unknown };
  if (typeof code !== "string" && typeof message !== "string") return error;
  // Outside the `try` on purpose: the renderer cannot throw, and a throw here
  // must not fall back to the ORIGINAL error with `details`/`hint` in it.
  const rebuilt = new Error(scrubSeamErrorForCapture(parsed)) as Error & {
    digest?: string;
  };
  rebuilt.stack = error.stack;
  rebuilt.digest = error.digest;
  return rebuilt as unknown as E;
}

export async function onRequestError(
  error: { digest?: string },
  // IN-03 — Next's documented header type, not the narrower
  // `Record<string, string>` this hook used to declare.
  request: { path: string; method: string; headers: NodeJS.Dict<string | string[]> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource: string },
) {
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    const scrubbed = scrubWrappedPlainObjectError(error);
    Sentry.captureException(scrubbed, {
      tags: {
        // WR-12 — say so when the message was rebuilt, so a reader of the issue
        // knows it is not the thrown text.
        ...(scrubbed !== error ? { message_rebuilt: "true" } : {}),
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        // Phase 16 / OBSERV-04 — surface the request-scope correlation_id as
        // a Sentry TAG (queryable in the UI; `extra` is metadata-only).
        //
        // Phase 164: `routePath` needs no scrub and must not get one — Next
        // hands it to us already PARAMETERIZED (`/factsheet-share/[token]`),
        // which is the placeholder shape the scrubber produces anyway. It is
        // `request.path` below that is raw.
        // IN-03 — a tag value must be a primitive, and an array is not one
        // correlation id; only a string header becomes the tag.
        correlation_id:
          typeof request.headers["x-correlation-id"] === "string"
            ? request.headers["x-correlation-id"]
            : null,
        // 164.6.5 / WR-07 — the page-load grain, beside the per-request one.
        wizard_page_load_id: wizardPageLoadIdTag(
          request.headers["x-wizard-page-load-id"],
        ),
      },
      extra: {
        // Phase 164 / SHARE-01 — `request.path` is the RAW request path, so on
        // this route it IS the capability token. Scrubbed at the point of
        // capture rather than relying on `beforeSend` alone: `beforeSend`
        // covers it too (it scrubs `extra`), but a redaction that depends on
        // an SDK hook staying wired is one config edit away from silently
        // ending. Two independent points, deliberately.
        path: scrubSharePath(request.path),
        method: request.method,
        digest: error.digest,
      },
    });
  }
}
