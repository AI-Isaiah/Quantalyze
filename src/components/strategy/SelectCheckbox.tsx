"use client";

import { COMPARE_MAX_ITEMS } from "@/lib/compare-href";

/** The copy a disabled box carries at the cap (UI-SPEC Copywriting Contract, U-14). */
export const SELECT_CAP_TITLE = `Up to ${COMPARE_MAX_ITEMS} strategies can be compared. Remove one to add another.`;

interface SelectCheckboxProps {
  strategyId: string;
  name: string;
  checked: boolean;
  /**
   * The selection is full and THIS box is not part of it: the box is disabled and its label says
   * why. A checked box at the cap stays operable, so a selection can always be reduced.
   */
  atCap: boolean;
  onToggle: (strategyId: string) => void;
}

/**
 * Phase 197 / ROUTE-05 (D-04) - the "Select {name} to compare" checkbox, shared by the table cell
 * and the grid card overlay so the two views of one list cannot name or size it differently.
 *
 * A native 16px checkbox centred in a 44 x 44 label (the touch target). The focus indicator is an
 * INSET ring on the label: the table cell lives in an `overflow-x-auto` region, where an outset
 * indicator is clipped at the scroll edge (the `GHOST_ROW_ACTION` clip-proof idiom). `has-[:focus-visible]`
 * keeps it to keyboard focus. `data-select-for` is the hook the table's focus management finds the
 * box by; it is rendered only where selection is on.
 */
export function SelectCheckbox({ strategyId, name, checked, atCap, onToggle }: SelectCheckboxProps) {
  const disabled = atCap && !checked;
  return (
    <label
      title={disabled ? SELECT_CAP_TITLE : undefined}
      className={`flex h-11 w-11 items-center justify-center rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-accent ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="rounded accent-accent focus-visible:outline-none disabled:cursor-not-allowed"
        aria-label={`Select ${name} to compare`}
        data-select-for={strategyId}
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(strategyId)}
      />
    </label>
  );
}
