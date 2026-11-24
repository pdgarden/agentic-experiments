import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "@/components/Markdown";

describe("Markdown", () => {
  it("gives fenced code a language header and copies its text", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<Markdown text={"```python\nprint('hi')\n```"} />);
    expect(screen.getByText("python")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("print('hi')\n");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("keeps display math out of code blocks", () => {
    const { container } = render(<Markdown text={"$$\nx^2\n$$"} />);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
  });
});
