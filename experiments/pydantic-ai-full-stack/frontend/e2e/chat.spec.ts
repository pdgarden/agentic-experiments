import { expect, type Page, test } from "@playwright/test";

// One server and database for every test: unique messages keep them apart.
const unique = (text: string) => `${text} #${Math.random().toString(36).slice(2, 8)}`;

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByLabel("Message").press("Enter");
}

test("chat, pick a thinking model, reload, rename and delete", async ({ page }) => {
  const question = unique("Hello there");
  await page.goto("/");
  await send(page, question);

  // The first send creates the conversation and puts its id in the URL.
  await expect(page).toHaveURL(/#[0-9a-f]{32}$/);
  await expect(page.getByTestId("user-message")).toHaveText(question);
  await expect(page.getByTestId("assistant-message")).toContainText(`You said: ${question}`);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  // The generated title reaches the sidebar and the header.
  const chats = page.getByRole("navigation", { name: "Chats" });
  await expect(page.getByTestId("chat-title")).toHaveText("E2E title");
  await expect(chats.getByRole("button", { name: "E2E title", exact: true }).first()).toBeVisible();

  // Turn thinking on: the next reply streams reasoning first.
  const picker = page.getByRole("button", { name: "Model and thinking" });
  await picker.click();
  await page.getByRole("menuitemradio", { name: "High" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(picker).toContainText("· High");
  await send(page, "Think about it");
  const reply = page.getByTestId("assistant-message").nth(1);
  await expect(reply).toContainText("You said: Think about it");
  await expect(reply.getByTestId("reasoning")).toContainText("Reasoning");

  // A model without thinking hides the level.
  await picker.click();
  await page.getByRole("menuitemradio", { name: "GPT mini" }).click();
  await expect(page.getByRole("menuitemradio", { name: "High" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // History and settings come back from the server.
  await page.reload();
  await expect(page.getByTestId("user-message")).toHaveCount(2);
  await expect(page.getByTestId("assistant-message").nth(1).getByTestId("reasoning")).toBeVisible();
  await expect(page.getByRole("button", { name: "Model and thinking" })).toHaveText("GPT mini");

  // Rename, then delete.
  const renamed = unique("Greetings");
  const current = chats.locator('[aria-current="page"]');
  await current.hover();
  await chats.getByRole("button", { name: "Rename E2E title" }).first().click();
  await chats.getByLabel("Chat title").fill(renamed);
  await chats.getByLabel("Chat title").press("Enter");
  await expect(chats.getByRole("button", { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByTestId("chat-title")).toHaveText(renamed);

  await chats.getByRole("button", { name: renamed, exact: true }).hover();
  await chats.getByRole("button", { name: `Delete ${renamed}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(chats.getByRole("button", { name: renamed, exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/#/);
});

test("a reload during a run resumes its stream, with the prompt shown", async ({ page }) => {
  const prompt = unique("slow please");
  await page.goto("/");
  await send(page, prompt);
  await expect(page.getByTestId("assistant-message")).toContainText("You said:");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("user-message")).toHaveText(prompt);
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  await expect(page.getByTestId("assistant-message")).toContainText("tick tick");
});

test("stop keeps the partial reply", async ({ page }) => {
  await page.goto("/");
  await send(page, unique("slow please"));
  const reply = page.getByTestId("assistant-message");
  await expect(reply).toContainText("You said:");
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(reply).toContainText("Stopped");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const partial = ((await reply.locator(".prose").textContent()) ?? "").trim();
  expect(partial).not.toContain("tick tick tick tick tick tick tick tick tick tick");

  await page.reload();
  await expect(page.getByTestId("assistant-message")).toContainText(partial);
});

test("a text attachment is uploaded, read by the model and kept in history", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Notes\nremember the milk"),
  });
  await expect(page.getByTestId("attachment")).toHaveAttribute("data-status", "ready");
  await send(page, unique("Summarise this"));

  await expect(page.getByTestId("attachment")).toHaveCount(0);
  await expect(page.getByTestId("user-message").getByTestId("file-chip")).toHaveText("notes.md");
  // The scripted model echoes the prompt, inlined attachment included.
  await expect(page.getByTestId("assistant-message")).toContainText("remember the milk");

  await page.reload();
  await expect(page.getByTestId("user-message").getByTestId("file-chip")).toHaveText("notes.md");
});

test("an artifact shows in the message and in the panel, also after a reload", async ({ page }) => {
  await page.goto("/");
  await send(page, unique("draw a chart"));

  const card = page.getByTestId("artifact-card");
  await expect(card).toContainText("Wins by team");
  await expect(card).toHaveAttribute("data-version", "1");
  await expect(card.locator("svg, canvas").first()).toBeVisible();
  await expect(page.getByTestId("assistant-message")).toContainText("Here it is.");

  await card.getByRole("button", { name: "Open Wins by team" }).click();
  const panel = page.getByRole("complementary", { name: "Artifacts" });
  await expect(panel.getByTestId("artifact-entry")).toContainText("Wins by team");
  await expect(panel.getByTestId("artifact-panel-view")).toHaveAttribute("data-version", "1");
  await panel.getByRole("button", { name: "Close artifacts" }).click();

  // The card is rebuilt from the stored tool output.
  await page.reload();
  await expect(page.getByTestId("artifact-card")).toContainText("Wins by team");
  await page.getByRole("button", { name: /Artifacts \(1\)/ }).click();
  await expect(panel.getByTestId("artifact-panel-view")).toBeVisible();
});

test("code mode shows the Python it ran", async ({ page }) => {
  await page.goto("/");
  await send(page, unique("compute"));

  const reply = page.getByTestId("assistant-message");
  await expect(reply).toContainText("The result is 45.");
  const tool = reply.getByTestId("tool-card");
  await expect(tool).toContainText("run_code");
  await tool.click();
  await expect(tool.getByTestId("tool-code")).toContainText("sum(range(10))");
});
