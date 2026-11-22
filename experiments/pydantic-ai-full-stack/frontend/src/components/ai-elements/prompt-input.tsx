import { ArrowUp, Square } from "lucide-react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils";

export function PromptInput({ className, children, ...props }: ComponentProps<"form">) {
  return (
    <form className={cn("space-y-1", className)} {...props}>
      <div className="rounded-2xl border bg-background p-2 shadow-sm">{children}</div>
    </form>
  );
}

interface TextareaProps extends ComponentProps<typeof Textarea> {
  /** Enter submits, Shift+Enter adds a line. */
  onSubmitKey: () => void;
}

export function PromptInputTextarea({ onSubmitKey, className, ...props }: TextareaProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmitKey();
    }
  };
  return (
    <Textarea
      rows={1}
      onKeyDown={onKeyDown}
      className={cn(
        "max-h-48 min-h-10 resize-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputToolbar({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1 pt-1">{children}</div>;
}

interface SubmitProps {
  running: boolean;
  disabled: boolean;
  onStop: () => void;
}

export function PromptInputSubmit({ running, disabled, onStop }: SubmitProps) {
  return running ? (
    <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Stop">
      <Square />
    </Button>
  ) : (
    <Button type="submit" size="icon" disabled={disabled} aria-label="Send">
      <ArrowUp />
    </Button>
  );
}
