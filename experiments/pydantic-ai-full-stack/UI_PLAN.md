# UI polish plan (frontend)

A visual pass on `frontend/`, split into steps that each fit **one Claude session**. Do them in order:
step 1 sets the tokens every later step builds on. Steps 2 to 7 are mostly independent after that, and
step 8 comes last.

Today's starting point: the stock shadcn "new-york / neutral" theme (every token grey, chroma 0), the system
font, a theme that only follows the OS (`@custom-variant dark` on a media query in `src/index.css`), and
plain bordered boxes for the sidebar, header, empty state, tool and reasoning cards.

## Progress

| Step | Scope | Status |
| --- | --- | --- |
| 1 | Design tokens, fonts, theme toggle | Done |
| 2 | Sidebar | Done |
| 3 | Header + empty state | Done |
| 4 | Messages + Markdown | Done |
| 5 | Tool and reasoning cards | Done |
| 6 | Composer | Done |
| 7 | Artifact panel | Done |
| 8 | Loading / error states, motion, a11y sweep | Done |

When a step ends, set its status to *Done* and add any decisions that later steps need under *Step notes*
at the bottom.

## Rules for every step

- **Visual only.** Don't change the API client, queries, `useConversationChat` or the backend. If a step
  seems to need a backend change, write it in *Step notes* and leave it out.
- **Keep test hooks stable.** Keep every `data-testid`, ARIA role and accessible name the tests use:
  `user-message`, `assistant-message`, `tool-card`, `tool-code`, `reasoning`, `attachment`, `file-chip`,
  `file-input`, `chat-title`, `chat-scroller`, `mcp-servers`, `artifact-card`, `artifact-entry`,
  `artifact-panel-view`, and the buttons named `Send`, `Stop`, `New chat`, `Delete`, `Close artifacts`,
  `Rename …`, `Delete …`, `Open …`, `Artifacts (n)`, `Add`, `Model and thinking`, `Disable …`, plus
  `mcp-option`, the `Version` combobox, the `Message` and `Chat title` labels, the `Chats`
  navigation and the `Artifacts` complementary region. (The `Model` / `Thinking` comboboxes, the header
  `MCP servers` button and the paperclip were replaced by `COMPOSER_PLAN.md`.)
  If a test has to change, change its selector, not what it checks.
- **Use theme tokens** (`bg-primary/10`, `text-muted-foreground`, …). No raw hex in components.
  Check every change in **both light and dark** themes.
- **Stack constraints:** shadcn components (`components.json`) go in `src/components/ui/`, icons come from
  `lucide-react`, animations from `tw-animate-css` (already installed). Add a dependency only when the
  step says so. Pin exact versions with pnpm (`npx -y pnpm@11.28.2` if pnpm isn't on `PATH`).
- **Respect `prefers-reduced-motion`**: use `motion-safe:` on every new animation.
- **Done when:** `make check` and `make e2e` pass, and you took a quick look with `make dev`
  (light + dark, about 1280px wide and about 800px wide), then updated the *Progress* table.

---

## Step 1: Design tokens, fonts, theme toggle

Every later step depends on this one. Steps 2 to 7 should only need the tokens set here.

1. **Pick the direction** at the start of the session (ask the user if not stated here):
   - A. Warm neutral + magenta accent, `oklch(0.62 0.2 350)` (Pydantic-ish). **Default.**
   - B. Cool neutral + indigo accent, `oklch(0.55 0.2 270)`.
   - C. High-contrast mono with a single bright accent used only for focus and active states.
2. **Tokens** in `src/index.css`:
   - Set `--primary`, `--ring` and `--sidebar-primary` to the accent. Add `--accent-soft` (the accent at
     low chroma and high lightness in light mode, low lightness in dark mode) for tinted surfaces.
   - Tint the neutrals slightly with the accent hue (chroma 0.005 to 0.012) so they feel warm or cool, not
     dead grey.
   - Separate the surface levels, especially in dark mode: page background < sidebar < card / composer.
   - Add `--success` and `--warning` (with `-foreground` variants) next to `--destructive`, and map them
     in `@theme inline`. Step 5 uses them.
   - Replace the hard-coded GitHub hex values for highlight.js with `--code-*` tokens defined per theme.
3. **Fonts:** self-host with `@fontsource-variable/inter` (or Geist) and
   `@fontsource-variable/jetbrains-mono` (or Geist Mono), so there is no network call to Google Fonts.
   Set `--font-sans` and `--font-mono` in `@theme`. Enable `font-feature-settings: "cv11", "ss01"` for Inter
   if it looks better.
4. **Theme toggle (light / dark / system):**
   - Switch `@custom-variant dark` to class-based (`&:where(.dark, .dark *)`), and move the dark tokens
     from the media query to `.dark`.
   - Add a small `useTheme` hook that stores the choice in `localStorage` (with try/catch), follows
     `matchMedia` for *system*, and sets `.dark` on `<html>`.
   - Add an inline script in `index.html` that sets the class before first paint, to avoid a flash.
   - `VegaChart.tsx` reads `prefers-color-scheme` directly. Make it read the resolved theme instead.
   - For now, put the toggle (a `ui/dropdown-menu` or a three-state icon button) at the bottom of the
     sidebar. Step 2 restyles it.
5. Set the `<title>` in `index.html`, and add a simple SVG favicon in the accent colour.

**Out of scope:** changing any component's layout.

## Step 2: Sidebar

Files: `Sidebar.tsx`, `mcp/McpServers.tsx`, plus a new `utils` helper for date buckets.

- **Brand header:** a logo mark (an accent-coloured lucide icon or a small SVG) and the app name at the
  top. Make `New chat` a prominent but compact button, and keep its accessible name.
- **Group chats by `updated_at`:** *Today*, *Yesterday*, *Previous 7 days*, *Older*, with small muted
  section labels. Write the bucketing as a pure function and unit-test it with a fixed "now".
- **Active row:** `bg-sidebar-accent` plus a 2px accent bar on the left. Hover rows more softly.
  Show the rename / delete icons on hover, as today.
- **Running indicator:** keep `Loader2`, coloured with the accent.
- **MCP servers:** a status dot per server (green connected, red error, grey disabled) instead of text.
  The detail goes in a `title` or tooltip.
- **Bottom bar:** the theme toggle from step 1, styled as a row of icon buttons.
- **Collapsible sidebar:** shortcut ⌘B / Ctrl+B. When collapsed, show an icon rail with *new chat* and
  *expand*. Store the state in `localStorage`. Keep the `Chats` navigation in the DOM when expanded.
- **Out of scope:** chat search (⌘K). Add it to *Step notes* as a follow-up if wanted.

## Step 3: Header + empty state

Files: `ChatView.tsx`, `ai-elements/conversation.tsx`, `ModelPicker.tsx`, `mcp/McpPicker.tsx`.

- **Header:** make it sticky with `backdrop-blur` and a translucent background, so messages scroll under
  it. Use a softer bottom border. Keep `chat-title` on the title.
- **Pickers as compact pills:** show a small trigger with an icon and a short label (model name, thinking
  level, MCP count). Keep the `Model` / `Thinking` comboboxes and their option names; only the trigger
  styling changes.
- **Empty state:**
  - A centred greeting ("What can I help with?"), with the logo mark above it.
  - 3 or 4 suggestion chips that **fill the composer** (they don't send), each with an icon and showing
    off one capability: a chart artifact, web search, code mode, an MCP tool.
  - The `Composer` needs a way to receive text from outside. Use a controlled `draft` prop or a ref with
    `setText`, kept small.
- **Centred composer while empty:** when `messages.length === 0`, centre the greeting, chips and composer
  vertically. After the first message, the usual layout returns with the composer at the bottom. Keep it
  one `Composer` instance (move it, don't remount it) so that focus and attachments survive.
- Add a unit test: clicking a chip puts its text into the `Message` textarea.

## Step 4: Messages + Markdown

Files: `ai-elements/message.tsx`, `MessageParts.tsx`, `Markdown.tsx`, `index.css`.

- **User bubble:** `bg-primary/10` (or `--accent-soft`) with a slightly smaller radius on the corner next
  to the edge. Keep `max-w-[85%]`.
- **Assistant:** a small avatar or logo mark in the gutter, or above the first line on narrow screens.
- **Hover actions** under each finished assistant message: *Copy* (copies the text parts as Markdown),
  with a check-mark confirmation. *Regenerate* is **out of scope** because the server owns history, so
  note it in *Step notes*.
- **Code blocks:** override `pre` in `Markdown`. Add a header bar with the language label and a *Copy*
  button. Use a `--code-bg` surface, rounded corners, and horizontal scroll without wrapping. Inline code
  gets a subtle background, with no back-tick pseudo-elements.
- **Prose:** a slightly larger `leading`, accent links with an underline offset, tighter heading margins,
  zebra rows or bottom borders on tables, and quote blocks with an accent left rule. Check that KaTeX
  display math still renders and scrolls.
- **Loader:** replace the three dots with a shimmering "Thinking…" (a gradient text animation in `@theme`
  keyframes). Keep `role="status"` and the `Working…` sr-only label.
- **Entry animation:** new messages get `motion-safe:animate-in fade-in slide-in-from-bottom-1`. Messages
  loaded from history must **not** animate: only animate ids added after mount.

## Step 5: Tool and reasoning cards

Files: `ai-elements/tool.tsx`, `ai-elements/reasoning.tsx`, `MessageParts.tsx`.

- **State styling:**
  - Running / preparing: a spinning `Loader2` and an accent left border.
  - Done: a `--success` check.
  - Error: a `--destructive` tint and border.
  - Awaiting approval: `--warning` (ready for phase 3).
  - Keep the badge text, or move it to sr-only if the icon replaces it, but keep `data-state`.
- **`run_code`:** a terminal-style frame (a dark title bar with the `run_code` label and three muted
  dots), the Python highlighted inside, and the output below with a `›` prompt marker in mono. Keep
  `tool-code`.
- **Other tools:** show a one-line summary of the arguments in the collapsed row (truncated), and pretty
  JSON inside.
- **Grouping:** gather consecutive tool parts in an assistant message into a single "Used N tools" row
  that expands to the individual cards. A single tool call stays ungrouped. Each card keeps its
  `tool-card` testid, so e2e tests may need to open the group first; adjust the selectors only.
- **Reasoning:** drop the dashed box and use a muted left rule with text slightly smaller and in italic.
  While it streams, the summary shimmers like the step 4 loader. Keep `reasoning` and the open-while-
  streaming behaviour.
- **Smooth open / close:** use `interpolate-size: allow-keywords` with a `::details-content` transition,
  falling back to instant. No JS height measuring.

## Step 6: Composer

Files: `Composer.tsx`, `ai-elements/prompt-input.tsx`.

- **Focus:** an accent ring (`focus-within:ring-2 ring-ring/40`) and a slightly stronger shadow.
- **Drag-over overlay:** a dashed accent border and a "Drop files to attach" label while files are dragged
  over the form. Track it with a drag-enter / leave counter so child elements don't flicker it.
- **Attachments as cards:** image thumbnails at about 56px, and a file-type icon plus the name for other
  files. Show an upload progress spinner on top of the card, an error state in a destructive tint, and a
  remove button in the corner on hover. Keep `attachment` + `data-status` and the `Remove …` names.
- **Toolbar:** the paperclip on the left, then a muted hint "⏎ send · ⇧⏎ new line" (hidden on narrow
  screens), then the send button on the right. Send uses the accent and a subtle `hover:scale-105`. Stop
  looks distinct (a square in a ring).
- The textarea grows smoothly up to `max-h-48`. It already auto-grows, so just check that it still does.

## Step 7: Artifact panel

Files: `artifacts/ArtifactPanel.tsx`, `ArtifactCard.tsx`, `ArtifactView.tsx`.

- **Resizable panel:** a drag handle on the left edge (pointer events, clamped to 24rem–70vw), with the
  width stored in `localStorage`. Add a double-click to reset it. Keep `role=complementary` named
  `Artifacts`.
- **Panel header:** the artifact title, the version select (keep `Version`), *Copy* / *Download* for text
  artifacts, and close. The artifact list becomes a compact segmented list or tabs.
- **Inline `ArtifactCard`:** an icon per kind (chart or text), the title, a version badge and a "Open"
  affordance, plus a tiny preview (the first lines of text, or a mini chart icon). Keep `artifact-card`
  and `Open …`.
- **Panel entry:** slide in from the right (`motion-safe`).
- **Narrow screens (< 900px):** the panel overlays the chat as a sheet instead of squeezing it.

## Step 8: Loading / error states, motion, a11y sweep

- **Skeletons:** replace `Notice` "Loading…" with skeleton placeholders: a few message-shaped blocks, and
  sidebar rows while the chats load. Add a `ui/skeleton.tsx`.
- **Errors:** turn the inline red text in `ChatView` and `Composer` into a small alert block with an
  icon, plus a *Retry* where there is already an action to call (`continueRun`). Restyle
  `InterruptedBanner` to match.
- **Scroll to bottom:** a floating "↓" button when the user has scrolled up in `Conversation`. Reuse its
  `pinned` logic.
- **Sweep:**
  - Check contrast with the browser's devtools on muted text and badges in both themes.
  - Check that every animation is `motion-safe`.
  - Make focus rings visible everywhere.
  - Fix any horizontal overflow at 375px.
- **Final screenshots:** take light and dark screenshots of the empty state, a chat with tools and
  reasoning, and the artifact panel. Add one to the `README.md` if wanted.

---

## Step notes

Decisions and follow-ups that later steps need go here (theme direction chosen, token names added,
deferred ideas such as ⌘K search or regenerate).

### Step 1 (done)

- **Direction A:** warm neutrals tinted at hue 350 (chroma 0.004 to 0.014), magenta accent. The accent is
  `oklch(0.58 0.2 350)` in light (not 0.62: white text on it must pass AA, 4.6:1) and
  `oklch(0.72 0.17 350)` in dark.
- **Tokens added** (all mapped in `@theme inline`, so `bg-*` / `text-*` work):
  `accent-soft` + `accent-soft-foreground` (tinted surfaces and their text), `success`, `warning`,
  `destructive-foreground` (each with `-foreground`), `sidebar-primary(-foreground)`, `sidebar-ring`, and
  `code` / `code-foreground` (from `--code-bg` / `--code-fg`). highlight.js colours come from
  `--code-comment`, `--code-keyword`, `--code-string`, `--code-number`, `--code-title`, `--code-deletion`.
  `Markdown` still uses `prose-pre:bg-muted`; step 4 should switch it to `bg-code`.
- **Surfaces:** background < sidebar < card < popover. In light the card is pure white over a tinted page.
- **Fonts:** `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (5.3.0, imported in
  `main.tsx`); `font-sans` / `font-mono` are set in `@theme`, and `body` turns on Inter's `cv11`, `ss01`.
- **Theme:** `src/hooks/useTheme.ts` (`useTheme()` returns `choice`, `resolved`, `setTheme`; localStorage
  key `theme`). `index.html` has an inline pre-paint script with the same key and logic. `dark:` is
  class-based (`.dark` on `<html>`), and `color-scheme` follows it. `VegaChart` reads `resolved`.
- **Toggle:** `components/ThemeToggle.tsx`, three icon buttons (`Light theme`, `Dark theme`,
  `System theme`, with `aria-pressed`) in a `fieldset` at the bottom of the sidebar. Step 2 can move or
  restyle it and should keep those names.
- **Favicon:** `public/favicon.svg` (accent square with a chat bubble). Its raw hex is outside the
  components, so the token rule doesn't apply.

### Step 2 (done)

- **Brand:** the logo mark is `LogoMark` in `Sidebar.tsx` (a filled lucide `MessageSquare` on a
  `bg-primary` rounded square, same as the favicon) next to "Agent chat". Step 3's empty state can reuse
  it: move it to its own file when it does.
- **New chat** is a compact `bg-accent-soft` button outside the `Chats` nav (an untitled chat inside the
  nav is also named `New chat`, and the unit test relies on that).
- **Date groups:** `src/dateBuckets.ts` (`bucketOf`, `groupByDate`, local calendar days, tested with a
  fixed "now"). Each group is an `h2` plus a `ul` labelled by it, so tests can use
  `getByRole("list", { name: "Today" })`.
- **Active row:** `bg-sidebar-accent` plus a 2px `before:` bar in `sidebar-primary`; other rows hover at
  `bg-sidebar-accent/60`.
- **MCP servers:** a dot (`bg-success` / `bg-destructive` / `bg-muted-foreground/40`) and the detail in a
  `title`. Connected servers still show "n tools"; the status word of the others is `sr-only`, so the
  existing test is unchanged.
- **Collapse:** `src/hooks/useSidebarCollapsed.ts` (localStorage key `sidebar-collapsed`, ⌘B / Ctrl+B on
  `window`). Collapsed, the sidebar is a `w-12` rail with `Expand sidebar` and `New chat`; the `Chats` nav
  is not rendered. The expanded header has `Collapse sidebar`.
- **Theme toggle:** now borderless icon buttons in a "Theme" bottom bar; names unchanged.
- **For step 3:** at about 800px wide the header title shrinks to "E2…" because the three pickers take
  the room. The compact pills should fix it.
- **Follow-up (not done):** ⌘K chat search.

### Step 3 (done)

- **Logo:** `LogoMark` now lives in `components/LogoMark.tsx` (`size="sm"` for the sidebar, `"lg"` for
  the greeting).
- **Header:** `absolute` over the chat column (`h-12`, `bg-background/60` + `backdrop-blur-md`, a softer
  `border-border/60`); the scroller gets `pt-12` so messages scroll under it. Anything later that
  sits at the top of the column must clear those 3rem.
- **Pills:** `pillClass` (exported from `ModelPicker.tsx`) styles the `Model` / `Thinking` select
  triggers, the MCP button and the `Artifacts (n)` toggle. Model shows a `Sparkles` icon and its label;
  Thinking shows a `Brain` icon and a short level ("Off", "High"; the full name is in `title`, the
  option names are unchanged). The MCP pill shows `n/m` with a `sr-only` "MCP " prefix, so its text is
  still "MCP n/m".
- **Empty state:** `ConversationEmptyState` takes `icon`, `title`, `description`. `Suggestions.tsx`
  holds the four chips (a `list` named `Suggestions`); they call `ComposerHandle.setText`, which fills
  and focuses the textarea and never sends.
- **Composer handle:** `Composer` takes a React 19 `ref` prop of type `ComposerHandle` (`setText`).
- **Centred layout:** while `messages.length === 0` the scroller is `hidden` and the bottom block
  becomes `flex-1 justify-center` with greeting, composer, chips. The children keep the same positions
  either way, so the one `Composer` is never remounted.

### Step 4 (done)

- **Messages:** the user bubble is `bg-accent-soft` with `rounded-br-md` (still `max-w-[85%]`). The assistant
  row has a `LogoMark size="xs"` in a gutter (stacked above the text below `sm`). `Message` takes
  `actions` (shown on hover / `focus-within`, always on `pointer-coarse`) and `animate`.
- **Entry animation:** `ChatSession` keeps the ids loaded from history (`historyIds`); only other
  messages get `animate`, so a reload doesn't replay it.
- **Copy:** `components/CopyButton.tsx` (icon button, check mark for 1.5s, name switches to `Copied`).
  The message action is named **`Copy response`**, not "Copy message": Playwright's `getByLabel("Message")`
  is a substring match and would also hit it. `messageText()` in `MessageParts.tsx` joins the text parts.
- **Regenerate (not done):** the server owns history, so it needs a backend endpoint first.
- **Code blocks:** `Markdown` overrides `pre` with a `not-prose` `CodeBlock` (language header + `Copy code`,
  `bg-code`, horizontal scroll). This also applies to the `run_code` card's Python, which step 5 reframes;
  tables are wrapped in an `overflow-x-auto` div. Display math is not a `pre` (rehype-katex replaces it),
  and `.katex-display` scrolls.
- **Prose:** the `.markdown` class (unlayered CSS at the end of `index.css`) maps the typography plugin's
  `--tw-prose-*` colours to theme tokens, so `prose-invert` is gone. It also sets the inline-code chip, links,
  quotes, headings and zebra rows.
- **Shimmer:** `text-shimmer` utility plus `motion-safe:animate-shimmer` (keyframes in `@theme`). The loader
  shows it as "Thinking…" (`aria-hidden`), next to the logo mark; step 5's reasoning summary should reuse it.
- **For step 8:** at 390px the expanded sidebar (`w-64`) leaves the chat about 130px; it needs to overlay or
  auto-collapse on narrow screens.

### Step 5 (done)

- **States:** `toneOf(state)` in `tool.tsx` maps each tool state to running / done / error / warning /
  neutral. Each tone has an icon (`Loader2` spinning in the accent, `CircleCheck` success, `CircleX`
  destructive, `CircleHelp` warning, `Ban` muted) and a card frame (accent left border while running, tinted
  border and background on error / awaiting approval). The state word ("Done", "Running", …) is now
  `sr-only` plus a `title`, so text assertions still match; `data-state` is unchanged.
- **Collapsed row:** the tool name, then a truncated mono summary (`argsSummary`: a lone argument's value,
  or `key: value, …`; for `run_code`, the first line of the code), then the state icon on the right.
- **Inside:** "Arguments" / "Result" sections, objects as highlighted JSON, strings as they are; the error
  text sits in a destructive chip. `Markdown` takes `bare` (fenced blocks without the header bar) for code
  that already has a frame. The duplicate `fenced` in `tool.tsx` is gone (it uses `Markdown`'s).
- **`run_code`:** a terminal frame (`bg-muted` title bar with three dots, the tool name and `Copy code`),
  the Python, then the output after an accent `›`. `tool-code` is on the code body.
- **Grouping:** `MessageView` turns parts into items, then `groupTools` folds runs of 2 or more tool calls
  into a `ToolGroup` (`data-testid="tool-group"`; "Used N tools" / a shimmering "Using N tools", the
  distinct names, an aggregate state icon). `step-start` / `data-*` parts don't break a run; text,
  reasoning, files and artifact cards do. A lone call stays a plain card, so the e2e tests didn't change.
- **Reasoning:** no box. A small summary (shimmers as "Thinking…" while streaming), then the text behind
  a `border-l-2` rule, at 13px, italic, muted.
- **Open / close:** the `.details-smooth` class (end of `index.css`) animates `::details-content` with
  `interpolate-size: allow-keywords` inside `@supports`, and transitions only under
  `prefers-reduced-motion: no-preference`. Nested `<details>` use distinct named groups (`group/tool`,
  `group/tools`, `group/reasoning`) so an open parent doesn't rotate its children's chevrons. Reuse a new
  name for any later nested `<details>`.

### Step 6 (done)

- **Frame:** `PromptInput` is a `bg-card` rounded box with `focus-within:ring-2 ring-ring/40`, an
  accent-tinted border and `shadow-md` on focus.
- **Drag and drop:** `PromptInput` takes `onDropFiles` and owns the drag state: a drag-enter / leave depth
  counter (only for drags that carry `Files`) shows a dashed `border-primary` overlay on `bg-accent-soft`
  with "Drop files to attach" (`aria-hidden`). Unit-tested in `Composer.test.tsx`.
- **Attachments:** `AttachmentCard` in `Composer.tsx`. Images are 56px (`size-14`) thumbnails with the
  name `sr-only`; other files show an icon tile (`FileText` / `FileSpreadsheet` / `FileBraces` / `File`,
  from the media type now kept on `Attachment`), the name and the extension. Uploading puts a spinner
  over the card (sr-only "Uploading"); an error tints it destructive and says "Upload failed" (the
  message stays in `title`). Remove is a `bg-foreground` chip in the top-right corner, shown on hover,
  focus and `pointer-coarse`. `attachment`, `data-status` and `Remove …` are unchanged.
- **Toolbar:** paperclip (muted, round), then `PromptInputHint` ("⏎ send · ⇧⏎ new line", `aria-hidden`,
  `hidden sm:inline`), then Send (round, accent, `motion-safe:hover:scale-105`) or Stop (a filled square
  in a `border-2` ring).
- **Auto-grow:** still `field-sizing-content` from `ui/textarea`, capped by `max-h-48`; no change needed.
- **For step 8:** the composer's send error is still the plain `role="alert"` text under the box.

### Step 7 (done)

- **Layout:** from 900px the panel is a column (`bg-card`, `border-l`); below, a fixed sheet
  (`w-[min(100vw,32rem)]`, `z-40`) over a `bg-foreground/20` scrim that closes it on click. It all
  switches in CSS (`min-[900px]:` / `max-[899px]:`), with no JS media query.
- **Resize:** a `role="separator"` named `Resize artifacts` on the left edge (only from 900px). It
  supports pointer drag, ← / → in 16px steps, Home or double-click to reset. The width is stored in px
  under localStorage `artifact-panel-width` (`src/hooks/usePanelWidth.ts`, `clampWidth`). Besides
  24rem–70vw, the panel also leaves the chat at least 20rem, in JS and in the CSS `clamp(…)`, so a
  window resize can't squeeze the chat either.
- **Header:** `h-12` like the chat header: the kind icon, the title (`h2`), the `Version` select as a pill,
  then `Copy artifact` / `Download artifact` (text artifacts only, `.md` named by `fileName(title)`), and
  `Close artifacts`. The artifact list is a row of pill tabs under it (`artifact-entry`, `aria-current`),
  shown even for one artifact (a test relies on it).
- **Card:** an `accent-soft` icon tile, the title, a "Chart · v1" / "Document · v1" subtitle and an
  `Open …` pill. **Charts still render in full** in the card (the answer the user asked for, and
  the e2e test checks the svg). Text is clipped to `max-h-40` with a bottom mask fade, and the panel
  shows the rest. `ArtifactIcon` takes a `className` and is `aria-hidden`.
- **Entry:** `motion-safe:animate-in slide-in-from-right-8 fade-in`, 200ms; the scrim fades in.
- **For step 8:** the panel's "This artifact no longer exists." and the card's "Could not load this
  artifact." are plain red text; the panel's loading state is empty until the detail arrives
  (skeleton candidate). The chat header's title still truncates hard when the chat column is
  near its 20rem minimum.

### Step 8 (done)

- **Primitives:** `ui/skeleton.tsx` (`bg-foreground/8`, `motion-safe:animate-pulse`, `aria-hidden`; pair it
  with an sr-only `role="status"` label) and `ui/alert.tsx`: `Alert` (`tone` destructive / warning, `role`
  alert or status, `title`, `action`, `size="sm"`) and `RetryButton`. The warning icon sits in a
  `bg-warning` chip because `--warning` is too light for a bare icon or text on a light page.
- **Loading:** `ChatView` shows `ChatSkeleton` (header pills, message blocks only when loading a chat's
  history, the composer box) instead of "Loading…"; the sidebar shows skeleton rows while the chats load;
  the artifact panel and `ArtifactView` show `ArtifactSkeleton` (exported from `ArtifactView.tsx`).
- **Errors:** load errors (models, history, chats, an artifact version) are alerts with *Retry*, which
  calls the query's `refetch`. A failed send stays `role="status"` (a test relies on it) and the composer
  error stays `role="alert"`. There is no *Retry* for a refused send: `continueRun` only resumes an
  interrupted run, so it is not a retry of a send. `InterruptedBanner` is a warning `Alert` (testid and
  `Continue` unchanged).
- **Scroll to bottom:** `Conversation` shows a round `Scroll to bottom` button (sticky in a zero-height
  row at the scroller's bottom) once the user is more than 120px up; it re-pins and scrolls (smooth unless
  reduced motion). Unit-tested in `conversation.test.tsx`.
- **Narrow screens:** below `md` the sidebar always starts collapsed, and expanded it overlays the chat
  (fixed, scrim, slide-in; a `w-12` spacer keeps the chat still). Picking a chat closes it there; the
  overlay's state is not written to localStorage. The chat header is an `@container`: under 32rem the
  pills drop their chevrons, the model pill shows only its icon and `Artifacts (n)` only its icon and
  count (`pillLabel` = `@max-lg:sr-only`, so accessible names are unchanged). Radix `SelectValue`
  ignores `className`: wrap its children instead. No horizontal overflow at 375, 800 or 1280px, with or
  without the artifact panel.
- **Motion:** the `alert-dialog` and `select` enter / exit animations and the MCP chevron are now
  `motion-safe`; the artifact spinner is gone. Colour and opacity transitions are left as they are.
- **Contrast** (computed from the tokens, WCAG): muted text ≥ 4.5:1 on every surface in both themes
  (light 4.74 on `accent-soft` is the lowest), and also inside the destructive / warning alert tints.
- **Focus:** every `summary` gets a ring from `index.css`; a Tab sweep of a chat with the panel open found
  no focusable element without a visible ring.
- **Not done:** no screenshot added to `README.md` (it would put binary files in the repo; easy to add).
  Follow-ups from earlier steps still open: ⌘K chat search, *Regenerate* (needs a backend endpoint).

### Later: composer settings

- The step 6 toolbar (paperclip, `PromptInputHint`) and the header's MCP / model pickers were replaced by
  [`COMPOSER_PLAN.md`](COMPOSER_PLAN.md): a `+` menu in the composer (attach, MCP servers) and a footer
  line under it (the "model · thinking" button; the MCP chips were later dropped). The test-hook list above is updated.
