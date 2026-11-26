# Composer settings plan (frontend)

Move the per-chat settings out of the header and into the composer, in the style of the Claude desktop app:
a `+` menu inside the input box for attachments and MCP servers, and a single quiet "model · thinking"
button under the box. The header keeps only the title and the Artifacts toggle.

Today's starting point: the header (`ChatView.tsx`) holds three pills, `McpPicker` (a popover of checkboxes),
`ModelPicker` (two `Select`s: `Model` and `Thinking`) and `ArtifactsToggle`. The composer toolbar holds the
paperclip, the hint "⏎ send · ⇧⏎ new line" and Send / Stop.

## Target

```
                    ┌────────────────────────────────────┐
                    │ 📎 Attach files              ⌘U    │
                    │ ────────────────────────────────── │
                    │ ⏚ MCP servers            1/1   ›   │──▶ ☑ github
                    └────────────────────────────────────┘    ☐ linear (failed)
┌────────────────────────────────────────────────────────────┐
│ (+)  Message the agent…                               (↑)  │
└────────────────────────────────────────────────────────────┘
  ⏚ github ×                                Claude Haiku · Medium ⌄
```

Header: `Chat title …                                  [▯ Artifacts (1)]`

The model button opens one menu with two radio groups:

```
┌──────────────────────────┐
│ MODEL                    │
│ ✓ Claude Haiku           │
│   GPT mini               │
│ ──────────────────────── │
│ THINKING                 │
│   Off / Low / ✓ Medium / High
└──────────────────────────┘
```

## Progress

| Step | Scope | Status |
| --- | --- | --- |
| 1 | `+` menu (attach + MCP servers) in the composer | Done |
| 2 | Combined model · thinking button under the composer | Done |
| 3 | Footer line, header cleanup, skeleton, docs | Done |

When a step ends, set its status to *Done* and add any decisions later steps need under *Step notes*.

## Rules

- **Frontend only.** No change to the API, `ConversationSettings`, queries, `useConversationChat` or the
  backend. Settings still go through `changeSettings` in `ChatView` (draft before the chat exists, saved
  after).
- **`Composer` stays unaware of models and MCP.** It takes slots (`menuItems` for the `+` menu, `footer`
  for the line under the box); `ChatView` fills them.
- **Primitives:** `DropdownMenu` from the already-installed `radix-ui` package (`Sub`, `CheckboxItem`,
  `RadioGroup`, `RadioItem`, `Label`, `Separator`). Add it as a shadcn-style wrapper in
  `src/components/ui/dropdown-menu.tsx`. No new dependency.
- **Keep the logic helpers:** `withServer` (MCP) and `withModel` (thinking falls back to `off` when the new
  model lacks the level) keep their behaviour and tests; move them if their file goes away.
- **Keep test hooks** listed in `UI_PLAN.md` except the ones this plan replaces on purpose: the `Model` /
  `Thinking` comboboxes, the `MCP servers` button and the paperclip `Attach files` button. Update their
  tests' selectors, not what they check. `file-input`, `attachment`, `Send`, `Stop`, `Message`,
  `mcp-option` stay.
- Theme tokens only, light + dark, `motion-safe:` on new animations, menus usable with the keyboard.
- **Done when:** `make check` and `make e2e` pass, and a look with `make dev` (light + dark, ~1280px and
  ~800px wide, empty chat and long chat) shows menus opening upwards without clipping.

---

## Step 1: `+` menu

Files: new `components/ComposerMenu.tsx`, new `components/ui/dropdown-menu.tsx`, `Composer.tsx`,
`ai-elements/prompt-input.tsx`, `mcp/McpPicker.tsx` (removed), `ChatView.tsx`, tests.

1. **`ui/dropdown-menu.tsx`:** thin wrappers over `radix-ui`'s `DropdownMenu` with the popover look already
   used by `McpPicker` / `ui/select` (`bg-popover`, `rounded-md` → `rounded-xl` to match the composer,
   `shadow-md`, `motion-safe:` fade/zoom).
2. **Composer layout:** one row while there is one line: `+` (round ghost icon button, `aria-label="Add"`)
   on the left, the textarea, Send / Stop on the right. Attachments stay above the row. Multi-line text
   grows the textarea; the buttons stay bottom-aligned. Remove `PromptInputHint` and the paperclip; put
   "Enter to send, Shift+Enter for a new line" in Send's `title`.
3. **Menu content** (`side="top"`, `align="start"`):
   - **Attach files** (`Paperclip`, shortcut hint `⌘U` / `Ctrl+U`) → clicks the hidden `file-input`. Bind
     the shortcut only while focus is inside the composer, and `preventDefault` it (Ctrl+U is view-source
     in some browsers).
   - Separator, then the items `ChatView` passes in `menuItems`.
4. **MCP sub-menu** (`ChatView` passes it): `Plug` icon, "MCP servers", the `enabled/total` count, `›`.
   Inside, a short muted note ("Tools are callable from code mode"), then one `CheckboxItem` per server
   (`data-testid="mcp-option"`) with the name in mono and the description or tool count below. A server
   that is not `connected` is disabled and shows its status. Ticking uses `withServer` and calls
   `onSelect={e => e.preventDefault()}` so the menu stays open. Hidden entirely when there are no servers.
5. Delete `McpPicker`; move `withServer` (and its test) next to the new component.
6. **Tests:** `Composer.test.tsx` (attach through the menu still uploads; the hidden input still works);
   `ChatView.test.tsx` "MCP servers" block: open `Add` → `MCP servers` sub-menu instead of the popover
   button. Radix menus need pointer events in jsdom; `user-event` handles them as it does for `Select`.

## Step 2: Model · thinking button

Files: `ModelPicker.tsx`, `ChatView.tsx`, `ChatView.test.tsx`, `e2e/chat.spec.ts`.

1. **Trigger:** a plain text button (no border, `text-sm text-muted-foreground hover:text-foreground`,
   `ChevronDown`), `aria-label="Model and thinking"`, `title` with the full text. Label:
   - `Claude Haiku · Medium` when thinking is on,
   - `Claude Haiku` when thinking is `off` or the model has a single level.
2. **Menu** (`side="top"`, `align="end"`): a `Model` label and a `RadioGroup` of models, then — only if the
   current model has more than one level — a separator, a `Thinking` label and a `RadioGroup` of that
   model's `thinking_levels` (`Off`, `Low`, `Medium`, `High`).
   - Picking a model applies `withModel` and keeps the menu open (`preventDefault` on select), so the
     thinking group updates in place.
   - Picking a thinking level applies it and closes the menu.
3. If a deployment has many models (say more than 6), make Thinking a `Thinking › Medium` sub-menu
   instead. Not needed today; note it if skipped.
4. **Tests:** replace the `combobox` `Model` / `Thinking` selectors with: open the `Model and thinking`
   button, then `menuitemradio` by name. Keep what they check: thinking hidden for a model without levels,
   the fallback to off, the button showing the new model (`e2e/chat.spec.ts:28-44`,
   `ChatView.test.tsx:237-246`).

## Step 3: Footer line, header, skeleton, docs

Files: `Composer.tsx`, `ChatView.tsx`, `ModelPicker.tsx`, `artifacts/ArtifactPanel.tsx`, `UI_PLAN.md`,
`CLAUDE.md`.

1. **Footer line** under the composer box (`footer` slot, `px-2 pt-1.5 text-xs`, flex, `justify-between`):
   - **Left:** one small chip per enabled, connected MCP server (`Plug` icon + name + `×` that unticks it
     via `withServer`, `aria-label="Disable <name>"`). Nothing when none are enabled. Truncate / wrap so
     the line never pushes the model button off-screen.
   - **Right:** the model · thinking button from step 2.
   - On the empty chat the footer moves with the centred composer, above the suggestions.
2. **Header:** remove `McpPicker` and `ModelPicker`; keep the title and `ArtifactsToggle`. `pillClass` /
   `pillLabel` are still used by `ArtifactPanel` — move them there (or to `utils.ts`) and delete them from
   `ModelPicker.tsx`.
3. **Skeleton** (`ChatView.tsx`, the loading shape): drop the header pill placeholders, add a short
   footer-line placeholder under the composer.
4. **Docs:** add a note in `UI_PLAN.md` *Step notes* that the composer toolbar from step 6 was replaced
   (link here) and update its test-hook list; add a line for this plan in `CLAUDE.md`.

---

## Step notes

### Step 1 (done)

- **Files:** the MCP sub-menu is `mcp/McpMenu.tsx` (`McpMenu`, plus `withServer`, whose test stays in
  `mcp/mcp.test.tsx`), not in `ComposerMenu.tsx`. That keeps `ComposerMenu` (the `+` button, "Attach
  files", then the `items` slot) free of MCP. `Composer` takes `menuItems` and passes it through.
  `ChatView` passes `McpMenu` only when there are servers and settings are loaded, so the separator
  doesn't show above an empty slot.
- **`ui/dropdown-menu.tsx`:** `DropdownMenu`, `Trigger`, `Content`, `Group`, `Item`, `CheckboxItem`
  (a filled `bg-primary` box), `RadioGroup`, `RadioItem` (a dot), `Label`, `Separator`, `Shortcut`,
  `Sub`, `SubTrigger`, `SubContent`. `Content` / `SubContent` default to `sideOffset={6}` and
  `collisionPadding={8}`; items are `rounded-lg` inside a `rounded-xl` popover. Step 2 can use
  `RadioGroup` / `RadioItem` / `Label` as they are.
- **Shortcut:** `attachShortcut` in `ComposerMenu.tsx`: ⌘U on Apple platforms, Ctrl+U elsewhere,
  handled by `onKeyDown` on the composer's form (so only while focus is inside it).
- **Layout:** `items-end` row; the `+` and Send / Stop sit in `h-10` boxes so they line up with a
  one-line textarea (`py-2.5`) and stay at the bottom as it grows. `PromptInputToolbar` and
  `PromptInputHint` were removed from `prompt-input.tsx`. The composer is now shorter (~3.5rem): step 3's
  skeleton (`h-[6.5rem]` today) should shrink to match.
- **Tests:** in jsdom a pointer moving into a Radix sub-menu closes it (no layout, so the "grace area"
  check fails). `ChatView.test.tsx` opens the sub-menu with a click, then toggles items by keyboard
  (focus + Space). Do the same for anything inside a sub-menu.
- **Look:** checked in Playwright screenshots (light 1280, dark 800, empty and long chat). At ~800px the
  MCP sub-menu flips left over the sidebar; nothing clips.

### Step 2 (done)

- **Placement:** `ModelPicker` is now the quiet "model · thinking" button but still sits in the header
  (with `className="max-w-[50%]"` so a long label truncates instead of squeezing the title). Its menu is
  `side="top"`; in the header Radix flips it below. Step 3 moves it into the composer's `footer` slot and
  can drop that `className`.
- **API:** `ModelPicker` takes an optional `className` for the trigger. `modelLabel(model, thinking)`
  builds the button text (`Claude Haiku · Medium`, or just the model when thinking is off or the model has
  one level); the `title` spells out both.
- **Kept:** `withModel` stays in `ModelPicker.tsx` (its test is in `useConversationChat.test.ts`).
  `pillClass` / `pillLabel` are still exported there for `ArtifactPanel`; step 3 moves them.
- **Thinking sub-menu** (point 3) skipped: two models today. Switch to `Thinking › Medium` past ~6 models.
- **Tests:** `ChatView.test.tsx` and `e2e/chat.spec.ts` open `Model and thinking` and pick
  `menuitemradio`s (`GPT mini`, `High`). The unit test also checks that the menu stays open after a model
  change and that the `High` item goes; e2e checks a level closes the menu and shows `· High`.

### Step 3 (done)

- **Footer slot:** `Composer` wraps the form in a `div` and renders `footer` under the box in a
  `flex items-start justify-between gap-2 px-2 pt-1.5 text-xs` row (outside the form, so the ⌘U handler
  and drop zone stay on the box). On the empty chat it moves with the centred composer, above the
  suggestions.
- **Chips:** `McpChips` in `mcp/McpMenu.tsx` (same props as `McpMenu`): a `flex-wrap` list
  (`aria-label="Enabled MCP servers"`), one `data-testid="mcp-chip"` per enabled, connected server, names
  truncated at `max-w-32`, `×` named `Disable <name>` using `withServer`. Nothing when none are enabled.
- **Model button:** `ModelPicker` in the footer with `className="ml-auto max-w-[60%] shrink-0"` (`ml-auto`
  keeps it right when there are no chips; it truncates rather than being pushed off). Kept `text-sm`
  (the step 2 trigger spec) while the chips are `text-xs`.
- **Header:** title and `ArtifactsToggle` only. `pillClass` / `pillLabel` moved into
  `artifacts/ArtifactPanel.tsx` (module-private; only the toggle and the version picker use them).
- **Skeleton:** no header pills; composer `h-14` (was `h-[6.5rem]`) plus a `h-5 w-28` placeholder at the
  right of a footer line.
- **Tests:** new `ChatView.test.tsx` case for the chips (failed server has none, `×` unticks and the `+`
  menu count follows, the model button stays). e2e unchanged.
- **Look:** Playwright screenshots (light / dark, 1280 / 800, empty / long chat, fake MCP servers via
  `page.route`): both menus open upwards from the composer, nothing clips; at 800px the MCP sub-menu
  flips left over the sidebar as before. The model menu covers the right of the composer box while open.
