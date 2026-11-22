import { Brain, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

interface ReasoningProps {
  text: string;
  /** Open while the model is still thinking, closed once it is done (the user can toggle). */
  streaming: boolean;
}

export function Reasoning({ text, streaming }: ReasoningProps) {
  const [open, setOpen] = useState(streaming);
  useEffect(() => setOpen(streaming), [streaming]);
  return (
    <details
      data-testid="reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group rounded-lg border border-dashed text-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-muted-foreground select-none">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        <Brain className="size-3.5" />
        {streaming ? "Thinking…" : "Reasoning"}
      </summary>
      <div className="whitespace-pre-wrap border-t border-dashed px-3 py-2 text-muted-foreground">
        {text}
      </div>
    </details>
  );
}
