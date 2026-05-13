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
 *
 * 为什么选择同步 readFileSync：配置文件在服务启动时加载一次，同步读取简化了
 * 启动序列，避免竞态条件；文件体积小（通常 <10KB），阻塞时间可忽略。
 *
 * 为什么依赖 process.cwd()：配置文件路径相对于项目根目录，而非源码位置；
 * 这样无论编译输出在何处，配置路径始终一致。
 */
export function loadSnailDen(): SnailTemplate[] {
  const filePath = path.join(process.cwd(), "config", "snail-den.json");

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`无法加载 snail-den 配置文件 (${filePath}): ${(err as Error).message}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`snail-den 配置文件 JSON 格式错误 (${filePath})`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).snails)) {
    throw new Error(`snail-den 配置文件结构不符合预期：缺少 snails 数组 (${filePath})`);
  }

  return (parsed as { snails: SnailTemplate[] }).snails;
}
