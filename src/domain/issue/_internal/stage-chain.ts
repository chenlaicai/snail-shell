import type { Stage } from "@domain/issue/model";

export const MAX_CHAIN_DEPTH = 20;

/**
 * 通过 from_stage_id 回溯构建阶段链（防环、限深）。
 * 返回从最早到当前的正序数组。
 */
export function buildStageChain(stages: Stage[], currentStageId: string): Stage[] {
  const byId = new Map(stages.map(s => [s.id, s]));
  const chain: Stage[] = [];
  const visited = new Set<string>();
  let cursor: Stage | undefined = byId.get(currentStageId);
  while (cursor && chain.length < MAX_CHAIN_DEPTH) {
    if (visited.has(cursor.id)) break;
    visited.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.from_stage_id ? byId.get(cursor.from_stage_id) : undefined;
  }
  chain.reverse();
  return chain;
}

/**
 * 检测是否为重新进入：stage chain 中存在同 key 的更早实例。
 */
export function isStageReEntry(stages: Stage[], stageId: string): boolean {
  const chain = buildStageChain(stages, stageId);
  const target = chain.find(s => s.id === stageId);
  if (!target) return false;
  return chain.some(s => s.id !== stageId && s.key === target.key);
}
