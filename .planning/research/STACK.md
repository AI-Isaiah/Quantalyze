# Stack Research — v1.20 DEPS: the 9-PR dependabot campaign

**Domain:** Dependency-upgrade campaign on an existing production stack (Next.js 16 App Router + TS, vitest 4 two-project jsdom/node split, Playwright, FastAPI/Python 3.12 on Railway, Supabase, GitHub Actions with CI Node 22 / local Node 25). NOT new technology selection.
**Researched:** 2026-08-20
**Confidence:** HIGH on everything measured locally or read from a vendor's own release API / the npm+PyPI registries. MEDIUM on the TypeScript 7 ecosystem narrative (one WebSearch pass corroborating a primary-source `exports`-map read).

> **Supersedes** the stale v1.16 seam/rate-limit STACK.md that occupied this path. Prior content is preserved in `.planning/research/_archive-v1.16/`.

---

## Executive verdict

**Six of the nine PRs are cheap. One is a trap. One is a silent production downgrade. One must not land at all.**

The campaign as booked at `TODOS.md:798` assumed the npm group "genuinely fails `frontend-build`/`frontend-lint`/`contracts`/`deps-cache`" and would need bisecting across its members. **That is wrong, and it was measured wrong.** Every red job on #686 fails at the *same* step, before any of the repo's code is touched:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json ... are in sync.
npm error Missing: proxy-agent@8.0.2 from lock file
npm error Missing: agent-base@9.0.0 from lock file      (+12 more of the same subtree)
```

That is Dependabot shipping an **incomplete lockfile**, not 29 upstream breakages. `frontend-build`, `frontend-lint`, `frontend-typecheck`, `knip`, `contracts`, `deps-cache`, `frontend-policy`, `frontend-seam-redis` and `python` all start with `npm ci`. **Do not bisect the group. Rebase it and regenerate the lock with a local `npm install`.** The 12-package subtree Dependabot dropped is the one `@puppeteer/browsers@3.2.1` introduces under `puppeteer-core@25.8.0` — a transitive-graph change Dependabot's resolver mis-materialised.

*(Verified: `npm ci --dry-run` on `main` HEAD is clean, so the desync is introduced by the PR, not inherited.)*

The other two headline items:

- **#685 (pip group) would DOWNGRADE production pandas from 3.0.3 to 2.3.3.** Confirmed at the diff level: `analytics-service/requirements.txt` line reads `-pandas==3.0.3` / `+pandas==2.3.3`. Root cause is the `requirements.in` ↔ lock drift booked at `TODOS.md:1277` — commit `83680283` (PR #604) migrated the *lock* to pandas 3.0.3 but never updated `requirements.in`, which still says `pandas==2.2.3`. Dependabot reads the `.in` as the source manifest, computes "2.2.3 → 2.3.3", and rewrites the lock down to match. Railway builds from `requirements.txt`. **This is a silent revert of a shipped migration on the money-math service, hiding inside a routine 8-package minor bump.**
- **#614 (typescript 6.0.3 → 7.0.2) must NOT land.** TypeScript 7 is the Go native port. The npm package no longer exposes the JS compiler API, and this repo consumes it.

---

## Per-PR verdict table

| PR | Bump | Verdict | Risk | Own verification? |
|----|------|---------|------|-------------------|
| **#643** | `actions/checkout` 7.0.0 → 7.0.1 | **LAND FIRST** | Nil — patch, already on v7 | No — rides CI |
| **#627** | `actions/setup-python` 6.3.0 → 7.0.0 | **LAND** | Nil for this repo | No |
| **#626** | `actions/setup-node` 6.4.0 → 7.0.0 | **LAND** | Nil for this repo | No |
| **#612** | `supabase/setup-cli` 2.1.1 → 3.0.0 | **LAND, with a workflow read** | Low — install source changes GitHub→npm | Yes — watch the 4 call sites' `version: 2.98.2` resolve |
| **#685** | pip group, 8 updates | **LAND ONLY AFTER FIXING THE PANDAS PIN** | **HIGH — silent prod downgrade** | Yes — full pytest + `mypy --strict` |
| **#686** | npm group, 29 updates | **LAND AFTER REBASE + LOCK REGEN** | Medium — one prod-path member (puppeteer-core) | Yes — full suite + build + e2e |
| **#645** | `@testing-library/jest-dom` 6.9.1 → 7.0.0 | **LAND — but at 7.0.1** | Low | Yes — full vitest suite |
| **#646** | `jsdom` 29.1.1 → 30.0.0 | **LAND — but at 30.0.1** | Medium — engines exclude local Node 25 | Yes — full vitest suite |
| **#614** | `typescript` 6.0.3 → 7.0.2 | ⛔ **CLOSE — DO NOT LAND** | **Blocking — breaks lint + a coverage-law gate** | N/A |
| *#606* | `@lhci/cli` → old `uuid` audit chain | **CLOSE AS STALE** (see below) | Nil | N/A |

---

## The four landmines, in detail

### L1 — #686 fails for ONE reason, not 29 (measured)

**Claim in TODOS is wrong.** All nine red checks are downstream of a single `npm ci` EUSAGE. Fix:

```bash
git fetch origin && git checkout dependabot/npm_and_yarn/npm-minor-patch-096ac0e144
git rebase origin/main          # branch is 3 days stale
npm install                     # regenerates a COMPLETE lock incl. the proxy-agent subtree
git add package-lock.json && git commit
```

Only *after* a green `npm ci` is it meaningful to ask whether any member genuinely breaks. Expect it not to — but two members deserve a named gate (below).

**Members worth naming (26 of 29 are noise):**

| Member | Bump | Why it needs a look |
|--------|------|---------------------|
| `puppeteer-core` | 25.3.0 → 25.8.0 | **Production dependency** — the demo-PDF path (`@sparticuz/chromium` + the `demo-pdf-coldstart` nightly canary). New `@puppeteer/browsers@3.2.1` transitive graph. This is the only prod-runtime member with real behavioural surface. |
| `next` | 16.2.11 → 16.3.1 | Framework minor. `eslint-config-next` moves in lockstep (16.2.10 → 16.3.1), which is good — a split between them is the classic lint break. Engines `>=20.9.0`, satisfied. |
| `lightweight-charts` | 5.2.0 → 5.2.1 | Patch, but a **rendering behaviour change**: arrow/circle/square markers with `size > 1` are no longer re-clamped to 30px. Vendor states default-size markers render identically. Repo has 3 `toHaveScreenshot()` golden specs; those are green-by-skip today (WR-02), so this is latent rather than blocking — but flag it against any future golden bake. |
| `recharts` | 3.9.2 → 3.10.1 | 18 charts route through it + the breakpoint-gated `TouchTooltip`. Minor, but chart-DOM assertions are the repo's most snapshot-shaped tests. |
| `@playwright/test` | 1.61.1 → 1.62.1 | Ships a new browser build → the three golden specs' rendering baseline moves. Same green-by-skip caveat. |
| `knip` | 6.25.0 → 6.32.2 | Seven minors at once on a **blocking CI gate** (`knip` job). New detections = new unused-export findings. Most likely member to produce a real, legitimate red that is not a regression. |

### L2 — #685 downgrades production pandas (measured at the diff)

The eight members are `mypy 2.2.0→2.3.0`, `aiohttp 3.14.1→3.14.3`, `ccxt 4.5.64→4.5.73`, `fastapi 0.139.0→0.141.1`, `numpy 2.5.1→2.5.2`, `pandas 2.2.3→2.3.3`, `sentry-sdk 2.64.0→2.68.0`, `uvicorn 0.51.0→0.52.3`. Seven are fine. Pandas is not.

**The drift, stated precisely:**

| File | pandas today | What #685 writes |
|------|--------------|------------------|
| `analytics-service/requirements.in` (source manifest) | `2.2.3` | `2.3.3` |
| `analytics-service/requirements.txt` (the lock Railway/Docker/CI install) | **`3.0.3`** | **`2.3.3`** ← downgrade |

`requirements.in` has been lying since PR #604. The `.in` is what Dependabot reads; the lock is what ships. **Fix the `.in` to `3.0.3` FIRST, in its own commit on `main`, before touching #685.** Then let Dependabot rebase, or hand-edit the group PR so pandas is untouched.

Corollaries the planner must carry:
- pandas 3.0.3 requires Python ≥3.11; 2.3.3 requires ≥3.9. CI/prod is 3.12, so the downgrade would *not* fail loudly at install — it fails quietly at behaviour (pandas 3 changed copy-on-write and string-dtype defaults). **A green pytest run is not proof of safety here; the pin itself is the assertion.**
- The lock is a `uv pip compile --universal` artifact. Per `.github/dependabot.yml` and `requirements.in`'s own header, Dependabot's edit does **not** match that format — a human must re-run `cd analytics-service && make lock` (compiled against 3.12, never the local venv) and commit the regenerated file. Skipping this is how the format drifts.
- New transitive `aiohttp-fast-zlib==0.3.0` appears. `aiohttp` lands at 3.14.3, inside the deliberate `aiohttp<3.15` cap. No cap violation.
- `fastapi 0.139.0 → 0.141.1` is clean: no breaking changes across 0.140.0–0.141.1 (SSE/JSONL `status_code` fixes, `format_sse_event` line splitting, `response_model_*` for `Iterable` returns, `app.frontend(check_dir="auto")`), and PyPI `requires_dist` for `starlette` and `pydantic` is **byte-identical** between 0.139.0 and 0.141.1 (`starlette>=0.46.0`, `pydantic>=2.9.0`). The repo's lock pins `starlette==0.46.2` — still satisfied, no forced bump. ⚠️ The known ≥0.139 deferred-`include_router` behaviour (`app.routes` hides routes; use `iter_route_contexts`) is *unchanged*, not re-broken — but the coverage-law tests that walk routes are the first place a 0.141 regression would show, so run them explicitly.
- `mypy 2.2.0 → 2.3.0` lives in `requirements-dev.txt` and gates nothing in CI *before* the PR is opened. Per repo convention, run `mypy --strict` locally on `analytics-service/` before shipping — a minor mypy bump routinely surfaces new strict errors, and those must be fixed with `cast()`, never `# type: ignore`.

### L3 — TypeScript 7 is the native port and this repo consumes the compiler API

Measured from the registry (`npm view typescript@7.0.2`):

```
exports = {
  '.': './lib/version.cjs',        ← the ONLY root entrypoint
  './unstable/ast': ..., './unstable/fs': ..., './unstable/sync': ..., ...
}
dependencies = { '@typescript/typescript-darwin-arm64': '7.0.2', ...19 more native binaries }
```

The root export is `version.cjs`. `ts.SyntaxKind`, `ts.isCallExpression`, `ts.isTemplateExpression`, `createSourceFile` — none of them are reachable. A stable programmatic API is slated for **7.1**; Microsoft shipped `@typescript/typescript6` (a `tsc6` binary re-exporting the 6.0 API) as the compatibility shim.

**Two hard blockers in this repo:**

1. `src/lib/seam-log-coverage.test.ts:6` — `import ts from "typescript"` and ~40 `ts.*` AST calls (`ts.SyntaxKind.PlusToken`, `ts.isBinaryExpression`, `ts.isCatchClause`, …). This is the **error-classification coverage law** — the gate that roots the still-open WIZFORM-02 class. Under TS 7 it does not fail informatively; it fails at import.
2. `eslint.config.mjs` pulls `eslint-config-next/typescript` → `typescript-eslint@8.58.0`, whose peer range is **`typescript: '>=4.8.4 <6.1.0'`**. `7.0.2` is outside it. Type-aware linting requires TypeScript 6 under the hood, by upstream's own statement.

**Verdict: close #614 with a comment.** `typescript@6.0.3` is already the newest 6.x, so there is nothing to bump to. Revisit only when *all three* hold: TS 7.1 ships the stable API, typescript-eslint widens its peer range, and `seam-log-coverage.test.ts` has a migration target. Do not attempt the `@typescript/typescript6` alias shim inside this milestone — it buys a faster `tsc` in exchange for a two-compiler build and a rewritten coverage-law gate, which is a milestone of its own.

### L4 — jsdom 30's engines exclude the local Node, not CI

jsdom 30.0.0's *only* breaking change is `engines: { node: '^22.22.2 || ^24.15.0 || >=26.0.0' }`.

| Environment | Version | Satisfies? |
|-------------|---------|-----------|
| CI (`node-version: 22` at 16 workflow sites, `.nvmrc` = `22`) | latest 22.x ≥ 22.22.2 | ✅ |
| **Local dev** | **v25.8.1** | ❌ — not `^22`, not `^24`, not `>=26` |

This inverts the repo's usual CI-vs-local hazard. `engines` is advisory (`EBADENGINE` warning) unless `engine-strict` is set, so `npm install` still works — but the campaign's own gate is "full local suite each", and the local runtime is formally unsupported by the dependency being landed. **Decide this explicitly** rather than discovering it as a flake: either accept the warning and treat CI Node 22 as the authority for this PR, or run the jsdom-30 verification pass under `PATH=/opt/homebrew/opt/node@22/bin` (the repo's existing CI-repro recipe).

Also: **land 30.0.1, not the 30.0.0 the PR pins.** 30.0.0 regressed `getComputedStyle()` with `calc()` and other CSS functions — thrown exception — and 30.0.1 (2026-07-29) fixes it. This repo's a11y and visual test lanes lean on computed style; landing 30.0.0 verbatim buys a two-day-old known regression for no reason.

**Bonus, in jsdom 30's favour:** it moves `undici` from 7.x to `^8.9.0`, which clears the `undici 7.0.0–7.28.0` high-severity advisory currently entering the dev tree solely via `jsdom@29.1.1`.

---

## Per-PR breaking changes verified against upstream

### #626 `actions/setup-node` 6.4.0 → 7.0.0 (2026-07-14)
ESM migration; `@actions/cache` → 5.1.0; new `cache-primary-key` / `cache-matched-key` outputs; **removed the dummy `NODE_AUTH_TOKEN` export**; conditional `mirrorToken`. No runner or Node requirement change, no removed inputs.
**Repo impact: none.** `grep -rn "NODE_AUTH_TOKEN" .github/` → zero hits; no workflow sets `registry-url`. All 16 call sites use only `node-version` + `cache: npm`.

### #627 `actions/setup-python` 6.3.0 → 7.0.0 (2026-07-20)
ESM migration; `@actions/cache` → 6.2.0; **removed the `pip-install` input**; stderr warnings now annotate as warnings not errors; manifest fetch validated + retried.
**Repo impact: none.** Two call sites (`ci.yml:1157`, `cassette-refresh.yml:64`); neither uses `pip-install`. `ci.yml` uses `cache: pip`, still supported. The stderr reclassification is a small positive — fewer false red annotations on the python job.

### #612 `supabase/setup-cli` 2.1.1 → 3.0.0 (2026-07-07)
**Install source changes**: the CLI now comes from the npm `supabase` package instead of GitHub releases. Supports `latest`, `beta`, and fixed npm versions. **Removes the `github-token` input.** Runs npm from the workspace while isolating the action-owned install. Improved musl/Alpine handling.
**Repo impact: four call sites, all compatible** — `migration-drift-check.yml:48`, `migration-policy.yml:177`, `supabase-migrate.yml:167`, `supabase-migrate.yml:199`. Every one passes `version: 2.98.2` and **none** passes `github-token`, so the removed input is a no-op here. Verified `supabase@2.98.2` exists on npm, so the pin resolves under the new install path.
⚠️ **Why this one still earns its own verification:** these four workflows are the ones that auto-apply migrations to **production** Supabase on merge to `main`. The deliberate pin exists so `db push --include-all` semantics cannot drift between the plan job and the apply job. A change to *how the binary is obtained* is exactly the kind of thing that silently resolves to a different build. Confirm `supabase --version` prints `2.98.2` in the plan job's log before trusting the apply job.

### #645 `@testing-library/jest-dom` 6.9.1 → 7.0.0 (2026-07-20)
Breaking: **`@testing-library/dom` becomes a required peer** (`>=10 <11`); **minimum Node is 22**. Adds `toContainAnyBy*` / `toContainOneBy*`. **No matchers removed.**
**Repo impact: low.** `@testing-library/dom@10.4.1` already resolves at the top level via `@testing-library/react@16.3.2` and `@testing-library/user-event@14.6.1` → peer satisfied without adding a dep. Node 22 satisfied by CI and local. Import shape (`@testing-library/jest-dom/vitest` in `src/test-setup.ts:1` plus 4 files importing it redundantly) is unchanged. New peer on `vitest >= 0.32` — repo has 4.1.10.
**Land 7.0.1**, not 7.0.0 (7.0.0 was itself flagged upstream as a repaired release).

### #646 `jsdom` 29.1.1 → 30.0.0 — see L4. **Land 30.0.1.**

### #643 `actions/checkout` 7.0.0 → 7.0.1
Single-member group, patch on a major the repo is already on. Zero-risk warm-up that proves the actions lane is landable.

---

## Landing order, with gates

Ordered by **blast radius ascending**, with one deliberate exception: the pandas fix is a prerequisite commit, not a PR.

| # | Action | Gate before merge |
|---|--------|-------------------|
| **0** | **Prerequisite commit on `main`:** set `requirements.in` `pandas==2.2.3` → `3.0.3`; correct the surrounding comment (it currently justifies 2.2.3's pyarrow-free runtime). No lock change. | `npm run lint`-equivalent n/a; verify `git diff` touches exactly one line + its comment, and that `requirements.txt` is untouched |
| **1** | **#643** checkout 7.0.0→7.0.1 | Green CI. Establishes the actions lane. |
| **2** | **#627** setup-python 7 · **#626** setup-node 7 (may share one window, different lanes) | Green CI **plus** an eyeball on the `python` and `frontend-*` job logs for install-step drift (ESM migration = new action runtime) |
| **3** | **#612** supabase/setup-cli 3 | Green CI **plus** `supabase --version` == `2.98.2` in the `migration-policy` / `supabase-migrate` plan job logs. ⛔ Do not merge on a day when a schema migration is also in flight. |
| **4** | **#685** pip group — rebased onto (0), pandas line dropped from the diff, lock regenerated with `make lock` | `cd analytics-service && python3 -m pytest` (from that dir — repo-root runs miss the VCR cassettes and hit live brokers) **and** `mypy --strict`. Confirm `grep '^pandas' requirements.txt` still reads `3.0.3`. |
| **5** | **#686** npm group — rebased onto `main`, lock regenerated with `npm install` | `npm ci` clean, then `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` · `knip`. Watch `knip` (7 minors) and the demo-PDF path (`puppeteer-core`). |
| **6** | **#645** jest-dom, retargeted 7.0.1 | Full `npm run test`. Single-purpose PR — if red, the cause is unambiguous. |
| **7** | **#646** jsdom, retargeted 30.0.1 | Full `npm run test` — ideally under Node 22 (see L4). Re-run `npm audit` after: expect the `undici` high to clear. |
| **8** | **#614** typescript 7 | ⛔ **Close, do not merge.** Leave a comment citing the `exports`-map read and the typescript-eslint peer range so the next Dependabot reopen is answered in advance. |

**Ordering rationale:**
- Actions PRs first because they change *how CI runs*, and you want that settled before you start trusting CI's verdict on library bumps. They are also the only four with genuinely zero repo-code surface.
- pip before npm because the two ecosystems are disjoint, the pip group is smaller, and its landmine (pandas) is fully understood — landing it proves the process before the 29-member group.
- The two test-infra majors (#645, #646) last and separately, because they change *the harness that judges everything else*. Landing them before the groups would make any group red ambiguous ("is this the bump or the harness?").
- ⚠️ **Never two at a time.** The repo's shared-TEST-DB contention means a red `python` or `e2e-seeded` job is not reliable evidence; with two dep PRs in flight you cannot attribute it. One PR, one window, full local suite as the real gate.

---

## What NOT to touch

| Item | Why |
|------|-----|
| `typescript` — stay on **6.0.3** | 6.0.3 is already the newest 6.x. TS 7 has no compiler API (L3). Nothing to gain, a lint config and a coverage-law gate to lose. |
| `requirements.txt` `pandas==3.0.3` | Shipped deliberately in PR #604. The `.in` is the file that is wrong. Fixing the lock instead of the `.in` would revert a production migration. |
| `ccxt` beyond the group's 4.5.73 | Load-bearing exact pin — the repo's 4.5.x workarounds in `equity_reconstruction.py` / `exchange.py` target this line, and cassettes are verified against it. In-group patch bump is fine; do not float it. |
| `rpyc` — stays `==5.2.3`, never 6.x | rpyc 6 is not wire-compatible with the Wine-side mt5linux 5.x server (`ValueError: invalid message type: 18`). Not in any open PR; recorded so nobody "helpfully" bumps it. |
| `aiohttp` — cap `<3.15` stays | The 3.14 incident (vcrpy stub) is exactly why the cap exists. #685 lands 3.14.3, inside it. Do not widen. |
| `@lhci/cli` — stays `0.15.1` | **0.15.1 IS the latest published version.** There is nothing to bump to. |
| `overrides: { fast-uri: "^3.1.4" }` | ⚠️ Actually *insufficient* — the advisory range is `3.0.0 – 3.1.4`, so the current override pins to the last vulnerable version. Bump the override to `^3.1.5` as a one-line fix in the same pass. This is the one override worth touching. |
| Banned-packages list | Re-checked 2026-08-20: none of the 9 PRs, and none of the 29 + 8 group members, touch `react-native-international-phone-number` or `react-native-country-select`. Clean. |

---

## #606 is stale — close it, don't "fix" it

`TODOS.md:811` books #606 as *"a DEV-ONLY chain — all 4 highs via `@lhci/cli` → old `uuid`; needs an @lhci/cli bump or override in this same pass."* **Three of those four claims are false at HEAD** (measured 2026-08-20):

1. **There are 12 highs, not 4** (`npm audit`: 12 high, 2 moderate, 1 low).
2. **`uuid` is not one of them.** `uuid@8.3.2` carries GHSA-w5hq-g745-h8pq — **MODERATE**, a missing buffer bounds check in v3/v5/v6 when `buf` is supplied. Not high, and not the lhci chain's severity driver.
3. **An `@lhci/cli` bump is impossible** (0.15.1 is latest) and an **override cannot fix it either**: the actual high in that chain is `extract-zip` (GHSA-jmr9-qjv8-65gv, symlink path traversal) whose vulnerable range is **`*`** — no fixed version exists. `npm audit fix --force` "resolves" it by *downgrading* `@lhci/cli` to `0.6.1`, a nine-minor regression on a CI perf gate.

The one true claim is that it's dev-only. And the nightly gate **already encodes that**: `nightly.yml` runs `npm audit --omit=dev --audit-level=high`, with a written rationale accepting exactly this class. Issue #606 dates from **2026-07-10**, before that `--omit=dev` narrowing landed.

**Recommendation:** close #606 as stale with the measured evidence, and instead land the two *real*, cheap wins the audit surfaced:
- bump the `fast-uri` override to `^3.1.5`;
- expect `undici` (high, via `jsdom@29.1.1` only) to clear for free when #646 lands jsdom 30 → `undici@^8`.

Everything else high in the dev tree (`brace-expansion`, `ip-address`, `js-yaml@3` via lhci, `nanoid`, the `extract-zip` chain) is either already-accepted build-only tooling or fixed incidentally by #686. **Do not add an audit-allowlist file** — the `--omit=dev` scoping already is the policy, and a second mechanism would let a real prod advisory hide behind an entry someone added for lhci.

---

## Adjacent claim worth correcting in the same pass

`TODOS.md:813` says #616 (stale analytics deploy) *"is NOT a deps issue — it's the Phase 144 TEST-DB flake keeping main CI red so Railway skips deploys; currently harmless (no analytics-service changes in the undeployed delta)."* The first half still holds. **The second half stops holding the moment #685 merges** — that PR is 100% `analytics-service/` and would sit undeployed behind a red `main`. The OPS work on #616 is therefore a **hard prerequisite for step 4**, not an independent item. Sequence OPS-#616 before DEPS-#685, or land #685 and verify the Railway deploy actually fired (`commitHash` + `/health`) rather than assuming it.

---

## Sources & confidence

| Finding | Source | Confidence |
|---------|--------|------------|
| #686 fails on `npm ci` EUSAGE, missing `proxy-agent` subtree | `gh run view --log-failed` on run 32365605203 | **HIGH** — read from the failing job's own log |
| `main`'s lock is in sync (desync is PR-introduced) | `npm ci --dry-run` at HEAD | **HIGH** — measured locally |
| #685 writes `pandas 3.0.3 → 2.3.3` into the lock | `gh pr diff 685` lines 179–180 | **HIGH** — read from the diff |
| `requirements.in` says 2.2.3, lock says 3.0.3, since `83680283` | `grep` + `git log -S` | **HIGH** — measured |
| TS 7.0.2 exports map / native binary deps | `npm view typescript@7.0.2 exports dependencies` | **HIGH** — npm registry, primary |
| TS 7 has no stable programmatic API until 7.1; `@typescript/typescript6` shim | WebSearch (devblogs.microsoft.com announcement, InfoQ, Visual Studio Magazine) | **MEDIUM** — seam classifies `websearch` as LOW; upgraded to MEDIUM because it corroborates the primary `exports`-map read rather than standing alone |
| `typescript-eslint@8.58.0` peer `typescript >=4.8.4 <6.1.0` | `npm view` | **HIGH** — npm registry |
| jsdom 30.0.0 breaking = engines only; 30.0.1 fixes `calc()` regression; undici → ^8 | GitHub Releases API (`jsdom/jsdom`), `npm view jsdom@30.0.1` | **HIGH** — vendor's own release notes + registry |
| jest-dom 7 peer + Node 22 minimum; 7.0.1 latest | GitHub Releases API, `npm view` | **HIGH** |
| setup-node v7 / setup-python v7 / supabase-setup-cli v3 release notes | GitHub Releases API for each repo | **HIGH** |
| Repo has no `NODE_AUTH_TOKEN`, no `pip-install`, no `github-token`; `supabase@2.98.2` exists on npm | `grep` over `.github/` + `npm view` | **HIGH** — measured |
| FastAPI 0.140–0.141 non-breaking; starlette requirement unchanged | fastapi.tiangolo.com release notes + PyPI JSON API `requires_dist` | **HIGH** for the PyPI metadata, MEDIUM for the "no breaking changes" reading (0.140.0's own entry was truncated in the fetched page) |
| `@lhci/cli` 0.15.1 is latest; `extract-zip` range `*`; `uuid` is moderate | `npm view`, `npm audit --json` | **HIGH** — measured locally |

**Gaps the planner should carry:**
- I did not execute the campaign — no PR was rebased, no lock regenerated, no suite run. Every "expect green" above is a prediction, not a measurement.
- FastAPI 0.140.0's own changelog entry was truncated by the fetch; if the python suite reds on #685 after pandas is neutralised, read that entry directly before blaming pandas.
- `knip` 6.25 → 6.32 spans seven minors; I did not read its changelogs. If #686 reds *after* a clean `npm ci`, `knip` is the highest-prior suspect and its findings may be legitimate rather than regressions.
