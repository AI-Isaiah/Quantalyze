/**
 * Sanitize a string for use inside a Content-Disposition header's
 * `filename="…"` parameter.
 *
 * Removes characters that can break or inject into the header:
 *   - CR/LF (header injection)
 *   - double-quote, backslash (break the quoted-string)
 *   - non-ASCII (breaks RFC 2183 / ASCII-only agents)
 *
 * Truncates to 80 characters to avoid unreasonable header lengths.
 * Returns `fallback` when the result would be empty.
 */
export function sanitizeFilename(name: string, fallback = "document"): string {
  return (
    name
      .replace(/[\r\n"\\]/g, "")
      .replace(/[^\x20-\x7E]/g, "")
      .trim()
      .slice(0, 80) || fallback
  );
}
