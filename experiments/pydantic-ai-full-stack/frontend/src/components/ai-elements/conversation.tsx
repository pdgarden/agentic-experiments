import { type ReactNode, useLayoutEffect, useRef } from "react";
import { cn } from "@/utils";

/**
 * The scrolling message area. It follows whatever grows it (tokens, an image loading) while the
 * user is at the bottom, and leaves them alone once they scroll up.
 */
export function Conversation({ children, className }: { children: ReactNode; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);

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
      className={cn("flex-1 overflow-y-auto", className)}
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
      }}
    >
      <div ref={content} className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {children}
      </div>
    </div>
  );
}

export function ConversationEmptyState({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-muted-foreground">{children}</div>;
}
