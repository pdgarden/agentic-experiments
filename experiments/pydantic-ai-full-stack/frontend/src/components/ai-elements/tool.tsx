import {
  Ban,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Layers,
  Loader2,
  type LucideIcon,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import { CopyButton } from "@/components/CopyButton";
import { fenced, Markdown } from "@/components/Markdown";
import { cn } from "@/utils";

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

type Tone = "running" | "done" | "error" | "warning" | "neutral";

function toneOf(state: string): Tone {
  switch (state) {
    case "input-streaming":
    case "input-available":
    case "approval-responded":
      return "running";
    case "output-available":
      return "done";
    case "output-error":
      return "error";
    case "approval-requested":
      return "warning";
    default:
      return "neutral";
  }
}

const toneIcon: Record<Tone, { icon: LucideIcon; className: string }> = {
  running: { icon: Loader2, className: "text-primary motion-safe:animate-spin" },
  done: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleX, className: "text-destructive" },
  warning: { icon: CircleHelp, className: "text-warning" },
  neutral: { icon: Ban, className: "text-muted-foreground" },
};

/** The card's frame per tone: an accent rule while running, tinted on error / approval. */
const toneFrame: Record<Tone, string> = {
  running: "border-l-2 border-l-primary",
  done: "",
  error: "border-destructive/40 bg-destructive/5",
  warning: "border-warning/60 bg-warning/10",
  neutral: "",
};

/** The state icon with the state's name for screen readers (and as a tooltip). */
function StateIcon({ tone, label }: { tone: Tone; label: string }) {
  const { icon: Icon, className } = toneIcon[tone];
  return (
    <span className="ml-auto flex shrink-0 items-center" title={label}>
      <Icon aria-hidden className={cn("size-3.5", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const pretty = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const scalar = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));

/** A one-line view of a call's arguments for the collapsed row (CSS truncates it). */
export function argsSummary(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object" || Array.isArray(input)) return scalar(input);
  const entries = Object.entries(input);
  if (entries.length === 1) return scalar(entries[0]?.[1]);
  return entries.map(([key, value]) => `${key}: ${scalar(value)}`).join(", ");
}

export const CODE_TOOL = "run_code";

/** The Python of a `run_code` call, once its arguments are complete enough to have it. */
export function codeOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const code = (input as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

const firstLine = (code: string) =>
  code
    .split("\n")
    .find((line) => line.trim())
    ?.trim() ?? "";

/** Smooth open / close where the browser can animate to `auto` (see `.details-smooth`). */
const detailsClass = "details-smooth group/tool rounded-lg border bg-card text-sm";
const summaryClass =
  "flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 select-none focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden";
/** Each `<details>` names its own group, so an open `ToolGroup` doesn't turn its cards' chevrons. */
const chevron = "size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform";

/** A tool call and its result; `run_code` (code mode) shows its Python in a terminal frame. */
export function Tool({ call }: { call: ToolCallView }) {
  const code = call.name === CODE_TOOL ? codeOf(call.input) : null;
  const Icon = call.name === CODE_TOOL ? SquareTerminal : Wrench;
  const tone = toneOf(call.state);
  const summary = code !== null ? firstLine(code) : argsSummary(call.input);
  return (
    <details
      data-testid="tool-card"
      data-state={call.state}
      className={cn(detailsClass, toneFrame[tone])}
    >
      <summary className={summaryClass}>
        <ChevronRight aria-hidden className={cn(chevron, "group-open/tool:rotate-90")} />
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-[0.8125rem]">{call.name}</span>
        {summary && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {summary}
          </span>
        )}
        <StateIcon tone={tone} label={stateLabel[call.state] ?? call.state} />
      </summary>
      <div className="space-y-2 border-t px-3 py-2.5">
        {code !== null ? (
          <Terminal name={call.name} code={code} output={call.output} />
        ) : (
          <>
            {call.input !== undefined && <Section label="Arguments" value={call.input} />}
            {call.output !== undefined && <Section label="Result" value={call.output} />}
          </>
        )}
        {call.errorText && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap text-destructive">
            {call.errorText}
          </p>
        )}
      </div>
    </details>
  );
}

/** Arguments or a result: objects as highlighted JSON, strings as they are. */
function Section({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <div className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      {typeof value === "string" ? (
        <pre className="max-h-80 overflow-auto rounded-md bg-code p-2 font-mono text-xs whitespace-pre-wrap text-code-foreground">
          {value}
        </pre>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md bg-code text-xs text-code-foreground">
          <Markdown bare text={fenced(pretty(value), "json")} />
        </div>
      )}
    </div>
  );
}

/** `run_code`: a title bar, the Python highlighted, then its output after a `›` prompt. */
function Terminal({ name, code, output }: { name: string; code: string; output: unknown }) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <div className="overflow-hidden rounded-md border bg-code text-code-foreground">
      <div className="flex h-7 items-center gap-2 border-b bg-muted pr-0.5 pl-2.5">
        <span aria-hidden className="flex gap-1">
          <span className="size-2 rounded-full bg-muted-foreground/30" />
          <span className="size-2 rounded-full bg-muted-foreground/30" />
          <span className="size-2 rounded-full bg-muted-foreground/30" />
        </span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">{name}</span>
        <CopyButton
          label="Copy code"
          className="ml-auto size-6"
          text={() => body.current?.textContent ?? code}
        />
      </div>
      <div ref={body} className="text-xs" data-testid="tool-code">
        <Markdown bare text={fenced(code, "python")} />
      </div>
      {output !== undefined && (
        <div className="flex gap-2 border-t px-3 py-2 font-mono text-xs">
          <span aria-hidden className="text-primary select-none">
            ›
          </span>
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words">
            {pretty(output)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Consecutive tool calls folded into one "Used N tools" row that opens to the cards. */
export function ToolGroup({ calls, children }: { calls: ToolCallView[]; children: ReactNode }) {
  const tones = calls.map((call) => toneOf(call.state));
  const tone: Tone = tones.includes("running")
    ? "running"
    : tones.includes("error")
      ? "error"
      : tones.includes("warning")
        ? "warning"
        : tones.every((t) => t === "done")
          ? "done"
          : "neutral";
  const running = tone === "running";
  const names = [...new Set(calls.map((call) => call.name))].join(", ");
  const label = running ? `Using ${calls.length} tools` : `Used ${calls.length} tools`;
  const groupState = {
    running: "Running",
    done: "Done",
    error: "Some failed",
    warning: "Awaiting approval",
    neutral: "Finished",
  }[tone];
  return (
    <details data-testid="tool-group" className="details-smooth group/tools text-sm">
      <summary className={cn(summaryClass, "-mx-1 w-fit max-w-full px-1 hover:bg-muted/60")}>
        <ChevronRight aria-hidden className={cn(chevron, "group-open/tools:rotate-90")} />
        <Layers aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "shrink-0",
            running ? "text-shimmer motion-safe:animate-shimmer" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground/80">{names}</span>
        <StateIcon tone={tone} label={groupState} />
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3">{children}</div>
    </details>
  );
}
