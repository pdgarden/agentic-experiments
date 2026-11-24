import { Play } from "lucide-react";
import { useState } from "react";
import type { Interrupted } from "@/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface InterruptedBannerProps {
  interrupted: Interrupted;
  onContinue: () => Promise<void>;
}

/**
 * The server stopped during this conversation's last run. Its completed steps are kept; tool calls
 * that started but never reported back are listed, never silently retried.
 */
export function InterruptedBanner({ interrupted, onContinue }: InterruptedBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tools = interrupted.unresolved_tools;
  return (
    <Alert
      tone="warning"
      role="status"
      data-testid="interrupted-banner"
      title="The last run was interrupted by a server restart."
      action={
        <Button
          size="sm"
          variant="outline"
          className="bg-background/60"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onContinue();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Play />
          Continue
        </Button>
      }
    >
      <p className="text-muted-foreground">What it completed is kept.</p>
      {tools.length > 0 && (
        <p className="text-muted-foreground">
          These tool calls may or may not have run:{" "}
          {tools.map((t, i) => (
            <span key={t.tool_call_id ?? i}>
              {i > 0 && ", "}
              <code className="rounded bg-background/60 px-1 font-mono text-xs text-foreground">
                {t.tool_name ?? "unknown tool"}
              </code>
            </span>
          ))}
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </Alert>
  );
}
