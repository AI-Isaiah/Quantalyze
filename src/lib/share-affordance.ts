/**
 * Phase 164 (SHARE-04) — the share-affordance predicate, in a module with NO
 * `"use client"` directive.
 *
 * ⛔ WHY IT LIVES HERE AND NOT IN `ShareableLink.tsx`. It was declared there,
 * beside the component, which reads well and is wrong: that file is a Client
 * Component, and a Server Component may only RENDER an export of a client
 * module or pass it as a prop — never CALL one. `src/app/(dashboard)/strategies/
 * page.tsx` is a server component and calls `isPublishedStatus(s.status)` to
 * compute the `published` prop, so every `GET /strategies` threw:
 *
 *   Error: Attempted to call isPublishedStatus() from the server but
 *   isPublishedStatus is on the client.
 *
 * MEASURED in the dev server 2026-08-28, three requests, three throws. The unit
 * tests could not catch it — jsdom does not enforce the RSC boundary, so the
 * same call is perfectly legal in a test and fatal in the app. That gap is the
 * lesson, not the line.
 *
 * These two functions are pure and dependency-free, so a shared module is the
 * whole fix: both lanes import the SAME declaration and the one-predicate
 * property is preserved rather than traded away.
 */

/** Which kind of link a share control hands out. */
export type ShareAffordanceMode = "public-url" | "mint-token";

/**
 * The predicate. Deliberately a named function rather than an inline
 * `published ? … : …` at three call sites: a grep for this identifier is the
 * drift check, and a fourth surface that wants a share control has exactly one
 * obvious thing to call.
 */
export function shareAffordanceMode(published: boolean): ShareAffordanceMode {
  return published ? "public-url" : "mint-token";
}

/** `status` values are `text` in the DB; anything that is not the published
 *  literal is treated as unpublished (fail-CLOSED — an unrecognised status must
 *  not be handed a public URL that may 404). */
export function isPublishedStatus(status: string | null | undefined): boolean {
  return status === "published";
}
