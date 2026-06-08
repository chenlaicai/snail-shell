/**
 * API 端点类型契约 — 编译期完整描述每个 endpoint 的输入输出
 */

import type { SopDefinition } from "@/sop/types.js";
import type { McpServerInfo, McpToolDefinition } from "@/mcp-server/types.js";
import type { McpServerConfig } from "@/mcp-capability/types.js";

export interface ApiEndpointDef<
  TParams = never,
  TQuery = never,
  TBody = never,
  TResponse = undefined,
> {
  params: TParams;
  query: TQuery;
  body: TBody;
  response: TResponse;
}

export type ApiEndpoints = {
  // ── SOP ────────────────────────────────────────────────

  "GET /api/sops": ApiEndpointDef<
    never,
    { source?: "platform" | "workspace" },
    never,
    SopDefinition[]
  >;

  "GET /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    never,
    SopDefinition
  >;

  "POST /api/sops": ApiEndpointDef<
    never,
    never,
    {
      key: string;
      name: string;
      description?: string;
      first_stage: string;
      shared_handbook?: string;
      stages: Array<{
        key: string;
        title: string;
        sequence: number;
        input_description?: string;
        output_description?: string;
        acceptance_focus?: string[];
        acceptance_checklist?: Array<{ id: string; description: string }>;
        roles: Array<{
          key: string;
          name: string;
          description?: string;
          is_primary?: boolean;
          count?: number;
          handbook?: string;
        }>;
      }>;
      transitions?: Array<{
        from: string;
        to: string;
        guard?: { type: "requires_artifacts"; config: Record<string, string> };
      }>;
    },
    SopDefinition
  >;

  "PATCH /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    {
      name?: string;
      description?: string;
      first_stage?: string;
      shared_handbook?: string;
    },
    SopDefinition
  >;

  "DELETE /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    never,
    { affected_workspaces: string[] }
  >;

  // ── MCP Server ──────────────────────────────────────────

  "GET /api/mcp-server/info": ApiEndpointDef<never, never, never, McpServerInfo>;

  "GET /api/mcp-server/tools": ApiEndpointDef<never, never, never, McpToolDefinition[]>;

  // ── MCP Capability ──────────────────────────────────────

  "GET /api/mcp-capability/servers": ApiEndpointDef<never, never, never, McpServerConfig[]>;

  "GET /api/mcp-capability/platform-servers": ApiEndpointDef<never, never, never, McpServerConfig[]>;

  "GET /api/mcp-capability/workspace-servers": ApiEndpointDef<never, never, never, McpServerConfig[]>;
};
