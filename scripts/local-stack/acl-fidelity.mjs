#!/usr/bin/env node
/**
 * LOCAL-STACK ACL-FIDELITY GATE — does every privilege on the lane's `public`
 * schema equal what `supabase/schema/baseline.sql` declares? (Phase 164.4.2,
 * the fix for plan 08's checkpoint RED.)
 *
 * ⚠️ WHY THIS EXISTS. CI run 35886515179: `test_analytics_service_settings_and_vault_tick.sql`
 * failed because an authenticated NON-ADMIN could TRUNCATE public.system_settings on
 * the lane. PROD grants `authenticated` no TRUNCATE there. The lane had inherited
 * the Supabase image's default ACLs (ALL to anon/authenticated/service_role) on
 * every object the dump created, and the dump's GRANT lines can only add. Every
 * privilege and RLS gate on the lane was running against a WIDER catalogue than
 * PROD's, and nothing said so. `run.sh` now resets those defaults before the dump
 * loads; this gate is what proves the reset held, for EVERY object, every boot.
 *
 * WHAT IS COMPARED. For every table-class relation (tables, partitioned tables,
 * views, materialized views, foreign tables), every sequence and every function in
 * `public` (extension members excluded, and counted):
 *   EXPECTED = PostgreSQL's built-in default ACL for the object's owner
 *              (acldefault: owner gets ALL; a function also gives PUBLIC EXECUTE),
 *              then every GRANT/REVOKE line the dump carries for that object,
 *              applied in file order.
 *   ACTUAL   = aclexplode(relacl / proacl) read off the lane.
 * And the schema's default ACLs: EXPECTED = exactly the dump's
 * `ALTER DEFAULT PRIVILEGES ... IN SCHEMA "public"` lines; ACTUAL = pg_default_acl.
 * Column-level grants (`GRANT SELECT("col") ...`) live in pg_attribute.attacl,
 * which a default ACL never touches, so they are counted and not compared.
 *
 * ⛔ A line of the dump that grants or revokes on a public object in a shape this
 * gate does not parse is a MEASURE_FAIL, never skipped. So is a dump object the
 * lane does not have, an empty catalogue, or a catalogue line it cannot read.
 *
 * USAGE
 *   node scripts/local-stack/acl-fidelity.mjs --dump <baseline.sql> --catalogue <rows>
 *   (<rows> is the output of `psql -X -q -At -F '|' -f scripts/local-stack/acl-fidelity-catalogue.sql`)
 *
 * PRINTS one always-on line:
 *   acl-fidelity: relations=<R> functions=<F> default-acl-entries=<D> privileges-compared=<P> column-grants-not-compared=<C> extension-members-excluded=<E> drift=<N> verdict <OK|DRIFT|MEASURE_FAIL>
 * EXIT 0 = OK, 1 = DRIFT (each difference named above the line), 2 = MEASURE_FAIL.
 */
import { readFileSync } from "node:fs";

const TABLE_ALL = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const SEQ_ALL = ["USAGE", "SELECT", "UPDATE"];
const FN_ALL = ["EXECUTE"];
const TYPE_ALL = ["USAGE"];
const DEFACL_ALL = { r: TABLE_ALL, S: SEQ_ALL, f: FN_ALL, T: TYPE_ALL };
const DEFACL_KIND = { TABLES: "r", SEQUENCES: "S", FUNCTIONS: "f", TYPES: "T" };

function line(fields, verdict) {
  console.log(`acl-fidelity: ${fields} verdict ${verdict}`);
}

function measureFail(msg) {
  console.error(`::error::acl-fidelity MEASURE_FAIL: ${msg}`);
  line("drift=unknown", "MEASURE_FAIL");
  process.exit(2);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) measureFail(`missing ${name} <file>`);
  return process.argv[i + 1];
}

const unquote = (s) => s.replace(/"/g, "");
const grantee = (s) => (s.trim() === "PUBLIC" ? "PUBLIC" : unquote(s.trim()));

/** "ALL" or "SELECT,INSERT" -> privilege names, for a kind's ALL set. */
function privs(list, all, where) {
  if (list === "ALL") return all;
  const out = list.split(",").map((p) => p.trim());
  for (const p of out) {
    if (!all.includes(p)) measureFail(`privilege '${p}' is not valid for this object kind: ${where}`);
  }
  return out;
}

// ── the dump ────────────────────────────────────────────────────────────────
const dumpPath = arg("--dump");
const catPath = arg("--catalogue");
let dump, cat;
try {
  dump = readFileSync(dumpPath, "utf8");
  cat = readFileSync(catPath, "utf8");
} catch (e) {
  measureFail(`could not read an input: ${e.message}`);
}

/** object key -> ordered list of {op, grantee, privs} */
const dumpOps = new Map();
const dumpKind = new Map(); // key -> "rel"|"fn"
const defaclExpected = new Set(); // "role|objtype|grantee|PRIV"
let columnGrants = 0;

const REL_RE = /^(GRANT|REVOKE) (.+) ON (TABLE|SEQUENCE) "public"\."([^"]+)" (TO|FROM) (.+);$/;
const FN_RE = /^(GRANT|REVOKE) (.+?) ON FUNCTION ("public"\."[^"]+"\(.*\)) (TO|FROM) (.+);$/;
const DEF_RE = /^ALTER DEFAULT PRIVILEGES FOR ROLE "([^"]+)" IN SCHEMA "public" (GRANT|REVOKE) (.+) ON (TABLES|SEQUENCES|FUNCTIONS|TYPES) (TO|FROM) (.+);$/;

for (const raw of dump.split("\n")) {
  const l = raw.trimEnd();
  if (!/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/.test(l)) continue;
  if (/ ON SCHEMA /.test(l)) continue; // schema ACL is the image's and the dump's USAGE grants; not an object ACL
  if (/ WITH GRANT OPTION| GRANTED BY /.test(l)) measureFail(`a grant option or GRANTED BY clause is not modelled: ${l}`);
  let m;
  if ((m = l.match(DEF_RE))) {
    const [, role, op, list, kindWord, , who] = m;
    if (op !== "GRANT") measureFail(`a default-privilege REVOKE is not modelled: ${l}`);
    const t = DEFACL_KIND[kindWord];
    for (const p of privs(list, DEFACL_ALL[t], l)) defaclExpected.add(`${role}|${t}|${grantee(who)}|${p}`);
    continue;
  }
  if (/^ALTER DEFAULT PRIVILEGES/.test(l)) measureFail(`unparsed default-privilege line: ${l}`);
  if ((m = l.match(REL_RE))) {
    const [, op, list, kw, name, , who] = m;
    if (list.includes("(")) {
      columnGrants++;
      continue;
    }
    const all = kw === "SEQUENCE" ? SEQ_ALL : TABLE_ALL;
    if (!dumpOps.has(name)) dumpOps.set(name, []);
    dumpKind.set(name, "rel");
    dumpOps.get(name).push({ op, who: grantee(who), privs: privs(list, all, l), all });
    continue;
  }
  if ((m = l.match(FN_RE))) {
    const [, op, list, sig, , who] = m;
    const key = unquote(sig);
    if (!dumpOps.has(key)) dumpOps.set(key, []);
    dumpKind.set(key, "fn");
    dumpOps.get(key).push({ op, who: grantee(who), privs: privs(list, FN_ALL, l), all: FN_ALL });
    continue;
  }
  if (/"public"\./.test(l)) measureFail(`a GRANT/REVOKE on a public object in a shape this gate does not parse: ${l}`);
}
if (dumpOps.size === 0) measureFail(`the dump ${dumpPath} declares no table, sequence or function privilege at all`);

// ── the lane's catalogue ────────────────────────────────────────────────────
const objs = new Map(); // key -> {kind, relkind, owner}
const actual = new Set(); // "key|grantee|PRIV"
const defaclActual = new Set();
let extensionMembers = null;

for (const raw of cat.split("\n")) {
  if (raw === "") continue;
  const f = raw.split("|");
  if (f[0] === "excluded-extension-members" && f.length === 2 && /^\d+$/.test(f[1])) {
    extensionMembers = Number(f[1]);
  } else if (f[0] === "obj" && f.length === 5) {
    objs.set(f[3], { kind: f[1], relkind: f[2], owner: f[4] });
  } else if (f[0] === "acl" && f.length === 5) {
    const [priv, grantable] = f[4].split(":");
    // A grant option is never declared by the dump (0 WITH GRANT OPTION lines);
    // a grantable privilege on the lane is drift, named as such.
    actual.add(`${f[2]}|${f[3]}|${priv}${grantable === "true" ? "+GRANTABLE" : ""}`);
  } else if (f[0] === "defacl" && f.length === 5) {
    const [priv, grantable] = f[4].split(":");
    defaclActual.add(`${f[1]}|${f[2]}|${f[3]}|${priv}${grantable === "true" ? "+GRANTABLE" : ""}`);
  } else {
    measureFail(`unrecognised catalogue line: '${raw}'`);
  }
}
if (extensionMembers === null) measureFail("the catalogue carries no excluded-extension-members line — it is not this gate's query output");
if (objs.size === 0) measureFail("the catalogue lists NO public object — an empty lane is not a faithful one");

// ── expected, object by object ──────────────────────────────────────────────
const expected = new Set();
let relations = 0;
let functions = 0;
for (const [key, o] of objs) {
  if (o.kind === "rel") relations++;
  else functions++;
  const all = o.kind === "fn" ? FN_ALL : o.relkind === "S" ? SEQ_ALL : TABLE_ALL;
  const acl = new Map(); // grantee -> Set(priv)
  const add = (who, ps) => {
    if (!acl.has(who)) acl.set(who, new Set());
    for (const p of ps) acl.get(who).add(p);
  };
  add(o.owner, all); // acldefault: the owner holds every privilege of the kind
  if (o.kind === "fn") add("PUBLIC", FN_ALL); // acldefault('f'): PUBLIC EXECUTE
  for (const op of dumpOps.get(key) ?? []) {
    if (op.op === "GRANT") add(op.who, op.privs);
    else for (const p of op.privs) acl.get(op.who)?.delete(p);
  }
  for (const [who, ps] of acl) for (const p of ps) expected.add(`${key}|${who}|${p}`);
}

const missingObjects = [...dumpKind.keys()].filter((k) => !objs.has(k));
if (missingObjects.length > 0) {
  measureFail(
    `${missingObjects.length} object(s) the dump grants on are not in the lane's catalogue (a signature this gate normalises differently, or a missing object), e.g. ${missingObjects.slice(0, 5).join("; ")}`,
  );
}

const diffs = [];
for (const k of actual) if (!expected.has(k)) diffs.push(`EXTRA    ${k}  (on the lane, not declared by the dump)`);
for (const k of expected) if (!actual.has(k)) diffs.push(`MISSING  ${k}  (declared by the dump, absent on the lane)`);
for (const k of defaclActual) if (!defaclExpected.has(k)) diffs.push(`EXTRA    default-acl ${k}  (pg_default_acl on public, not in the dump)`);
for (const k of defaclExpected) if (!defaclActual.has(k)) diffs.push(`MISSING  default-acl ${k}  (in the dump, absent from pg_default_acl)`);

const LIMIT = 40;
for (const d of diffs.slice(0, LIMIT)) console.log(`acl-drift: ${d}`);
if (diffs.length > LIMIT) console.log(`acl-drift: … and ${diffs.length - LIMIT} more`);

const fields = [
  `relations=${relations}`,
  `functions=${functions}`,
  `default-acl-entries=${defaclActual.size}`,
  `privileges-compared=${expected.size + defaclExpected.size}`,
  `column-grants-not-compared=${columnGrants}`,
  `extension-members-excluded=${extensionMembers}`,
  `drift=${diffs.length}`,
].join(" ");
if (diffs.length > 0) {
  console.error(
    `::error::acl-fidelity DRIFT: ${diffs.length} privilege(s) on the lane's public schema differ from what supabase/schema/baseline.sql declares. Every privilege/RLS gate on this lane would be measuring a catalogue that is not PROD's.`,
  );
  line(fields, "DRIFT");
  process.exit(1);
}
line(fields, "OK");
