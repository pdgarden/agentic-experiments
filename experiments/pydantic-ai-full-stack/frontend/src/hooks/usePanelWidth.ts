// The artifact panel's width in px, or null for the default. Kept in localStorage.
import { useEffect, useState } from "react";

export const PANEL_WIDTH_KEY = "artifact-panel-width";

/**
 * 24rem to 70vw, the range the drag handle allows; with `row` (the width the panel shares with
 * the chat), also no more than leaves the chat 20rem.
 */
export function clampWidth(width: number, viewport = window.innerWidth, row = Infinity): number {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const min = 24 * rem;
  const max = Math.min(viewport * 0.7, row - 20 * rem);
  return Math.round(Math.max(min, Math.min(width, max)));
}

function readWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null; // Storage blocked: the default width.
  }
}

export function usePanelWidth() {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    try {
      if (width === null) localStorage.removeItem(PANEL_WIDTH_KEY);
      else localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      // Storage blocked: the width lasts for this page only.
    }
  }, [width]);

  return [width, setWidth] as const;
}
