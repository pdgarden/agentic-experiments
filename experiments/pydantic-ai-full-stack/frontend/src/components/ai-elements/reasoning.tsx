import { Brain, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils";

interface ReasoningProps {
  text: string;
  /** Open while the model is still thinking, closed once it is done (the user can toggle). */
  streaming: boolean;
}

/** The model's reasoning: a quiet aside behind a muted left rule, shimmering while it streams. */
export function Reasoning({ text, streaming }: ReasoningProps) {
  const [open, setOpen] = useState(streaming);
  useEffect(() => setOpen(streaming), [streaming]);
  return (
    <details
      data-testid="reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="details-smooth group/reasoning text-sm"
    >
      <summary className="-mx-1 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground select-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 motion-safe:transition-transform group-open/reasoning:rotate-90"
        />
        <Brain aria-hidden className="size-3.5" />
        <span className={cn(streaming && "text-shimmer motion-safe:animate-shimmer")}>
          {streaming ? "Thinking…" : "Reasoning"}
        </span>
      </summary>
      <div className="mt-1.5 border-l-2 border-border pl-3 text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-muted-foreground italic">
        {text}
      </div>
    </details>
  );
}
