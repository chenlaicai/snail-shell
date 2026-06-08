/**
 * SOP 域公开 API — 接口层。
 *
 * 调用方只 import 本文件，不关心实现细节。
 * 实现在 _internal/service.ts，启动时绑定。
 */

import type {
  Sop,
  SopDefinition,
  SopSnapshot,
  StageDefinition,
  Transition,
  TransitionGuard,
  SnapshotRoleDefinition,
  ChecklistItem,
  CreateSopInput,
  UpdateSopInput,
} from '@/sop/types.js';

// ═══════════════════════════════════════════════════════════
// SopSnapshotReader — 快照查询适配器
// ═══════════════════════════════════════════════════════════

/** 展开后的角色实例（count 展开为独立实例） */
export interface ResolvedRole {
  /** 唯一 key（count=1 时与原始 key 相同，count>1 时追加序号） */
  key: string;
  /** 原始角色 key */
  base_key: string;
  /** 角色显示名称 */
  name: string;
  /** 绑定的 snail 模板 ID */
  snail_template_id: string;
  /** 是否为主角色 */
  is_primary: boolean;
  /** 实例序号（从 1 开始） */
  instance: number;
  /** 角色专属手册内容 */
  handbook?: string;
}

/**
 * SopSnapshotReader — 快照查询适配器。
 *
 * 包装一个 SopSnapshot，提供统一查询接口。
 * 所有运行时读取（阶段转移、Gate 检查、角色解析）都通过本类。
 *
 * 通过 SopService.createSnapshotReader() 创建。
 */
export class SopSnapshotReader {
  constructor(private snapshot: SopSnapshot) {
    if (!snapshot || !snapshot.sop) {
      throw new Error('SopSnapshotReader: snapshot 为空或无效');
    }
  }

  // ─── SOP 主体 ─────────────────────────────────────────

  getSop(): Sop {
    return this.snapshot.sop;
  }

  getFirstStageKey(): string {
    return this.snapshot.sop.first_stage;
  }

  getSharedHandbook(): string | undefined {
    return this.snapshot.sop.shared_handbook;
  }

  // ─── 阶段定义 ─────────────────────────────────────────

  getStageDefinition(stageKey: string): StageDefinition | undefined {
    return this.snapshot.stages.find(s => s.key === stageKey);
  }

  listStageDefinitions(): StageDefinition[] {
    return [...this.snapshot.stages].sort((a, b) => a.sequence - b.sequence);
  }

  // ─── 转移 ─────────────────────────────────────────────

  getTransitions(fromStageKey: string): Transition[] {
    return this.snapshot.transitions.filter(t => t.from_stage_key === fromStageKey);
  }

  validateTransition(
    fromStageKey: string,
    toStageKey: string,
    hasArtifacts?: (artifacts: Record<string, string>) => boolean,
  ): { valid: boolean; reason?: string } {
    const transition = this.snapshot.transitions.find(
      t => t.from_stage_key === fromStageKey && t.to_stage_key === toStageKey,
    );

    if (!transition) {
      return { valid: false, reason: `无转移路径: ${fromStageKey} → ${toStageKey}` };
    }

    if (transition.guard) {
      const guardResult = this.evaluateGuard(transition.guard, hasArtifacts);
      if (!guardResult.passed) {
        return { valid: false, reason: guardResult.reason };
      }
    }

    return { valid: true };
  }

  private evaluateGuard(
    guard: TransitionGuard,
    hasArtifacts?: (artifacts: Record<string, string>) => boolean,
  ): { passed: boolean; reason?: string } {
    if (guard.type === 'requires_artifacts') {
      if (!hasArtifacts) {
        return { passed: false, reason: '无法检查 guard：未提供 artifact 检查函数' };
      }
      if (!hasArtifacts(guard.config)) {
        return { passed: false, reason: `缺少必需的产出物: ${Object.keys(guard.config).join(', ')}` };
      }
      return { passed: true };
    }
    return { passed: true };
  }

  // ─── 角色（含 count 展开） ─────────────────────────────

  getRolesForStage(stageKey: string): ResolvedRole[] {
    const roleDefs = this.snapshot.roles.filter(r => r.stage_key === stageKey);
    return roleDefs.flatMap(def => this.expandRole(def));
  }

  getAllRoles(): ResolvedRole[] {
    return this.snapshot.roles.flatMap(def => this.expandRole(def));
  }

  getAllRoleKeys(): string[] {
    return this.getAllRoles().map(r => r.key);
  }

  private expandRole(def: SnapshotRoleDefinition): ResolvedRole[] {
    const count = def.count ?? 1;
    const roles: ResolvedRole[] = [];

    for (let i = 1; i <= count; i++) {
      roles.push({
        key: count === 1 ? def.key : `${def.key}-${i}`,
        base_key: def.key,
        name: count === 1 ? def.name : `${def.name} ${i}`,
        snail_template_id: def.snail_template_id,
        is_primary: def.is_primary,
        instance: i,
        handbook: def.handbook,
      });
    }

    return roles;
  }

  // ─── 验收 ─────────────────────────────────────────────

  getAcceptanceChecklist(stageKey: string): ChecklistItem[] {
    const stage = this.getStageDefinition(stageKey);
    return stage?.acceptance_checklist ?? [];
  }

  getAcceptanceFocus(stageKey: string): string[] {
    const stage = this.getStageDefinition(stageKey);
    return stage?.acceptance_focus ?? [];
  }
}

// ═══════════════════════════════════════════════════════════
// SopService — SOP 域服务接口
// ═══════════════════════════════════════════════════════════

/** SOP 域服务接口 */
export interface SopService {
  // ─── 查询（live template） ───────────────────────────────

  /** 列出所有可用的 SOP 定义（平台级 + workspace 级） */
  listDefinitions(): SopDefinition[];

  /** 按 ID 获取 SOP 定义 */
  getDefinition(sopId: string): SopDefinition | undefined;

  // ─── 快照 ───────────────────────────────────────────────

  /** 将 SOP 定义冻结为快照（Issue 创建时调用） */
  captureSnapshot(definition: SopDefinition): SopSnapshot;

  /** 从快照创建查询适配器（运行时阶段转移、Gate 检查、角色解析） */
  createSnapshotReader(snapshot: SopSnapshot): SopSnapshotReader;

  // ─── CRUD（SOP Center） ─────────────────────────────────

  /** 创建新的平台级 SOP（写入 YAML 文件） */
  createSop(input: CreateSopInput): SopDefinition;

  /** 更新 SOP 字段（读-改-写 YAML 文件） */
  updateSop(input: UpdateSopInput): SopDefinition;

  /**
   * 删除 SOP（删除 YAML + handbook 文件）。
   * 返回受影响的 workspace_id 列表。
   */
  deleteSop(sopId: string): string[];
}
