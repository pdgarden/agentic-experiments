import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Interrupted } from "@/api/types";
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
    <div
      role="status"
      data-testid="interrupted-banner"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>The last run was interrupted by a server restart. What it completed is kept.</p>
        {tools.length > 0 && (
          <p className="text-muted-foreground">
            These tool calls may or may not have run:{" "}
            {tools.map((t, i) => (
              <span key={t.tool_call_id ?? i}>
                {i > 0 && ", "}
                <code>{t.tool_name ?? "unknown tool"}</code>
              </span>
            ))}
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </div>
      <Button
        size="sm"
        variant="outline"
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
        Continue
      </Button>
    </div>
  );
}
