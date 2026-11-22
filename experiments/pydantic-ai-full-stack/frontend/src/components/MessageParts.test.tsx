import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { attachmentName, MessageView } from "@/components/MessageParts";

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

describe("attachmentName", () => {
  it("only matches a whole attachment block", () => {
    expect(attachmentName('<attachment name="a.txt">\nx\n</attachment>')).toBe("a.txt");
    expect(attachmentName('see <attachment name="a.txt">\nx\n</attachment>')).toBeNull();
    expect(attachmentName("plain text")).toBeNull();
  });
});
