/**
 * WorkspaceManager 的 detail 构建与 assertion 辅助函数。
 *
 * 从 manager.ts 拆出以满足文件行数限制（max 400）。
 */
import type { Conversation, ConversationStore, DispatchInboxGroup, DispatchInboxPreviewItem, Issue, Stage } from "../persistence/store";
import type { ConversationDetail, ConversationDispatchState, IssueDetail, StageDetail } from "./manager-types";
import { buildBossMentionItem, sumBossPendingCount } from "./manager-events";
import { buildMessagePreview } from "../message-bus/message-events";
import { SopSnapshotReader } from "./sop-snapshot-reader";

export function buildStageDetail(store: ConversationStore, stage: Stage): StageDetail {
  const issue = store.getIssue(stage.issue_id);
  const { definition, roleDefinitions } = resolveSnapshotContext(issue, stage);
  const previousStage = store.listStagesByIssue(stage.issue_id).find((item) => item.sequence === stage.sequence - 1);
  const mapping = issue?.role_snail_mapping?.[stage.id] ?? {};
  return {
    ...stage,
    input_artifacts: previousStage?.output_artifacts ?? {},
    boss_pending_count: sumBossPendingCount(store.listConversationsByStage(stage.id), (cid) => store.listBossPendingDispatches(cid).length),
    stage_definition: definition ? {
      key: definition.key,
      title: definition.title,
      input_description: definition.input_description,
      output_description: definition.output_description,
      acceptance_focus: definition.acceptance_focus,
    } : null,
    role_definitions: roleDefinitions.map((rd) => ({
      name: rd.name,
      snail_template_id: mapping[rd.name] ?? rd.snail_template_id,
      is_primary: Boolean(rd.is_primary),
      description: rd.description,
      handbook: rd.handbook,
    })),
  };
}

export function buildIssueDetail(store: ConversationStore, issue: Issue): IssueDetail {
  const stages = store.listStagesByIssue(issue.id).map((s) => buildStageDetail(store, s));
  const conversations = store.listConversationsByIssue(issue.id);
  const currentStage = stages.find((s) => s.status === "in_progress") ?? stages[stages.length - 1] ?? null;
  return {
    ...issue,
    stages,
    current_stage: currentStage,
    conversation_count: conversations.length,
    boss_pending_count: sumBossPendingCount(conversations, (cid) => store.listBossPendingDispatches(cid).length),
  };
}

export function buildConversationDetail(store: ConversationStore, conversation: Conversation): ConversationDetail {
  return {
    ...conversation,
    message_count: store.getMessages(conversation.id).length,
    boss_pending_count: store.listBossPendingDispatches(conversation.id).length,
  };
}

export function attachDispatchGroupPreviews(
  store: ConversationStore,
  conversationId: string,
  group: DispatchInboxGroup,
): DispatchInboxGroup & { messages: DispatchInboxPreviewItem[] } {
  const messages = store.getMessagesByIds(conversationId, group.message_ids)
    .map((message) => ({
      message_id: message.id,
      from_role: message.from_role,
      role: message.role,
      preview: buildMessagePreview(message),
      created_at: message.created_at,
    }));
  return { ...group, messages };
}

export function getConversationDispatchState(store: ConversationStore, conversationId: string): ConversationDispatchState {
  const conversation = store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  return {
    dispatches: store.listDispatches(conversationId),
    inbox_groups: store.listDispatchInboxGroups(conversationId)
      .map((group) => attachDispatchGroupPreviews(store, conversationId, group)),
  };
}

export function getBossMentions(store: ConversationStore, conversationId: string) {
  const conversation = store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  return store.listBossPendingDispatches(conversationId)
    .map((dispatch) => buildBossMentionItem(dispatch, store.getMessagesByIds(conversationId, [dispatch.message_id])[0]))
    .filter((item) => item.preview || item.message_id);
}

// ── Writable assertions ──────────────────────────────────────────────

export function assertIssueWritable(store: ConversationStore, issue: Issue): void {
  if (issue.closed_at !== null) throw new Error("Closed issue is read-only");
}

export function assertIssueIdWritable(store: ConversationStore, issueId: string): void {
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  assertIssueWritable(store, issue);
}

export function assertConversationIssueWritable(store: ConversationStore, conversationId: string): void {
  const conversation = store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (conversation.owner_type === "evolution") return;
  if (!conversation.issue_id) throw new Error("Conversation issue context is incomplete");
  assertIssueIdWritable(store, conversation.issue_id);
}

export function assertStageCanAdvance(store: ConversationStore, stageId: string): void {
  const stage = store.getStage(stageId);
  if (!stage) throw new Error(`Stage not found: ${stageId}`);
  if (!Object.keys(stage.output_artifacts).length) throw new Error("Stage cannot advance without output artifacts");
}

/** Create SopSnapshotReader, returning null for old issues without snapshot. */
function safeSnapshotReader(issue: Issue | undefined): SopSnapshotReader | null {
  if (!issue) return null;
  try {
    return new SopSnapshotReader(issue.sop_snapshot);
  } catch {
    return null;
  }
}

/** Resolve snapshot reader, stage definition, and role definitions in one call. */
function resolveSnapshotContext(issue: Issue | undefined, stage: Stage) {
  const reader = safeSnapshotReader(issue);
  const hasStageDef = Boolean(stage.stage_definition_id);
  return {
    reader,
    definition: hasStageDef && reader ? reader.getStageDefinition(stage.stage_definition_id, stage.workspace_id) : null,
    roleDefinitions: hasStageDef && reader ? reader.listRoleDefinitionsByStage(stage.stage_definition_id) : [],
  };
}
