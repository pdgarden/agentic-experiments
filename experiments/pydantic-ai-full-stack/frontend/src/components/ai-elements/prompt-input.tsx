import { ArrowUp, Paperclip, Square } from "lucide-react";
import { type ComponentProps, type DragEvent, type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

interface PromptInputProps extends Omit<ComponentProps<"form">, "onDrop"> {
  /** Files dropped on the form. */
  onDropFiles?: (files: FileList) => void;
}

/** The input frame: an accent ring on focus and a "drop files" overlay while files are dragged over. */
export function PromptInput({ className, children, onDropFiles, ...props }: PromptInputProps) {
  // Enter / leave fire for every child crossed, so count them instead of toggling.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const drag = onDropFiles && {
    onDragEnter: (event: DragEvent<HTMLFormElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent<HTMLFormElement>) => {
      if (hasFiles(event)) event.preventDefault();
    },
    onDragLeave: (event: DragEvent<HTMLFormElement>) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLFormElement>) => {
      depth.current = 0;
      setDragging(false);
      if (!hasFiles(event)) return;
      event.preventDefault();
      onDropFiles(event.dataTransfer.files);
    },
  };

  return (
    <form className={cn("space-y-1", className)} {...drag} {...props}>
      <div
        className={cn(
          "relative rounded-2xl border bg-card p-2 shadow-sm transition-[border-color,box-shadow]",
          "focus-within:border-ring/60 focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/40",
        )}
      >
        {children}
        {dragging && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-accent-soft/90 text-sm font-medium text-accent-soft-foreground motion-safe:animate-in motion-safe:fade-in-0"
          >
            <Paperclip className="size-4" />
            Drop files to attach
          </div>
        )}
      </div>
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
        // `field-sizing-content` (from ui/textarea) grows it with the text, up to max-h-48.
        "max-h-48 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

interface SubmitProps {
  running: boolean;
  disabled: boolean;
  onStop: () => void;
}

export function PromptInputSubmit({ running, disabled, onStop }: SubmitProps) {
  return running ? (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onStop}
      aria-label="Stop"
      className="rounded-full border-2 border-foreground/70 text-foreground hover:border-foreground hover:bg-muted"
    >
      <Square className="size-3 fill-current" />
    </Button>
  ) : (
    <Button
      type="submit"
      size="icon"
      disabled={disabled}
      aria-label="Send"
      title="Enter to send, Shift+Enter for a new line"
      className="rounded-full motion-safe:transition-transform motion-safe:hover:scale-105 motion-safe:active:scale-95"
    >
      <ArrowUp />
    </Button>
  );
}
