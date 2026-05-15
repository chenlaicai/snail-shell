import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { logger } from "../logger";
import type { AgentRuntime, SnailRuntime } from "../agent/interface";
import type { SnailAgentResolver } from "../agent/resolver";
import { upsertSnailDefinition } from "../persistence/snail-definition-model";

export interface SnailTemplate {
  id: string;
  name: string;
  runtime: AgentRuntime;
  model: string;
  /** 上下文窗口大小（token 数），用于 runtime 未返回上下文窗口时的兜底 */
  contextWindow?: number;
}

/** Snail Den 配置文件中的 snail 定义（身份 + 能力，不含 role 级职责） */
export interface SnailDenSnailDefinition {
  name: string;
  description: string;
  template?: string;
  kind?: "human" | "agent";
  capability_expectations?: string[];
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

interface SnailDenConfig {
  templates: SnailTemplate[];
  snails: SnailDenSnailDefinition[];
}

/**
 * Snail Den 是 snail 定义和 template 的统一管理层。
 * 它是其他模块获取 snail 实例的唯一入口：业务模块不直接接触 agent 层，
 * 而是通过 Snail Den 获取配好 model 的 runtime 实例。
 *
 * config/snail-den.json 包含：
 * - templates: agent runtime + model 组合池
 * - snails: snail 完整定义（身份 + 运行时引用）
 *
 * 启动时 seedSnailDefinitions() 将 snail 定义写入数据库 snail_definition 表，
 * 供项目管理模块通过 SnailRegistry 读取。
 *
 * 为什么选择同步 readFileSync：配置文件在服务启动时加载一次，同步读取简化了
 * 启动序列，避免竞态条件；文件体积小（通常 <10KB），阻塞时间可忽略。
 *
 * 为什么依赖 process.cwd()：配置文件路径相对于项目根目录，而非源码位置；
 * 这样无论编译输出在何处，配置路径始终一致。
 */
export class SnailDen {
  private readonly templates = new Map<string, SnailTemplate>();
  private readonly snailDefinitions: SnailDenSnailDefinition[];
  private readonly agentResolver: SnailAgentResolver;

  constructor(agentResolver: SnailAgentResolver) {
    this.agentResolver = agentResolver;
    const config = loadSnailDenConfig();
    for (const template of config.templates) {
      this.templates.set(template.id, template);
    }
    this.snailDefinitions = config.snails;
    logger.info("Snail Den loaded", {
      templateCount: config.templates.length,
      snailCount: config.snails.length,
      templates: config.templates.map((t) => ({ id: t.id, runtime: t.runtime, model: t.model })),
    });
  }

  /** 将 snail 定义 seed 到数据库 snail_definition 表，供项目管理模块读取。 */
  seedSnailDefinitions(db: Database.Database): void {
    for (const snail of this.snailDefinitions) {
      upsertSnailDefinition(db, {
        name: snail.name,
        description: snail.description,
        template: snail.template ?? null,
        kind: snail.kind ?? "agent",
        capability_expectations: snail.capability_expectations ?? [],
      });
    }
    logger.info("Snail definitions seeded to database", { count: this.snailDefinitions.length });
  }

  /** 获取指定 template 的 snail 实例（runtime + model + contextWindow），供业务模块直接调用。 */
  getSnailRuntime(templateId: string): SnailRuntimeInstance {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Snail Den 中未找到 template: ${templateId}`);
    }
    const runtime = this.agentResolver.resolve({ runtime: template.runtime } as Parameters<SnailAgentResolver["resolve"]>[0]);
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

/**
 * 加载 Snail Den 配置文件。
 *
 * 支持两种格式（向后兼容）：
 * - 新格式：{ "templates": [...], "snails": [...] }
 * - 旧格式：{ "snails": [...] } （snails 数组实际是 template 列表）
 *
 * 当 snails 数组中的对象包含 runtime 字段时，视为旧格式（template-only），
 * 将 snails 当作 templates 处理，snail 定义为空数组。
 */
function loadSnailDenConfig(): SnailDenConfig {
  const filePath = path.join(process.cwd(), "config", "snail-den.json");

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    /** 配置文件由用户本地创建并维护（仓库只提供 example），不存在时返回空配置让系统正常启动 */
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { templates: [], snails: [] };
    }
    throw new Error(`无法加载 snail-den 配置文件 (${filePath}): ${(err as Error).message}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`snail-den 配置文件 JSON 格式错误 (${filePath})`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`snail-den 配置文件结构不符合预期 (${filePath})`);
  }

  const obj = parsed as Record<string, unknown>;

  // 新格式：{ "templates": [...], "snails": [...] }
  if (Array.isArray(obj.templates)) {
    return {
      templates: obj.templates as SnailTemplate[],
      snails: Array.isArray(obj.snails) ? (obj.snails as SnailDenSnailDefinition[]) : [],
    };
  }

  // 旧格式兼容：{ "snails": [...] } 其中 snails 实际是 template 列表
  if (Array.isArray(obj.snails)) {
    const isTemplateArray = obj.snails.length > 0 && typeof obj.snails[0] === "object" && "runtime" in (obj.snails[0] as Record<string, unknown>);
    if (isTemplateArray) {
      logger.info("Snail Den config using legacy format (snails as templates), consider migrating to { templates, snails } format");
      return { templates: obj.snails as SnailTemplate[], snails: [] };
    }
    // 新格式但没有 templates 键
    return { templates: [], snails: obj.snails as SnailDenSnailDefinition[] };
  }

  return { templates: [], snails: [] };
}

export { SystemAISnail } from "./system-ai";
export type { SystemAI, ConversationSummaryInput, MessageContextSummaryInput, MentionExtractionInput, MentionExtractionResult } from "./system-ai";
