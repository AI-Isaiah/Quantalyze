/**
 * Pure relative-time formatter for the MandateSaveStatus region.
 *   - null              → "Not saved yet" (first-visit sentinel)
 *   - < 60s             → "just now"
 *   - 60s - 59min       → "{n} min ago"
 *   - 1hr - 23hr        → "{n} hr ago"
 *   - >= 24hr           → "{YYYY-MM-DD}"
 * Future timestamps (lastSaved > now) are clamped to 0 delta defensively.
 */
export function formatRelativeTime(
  lastSaved: number | Date | null,
  now: number = Date.now(),
): string {
  if (lastSaved === null) return "Not saved yet";
  const lastMs = lastSaved instanceof Date ? lastSaved.getTime() : lastSaved;
  const deltaMs = Math.max(0, now - lastMs);
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(deltaMs / 3_600_000);
  if (hours < 24) return `${hours} hr ago`;
  const d = new Date(lastMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
