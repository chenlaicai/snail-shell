import fs from "fs";
import path from "path";

export interface LlmConfig {
  provider: "openai";
  openai: {
    api_key: string;
    model: string;
    base_url: string;
    timeout_ms: number;
  };
}

export function loadLlmConfig(): LlmConfig {
  const filePath = path.join(process.cwd(), "config", "llm.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("Missing config/llm.json. Create it from config/llm.json.example before starting the server.");
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as LlmConfig;
}
