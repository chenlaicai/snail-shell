// GET /api/meta/prompts — prompt document with relativized filePath
export type PromptDto = {
  id: string;
  title: string;
  layer: "platform" | "sop" | "workspace";
  priority: number;
  when?: {
    runtimes?: string[];
    stage_types?: string[];
    roles?: string[];
    conversation_kinds?: string[];
    owner_types?: string[];
  };
  stability: "static" | "dynamic";
  content: string;
  filePath: string; // enrichment: cwd prefix stripped
};

// GET /api/meta/skills — skill definition with relativized filePath
export type SkillDto = {
  name: string;
  description: string;
  filePath: string; // enrichment: cwd prefix stripped
  content: string;
  title: string;
  source: "platform" | "workspace";
};

// GET /api/snail-den — snail den template
export type SnailDenTemplateDto = {
  id: string;
  name: string;
  runtime: string;
  model: string;
  contextWindow?: number;
  contextProvider: "shell" | "agent";
  invocationTimeoutMs?: number;
};

// GET /api/meta/mcps — MCP server with builtin flag
export type McpServerDto = {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  builtin: boolean; // enrichment: true if platform-registered
};

// GET /api/roles — role definition
export type RoleDto = {
  id: string;
  stage_definition_id: string;
  key: string;
  name: string;
  snail_template_id: string | null;
  is_primary: number;
  count: number;
  description: string;
  handbook: string | null;
};
