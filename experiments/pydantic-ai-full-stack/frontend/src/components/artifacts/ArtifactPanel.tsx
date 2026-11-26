import { useQuery } from "@tanstack/react-query";
import { Download, PanelRightOpen, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { artifactQuery, artifactsQuery, artifactVersionQuery } from "@/api/queries";
import type { ArtifactKind, ArtifactRecord } from "@/api/types";
import { ArtifactIcon } from "@/components/artifacts/ArtifactCard";
import { ArtifactSkeleton, ArtifactView } from "@/components/artifacts/ArtifactView";
import { CopyButton } from "@/components/CopyButton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clampWidth, usePanelWidth } from "@/hooks/usePanelWidth";
import { cn } from "@/utils";

/**
 * The header's compact pill look (the artifacts toggle, the version picker). In a narrow header (an
 * `@container` under 32rem) the chevrons go, and `pillLabel` hides a label visually (not from screen
 * readers).
 */
const pillClass =
  "h-7 gap-1.5 rounded-full border-border/70 bg-transparent px-2.5 text-xs font-medium shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-3.5 @max-lg:[&_svg.lucide-chevron-down]:hidden";
const pillLabel = "@max-lg:sr-only";

interface ArtifactPanelProps {
  conversationId: string;
  artifactId: string;
  onSelect: (artifactId: string) => void;
  onClose: () => void;
}

/**
 * The chat's artifacts beside it; the selected one at its latest version, older ones on demand.
 * From 900px it is a resizable column; below, a sheet over the chat.
 */
export function ArtifactPanel({
  conversationId,
  artifactId,
  onSelect,
  onClose,
}: ArtifactPanelProps) {
  const artifacts = useQuery(artifactsQuery(conversationId));
  const selected = artifacts.data?.find((a) => a.id === artifactId);
  const [width, setWidth] = usePanelWidth();
  const panel = useRef<HTMLElement>(null);
  const style = { "--panel-w": width === null ? "min(36rem,45vw)" : `${width}px` } as CSSProperties;

  return (
    <>
      {/* Narrow screens: a scrim behind the sheet; clicking it closes the panel. */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-[1px] motion-safe:animate-in motion-safe:fade-in min-[900px]:hidden"
      />
      <aside
        ref={panel}
        aria-label="Artifacts"
        style={style}
        className={cn(
          "flex h-full shrink-0 flex-col border-l bg-card text-card-foreground",
          "motion-safe:animate-in motion-safe:duration-200 motion-safe:slide-in-from-right-8 motion-safe:fade-in",
          "min-[900px]:relative min-[900px]:w-[clamp(24rem,var(--panel-w),min(70vw,100%_-_20rem))]",
          "max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:right-0 max-[899px]:z-40 max-[899px]:w-[min(100vw,32rem)] max-[899px]:shadow-2xl",
        )}
      >
        <ResizeHandle panel={panel} width={width} onResize={setWidth} />
        {/* Keyed: another artifact starts back at its latest version. */}
        <SelectedArtifact
          key={artifactId}
          artifactId={artifactId}
          fallbackTitle={selected?.title}
          fallbackKind={selected?.kind}
          onClose={onClose}
          tabs={
            artifacts.data &&
            artifacts.data.length > 0 && (
              <ArtifactTabs
                artifacts={artifacts.data}
                selectedId={artifactId}
                onSelect={onSelect}
              />
            )
          }
        />
      </aside>
    </>
  );
}

const STEP = 16;

/** Drag to resize (24rem to 70vw), arrow keys for steps, double-click for the default width. */
function ResizeHandle({
  panel,
  width,
  onResize,
}: {
  panel: React.RefObject<HTMLElement | null>;
  width: number | null;
  onResize: (width: number | null) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const current = () => width ?? panel.current?.getBoundingClientRect().width ?? 0;
  const clamp = (next: number) =>
    clampWidth(next, window.innerWidth, panel.current?.parentElement?.clientWidth);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: current() };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The panel sits on the right: dragging left widens it.
    onResize(clamp(drag.current.width + drag.current.x - event.clientX));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: STEP, ArrowRight: -STEP }[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      onResize(clamp(current() + delta));
    } else if (event.key === "Home") {
      event.preventDefault();
      onResize(null);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take pointer and key handlers
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize artifacts"
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(null)}
      onKeyDown={onKeyDown}
      className={cn(
        "group/handle absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize touch-none outline-none select-none min-[900px]:block",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover/handle:bg-primary/50 group-focus-visible/handle:bg-primary",
          dragging && "bg-primary",
        )}
      />
    </div>
  );
}

/** The chat's artifacts as a row of compact tabs. */
function ArtifactTabs({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: ArtifactRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:thin]">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="shrink-0">
          <ArtifactEntry
            artifact={artifact}
            selected={artifact.id === selectedId}
            onSelect={() => onSelect(artifact.id)}
          />
        </li>
      ))}
    </ul>
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
      title={artifact.title}
      className={cn(
        "flex h-7 max-w-52 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected &&
          "border-primary/30 bg-accent-soft font-medium text-accent-soft-foreground hover:bg-accent-soft hover:text-accent-soft-foreground",
      )}
    >
      <ArtifactIcon kind={artifact.kind} className={cn("size-3.5", selected && "text-current")} />
      <span className="min-w-0 truncate">{artifact.title}</span>
      <span className={cn("tabular-nums opacity-70", !selected && "text-muted-foreground")}>
        v{artifact.latest_version}
      </span>
    </button>
  );
}

function SelectedArtifact({
  artifactId,
  fallbackTitle,
  fallbackKind,
  tabs,
  onClose,
}: {
  artifactId: string;
  fallbackTitle?: string;
  fallbackKind?: ArtifactKind;
  tabs: ReactNode;
  onClose: () => void;
}) {
  const detail = useQuery(artifactQuery(artifactId));
  // null follows the latest version, including ones written while the panel is open.
  const [picked, setPicked] = useState<number | null>(null);
  const data = detail.data;
  const version = data ? (picked ?? data.latest_version) : null;
  const title =
    data?.versions.find((v) => v.version === version)?.title ??
    data?.title ??
    fallbackTitle ??
    "Artifact";
  const kind = data?.kind ?? fallbackKind;

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
        {kind && <ArtifactIcon kind={kind} />}
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </h2>
        {data && version !== null && (
          <>
            <Select
              value={String(version)}
              onValueChange={(value) => {
                const next = Number(value);
                setPicked(next === data.latest_version ? null : next);
              }}
            >
              <SelectTrigger size="sm" aria-label="Version" className={cn(pillClass, "w-auto")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {data.versions.toReversed().map((v) => (
                  <SelectItem key={v.version} value={String(v.version)}>
                    v{v.version}
                    {v.version === data.latest_version ? " (latest)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TextActions artifactId={artifactId} version={version} title={title} />
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close artifacts"
          title="Close"
        >
          <X />
        </Button>
      </header>
      {tabs}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {detail.isError ? (
          <Alert title="This artifact no longer exists.">
            <p className="text-muted-foreground">
              It may have been deleted with its chat. Pick another one above, or close the panel.
            </p>
          </Alert>
        ) : data && version !== null ? (
          <div data-testid="artifact-panel-view" data-version={version}>
            <ArtifactView artifactId={artifactId} version={version} />
          </div>
        ) : (
          <ArtifactSkeleton />
        )}
      </div>
    </>
  );
}

/** Copy and Download, for text artifacts once their content is loaded. */
function TextActions({
  artifactId,
  version,
  title,
}: {
  artifactId: string;
  version: number;
  title: string;
}) {
  const query = useQuery(artifactVersionQuery(artifactId, version));
  const content = query.data?.content;
  if (content?.kind !== "text") return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([content.text], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName(title)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <CopyButton text={() => content.text} label="Copy artifact" />
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
        onClick={download}
        aria-label="Download artifact"
        title="Download"
      >
        <Download />
      </Button>
    </>
  );
}

/** A file name from a title: letters, digits and dashes. */
export function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "artifact";
}

/** Opens the panel on the newest artifact; nothing while the chat has none. */
export function ArtifactsToggle({
  conversationId,
  onOpen,
}: {
  conversationId: string;
  onOpen: (artifactId: string) => void;
}) {
  const artifacts = useQuery(artifactsQuery(conversationId));
  const newest = artifacts.data?.[0];
  if (!newest) return null;
  return (
    <Button variant="outline" size="sm" className={pillClass} onClick={() => onOpen(newest.id)}>
      <PanelRightOpen />
      {/* Narrow header: the icon and the count; the name stays "Artifacts (n)". */}
      <span>
        <span className={pillLabel}>Artifacts (</span>
        {artifacts.data?.length}
        <span className={pillLabel}>)</span>
      </span>
    </Button>
  );
}
