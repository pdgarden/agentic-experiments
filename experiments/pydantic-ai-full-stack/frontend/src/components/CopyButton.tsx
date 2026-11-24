import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils";

interface CopyButtonProps {
  /** Read on click, so a streaming source copies what is there now. */
  text: () => string;
  /** The accessible name, e.g. "Copy response". */
  label: string;
  className?: string;
}

/** An icon button that copies `text` and shows a check mark for a moment. */
export function CopyButton({ text, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
    } catch {
      // No clipboard (insecure context, denied permission): nothing to confirm.
    }
  };

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={copy}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <Icon className={cn("size-3.5", copied && "text-success")} aria-hidden />
    </button>
  );
}
