import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/api/queries";
import type { Conversation } from "@/api/types";
import { dataPartEffect } from "@/chat/useConversationChat";
import { withModel } from "@/components/ModelPicker";
import { catalogue, conversation } from "@/test/server";

describe("dataPartEffect", () => {
  it("renames the chat in the list and in its own cache entry", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.conversations, [
      conversation("a", { title: null }),
      conversation("b"),
    ]);
    client.setQueryData(queryKeys.conversation("a"), conversation("a", { title: null }));

    const effect = dataPartEffect(client, "a", { type: "data-title", data: { title: "Paris" } });

    expect(effect).toBeNull();
    const list = client.getQueryData<Conversation[]>(queryKeys.conversations);
    expect(list?.map((c) => c.title)).toEqual(["Paris", "A chat"]);
    expect(client.getQueryData<Conversation>(queryKeys.conversation("a"))?.title).toBe("Paris");
  });

  it("maps the adapter's saved part and our stopped part", () => {
    const client = new QueryClient();
    expect(dataPartEffect(client, "a", { type: "data-conversation-saved", data: {} })).toBe(
      "refresh",
    );
    expect(dataPartEffect(client, "a", { type: "data-run-stopped", data: {} })).toBe("stopped");
    expect(dataPartEffect(client, "a", { type: "data-model-settings-delta", data: {} })).toBeNull();
  });
});

describe("withModel", () => {
  const settings = {
    model_id: "claude-sonnet",
    thinking: "high" as const,
    mcp_servers: [],
    skills: [],
  };
  it("drops a thinking level the new model does not have", () => {
    const [sonnet, mini] = catalogue.models as Parameters<typeof withModel>[1][];
    expect(withModel(settings, mini as never)).toMatchObject({
      model_id: "gpt-mini",
      thinking: "off",
    });
    expect(withModel(settings, sonnet as never)).toMatchObject({ thinking: "high" });
  });
});
