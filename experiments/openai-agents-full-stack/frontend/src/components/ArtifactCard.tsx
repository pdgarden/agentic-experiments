import { ChartColumn, PanelRightOpen } from "lucide-react";
import type { ArtifactPart } from "@/api/types";
import { ArtifactView } from "@/components/ArtifactView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHashArtifact } from "@/useHashSession";

/** An artifact as written in this message: always the version this message made. */
export function ArtifactCard({ part }: { part: ArtifactPart }) {
  const [, open] = useHashArtifact();
  return (
    <div
      className="rounded-lg border bg-card text-card-foreground text-sm"
      data-testid="artifact-card"
      data-artifact-id={part.artifact_id}
      data-version={part.version}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ChartColumn className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{part.title}</span>
        <Badge variant="secondary">v{part.version}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open(part.artifact_id)}
          aria-label={`Open ${part.title}`}
        >
          <PanelRightOpen /> Open
        </Button>
      </div>
      <div className="p-3">
        <ArtifactView artifactId={part.artifact_id} version={part.version} />
      </div>
    </div>
  );
}
