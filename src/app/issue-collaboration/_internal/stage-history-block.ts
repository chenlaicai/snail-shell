import type { Stage } from "@domain/issue/model";
import type { StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import { buildStageChain, isStageReEntry } from "@domain/issue/_internal/stage-chain";

const truncateForUI = (text: string, maxLen = 200) => text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
const DISPLAY_LIMIT = 5;
const MESSAGES_PER_STAGE = 2;

/** 构建单个阶段的展示行（含前序阶段的消息摘要） */
function buildStageEntry(
  stage: Stage,
  index: number,
  omitted: number,
  isCurrent: boolean,
  isReEntry: boolean,
  messagePort: MessagePort,
): string[] {
  const lines: string[] = [];
  const label = isCurrent
    ? (isReEntry ? `(${stage.key}) ${stage.title} — ${stage.entered_at} (当前 · 重新进入)` : `(${stage.key}) ${stage.title} — ${stage.entered_at} (当前)`)
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
  const allStages = stagePort.listStages(currentStage.issue_id) ?? [];
  const chain = buildStageChain(allStages, currentStage.id);
  const omitted = chain.length > DISPLAY_LIMIT ? chain.length - DISPLAY_LIMIT : 0;
  const displayChain = omitted > 0 ? chain.slice(omitted) : chain;
  const reEntry = isStageReEntry(allStages, currentStage.id);
  const lines: string[] = [];
  if (omitted > 0) lines.push(`... (${omitted} 个更早阶段)`);
  for (const s of displayChain) {
    lines.push(...buildStageEntry(s, lines.length, omitted, s.id === currentStage.id, reEntry, messagePort));
  }
  return `## 阶段历史\n${lines.join("\n")}`;
}
