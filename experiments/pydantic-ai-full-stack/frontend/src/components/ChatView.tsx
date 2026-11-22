import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FileUIPart, UIMessage } from "ai";
import { type ReactNode, useState } from "react";
import { api } from "@/api/client";
import {
  conversationQuery,
  mcpServersQuery,
  messagesQuery,
  modelsQuery,
  queryKeys,
} from "@/api/queries";
import type {
  Conversation,
  ConversationSettings,
  McpServerInfo,
  ModelCatalogue,
} from "@/api/types";
import { useConversationChat } from "@/chat/useConversationChat";
import {
  ConversationEmptyState,
  Conversation as ConversationScroller,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/message";
import { ArtifactPanel, ArtifactsToggle } from "@/components/artifacts/ArtifactPanel";
import { OpenArtifactContext } from "@/components/artifacts/context";
import { Composer } from "@/components/Composer";
import { InterruptedBanner } from "@/components/InterruptedBanner";
import { MessageView } from "@/components/MessageParts";
import { ModelPicker } from "@/components/ModelPicker";
import { McpPicker } from "@/components/mcp/McpPicker";

interface ChatViewProps {
  conversationId: string;
  /** No conversation on the server yet: the first send creates it (`PUT`), then selects it. */
  draft: boolean;
  onCreated: (id: string) => void;
}

/**
 * Keyed by conversation id in the parent. A draft keeps its id once created, so the view (and
 * its live stream) is not remounted when the URL starts naming it.
 */
export function ChatView({ conversationId, draft, onCreated }: ChatViewProps) {
  const [startedAsDraft] = useState(draft);
  const models = useQuery(modelsQuery);
  // Without the MCP catalogue the chat still works, with no server to pick.
  const mcp = useQuery(mcpServersQuery);
  if (models.isError) return <Notice>Could not load the models: {models.error.message}</Notice>;
  if (!models.data || mcp.isPending) return <Notice>Loading…</Notice>;
  const servers = mcp.data ?? [];
  if (startedAsDraft) {
    return (
      <ChatSession
        conversationId={conversationId}
        catalogue={models.data}
        servers={servers}
        initialMessages={[]}
        resume={false}
        draft
        onCreated={onCreated}
      />
    );
  }
  return <ExistingChat conversationId={conversationId} catalogue={models.data} servers={servers} />;
}

function ExistingChat({
  conversationId,
  catalogue,
  servers,
}: {
  conversationId: string;
  catalogue: ModelCatalogue;
  servers: McpServerInfo[];
}) {
  const history = useQuery({ ...messagesQuery(conversationId), refetchOnWindowFocus: false });
  // Only the first load matters: after that `useChat` owns the messages.
  const [initial] = useState(() => history.data);
  const data = initial ?? history.data;
  if (history.isError && !data) {
    return <Notice>Could not load this chat: {history.error.message}</Notice>;
  }
  if (!data) return <Notice>Loading…</Notice>;
  return (
    <ChatSession
      conversationId={conversationId}
      catalogue={catalogue}
      servers={servers}
      initialMessages={data.messages}
      resume={data.active_run}
      draft={false}
      onCreated={() => {}}
    />
  );
}

interface ChatSessionProps {
  conversationId: string;
  catalogue: ModelCatalogue;
  servers: McpServerInfo[];
  initialMessages: UIMessage[];
  resume: boolean;
  draft: boolean;
  onCreated: (id: string) => void;
}

function ChatSession({
  conversationId,
  catalogue,
  servers,
  initialMessages,
  resume,
  draft,
  onCreated,
}: ChatSessionProps) {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState(!draft);
  const [stopError, setStopError] = useState<string | null>(null);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  // A new chat starts with every connected MCP server; the picker narrows it down.
  const [draftSettings, setDraftSettings] = useState<ConversationSettings>(() => ({
    model_id: catalogue.default_model,
    thinking: "off",
    mcp_servers: servers.filter((s) => s.status === "connected").map((s) => s.name),
    skills: [],
  }));
  const conversation = useQuery({ ...conversationQuery(conversationId), enabled: created });
  const chat = useConversationChat({ conversationId, initialMessages, resume });

  const saveSettings = useMutation({
    mutationFn: (settings: ConversationSettings) => api.putSettings(conversationId, settings),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.conversation(conversationId), updated);
      return queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
    },
  });

  const settings = created
    ? saveSettings.isPending
      ? saveSettings.variables
      : conversation.data?.settings
    : draftSettings;

  const send = async (text: string, files: FileUIPart[]) => {
    if (!created) {
      await saveSettings.mutateAsync(draftSettings);
      setCreated(true);
      onCreated(conversationId);
    }
    chat.clearError();
    await chat.send(text, files);
  };

  const interrupted: Conversation["interrupted"] = chat.running
    ? null
    : (conversation.data?.interrupted ?? null);
  const last = chat.messages.at(-1);
  const waiting = chat.status === "submitted" && last?.role !== "assistant";
  const title = created ? conversation.data?.title || "New chat" : "New chat";

  const changeSettings = (next: ConversationSettings) =>
    created ? saveSettings.mutate(next) : setDraftSettings(next);

  return (
    <OpenArtifactContext.Provider value={setOpenArtifactId}>
      <div className="flex h-full min-w-0 flex-1">
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b px-4 py-2">
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="chat-title">
              {title}
            </h1>
            {settings && (
              <McpPicker servers={servers} settings={settings} onChange={changeSettings} />
            )}
            {settings && (
              <ModelPicker
                models={catalogue.models}
                settings={settings}
                onChange={changeSettings}
              />
            )}
            {created && openArtifactId === null && (
              <ArtifactsToggle conversationId={conversationId} onOpen={setOpenArtifactId} />
            )}
          </header>
          <ConversationScroller>
            {chat.messages.length === 0 && (
              <ConversationEmptyState>
                Ask anything. Attach images, PDFs or text files.
              </ConversationEmptyState>
            )}
            {chat.messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                streaming={chat.running && message === last}
                stopped={chat.stoppedIds.has(message.id)}
              />
            ))}
            {waiting && <Loader />}
          </ConversationScroller>
          <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4">
            {interrupted && (
              <InterruptedBanner interrupted={interrupted} onContinue={chat.continueRun} />
            )}
            {(chat.error || stopError || (created && saveSettings.error)) && (
              <p role="status" className="text-xs text-destructive">
                {chat.error?.message ?? stopError ?? saveSettings.error?.message}
              </p>
            )}
            <Composer
              conversationId={conversationId}
              running={chat.running}
              onSend={send}
              onStop={() => {
                setStopError(null);
                chat.cancel().catch((err: Error) => setStopError(`Could not stop: ${err.message}`));
              }}
            />
          </div>
        </div>
        {openArtifactId !== null && (
          <ArtifactPanel
            conversationId={conversationId}
            artifactId={openArtifactId}
            onSelect={setOpenArtifactId}
            onClose={() => setOpenArtifactId(null)}
          />
        )}
      </div>
    </OpenArtifactContext.Provider>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
