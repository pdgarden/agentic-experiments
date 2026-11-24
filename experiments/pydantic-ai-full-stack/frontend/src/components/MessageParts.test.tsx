import { render, screen, within } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { argsSummary } from "@/components/ai-elements/tool";
import { attachmentName, MessageView, messageText } from "@/components/MessageParts";

const message = (role: UIMessage["role"], parts: UIMessage["parts"]): UIMessage => ({
  id: "m1",
  role,
  parts,
});

describe("MessageView", () => {
  it("shows a text attachment stored in the prompt as a file chip", () => {
    const text = '<attachment name="notes.md">\n# Notes\nmilk\n</attachment>';
    render(
      <MessageView
        message={message("user", [
          { type: "text", text: "Summarise" },
          { type: "text", text },
        ])}
        streaming={false}
        stopped={false}
      />,
    );
    expect(screen.getByTestId("file-chip")).toHaveTextContent("notes.md");
    expect(screen.getByTestId("user-message")).not.toHaveTextContent("milk");
  });

  it("shows images inline and other files as links", () => {
    render(
      <MessageView
        message={message("user", [
          { type: "file", mediaType: "image/png", filename: "cat.png", url: "/api/files/a" },
          { type: "file", mediaType: "application/pdf", filename: "doc.pdf", url: "/api/files/b" },
        ])}
        streaming={false}
        stopped={false}
      />,
    );
    expect(screen.getByRole("img", { name: "cat.png" })).toHaveAttribute("src", "/api/files/a");
    expect(screen.getByRole("link", { name: "doc.pdf" })).toHaveAttribute("href", "/api/files/b");
  });

  it("renders assistant markdown, tool calls, and the stopped mark", () => {
    render(
      <MessageView
        message={message("assistant", [
          { type: "step-start" },
          { type: "text", text: "**Bold** answer" },
          {
            type: "dynamic-tool",
            toolName: "web_search",
            toolCallId: "t1",
            state: "output-available",
            input: { query: "x" },
            output: "found",
          },
        ])}
        streaming={false}
        stopped
      />,
    );
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getByTestId("tool-card")).toHaveTextContent("web_search");
    expect(screen.getByTestId("tool-card")).toHaveTextContent("Done");
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("keeps reasoning open while it streams", () => {
    render(
      <MessageView
        message={message("assistant", [{ type: "reasoning", text: "Hmm", state: "streaming" }])}
        streaming
        stopped={false}
      />,
    );
    expect(screen.getByTestId("reasoning")).toHaveAttribute("open");
    expect(screen.getByTestId("reasoning")).toHaveTextContent("Thinking…");
  });
});

describe("message copy", () => {
  const reply = message("assistant", [
    { type: "text", text: "First" },
    { type: "reasoning", text: "hidden", state: "done" },
    { type: "text", text: "**Second**" },
  ]);

  it("joins the text parts as Markdown", () => {
    expect(messageText(reply)).toBe("First\n\n**Second**");
  });

  it("is offered once the message is finished", () => {
    const { rerender } = render(<MessageView message={reply} streaming stopped={false} />);
    expect(screen.queryByRole("button", { name: "Copy response" })).toBeNull();
    rerender(<MessageView message={reply} streaming={false} stopped={false} />);
    expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument();
  });
});

describe("attachmentName", () => {
  it("only matches a whole attachment block", () => {
    expect(attachmentName('<attachment name="a.txt">\nx\n</attachment>')).toBe("a.txt");
    expect(attachmentName('see <attachment name="a.txt">\nx\n</attachment>')).toBeNull();
    expect(attachmentName("plain text")).toBeNull();
  });
});

describe("tool cards", () => {
  const tool = (id: string, toolName: string, extra: Record<string, unknown>) =>
    ({ type: "dynamic-tool", toolName, toolCallId: id, input: { query: id }, ...extra }) as never;

  it("groups consecutive calls, across step boundaries, into one row", () => {
    render(
      <MessageView
        message={message("assistant", [
          tool("a", "web_search", { state: "output-available", output: "x" }),
          { type: "step-start" },
          tool("b", "web_fetch", { state: "output-error", errorText: "boom" }),
          { type: "text", text: "Done." },
          tool("c", "web_search", { state: "input-available" }),
        ])}
        streaming
        stopped={false}
      />,
    );
    const group = screen.getByTestId("tool-group");
    expect(group).toHaveTextContent("Used 2 tools");
    expect(within(group).getAllByTestId("tool-card")).toHaveLength(2);
    expect(within(group).getAllByTestId("tool-card")[1]).toHaveAttribute(
      "data-state",
      "output-error",
    );
    // The lone call after the text stays a card of its own.
    expect(screen.getAllByTestId("tool-card")).toHaveLength(3);
    expect(screen.getAllByTestId("tool-card")[2]).toHaveTextContent("Running");
  });

  it("summarises the arguments in the collapsed row", () => {
    expect(argsSummary({ query: "nba scores" })).toBe("nba scores");
    expect(argsSummary({ url: "https://x.y", max: 3 })).toBe("url: https://x.y, max: 3");
    expect(argsSummary(undefined)).toBe("");
  });
});
