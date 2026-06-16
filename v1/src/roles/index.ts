export { buildConversationSystemPrompt, buildConversationCapability } from "../prompt-center";
import type { StageRoleDefinition } from "../shared/types";
/** @deprecated Use StageRoleDefinition directly. Kept for backward compatibility. */
export type RoleDefinition = StageRoleDefinition;
export type { PromptBuildContext } from "../prompt-center";
