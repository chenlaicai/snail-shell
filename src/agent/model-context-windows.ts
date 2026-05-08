import fs from "fs";
import path from "path";

let cachedContextWindows: Record<string, number> | null = null;

export function getBuiltinContextWindow(model: string | null | undefined): number | null {
  if (!model) return null;
  const normalized = model.trim();
  if (!normalized) return null;
  const windows = loadModelContextWindows();
  return windows[normalized] ?? windows[stripProvider(normalized)] ?? null;
}

function loadModelContextWindows(): Record<string, number> {
  if (cachedContextWindows) return cachedContextWindows;
  const filePath = path.join(process.cwd(), "config", "model-context-windows.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  cachedContextWindows = Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0)
  );
  return cachedContextWindows;
}

function stripProvider(model: string): string {
  const index = model.indexOf("/");
  return index >= 0 ? model.slice(index + 1) : model;
}
