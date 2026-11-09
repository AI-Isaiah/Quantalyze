/**
 * Phase 197 / CLAR-05 (D-01, D-02) - the admin-only "shares an exchange account" line.
 *
 * Owned here so the table's Strategy cell and the grid card print ONE string. The names are the
 * published partners' raw `strategies.name` (the same string the row itself prints), handed over by
 * the discovery page only when the viewer is an admin: see `getSharedAccountPartners`.
 *
 * Informational, never an accusation: one exchange account under several logins is intended, so the
 * line is muted, carries no glyph, and says what is true (the account is shared) and nothing about
 * why. Partner names are plain text, not links (U-11). Nothing identifying the account itself is
 * ever passed in, so none can be printed.
 */

const LEAD = "Shares an exchange account with";

/** One name shown, two named, three or more name two and count the rest. `null` for no partner. */
export function sharedAccountSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${LEAD} ${names[0]}.`;
  if (names.length === 2) return `${LEAD} ${names[0]} and ${names[1]}.`;
  return `${LEAD} ${names[0]}, ${names[1]} and ${names.length - 2} more.`;
}

export function SharedAccountNote({ names, className = "" }: { names: readonly string[]; className?: string }) {
  const sentence = sharedAccountSentence(names);
  if (sentence === null) return null;
  return (
    <p
      title={`Shown to admins only. ${LEAD} ${names.join(", ")}.`}
      className={`mt-1 text-micro text-text-muted ${className}`.trim()}
    >
      {sentence}
    </p>
  );
}
