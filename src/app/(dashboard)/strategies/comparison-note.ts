/**
 * Phase 199 plan 10 (D-02, LEAN-01) - the Phase 149 comparison-note copy, one home.
 *
 * The note above the owner list explains the `#` every viewer sees and the `Pnn`
 * suffix, and says how many of the owner's keys have no strategy yet. It started
 * on /my-strategies and now belongs to every role on /strategies. Both pages
 * import these three from here until /my-strategies retires (plan 199-13), so
 * there is never a second copy to drift.
 *
 * Copy literals are the 149-UI-SPEC Copywriting Contract, verbatim. The merged
 * page's test pins each one independently of this module.
 *
 * No client directive and no imports: the server page calls these.
 */

/** `n` is the size of the published population that entered the ranking. */
export const mapCopy = (n: number) =>
  `Ranked against ${n} published strategies. # is the row's position in this list; Pnn compares the row against those ${n} published strategies. Private and draft rows are visible only to you and do not affect public rankings.`;

/** Shown while the published population is under the ranking threshold. */
export const NULL_COPY =
  "Percentile ranks appear once 5 strategies are published in the comparison set. Private and draft rows are visible only to you.";

/** `k` is the number of active keys that have produced no strategy yet. */
export const kSentence = (k: number) => `${k} of your keys have no strategy yet.`;

/**
 * UI-SPEC read failure, class `read_failure`: the placeholder-key read failed.
 * Nothing is known about the viewer's keys, so the line names no key and carries
 * the action (reload). It is shown INSTEAD of any claim that keys are absent.
 */
export const PLACEHOLDER_KEYS_UNREADABLE =
  "We could not load your exchange keys, so keys without a strategy may be missing here. Reload this page to try again.";
