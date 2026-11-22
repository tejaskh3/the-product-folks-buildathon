// Reading tools in a real browser: bookmark a scene, highlight selected text, favorite the
// paper, keep notes and export them, ask about a selection, and come back from the shelf.
// All /api calls go to FakeApi; Clerk is real (dev instance, test user).
import { readFileSync } from "node:fs";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_EMAIL, FakeApi, PDF, SCENES } from "./fakeApi";

test.beforeEach(async ({ context }) => {
  await setupClerkTestingToken({ context });
});

/** Selects the first `words` words of the scene's narration, as a reader dragging would. */
async function selectNarration(page: Page, words: number): Promise<string> {
  return page.evaluate((n) => {
    const p = document.querySelector<HTMLElement>('[data-place-kind="scene"] h2 ~ p, [data-place-kind="scene"] p.text-ink-2');
    const text = p!.firstChild as Text;
    const end = text.data.split(" ").slice(0, n).join(" ").length;
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, end);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    return sel.toString();
  }, words);
}

test("bookmark, highlight, favorite, notes, export, ask about a selection, and back from the shelf", async ({ page }) => {
  const api = new FakeApi(page);
  await api.install();
  await page.goto("/pricing");
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
  await page.goto("/play");
  await page.locator('input[type="file"]').setInputFiles({ name: "attention.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("heading", { level: 2, name: SCENES[0].title })).toBeVisible();
  await expect.poll(() => api.reading.opened).toBe(true); // History

  // Bookmark scene 2.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { level: 2, name: SCENES[1].title })).toBeVisible();
  await page.getByRole("button", { name: "Bookmark this scene" }).click();
  await expect(page.getByRole("button", { name: "Remove bookmark from this scene" })).toHaveAttribute("aria-pressed", "true");
  expect(api.reading.bookmarks).toMatchObject([{ kind: "scene", target: SCENES[1].id, label: `Scene 2: ${SCENES[1].title}` }]);

  // Highlight a few words: saved for this scene, and painted.
  const quote = await selectNarration(page, 4);
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Highlight green" }).click();
  await expect.poll(() => api.reading.highlights.length).toBe(1);
  expect(api.reading.highlights[0]).toMatchObject({ kind: "scene", target: SCENES[1].id, quote, color: "green" });
  await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has("curio-green"))).toBe(true);

  // Ask about a selection: the question starts with it.
  await selectNarration(page, 3);
  await page.getByRole("toolbar", { name: "Selected text" }).getByRole("button", { name: "Ask Curio" }).click();
  await expect(page.getByLabel(/Ask about/)).toHaveValue(/^About “.+”: $/);

  // Notes: favorite from here (phones have no room for the star in the header), type and it
  // saves; the highlight and bookmark are listed; export has it all.
  await page.getByRole("button", { name: /^Notes/ }).click();
  const notes = page.getByRole("dialog", { name: "Your notes" });
  await notes.getByRole("button", { name: "Add to favorites" }).click();
  await expect(notes.getByRole("button", { name: "In your favorites" })).toHaveAttribute("aria-pressed", "true");
  expect(api.reading.favorite).toBe(true);
  await notes.getByLabel("Notes", { exact: true }).fill("Attention replaces recurrence.");
  await expect(notes.getByText("Saved")).toBeVisible();
  expect(api.reading.notes).toBe("Attention replaces recurrence.");
  await expect(notes.getByText(`“${quote}”`)).toBeVisible();
  await notes.getByLabel("Note on this highlight").fill("The key claim.");
  await notes.getByLabel("Note on this highlight").blur();
  await expect.poll(() => api.reading.highlights[0].note).toBe("The key claim.");
  const [download] = await Promise.all([page.waitForEvent("download"), notes.getByRole("button", { name: "Export .md" }).click()]);
  const md = readFileSync(await download.path(), "utf8");
  expect(md).toContain("# Attention Is All You Need");
  expect(md).toContain("Attention replaces recurrence.");
  expect(md).toContain(`> ${quote}`);
  expect(md).toContain("The key claim.");
  expect(md).toContain(`- Scene 2: ${SCENES[1].title}`);
  await page.keyboard.press("Escape");
  await expect(notes).toBeHidden();

  // The shelf: the bookmark opens the paper at scene 2.
  await page.goto("/play");
  await page.getByRole("tab", { name: /Bookmarks/ }).click();
  await page.getByRole("tabpanel").getByRole("link", { name: new RegExp(`Scene 2: ${SCENES[1].title}`) }).click();
  await expect(page.getByRole("heading", { level: 2, name: SCENES[1].title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/play/${api.paperId}$`));
  await page.goto("/play");
  for (const tab of ["Favorites", "History", "My papers"]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).click();
    await expect(page.getByRole("tabpanel").getByRole("link", { name: /Attention Is All You Need/ })).toBeVisible();
  }
});
