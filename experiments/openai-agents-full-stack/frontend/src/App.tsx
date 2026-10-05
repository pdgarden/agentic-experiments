import { ChatView, NewChat } from "@/components/ChatView";
import { SessionList } from "@/components/SessionList";
import { useHashSession } from "@/useHashSession";

export function App() {
  const [sessionId, select] = useHashSession();
  return (
    <div className="flex h-dvh">
      <SessionList selectedId={sessionId} onSelect={select} />
      {/* Keyed: switching chats starts from a fresh state and closes the old stream. */}
      {sessionId ? (
        <ChatView key={sessionId} sessionId={sessionId} />
      ) : (
        <NewChat onCreated={select} />
      )}
    </div>
  );
}
