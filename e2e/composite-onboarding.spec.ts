/**
 * Phase 91 / Plan 91-03 (QA-02, QA-03, CONTEXT D2 + D3) — the multi-key
 * composite onboarding GUI proof + the #338 permanent-failed-member GUI fault
 * proof, in ONE seed-gated Playwright spec.
 *
 * CI-DETERMINISM (D2): no analytics worker, no live exchange keys. The wizard
 * touches THREE live-dependent routes on the multi-key → preview walk; each is
 * `page.route`-stubbed with the exact pinned contract so the SEEDED 91-02 rows
 * (strategy_analytics / strategy_keys / csv_daily_returns) drive the poller and
 * factsheet. Everything else hits the real app.
 *
 *   1. POST /api/strategies/composite/add-key  — per-key validate
 *        contract: { ok, strategy_id, api_key_id } (MultiKeyConnectStep.tsx:385-397;
 *        all three required or the panel won't advance). Returning the SEEDED
 *        strategyId is the trick that points the later steps at the 91-02 rows.
 *   2. POST /api/strategies/composite/set-members — the "Continue" persist
 *        (MultiKeyConnectStep.tsx:485-489). Success envelope { ok: true,
 *        member_count } (set-members/route.ts:147-148). NOT in the plan's stub
 *        list but UNAVOIDABLE — the real route 403s here (the seeded composite
 *        is owned by a different user than the logged-in allocator), which would
 *        block Continue and stall the walk (Rule 3 / WI-2: stub the live call
 *        rather than let the spec hang).
 *   3. POST /api/keys/sync — the SyncPreviewStep MOUNT kickoff
 *        (SyncPreviewStep.tsx:380). The plan named this "finalize-wizard", but
 *        the actual preview poller kicks off /api/keys/sync (finalize-wizard is
 *        SubmitStep's terminal POST and is never reached on the preview walk).
 *        The plan's success envelope `{ …, composite: true }` matches THIS route
 *        (keys/sync route.ts:235-237), confirming the intent. `composite: true`
 *        is the AUTHORITATIVE discriminator threaded into `isComposite`; without
 *        it the poller takes the single-key arm and false-fails INSUFFICIENT_TRADES.
 *
 * ── WI-2 (plan-checker): the preview poller ──────────────────────────────────
 * SyncPreviewStep reads the SEEDED `strategy_analytics` row DIRECTLY via the
 * Supabase browser client — the lightweight status poll
 * (`computation_status, computation_error`, SyncPreviewStep.tsx:499-503) and the
 * heavy composite read (analytics + strategy_keys + csv_daily_returns +
 * strategies.returns_denominator_config, :582-611). There is NO third live
 * status endpoint. The ONLY live call the poller itself makes is the mount
 * kickoff (stub #3 above); the seed's fixed `computed_at` (2026-07-01) is older
 * than the 5-minute freshness window, so the freshness-skip branch is NOT taken
 * and the kickoff deterministically fires → the stub answers it. Once
 * `isComposite` is set, the terminal composite read resolves entirely off the
 * seeded rows.
 *
 * Seed-gate + inline loginViaForm are copied verbatim from wizard-axe.spec.ts
 * (:29-52) — no shared login helper exists; per the PATTERNS shared pattern the
 * duplication is intentional. When the seed env vars are absent this spec is
 * skipped entirely (place 1 of the two-place rule; place 2 is 91-05's ci.yml
 * MA-8 entry for `composite-onboarding.spec.ts`).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  seedCompositeStrategy,
  seedTestAllocator,
  cleanupStrategiesByNamePrefix,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10_000,
  });
}

/**
 * Stub the THREE live-dependent wizard routes (see file header). `add-key` and
 * `keys/sync` return the SEEDED strategyId so the preview poller and the
 * factsheet link read the 91-02 rows; `set-members` returns the pinned success
 * envelope so Continue advances. Registered BEFORE navigation so the very first
 * validate POST is intercepted.
 */
async function stubWizardLiveCalls(page: Page, seededStrategyId: string) {
  await page.route("**/api/strategies/composite/add-key", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // Exact keys at MultiKeyConnectStep.tsx:385-397 — a fresh uuid per call.
      body: JSON.stringify({
        ok: true,
        strategy_id: seededStrategyId,
        api_key_id: crypto.randomUUID(),
      }),
    });
  });

  await page.route("**/api/strategies/composite/set-members", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, member_count: 2 }),
    });
  });

  await page.route("**/api/keys/sync", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      // keys/sync composite-branch success (route.ts:235-237). `composite: true`
      // is the discriminator SyncPreviewStep threads into `isComposite`.
      body: JSON.stringify({
        ok: true,
        accepted: true,
        strategy_id: seededStrategyId,
        status: "syncing",
        composite: true,
      }),
    });
  });
}

/**
 * Drive one editable key panel (index `i`) to `validated`: Deribit exchange,
 * placeholder credentials (no passphrase), a start window, and either an end
 * window or the still-live (open-ended) toggle. Clicks Validate and waits for
 * the collapsed read-only summary chip. The add-key stub makes this deterministic.
 */
async function fillAndValidatePanel(
  page: Page,
  i: number,
  opts: { start: string; end?: string; stillLive?: boolean },
) {
  await page.getByTestId(`key-${i}-exchange-deribit`).click();
  await page.getByTestId(`key-${i}-api-key`).fill("e2e-deribit-client-id");
  await page.getByTestId(`key-${i}-api-secret`).fill("e2e-deribit-client-secret");
  await page.getByTestId(`key-${i}-window-start`).fill(opts.start);
  if (opts.stillLive) {
    await page.getByTestId(`key-${i}-still-live`).check();
  } else if (opts.end) {
    await page.getByTestId(`key-${i}-window-end`).fill(opts.end);
  }
  await page.getByTestId(`key-${i}-validate`).click();
  await expect(page.getByTestId(`key-${i}-summary`)).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Phase 91 — composite multi-key onboarding (QA-02 / QA-03)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "composite onboarding: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  test.afterAll(async () => {
    // Best-effort GC of this spec's own leave-around fixtures (mirrors the
    // seed-helper convention). All composite fixtures carry the
    // `e2e-composite-` name prefix; strategy_analytics/strategy_keys cascade.
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix("e2e-composite-");
    }
  });

  test("multi-key onboarding: add keys, overlap fail-loud, preview, factsheet", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "requires seed env");

    // Default = published Zavara-shaped composite (91-02). Its strategyId is
    // what the stubs echo, so the preview poller + factsheet read the seeded rows.
    // The composite is owned by the logged-in allocator so the RLS-bound wizard
    // reads resolve (allocator created FIRST so it exists before the composite).
    const allocator = await seedTestAllocator();
    const composite = await seedCompositeStrategy({ ownerUserId: allocator.userId });
    await stubWizardLiveCalls(page, composite.strategyId);
    await loginViaForm(page, allocator.email, allocator.password);

    await page.goto("/strategies/new/wizard");
    // ME-02 URL pin BEFORE any assertion (mirrors wizard-axe.spec.ts:69-71) so
    // the walk is provably on the wizard surface, not a login-redirect landing.
    await expect(page).toHaveURL(/\/strategies\/new\/wizard(?!\/csv)/, {
      timeout: 10_000,
    });

    // Enter multi-key mode via the State-A ghost affordance (:522). enterMulti
    // creates two editable panels (indexes 0 and 1).
    await page.getByTestId("multi-add-key").click();
    await expect(page.getByTestId("key-panel-0")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("key-panel-1")).toBeVisible();

    // Panel 0 → validated with a fixed [2025-01-01, 2025-01-20) window. Once
    // validated the window inputs collapse to a read-only chip (SyncPreviewStep
    // n/a — MultiKeyConnectStep.tsx:770-785), so its window is now frozen.
    await fillAndValidatePanel(page, 0, {
      start: "2025-01-01",
      end: "2025-01-20",
    });

    // Panel 1 → set an OVERLAPPING open-ended window [2025-01-10, live) but do
    // NOT validate yet (keep it editable). The step-level validation runs across
    // ALL windowed panels (validated + editing), so the overlap fires now.
    await page.getByTestId("key-1-exchange-deribit").click();
    await page.getByTestId("key-1-api-key").fill("e2e-deribit-client-id-2");
    await page.getByTestId("key-1-api-secret").fill("e2e-deribit-client-secret-2");
    await page.getByTestId("key-1-window-start").fill("2025-01-10");
    await page.getByTestId("key-1-still-live").check();

    // Fail-loud (D2): the overlap envelope becomes visible AND Continue is
    // blocked — the two together are the loud, non-advancing failure.
    await expect(
      page.getByTestId("multi-key-validation-summary"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("multi-continue")).toBeDisabled();

    // Fix to a clean sequential handoff: panel 1 starts on panel 0's exclusive
    // end (2025-01-20). Half-open windows share the handoff day, so the overlap
    // clears (windowsOverlap convention; keyWindowsSchema.test.ts:145-153).
    await page.getByTestId("key-1-window-start").fill("2025-01-20");
    await expect(
      page.getByTestId("multi-key-validation-summary"),
    ).toHaveCount(0);

    // Validate panel 1 → both validated, clean windows, no blocking error →
    // Continue enables. Click it → set-members stub → advance to sync_preview.
    await page.getByTestId("key-1-validate").click();
    await expect(page.getByTestId("key-1-summary")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("multi-continue")).toBeEnabled();
    await page.getByTestId("multi-continue").click();

    // Preview step: keys/sync stub → isComposite=true → the poller reads the
    // SEEDED complete analytics row and lands on the verified composite preview.
    await expect(
      page.getByRole("heading", {
        name: /your verified composite factsheet is ready/i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("wizard-use-this-key")).toBeVisible();

    // Follow through to the seeded composite factsheet. Guard the landing by
    // HTTP status (mirrors target-size.spec.ts:124-131) — a >=400 is a real
    // regression in the composite read path, not a "no data" skip.
    const factsheetUrl = `/factsheet/${composite.strategyId}/v2`;
    const res = await page.goto(factsheetUrl);
    expect(
      res?.status(),
      `${factsheetUrl} returned HTTP ${res?.status()} — seeded composite ` +
        "factsheet did not render (composite read-path regression)",
    ).toBeLessThan(400);
    await expect(page).toHaveURL(new RegExp(`/factsheet/${composite.strategyId}/v2`));
  });

  test("#338: a permanent-failed member blocks publish (GUI)", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "requires seed env");

    // BACKEND CREDIT (D3): the #338 backend invariant is ALREADY triple-pinned
    // in Phase 87 — the stitch worker (test_stitch_composite_job.py:595), the
    // admin/strategy-review route (25/25), and the sole-published-writer source
    // scan. This test proves ONLY the GUI surface: the wizard failed gate and
    // the discoverability status gate. It never re-derives the backend behaviour.
    // Allocator created FIRST so both composites can be owned by it — the
    // RLS-bound wizard reads only resolve for the logged-in owner.
    const allocator = await seedTestAllocator();
    const failed = await seedCompositeStrategy({
      variant: "failed",
      ownerUserId: allocator.userId,
    });
    // A published composite as the false-green POSITIVE CONTROL for the
    // discoverability assertion below (proves the id-based lookup surface
    // actually renders a published composite before we assert the failed one
    // is absent). Seeded under its OWN owner (NOT the allocator): the control is
    // only ever hit via the PUBLIC, owner-agnostic /strategy/[id] lookup
    // (withPublishedOnly), so ownership is irrelevant to it — and keeping it off
    // the allocator leaves the allocator owning exactly ONE composite (the
    // failed one), matching the passing multi-key test's State-A. A second
    // allocator-owned composite perturbs the wizard's initial connect step so
    // the `multi-add-key` ghost affordance never renders (the walk below times
    // out on it).
    const publishedControl = await seedCompositeStrategy();
    await stubWizardLiveCalls(page, failed.strategyId);
    await loginViaForm(page, allocator.email, allocator.password);

    await page.goto("/strategies/new/wizard");
    await expect(page).toHaveURL(/\/strategies\/new\/wizard(?!\/csv)/, {
      timeout: 10_000,
    });

    // Walk to the preview step with the FAILED strategyId. Two clean sequential
    // windows (shared handoff day, last open-ended) — the seed's own window shape.
    await page.getByTestId("multi-add-key").click();
    await expect(page.getByTestId("key-panel-1")).toBeVisible({
      timeout: 10_000,
    });
    await fillAndValidatePanel(page, 0, {
      start: "2025-01-01",
      end: "2025-01-11",
    });
    await fillAndValidatePanel(page, 1, {
      start: "2025-01-11",
      stillLive: true,
    });
    await expect(page.getByTestId("multi-continue")).toBeEnabled();
    await page.getByTestId("multi-continue").click();

    // The failed gate (mirrors SyncPreviewStep.composite.render.test.tsx:439-443,
    // now against the live DOM). isComposite=true (keys/sync stub) → the heading
    // names the COMPOSITE; the seeded computation_error names the offending
    // member and is threaded into the envelope cause (wizardErrors.ts:694-699).
    await expect(
      page.getByRole("heading", {
        name: /we could not verify this composite/i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    // The offending member is named via the scrubbed computation_error the seed
    // stamps ("… (deribit) failed to reconstruct: upstream geo-blocked").
    await expect(page.getByText(/\(deribit\)/)).toBeVisible();
    await expect(page.getByText(/failed to reconstruct/i)).toBeVisible();
    // No use-this-key CTA on the failed gate — publish is blocked at the GUI.
    await expect(page.getByTestId("wizard-use-this-key")).toHaveCount(0);

    // NOT published → NOT publicly discoverable. False-green-proof, id-based,
    // status-gated (the public detail route filters status='published' via
    // withPublishedOnly → getPublicStrategyDetail; a draft/failed composite
    // 404s). Composites carry no category_id, so a discovery CATEGORY-page
    // absence check could never distinguish status (the composite would be
    // absent even if published) — a false green. The status-gated public detail
    // surface is the honest discoverability check.
    //
    // POSITIVE CONTROL FIRST: a PUBLISHED composite IS reachable (proves the
    // lookup surface renders published composites)…
    const controlRes = await page.goto(`/strategy/${publishedControl.strategyId}`);
    expect(
      controlRes?.status(),
      "positive control: a PUBLISHED composite must be publicly reachable " +
        "at /strategy/[id]; if this fails the absence assertion below is a " +
        "false green (the lookup surface itself is broken)",
    ).toBeLessThan(400);

    // …THEN the failed composite is ABSENT (404) — absence attributable to the
    // unpublished status, via the SAME id-based lookup.
    const failedRes = await page.goto(`/strategy/${failed.strategyId}`);
    expect(
      failedRes?.status(),
      "the #338 failed-member composite must NOT be publicly discoverable — " +
        "a permanent-failed composite must never reach published status",
    ).toBe(404);
  });
});
