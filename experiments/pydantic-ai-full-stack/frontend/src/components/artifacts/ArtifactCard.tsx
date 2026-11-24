import { ChartColumn, FileText, PanelRightOpen } from "lucide-react";
import type { ArtifactKind, ArtifactRef } from "@/api/types";
import { ArtifactView } from "@/components/artifacts/ArtifactView";
import { useOpenArtifact } from "@/components/artifacts/context";
import { cn } from "@/utils";

export function ArtifactIcon({ kind, className }: { kind: ArtifactKind; className?: string }) {
  const Icon = kind === "chart" ? ChartColumn : FileText;
  return <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />;
}

const kindLabel: Record<ArtifactKind, string> = { chart: "Chart", text: "Document" };

/** The output of `create_artifact` / `update_artifact`, if it is one. */
export function artifactRef(output: unknown): ArtifactRef | null {
  if (typeof output !== "object" || output === null) return null;
  const ref = output as Partial<ArtifactRef>;
  return typeof ref.artifact_id === "string" && typeof ref.version === "number"
    ? (ref as ArtifactRef)
    : null;
}

/**
 * An artifact as this message wrote it: always the version the message made. Charts show in
 * full; text shows its first lines, fading out, and the panel has the rest.
 */
export function ArtifactCard({ artifact }: { artifact: ArtifactRef }) {
  const open = useOpenArtifact();
  const text = artifact.kind === "text";
  return (
    <div
      className="group/artifact overflow-hidden rounded-xl border bg-card text-sm text-card-foreground shadow-xs transition-colors hover:border-primary/30"
      data-testid="artifact-card"
      data-artifact-id={artifact.artifact_id}
      data-version={artifact.version}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
          <ArtifactIcon kind={artifact.kind} className="text-current" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={artifact.title}>
            {artifact.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {kindLabel[artifact.kind]}
            <span aria-hidden> · </span>
            <span className="rounded-sm bg-muted px-1 font-mono text-[0.6875rem] tabular-nums">
              v{artifact.version}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => open(artifact.artifact_id)}
          aria-label={`Open ${artifact.title}`}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors group-hover/artifact:border-primary/40 group-hover/artifact:text-foreground hover:bg-accent-soft hover:text-accent-soft-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <PanelRightOpen className="size-3.5" aria-hidden /> Open
        </button>
      </div>
      <div
        className={cn(
          "border-t px-3 py-3",
          text
            ? "max-h-40 overflow-hidden mask-b-from-60% mask-b-to-100%"
            : "max-h-96 overflow-y-auto",
        )}
      >
        <ArtifactView artifactId={artifact.artifact_id} version={artifact.version} />
      </div>
    </div>
  );
}
