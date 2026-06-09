/**
 * Gate 证据类型
 *
 * 定义 Stage Gate 的验收证据结构。
 */

/** Gate 产物：AI 对某一项 checklist 的自查结果。 */
export interface StageGateArtifact {
  checklistId: string;
  status: "passed" | "failed" | "skipped";
  evidence: string;
}

/** Gate 证据：AI 准备的完整自查结果，写入 stage.gate_evidence。 */
export interface StageGateEvidence {
  items: StageGateArtifact[];
  preparedAt: string;
  preparedBy: string;
}
