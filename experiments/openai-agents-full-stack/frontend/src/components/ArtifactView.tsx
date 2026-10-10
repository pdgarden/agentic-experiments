import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { lazy, Suspense } from "react";
import { artifactVersionQuery } from "@/api/queries";

// Vega is large: it loads with the first chart, not with the chat.
const VegaChart = lazy(() =>
  import("@/components/VegaChart").then((module) => ({ default: module.VegaChart })),
);

const pending = (
  <div className="flex h-24 items-center justify-center text-muted-foreground">
    <LoaderCircle className="size-4 animate-spin" />
  </div>
);

/** One version of an artifact, rendered by its kind. */
export function ArtifactView({ artifactId, version }: { artifactId: string; version: number }) {
  const query = useQuery(artifactVersionQuery(artifactId, version));
  if (query.isError) {
    return <p className="text-xs text-destructive">Could not load this artifact.</p>;
  }
  if (!query.data) return pending;
  const { content } = query.data;
  switch (content.kind) {
    case "chart":
      return (
        <Suspense fallback={pending}>
          <VegaChart spec={content.spec} />
        </Suspense>
      );
    default:
      return null;
  }
}
