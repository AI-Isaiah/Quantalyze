/**
 * Shared helpers for the quantalyze lint rules (B25).
 */

/**
 * File-level sanctioned-exception escape hatch.
 *
 * A rule SKIPS an entire file when that file contains any of the given marker
 * tokens in a comment. This mirrors the per-file allowlist the existing
 * by-construction grep tests use (e.g. `visibility.test.ts`'s SANCTIONED set)
 * so the lint rule and the grep test agree on which files are deliberate
 * exceptions. The escape is greppable + reviewable — consistent with the
 * evaluation's framing that this rule is a *backstop*, not unrepresentability
 * (an `eslint-disable` could bypass it too). Requiring the explicit, batch-
 * tagged token (e.g. `B7 sanctioned-exception:`) means a bypass is a
 * deliberate, auditable act, not an accidental one.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {string[]} markers
 * @returns {boolean}
 */
export function fileHasMarker(sourceCode, markers) {
  return sourceCode
    .getAllComments()
    .some((comment) => markers.some((marker) => comment.value.includes(marker)));
}
