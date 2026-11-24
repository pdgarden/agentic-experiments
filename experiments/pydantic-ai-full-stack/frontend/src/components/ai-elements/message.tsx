import type { ReactNode } from "react";
import { LogoMark } from "@/components/LogoMark";
import { cn } from "@/utils";

interface MessageProps {
  from: "user" | "assistant" | "system";
  children: ReactNode;
  /** Shown under a finished assistant message on hover (always on touch screens). */
  actions?: ReactNode;
  /** Fade in on mount: only for messages added after the chat was opened. */
  animate?: boolean;
  className?: string;
}

const enter =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300";

export function Message({ from, children, actions, animate, className }: MessageProps) {
  if (from === "user") {
    return (
      <div
        data-testid="user-message"
        data-role={from}
        className={cn("flex w-full justify-end", animate && enter, className)}
      >
        <div className="max-w-[85%] min-w-0 space-y-2 rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-foreground">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid={`${from}-message`}
      data-role={from}
      className={cn(
        "group/message flex w-full flex-col gap-2 sm:flex-row sm:gap-3",
        animate && enter,
        className,
      )}
    >
      <LogoMark size="xs" className="sm:mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {children}
        {actions && (
          <div className="-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown while waiting for the first token: a shimmering "Thinking…" in the assistant's place. */
export function Loader({ label = "Working…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 sm:gap-3">
      <LogoMark size="xs" />
      <span aria-hidden className="text-shimmer text-sm">
        Thinking…
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
