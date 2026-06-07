/**
 * SnailDenStore — 从 config/snail-den.json 加载 Snail Den 配置。
 * 配置文件由用户本地创建并维护（仓库只提供 example），不存在时返回空数组。
 */
import type { MessageRuntime } from "../shared/types";
import { JsonConfigStore } from "./json-config-store";

export interface SnailTemplate {
  id: string;
  name: string;
  runtime: MessageRuntime;
  model: string;
  contextWindow?: number;
  contextProvider: "shell" | "agent";
  invocationTimeoutMs?: number;
}

function parseSnailTemplates(raw: string): SnailTemplate[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).snails)) {
    throw new Error("snail-den 配置文件结构不符合预期：缺少 snails 数组");
  }
  return (parsed as { snails: SnailTemplate[] }).snails;
}

export class SnailDenStore {
  private readonly store: JsonConfigStore<SnailTemplate[]>;

  constructor(configDir: string) {
    this.store = new JsonConfigStore(configDir, "snail-den.json", [], parseSnailTemplates);
  }

  listTemplates(): SnailTemplate[] {
    return this.store.get();
  }

  getTemplate(templateId: string): SnailTemplate | undefined {
    return this.listTemplates().find((t) => t.id === templateId);
  }
}
