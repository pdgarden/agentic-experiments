import { useCallback, useSyncExternalStore } from "react";

// The selection lives in the URL hash, so a reload reopens it: `#<session id>`, or
// `#<session id>/<artifact id>` while an artifact is open in the side panel.

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const segment = (index: number) => () => {
  const value = window.location.hash.slice(1).split("/")[index];
  return value ? decodeURIComponent(value) : null;
};
const readSession = segment(0);
const readArtifact = segment(1);

function navigate(sessionId: string | null, artifactId: string | null = null) {
  if (sessionId) {
    const parts = artifactId ? [sessionId, artifactId] : [sessionId];
    window.location.hash = parts.map(encodeURIComponent).join("/");
  } else {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

/** The selected session; selecting one closes any open artifact. */
export function useHashSession(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, readSession);
  const select = useCallback((next: string | null) => navigate(next), []);
  return [id, select];
}

/** The artifact open in the side panel, within the selected session. */
export function useHashArtifact(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, readArtifact);
  const open = useCallback((next: string | null) => navigate(readSession(), next), []);
  return [id, open];
}
