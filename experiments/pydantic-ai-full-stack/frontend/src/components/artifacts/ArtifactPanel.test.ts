import { describe, expect, it } from "vitest";
import { fileName } from "@/components/artifacts/ArtifactPanel";
import { clampWidth } from "@/hooks/usePanelWidth";

describe("fileName", () => {
  it("keeps letters and digits, joined by dashes", () => {
    expect(fileName("Wins by team (2026)")).toBe("wins-by-team-2026");
  });
  it("drops accents", () => {
    expect(fileName("Résumé d'été")).toBe("resume-d-ete");
  });
  it("falls back when nothing is left", () => {
    expect(fileName("!!!")).toBe("artifact");
  });
});

describe("clampWidth", () => {
  it("keeps the width between 24rem and 70% of the viewport", () => {
    expect(clampWidth(100, 1600)).toBe(384);
    expect(clampWidth(600, 1600)).toBe(600);
    expect(clampWidth(1500, 1600)).toBe(1120);
  });
  it("never goes under 24rem, even on a small viewport", () => {
    expect(clampWidth(500, 400)).toBe(384);
  });
  it("leaves the chat 20rem of the row", () => {
    expect(clampWidth(1000, 1600, 1200)).toBe(880);
  });
});
