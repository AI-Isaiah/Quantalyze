/**
 * Phase 140.2 / SEAMCORE-06 — the ONE secret-redaction leaf for the
 * Vercel → Railway seam.
 *
 * WHAT IT REPLACES. `finalize-wizard/route.ts` carried a route-local
 * `scrubInternalToken` / `safeErrorString` pair. The IDEA was right — they were
 * promoted to module scope precisely so every error-logging site in that route
 * got them — and the implementation was too narrow in three ways that each ship
 * silently:
 *   1. it knew exactly ONE env secret, so `X-Service-Key`, the Upstash token
 *      and a live user JWT went to the log verbatim;
 *   2. it was unreachable from the core and both clients, which is where undici
 *      actually produces the leak; and
 *   3. it had no minimum-length refusal, so a short secret would
 *      substring-match prose and eat the syscall token — TRAP-1's explicit
 *      over-redaction warning.
 * This module generalises it. It does not discard it.
 *
 * ⚠️ TRAP-1 IS TWO-SIDED, AND THAT IS THE WHOLE DESIGN.
 *
 *   · UNDER-redacting leaks a live credential. undici embeds the outgoing
 *     headers in `err.message` and, in one shape, in `err.name`. On this seam
 *     those headers are `INTERNAL_API_TOKEN`, `X-Service-Key` and
 *     `X-User-Access-Token` — a live end-user Supabase JWT — and on the
 *     key-connect path the request body carries raw exchange `api_key` /
 *     `api_secret` / `passphrase`.
 *   · OVER-redacting destroys the diagnosis. `ECONNREFUSED`, `ENOTFOUND`,
 *     `EAI_AGAIN` and the TLS codes are the most valuable thing in a transport
 *     line. A redactor that eats them has replaced one incident with two, and a
 *     one-sided test ships that state green.
 *
 * Three defences, each a hand-typed literal in this file:
 *   (a) `SEAM_SECRET_ENV_NAMES` — NAMES, whose values are read from
 *       `process.env` AT CALL TIME. Never captured at module scope: a captured
 *       value is evaluated once at import and is stale for a rotated secret and
 *       for every test that stubs the env after importing a consumer.
 *   (b) `MIN_REDACTABLE_SECRET_LENGTH` — a candidate below it is REFUSED rather
 *       than substring-replaced, and the refusal is signalled in the returned
 *       string. The floor clears the shortest preserve token (9 characters), so
 *       a candidate that could pass for prose never gets applied.
 *   (c) `SEAM_PRESERVE_TOKENS` — verified AFTER redaction. If a token that was
 *       present in the input is absent from the output, the input secret set
 *       collides with a diagnostic token; the credential still wins, and the
 *       returned string says so rather than shipping a silently mangled line.
 *
 * ZERO IMPORTS, ENFORCED. Same hard constraint as `seam-errors.ts` and
 * `seam-discriminator.ts`, for two reasons that break at once: this leaf is
 * reachable from a `"use client"` bundle (anything seam-adjacent drags
 * `@upstash/redis` and a `Redis.fromEnv()` module-load side effect in with it),
 * and it is called from INSIDE catch blocks, where a module-load failure would
 * replace the caller's real error with an import error. Pinned by
 * `seam-redaction.test.ts`.
 *
 * NOTHING HERE MAY THROW. Every entry point is total. A scrubber that throws
 * from inside a catch block is strictly worse than no scrubber at all.
 */

/** What a redacted secret value is replaced with. */
export const REDACTED = "<redacted>";

/**
 * Environment variables whose VALUES are always redacted from a seam log line.
 *
 * NAMES, hand-typed. The values are read at call time inside the scrub
 * functions. Every member is a credential this seam can carry into an outgoing
 * request or into a store command, so every member can end up inside an
 * inspected undici error:
 *
 *   INTERNAL_API_TOKEN        `Authorization: Bearer …` / `X-Internal-Token` on
 *                             all three seam paths.
 *   ANALYTICS_SERVICE_KEY     `X-Service-Key` on the analytics client.
 *   SUPABASE_SERVICE_ROLE_KEY the admin client's key; a Supabase transport error
 *                             can inline it, and several seam sites log Supabase
 *                             errors.
 *   UPSTASH_REDIS_REST_TOKEN  the breaker's own store credential; the breaker's
 *                             two catch arms log the store's rejection.
 *   CRON_SECRET               the warmer/cron authorization value.
 *
 * A name whose variable is unset simply contributes nothing — the leaf must not
 * depend on any of these being present, because the client bundle and the test
 * environment have none of them.
 */
export const SEAM_SECRET_ENV_NAMES: readonly string[] = [
  "INTERNAL_API_TOKEN",
  "ANALYTICS_SERVICE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
  "CRON_SECRET",
];

/**
 * Diagnostic tokens that must SURVIVE redaction, hand-typed as a literal set.
 *
 * These are the answer to "why did the seam call fail" — a refused connection,
 * a DNS failure, a reset, a deadline, an expired or unverifiable certificate.
 * Losing them is the A-10 defect: today the core drops `err` entirely on the
 * network arm, so TLS expiry, `EAI_AGAIN`, connection-refused and a header
 * `TypeError` are one indistinguishable sentence.
 *
 * This list is a VERIFIER, not a filter: redaction is exact-value replacement of
 * known secrets, so a preserve token can only be destroyed when a secret VALUE
 * contains one. That is a fault in the secret, and the returned string names it.
 */
export const SEAM_PRESERVE_TOKENS: readonly string[] = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
];

/**
 * The shortest ENV-DERIVED value this leaf will substring-replace.
 *
 * 12, and the number is derived rather than picked: the shortest members of the
 * preserve list (`ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`) are 9 characters, so any
 * candidate at or near that length is indistinguishable from prose and applying
 * it can eat a syscall token. Every env credential on this seam is far longer —
 * a Supabase JWT is ~200 characters, an Upstash REST token ~50, and the
 * internal token is a 32+ character hex string.
 *
 * ⚠️ IT GOVERNS `SEAM_SECRET_ENV_NAMES` ONLY, AND THAT SCOPE IS THE POINT (HI-03).
 *
 * Applying it to a PER-REQUEST secret was a live credential leak. Those values
 * are USER-OWNED and we do not length-control them:
 *   · MT5's `api_key` is the account LOGIN NUMBER — 8 digits (`26547876`).
 *   · OKX / Coinbase passphrases are user-chosen. `validate-and-encrypt`
 *     validates only `passphrase.trim().length !== 0`, `create-with-key` only
 *     non-empty and `<= 512`.
 * Both were therefore refused, and went verbatim to `console.error` AND to
 * `captureToSentry({ secrets })` — a third party — under a notice advising the
 * operator to "lengthen the secret", which for a user's own passphrase is not a
 * remedy anyone can apply.
 *
 * An explicitly-passed per-request secret is an ASSERTION by the call site that
 * this exact byte string is a credential. It is honoured at any length. The
 * residual is stated rather than hidden: a pathologically short one (a 1-3
 * character passphrase) will substring-match prose and mangle the line. That is
 * the deliberate direction — the credential wins over the diagnosis — and the
 * destroyed-token check below ANNOUNCES the loss rather than shipping a silently
 * mangled line.
 *
 * ⚠️ LOWERING THIS IS LEDGER ROW M33. It is the exact mutation that makes a
 * short ENV secret substring-match prose and destroy `ECONNREFUSED`, and the
 * preserve side of `seam-redaction.test.ts` is what reddens. Note that raising
 * it is now the mutation for the OTHER half: per-request cases must stay green
 * whatever this number is.
 */
export const MIN_REDACTABLE_SECRET_LENGTH = 12;

/** How deep a `cause` chain is walked before it is truncated. */
const MAX_CAUSE_DEPTH = 4;

/**
 * The fields read off a PLAIN OBJECT that is not an `Error`, in render order.
 *
 * Hand-typed, and every member is here because a shape this seam actually
 * produces carries it:
 *   · `code` / `message` / `details` / `hint` — a Supabase/PostgREST error.
 *     `code` is the SQLSTATE; `details` and `hint` are the two fields an
 *     operator needs to reproduce an RLS or constraint refusal.
 *   · `errno` / `syscall` — a Node system error that arrived as a plain object
 *     rather than an `Error` instance.
 *   · `name` — anything error-shaped that was structured-cloned or JSON
 *     round-tripped across a boundary, which strips the prototype.
 *
 * Nothing else is read. A whitelist rather than a dump is the TRAP-1-safe
 * direction: an arbitrary object on this seam can carry a request body, and a
 * request body on the key-connect path carries raw exchange credentials.
 */
const PLAIN_OBJECT_DIAGNOSTIC_KEYS: readonly string[] = [
  "name",
  "code",
  "message",
  "details",
  "hint",
  "errno",
  "syscall",
];

/**
 * Ceiling on the serialised fallback for an object with no named field.
 *
 * The fallback exists so an opaque object says SOMETHING rather than nothing,
 * not so an arbitrarily large payload can be pasted into a log line. 500 is
 * comfortably above every shape on this seam and far below anything that would
 * flood the Vercel log during the correlated incident this leaf runs inside.
 */
const MAX_SERIALISED_OBJECT_CHARS = 500;

/** What `String()` renders for any object using the INHERITED `toString`. */
const DEFAULT_OBJECT_RENDERING = "[object Object]";

/** A secret candidate: a label safe to LOG, and a value that never is. */
interface SecretCandidate {
  /** An env var NAME, or a generic marker for a caller-supplied value. */
  label: string;
  value: string;
  /**
   * True when the CALL SITE supplied this value, false when it came from
   * `SEAM_SECRET_ENV_NAMES`.
   *
   * This is the only field `MIN_REDACTABLE_SECRET_LENGTH` is consulted for, and
   * the distinction is the whole of HI-03 — see the floor's own docblock.
   */
  perRequest: boolean;
}

/** The label used for a caller-supplied secret — never the value, never a name. */
const PER_REQUEST_LABEL = "a per-request secret";

/**
 * Collect the secret VALUES in play for this call.
 *
 * `process.env` is read HERE, per call. Values are collected in one pass and
 * are never returned, logged, or stored anywhere beyond this function's frame.
 */
function collectCandidates(
  extraSecrets: readonly unknown[],
): SecretCandidate[] {
  const candidates: SecretCandidate[] = [];
  for (const name of SEAM_SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) {
      candidates.push({ label: name, value, perRequest: false });
    }
  }
  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.length > 0) {
      candidates.push({ label: PER_REQUEST_LABEL, value: secret, perRequest: true });
    }
  }
  return candidates;
}

/** De-duplicate labels so a notice reads once per distinct source. */
function uniqueLabels(labels: readonly string[]): string[] {
  const seen: string[] = [];
  for (const label of labels) {
    if (!seen.includes(label)) seen.push(label);
  }
  return seen;
}

/**
 * Redact every known secret VALUE from a string, then verify the diagnosis
 * survived.
 *
 * Replacement is `split(...).join(...)` — exact-value, not a regex. A regex
 * built from a secret would need escaping (a secret can contain regex
 * metacharacters) and would open a ReDoS surface on a value we do not control.
 *
 * `extraSecrets` is how a caller expresses a PER-REQUEST secret: a live user
 * JWT, an exchange `api_key` / `api_secret` / `passphrase`. No module-level list
 * can know those. Non-string and empty members are ignored, so a call site can
 * pass an optional field straight through without a guard.
 *
 * TOTAL: any internal failure returns the input unchanged rather than throwing,
 * because every caller is inside a catch block.
 */
export function scrubSeamString(
  value: string,
  extraSecrets: readonly unknown[] = [],
): string {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    const candidates = collectCandidates(extraSecrets);
    let out = value;
    const refused: string[] = [];
    /** Labels of applied secrets whose VALUE contains a preserve token. */
    const colliding: string[] = [];

    for (const candidate of candidates) {
      // Tested against the WORKING copy: an earlier replacement may already have
      // removed this candidate's occurrence, and a notice about a secret that is
      // no longer in the line is noise.
      if (!out.includes(candidate.value)) continue;
      if (
        !candidate.perRequest &&
        candidate.value.length < MIN_REDACTABLE_SECRET_LENGTH
      ) {
        // REFUSED — and ONLY for an ENV candidate (HI-03). Applying a short one
        // would substring-match prose. The line is left alone and the operator
        // is told, because this line may be under-redacted and that has to be
        // visible from the line itself. The remedy the notice prints is one the
        // operator can actually apply, because the value is ours.
        refused.push(candidate.label);
        continue;
      }
      if (SEAM_PRESERVE_TOKENS.some((token) => candidate.value.includes(token))) {
        // Applying this one WILL eat a diagnostic token. Record the LABEL so the
        // notice below can name the secret to fix; a notice that only says "a
        // token was destroyed" leaves the operator with nowhere to go.
        colliding.push(candidate.label);
      }
      out = out.split(candidate.value).join(REDACTED);
    }

    // The preserve check compares the ORIGINAL against the OUTPUT: a token that
    // was never in the input cannot have been destroyed by redaction.
    const destroyed = SEAM_PRESERVE_TOKENS.filter(
      (token) => value.includes(token) && !out.includes(token),
    );

    if (refused.length > 0) {
      out +=
        ` [seam-redaction: refused to redact ${refused.length} env value(s) shorter than ` +
        `${MIN_REDACTABLE_SECRET_LENGTH} chars (${uniqueLabels(refused).join(", ")}) — ` +
        `this line may be under-redacted; lengthen the secret rather than the leaf]`;
    }
    if (destroyed.length > 0) {
      const blame =
        colliding.length > 0 ? uniqueLabels(colliding).join(", ") : "unknown";
      out +=
        ` [seam-redaction: redaction removed diagnostic token(s) ${destroyed.join(", ")} — ` +
        `the value of ${blame} contains one. The credential wins; fix the secret, ` +
        `not this line]`;
    }
    return out;
  } catch {
    // Unreachable in practice. Returning the input is the lesser evil: this runs
    // inside a catch block, and a throw here would replace a real error with a
    // bookkeeping one.
    return value;
  }
}

/**
 * Render an unknown thrown value as a string, walking the `cause` chain.
 *
 * The shapes this exists for, all of them live on this seam:
 *   · `Error` — `name` and `message`, both scrubbed by the caller. undici puts
 *     the request headers in the message, and a retry/wrapper layer can put
 *     them in the NAME.
 *   · `cause` — since plan 140.2-05 `SeamBodyReadError` attaches the original
 *     rejection there, so a renderer that reads only the top level reports
 *     "SeamBodyReadError: …" and throws the actual diagnosis away.
 *   · a PLAIN OBJECT — the shape a Supabase/PostgREST error takes on the
 *     NON-throwing path, which is every `const { data, error } = await
 *     supabase…` in this repo. `String()` renders it "[object Object]", so this
 *     is the one shape where the DEFAULT rendering destroys the whole
 *     diagnosis; its named diagnostic fields are read instead.
 *   · anything else — a string, a number, `undefined`. A route can `throw` any
 *     value, and `String()` is not total (a null-prototype object and a hostile
 *     `toString` both throw).
 *
 * Cycles are broken by identity, and depth is capped, because an error graph is
 * caller-supplied data.
 */
function describeThrown(
  err: unknown,
  depth: number,
  seen: Set<object>,
): string {
  if (depth > MAX_CAUSE_DEPTH) return "…";
  if (err === undefined) return "undefined";
  if (err === null) return "null";
  if (typeof err === "object") {
    if (seen.has(err)) return "[circular]";
    seen.add(err);
  }
  try {
    if (err instanceof Error) {
      const name = typeof err.name === "string" ? err.name : "Error";
      const message = typeof err.message === "string" ? err.message : "";
      let rendered = `${name}: ${message}`;
      const cause = (err as { cause?: unknown }).cause;
      if (cause !== undefined && cause !== null) {
        rendered += ` [cause: ${describeThrown(cause, depth + 1, seen)}]`;
      }
      return rendered;
    }
    if (typeof err === "object") {
      // ⚠️ THE PLAIN-OBJECT BRANCH, AND WHY IT IS NOT OPTIONAL.
      //
      // A Supabase/PostgREST error on the NON-throwing path is a plain parsed
      // JSON object, NOT a `PostgrestError` instance: `postgrest-js` constructs
      // the class only when `shouldThrowOnError` is set, and every
      // `const { data, error } = await supabase…` in this repo takes the other
      // path. Without this branch `String(err)` renders "[object Object]" and
      // the SQLSTATE, the message, the details and the hint are all destroyed —
      // the A-10 harm ("the operator could see THAT the seam failed and never
      // WHY") reintroduced by the leaf built to close it.
      //
      // An ARRAY falls through the named-field pass with nothing to show and
      // then renders through `String()`, which joins it — the same bytes as
      // before, so no case regresses.
      const record = err as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of PLAIN_OBJECT_DIAGNOSTIC_KEYS) {
        const field = record[key];
        if (typeof field === "string" || typeof field === "number") {
          parts.push(`${key}=${field}`);
        }
      }
      if (parts.length > 0) return parts.join(" ");

      // No named field. A CUSTOM `toString` (a `URL`, a `Date`, a class with
      // its own renderer) still says something useful, so it wins — only the
      // INHERITED `Object.prototype.toString` is overridden, because
      // "[object Object]" is precisely the rendering this branch exists to
      // stop. `String()` is not total (a null-prototype object throws), so its
      // failure is treated as "no useful rendering" rather than propagated.
      let rendered: string | null = null;
      try {
        rendered = String(err);
      } catch {
        rendered = null;
      }
      if (rendered !== null && rendered !== DEFAULT_OBJECT_RENDERING) {
        return rendered;
      }
      try {
        // `JSON.stringify` returns `undefined` for a value it cannot represent
        // and THROWS on a cycle, so both outcomes are handled rather than
        // assumed away.
        const serialised = JSON.stringify(err);
        if (typeof serialised !== "string") return "[unserialisable object]";
        return serialised.length > MAX_SERIALISED_OBJECT_CHARS
          ? `${serialised.slice(0, MAX_SERIALISED_OBJECT_CHARS)}…[truncated]`
          : serialised;
      } catch {
        return "[unserialisable object]";
      }
    }
    return String(err);
  } catch {
    return "[unrepresentable thrown value]";
  }
}

/**
 * Render an unknown thrown value as a SCRUBBED string.
 *
 * This is the entry point every seam log site uses. It is total by construction:
 * every branch returns a string and nothing propagates, because every caller is
 * inside a catch block and a throw here would replace the real error with a
 * bookkeeping one.
 */
export function scrubSeamError(
  err: unknown,
  extraSecrets: readonly unknown[] = [],
): string {
  try {
    return scrubSeamString(describeThrown(err, 0, new Set<object>()), extraSecrets);
  } catch {
    return "[seam-redaction: unrepresentable thrown value]";
  }
}
