/**
 * SnailDenStore — 从 config/snail-den.json 加载 Snail Den 配置。
 *
 * Why: 原先 snail-den/index.ts 直接读取文件，违反持久化层统一入口原则。
 * 提取为独立 Store 后，所有配置文件读写都经过 persistence 层。
 *
 * 设计决策：SnailDenStore 只负责文件加载和缓存，不包含业务逻辑。
 * SnailDen 类保留业务逻辑（runtime 解析、实例创建），通过注入 Store 获取配置。
 */
import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../shared/types";

/** Snail Template 类型定义——从 snail-den/index.ts 迁移。 */
export interface SnailTemplate {
  id: string;
  name: string;
  runtime: AgentRuntime;
  model: string;
  /** 上下文窗口大小（token 数），用于 runtime 未返回上下文窗口时的兜底 */
  contextWindow?: number;
  /**
   * 上下文提供方：
   * - "shell": Snail Shell 维护上下文（实时总结 + 历史查询 skill + 最新 N 轮对话）
   * - "agent": Agent 自维护上下文（通过 resume sessionId + 最新消息）
   */
  contextProvider: "shell" | "agent";
  /** 调用超时（毫秒），用于限制单次 agent 调用最大时长。未设置时使用 agent 默认值（30 分钟）。 */
  invocationTimeoutMs?: number;
}

export class SnailDenStore {
  private readonly configPath: string;
  private cachedTemplates: SnailTemplate[] | null = null;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, "snail-den.json");
  }

  /**
   * 获取所有 Snail Template 列表。
   * 配置文件由用户本地创建并维护（仓库只提供 example），不存在时返回空数组。
   */
  listTemplates(): SnailTemplate[] {
    if (this.cachedTemplates) return this.cachedTemplates;

    let raw: string;
    try {
      raw = fs.readFileSync(this.configPath, "utf8");
    } catch (err) {
      /** 配置文件由用户本地创建并维护（仓库只提供 example），不存在时返回空数组让系统正常启动 */
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cachedTemplates = [];
        return this.cachedTemplates;
      }
      throw new Error(`无法加载 snail-den 配置文件 (${this.configPath}): ${(err as Error).message}`, { cause: err });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`snail-den 配置文件 JSON 格式错误 (${this.configPath})`);
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).snails)) {
      throw new Error(`snail-den 配置文件结构不符合预期：缺少 snails 数组 (${this.configPath})`);
    }

    this.cachedTemplates = (parsed as { snails: SnailTemplate[] }).snails;
    return this.cachedTemplates;
  }

  /**
   * 获取指定 template 的元数据。
   * @returns template 或 undefined（如果不存在）。
   */
  getTemplate(templateId: string): SnailTemplate | undefined {
    return this.listTemplates().find((t) => t.id === templateId);
  }
}
