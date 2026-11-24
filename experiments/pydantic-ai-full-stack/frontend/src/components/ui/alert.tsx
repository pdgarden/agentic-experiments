import { CircleAlert, RotateCw, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

const tones = {
  destructive: {
    frame: "border-destructive/40 bg-destructive/10",
    icon: CircleAlert,
    iconClass: "text-destructive",
  },
  // `--warning` is too light for text or a bare icon in light mode: it fills a chip instead.
  warning: {
    frame: "border-warning/60 bg-warning/15",
    icon: TriangleAlert,
    iconClass: "rounded-full bg-warning p-0.5 text-warning-foreground",
  },
} as const;

interface AlertProps extends Omit<React.ComponentProps<"div">, "title"> {
  tone?: keyof typeof tones;
  /** `alert` interrupts screen readers; `status` (polite) suits errors the user just caused. */
  role?: "alert" | "status";
  title?: React.ReactNode;
  /** Buttons on the right, e.g. a `RetryButton`. */
  action?: React.ReactNode;
  size?: "sm" | "default";
}

/** A small framed message with an icon: load and send errors, the interrupted-run banner. */
function Alert({
  tone = "destructive",
  role = "alert",
  title,
  action,
  size = "default",
  className,
  children,
  ...props
}: AlertProps) {
  const { frame, icon: Icon, iconClass } = tones[tone];
  return (
    <div
      role={role}
      data-slot="alert"
      data-tone={tone}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border text-foreground",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
        frame,
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 shrink-0", size === "sm" ? "size-3.5" : "size-4", iconClass)}
      />
      <div className="min-w-0 flex-1 space-y-1 break-words">
        {title && <p className="font-medium">{title}</p>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1 self-center">{action}</div>}
    </div>
  );
}

/** "Retry", for an alert whose failed action can simply be run again. */
function RetryButton({
  onRetry,
  busy = false,
  label = "Retry",
}: {
  onRetry: () => void;
  busy?: boolean;
  label?: string;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      className="bg-background/60"
      disabled={busy}
      onClick={onRetry}
    >
      <RotateCw className={cn(busy && "motion-safe:animate-spin")} />
      {label}
    </Button>
  );
}

export { Alert, RetryButton };
