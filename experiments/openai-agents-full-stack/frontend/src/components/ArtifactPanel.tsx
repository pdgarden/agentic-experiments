import { useQuery } from "@tanstack/react-query";
import { ChartColumn, PanelRightOpen, X } from "lucide-react";
import { useState } from "react";
import { artifactQuery, sessionArtifactsQuery } from "@/api/queries";
import type { ArtifactRecord } from "@/api/types";
import { ArtifactView } from "@/components/ArtifactView";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils";

interface ArtifactPanelProps {
  sessionId: string;
  artifactId: string;
  onSelect: (artifactId: string) => void;
  onClose: () => void;
}

/** The session's artifacts beside the chat; the selected one at its latest version. */
export function ArtifactPanel({ sessionId, artifactId, onSelect, onClose }: ArtifactPanelProps) {
  const artifacts = useQuery(sessionArtifactsQuery(sessionId));
  return (
    <aside
      aria-label="Artifacts"
      className="flex h-full w-[min(36rem,45vw)] shrink-0 flex-col border-l bg-background"
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
        <span className="flex-1 font-medium">Artifacts</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close artifacts">
          <X />
        </Button>
      </div>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto border-b p-2">
        {artifacts.data?.map((artifact) => (
          <li key={artifact.id}>
            <ArtifactEntry
              artifact={artifact}
              selected={artifact.id === artifactId}
              onSelect={() => onSelect(artifact.id)}
            />
          </li>
        ))}
      </ul>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Keyed: another artifact starts back at its latest version. */}
        <SelectedArtifact key={artifactId} artifactId={artifactId} />
      </div>
    </aside>
  );
}

function ArtifactEntry({
  artifact,
  selected,
  onSelect,
}: {
  artifact: ArtifactRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      data-testid="artifact-entry"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
        selected && "bg-accent font-medium",
      )}
    >
      <ChartColumn className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
      <span className="text-xs text-muted-foreground">v{artifact.latest_version}</span>
    </button>
  );
}

function SelectedArtifact({ artifactId }: { artifactId: string }) {
  const detail = useQuery(artifactQuery(artifactId));
  // null follows the latest version, including ones written while the panel is open.
  const [picked, setPicked] = useState<number | null>(null);
  if (detail.isError) {
    return <p className="text-sm text-destructive">This artifact no longer exists.</p>;
  }
  if (!detail.data) return null;
  const { versions, latest_version } = detail.data;
  const version = picked ?? latest_version;
  const title = versions.find((v) => v.version === version)?.title ?? detail.data.title;
  return (
    <div className="space-y-3" data-testid="artifact-panel-view" data-version={version}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-medium">{title}</h2>
        <Select
          value={String(version)}
          onValueChange={(value) => {
            const next = Number(value);
            setPicked(next === latest_version ? null : next);
          }}
        >
          <SelectTrigger size="sm" aria-label="Version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.toReversed().map((v) => (
              <SelectItem key={v.version} value={String(v.version)}>
                v{v.version}
                {v.version === latest_version ? " (latest)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ArtifactView artifactId={artifactId} version={version} />
    </div>
  );
}

/** Reopens the panel on the newest artifact; nothing while the session has none. */
export function ArtifactsToggle({
  sessionId,
  onOpen,
}: {
  sessionId: string;
  onOpen: (artifactId: string) => void;
}) {
  const artifacts = useQuery(sessionArtifactsQuery(sessionId));
  const newest = artifacts.data?.[0];
  if (!newest) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="absolute top-3 right-4 z-10 bg-background"
      onClick={() => onOpen(newest.id)}
    >
      <PanelRightOpen /> Artifacts ({artifacts.data?.length})
    </Button>
  );
}
