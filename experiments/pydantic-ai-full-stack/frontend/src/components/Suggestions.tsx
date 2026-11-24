import { ChartColumn, Globe, type LucideIcon, Plug, SquareTerminal } from "lucide-react";

interface Suggestion {
  label: string;
  prompt: string;
  Icon: LucideIcon;
}

/** One per capability: an artifact, web search, code mode, an MCP tool. */
export const SUGGESTIONS: Suggestion[] = [
  {
    label: "Chart some data",
    prompt: "Make a bar chart of the five most populated countries in Europe.",
    Icon: ChartColumn,
  },
  {
    label: "Search the web",
    prompt: "Search the web for this week's main AI news and summarise them with sources.",
    Icon: Globe,
  },
  {
    label: "Run some Python",
    prompt: "Use Python to list the first 20 prime numbers and compute their sum.",
    Icon: SquareTerminal,
  },
  {
    label: "Use an MCP tool",
    prompt: "Which MCP tools can you use? Pick one and show me what it returns.",
    Icon: Plug,
  },
];

/** Chips that fill the composer with a prompt; they never send it. */
export function Suggestions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <ul
      aria-label="Suggestions"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700"
    >
      {SUGGESTIONS.map(({ label, prompt, Icon }) => (
        <li key={label}>
          <button
            type="button"
            title={prompt}
            onClick={() => onPick(prompt)}
            className="group flex w-full items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left text-sm shadow-xs transition-colors outline-none hover:border-primary/40 hover:bg-accent-soft/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Icon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{prompt}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
