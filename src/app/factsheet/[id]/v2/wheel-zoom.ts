/**
 * D-01 (founder, 2026-11-06): a plain mouse wheel over a factsheet chart scrolls the page and
 * changes nothing; the chart zooms only on Ctrl or Cmd + wheel. A trackpad pinch arrives as a
 * wheel event with `ctrlKey` set, so it zooms too. This is the one place the condition is
 * written; `TimeSeriesChart` and `HistogramChart` both gate their React `onWheel` and their
 * native non-passive listener on it.
 */
export const isZoomWheel = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.ctrlKey || e.metaKey;
