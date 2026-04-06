/**
 * Plausible custom event tracking.
 * Events are only sent when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set.
 * Falls back silently when Plausible is not loaded.
 */

type PlausibleArgs = [string, { props?: Record<string, string | number> }];

declare global {
  interface Window {
    plausible?: (...args: PlausibleArgs) => void;
  }
}

function track(event: string, props?: Record<string, string | number>) {
  if (typeof window !== "undefined" && window.plausible) {
    window.plausible(event, { props: props ?? {} });
  }
}

export const analytics = {
  /** Allocator views a strategy factsheet */
  factsheetView: (strategyId: string) =>
    track("Factsheet View", { strategy_id: strategyId }),

  /** User copies factsheet share link */
  shareClick: (strategyId: string) =>
    track("Share Click", { strategy_id: strategyId }),

  /** Allocator submits an intro request */
  introRequest: (strategyId: string) =>
    track("Intro Request", { strategy_id: strategyId }),

  /** User downloads PDF factsheet */
  pdfDownload: (strategyId: string) =>
    track("PDF Download", { strategy_id: strategyId }),

  /** User applies discovery filters */
  filterApply: (filters: string) =>
    track("Filter Apply", { filters }),

  /** User signs up */
  signup: (role: string) =>
    track("Signup", { role }),
};
