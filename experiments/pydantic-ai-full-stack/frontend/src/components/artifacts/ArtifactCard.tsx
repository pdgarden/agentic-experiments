import { ChartColumn, FileText, PanelRightOpen } from "lucide-react";
import type { ArtifactKind, ArtifactRef } from "@/api/types";
import { ArtifactView } from "@/components/artifacts/ArtifactView";
import { useOpenArtifact } from "@/components/artifacts/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ArtifactIcon({ kind }: { kind: ArtifactKind }) {
  const Icon = kind === "chart" ? ChartColumn : FileText;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

/** The output of `create_artifact` / `update_artifact`, if it is one. */
export function artifactRef(output: unknown): ArtifactRef | null {
  if (typeof output !== "object" || output === null) return null;
  const ref = output as Partial<ArtifactRef>;
  return typeof ref.artifact_id === "string" && typeof ref.version === "number"
    ? (ref as ArtifactRef)
    : null;
}

/** An artifact as this message wrote it: always the version the message made. */
export function ArtifactCard({ artifact }: { artifact: ArtifactRef }) {
  const open = useOpenArtifact();
  return (
    <div
      className="rounded-lg border bg-card text-sm text-card-foreground"
      data-testid="artifact-card"
      data-artifact-id={artifact.artifact_id}
      data-version={artifact.version}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ArtifactIcon kind={artifact.kind} />
        <span className="min-w-0 flex-1 truncate font-medium">{artifact.title}</span>
        <Badge variant="secondary">v{artifact.version}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open(artifact.artifact_id)}
          aria-label={`Open ${artifact.title}`}
        >
          <PanelRightOpen /> Open
        </Button>
      </div>
      <div className="max-h-96 overflow-y-auto p-3">
        <ArtifactView artifactId={artifact.artifact_id} version={artifact.version} />
      </div>
    </div>
  );
}
