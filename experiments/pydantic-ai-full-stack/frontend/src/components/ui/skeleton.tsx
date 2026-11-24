import type * as React from "react";
import { cn } from "@/utils";

/** A placeholder block that pulses while content loads (still under reduced motion). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("rounded-md bg-foreground/8 motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
