import { type FileUIPart, getToolOrDynamicToolName, isToolUIPart, type UIMessage } from "ai";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Message } from "@/components/ai-elements/message";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { Tool, type ToolCallView, ToolGroup } from "@/components/ai-elements/tool";
import { ArtifactCard, artifactRef } from "@/components/artifacts/ArtifactCard";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";

// Text-like attachments are inlined into the stored prompt as `<attachment name="…">…</attachment>`
// (backend/src/runs/chat.py), so after a reload they come back as text: show them as a file chip.
const ATTACHMENT = /^<attachment name="([^"]*)">\n[\s\S]*\n<\/attachment>$/;

/** Their result is an artifact reference: shown as the artifact itself rather than a tool card. */
const ARTIFACT_TOOLS = new Set(["create_artifact", "update_artifact"]);

export function attachmentName(text: string): string | null {
  return ATTACHMENT.exec(text)?.[1] ?? null;
}

interface MessageViewProps {
  message: UIMessage;
  /** This message is the one being streamed right now. */
  streaming: boolean;
  stopped: boolean;
  /** Added after the chat was opened (not loaded from history): fades in. */
  animate?: boolean;
}

/** The message's text parts as Markdown, for copying. */
export function messageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []))
    .join("\n\n");
}

type Item =
  | { kind: "node"; key: string; element: ReactNode }
  | { kind: "tool"; key: string; call: ToolCallView };

/** Runs of two or more consecutive tool calls fold into one `ToolGroup`; a lone call stays a card. */
function groupTools(items: Item[]): ReactNode[] {
  const out: ReactNode[] = [];
  let run: Extract<Item, { kind: "tool" }>[] = [];
  const flush = () => {
    const cards = run.map((item) => <Tool key={item.key} call={item.call} />);
    if (run.length > 1) {
      out.push(
        <ToolGroup key={`group-${run[0]?.key}`} calls={run.map((item) => item.call)}>
          {cards}
        </ToolGroup>,
      );
    } else out.push(...cards);
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool") {
      run.push(item);
      continue;
    }
    flush();
    out.push(item.element);
  }
  flush();
  return out;
}

export function MessageView({ message, streaming, stopped, animate }: MessageViewProps) {
  if (message.role === "system") return null;
  const toItem = (part: UIMessage["parts"][number], index: number): Item | null => {
    const key = `${message.id}-${index}`;
    const node = (element: ReactNode): Item => ({ kind: "node", key, element });
    if (part.type === "text") {
      if (message.role === "user") {
        const name = attachmentName(part.text);
        if (name !== null) return node(<FileChip key={key} filename={name} />);
        return node(
          <p key={key} className="whitespace-pre-wrap break-words">
            {part.text}
          </p>,
        );
      }
      return node(<Markdown key={key} text={part.text} />);
    }
    if (part.type === "reasoning") {
      if (!part.text.trim()) return null;
      return node(
        <Reasoning
          key={key}
          text={part.text}
          streaming={streaming && part.state === "streaming"}
        />,
      );
    }
    if (part.type === "file") return node(<FileView key={key} part={part} />);
    if (isToolUIPart(part)) {
      const artifact =
        part.state === "output-available" && ARTIFACT_TOOLS.has(getToolOrDynamicToolName(part))
          ? artifactRef(part.output)
          : null;
      if (artifact) return node(<ArtifactCard key={key} artifact={artifact} />);
      return {
        kind: "tool",
        key,
        call: {
          name: getToolOrDynamicToolName(part),
          state: part.state,
          input: part.input,
          output: part.state === "output-available" ? part.output : undefined,
          errorText: part.state === "output-error" ? part.errorText : undefined,
        },
      };
    }
    // step-start, data-* parts render nothing, so tool calls on either side still group.
    return null;
  };
  const parts = groupTools(message.parts.flatMap((part, index) => toItem(part, index) ?? []));
  const actions =
    message.role === "assistant" && !streaming && messageText(message) ? (
      <CopyButton label="Copy response" text={() => messageText(message)} />
    ) : null;
  return (
    <Message from={message.role} actions={actions} animate={animate}>
      {parts}
      {stopped && (
        <Badge variant="outline" className="text-muted-foreground">
          Stopped
        </Badge>
      )}
    </Message>
  );
}

function FileView({ part }: { part: FileUIPart }) {
  if (part.mediaType.startsWith("image/")) {
    return (
      <a href={part.url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={part.url}
          alt={part.filename ?? "Attached image"}
          className="max-h-60 rounded-lg border object-contain"
        />
      </a>
    );
  }
  return <FileChip filename={part.filename ?? "Attachment"} url={part.url} />;
}

function FileChip({ filename, url }: { filename: string; url?: string }) {
  const content = (
    <>
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{filename}</span>
    </>
  );
  const className =
    "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs";
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      data-testid="file-chip"
    >
      {content}
    </a>
  ) : (
    <span className={className} data-testid="file-chip">
      {content}
    </span>
  );
}
