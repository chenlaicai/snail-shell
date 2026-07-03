/** Gate 元数据：为错误反馈提供可操作的修复指引。
 *
 * 三层校验（auto-advance / signal-validation / snail-signal-validation）共享同一份定义，
 * 新增 gate 时只需修改此处。
 */
export const GATE_METADATA: Record<string, { description: string; check: string; doc_ref: string }> = {
  "design-01": { description: "Feature 文档的 [design-time] 章节必须已锁定", check: "确认 Feature 文档中所有标记 [design-time] 的章节已填写完成且内容非空", doc_ref: "cd-design/SKILL.md" },
  "design-02": { description: "无未解决的设计争议", check: "确认交叉审视中的所有发现已达成共识或已记录分歧信号", doc_ref: "cd-design/SKILL.md" },
  "design-04": { description: "所有 [required] 章节已填写且内容非空", check: "确认 Feature 文档中所有标记 [required] 的章节已填写", doc_ref: "cd-design/SKILL.md" },
  "design-05": { description: "用户意图锚已填写，逐字引用、修饰语完整", check: "确认用户意图锚表已填写，用户原话为逐字引用，来源有消息 ID", doc_ref: "cd-design/SKILL.md" },
  "dev-01": { description: "代码已在 worktree 中完整实现", check: "确认所有计划的代码修改已在 worktree 中完成", doc_ref: "cd-development/SKILL.md" },
  "dev-02": { description: "自检通过：业务代码按设计意图实现；测试、构建无报错", check: "运行 npm run check 确认测试和构建均通过", doc_ref: "cd-development/SKILL.md" },
  "dev-03": { description: "Feature 文档已同步更新", check: "确认 Feature 文档的 development-time 章节已更新实现记录", doc_ref: "cd-development/SKILL.md" },
  "dev-04": { description: "PR 已创建且包含完整改动摘要", check: "确认 PR 已推送到远端且描述包含改动摘要", doc_ref: "cd-development/SKILL.md" },
  "dev-06": { description: "变更完整性已验证", check: "根据 change_type 执行对应验证命令（如 npm run check），确认输出无报错", doc_ref: "cd-development/SKILL.md" },
  "rev-01": { description: "两位审查者均完成独立检视", check: "确认两位审查者的 adversarial_artifact 均已提交", doc_ref: "cd-review/SKILL.md" },
  "rev-02": { description: "所有发现项已逐条处置", check: "确认 adversarial_findings 中每项 disposition 已填写且不为 'none'", doc_ref: "cd-review/SKILL.md" },
  "rev-03": { description: "复检覆盖完整 PR diff", check: "确认 file_coverage.coverage_ratio = 1.0", doc_ref: "cd-review/SKILL.md" },
  "rev-04": { description: "特性编号格式正确", check: "确认 gate_evidence['rev-04'] 为合法特性编号（F + 8位日期 + 4位随机码）", doc_ref: "cd-shared/references/feature-numbering.md" },
};

/** 为失败的 gate ID 列表生成修复指引 */
export function buildGateFixGuidance(failedGates: string[]): Record<string, { description: string; check: string; doc_ref: string }> {
  const guidance: Record<string, { description: string; check: string; doc_ref: string }> = {};
  for (const gate of failedGates) {
    const meta = GATE_METADATA[gate];
    guidance[gate] = meta ?? { description: `Gate ${gate} 未通过`, check: `确认 gate_evidence["${gate}"] 为非空字符串`, doc_ref: "cd-shared/references/adversarial-artifact-protocol.md" };
  }
  return guidance;
}
