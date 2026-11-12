/**
 * Phase 201 plan 06 (D-08, D-03, D-11, D-19, D-21): the copy census scanner. MECHANISM ONLY.
 *
 * This file holds AST visitors and takes a `ScanPolicy`. Every word list, scope, exception and
 * reason lives in `policy.ts`, so a surface plan never edits this file, and the scanner imports
 * nothing from the app: it lives under `scripts/`, so nothing the app bundles pulls `typescript`
 * in, and its words cannot drift with the code they judge (the `figure-gate-census` header rule).
 *
 * THE RULES (what each looks for is in `policy.ts`):
 *   A  a retired word in JSX text, a user-visible attribute or property, a prose-shaped string or
 *      a template part. Never in comments, imports, class names, test ids, log calls or
 *      query-builder arguments.
 *   B  a registered term's label or alias in a label position without a `Term` wrapper or a
 *      `term` marker.
 *   C  a date printed by anything but the one helper. Besides the date APIs, month arrays, deprecated
 *      helpers and printed ISO slices, it reads one literal form: `iso-literal`, a YYYY-MM-DD day typed
 *      into JSX text (F-11, D-11, review R3-01, plan 201-40). A second, `date-field`, reads a raw date
 *      FIELD printed with no call around it: a JSX child (also behind `&&`), the value of a copy
 *      attribute (`USER_ATTRS`), or a template literal with prose or a dash or arrow in its literal
 *      parts, whose printed value is one of the field names in `policy.dates.fieldNames`. A third,
 *      `axis-date-key` (Phase 201.1 D-02, U-06), reads a Recharts `XAxis` whose `dataKey` is a string
 *      literal naming one of `policy.dates.axisDateKeys`, with no `tickFormatter` attribute and a
 *      `tick` that is absent or a style (an object literal or an identifier): Recharts then prints the
 *      raw ISO day. A `tick` given a JSX element or a function is a renderer and is not read.
 *      The scanner holds no name or key list. BLIND SPOTS, stated: a date printed through a neutral name
 *      (`first`), through a call (a local converter, a slice other than 0..7 or 0..10, a
 *      `toISOString()` held in a variable), through a display prop outside `USER_ATTRS` (`value`,
 *      `subtitle`, …; review GC2-02), or as a string literal outside JSX text is not read by
 *      these forms. The R3-01 sites of those shapes carry a rendered-text pin instead (plans 201-37
 *      to 201-39). The `axis-date-key` form adds its own: a `dataKey` given as an expression
 *      (`dataKey={key}`) is not read; a formatter that itself prints an ISO fragment
 *      (`(d) => d.slice(5)`, O-1 in the Phase 201.1 UI-SPEC) is deliberately neither reported nor
 *      excepted, because the form only asks whether a formatter exists; and the tick text Recharts
 *      produces at run time is invisible to a syntax scanner, so the rendered-tick pin of plan
 *      201.1-15 is the second half of that gate.
 *
 * ONE HIT PER NODE PER RULE. A node carrying three retired words is one hit, so the hit count
 * for a file moves by one when one string is fixed.
 *
 * READ `JsxText.text`, NEVER `getText()`: `getText` drops leading whitespace as trivia and hides
 * a hit that starts a line (RESEARCH, "Scanner core").
 *
 * This is a heuristic over syntax, not a type-aware analysis, and it says so: a retired word
 * assembled at run time is invisible to it, and a lowercase single-token string outside a
 * copy-named position is treated as an identifier. Plan 201-25 classifies what it reports.
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type CensusRule = "A" | "B" | "C";

export interface CensusHit {
  rule: CensusRule;
  /** The matcher id (rule A), the registry key (rule B) or the date form (rule C). */
  id: string;
  /** Repo-relative, forward slashes. */
  file: string;
  line: number;
  kind: string;
  text: string;
}

export interface WordMatcher {
  id: string;
  re: RegExp;
}

/** One printed form of a registered term (rule B). */
export interface TermMatcher {
  key: string;
  form: string;
  /** True for a form that ends where an interpolation begins (`α vs `): matched as a plain prefix. */
  prefix: boolean;
  /** Narrows the form to some files (the discovery-only keys). Absent means every file rule B covers. */
  appliesTo?: (file: string) => boolean;
}

/** What rule C reads. Words only; the visitors that use them are below. */
export interface DatePolicy {
  /** Helper names whose use, by call or by reference, is a hit. */
  deprecatedHelpers: readonly string[];
  /** Month names; an array literal holding three distinct ones is a hit. */
  monthNames: readonly string[];
  /** `toLocaleString` option keys that print a date part. */
  optionKeys: readonly string[];
  /**
   * Field and variable names whose raw value is a display date at a site Phase 201 moved to the
   * helper (F-11). A JSX child or a prose template that prints one with no call around it is a hit.
   */
  fieldNames: readonly string[];
  /**
   * `dataKey` values of a Recharts `XAxis` whose raw value is an ISO day (Phase 201.1 D-02, U-06).
   * An `XAxis` on one of these with no `tickFormatter` and no tick renderer is a hit.
   */
  axisDateKeys: readonly string[];
}

export interface ScanPolicy {
  /** Does `rule` cover this repo-relative file? Scopes and excluded files live behind it. */
  applies(rule: CensusRule, file: string): boolean;
  /** Rule A. */
  retiredWords: readonly WordMatcher[];
  /** Rule B. Order does not matter: the scanner tries the longest form first. */
  terms: readonly TermMatcher[];
  /** Rule C. */
  dates: DatePolicy;
}

/** Attributes and property names whose string values are printed. */
const USER_ATTRS: ReadonlySet<string> = new Set([
  "label", "title", "placeholder", "aria-label", "ariaLabel", "alt",
  "heading", "body", "helper", "tooltip", "description", "caption",
]);

/** Attributes that never carry copy. A string reached through one of these is skipped. */
const NON_COPY_ATTRS: ReadonlySet<string> = new Set([
  "className", "class", "id", "key", "ref", "href", "src", "type", "htmlFor", "role", "style",
]);

const LOG_ROOTS: ReadonlySet<string> = new Set(["console", "logger", "Sentry"]);
const CAPTURE_CALLS: ReadonlySet<string> = new Set(["captureMessage", "captureException", "captureToSentry"]);
const QUERY_METHODS: ReadonlySet<string> = new Set([
  "from", "select", "rpc", "eq", "in", "order", "insert", "update", "delete", "channel", "not", "is", "neq", "or",
]);

const norm = (s: string): string => s.replace(/\s+/g, " ");

function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

function isFunctionLike(n: ts.Node): boolean {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
}

/** The attribute a value expression sits in, reached through expression wrappers only. */
function enclosingAttr(n: ts.Node): ts.JsxAttribute | undefined {
  for (let a = n.parent; a; a = a.parent) {
    if (ts.isJsxAttribute(a)) return a;
    if (isFunctionLike(a) || ts.isJsxElement(a) || ts.isJsxSelfClosingElement(a) || ts.isJsxFragment(a)) return undefined;
  }
  return undefined;
}

/** `console`, `logger`, `Sentry` root of a property-access or call chain. */
function chainRoot(e: ts.Expression): string | undefined {
  let cur: ts.Expression = e;
  for (;;) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return undefined;
  }
}

function isSkippedCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return CAPTURE_CALLS.has(callee.text) || callee.text === "require";
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    if (CAPTURE_CALLS.has(name) || QUERY_METHODS.has(name)) return true;
    const root = chainRoot(callee);
    return root !== undefined && LOG_ROOTS.has(root);
  }
  return false;
}

/** Is `n` inside the ARGUMENTS of a log, capture, query-builder, `require` or `import()` call? */
function inSkippedCall(n: ts.Node): boolean {
  let child: ts.Node = n;
  for (let a = n.parent; a; child = a, a = a.parent) {
    if (ts.isCallExpression(a) && a.arguments.includes(child as ts.Expression) && isSkippedCallee(a.expression)) {
      return true;
    }
  }
  return false;
}

interface Candidate {
  text: string;
  /** Untrimmed, whitespace-normalised: template parts keep the space that marks adjacent prose. */
  raw: string;
  kind: string;
}

/** The copy-bearing text of `n`, or null when `n` carries none or sits where copy never goes. */
function candidateOf(n: ts.Node): Candidate | null {
  if (ts.isJsxText(n)) {
    const raw = norm(n.text);
    return { text: raw.trim(), raw, kind: "jsx-text" };
  }
  if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
    const raw = norm(n.text);
    return skipsCopy(n) ? null : { text: raw.trim(), raw, kind: "template" };
  }
  if (!ts.isStringLiteral(n) && !ts.isNoSubstitutionTemplateLiteral(n)) return null;
  const p = n.parent;
  if (
    ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) ||
    ts.isCaseClause(p) || ts.isEnumMember(p) || ts.isExternalModuleReference(p) ||
    (ts.isPropertyAssignment(p) && p.name === n) ||
    (ts.isPropertyDeclaration(p) && p.name === n) ||
    (ts.isElementAccessExpression(p) && p.argumentExpression === n)
  ) {
    return null;
  }
  if (skipsCopy(n)) return null;
  const raw = norm(n.text);
  // A copy-named attribute or property keeps even a lowercase single token, bare or wrapped
  // (`label="x"`, `label={"x"}`, `label: cond ? "x" : "y"`).
  let kind = "string";
  const top = unwrapUp(n);
  const holder = top.parent;
  if (ts.isJsxAttribute(holder) && holder.initializer === top && USER_ATTRS.has(holder.name.getText())) kind = "jsx-attr";
  else if (ts.isPropertyAssignment(holder) && holder.initializer === top && USER_ATTRS.has(propName(holder))) kind = "property";
  return { text: raw.trim(), raw, kind };
}

function propName(p: ts.PropertyAssignment): string {
  return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";
}

/** A string that sits where copy never goes: a non-copy attribute, a log or query call. */
function skipsCopy(n: ts.Node): boolean {
  const attr = enclosingAttr(n);
  if (attr) {
    const name = attr.name.getText();
    if (NON_COPY_ATTRS.has(name) || name.startsWith("data-")) return true;
    // A direct string attribute outside the copy-named set (an `aria-*` role, `autoComplete`, ...).
    if (n.parent === attr && !USER_ATTRS.has(name)) return true;
  }
  return inSkippedCall(n);
}

/** Attribute and property names that put a term in a label position (rule B). */
const LABEL_NAMES: ReadonlySet<string> = new Set(["label", "title", "heading"]);

/** Label-shaped: at most 40 characters and 5 words, and not a sentence, question or exclamation. */
function labelShaped(trimmed: string): boolean {
  return (
    trimmed.length > 0 &&
    trimmed.length <= 40 &&
    trimmed.split(" ").length <= 5 &&
    !/[.?!]$/.test(trimmed)
  );
}

const sortedTermsCache = new WeakMap<ScanPolicy, readonly TermMatcher[]>();

/** The policy's terms, longest form first, so "Sharpe lift" is its own key and not "Sharpe". */
function termsLongestFirst(policy: ScanPolicy): readonly TermMatcher[] {
  let sorted = sortedTermsCache.get(policy);
  if (!sorted) {
    sorted = [...policy.terms].sort((x, y) => y.form.length - x.form.length);
    sortedTermsCache.set(policy, sorted);
  }
  return sorted;
}

/** The term a label-shaped `lead` (left-trimmed, whitespace-normalised) names: the form itself, or the form then a space or `(`. */
function matchTerm(terms: readonly TermMatcher[], file: string, lead: string): TermMatcher | undefined {
  return terms.find((t) => {
    if (t.appliesTo && !t.appliesTo(file)) return false;
    return t.prefix
      ? lead.startsWith(t.form)
      : lead === t.form || lead.startsWith(`${t.form} `) || lead.startsWith(`${t.form}(`);
  });
}

function hasTermAttr(attrs: ts.JsxAttributes): boolean {
  return attrs.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "term");
}

function hasTermProperty(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some(
    (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "term",
  );
}

/** JSX text is covered by a `Term` ancestor in the same render scope, or a `term` attribute on its own element. */
function jsxTextCovered(t: ts.JsxText, sf: ts.SourceFile): boolean {
  const own = t.parent;
  if (ts.isJsxElement(own) && hasTermAttr(own.openingElement.attributes)) return true;
  for (let a: ts.Node | undefined = t.parent; a; a = a.parent) {
    if (isFunctionLike(a)) return false;
    if (ts.isJsxElement(a) && a.openingElement.tagName.getText(sf) === "Term") return true;
  }
  return false;
}

/** Climb out of the expression wrappers a value can sit in (`cond ? "x" : "y"`, `a ?? "x"`, `{"x"}`, `("x" as const)`). */
function unwrapUp(n: ts.Expression): ts.Node {
  let cur: ts.Node = n;
  for (;;) {
    const p: ts.Node = cur.parent;
    if (
      ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) ||
      ts.isNonNullExpression(p) || ts.isJsxExpression(p)
    ) {
      cur = p;
    } else if (ts.isConditionalExpression(p) && p.condition !== cur) {
      cur = p;
    } else if (
      ts.isBinaryExpression(p) &&
      (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      cur = p;
    } else {
      return cur;
    }
  }
}

function callName(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function isIntlDateTimeFormat(e: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    e.name.text === "DateTimeFormat" &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "Intl"
  );
}

/** `(new Date(x)).toLocaleString()` and `new Date(x).toLocaleString()`. */
function receiverIsNewDate(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee)) return false;
  let r: ts.Expression = callee.expression;
  while (ts.isParenthesizedExpression(r)) r = r.expression;
  return ts.isNewExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === "Date";
}

function hasDateOptions(call: ts.CallExpression, keys: ReadonlySet<string>): boolean {
  return call.arguments.some(
    (arg) =>
      ts.isObjectLiteralExpression(arg) &&
      arg.properties.some(
        (p) =>
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
          keys.has(p.name.text),
      ),
  );
}

/** An identifier that merely names a thing in an import, export or declaration is not a use. */
function isNamingPosition(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    (ts.isFunctionDeclaration(p) && p.name === id)
  );
}

/** `x.slice(0, 10)`, `x.slice(0, 7)` or the `substring` twin: the ISO day or month prefix of a string. */
function isIsoPrefixSlice(n: ts.CallExpression): boolean {
  const name = callName(n.expression);
  if (name !== "slice" && name !== "substring") return false;
  const [from, to] = n.arguments;
  return (
    n.arguments.length === 2 &&
    ts.isNumericLiteral(from) && from.text === "0" &&
    ts.isNumericLiteral(to) && (to.text === "10" || to.text === "7")
  );
}

/** A `toISOString()` call, so the slice is a date and not an array. */
function isToISOString(e: ts.Expression): boolean {
  return ts.isCallExpression(e) && callName(e.expression) === "toISOString";
}

const WRAPS_VALUE = (n: ts.Node): boolean =>
  ts.isParenthesizedExpression(n) || ts.isTemplateSpan(n) || ts.isTemplateExpression(n) ||
  ts.isBinaryExpression(n) || ts.isConditionalExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n);

/**
 * F-11 / D-11: an ISO prefix slice that is printed. Three positions count, and nothing else does:
 * a value in JSX text (`<td>{d.slice(0, 10)}</td>`, including inside a template or a ternary there),
 * the body of a `labelFormatter` attribute (a chart tooltip label), and the returned value of a
 * function whose own name says it formats (`formatGrantDate`, `fmtDay`) when the receiver is `toISOString()`.
 * An array slice (`rows.slice(0, 10).map(...)`), a comparison, an attribute value (`value=`, `key=`),
 * a filename and a plain logic helper are machine values and do not count. What this cannot see is a
 * date that reaches the screen through a helper with a neutral name: that stays the reviewer's job.
 */
function isIsoSliceDisplay(n: ts.CallExpression): boolean {
  if (!isIsoPrefixSlice(n)) return false;
  let top: ts.Node = n;
  while (top.parent && WRAPS_VALUE(top.parent)) top = top.parent;
  const p = top.parent;
  if (!p) return false;
  if (ts.isJsxExpression(p)) return ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent);
  if (ts.isArrowFunction(p) && p.body === top) {
    const attr = p.parent?.parent;
    if (ts.isJsxExpression(p.parent) && ts.isJsxAttribute(attr) && attr.name.getText() === "labelFormatter") return true;
  }
  const callee = (n.expression as ts.PropertyAccessExpression).expression;
  if (!isToISOString(callee)) return false;
  if (!ts.isReturnStatement(p) && !(ts.isArrowFunction(p) && p.body === top)) return false;
  let fn: ts.Node | undefined = p;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  if (!fn) return false;
  const named = ts.isFunctionDeclaration(fn) ? fn.name : ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined;
  return named !== undefined && ts.isIdentifier(named) && /^(format|fmt)/.test(named.text);
}

/** Unwrap a printed expression to its leaves: through parentheses, `!`, `as`, `satisfies`, both conditional branches, both operands of `??` and `||`, and the right operand of `&&` (its left is a condition, not a printed value). */
function printedLeaves(e: ts.Expression): ts.Expression[] {
  if (
    ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)
  ) {
    return printedLeaves(e.expression);
  }
  if (ts.isConditionalExpression(e)) return [...printedLeaves(e.whenTrue), ...printedLeaves(e.whenFalse)];
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return printedLeaves(e.right);
  if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...printedLeaves(e.left), ...printedLeaves(e.right)];
  }
  return [e];
}

/** The name a leaf prints: an identifier, a property's final name, or the object of a numeric-literal index (`range[0]`). */
function leafName(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isNumericLiteral(e.argumentExpression)) {
    let obj: ts.Expression = e.expression;
    while (ts.isParenthesizedExpression(obj) || ts.isNonNullExpression(obj) || ts.isAsExpression(obj)) obj = obj.expression;
    return leafName(obj);
  }
  return undefined;
}

/** Does `e` print one of the policy's date field names, with no call around it? */
function printsDateField(e: ts.Expression, names: ReadonlySet<string>): boolean {
  return printedLeaves(e).some((leaf) => {
    const name = leafName(leaf);
    return name !== undefined && names.has(name);
  });
}

const snippet = (n: ts.Node, sf: ts.SourceFile): string => norm(n.getText(sf)).slice(0, 80);

/** A YYYY-MM-DD day, word-bounded so a longer digit run or a phone-like number is not one. Mechanism, like the 0..10 slice bounds. */
const ISO_DAY_RE = /\b\d{4}-\d{2}-\d{2}\b/;

/** The attribute named `name` among a JSX element's attributes, or undefined. Spread attributes are not read. */
function jsxAttr(attrs: ts.JsxAttributes, name: string, sf: ts.SourceFile): ts.JsxAttribute | undefined {
  for (const a of attrs.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText(sf) === name) return a;
  }
  return undefined;
}

/**
 * An `XAxis` on a date key that neither formats nor renders its ticks (Phase 201.1 D-02, U-06).
 * Reads a string-literal `dataKey` only. `tick` counts as a renderer when it is a JSX element or a
 * function; absent, an object literal or an identifier is a style, which prints the raw value.
 */
function isUnformattedDateAxis(attrs: ts.JsxAttributes, keys: ReadonlySet<string>, sf: ts.SourceFile): boolean {
  const key = jsxAttr(attrs, "dataKey", sf)?.initializer;
  if (!key || !ts.isStringLiteral(key) || !keys.has(key.text)) return false;
  if (jsxAttr(attrs, "tickFormatter", sf)) return false;
  const tick = jsxAttr(attrs, "tick", sf);
  if (!tick) return true;
  const init = tick.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return false;
  let e: ts.Expression = init.expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return ts.isObjectLiteralExpression(e) || ts.isIdentifier(e);
}

export function scanSource(file: string, source: string, policy: ScanPolicy): CensusHit[] {
  const wantA = policy.applies("A", file);
  const wantB = policy.applies("B", file);
  const wantC = policy.applies("C", file);
  if (!wantA && !wantB && !wantC) return [];
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: CensusHit[] = [];

  const ruleA = (n: ts.Node): void => {
    const c = candidateOf(n);
    if (!c || !c.text) return;
    const prose = /\s/.test(c.kind === "template" ? c.raw : c.text) && !c.text.startsWith("[");
    const keep = c.kind === "jsx-text" || c.kind === "jsx-attr" || c.kind === "property" || prose || /^[A-Z]/.test(c.text);
    if (!keep) return;
    const m = policy.retiredWords.find((w) => w.re.test(c.text));
    if (m) out.push({ rule: "A", id: m.id, file, line: lineOf(sf, n), kind: c.kind, text: c.text });
  };

  const terms = wantB ? termsLongestFirst(policy) : [];
  const ruleB = (n: ts.Node): void => {
    let raw: string;
    let kind: string;
    if (ts.isJsxText(n)) {
      if (jsxTextCovered(n, sf)) return;
      raw = norm(n.text);
      kind = "jsx-text";
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      const top = unwrapUp(n);
      const holder = top.parent;
      if (ts.isJsxAttribute(holder) && holder.initializer === top && LABEL_NAMES.has(holder.name.getText(sf))) {
        if (hasTermAttr(holder.parent)) return;
        kind = "jsx-attr";
      } else if (
        ts.isPropertyAssignment(holder) && holder.initializer === top && LABEL_NAMES.has(propName(holder))
      ) {
        if (hasTermProperty(holder.parent)) return;
        kind = "property";
      } else {
        return;
      }
      if (inSkippedCall(n)) return;
      raw = norm(ts.isTemplateExpression(n) ? n.head.text : n.text);
    } else {
      return;
    }
    const lead = raw.trimStart();
    const trimmed = lead.trimEnd();
    if (!labelShaped(trimmed)) return;
    const m = matchTerm(terms, file, lead);
    if (m) out.push({ rule: "B", id: m.key, file, line: lineOf(sf, n), kind, text: trimmed });
  };

  const dates = policy.dates;
  const monthNames = new Set(dates.monthNames);
  const optionKeys = new Set(dates.optionKeys);
  const deprecated = new Set(dates.deprecatedHelpers);
  const fieldNames = new Set(dates.fieldNames);
  const axisDateKeys = new Set(dates.axisDateKeys);
  const ruleC = (n: ts.Node): void => {
    const hit = (id: string, kind: string, text?: string): void => {
      out.push({ rule: "C", id, file, line: lineOf(sf, n), kind, text: text ?? snippet(n, sf) });
    };
    if (ts.isJsxText(n)) {
      // `.text`, never `getText()`: one hit per text node, whatever the number of days in it.
      if (ISO_DAY_RE.test(n.text)) hit("iso-literal", "iso-literal", norm(n.text).trim().slice(0, 80));
    } else if (ts.isJsxExpression(n)) {
      // F-11 / D-11: a raw date field as a child of an element or fragment, or as the value of a copy attribute
      // (`aria-label`, `title`, ...). Any other attribute value is a machine value.
      const printed =
        ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent) || (ts.isJsxAttribute(n.parent) && USER_ATTRS.has(n.parent.name.getText(sf)));
      if (printed && n.expression && printsDateField(n.expression, fieldNames)) {
        hit("date-field", "date-field");
      }
    } else if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      // Phase 201.1 D-02 / U-06: a date XAxis nothing formats and nothing renders prints the raw ISO day.
      if (n.tagName.getText(sf) === "XAxis" && isUnformattedDateAxis(n.attributes, axisDateKeys, sf)) {
        hit("axis-date-key", "axis-date-key");
      }
    } else if (ts.isTemplateExpression(n)) {
      // One hit per template, and only a template with prose: `${id}:${asof}` is a key, `until ${d.until}` is a sentence,
      // and a dash or arrow between two fields, spaced or not, is a range.
      const prose = /[\s\u2013\u2192]/.test(n.head.text) || n.templateSpans.some((sp) => /[\s\u2013\u2192]/.test(sp.literal.text));
      if (prose && !skipsCopy(n) && n.templateSpans.some((sp) => printsDateField(sp.expression, fieldNames))) {
        hit("date-field", "date-field");
      }
    } else if (ts.isCallExpression(n)) {
      const name = callName(n.expression);
      if (name === "toLocaleDateString") hit("toLocaleDateString", "date-call");
      else if (name === "toLocaleString" && (hasDateOptions(n, optionKeys) || receiverIsNewDate(n.expression))) {
        hit("toLocaleString", "date-call");
      } else if (isIntlDateTimeFormat(n.expression)) hit("Intl.DateTimeFormat", "date-call");
      else if (isIsoSliceDisplay(n)) hit("iso-slice", "iso-slice");
    } else if (ts.isNewExpression(n)) {
      if (isIntlDateTimeFormat(n.expression)) hit("Intl.DateTimeFormat", "date-call");
    } else if (ts.isArrayLiteralExpression(n)) {
      const seen = new Set<string>();
      for (const e of n.elements) if (ts.isStringLiteral(e) && monthNames.has(e.text)) seen.add(e.text);
      if (seen.size >= 3) hit("month-names", "month-array");
    } else if (ts.isIdentifier(n) && deprecated.has(n.text) && !isNamingPosition(n)) {
      hit(n.text, "deprecated-helper");
    }
  };

  const visit = (n: ts.Node): void => {
    if (wantA) ruleA(n);
    if (wantB) ruleB(n);
    if (wantC) ruleC(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function isTestPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    /\.test\.[^/]+$/.test(rel) ||
    /\.spec\.[^/]+$/.test(rel) ||
    /\.d\.ts$/.test(rel) ||
    parts.includes("__tests__") ||
    parts.includes("__fixtures__")
  );
}

function walk(repoRoot: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(repoRoot, abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(repoRoot, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
}

/**
 * Every non-test `.ts` and `.tsx` file under `<repoRoot>/src`, in path order: the population
 * `scanTree` reads. Exported so the census counts walked files from the walker itself rather than
 * from a second walker that could drift from it.
 */
export function listScannedFiles(repoRoot: string): string[] {
  const files: string[] = [];
  walk(repoRoot, join(repoRoot, "src"), files);
  return files.sort();
}

/** Scan every non-test `.ts` and `.tsx` file under `<repoRoot>/src`, in path order. */
export function scanTree(repoRoot: string, policy: ScanPolicy): CensusHit[] {
  const hits: CensusHit[] = [];
  for (const rel of listScannedFiles(repoRoot)) {
    hits.push(...scanSource(rel, readFileSync(join(repoRoot, rel), "utf8"), policy));
  }
  return hits;
}
