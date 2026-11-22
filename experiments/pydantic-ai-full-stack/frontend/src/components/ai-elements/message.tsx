import type { ReactNode } from "react";
import { cn } from "@/utils";

interface MessageProps {
  from: "user" | "assistant" | "system";
  children: ReactNode;
  className?: string;
}

export function Message({ from, children, className }: MessageProps) {
  return (
    <div
      data-testid={`${from}-message`}
      data-role={from}
      className={cn("flex w-full", from === "user" ? "justify-end" : "justify-start", className)}
    >
      <div
        className={cn(
          "min-w-0 space-y-2",
          from === "user"
            ? "max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 text-secondary-foreground"
            : "w-full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Loader({ label = "Working…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-current" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
