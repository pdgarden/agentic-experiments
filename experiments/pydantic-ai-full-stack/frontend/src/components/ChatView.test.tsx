import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "@/components/ChatView";
import {
  artifactSse,
  catalogue,
  chatSse,
  codeSse,
  conversation,
  heldSse,
  json,
  mcpServer,
  messagesJson,
  mockApi,
  renderWithClient,
  splitBefore,
  sse,
  stoppedSse,
  thinkingSse,
} from "@/test/server";

const ID = "c1";
const noHistory = { messages: [], active_run: false };

function existing(routes: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/models": () => json(catalogue),
    "GET /api/mcp-servers": () => json([]),
    [`GET /api/conversations/${ID}`]: () => json(conversation(ID)),
    [`GET /api/conversations/${ID}/messages`]: () => json(noHistory),
    [`GET /api/conversations/${ID}/artifacts`]: () => json([]),
    "GET /api/conversations": () => json([conversation(ID)]),
    ...routes,
  });
}

async function send(text: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Message"), `${text}{Enter}`);
  return user;
}

describe("ChatView", () => {
  it("shows the stored history", async () => {
    existing({ [`GET /api/conversations/${ID}/messages`]: () => json(JSON.parse(messagesJson)) });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    expect(await screen.findByTestId("user-message")).toHaveTextContent("Hello there");
    expect(screen.getByTestId("assistant-message")).toHaveTextContent("You said: Hello there");
  });

  it("sends only the new message and streams the reply", async () => {
    const api = existing({
      [`GET /api/conversations/${ID}/messages`]: () => json(JSON.parse(messagesJson)),
      "POST /api/chat": () => sse(chatSse),
    });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    await screen.findByTestId("user-message");
    await send("Hello there");

    await waitFor(() => expect(screen.getAllByTestId("assistant-message")).toHaveLength(2));
    expect(screen.getAllByTestId("assistant-message")[1]).toHaveTextContent(
      "You said: Hello there",
    );
    const [post] = api.called("POST", "/api/chat");
    const body = post?.body as { id: string; trigger: string; messages: { role: string }[] };
    expect(body.id).toBe(ID);
    expect(body.trigger).toBe("submit-message");
    expect(body.messages).toHaveLength(1); // the server owns the history
    expect(body.messages[0]?.role).toBe("user");
  });

  it("creates a draft conversation with its settings before the first send", async () => {
    const api = mockApi({
      "GET /api/models": () => json(catalogue),
      [`PUT /api/conversations/${ID}`]: (call) => json(conversation(ID, { settings: call.body })),
      [`GET /api/conversations/${ID}`]: () => json(conversation(ID)),
      "GET /api/conversations": () => json([conversation(ID)]),
      "POST /api/chat": () => sse(chatSse),
    });
    const onCreated = vi.fn();
    renderWithClient(<ChatView conversationId={ID} draft onCreated={onCreated} />);
    await send("Hello there");

    expect(await screen.findByTestId("assistant-message")).toHaveTextContent(
      "You said: Hello there",
    );
    expect(onCreated).toHaveBeenCalledWith(ID);
    const put = api.calls.findIndex((c) => c.method === "PUT");
    const post = api.calls.findIndex((c) => c.method === "POST" && c.path === "/api/chat");
    expect(put).toBeGreaterThanOrEqual(0);
    expect(put).toBeLessThan(post);
    expect(api.calls[put]?.body).toEqual({
      model_id: "claude-sonnet",
      thinking: "off",
      mcp_servers: [],
      skills: [],
    });
  });

  it("collapses the reasoning once the model is done thinking", async () => {
    existing({ "POST /api/chat": () => sse(thinkingSse) });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    await send("Think first");

    const reply = await screen.findByTestId("assistant-message");
    await waitFor(() => expect(reply).toHaveTextContent("You said: Think first"));
    const reasoning = within(reply).getByTestId("reasoning");
    expect(reasoning).toHaveTextContent("Thinking about it.");
    expect(reasoning).toHaveTextContent("Reasoning");
    expect(reasoning).not.toHaveAttribute("open");
  });

  it("stops through the server and marks the partial reply as stopped", async () => {
    const [head, tail] = splitBefore(stoppedSse, "text-end");
    const stream = heldSse(head, tail);
    const api = existing({
      "POST /api/chat": stream.response,
      [`POST /api/chat/${ID}/cancel`]: () => {
        stream.release();
        return json({ cancelled: true });
      },
    });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    const user = await send("slow please");

    const reply = await screen.findByTestId("assistant-message");
    await waitFor(() => expect(reply).toHaveTextContent("You said:"));
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(reply).toHaveTextContent("Stopped"));
    expect(await screen.findByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(api.called("POST", `/api/chat/${ID}/cancel`)).toHaveLength(1);
  });

  it("resumes the stream of a run still in flight", async () => {
    const pending = { id: "u1", role: "user", parts: [{ type: "text", text: "Hello there" }] };
    const api = existing({
      [`GET /api/conversations/${ID}/messages`]: () =>
        json({ messages: [pending], active_run: true }),
      [`GET /api/chat/${ID}/stream`]: () => sse(chatSse),
    });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);

    expect(await screen.findByTestId("user-message")).toHaveTextContent("Hello there");
    expect(await screen.findByTestId("assistant-message")).toHaveTextContent(
      "You said: Hello there",
    );
    expect(api.called("GET", `/api/chat/${ID}/stream`).length).toBeGreaterThan(0);
  });

  it("does not resume when no run is in flight", async () => {
    const api = existing();
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    await screen.findByLabelText("Message");
    expect(api.called("GET", `/api/chat/${ID}/stream`)).toHaveLength(0);
  });

  it("continues an interrupted conversation and follows the new run", async () => {
    let interrupted = true;
    const api = existing({
      [`GET /api/conversations/${ID}`]: () =>
        json(
          conversation(ID, {
            interrupted: interrupted
              ? {
                  run_id: "r1",
                  at: "2026-11-22T10:00:00Z",
                  unresolved_tools: [{ tool_call_id: "t1", tool_name: "web_fetch" }],
                }
              : null,
          }),
        ),
      [`POST /api/chat/${ID}/continue`]: () => {
        interrupted = false;
        return sse(chatSse);
      },
      [`GET /api/chat/${ID}/stream`]: () => sse(chatSse),
    });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);

    const banner = await screen.findByTestId("interrupted-banner");
    expect(banner).toHaveTextContent("web_fetch");
    await userEvent.setup().click(within(banner).getByRole("button", { name: "Continue" }));

    expect(await screen.findByTestId("assistant-message")).toHaveTextContent(
      "You said: Hello there",
    );
    await waitFor(() => expect(screen.queryByTestId("interrupted-banner")).not.toBeInTheDocument());
    expect(api.called("POST", `/api/chat/${ID}/continue`)).toHaveLength(1);
  });

  it("shows why a send was refused", async () => {
    existing({
      "POST /api/chat": () =>
        json({ detail: "A run is already active for this conversation" }, 409),
    });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    await send("Hello");
    expect(await screen.findByRole("status")).toHaveTextContent("already active");
  });

  it("saves a model change and hides thinking for a model without it", async () => {
    const api = existing({
      [`PUT /api/conversations/${ID}`]: (call) => json(conversation(ID, { settings: call.body })),
    });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: "GPT mini" }));

    await waitFor(() => expect(api.called("PUT", `/api/conversations/${ID}`)).toHaveLength(1));
    expect(api.called("PUT", `/api/conversations/${ID}`)[0]?.body).toMatchObject({
      model_id: "gpt-mini",
      thinking: "off",
    });
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Thinking" })).not.toBeInTheDocument(),
    );
  });

  describe("artifacts", () => {
    // The id `create_artifact` returned in the recorded stream.
    const ART = "6c879556dbbf46e59a0ed97ee21b5f48";
    const record = {
      id: ART,
      conversation_id: ID,
      kind: "chart",
      title: "Wins by team",
      latest_version: 2,
      created_at: "2026-11-22T10:00:00Z",
      updated_at: "2026-11-22T10:01:00Z",
    };
    // Text content keeps Vega (and its canvas) out of jsdom; the card renders by content kind.
    const version = (v: number) =>
      json({
        artifact_id: ART,
        kind: "chart",
        version: v,
        title: "Wins by team",
        created_at: "2026-11-22T10:00:00Z",
        content: { kind: "text", text: `Version ${v} body` },
      });

    function withArtifact(routes: Parameters<typeof mockApi>[0] = {}) {
      let listed = false;
      return existing({
        "POST /api/chat": () => {
          listed = true;
          return sse(artifactSse);
        },
        [`GET /api/conversations/${ID}/artifacts`]: () => json(listed ? [record] : []),
        [`GET /api/artifacts/${ART}`]: () =>
          json({
            ...record,
            versions: [1, 2].map((v) => ({
              version: v,
              title: "Wins by team",
              created_at: "2026-11-22T10:00:00Z",
            })),
          }),
        [`GET /api/artifacts/${ART}/versions/1`]: () => version(1),
        [`GET /api/artifacts/${ART}/versions/2`]: () => version(2),
        ...routes,
      });
    }

    it("shows the version a message wrote as a card, and opens it in the panel", async () => {
      withArtifact();
      renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
      const user = await send("draw a chart");

      const card = await screen.findByTestId("artifact-card");
      expect(card).toHaveAttribute("data-version", "1");
      expect(card).toHaveTextContent("Wins by team");
      expect(await within(card).findByText("Version 1 body")).toBeInTheDocument();
      expect(screen.getByTestId("assistant-message")).toHaveTextContent("Here it is.");
      // `data-artifact` refreshed the chat's artifact list.
      expect(await screen.findByRole("button", { name: /Artifacts \(1\)/ })).toBeInTheDocument();

      await user.click(within(card).getByRole("button", { name: "Open Wins by team" }));
      const panel = await screen.findByRole("complementary", { name: "Artifacts" });
      // The panel follows the latest version; older ones are picked from the select.
      const view = await within(panel).findByTestId("artifact-panel-view");
      expect(view).toHaveAttribute("data-version", "2");
      expect(await within(panel).findByText("Version 2 body")).toBeInTheDocument();
      expect(within(panel).getByTestId("artifact-entry")).toHaveAttribute("aria-current", "true");
      expect(screen.queryByRole("button", { name: /Artifacts \(/ })).not.toBeInTheDocument();

      await user.click(within(panel).getByRole("combobox", { name: "Version" }));
      await user.click(await screen.findByRole("option", { name: "v1" }));
      await waitFor(() => expect(view).toHaveAttribute("data-version", "1"));
      expect(await within(panel).findByText("Version 1 body")).toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Close artifacts" }));
      expect(screen.queryByRole("complementary", { name: "Artifacts" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Artifacts \(1\)/ })).toBeInTheDocument();
    });

    it("says so when an artifact is gone", async () => {
      withArtifact({
        [`GET /api/artifacts/${ART}/versions/1`]: () => json({ detail: "Not found" }, 404),
      });
      renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
      await send("draw a chart");
      const card = await screen.findByTestId("artifact-card");
      expect(await within(card).findByText("Could not load this artifact.")).toBeInTheDocument();
    });
  });

  it("shows a run_code call with its Python and result", async () => {
    existing({ "POST /api/chat": () => sse(codeSse) });
    renderWithClient(<ChatView conversationId={ID} draft={false} onCreated={() => {}} />);
    await send("compute");

    const reply = await screen.findByTestId("assistant-message");
    await waitFor(() => expect(reply).toHaveTextContent("The result is 45."));
    const tool = within(reply).getByTestId("tool-card");
    expect(tool).toHaveTextContent("run_code");
    expect(within(tool).getByTestId("tool-code")).toHaveTextContent("sum(range(10))");
  });

  describe("MCP servers", () => {
    const servers = [
      mcpServer("nba"),
      mcpServer("weather"),
      mcpServer("broken", { status: "failed", tools: [], error: "boom" }),
    ];

    it("starts a new chat with every connected server and saves the picked ones", async () => {
      const api = mockApi({
        "GET /api/models": () => json(catalogue),
        "GET /api/mcp-servers": () => json(servers),
        [`PUT /api/conversations/${ID}`]: (call) => json(conversation(ID, { settings: call.body })),
        [`GET /api/conversations/${ID}`]: () => json(conversation(ID)),
        [`GET /api/conversations/${ID}/artifacts`]: () => json([]),
        "GET /api/conversations": () => json([conversation(ID)]),
        "POST /api/chat": () => sse(chatSse),
      });
      renderWithClient(<ChatView conversationId={ID} draft onCreated={() => {}} />);
      const user = userEvent.setup();
      const picker = await screen.findByRole("button", { name: "MCP servers" });
      expect(picker).toHaveTextContent("MCP 2/3");

      await user.click(picker);
      const options = await screen.findAllByTestId("mcp-option");
      expect(within(options[2] as HTMLElement).getByRole("checkbox")).toBeDisabled();
      expect(options[2]).toHaveTextContent("failed");
      await user.click(within(options[0] as HTMLElement).getByRole("checkbox"));
      expect(picker).toHaveTextContent("MCP 1/3");
      await user.keyboard("{Escape}");

      await send("Hello there");
      await waitFor(() => expect(api.called("PUT", `/api/conversations/${ID}`)).toHaveLength(1));
      expect(api.called("PUT", `/api/conversations/${ID}`)[0]?.body).toMatchObject({
        mcp_servers: ["weather"],
      });
    });
  });
});
