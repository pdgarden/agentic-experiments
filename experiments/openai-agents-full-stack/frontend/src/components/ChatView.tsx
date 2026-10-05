import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import type { RunView } from "@/chat/reducer";
import { useChat } from "@/chat/useChat";
import { Composer } from "@/components/Composer";
import { RunMessages } from "@/components/RunMessages";

const textParts = (text: string) => [{ type: "text" as const, text }];

/** An existing session: its history and the live run, if any. */
export function ChatView({ sessionId }: { sessionId: string }) {
  const chat = useChat(sessionId);
  return (
    <ChatLayout
      runs={chat.runs}
      notice={
        chat.loadError ? `Could not load this chat: ${chat.loadError.message}` : chat.streamError
      }
      composer={
        <Composer
          running={chat.running}
          onSend={(text) => chat.send(textParts(text))}
          onCancel={() => void chat.cancel()}
        />
      }
    />
  );
}

/** No session yet: the first message creates one, then the view switches to it. */
export function NewChat({ onCreated }: { onCreated: (sessionId: string) => void }) {
  const queryClient = useQueryClient();
  const send = async (text: string) => {
    const session = await api.createSession();
    await api.startRun(session.id, textParts(text));
    await queryClient.invalidateQueries({ queryKey: queryKeys.sessions, exact: true });
    onCreated(session.id);
  };
  return (
    <ChatLayout
      runs={[]}
      empty={<p className="text-muted-foreground">Ask anything. The agent can run Python.</p>}
      composer={<Composer running={false} onSend={send} onCancel={() => {}} />}
    />
  );
}

interface ChatLayoutProps {
  runs: RunView[];
  composer: ReactNode;
  notice?: string | null;
  empty?: ReactNode;
}

function ChatLayout({ runs, composer, notice, empty }: ChatLayoutProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the stream while the user is at the bottom; leave them alone once they scroll up.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
          {runs.length === 0 && empty}
          {runs.map((run) => (
            <RunMessages key={run.id} run={run} />
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4">
        {notice && (
          <p role="status" className="text-xs text-destructive">
            {notice}
          </p>
        )}
        {composer}
      </div>
    </div>
  );
}
