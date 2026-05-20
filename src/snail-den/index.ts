import fs from "fs";
import path from "path";
import type { AgentRuntime, SnailRuntime } from "../agent/interface";
import type { SnailAgentResolver } from "../agent/resolver";

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
}

/**
 * SnailRuntimeInstance 是 Snail Den 对外提供的 snail 实例抽象。
 * 业务模块通过 getSnailRuntime() 获取此对象，直接调用 invoke 即可，
 * 无需关心底层 agent 类型和 model 配置。
 */
export interface SnailRuntimeInstance {
  /** 底层 agent runtime 实例，可直接调用 invokeMessage */
  readonly runtime: SnailRuntime;
  /** 此 template 配置的模型标识，agent 调用时优先使用 */
  readonly model: string;
  /** 此 template 配置的上下文窗口大小（token 数），用于 runtime 未返回上下文窗口时的兜底 */
  readonly contextWindow: number | null;
  /** template 元数据 */
  readonly template: SnailTemplate;
}

/**
 * Snail Den 是 snail template 池，集中管理所有可用的 agent runtime + model 组合。
 * 它是其他模块获取 snail 实例的唯一入口：业务模块不直接接触 agent 层，
 * 而是通过 Snail Den 获取配好 model 的 runtime 实例。
 *
 * 为什么选择同步 readFileSync：配置文件在服务启动时加载一次，同步读取简化了
 * 启动序列，避免竞态条件；文件体积小（通常 <10KB），阻塞时间可忽略。
 *
 * 为什么依赖 process.cwd()：配置文件路径相对于项目根目录，而非源码位置；
 * 这样无论编译输出在何处，配置路径始终一致。
 */
export class SnailDen {
  private readonly templates = new Map<string, SnailTemplate>();
  private readonly agentResolver: SnailAgentResolver;

  constructor(agentResolver: SnailAgentResolver) {
    this.agentResolver = agentResolver;
    for (const template of loadSnailDen()) {
      this.templates.set(template.id, template);
    }
  }

  /** 获取指定 template 的 snail 实例（runtime + model + contextWindow），供业务模块直接调用。 */
  getSnailRuntime(templateId: string): SnailRuntimeInstance {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Snail Den 中未找到 template: ${templateId}`);
    }
    const runtime = this.agentResolver.resolve(template.runtime);
    return { runtime, model: template.model, contextWindow: template.contextWindow ?? null, template };
  }

  /** 获取所有可用 template 列表，用于 UI 展示。 */
  listTemplates(): SnailTemplate[] {
    return Array.from(this.templates.values());
  }

  /** 获取指定 template 的元数据（不创建 runtime 实例）。 */
  getTemplate(templateId: string): SnailTemplate | undefined {
    return this.templates.get(templateId);
  }
}

function loadSnailDen(): SnailTemplate[] {
  const filePath = path.join(process.cwd(), "config", "snail-den.json");

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    /** 配置文件由用户本地创建并维护（仓库只提供 example），不存在时返回空数组让系统正常启动 */
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
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

export { SystemAISnail } from "./system-ai";
export type { SystemAI, ConversationSummaryInput, MessageContextSummaryInput, MentionExtractionInput, MentionExtractionResult } from "./system-ai";
