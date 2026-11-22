// The public discussion on a library paper: signed out you can read it and are asked to sign
// in to post; signed in you post about the scene you're on, delete your own, report others'.
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { E2E_EMAIL, FakeApi, PDF, SCENES } from "./fakeApi";

test.beforeEach(async ({ context }) => {
  await setupClerkTestingToken({ context });
});

test("signed out: read the discussion, sign in to post", async ({ page }) => {
  const api = new FakeApi(page);
  api.demo = true;
  await api.install();
  await page.goto("/play");
  await page.getByRole("button", { name: "Google’s original PageRank paper" }).click();
  await expect(page.getByRole("heading", { level: 2, name: SCENES[0].title })).toBeVisible();
  await page.getByRole("button", { name: /Discussion · 1/ }).click();
  await expect(page.getByText("The positional encodings section is the one to reread.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Report" })).toHaveCount(0);
  await expect(page.getByText("to join the discussion.")).toBeVisible();
});

test("signed in: post about this scene, report someone else's, delete your own", async ({ page }) => {
  const api = new FakeApi(page);
  api.demo = true;
  await api.install();
  await page.goto("/pricing");
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
  await page.goto("/play");
  await page.locator('input[type="file"]').setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("heading", { level: 2, name: SCENES[0].title })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { level: 2, name: SCENES[1].title })).toBeVisible();

  await page.getByRole("button", { name: /Discussion/ }).click();
  const discussion = page.getByRole("region", { name: /Discussion/ });
  await discussion.getByRole("button", { name: "Report" }).click();
  await expect(discussion.getByText("Reported. Thanks.")).toBeVisible();
  expect(api.reports).toEqual([api.comments[0].id]);

  await expect(discussion.getByLabel("About scene 2")).toBeChecked();
  await discussion.getByLabel("Add a comment").fill("Multi-head attention finally clicked for me here.");
  await discussion.getByRole("button", { name: "Post" }).click();
  await expect(discussion.getByText("Multi-head attention finally clicked for me here.")).toBeVisible();
  expect(api.comments.at(-1)).toMatchObject({ sceneId: SCENES[1].id });

  // "on scene 2" jumps there from anywhere.
  await page.keyboard.press("ArrowLeft");
  await discussion.getByRole("button", { name: "on scene 2" }).click();
  await expect(page.getByRole("heading", { level: 2, name: SCENES[1].title })).toBeVisible();

  await discussion.getByRole("button", { name: "Delete" }).click();
  await expect(discussion.getByText("Multi-head attention finally clicked for me here.")).toHaveCount(0);
  expect(api.comments).toHaveLength(1);
});

test("a paper of your own has no discussion", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await page.goto("/pricing");
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
  await page.goto("/play");
  await page.locator('input[type="file"]').setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("heading", { level: 2, name: SCENES[0].title })).toBeVisible();
  await expect(page.getByRole("button", { name: /Discussion/ })).toHaveCount(0);
});
