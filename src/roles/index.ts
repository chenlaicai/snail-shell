export { buildConversationSystemPrompt, buildConversationCapability } from "../prompt-center";
import type { StageRoleDefinition } from "../shared/types";
/** @deprecated Use StageRoleDefinition directly. Kept for backward compatibility. */
export type RoleDefinition = StageRoleDefinition;
export type { PromptBuildContext } from "../prompt-center";

/** 人类操作者角色名称——系统级常量，所有模块统一引用。 */
export const HUMAN_ROLE_NAME = "项目负责人";
