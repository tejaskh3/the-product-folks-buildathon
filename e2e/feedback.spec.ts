// The feedback floater in a real browser: open it, send feedback (signed out), keyboard use,
// a paper the library already has, the 360 px fit, and keeping clear of an open paper on phones.
// All /api calls go to FakeApi.
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fakeApi";

const floater = (page: Page) => page.getByRole("button", { name: "Feedback", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Tell us what you think" });

async function fitsWidth(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
}

test.beforeEach(async ({ context }) => {
  await setupClerkTestingToken({ context });
});

test("signed out: send feedback with an email, then Escape closes and focus goes back", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await page.goto("/pricing");
  await floater(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Feedback" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("What’s on your mind?")).toBeFocused();

  await page.getByLabel("What’s on your mind?").fill("The diagrams are lovely.");
  await page.getByLabel("Email (optional)").fill("reader@example.com");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Thanks, we got it.")).toBeVisible();
  expect(api.called("POST", "/api/feedback")[0].body).toEqual({ kind: "feedback", message: "The diagrams are lovely.", email: "reader@example.com", page: "/pricing" });

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(floater(page)).toBeFocused();
});

test("tabs switch with the arrow keys; a paper the library has is linked instead of filed", async ({ page }) => {
  const api = new FakeApi(page);
  api.libraryArxiv.add("1706.03762");
  await api.install();
  await page.goto("/pricing");
  await floater(page).click();
  await page.getByRole("tab", { name: "Feedback" }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Feature request" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Request a paper" })).toHaveAttribute("aria-selected", "true");

  await page.getByLabel("arXiv link or ID").fill("https://arxiv.org/abs/1706.03762v7");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("already in the library")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open / })).toHaveAttribute("href", `/play/${api.paperId}`);
});

test("fits a 360 px screen with no sideways scroll", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await expect(floater(page)).toBeVisible();
  await fitsWidth(page);
  await floater(page).click();
  const box = await dialog(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  for (const name of ["Feedback", "Feature request", "Request a paper"]) {
    const tab = await page.getByRole("tab", { name }).boundingBox();
    expect(tab!.x + tab!.width).toBeLessThanOrEqual(360);
  }
  // No label is cut off.
  expect(await page.getByRole("tab").evaluateAll((tabs) => tabs.every((t) => t.scrollWidth <= t.clientWidth))).toBe(true);
  await fitsWidth(page);
});

test("keeps out of the way: hidden over an open paper on phones and behind other dialogs", async ({ page }, info) => {
  const api = new FakeApi(page);
  api.demo = true;
  await api.install();
  await page.goto("/play");
  await expect(floater(page)).toBeVisible();
  await page.getByRole("button", { name: "Google’s original PageRank paper" }).click();
  await expect(page.getByText(/Scene 1 of/)).toBeVisible();
  if (info.project.name === "phone") await expect(floater(page)).toBeHidden();
  else await expect(floater(page)).toBeVisible();

  await page.getByRole("button", { name: /Read the paper|^Paper$/ }).click();
  await expect(page.getByRole("dialog", { name: "The paper" })).toBeVisible();
  await expect(floater(page)).toHaveCount(0);
});
