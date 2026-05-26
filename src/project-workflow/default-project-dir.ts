import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export function resolveProjectRoot(projectId: string, userSpecified?: string): string {
  if (userSpecified) {
    const abs = path.resolve(userSpecified);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      if (!stat.isDirectory()) throw new Error(`project_root is not a directory: ${abs} (project: ${projectId})`);
    } else {
      fs.mkdirSync(abs, { recursive: true });
    }
    return abs;
  }
  const defaultDir = path.join(os.homedir(), "SnailShell", "projects", projectId);
  if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}
