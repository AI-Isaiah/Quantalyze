/**
 * Phase 140.3-11 / TS-18 + SEAMUX-04 — the ONE sentence the admin match surface
 * shows when a `424` says the CALLER'S EXCHANGE failed.
 *
 * WHAT A 424 MEANS, and why it does not read like our other failures.
 * `analytics-service/docs/STATUS_CONTRACT.md` §1/§6 O-1: a 424 is CALLER'S
 * EXCHANGE — the third party the caller named is at fault. It is `recoverable`
 * (the venue may come back), it is breaker-inert, and `error_contract._validate`
 * refuses a 424 that names one of OUR dependencies. So it is the one failure
 * class where the honest sentence says the problem is NOT ours, and where a
 * retry is honest rather than the B-01/B-22 dead end.
 *
 * WHY IT LIVES HERE AND NOT IN ONE OF THE TWO EXISTING COPY MODULES. Both were
 * read first and both were rejected with a reason, rather than being widened:
 *
 *   `src/lib/seam-copy.ts` — the ONE source of the BREAKER sentence. Its own
 *      docblock forbids exactly the shape this needs: "Do not make this a
 *      function, a template, or a per-route variant." Adding a second, venue-
 *      shaped export to a leaf whose whole point is one static string would
 *      trade away the property `140.3-04` spent a plan establishing.
 *   `src/lib/wizardErrors.ts` — keyed on `WizardErrorCode`, whose members are
 *      all key-connect and sync states. An admin match recompute has no wizard
 *      code, and `140.3-12` owns that table's copy pass with its marker count
 *      pinned. Putting admin copy in the wizard table to reach `buildEnvelope`
 *      would be a category error dressed as reuse.
 *
 * It is therefore co-located with the only two consumers that render it —
 * `AllocatorMatchQueue` and `MatchEvalDashboard` — and it is ONE function
 * rather than a string per component, because "a class fixed two ways cannot be
 * audited" is this programme's recurring finding and two admin components
 * wording the same fact differently is that failure in miniature.
 *
 * VOICE (DESIGN.md §Voice/microcopy): declarative, sentence-case, active, no
 * exclamation, no banned glyph, no adjective where a number exists. **No wait
 * is named**, deliberately: neither admin route forwards a `Retry-After`
 * (`AnalyticsUpstreamError` carries no headers), so naming a duration would be
 * the invented number TRAP-3 is about.
 */

/**
 * The sentence for a `424`, naming the venue when the wire named one.
 *
 * @param venue The slug from the envelope's `dependency`, already shape-checked
 *   and confirmed to be OUTSIDE our closed service set by
 *   `seamDependencyName`. `null` means the wire named no venue — which is the
 *   COMMON case, because the flat `VenueTransientHTTPException` 424 that
 *   `140.3-06` put on the wire carries no `dependency` key at all.
 *
 * The `null` branch degrades to a truthful un-named statement. It must never
 * interpolate the absent value (that renders the literal `undefined` at a
 * founder), and it must never guess a venue: naming the wrong exchange during
 * an outage is worse than naming none.
 *
 * Neither branch says the analytics service is degraded. That is the whole of
 * SEAMUX-04 at this surface — our outage is never reported as the user's, and
 * the user's venue is never reported as ours.
 */
export function venueOutageMessage(venue: string | null): string {
  // The wire carries slugs (`binance`, `bybit`), and a sentence that opens with
  // a lowercase letter reads as a rendering bug. This is PRESENTATION only —
  // one character's case — never a rewrite, never a lookup table mapping slugs
  // to display names. A table would be the hardcoded venue list this surface is
  // required not to have, and its failure mode is that an exchange nobody
  // remembered to add renders as nothing at all.
  const subject =
    venue === null
      ? "An exchange"
      : venue.charAt(0).toUpperCase() + venue.slice(1);
  return (
    `${subject} isn't responding right now. The fault is at the venue, not in ` +
    `the analytics service. Retry in a moment.`
  );
}
