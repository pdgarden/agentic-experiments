import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { ArtifactDetail, ArtifactRecord, ArtifactVersionRecord } from "@/api/types";
import { ArtifactCard } from "@/components/ArtifactCard";
import { ArtifactPanel, ArtifactsToggle } from "@/components/ArtifactPanel";
import { blockedLoader } from "@/components/VegaChart";

vi.mock("@/api/client", () => ({
  api: { listArtifacts: vi.fn(), getArtifact: vi.fn(), getArtifactVersion: vi.fn() },
}));

// jsdom cannot lay out vega: the chart shows which spec it was given instead.
vi.mock("@/components/VegaChart", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/VegaChart")>()),
  VegaChart: ({ spec }: { spec: { mark: string } }) => (
    <div data-testid="vega-chart">{spec.mark}</div>
  ),
}));

const mocked = vi.mocked(api);

const record = (id: string, title: string, latest: number): ArtifactRecord => ({
  id,
  session_id: "s1",
  kind: "chart",
  title,
  latest_version: latest,
  created_at: "2026-10-10T00:00:00.000+00:00",
  updated_at: "2026-10-10T00:00:00.000+00:00",
});

const marks: Record<number, string> = { 1: "bar", 2: "line" };

function version(artifactId: string, v: number): ArtifactVersionRecord {
  return {
    artifact_id: artifactId,
    version: v,
    run_id: "r1",
    title: v === 1 ? "Points" : "Points (line)",
    created_at: "2026-10-10T00:00:00.000+00:00",
    content: { kind: "chart", spec: { mark: marks[v] ?? "point" } },
  };
}

function detail(id: string): ArtifactDetail {
  const { content: _1, ...v1 } = version(id, 1);
  const { content: _2, ...v2 } = version(id, 2);
  return { ...record(id, "Points (line)", 2), versions: [v1, v2] };
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getArtifactVersion.mockImplementation(async (id, v) => version(id, v));
  mocked.getArtifact.mockImplementation(async (id) => detail(id));
  mocked.listArtifacts.mockResolvedValue([record("a2", "Other", 1), record("a1", "Points", 2)]);
  window.location.hash = "#s1";
});

afterEach(() => {
  window.location.hash = "";
});

describe("ArtifactCard", () => {
  it("shows the version its message made, not the latest", async () => {
    wrap(
      <ArtifactCard
        part={{ type: "artifact", artifact_id: "a1", kind: "chart", title: "Points", version: 1 }}
      />,
    );
    const card = screen.getByTestId("artifact-card");
    expect(card).toHaveTextContent("Points");
    expect(card).toHaveTextContent("v1");
    expect(await within(card).findByTestId("vega-chart")).toHaveTextContent("bar");
    expect(mocked.getArtifactVersion).toHaveBeenCalledWith("a1", 1);
  });

  it("opens the artifact in the panel through the URL", async () => {
    wrap(
      <ArtifactCard
        part={{ type: "artifact", artifact_id: "a1", kind: "chart", title: "Points", version: 1 }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open Points" }));
    expect(window.location.hash).toBe("#s1/a1");
  });

  it("says when the version cannot be loaded", async () => {
    mocked.getArtifactVersion.mockRejectedValue(new Error("gone"));
    wrap(
      <ArtifactCard
        part={{ type: "artifact", artifact_id: "a1", kind: "chart", title: "Points", version: 1 }}
      />,
    );
    expect(await screen.findByText("Could not load this artifact.")).toBeInTheDocument();
  });
});

describe("ArtifactPanel", () => {
  it("lists the session's artifacts and shows the selected one at its latest version", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    wrap(<ArtifactPanel sessionId="s1" artifactId="a1" onSelect={onSelect} onClose={onClose} />);

    const panel = screen.getByRole("complementary", { name: "Artifacts" });
    const entries = await within(panel).findAllByTestId("artifact-entry");
    expect(entries.map((entry) => entry.textContent)).toEqual(["Otherv1", "Pointsv2"]);
    expect(entries[1]).toHaveAttribute("aria-current", "true");

    const view = await screen.findByTestId("artifact-panel-view");
    expect(view).toHaveAttribute("data-version", "2");
    expect(view).toHaveTextContent("Points (line)");
    expect(await within(view).findByTestId("vega-chart")).toHaveTextContent("line");

    await userEvent.click(entries[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("a2");
    await userEvent.click(screen.getByRole("button", { name: "Close artifacts" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to an older version", async () => {
    wrap(<ArtifactPanel sessionId="s1" artifactId="a1" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByTestId("artifact-panel-view");

    await userEvent.click(screen.getByRole("combobox", { name: "Version" }));
    await userEvent.click(await screen.findByRole("option", { name: "v1" }));

    const view = screen.getByTestId("artifact-panel-view");
    expect(view).toHaveAttribute("data-version", "1");
    expect(await within(view).findByText("bar")).toBeInTheDocument();
  });
});

describe("ArtifactsToggle", () => {
  it("opens the newest artifact", async () => {
    const onOpen = vi.fn();
    wrap(<ArtifactsToggle sessionId="s1" onOpen={onOpen} />);
    await userEvent.click(await screen.findByRole("button", { name: /Artifacts \(2\)/ }));
    expect(onOpen).toHaveBeenCalledWith("a2");
  });

  it("is hidden while the session has none", async () => {
    mocked.listArtifacts.mockResolvedValue([]);
    const { container } = wrap(<ArtifactsToggle sessionId="s1" onOpen={vi.fn()} />);
    await vi.waitFor(() => expect(mocked.listArtifacts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("VegaChart loader", () => {
  it("refuses every URL", async () => {
    await expect(blockedLoader.load("https://example.com/data.csv")).rejects.toThrow(
      "Charts cannot load",
    );
    await expect(blockedLoader.sanitize("https://x", { context: "href" })).rejects.toThrow();
  });
});
