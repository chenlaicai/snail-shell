import type { Stage } from "@domain/issue/model";
import type { StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";

const truncateForUI = (text: string, maxLen = 200) => text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
const DISPLAY_LIMIT = 5;
const MAX_CHAIN_DEPTH = 20;
const MESSAGES_PER_STAGE = 2;

/** 通过 from_stage_id 回溯构建阶段链 */
function buildStageChain(stagePort: StagePort, currentStage: Stage): Stage[] {
  const chain: Stage[] = [];
  const visited = new Set<string>();
  let cursor: Stage | undefined = currentStage;
  while (cursor && chain.length < MAX_CHAIN_DEPTH) {
    if (visited.has(cursor.id)) break;
    visited.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.from_stage_id ? stagePort.findStage(cursor.from_stage_id) ?? undefined : undefined;
  }
  chain.reverse();
  return chain;
}

/** 构建单个阶段的展示行（含前序阶段的消息摘要） */
function buildStageEntry(
  stage: Stage,
  index: number,
  omitted: number,
  isCurrent: boolean,
  hasPredecessor: boolean,
  messagePort: MessagePort,
): string[] {
  const lines: string[] = [];
  const label = isCurrent
    ? (hasPredecessor ? `(${stage.key}) ${stage.title} — ${stage.entered_at} (当前 · 重新进入)` : `(${stage.key}) ${stage.title} — ${stage.entered_at} (当前)`)
    : `(${stage.key}) ${stage.title} — ${stage.entered_at}`;
  lines.push(`${index + omitted + 1}. ${label}`);
  if (!isCurrent) {
    for (const msg of messagePort.listMessages(stage.id, MESSAGES_PER_STAGE)) {
      const ctx = messagePort.getContext(msg.id);
      if (!ctx?.context) continue;
      lines.push(`   - ${msg.from_speaker || "system"}: ${truncateForUI(ctx.context)}`);
    }
  }
  return lines;
}

/** 通过 from_stage_id 回溯构建阶段链，展示前序阶段的最近消息 */
export function buildStageHistoryBlock(stagePort: StagePort, messagePort: MessagePort, currentStage: Stage): string {
  const chain = buildStageChain(stagePort, currentStage);
  const omitted = chain.length > DISPLAY_LIMIT ? chain.length - DISPLAY_LIMIT : 0;
  const displayChain = omitted > 0 ? chain.slice(omitted) : chain;
  const hasPredecessor = chain.some(s => s.id !== currentStage.id && s.key === currentStage.key);
  const lines: string[] = [];
  if (omitted > 0) lines.push(`... (${omitted} 个更早阶段)`);
  for (const s of displayChain) {
    lines.push(...buildStageEntry(s, lines.length, omitted, s.id === currentStage.id, hasPredecessor, messagePort));
  }
  return `## 阶段历史\n${lines.join("\n")}`;
}

/** 检测是否为重新进入：stage chain 中存在同 key 的更早实例 */
export function isStageReEntry(stagePort: StagePort, stage: Stage): boolean {
  const visited = new Set<string>();
  let cursor: Stage | undefined = stage;
  while (cursor) {
    if (visited.has(cursor.id)) break;
    visited.add(cursor.id);
    if (cursor.id !== stage.id && cursor.key === stage.key) return true;
    cursor = cursor.from_stage_id ? stagePort.findStage(cursor.from_stage_id) ?? undefined : undefined;
  }
  return false;
}
