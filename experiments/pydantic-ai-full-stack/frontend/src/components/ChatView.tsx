import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FileUIPart, UIMessage } from "ai";
import { useRef, useState } from "react";
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
import { Composer, type ComposerHandle } from "@/components/Composer";
import { InterruptedBanner } from "@/components/InterruptedBanner";
import { LogoMark } from "@/components/LogoMark";
import { MessageView } from "@/components/MessageParts";
import { ModelPicker } from "@/components/ModelPicker";
import { McpMenu } from "@/components/mcp/McpMenu";
import { Suggestions } from "@/components/Suggestions";
import { Alert, RetryButton } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/utils";

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
  if (models.isError) {
    return (
      <LoadError
        title="Could not load the models"
        error={models.error}
        retrying={models.isFetching}
        onRetry={() => void models.refetch()}
      />
    );
  }
  if (!models.data || mcp.isPending) return <ChatSkeleton messages={false} />;
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
    return (
      <LoadError
        title="Could not load this chat"
        error={history.error}
        retrying={history.isFetching}
        onRetry={() => void history.refetch()}
      />
    );
  }
  if (!data) return <ChatSkeleton messages />;
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
  const composer = useRef<ComposerHandle>(null);
  // Messages loaded from history appear as they are; only the ones added from now on fade in.
  const [historyIds] = useState(() => new Set(initialMessages.map((m) => m.id)));
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
  // While empty, the greeting, the composer and the chips sit centred. The tree keeps the same
  // shape either way, so the one `Composer` moves without remounting (focus, attachments stay).
  const empty = chat.messages.length === 0;

  return (
    <OpenArtifactContext.Provider value={setOpenArtifactId}>
      <div className="flex h-full min-w-0 flex-1">
        <div className="relative flex h-full min-w-0 flex-1 flex-col">
          <header className="@container absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 border-b border-border/60 bg-background/75 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="chat-title">
              {title}
            </h1>
            {created && openArtifactId === null && (
              <ArtifactsToggle conversationId={conversationId} onOpen={setOpenArtifactId} />
            )}
          </header>
          <ConversationScroller className={cn("pt-12", empty && "hidden")}>
            {chat.messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                streaming={chat.running && message === last}
                stopped={chat.stoppedIds.has(message.id)}
                animate={!historyIds.has(message.id)}
              />
            ))}
            {waiting && <Loader />}
          </ConversationScroller>
          <div
            className={cn(
              "mx-auto w-full max-w-3xl space-y-2 px-4 pb-4",
              empty && "flex flex-1 flex-col justify-center gap-6 space-y-0 pt-16 pb-[12vh]",
            )}
          >
            {empty && (
              <ConversationEmptyState
                icon={<LogoMark size="lg" />}
                title="What can I help with?"
                description="Ask anything. Attach images, PDFs or text files."
              />
            )}
            {interrupted && (
              <InterruptedBanner interrupted={interrupted} onContinue={chat.continueRun} />
            )}
            {(chat.error || stopError || (created && saveSettings.error)) && (
              <Alert role="status" size="sm">
                {chat.error?.message ?? stopError ?? saveSettings.error?.message}
              </Alert>
            )}
            <Composer
              ref={composer}
              conversationId={conversationId}
              running={chat.running}
              onSend={send}
              menuItems={
                settings && servers.length > 0 ? (
                  <McpMenu servers={servers} settings={settings} onChange={changeSettings} />
                ) : undefined
              }
              footer={
                settings && (
                  <ModelPicker
                    models={catalogue.models}
                    settings={settings}
                    onChange={changeSettings}
                    className="ml-auto max-w-[60%] shrink-0"
                  />
                )
              }
              onStop={() => {
                setStopError(null);
                chat.cancel().catch((err: Error) => setStopError(`Could not stop: ${err.message}`));
              }}
            />
            {empty && <Suggestions onPick={(prompt) => composer.current?.setText(prompt)} />}
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

/** A load that failed before the chat could show: what failed, and a retry. */
function LoadError({
  title,
  error,
  retrying,
  onRetry,
}: {
  title: string;
  error: Error;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Alert
        title={title}
        className="w-full max-w-md"
        action={<RetryButton busy={retrying} onRetry={onRetry} />}
      >
        <p className="text-muted-foreground">{error.message}</p>
      </Alert>
    </div>
  );
}

/** The chat's shape while it loads: the header, a few message-shaped blocks, the composer and its footer. */
function ChatSkeleton({ messages }: { messages: boolean }) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <span role="status" className="sr-only">
        Loading…
      </span>
      <div className="flex h-12 items-center gap-2 border-b border-border/60 px-4">
        <Skeleton className="h-4 w-40 max-w-[40%]" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 overflow-hidden px-4 py-8">
        {messages && (
          <>
            <Skeleton className="ml-auto h-10 w-2/3 max-w-sm rounded-2xl rounded-br-md bg-accent-soft" />
            <div className="flex gap-3">
              <Skeleton className="size-6 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3.5 w-3/5" />
              </div>
            </div>
            <Skeleton className="ml-auto h-10 w-1/2 max-w-xs rounded-2xl rounded-br-md bg-accent-soft" />
            <div className="flex gap-3">
              <Skeleton className="size-6 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            </div>
          </>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <Skeleton className="h-14 rounded-2xl" />
        <div className="flex justify-end px-2 pt-1.5">
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
    </div>
  );
}
