export interface DriftAnalysis {
  filePath: string;
  inferredOriginalPurpose: string;
  currentResponsibilities: string[];
  hasDrifted: boolean;
  driftSummary: string;
  suggestedSplit: {
    newFileName: string;
    responsibility: string;
    movedExports: string[];
  }[] | null;
  warnings: string[];
}

export type LLMProvider =
  | { kind: "anthropic"; apiKey: string; model?: string }
  | { kind: "gemini"; apiKey: string; model?: string }
  | { kind: "ollama"; baseUrl?: string; model?: string };

export interface EmittedPrompt {
  filePath: string;
  relativeFilePath: string;
  exportedSymbols: string[];
  importedSymbolNames: string[];
  touchCount: number | null;
  systemPrompt: string;
  userPrompt: string;
}

