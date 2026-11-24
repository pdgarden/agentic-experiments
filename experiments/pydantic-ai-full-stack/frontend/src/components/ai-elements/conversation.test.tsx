import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Conversation } from "@/components/ai-elements/conversation";

/** jsdom has no layout: give the scroller a fixed size and a scroll position. */
function scrollTo(element: HTMLElement, top: number) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 500 });
  element.scrollTop = top;
  fireEvent.scroll(element);
}

describe("Conversation", () => {
  it("offers a way back down once the user scrolls up, and hides it at the bottom", async () => {
    render(
      <Conversation>
        <p>Hello</p>
      </Conversation>,
    );
    const scroller = screen.getByTestId("chat-scroller");
    const jump = vi.fn();
    scroller.scrollTo = jump as typeof scroller.scrollTo;

    expect(screen.queryByRole("button", { name: "Scroll to bottom" })).not.toBeInTheDocument();
    scrollTo(scroller, 1500);
    scrollTo(scroller, 200);
    await userEvent.setup().click(screen.getByRole("button", { name: "Scroll to bottom" }));
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({ top: 2000 }));

    scrollTo(scroller, 1500);
    expect(screen.queryByRole("button", { name: "Scroll to bottom" })).not.toBeInTheDocument();
  });
});
