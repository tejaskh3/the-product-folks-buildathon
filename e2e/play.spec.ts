// The main reader flows in a real browser: a new paper from upload to an answered question,
// the paywall when papers run out, and paying then landing back on the same paper with its
// walkthrough starting. All /api calls go to FakeApi; Clerk is real (dev instance, test user).
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_EMAIL, FakeApi, PDF, SCENES } from "./fakeApi";

async function signIn(page: Page) {
  await page.goto("/pricing");
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
}

async function uploadPdf(page: Page) {
  await page.goto("/play");
  await expect(page.getByText("Drop a PDF here, or click to choose")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: PDF });
}

const sceneTitle = (page: Page, i: number) => page.getByRole("heading", { level: 2, name: SCENES[i].title });

/** No sideways scrolling on any screen size. */
async function fitsWidth(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
}

test.beforeEach(async ({ context }) => {
  await setupClerkTestingToken({ context });
});

test("signed out: a ready-made paper plays, and asking asks you to sign in first", async ({ page }) => {
  const api = new FakeApi(page);
  api.demo = true;
  await api.install();
  await page.goto("/play");
  await expect(page.getByText("Sign in to bring your own paper.")).toBeVisible();

  await page.getByRole("button", { name: "Google’s original PageRank paper" }).click();
  await expect(sceneTitle(page, 0)).toBeVisible();
  await expect(page.getByText(`Scene 1 of ${SCENES.length}`)).toBeVisible();
  expect(api.called("POST", "/api/play/suggest")).toHaveLength(0); // library papers bring their own

  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(sceneTitle(page, 1)).toBeVisible();

  // Asking costs credit, so it goes to Google sign-in instead of the API.
  const leaving = page.waitForRequest((r) => /sign-in|oauth|accounts\.google|clerk/.test(r.url()) && r.isNavigationRequest());
  await page.getByLabel(/Ask about/).fill("What is a head?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await leaving;
  expect(api.called("POST", "/api/play/diagram")).toHaveLength(0);
});

test("new paper: upload, walkthrough, then a question answered as a diagram", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await signIn(page);
  await uploadPdf(page);

  await expect(sceneTitle(page, 0)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/play/${api.paperId}$`));
  await fitsWidth(page);

  // Diagrams draw in a sandboxed frame; clicking a part explains it and offers to go deeper.
  const part = SCENES[0].diagram.explorables[0];
  await page.frameLocator("#stage iframe").locator(`[data-explore="${part.id}"]`).first().dispatchEvent("click"); // its centre can be empty space
  const explanation = page.getByRole("region", { name: "Explanation" });
  await expect(explanation.getByText(part.label, { exact: true })).toBeVisible();
  await expect(explanation.getByRole("button", { name: "Go deeper live" })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(sceneTitle(page, 1)).toBeVisible();

  await page.getByLabel(/Ask about/).fill("Why does this beat recurrence?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Answer: .*Why does this beat recurrence\?/ })).toBeVisible();
  const ask = api.called("POST", "/api/play/diagram")[0].body as { paperId: string; question: string };
  expect(ask.paperId).toBe(api.paperId);
  expect(ask.question).toContain(SCENES[1].title); // scoped to the scene they were on

  // A reload reopens the same paper from what was saved.
  await page.reload();
  await expect(page.getByText(`Scene 1 of ${SCENES.length}`)).toBeVisible();
  expect(api.called("POST", "/api/play/walkthrough")).toHaveLength(1);
});

test("a PDF over 4 MB goes straight to Storage (start → PUT → finish), then plays like any other", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await signIn(page);
  await page.goto("/play");
  await expect(page.getByText("Up to 15 MB.")).toBeVisible();
  const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 - PDF.length, 0x20)]); // padding after %%EOF
  await page.locator('input[type="file"]').setInputFiles({ name: "thesis.pdf", mimeType: "application/pdf", buffer: big });

  await expect(sceneTitle(page, 0)).toBeVisible();
  expect(api.called("POST", "/api/play/upload")).toHaveLength(0);
  expect(api.called("POST", "/api/play/upload/start")).toHaveLength(1);
  expect(api.storagePuts).toEqual([big.length]);
  const finish = api.called("POST", "/api/play/upload/finish")[0].body as { path: string; name: string };
  expect(finish).toEqual({ path: expect.stringMatching(/^incoming\//), name: "thesis.pdf" });
});

test("a PDF over 15 MB is turned away before anything is sent", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await signIn(page);
  await page.goto("/play");
  await page.locator('input[type="file"]').setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(16 * 1024 * 1024, 0x20) });
  await expect(page.getByText("That PDF is over 15 MB.")).toBeVisible();
  expect(api.calls.filter((c) => c.path.startsWith("/api/play/upload") || c.path.startsWith("/api/e2e-storage"))).toEqual([]);
});

test("out of papers: the paywall, then checkout brings you back and the walkthrough starts", async ({ page }) => {
  const api = new FakeApi(page);
  api.outOfPapers = true;
  await api.install();
  await signIn(page);
  await uploadPdf(page);

  const paywall = page.getByRole("dialog", { name: "You’ve used your 2 free papers" });
  await expect(paywall).toBeVisible();
  await fitsWidth(page);
  await expect(paywall.getByText("Your plan")).toHaveCount(0); // free isn't offered as an upgrade

  // Closing it leaves them on the paper with the reason, not a spinner.
  await page.keyboard.press("Escape");
  await expect(paywall).toBeHidden();
  await expect(page.getByText("Couldn’t explain this paper")).toBeVisible();

  // Reopening the paper tries the walkthrough again (it never spins forever); still out, so the paywall again.
  await page.reload();
  await expect(paywall).toBeVisible();

  await paywall.getByRole("button", { name: "Choose Starter" }).click();
  await expect(page.getByRole("heading", { name: "Activating your plan…" })).toBeVisible();
  const checkout = api.called("POST", "/api/billing/checkout")[0].body as { plan: string; next: string };
  expect(checkout).toEqual({ plan: "starter", next: `/play/${api.paperId}` });

  // Sync says pending once, then active: back on the paper, walkthrough drawing, no paywall.
  await expect(sceneTitle(page, 0)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/play/${api.paperId}$`));
  await expect(paywall).toHaveCount(0);
  expect(api.called("POST", "/api/billing/sync").length).toBeGreaterThanOrEqual(2);
  expect(api.called("POST", "/api/play/walkthrough").length).toBeGreaterThanOrEqual(2);
});

test("a payment that failed says so and charges nothing", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await signIn(page);
  await page.goto(`/billing/return?subscription_id=sub_e2e&status=failed&next=/play/${api.paperId}`);
  await expect(page.getByRole("heading", { name: "That didn’t work" })).toBeVisible();
  await expect(page.getByText("You haven’t been charged.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go back" })).toHaveAttribute("href", `/play/${api.paperId}`);
  expect(api.called("POST", "/api/billing/sync")).toHaveLength(0);
});
