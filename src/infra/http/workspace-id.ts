import type { Workspace } from "@domain/workspace/model";

export function encodeWorkspaceId(workspacePath: string): string {
  return Buffer.from(workspacePath, "utf8").toString("base64url");
}

export function decodeWorkspaceId(workspaceId: string): string {
  return Buffer.from(workspaceId, "base64url").toString("utf8");
}

export function toWorkspaceDto(workspace: Workspace) {
  return {
    id: encodeWorkspaceId(workspace.path),
    path: workspace.path,
    summary: workspace.summary,
  };
}
