import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer, withMediaType } from "@/components/Composer";
import { json, mockApi, renderWithClient } from "@/test/server";

const uploaded = (name: string, type: string) => ({
  id: "f1",
  url: "/api/files/f1",
  filename: name,
  media_type: type,
  size: 4,
});

describe("Composer", () => {
  it("uploads a file first, then sends a file part with the returned url", async () => {
    const api = mockApi({ "POST /api/files": () => json(uploaded("notes.md", "text/markdown")) });
    const onSend = vi.fn(async () => {});
    renderWithClient(
      <Composer conversationId="c1" running={false} onSend={onSend} onStop={() => {}} />,
    );
    const user = userEvent.setup();

    await user.upload(screen.getByTestId("file-input"), new File(["# hi"], "notes.md"));
    await waitFor(() =>
      expect(screen.getByTestId("attachment")).toHaveAttribute("data-status", "ready"),
    );
    const form = api.called("POST", "/api/files")[0]?.body as FormData;
    expect(form.get("conversation_id")).toBe("c1");
    expect((form.get("file") as File).type).toBe("text/markdown"); // filled in from the extension

    await user.type(screen.getByLabelText("Message"), "Summarise{Enter}");
    expect(onSend).toHaveBeenCalledWith("Summarise", [
      { type: "file", mediaType: "text/markdown", filename: "notes.md", url: "/api/files/f1" },
    ]);
    expect(screen.queryByTestId("attachment")).not.toBeInTheDocument();
  });

  it("waits for uploads before sending, and leaves failed ones out", async () => {
    mockApi({
      "POST /api/files": () => json({ detail: "Unsupported file type 'application/zip'" }, 415),
    });
    const onSend = vi.fn(async () => {});
    renderWithClient(
      <Composer conversationId="c1" running={false} onSend={onSend} onStop={() => {}} />,
    );
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(
      screen.getByTestId("file-input"),
      new File(["x"], "a.zip", { type: "application/zip" }),
    );
    const chip = screen.getByTestId("attachment");
    await waitFor(() => expect(chip).toHaveAttribute("data-status", "error"));
    expect(chip).toHaveAttribute("title", "Unsupported file type 'application/zip'");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await user.type(screen.getByLabelText("Message"), "Hi{Enter}");
    expect(onSend).toHaveBeenCalledWith("Hi", []);
  });

  it("keeps the draft when the send fails", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("Unknown model 'x'");
    });
    renderWithClient(
      <Composer conversationId="c1" running={false} onSend={onSend} onStop={() => {}} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message"), "Hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown model 'x'");
    expect(screen.getByLabelText("Message")).toHaveValue("Hello");
  });

  it("offers Stop while a run is going", async () => {
    const onStop = vi.fn();
    renderWithClient(
      <Composer conversationId="c1" running onSend={async () => {}} onStop={onStop} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows the drop overlay until the drag really leaves the form", () => {
    renderWithClient(
      <Composer conversationId="c1" running={false} onSend={async () => {}} onStop={() => {}} />,
    );
    const form = screen.getByLabelText("Message").closest("form") as HTMLFormElement;
    const dataTransfer = { types: ["Files"], files: [] };
    fireEvent.dragEnter(form, { dataTransfer });
    fireEvent.dragEnter(screen.getByLabelText("Message"), { dataTransfer }); // into a child
    fireEvent.dragLeave(form, { dataTransfer }); // out of the form's own box
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();
    fireEvent.dragLeave(screen.getByLabelText("Message"), { dataTransfer });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();
  });

  it("guesses a media type only when the browser gave none", () => {
    expect(withMediaType(new File([""], "a.MD")).type).toBe("text/markdown");
    expect(withMediaType(new File([""], "a.png", { type: "image/png" })).type).toBe("image/png");
    expect(withMediaType(new File([""], "a.bin")).type).toBe("");
  });
});
