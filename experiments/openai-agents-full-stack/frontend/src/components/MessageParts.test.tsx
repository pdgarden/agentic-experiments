import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewPart } from "@/chat/reducer";
import { emptyRun, foldEvents } from "@/chat/reducer";
import { fenced } from "@/components/Markdown";
import { MessageParts } from "@/components/MessageParts";
import { RunMessages } from "@/components/RunMessages";
import { fixture } from "@/test/fixtures";

const text = (value: string): ViewPart => ({ type: "text", text: value });

describe("MessageParts", () => {
  it("renders markdown with highlighted code", () => {
    const { container } = render(
      <MessageParts runActive={false} parts={[text("**bold** and\n\n```python\nx = 1\n```")]} />,
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(container.querySelector("code.language-python .hljs-number")).not.toBeNull();
  });

  it("does not render untrusted HTML or script links", () => {
    const { container } = render(
      <MessageParts
        runActive={false}
        parts={[
          text(
            '<img src=x onerror="alert(1)"><script>alert(2)</script>\n\n[click](javascript:alert(3))',
          ),
        ]}
      />,
    );
    expect(container.querySelector("img, script")).toBeNull();
    const link = screen.getByText("click");
    expect(link.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  it("opens links in a new tab without an opener", () => {
    render(<MessageParts runActive={false} parts={[text("[docs](https://example.com)")]} />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a tool card with its code and result", () => {
    const tool: ViewPart = {
      type: "tool",
      call_id: "c1",
      name: "run_python",
      args: '{"code":"6 * 7"}',
      status: "ok",
      result: "result:\n42",
    };
    render(<MessageParts runActive={false} parts={[tool]} />);
    const card = screen.getByTestId("tool-card");
    expect(card).toHaveAttribute("data-status", "ok");
    expect(card).toHaveTextContent("run_python");
    expect(card).toHaveTextContent("6 * 7");
    expect(card).toHaveTextContent("42");
  });

  it("shows a call without a result as interrupted once the run has ended", () => {
    const tool: ViewPart = {
      type: "tool",
      call_id: "c1",
      name: "slow",
      args: "not json",
      status: "running",
      result: null,
    };
    const { rerender } = render(<MessageParts runActive parts={[tool]} />);
    expect(screen.getByTestId("tool-card")).toHaveAttribute("data-status", "running");
    rerender(<MessageParts runActive={false} parts={[tool]} />);
    expect(screen.getByTestId("tool-card")).toHaveAttribute("data-status", "interrupted");
    expect(screen.getByTestId("tool-card")).toHaveTextContent("not json");
  });

  it("ignores part types it does not know", () => {
    const unknown = { type: "artifact_ref", id: "a1" } as unknown as ViewPart;
    const { container } = render(
      <MessageParts runActive={false} parts={[unknown, text("after")]} />,
    );
    expect(container).toHaveTextContent("after");
  });
});

describe("RunMessages", () => {
  it("renders the recorded tool round trip", () => {
    const run = foldEvents(emptyRun("run-1"), fixture("tool_roundtrip"));
    render(<RunMessages run={run} />);
    expect(screen.getByTestId("user-message")).toHaveTextContent("What is 6 times 7?");
    expect(screen.getByTestId("tool-card")).toHaveAttribute("data-status", "ok");
    expect(screen.getByTestId("assistant-message")).toHaveTextContent("The answer is 42.");
    expect(screen.getByTestId("assistant-message")).toHaveTextContent("20 in · 10 out");
  });

  it("shows errors", () => {
    const run = {
      ...emptyRun("run-1"),
      status: "failed" as const,
      errors: [{ code: "timeout" as const, message: "Run exceeded 300s" }],
    };
    render(<RunMessages run={run} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Timed out. Run exceeded 300s");
  });
});

describe("fenced", () => {
  it("uses a fence longer than any backtick run in the code", () => {
    expect(fenced("a ```` b", "py")).toBe("`````py\na ```` b\n`````");
    expect(fenced("x")).toBe("```\nx\n```");
  });
});

describe("RunMessages while running", () => {
  it("shows a thinking indicator until text streams", () => {
    const events = fixture("tool_roundtrip");
    const afterTool = foldEvents(emptyRun("run-1"), events.slice(0, 4));
    const { rerender } = render(<RunMessages run={afterTool} />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    rerender(<RunMessages run={foldEvents(afterTool, events.slice(4, 5))} />);
    expect(screen.queryByText("Thinking…")).toBeNull();
  });
});
