/**
 * SOP 域服务实现。
 *
 * 外部禁止 import，通过 sop/api.ts 接口访问。
 * 启动时在 main.ts 中实例化并注入。
 */

import type { SopService } from '@/sop/api.js';
import { SopSnapshotReader } from '@/sop/api.js';
import type {
  SopDefinition,
  SopSnapshot,
  CreateSopInput,
  UpdateSopInput,
} from '@/sop/types.js';
import type { SopRepo } from '@/db/sop.repo.js';

export class SopServiceImpl implements SopService {
  constructor(private repo: SopRepo) {}

  // ─── 查询 ─────────────────────────────────────────────

  listDefinitions(): SopDefinition[] {
    return this.repo.listAll();
  }

  getDefinition(sopId: string): SopDefinition | undefined {
    return this.repo.getById(sopId);
  }

  // ─── 快照 ─────────────────────────────────────────────

  captureSnapshot(definition: SopDefinition): SopSnapshot {
    return {
      sop: { ...definition.sop },
      stages: definition.stages.map(s => ({ ...s })),
      transitions: definition.transitions.map(t => ({ ...t })),
      roles: definition.roles.map(r => ({ ...r })),
      captured_at: new Date().toISOString(),
    };
  }

  createSnapshotReader(snapshot: SopSnapshot): SopSnapshotReader {
    return new SopSnapshotReader(snapshot);
  }

  // ─── CRUD ─────────────────────────────────────────────

  createSop(input: CreateSopInput): SopDefinition {
    return this.repo.createSop(input);
  }

  updateSop(input: UpdateSopInput): SopDefinition {
    return this.repo.updateSop(input);
  }

  deleteSop(sopId: string): string[] {
    return this.repo.deleteSop(sopId);
  }
}
