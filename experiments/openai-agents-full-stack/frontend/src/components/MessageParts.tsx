import { ArrowRightLeft } from "lucide-react";
import type { ComponentType } from "react";
import type { ViewPart } from "@/chat/reducer";
import { Markdown } from "@/components/Markdown";
import { ToolCard } from "@/components/ToolCard";

interface RendererProps<P extends ViewPart> {
  part: P;
  runActive: boolean;
}

type Renderers = {
  [T in ViewPart["type"]]: ComponentType<RendererProps<Extract<ViewPart, { type: T }>>>;
};

/** One renderer per part type. A new part type is a new entry; unknown types render nothing. */
const renderers: Renderers = {
  text: ({ part }) => <Markdown text={part.text} />,
  tool: ({ part, runActive }) => <ToolCard part={part} runActive={runActive} />,
  agent: ({ part }) => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <ArrowRightLeft className="size-3" /> Handed off to{" "}
      <span className="font-mono">{part.agent}</span>
    </div>
  ),
};

export function MessageParts({ parts, runActive }: { parts: ViewPart[]; runActive: boolean }) {
  return (
    <div className="space-y-3">
      {parts.map((part, index) => {
        const Renderer = (renderers as Record<string, ComponentType<RendererProps<ViewPart>>>)[
          part.type
        ];
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only within a run
        return Renderer ? <Renderer key={index} part={part} runActive={runActive} /> : null;
      })}
    </div>
  );
}
