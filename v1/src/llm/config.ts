import fs from "fs";
import path from "path";

import type { LlmConfig } from "../persistence/llm-config-store";

export function loadLlmConfig(): LlmConfig {
  const filePath = path.join(process.cwd(), "config", "llm.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("Missing config/llm.json. Create it from config/llm.json.example before starting the server.");
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as LlmConfig;
}
