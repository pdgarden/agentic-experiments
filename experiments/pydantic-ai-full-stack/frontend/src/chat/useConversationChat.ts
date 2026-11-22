import { useChat } from "@ai-sdk/react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type DataUIPart,
  DefaultChatTransport,
  type FileUIPart,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import type { Conversation } from "@/api/types";

/**
 * The server owns the history: a send carries only the new message and the chat id, and the
 * stream is resumed from `GET /api/chat/{id}/stream` (it replays the run from its start).
 */
export function createTransport() {
  return new DefaultChatTransport<UIMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ id, messages, trigger }) => ({
      body: { trigger, id, messages: messages.slice(-1) },
    }),
    prepareReconnectToStreamRequest: ({ id }) => ({
      api: `/api/chat/${encodeURIComponent(id)}/stream`,
    }),
  });
}

/**
 * What one of our `data-*` stream parts does: `data-title` renames the chat in the caches,
 * `data-artifact` refreshes the artifacts, `data-conversation-saved` asks for a refresh,
 * `data-run-stopped` marks the turn as stopped.
 */
export function dataPartEffect(
  queryClient: QueryClient,
  conversationId: string,
  part: DataUIPart<UIDataTypes>,
): "refresh" | "stopped" | null {
  switch (part.type) {
    case "data-title": {
      const { title } = part.data as { title: string };
      const retitle = (c: Conversation) => (c.id === conversationId ? { ...c, title } : c);
      queryClient.setQueryData<Conversation[]>(queryKeys.conversations, (list) =>
        list?.map(retitle),
      );
      queryClient.setQueryData<Conversation>(queryKeys.conversation(conversationId), (c) =>
        c ? retitle(c) : c,
      );
      return null;
    }
    case "data-artifact": {
      // A version was written: the list and that artifact's version list are stale (versions themselves never are).
      const { artifact_id } = part.data as { artifact_id: string };
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts(conversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(artifact_id) });
      return null;
    }
    case "data-conversation-saved":
      return "refresh";
    case "data-run-stopped":
      return "stopped";
    default:
      return null;
  }
}

interface Options {
  conversationId: string;
  initialMessages: UIMessage[];
  /** The server has a run in flight for this conversation: attach to its stream on mount. */
  resume: boolean;
}

export function useConversationChat({ conversationId, initialMessages, resume }: Options) {
  const queryClient = useQueryClient();
  const transport = useMemo(createTransport, []);
  // Message ids of turns the user stopped. Only known live: a reload shows the saved partial turn.
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  const stopRequested = useRef(false);

  const refreshConversation = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.conversation(conversationId),
      exact: true,
    });
  }, [queryClient, conversationId]);

  const chat = useChat<UIMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
    resume,
    onData: (part) => {
      const effect = dataPartEffect(queryClient, conversationId, part);
      if (effect === "refresh") refreshConversation();
      else if (effect === "stopped") stopRequested.current = true;
    },
    onFinish: ({ message }) => {
      if (stopRequested.current && message.role === "assistant") {
        setStoppedIds((ids) => new Set(ids).add(message.id));
      }
      stopRequested.current = false;
      refreshConversation();
    },
  });

  const running = chat.status === "submitted" || chat.status === "streaming";
  // The sidebar shows which chats are running: refresh it when this one starts or stops.
  useEffect(() => {
    if (running) refreshConversation();
  }, [running, refreshConversation]);

  const send = useCallback(
    (text: string, files: FileUIPart[]) =>
      files.length > 0 ? chat.sendMessage({ text, files }) : chat.sendMessage({ text }),
    [chat.sendMessage],
  );

  /** Ask the server to stop: the stream then ends by itself, with the partial turn saved. */
  const cancel = useCallback(() => api.cancel(conversationId), [conversationId]);

  /** Continue an interrupted conversation, then follow the new run like a resumed one. */
  const continueRun = useCallback(async () => {
    await api.continueRun(conversationId);
    refreshConversation();
    await chat.resumeStream();
  }, [conversationId, chat.resumeStream, refreshConversation]);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    clearError: chat.clearError,
    running,
    stoppedIds,
    send,
    cancel,
    continueRun,
  };
}
