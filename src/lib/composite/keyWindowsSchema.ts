/**
 * Phase 88 / ONB-02 — the multi-key window validator (zod superRefine).
 *
 * Implements the 4 LOCKED cross/per-key validation rules over `keys:
 * KeyWindow[]` for the wizard multi-key connect step. Client-side validation
 * here is advisory UX; the authoritative overlap guard stays in the worker
 * (`assert_windows_disjoint`) and is re-run server-side (88-04). This schema is
 * reused verbatim by the route so there is no weaker server derivation.
 *
 * The overlap rule delegates to the shared `windowsOverlap` predicate — the ONE
 * spec bound to analytics-service/tests/fixtures/window_overlap_convention.json
 * and mirrored in stitch_composite.py. It MUST NOT be re-derived inline here
 * (v1.5 lesson: same inputs / different derivations = silent divergence).
 *
 * Deliberate decision (RESEARCH Open Question 2): there is NO 5th "only the
 * last member may be open-ended" rule. It is provably redundant — an interior
 * open-ended window always overlaps its successor under the convention's
 * `open_ended_vs_later_start_overlaps=true` case, so the overlap rule below
 * already rejects it. Adding a 5th rule would double-report the same defect.
 */
import { z } from "zod";
import { windowsOverlap } from "./windowOverlap";

/** ISO 'YYYY-MM-DD' shape. Lexicographic compare == chronological for this form. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `s` (already matching ISO_DATE_RE) is a REAL calendar date. The
 * regex only checks SHAPE, so "2024-13-45" / "2024-02-31" pass it but are not
 * valid dates — left unchecked they slip through to the DB `::date` cast and
 * surface as a generic 409 instead of a window error. Round-trip through a UTC
 * Date and require the parsed Y-M-D to equal the input components: JS Date
 * normalizes overflow (2024-02-31 → 2024-03-02, 2024-13-01 → 2025-01-01), so a
 * mismatch means the input was not a real date. This makes the schema the
 * single authoritative gate (one spec, both surfaces).
 */
function isCalendarDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

const CALENDAR_DATE_MESSAGE = "Use a real calendar date.";

/**
 * One composite member. `api_key_id` is optional here: the live UI form
 * accumulates windows before a key is minted server-side, whereas 88-04's
 * set-members route supplies it. Both reuse this same member shape.
 */
export const keyWindowSchema = z.object({
  api_key_id: z.string().uuid().optional(),
  window_start: z
    .string()
    .regex(ISO_DATE_RE, "Use a YYYY-MM-DD date.")
    .refine(isCalendarDate, CALENDAR_DATE_MESSAGE),
  window_end: z
    .string()
    .regex(ISO_DATE_RE, "Use a YYYY-MM-DD date.")
    .refine(isCalendarDate, CALENDAR_DATE_MESSAGE)
    .nullable(),
  seq: z.number().int().min(1),
});

export type KeyWindow = z.infer<typeof keyWindowSchema>;

export const keyWindowsSchema = z
  .object({ keys: z.array(keyWindowSchema) })
  .superRefine((val, ctx) => {
    const keys = val.keys;
    // todayUTC computed exactly as bridge-outcome-schema.ts does.
    const today = new Date().toISOString().slice(0, 10);

    // ── Per-key rules ────────────────────────────────────────────────────
    keys.forEach((k, i) => {
      // Rule: end <= start is invalid (strict — mirrors the DB CHECK
      // strategy_keys_window_order `>` at strategy_keys.sql:41; end == start
      // is also rejected).
      if (k.window_end !== null && k.window_end <= k.window_start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", i, "window_end"],
          message: "End date must be after the start date.",
        });
      }
      // Rule: no window may extend into the future (start or end after today).
      if (k.window_start > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", i, "window_start"],
          message: "Windows can't extend into the future.",
        });
      }
      if (k.window_end !== null && k.window_end > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", i, "window_end"],
          message: "Windows can't extend into the future.",
        });
      }
    });

    // ── Cross-key: order (seq strictly increasing AND consistent with
    // window_start order). Position-derived seq makes this unreachable from the
    // UI (§Validation backstop), but a crafted server payload could trip it. ──
    for (let j = 1; j < keys.length; j++) {
      const prev = keys[j - 1];
      const cur = keys[j];
      if (cur.seq <= prev.seq || cur.window_start < prev.window_start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", j, "seq"],
          message:
            "Key order is inconsistent — reorder so each window starts on or after the previous one.",
        });
      }
    }

    // ── Cross-key: overlap. Every pair i<j via the ONE shared predicate. ──
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        if (windowsOverlap(keys[i], keys[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["keys", j, "window_start"],
            // 1-indexed key numbers in the copy (UI-SPEC §Copywriting).
            message: `Key ${i + 1} and Key ${j + 1} cover overlapping dates. Ranges must be non-overlapping (a handoff day may be shared).`,
          });
        }
      }
    }
  });
