"use client";

import { buttonClassName } from "@/components/ui/Button";

/**
 * The tear sheet's screen-only print control. Secondary, so the row's one accent
 * fill is the "Download PDF" link beside it (Phase 196 UI-SPEC, Print and Tearsheet).
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClassName({ variant: "secondary", size: "md" })}
    >
      Print tearsheet
    </button>
  );
}
