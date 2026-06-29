/**
 * Table — the semantic, a11y-correct table base (Phase 50 / UI-02 / STATE-03).
 *
 * A small set of composable parts that render a REAL semantic
 * `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th scope>`/`<td>` (never divs with ARIA
 * roles). It is the inner table the StrategyTable reshape and the 52/53 replicas
 * build on; it does NOT replace the existing `ResponsiveTable` scroll/landmark
 * wrapper (that stays the `role="region"` horizontal-scroll affordance with its
 * unique `aria-label`). Table here owns the table semantics.
 *
 * Accessible name (50-UI-SPEC §Table base): pass `aria-label` (or
 * `aria-labelledby`, or render a `<caption>` child). A page with more than one
 * table MUST give each a DISTINCT name so axe `landmark-unique` and the SR
 * landmark rotor stay clean — this primitive hard-codes NO default name, so it
 * cannot manufacture a collision (the caller is responsible for a distinct name,
 * exactly as `ResponsiveTable` requires for its region label).
 *
 * Type/visual (DESIGN.md table pattern): header labels `text-caption`; header
 * row bottom-border; hairline-separated rows with `hover:bg-page/50`. Numeric
 * cells keep `font-metric tabular-nums` (load-bearing for column alignment under
 * fluid type) via the `numeric` prop on `TableCell`.
 *
 * Security (T-50-04): every cell/header value renders as React-escaped children.
 * No `dangerouslySetInnerHTML`, no `innerHTML` sink, no `@radix-ui` import.
 */

import { cn } from "@/lib/utils";

/**
 * The semantic `<table>`. Name it via `aria-label`/`aria-labelledby` or a
 * `<caption>` child (visually-hidden is fine). Spreads native `<table>` attrs.
 */
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full border-collapse text-body", className)}
      {...props}
    />
  );
}

/** `<thead>`. */
export function TableHead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("border-b border-border", className)} {...props} />
  );
}

/** `<tbody>`. */
export function TableBody(
  props: React.HTMLAttributes<HTMLTableSectionElement>,
) {
  return <tbody {...props} />;
}

/** `<tr>` with a hairline separator and the DESIGN.md row hover. */
export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0 hover:bg-page/50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `<th>` — REQUIRES a `scope` (defaults to `"col"`). `scope="row"` supports the
 * future sticky first column (STATE-03). Header labels use `text-caption`.
 */
export function TableHeaderCell({
  scope = "col",
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  scope?: "col" | "row";
}) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-4 py-2 text-left align-middle text-caption font-medium text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `<td>`. `numeric` keeps the Geist-mono `font-metric tabular-nums` treatment
 * (right-aligned) the data columns rely on for column alignment.
 */
export function TableCell({
  numeric = false,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle text-text-primary",
        numeric && "text-right font-metric tabular-nums",
        className,
      )}
      {...props}
    />
  );
}
