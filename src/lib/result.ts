/**
 * `Result<T, E>` — an explicit success/failure envelope.
 *
 * Shipped for B21 (eval decision #2): B2 marked a `Result` envelope "closed"
 * but never actually shipped it, and B21 needs one for the widget
 * input-validation boundary — the boundary validates an `unknown` widget
 * payload into a typed shape and returns `err(...)` on failure instead of
 * letting malformed data flow into SVG / quantile / anchor math. Other
 * batches (B23) reference the same primitive, so it lives at `src/lib/result.ts`
 * rather than inside the widgets slice.
 *
 * Discriminated on the literal `ok` field so TypeScript narrows the union in
 * both branches (`if (r.ok) { r.value } else { r.error }`). No exceptions are
 * used for control flow — that is the entire point: a caller cannot read
 * `.value` without first proving `ok === true`.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Wrap a success value. */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/** Wrap a failure value. */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Type guard: narrows to the success branch. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Type guard: narrows to the failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transform the success value, leaving a failure untouched. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transform the failure value, leaving a success untouched. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Read the success value, or return `fallback` on failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Run a throwing function and capture any throw as `err`. The containment
 * primitive behind the widget boundary: a widget body that throws becomes a
 * recoverable `Err<Error>` the boundary can render as an error state, rather
 * than an uncaught exception that blanks the dashboard.
 */
export function fromThrowing<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (caught) {
    return err(caught instanceof Error ? caught : new Error(String(caught)));
  }
}

/**
 * Adapt a Zod-style `safeParse` result into a `Result`. Kept structural (it
 * does not import Zod's own types) so it is agnostic across Zod major versions
 * — both v3 and v4 expose this exact `{ success, data } | { success, error }`
 * shape from `schema.safeParse(...)`.
 */
export function fromSafeParse<T, E>(
  parsed: { success: true; data: T } | { success: false; error: E },
): Result<T, E> {
  return parsed.success ? ok(parsed.data) : err(parsed.error);
}
