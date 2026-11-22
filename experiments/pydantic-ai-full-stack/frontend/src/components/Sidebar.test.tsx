import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/Sidebar";
import { conversation, json, mockApi, renderWithClient } from "@/test/server";

describe("Sidebar", () => {
  it("lists, renames and deletes chats", async () => {
    let list = [conversation("a", { title: "First" }), conversation("b", { title: null })];
    const api = mockApi({
      "GET /api/conversations": () => json(list),
      "PATCH /api/conversations/a": (call) => {
        const { title } = call.body as { title: string };
        list = list.map((c) => (c.id === "a" ? { ...c, title } : c));
        return json(list[0]);
      },
      "DELETE /api/conversations/a": () => {
        list = list.filter((c) => c.id !== "a");
        return new Response(null, { status: 204 });
      },
    });
    const onSelect = vi.fn();
    renderWithClient(<Sidebar selectedId="a" onSelect={onSelect} />);
    const nav = await screen.findByRole("navigation", { name: "Chats" });
    expect(await within(nav).findByRole("button", { name: "First" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: "New chat" })).toBeInTheDocument(); // untitled

    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: "Rename First" }));
    await user.clear(within(nav).getByLabelText("Chat title"));
    await user.type(within(nav).getByLabelText("Chat title"), "Renamed{Enter}");
    expect(await within(nav).findByRole("button", { name: "Renamed" })).toBeInTheDocument();
    expect(api.called("PATCH", "/api/conversations/a")[0]?.body).toEqual({ title: "Renamed" });

    await user.click(within(nav).getByRole("button", { name: "Delete Renamed" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(within(nav).queryByRole("button", { name: "Renamed" })).not.toBeInTheDocument(),
    );
    expect(onSelect).toHaveBeenCalledWith(null); // the open chat was deleted
  });

  it("does not offer to delete a running chat", async () => {
    mockApi({
      "GET /api/conversations": () => json([conversation("a", { title: "Busy", running: true })]),
    });
    renderWithClient(<Sidebar selectedId={null} onSelect={() => {}} />);
    expect(await screen.findByRole("button", { name: "Delete Busy" })).toBeDisabled();
    expect(screen.getByLabelText("Running")).toBeInTheDocument();
  });
});
