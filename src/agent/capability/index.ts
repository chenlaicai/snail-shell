export type {
  AgentCapability,
  PromptCapability,
  PromptMode,
  SkillCapability,
  SkillMode,
} from "./spec";

export { buildAgentCapability } from "./builder";
export type { CapabilityBuildInput } from "./builder";

export { buildSystemPromptFromCapability } from "./runtime-adapter";
