import { createContext, useContext } from "react";

/** Opens the artifacts panel of the current chat on one artifact. */
export const OpenArtifactContext = createContext<(artifactId: string) => void>(() => {});

export const useOpenArtifact = () => useContext(OpenArtifactContext);
