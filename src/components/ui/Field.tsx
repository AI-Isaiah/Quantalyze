/**
 * Field — the label + control + hint + error a11y wrapper (Phase 50 / UI-02).
 *
 * Consolidates the `<label>`↔control wiring the wizard/connect forms hand-wire
 * today (e.g. `CsvUploadStep` wires `aria-invalid` but NOT `aria-describedby` —
 * the exact gap this primitive closes). Field WRAPS a control passed as
 * `children`; it does NOT duplicate the inline label/error markup the
 * Input/Select/Textarea primitives keep for back-compat.
 *
 * a11y wiring (50-UI-SPEC §Field + 50-RESEARCH Pattern 6):
 *   - `id = providedId ?? useId()`; `<label htmlFor={id}>` ↔ control `id`.
 *   - `aria-describedby` = the hint id and the error id, space-joined, in
 *     `[hint, error]` order (only the present ones). `undefined` when neither.
 *   - `aria-invalid = "true"` only when `error` is set (otherwise omitted).
 *
 * Field does NOT validate (ASVS V5 posture) — it surfaces a consumer-supplied
 * `error` string with the correct a11y wiring + visual treatment. The control's
 * own `id`/`aria-*` props win if a consumer sets them on the child (Field's
 * injected values are spread first, the child's existing props last).
 *
 * Security: label/hint/error and the control render as React-escaped children.
 * No `dangerouslySetInnerHTML`.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
} from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  /** Visible label text, wired to the control via `htmlFor`/`id`. */
  label: string;
  /** The wrapped form control (e.g. an `<input>`/`<select>`/`<textarea>`). */
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
  }>;
  /** Optional supplementary hint; wired into `aria-describedby`. */
  hint?: string;
  /** Optional consumer-supplied error; wired into `aria-describedby` + `aria-invalid`. */
  error?: string;
  /** Explicit control id; falls back to `useId()` when omitted. */
  id?: string;
  className?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  id: providedId,
  className,
}: FieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = Children.only(children);
  const wiredControl = isValidElement(control)
    ? cloneElement(control, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? "true" : undefined,
        ...control.props,
      })
    : control;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-small font-medium text-text-primary">
        {label}
      </label>
      {wiredControl}
      {hint && (
        <p id={hintId} className="text-caption text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
