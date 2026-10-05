import { CircleAlert, LoaderCircle } from "lucide-react";
import type { RunView } from "@/chat/reducer";
import { MessageParts } from "@/components/MessageParts";

const endNotes: Partial<Record<RunView["status"], string>> = {
  cancelled: "Stopped.",
  interrupted: "Interrupted: the server stopped during this run.",
};

/** One run: the user's message, then the assistant's parts, errors and status. */
export function RunMessages({ run }: { run: RunView }) {
  const running = run.status === "running";
  const userText = run.input.map((part) => part.text).join("\n\n");
  const note = endNotes[run.status];
  // Between tool calls and model turns nothing streams; streaming text shows itself.
  const waiting = running && run.parts.at(-1)?.type !== "text";
  return (
    <div className="space-y-4" data-testid="run" data-status={run.status}>
      {userText && (
        <div className="flex justify-end">
          <div
            className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2 text-sm whitespace-pre-wrap text-secondary-foreground"
            data-testid="user-message"
          >
            {userText}
          </div>
        </div>
      )}
      <div className="space-y-3" data-testid="assistant-message">
        <MessageParts parts={run.parts} runActive={running} />
        {waiting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Thinking…
          </div>
        )}
        {run.errors.map((error, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: errors are append-only
            key={index}
            role="alert"
            className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">{errorTitles[error.code]}.</span> {error.message}
            </span>
          </div>
        ))}
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
        {!running && run.usage && run.usage.total_tokens > 0 && (
          <div className="text-xs text-muted-foreground" title="Input / output tokens">
            {run.usage.input_tokens.toLocaleString()} in ·{" "}
            {run.usage.output_tokens.toLocaleString()} out
          </div>
        )}
      </div>
    </div>
  );
}

const errorTitles: Record<RunView["errors"][number]["code"], string> = {
  max_turns: "Too many turns",
  guardrail: "Blocked by a guardrail",
  timeout: "Timed out",
  model_error: "Model error",
  internal: "Error",
};
