/**
 * Workspace Repo — 文件实现。
 *
 * 数据来源：config/workspaces.yaml + <workspace>/.snail/init.json
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import type { WorkspacesConfig, WorkspaceInitConfig } from '@/workspace/types.js';

export class WorkspaceRepo {
  private config: WorkspacesConfig | null = null;
  private initCache = new Map<string, WorkspaceInitConfig>();

  constructor(private configDir: string) {}

  /** 获取系统级工作空间配置 */
  getWorkspacesConfig(): WorkspacesConfig {
    if (!this.config) {
      const filePath = path.join(this.configDir, 'workspaces.yaml');
      const raw = fs.readFileSync(filePath, 'utf-8');
      this.config = yaml.parse(raw) as WorkspacesConfig;
    }
    return this.config;
  }

  /** 获取指定工作空间的 init.json 配置 */
  getInitConfig(workspaceRoot: string): WorkspaceInitConfig {
    const cached = this.initCache.get(workspaceRoot);
    if (cached) return cached;

    const filePath = path.join(workspaceRoot, '.snail', 'init.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(raw) as WorkspaceInitConfig;
    this.initCache.set(workspaceRoot, config);
    return config;
  }

  /** 列出所有工作空间根目录 */
  listWorkspaceRoots(): string[] {
    return this.getWorkspacesConfig().paths;
  }
}
