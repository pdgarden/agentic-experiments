import { MessageSquare } from "lucide-react";
import { cn } from "@/utils";

const sizes = {
  xs: { box: "size-6 rounded-md", icon: "size-3.5" },
  sm: { box: "size-7 rounded-lg", icon: "size-4" },
  lg: { box: "size-11 rounded-xl shadow-sm", icon: "size-6" },
} as const;

/** The app's mark: a filled chat bubble on an accent square, like the favicon. */
export function LogoMark({
  size = "sm",
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-primary text-primary-foreground",
        sizes[size].box,
        className,
      )}
    >
      <MessageSquare className={sizes[size].icon} fill="currentColor" />
    </span>
  );
}
