import type { AgentRuntime } from "../agent/interface";

export interface SnailPromptDefinition {
  identity: string;
  principles: string[];
  output_expectations: string[];
}

export interface SnailDefinition {
  name: string;
  description: string;
  runtime: AgentRuntime;
  kind?: "human" | "agent";
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
  system_prompt: SnailPromptDefinition;
}

export type SnailDefinitionMap = Record<string, SnailDefinition>;
