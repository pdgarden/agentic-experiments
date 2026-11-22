import { useEffect, useState } from "react";
import { ChatView } from "@/components/ChatView";
import { Sidebar } from "@/components/Sidebar";
import { newConversationId, useHashConversation } from "@/useHashConversation";

export function App() {
  const [selectedId, select] = useHashConversation();
  // The id the next new chat will get. Once the URL names it (first send), a fresh one is ready.
  const [draftId, setDraftId] = useState(newConversationId);
  useEffect(() => {
    if (selectedId === draftId) setDraftId(newConversationId());
  }, [selectedId, draftId]);

  const conversationId = selectedId ?? draftId;
  return (
    <div className="flex h-dvh">
      <Sidebar selectedId={selectedId} onSelect={select} />
      {/* Keyed: switching chats starts from a fresh state and drops the old stream. */}
      <ChatView
        key={conversationId}
        conversationId={conversationId}
        draft={selectedId === null}
        onCreated={select}
      />
    </div>
  );
}
