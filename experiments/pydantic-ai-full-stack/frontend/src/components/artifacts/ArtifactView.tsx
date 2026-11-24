import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { artifactVersionQuery } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { Alert, RetryButton } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

// Vega is large: it loads with the first chart, not with the chat.
const VegaChart = lazy(() =>
  import("@/components/artifacts/VegaChart").then((module) => ({ default: module.VegaChart })),
);

/** Lines of text and a block, while an artifact (or its version list) loads. */
export const ArtifactSkeleton = () => (
  <div className="space-y-2.5 py-1">
    <span role="status" className="sr-only">
      Loading artifact…
    </span>
    <Skeleton className="h-3.5 w-11/12" />
    <Skeleton className="h-3.5 w-4/5" />
    <Skeleton className="h-3.5 w-3/5" />
    <Skeleton className="h-16 w-full" />
  </div>
);
const pending = <ArtifactSkeleton />;

/** One version of an artifact, rendered by its kind. */
export function ArtifactView({ artifactId, version }: { artifactId: string; version: number }) {
  const query = useQuery(artifactVersionQuery(artifactId, version));
  if (query.isError) {
    return (
      <Alert
        size="sm"
        action={<RetryButton busy={query.isFetching} onRetry={() => void query.refetch()} />}
      >
        Could not load this artifact.
      </Alert>
    );
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
    case "text":
      return <Markdown text={content.text} />;
  }
}
