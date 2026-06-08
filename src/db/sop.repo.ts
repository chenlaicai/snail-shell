/**
 * SOP Repo — 文件实现。
 *
 * 数据来源：config/sop/*.yaml（平台级）+ <workspace>/.snail/config/sop/*.yaml（workspace 级）
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import type {
  SopDefinition,
  Sop,
  StageDefinition,
  Transition,
  SnapshotRoleDefinition,
  CreateSopInput,
  UpdateSopInput,
} from '@/sop/types.js';

export class SopRepo {
  private platformCache: SopDefinition[] | null = null;

  constructor(
    private configDir: string,
    private workspaceRoot?: string,
  ) {}

  /** 列出所有可用的 SOP 定义（平台级 + workspace 级） */
  listAll(): SopDefinition[] {
    const platform = this.listPlatform();
    const workspace = this.workspaceRoot ? this.listWorkspace() : [];
    return [...platform, ...workspace];
  }

  /** 按 ID 获取 SOP 定义 */
  getById(id: string): SopDefinition | undefined {
    return this.listAll().find(def => def.sop.id === id);
  }

  /** 列出平台级 SOP */
  listPlatform(): SopDefinition[] {
    if (!this.platformCache) {
      this.platformCache = this.loadFromDir(path.join(this.configDir, 'sop'));
    }
    return this.platformCache;
  }

  /** 列出 workspace 级 SOP */
  listWorkspace(): SopDefinition[] {
    if (!this.workspaceRoot) return [];
    const dir = path.join(this.workspaceRoot, '.snail', 'config', 'sop');
    return this.loadFromDir(dir);
  }

  // ─── CRUD ─────────────────────────────────────────────

  /** 创建平台级 SOP（写入 YAML 文件） */
  createSop(input: CreateSopInput): SopDefinition {
    const sopDir = path.join(this.configDir, 'sop', input.key);
    fs.mkdirSync(sopDir, { recursive: true });

    const yamlData = {
      name: input.name,
      description: input.description,
      first_stage: input.first_stage,
      shared_handbook: input.shared_handbook,
      stage_definitions: input.stages.map(s => ({
        key: s.key,
        title: s.title,
        sequence: s.sequence,
        input_description: s.input_description,
        output_description: s.output_description,
        acceptance_focus: s.acceptance_focus,
        acceptance_checklist: s.acceptance_checklist,
        roles: s.roles.map(r => ({
          key: r.key,
          name: r.name,
          description: r.description,
          is_primary: r.is_primary ?? false,
          count: r.count ?? 1,
          handbook: r.handbook,
        })),
      })),
      transitions: input.transitions.map(t => ({
        from: t.from,
        to: t.to,
        guard: t.guard,
      })),
    };

    const filePath = path.join(sopDir, `${input.key}.yaml`);
    fs.writeFileSync(filePath, yaml.stringify(yamlData), 'utf-8');

    this.platformCache = null;
    return this.parseYaml(filePath);
  }

  /** 更新 SOP（读-改-写 YAML 文件） */
  updateSop(input: UpdateSopInput): SopDefinition {
    const existing = this.getById(input.sop_id);
    if (!existing) throw new Error(`SOP not found: ${input.sop_id}`);

    const filePath = this.findSopFilePath(input.sop_id);
    if (!filePath) throw new Error(`SOP file not found: ${input.sop_id}`);

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.parse(raw);

    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.first_stage !== undefined) data.first_stage = input.first_stage;
    if (input.shared_handbook !== undefined) data.shared_handbook = input.shared_handbook;
    if (input.stages !== undefined) {
      data.stage_definitions = input.stages.map(s => ({
        key: s.key,
        title: s.title,
        sequence: s.sequence,
        input_description: s.input_description,
        output_description: s.output_description,
        acceptance_focus: s.acceptance_focus,
        acceptance_checklist: s.acceptance_checklist,
        roles: s.roles.map(r => ({
          key: r.key,
          name: r.name,
          description: r.description,
          is_primary: r.is_primary ?? false,
          count: r.count ?? 1,
          handbook: r.handbook,
        })),
      }));
    }
    if (input.transitions !== undefined) {
      data.transitions = input.transitions.map(t => ({
        from: t.from,
        to: t.to,
        guard: t.guard,
      }));
    }

    fs.writeFileSync(filePath, yaml.stringify(data), 'utf-8');
    this.platformCache = null;
    return this.parseYaml(filePath);
  }

  /** 删除 SOP（删除目录及关联文件） */
  deleteSop(sopId: string): string[] {
    const filePath = this.findSopFilePath(sopId);
    if (!filePath) throw new Error(`SOP file not found: ${sopId}`);

    const sopDir = path.dirname(filePath);
    fs.rmSync(sopDir, { recursive: true, force: true });
    this.platformCache = null;

    // 返回受影响的 workspace（adopted_sop_ids 引用了该 SOP）
    // TODO: 需要 workspace repo 支持查询 adopted_sop_ids
    return [];
  }

  private findSopFilePath(sopId: string): string | null {
    // 搜索平台级
    const platformDir = path.join(this.configDir, 'sop');
    const found = this.findYamlInDir(platformDir, sopId);
    if (found) return found;

    // 搜索 workspace 级
    if (this.workspaceRoot) {
      const wsDir = path.join(this.workspaceRoot, '.snail', 'config', 'sop');
      return this.findYamlInDir(wsDir, sopId);
    }
    return null;
  }

  private findYamlInDir(dir: string, sopId: string): string | null {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const yamlPath = path.join(dir, entry.name, `${entry.name}.yaml`);
      const ymlPath = path.join(dir, entry.name, `${entry.name}.yml`);
      if (fs.existsSync(yamlPath)) {
        const def = this.parseYaml(yamlPath);
        if (def.sop.id === sopId) return yamlPath;
      }
      if (fs.existsSync(ymlPath)) {
        const def = this.parseYaml(ymlPath);
        if (def.sop.id === sopId) return ymlPath;
      }
    }
    return null;
  }

  private loadFromDir(dir: string): SopDefinition[] {
    if (!fs.existsSync(dir)) return [];
    const results: SopDefinition[] = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // 目录结构: <key>/<key>.yaml
        const yamlPath = path.join(dir, entry.name, `${entry.name}.yaml`);
        const ymlPath = path.join(dir, entry.name, `${entry.name}.yml`);
        if (fs.existsSync(yamlPath)) {
          results.push(this.parseYaml(yamlPath));
        } else if (fs.existsSync(ymlPath)) {
          results.push(this.parseYaml(ymlPath));
        }
      } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
        // 兼容旧格式: 直接放 YAML 文件
        results.push(this.parseYaml(path.join(dir, entry.name)));
      }
    }

    return results;
  }

  private parseYaml(filePath: string): SopDefinition {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.parse(raw);
    const key = path.basename(filePath, path.extname(filePath));

    const sop: Sop = {
      id: data.id ?? key,
      source: filePath.includes('.snail') ? 'workspace' : 'platform',
      source_ref: null,
      key,
      name: data.name ?? key,
      first_stage: data.stage_definitions?.[0]?.key ?? '',
      shared_handbook: data.shared_handbook,
    };

    const stages: StageDefinition[] = (data.stage_definitions ?? []).map((s: Record<string, unknown>, i: number) => ({
      id: `${sop.id}-${s.key}`,
      sop_id: sop.id,
      key: s.key as string,
      title: (s.title as string) ?? s.key as string,
      sequence: (s.sequence as number) ?? i + 1,
      input_description: s.input_description as string | undefined,
      output_description: s.output_description as string | undefined,
      acceptance_focus: s.acceptance_focus as string[] | undefined,
      acceptance_checklist: (s.acceptance_checklist as Array<Record<string, unknown>>)?.map(c => ({
        id: c.id as string,
        description: c.description as string,
      })),
    }));

    const transitions: Transition[] = (data.transitions ?? []).map((t: Record<string, unknown>) => ({
      id: `${sop.id}-${t.from}-${t.to}`,
      sop_id: sop.id,
      from_stage_key: t.from as string,
      to_stage_key: t.to as string,
      guard: t.guard as Transition['guard'],
    }));

    const roles: SnapshotRoleDefinition[] = (data.stage_definitions ?? []).flatMap(
      (s: Record<string, unknown>) => {
        const stageKey = s.key as string;
        return ((s.roles as Array<Record<string, unknown>>) ?? []).map((r: Record<string, unknown>) => ({
          id: `${sop.id}-${stageKey}-${r.key}`,
          stage_key: stageKey,
          key: r.key as string,
          name: (r.name as string) ?? r.key as string,
          snail_template_id: (r.snail_template_id as string) ?? '',
          is_primary: (r.is_primary as boolean) ?? false,
          count: (r.count as number) ?? 1,
          handbook: r.handbook as string | undefined,
        }));
      },
    );

    return { sop, stages, transitions, roles };
  }
}
