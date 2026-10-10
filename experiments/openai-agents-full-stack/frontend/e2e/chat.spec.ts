import { expect, test } from "@playwright/test";

// The server and its database are shared by every test (and repeat): unique messages keep
// titles from colliding.
const unique = (text: string) => `${text} #${Math.random().toString(36).slice(2, 8)}`;

test("send a message, see the tool call and answer, then reload and rename", async ({ page }) => {
  const question = unique("What is 6 times 7?");
  const renamed = unique("Arithmetic");
  await page.goto("/");

  await page.getByLabel("Message").fill(question);
  await page.getByLabel("Message").press("Enter");

  // The first message creates the session and selects it.
  await expect(page).toHaveURL(/#[0-9a-f]{32}$/);
  const run = page.getByTestId("run").first();
  await expect(run.getByTestId("user-message")).toHaveText(question);
  const tool = run.getByTestId("tool-card");
  await expect(tool).toHaveAttribute("data-status", "ok");
  await expect(run.getByTestId("assistant-message")).toContainText("The tool said");
  await expect(run).toHaveAttribute("data-status", "succeeded");
  await tool.locator("summary").click();
  await expect(tool).toContainText("42");

  // The session list picks up the title set from the first message.
  const chats = page.getByRole("navigation", { name: "Chats" });
  await expect(chats.getByRole("button", { name: question, exact: true })).toBeVisible();

  // History survives a reload: the runs' events are folded again.
  await page.reload();
  await expect(page.getByTestId("run")).toHaveCount(1);
  await expect(page.getByTestId("tool-card")).toHaveAttribute("data-status", "ok");

  // A second message in the same session.
  await page.getByLabel("Message").fill("Again");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("run")).toHaveCount(2);
  await expect(page.getByTestId("run").nth(1)).toHaveAttribute("data-status", "succeeded");

  // Rename, then delete.
  await chats.getByRole("button", { name: question, exact: true }).hover();
  await chats.getByRole("button", { name: `Rename ${question}` }).click();
  await chats.getByLabel("Chat title").fill(renamed);
  await chats.getByLabel("Chat title").press("Enter");
  await expect(chats.getByRole("button", { name: renamed, exact: true })).toBeVisible();

  await chats.getByRole("button", { name: renamed, exact: true }).hover();
  await chats.getByRole("button", { name: `Delete ${renamed}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(chats.getByRole("button", { name: renamed, exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/#/);
});

test("a reload during a run resumes its stream", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Message").fill(unique("Count slowly"));
  await page.getByLabel("Message").press("Enter");

  const run = page.getByTestId("run").first();
  await expect(run.getByTestId("tool-card")).toHaveAttribute("data-status", "ok");
  await expect(run).toHaveAttribute("data-status", "running");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await page.reload();
  // History brings back the tool call; the stream resumes after it and finishes the run.
  await expect(run).toHaveAttribute("data-status", "running");
  await expect(run.getByTestId("tool-card")).toHaveAttribute("data-status", "ok");
  await expect(run).toHaveAttribute("data-status", "succeeded", { timeout: 10_000 });
  await expect(run.getByTestId("assistant-message")).toContainText("The tool said");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("a chart is drawn in its message and opens in the artifacts panel", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Message").fill(unique("Show a chart of points per game"));
  await page.getByLabel("Message").press("Enter");

  const run = page.getByTestId("run").first();
  await expect(run).toHaveAttribute("data-status", "succeeded");
  const card = run.getByTestId("artifact-card");
  await expect(card).toContainText("Points per game");
  await expect(card).toHaveAttribute("data-version", "1");
  // vega draws three bars into an SVG.
  await expect(card.locator("svg .mark-rect path")).toHaveCount(3);

  await card.getByRole("button", { name: "Open Points per game" }).click();
  await expect(page).toHaveURL(/#[0-9a-f]{32}\/[0-9a-f]{32}$/);
  const panel = page.getByRole("complementary", { name: "Artifacts" });
  await expect(panel.getByTestId("artifact-entry")).toHaveCount(1);
  await expect(panel.getByTestId("artifact-entry")).toHaveAttribute("aria-current", "true");
  await expect(panel.locator("svg .mark-rect path")).toHaveCount(3);

  // The open artifact is part of the URL: a reload keeps the panel.
  await page.reload();
  await expect(panel.locator("svg .mark-rect path")).toHaveCount(3);

  await panel.getByRole("button", { name: "Close artifacts" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Artifacts (1)" }).click();
  await expect(panel).toBeVisible();
});
