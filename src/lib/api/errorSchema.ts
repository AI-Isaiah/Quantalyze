import { z } from "zod";

/**
 * Shared error-response envelope for client-side parsing of API error bodies.
 *
 * audit-2026-05-07 F5 (M-0967 / L-0060) — before this schema existed, callers
 * read `await res.json()` as `any` and dereferenced `body.error` /
 * `body.retryAfter` with no validation. An untyped `any` lets a server response
 * of `{ error: { nested: "obj" } }` coerce to `"[object Object]"` in the
 * user-facing message, and a typo'd `{ msg: "..." }` surface as `undefined`.
 *
 * The canonical app error envelope is `{ error: string, retryAfter?: number }`
 * (see `withAuth` / `NO_STORE_HEADERS` routes). `detail` and `message` are
 * tolerated aliases because non-canonical bodies leak through: the Python
 * analytics service raises `HTTPException` with `detail`, and framework/platform
 * errors (413, edge 5xx) sometimes carry `message`. Every field is optional and
 * string/number-typed, so `safeParse` REJECTS a non-string `error` (falling the
 * caller back to static copy) instead of stringifying an object.
 */
export const ErrorResponseSchema = z.object({
  error: z.string().optional(),
  detail: z.string().optional(),
  message: z.string().optional(),
  retryAfter: z.number().nonnegative().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
