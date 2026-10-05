import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ComposerProps {
  running: boolean;
  onSend: (text: string) => Promise<void>;
  onCancel: () => void;
}

/** Message input: Enter sends, Shift+Enter adds a line; Stop while a run is going. */
export function Composer({ running, onSend, onCancel }: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = text.trim() !== "" && !running && !sending;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text.trim());
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the agent…"
          aria-label="Message"
          rows={1}
          className="max-h-48 min-h-10 resize-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          autoFocus
        />
        {running ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onCancel}
            aria-label="Stop"
          >
            <Square />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send">
            <ArrowUp />
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
