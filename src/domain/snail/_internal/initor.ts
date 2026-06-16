import type { AgentRegistryPort } from "@infra/acs/port";
import type { TenetPromptPort } from "@domain/tenet-prompt/port";
import type { SkillPort } from "@domain/skill/port";
import type { MCPPort } from "@domain/mcp/port";
import type { GuardProfilePort } from "@domain/guard-profile/port";
import type { FileDataStore } from "@infra/file-data-store";
import type { SQLiteDatabase } from "@infra/database";
import { FileSnailRepository } from "@domain/snail/_internal/repository";
import { SnailAdapter } from "@domain/snail/_internal/adapter";

/** Snail 模块依赖 */
export interface SnailDeps {
  registry: AgentRegistryPort;
  tenetPrompt: TenetPromptPort;
  skill: SkillPort;
  mcp: MCPPort;
  guardProfile: GuardProfilePort;
}

/** 初始化 Snail 模块 */
export function init(dataStore: FileDataStore, db: SQLiteDatabase, deps: SnailDeps) {
  const repo = new FileSnailRepository(dataStore, db);
  const adapter = new SnailAdapter(repo, deps.registry, deps.tenetPrompt, deps.skill, deps.mcp, deps.guardProfile);
  return { repo, adapter };
}
