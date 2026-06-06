/**
 * WorkspaceConfig - 工作区配置表单
 *
 * 功能：创建/编辑工作区，配置 SOP、Stage、角色、模板
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SopDto, SopDetailDto, SnailDenTemplateDto } from "../types";

// 从 SopDetailDto 中提取的 stage definition 子类型
type StageDefinition = NonNullable<SopDetailDto["stage_definitions"]>[number];
type Role = StageDefinition["roles"][number];

export function WorkspaceConfig() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [selectedSopId, setSelectedSopId] = useState("");
  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [sops, setSops] = useState<SopDto[]>([]);
  const [templates, setTemplates] = useState<SnailDenTemplateDto[]>([]);
  const [hasSnail, setHasSnail] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    // 加载 SOP 列表
    api("GET /api/sops", { query: { source: "platform" } }).then(setSops).catch(() => {});
    // 加载模板列表
    api("GET /api/snail-den").then(setTemplates).catch(() => {});
    // 初始化默认 stages
    setStages(getDefaultStages());
  }, []);

  // SOP 选择变化时加载 stage 定义
  useEffect(() => {
    if (!selectedSopId) {
      setStages(getDefaultStages());
      return;
    }
    api("GET /api/sops/:sopId", { params: { sopId: selectedSopId } })
      .then((sop) => {
        if (sop.stage_definitions?.length) {
          setStages(sop.stage_definitions);
        }
      })
      .catch(() => {});
  }, [selectedSopId]);

  // 检测 .snail 目录
  async function handleDetectSnail() {
    if (!workspaceRoot.trim()) {
      showToast("请先输入工作区根目录", true);
      return;
    }
    setDetecting(true);
    try {
      const result = await api("POST /api/workspaces/detect-snail", { body: { workspace_root: workspaceRoot.trim() } });
      setHasSnail(result.has_snail);
      showToast(result.has_snail ? "已检测到 .snail 目录" : "未检测到 .snail 目录");
    } catch (err: unknown) {
      showToast(`检测失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setDetecting(false);
  }

  // 提交创建
  async function handleSubmit() {
    if (!name.trim()) { showToast("名称不能为空", true); return; }
    if (!workspaceRoot.trim()) { showToast("工作区根目录不能为空", true); return; }
    try {
      const payload = {
        name: name.trim(),
        summary: summary.trim(),
        workspace_root: workspaceRoot.trim(),
        sop_id: selectedSopId || undefined,
        role_bindings: hasSnail ? {} : extractRoleBindings(stages),
        load_from_snail: hasSnail,
      };
      const result = await api("POST /api/workspaces", { body: payload });
      showToast("工作区已创建");
      navigate(`/ws/${result.workspace.id}`);
    } catch (err: unknown) {
      showToast(`创建工作区失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // 添加 Stage
  function addStage() {
    setStages((prev) => [
      ...prev,
      {
        key: `stage-${prev.length + 1}`,
        title: "",
        sequence: prev.length + 1,
        input_description: "",
        output_description: "",
        roles: [{ key: "role-1", name: "", description: "", is_primary: true, snail_template_id: "", handbook: "" }],
      },
    ]);
  }

  // 更新 Stage
  function updateStage(index: number, updates: Partial<StageDefinition>) {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  // 删除 Stage
  function removeStage(index: number) {
    setStages((prev) => prev.filter((_, i) => i !== index));
  }

  // 添加 Role
  function addRole(stageIndex: number) {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIndex
          ? { ...s, roles: [...s.roles, { key: `role-${s.roles.length + 1}`, name: "", description: "", is_primary: false, snail_template_id: "", handbook: "" }] }
          : s
      )
    );
  }

  // 更新 Role
  function updateRole(stageIndex: number, roleIndex: number, updates: Partial<Role>) {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIndex
          ? { ...s, roles: s.roles.map((r, j) => (j === roleIndex ? { ...r, ...updates } : r)) }
          : s
      )
    );
  }

  // 删除 Role
  function removeRole(stageIndex: number, roleIndex: number) {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIndex
          ? { ...s, roles: s.roles.filter((_, j) => j !== roleIndex) }
          : s
      )
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="workspace-config">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">新建工作区</span>
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" onClick={() => navigate("/")}>取消</Button>
            <Button onClick={handleSubmit}>创建工作区</Button>
          </div>
        </div>

        <div className="p-6 overflow-auto flex-1" style={{ maxWidth: 720 }}>
          {/* 基本信息 */}
          <section style={{ marginBottom: "var(--space-xl)" }}>
            <h3 style={{ marginBottom: "var(--space-md)" }}>基本信息</h3>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>名称 *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="工作区名称" />
            </div>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>摘要</label>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="可选摘要" rows={2} />
            </div>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: "var(--font-size-sm)" }}>工作区根目录 *</label>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <Input value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} placeholder="绝对路径，如 /Users/you/project" style={{ flex: 1 }} />
                <Button variant="outline" onClick={handleDetectSnail} disabled={detecting}>
                  {detecting ? "检测中..." : "检测 .snail"}
                </Button>
              </div>
              {hasSnail && <div style={{ marginTop: 4, fontSize: "var(--font-size-xs)", color: "var(--color-accent-cyan)" }}>已检测到 .snail 目录，将从文件加载配置</div>}
            </div>
          </section>

          {/* SOP 选择 */}
          {!hasSnail && (
            <section style={{ marginBottom: "var(--space-xl)" }}>
              <h3 style={{ marginBottom: "var(--space-md)" }}>SOP 模板</h3>
              <select
                value={selectedSopId}
                onChange={(e) => setSelectedSopId(e.target.value)}
                style={{ width: "100%", padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-default)", background: "var(--color-bg-input)", color: "var(--color-text-primary)" }}
              >
                <option value="">自定义（手动编辑 Stage）</option>
                {sops.map((sop) => (
                  <option key={sop.id} value={sop.id}>{sop.name}</option>
                ))}
              </select>
            </section>
          )}

          {/* Stage 定义 */}
          {!hasSnail && (
            <section>
              <h3 style={{ marginBottom: "var(--space-md)" }}>阶段定义</h3>
              {stages.map((stage, stageIndex) => (
                <div key={stageIndex} style={{ border: "1px solid var(--color-border-muted)", borderRadius: "var(--radius-sm)", padding: "var(--space-md)", marginBottom: "var(--space-md)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)" }}>
                    <Input
                      value={stage.title}
                      onChange={(e) => updateStage(stageIndex, { title: e.target.value })}
                      placeholder="阶段标题"
                      style={{ flex: 1, marginRight: "var(--space-sm)" }}
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeStage(stageIndex)}>删除</Button>
                  </div>
                  <div style={{ display: "grid", gap: "var(--space-sm)", gridTemplateColumns: "1fr 1fr", marginBottom: "var(--space-sm)" }}>
                    <Input value={stage.key} onChange={(e) => updateStage(stageIndex, { key: e.target.value })} placeholder="阶段 key" />
                    <Input value={String(stage.sequence)} onChange={(e) => updateStage(stageIndex, { sequence: Number(e.target.value) })} placeholder="序号" type="number" />
                  </div>
                  <Textarea value={stage.input_description} onChange={(e) => updateStage(stageIndex, { input_description: e.target.value })} placeholder="输入说明" rows={1} style={{ marginBottom: "var(--space-sm)" }} />
                  <Textarea value={stage.output_description} onChange={(e) => updateStage(stageIndex, { output_description: e.target.value })} placeholder="输出说明" rows={1} style={{ marginBottom: "var(--space-sm)" }} />

                  {/* 角色列表 */}
                  <div style={{ marginTop: "var(--space-md)" }}>
                    <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, marginBottom: "var(--space-xs)" }}>角色</div>
                    {stage.roles.map((role, roleIndex) => (
                      <div key={roleIndex} style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-xs)", alignItems: "center" }}>
                        <Input value={role.name} onChange={(e) => updateRole(stageIndex, roleIndex, { name: e.target.value })} placeholder="角色名" style={{ flex: 1 }} />
                        <select
                          value={role.snail_template_id}
                          onChange={(e) => updateRole(stageIndex, roleIndex, { snail_template_id: e.target.value })}
                          style={{ padding: "var(--space-xs)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-default)", background: "var(--color-bg-input)", color: "var(--color-text-primary)", fontSize: "var(--font-size-xs)" }}
                        >
                          <option value="">选择模板</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <label style={{ fontSize: "var(--font-size-xs)", display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="checkbox" checked={role.is_primary} onChange={(e) => updateRole(stageIndex, roleIndex, { is_primary: e.target.checked })} />
                          主
                        </label>
                        <Button variant="ghost" size="sm" onClick={() => removeRole(stageIndex, roleIndex)}>×</Button>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => addRole(stageIndex)}>+ 添加角色</Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" onClick={addStage}>+ 新增 Stage</Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function getDefaultStages(): StageDefinition[] {
  return [
    {
      key: "design",
      title: "需求对齐与设计",
      sequence: 1,
      input_description: "用户需求描述。",
      output_description: "锁定的 Feature 文档。",
      roles: [{ key: "architect", name: "架构师", description: "负责需求对齐与设计", is_primary: true, snail_template_id: "", handbook: "" }],
    },
    {
      key: "development",
      title: "研发实现",
      sequence: 2,
      input_description: "锁定的 Feature 文档。",
      output_description: "按设计方案完成实现、自检，并提交可检视 PR。",
      roles: [{ key: "developer", name: "开发者", description: "负责按设计方案实现", is_primary: true, snail_template_id: "", handbook: "" }],
    },
    {
      key: "review",
      title: "PR 检视",
      sequence: 3,
      input_description: "上一阶段产出的 PR 交付记录。",
      output_description: "两位审查者对抗性检视 PR。",
      roles: [
        { key: "developer", name: "开发者", description: "负责回应检视意见并修复代码", is_primary: true, snail_template_id: "", handbook: "" },
        { key: "reviewer", name: "审查者", description: "负责对抗性代码检视", is_primary: false, snail_template_id: "", handbook: "" },
      ],
    },
  ];
}

function extractRoleBindings(stages: StageDefinition[]): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const stage of stages) {
    for (const role of stage.roles) {
      if (role.snail_template_id) {
        bindings[role.name] = role.snail_template_id;
      }
    }
  }
  return bindings;
}
