import { CircleAlert, CircleCheck, LoaderCircle, Wrench } from "lucide-react";
import type { ToolPart } from "@/api/types";
import { fenced, Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";

type Shown = ToolPart["status"] | "interrupted";

/** A tool call and its result as one collapsible card. */
export function ToolCard({ part, runActive }: { part: ToolPart; runActive: boolean }) {
  // A call the run never answered (cancelled, failed, interrupted) is not still running.
  const status: Shown = part.status === "running" && !runActive ? "interrupted" : part.status;
  return (
    <details
      className="group rounded-lg border bg-card text-card-foreground text-sm"
      data-testid="tool-card"
      data-status={status}
      open={status === "error" ? true : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 select-none">
        <Wrench className="size-4 text-muted-foreground" />
        <span className="font-mono">{part.name}</span>
        <StatusBadge status={status} />
      </summary>
      <div className="space-y-2 border-t px-3 py-2">
        <Arguments args={part.args} />
        {part.result !== null && part.result !== undefined && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Result</div>
            <pre
              className={`max-h-80 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap ${
                status === "error" ? "text-destructive" : ""
              }`}
            >
              {part.result}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function StatusBadge({ status }: { status: Shown }) {
  switch (status) {
    case "running":
      return (
        <Badge variant="secondary">
          <LoaderCircle className="animate-spin" /> running
        </Badge>
      );
    case "ok":
      return (
        <Badge variant="secondary">
          <CircleCheck /> done
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive">
          <CircleAlert /> error
        </Badge>
      );
    case "interrupted":
      return <Badge variant="outline">no result</Badge>;
  }
}

/** Arguments as pretty JSON; a `code` argument is shown as a highlighted block. */
function Arguments({ args }: { args: string }) {
  const parsed = parseArgs(args);
  if (parsed === null) {
    return <pre className="overflow-auto rounded-md bg-muted p-2 text-xs">{args}</pre>;
  }
  const { code, ...rest } = parsed;
  const others = typeof code === "string" ? rest : parsed;
  return (
    <div className="space-y-2">
      {typeof code === "string" && <Markdown text={fenced(code, "python")} />}
      {Object.keys(others).length > 0 && (
        <pre className="overflow-auto rounded-md bg-muted p-2 text-xs">
          {JSON.stringify(others, null, 2)}
        </pre>
      )}
    </div>
  );
}

function parseArgs(args: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(args);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
