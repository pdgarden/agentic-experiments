import { ChevronRight, SquareTerminal, Wrench } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";

export interface ToolCallView {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

const stateLabel: Record<string, string> = {
  "input-streaming": "Preparing",
  "input-available": "Running",
  "approval-requested": "Awaiting approval",
  "approval-responded": "Answered",
  "output-available": "Done",
  "output-error": "Error",
  "output-denied": "Denied",
};

const show = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

export const CODE_TOOL = "run_code";

/** The Python of a `run_code` call, once its arguments are complete enough to have it. */
export function codeOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const code = (input as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Longer than any fence inside the code, so model-written backticks can't close the block. */
function fenced(code: string, language: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}

/** A tool call and its result; `run_code` (code mode) shows its Python highlighted. */
export function Tool({ call }: { call: ToolCallView }) {
  const code = call.name === CODE_TOOL ? codeOf(call.input) : null;
  const Icon = call.name === CODE_TOOL ? SquareTerminal : Wrench;
  return (
    <details
      data-testid="tool-card"
      data-state={call.state}
      className="group rounded-lg border text-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 select-none">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{call.name}</span>
        <Badge
          variant={call.state === "output-error" ? "destructive" : "secondary"}
          className="ml-auto"
        >
          {stateLabel[call.state] ?? call.state}
        </Badge>
      </summary>
      <div className="space-y-2 border-t px-3 py-2">
        {code !== null ? (
          <div className="text-xs" data-testid="tool-code">
            <Markdown text={fenced(code, "python")} />
          </div>
        ) : (
          call.input !== undefined && (
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{show(call.input)}</pre>
          )
        )}
        {call.output !== undefined && (
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{show(call.output)}</pre>
        )}
        {call.errorText && <p className="text-xs text-destructive">{call.errorText}</p>}
      </div>
    </details>
  );
}
