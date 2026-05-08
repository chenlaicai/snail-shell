const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.5": 400000,
  "my-geek/gpt-5.5": 400000,
  "gpt-5.4": 200000,
  "my-geek/gpt-5.4": 200000,
  "gpt-5.1-codex-max": 400000,
  "opencode/gpt-5.1-codex-max": 400000,
  "big-pickle": 200000,
  "opencode/big-pickle": 200000,
};

export function getBuiltinContextWindow(model: string | null | undefined): number | null {
  if (!model) return null;
  const normalized = model.trim();
  if (!normalized) return null;
  return MODEL_CONTEXT_WINDOWS[normalized] ?? MODEL_CONTEXT_WINDOWS[stripProvider(normalized)] ?? null;
}

function stripProvider(model: string): string {
  const index = model.indexOf("/");
  return index >= 0 ? model.slice(index + 1) : model;
}
