import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { SopPort } from "@domain/sop/port";
import type { Sop, StageDefinition, Transition } from "@domain/sop/model";
import { validateSop } from "@domain/sop/_internal/repository";
import { Scope } from "@domain/workspace/model";
import type { Workspace } from "@domain/workspace/model";

export function createSopCreatorServer(sopPort: SopPort, workspaces: Workspace[]): MCPServerConfig {
  return {
    name: "snail-sop-creator",
    version: "1.0.0",
    tools: [
      createSopTool(sopPort, workspaces),
    ],
  };
}

interface SopInput {
  key: string; name: string; description: string | null; sharedSkill: string | null;
  stagesInput: Array<Record<string, unknown>>; transitionsInput: Array<Record<string, unknown>>;
  workspacePath: string | undefined; workspaces: Workspace[];
}

function buildSopFromInput(input: SopInput): Sop {
  const { key, name, description, sharedSkill, stagesInput, transitionsInput, workspacePath, workspaces } = input;
  const stageDefinitions: StageDefinition[] = stagesInput.map(s => ({
    key: s.key as string, title: s.title as string, description: (s.description as string) ?? "",
    gate_ids: Array.isArray(s.gate_ids) ? (s.gate_ids as string[]) : null,
    roles: ((s.roles as Array<Record<string, unknown>>) ?? []).map(r => ({
      key: r.key as string, name: r.name as string, description: (r.description as string) ?? "",
      is_primary: (r.is_primary as boolean) ?? false, count: (r.count as number) ?? 1,
      skill: (r.skill as string) ?? null, prohibition: (r.prohibition as string) ?? null, self_check: (r.self_check as string) ?? null,
    })),
  }));
  const transitions: Transition[] = transitionsInput.map(t => ({ from: t.from as string, to: t.to as string, guard: (t.guard as string) ?? null }));
  const workspace = workspacePath ? workspaces.find(w => w.path === workspacePath) : undefined;
  return { key, name, description, shared_skill: sharedSkill, stage_definitions: stageDefinitions, transitions, scope: workspace ? Scope.Workspace : Scope.Platform, workspace };
}

const CREATE_SOP_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string", description: "SOP 唯一标识（如 my-custom-flow）" },
    name: { type: "string", description: "显示名称" },
    description: { type: "string", description: "描述" },
    shared_skill: { type: "string", description: "共享 skill 名称（可选）" },
    stages: {
      type: "array", description: "阶段定义列表",
      items: {
        type: "object",
        properties: {
          key: { type: "string" }, title: { type: "string" }, description: { type: "string" },
          gate_ids: { type: "array", items: { type: "string" } },
          roles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" }, name: { type: "string" }, description: { type: "string" },
                is_primary: { type: "boolean" }, count: { type: "number" },
                skill: { type: "string" }, prohibition: { type: "string" }, self_check: { type: "string" },
              },
              required: ["key", "name"],
            },
          },
        },
        required: ["key", "title"],
      },
    },
    transitions: {
      type: "array", description: "转移边列表",
      items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, guard: { type: "string" } }, required: ["from", "to"] },
    },
    workspace_path: { type: "string", description: "工作区路径（创建 workspace 级 SOP 时指定）" },
  },
  required: ["key", "name", "stages"],
};

function createSopTool(sopPort: SopPort, workspaces: Workspace[]): MCPTool {
  return {
    name: "create_sop",
    description: "动态创建 SOP。Agent 可定义新的 SOP 流程，系统校验结构正确性（S1-S6）。创建后的 SOP 可被子 issue 引用。",
    inputSchema: CREATE_SOP_SCHEMA,
    handler: async (params) => {
      const key = params.key as string;
      const name = params.name as string;
      const description = (params.description as string) ?? null;
      const sharedSkill = (params.shared_skill as string) ?? null;
      const stagesInput = params.stages as Array<Record<string, unknown>>;
      const transitionsInput = (params.transitions as Array<Record<string, unknown>>) ?? [];
      const workspacePath = params.workspace_path as string | undefined;

      if (!key || !name || !stagesInput || stagesInput.length === 0) {
        throw new Error("Missing required fields: key, name, stages (at least 1)");
      }

      const sop = buildSopFromInput({ key, name, description, sharedSkill, stagesInput, transitionsInput, workspacePath, workspaces });

      const validationErrors = validateSop(sop);
      const blockers = validationErrors.filter(e => e.level === "block");
      if (blockers.length > 0) {
        return { sop_key: null, validation_errors: blockers.map(e => `${e.rule}: ${e.message}`), validation_warnings: [] };
      }

      const warnings = validationErrors.filter(e => e.level === "warn").map(e => `${e.rule}: ${e.message}`);

      try {
        const created = sopPort.create(sop);
        return { sop_key: created.key, validation_errors: [], validation_warnings: warnings };
      } catch (err) {
        return { sop_key: null, validation_errors: [err instanceof Error ? err.message : String(err)], validation_warnings: [] };
      }
    },
  };
}
