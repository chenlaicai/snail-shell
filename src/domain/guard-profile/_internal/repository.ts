import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";
import type { GuardProfile } from "@domain/guard-profile/model";
import type { FileDataStore } from "@infra/file-data-store";

/** Guard Profile 持久层接口 */
export interface GuardProfileRepository {
  findByWorkspace(workspace: Workspace): GuardProfile;
}

/**
 * Guard Profile 文件存储实现。
 *
 * 读取平台级 config/guard-profile.json 和 workspace 级 <ws>/.snail/guard-profile.json。
 * 合并策略：workspace 优先（workspace 的配置覆盖平台的配置）。
 */
export class FileGuardProfileRepository implements GuardProfileRepository {
  private static readonly FILE = "guard-profile.json";

  private platformProfile: GuardProfile | null = null;

  constructor(private dataStore: FileDataStore) {
    this.loadPlatformProfile();
  }

  findByWorkspace(workspace: Workspace): GuardProfile {
    const platform = this.platformProfile ?? { allow: [], deny: [] };
    const wsProfile = this.loadWorkspaceProfile(workspace);

    // 合并：workspace 优先
    return {
      allow: [...new Set([...platform.allow, ...(wsProfile?.allow ?? [])])],
      deny: [...new Set([...platform.deny, ...(wsProfile?.deny ?? [])])],
      scope: Scope.Workspace,
      workspace,
    };
  }

  private loadPlatformProfile(): void {
    const raw = this.dataStore.readJson<{ allow?: string[]; deny?: string[] }>(FileGuardProfileRepository.FILE);
    if (raw) {
      this.platformProfile = {
        allow: raw.allow ?? [],
        deny: raw.deny ?? [],
        scope: Scope.Platform,
      };
    }
  }

  private loadWorkspaceProfile(workspace: Workspace): { allow?: string[]; deny?: string[] } | null {
    const wsStore = this.dataStore.workspace(workspace.path);
    return wsStore.readJson<{ allow?: string[]; deny?: string[] }>(FileGuardProfileRepository.FILE);
  }
}
