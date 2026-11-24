import { ArrowDown } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/utils";

/**
 * The scrolling message area. It follows whatever grows it (tokens, an image loading) while the
 * user is at the bottom, and leaves them alone once they scroll up. Then a floating button brings
 * them back down (and pins them again).
 */
export function Conversation({ children, className }: { children: ReactNode; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const [away, setAway] = useState(false);

  const jumpToBottom = () => {
    const element = scroller.current;
    if (!element) return;
    pinned.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (element.scrollTo) {
      element.scrollTo({ top: element.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    } else element.scrollTop = element.scrollHeight;
  };

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !content.current) return;
    const follow = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(content.current);
    observer.observe(element); // the composer growing shrinks the scroller
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={scroller}
      // `relative`: absolutely positioned content (sr-only labels, KaTeX's MathML) must be clipped
      // by this scroller. Without it they escape to the chat column and make the page scroll too.
      className={cn("relative flex-1 overflow-y-auto", className)}
      data-testid="chat-scroller"
      // A wheel up is intent, even when a token lands in the same frame and hides the move.
      onWheel={(event) => {
        if (event.deltaY < 0) pinned.current = false;
      }}
      onScroll={(event) => {
        const element = event.currentTarget;
        const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 2;
        if (atBottom) pinned.current = true;
        else if (element.scrollTop < lastTop.current) pinned.current = false;
        lastTop.current = element.scrollTop;
        // More than a short glance up: offer the way back.
        setAway(element.scrollHeight - element.scrollTop - element.clientHeight > 120);
      }}
    >
      <div ref={content} className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {children}
      </div>
      {/* Zero-height and sticky: it rides the scroller's bottom edge without taking room. */}
      <div className="pointer-events-none sticky bottom-3 flex h-0 justify-center">
        {away && (
          <button
            type="button"
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            onClick={jumpToBottom}
            className="pointer-events-auto flex size-8 -translate-y-full items-center justify-center rounded-full border bg-card text-muted-foreground shadow-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The greeting of an empty chat: an optional mark, a heading and a line of help. */
export function ConversationEmptyState({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
      {icon}
      <h2 className="text-2xl font-semibold tracking-tight text-balance">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
