import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../agent/interface";

export interface SnailTemplate {
  id: string;
  name: string;
  runtime: AgentRuntime;
  model: string;
}

/**
 * Snail Den 是 snail template 池，集中管理所有可用的 agent runtime + model 组合。
 * 每个 template 定义了一个可复用的 snail 配置；实际对话中从池中选取 template，
 * 由该对话创建独立的 snail 实例。
 */
export function loadSnailDen(): SnailTemplate[] {
  const filePath = path.join(process.cwd(), "config", "snail-den.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as { snails: SnailTemplate[] };
  return parsed.snails;
}
