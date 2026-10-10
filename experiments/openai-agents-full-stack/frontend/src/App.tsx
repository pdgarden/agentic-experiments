import { ArtifactPanel, ArtifactsToggle } from "@/components/ArtifactPanel";
import { ChatView, NewChat } from "@/components/ChatView";
import { SessionList } from "@/components/SessionList";
import { useHashArtifact, useHashSession } from "@/useHashSession";

export function App() {
  const [sessionId, select] = useHashSession();
  const [artifactId, openArtifact] = useHashArtifact();
  return (
    <div className="flex h-dvh">
      <SessionList selectedId={sessionId} onSelect={select} />
      {/* Keyed: switching chats starts from a fresh state and closes the old stream. */}
      {sessionId ? (
        <div className="relative flex min-w-0 flex-1">
          <ChatView key={sessionId} sessionId={sessionId} />
          {!artifactId && <ArtifactsToggle sessionId={sessionId} onOpen={openArtifact} />}
        </div>
      ) : (
        <NewChat onCreated={select} />
      )}
      {sessionId && artifactId && (
        <ArtifactPanel
          sessionId={sessionId}
          artifactId={artifactId}
          onSelect={openArtifact}
          onClose={() => openArtifact(null)}
        />
      )}
    </div>
  );
}
