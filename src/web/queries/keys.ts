/** query key 工厂 — queries/mutations 统一引用 */

export const queryKeys = {
  sops: {
    all: ['sops'] as const,
    list: (source?: string) => ['sops', { source }] as const,
    detail: (id: string) => ['sops', id] as const,
  },
  skills: {
    all: ['skills'] as const,
    list: () => ['skills', 'list'] as const,
    platform: () => ['skills', 'platform'] as const,
    workspace: () => ['skills', 'workspace'] as const,
    detail: (name: string) => ['skills', name] as const,
  },
  mcpServer: {
    all: ['mcp-server'] as const,
    info: ['mcp-server', 'info'] as const,
    tools: ['mcp-server', 'tools'] as const,
  },
  mcpCapability: {
    all: ['mcp-capability'] as const,
    servers: ['mcp-capability', 'servers'] as const,
    platformServers: ['mcp-capability', 'platform-servers'] as const,
    workspaceServers: ['mcp-capability', 'workspace-servers'] as const,
  },
};
