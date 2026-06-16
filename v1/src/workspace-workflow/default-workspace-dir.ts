import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export function resolveWorkspaceRoot(workspaceId: string, userSpecified?: string): string {
  if (userSpecified) {
    const abs = path.resolve(userSpecified);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      if (!stat.isDirectory()) throw new Error(`workspace_root is not a directory: ${abs} {workspace: ${workspaceId})`);
      assertReadWrite(abs, workspaceId);
    } else {
      fs.mkdirSync(abs, { recursive: true });
    }
    return abs;
  }
  const defaultDir = path.join(os.homedir(), "SnailShell", "workspaces", workspaceId);
  if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

function assertReadWrite(dir: string, workspaceId: string): void {
  try { fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK); }
  catch { throw new Error(`workspace_root is not readable/writable: ${dir} {workspace: ${workspaceId})`); }
}
