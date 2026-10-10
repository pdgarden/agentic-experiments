// Renders a Vega-Lite spec. Loaded lazily (see ArtifactView): vega is most of the bundle.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Loader } from "vega";
import embed, { type VisualizationSpec } from "vega-embed";
import { expressionInterpreter } from "vega-interpreter";

// Specs come from the model. The backend only stores specs with inline data; on top of that
// nothing is ever fetched (data, images, link targets), and expressions run in vega's
// interpreter rather than through `new Function`.
const refuse = (uri: string) => Promise.reject(new Error(`Charts cannot load ${uri}`));

export const blockedLoader: Loader = {
  load: refuse,
  sanitize: refuse,
  http: refuse,
  file: refuse,
};

const darkQuery = "(prefers-color-scheme: dark)";

function useDarkMode(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(darkQuery);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(darkQuery).matches,
  );
}

/** Single and layered charts fill their container; compound ones keep their own sizes. */
function fitted(spec: Record<string, unknown>): VisualizationSpec {
  const single = "mark" in spec || "layer" in spec;
  const sized = single && spec.width === undefined ? { width: "container", ...spec } : spec;
  return sized as VisualizationSpec;
}

export function VegaChart({ spec }: { spec: Record<string, unknown> }) {
  const container = useRef<HTMLDivElement>(null);
  const dark = useDarkMode();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let finalize: (() => void) | undefined;
    let cancelled = false;
    setError(null);
    embed(element, fitted(spec), {
      actions: false,
      ast: true,
      expr: expressionInterpreter,
      loader: blockedLoader,
      renderer: "svg",
      theme: dark ? "dark" : undefined,
      config: { background: "transparent" },
    })
      .then((result) => {
        if (cancelled) result.finalize();
        else finalize = result.finalize;
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [spec, dark]);

  return (
    <div className="w-full">
      <div ref={container} className="w-full" data-testid="vega-chart" />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Could not draw this chart: {error}
        </p>
      )}
    </div>
  );
}
