import { EventEmitter } from "events";
import type { SnailAgentResolver } from "../agent/resolver";
import type {
  ConversationStore,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
  EvolutionItemSearchResult,
  EvolutionItemWithConversation,
  Issue,
  MessageWithEvents,
  RoleName,
  Stage,
  UpdateEvolutionItemInput,
} from "../persistence/store";
import type { BossMentionItem, ConversationDetail, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, IssueDetail, ConversationRecentMessagesSnapshot, WorkspaceDetail, WorkspaceManagerDeps, WorkspaceSummary, StageDetail, StageSuggestion } from "./manager-types";
import { buildConversationBadgePayload } from "./manager-events";
import * as managerQueries from "./manager-queries";
export type { BossMentionItem, ConversationDetail, ConversationDispatchState, ConversationHistorySearchPage, ConversationHistoryWindow, ConversationMessagesPage, WorkspaceDetail, WorkspaceManagerDeps, WorkspaceSummary, StageDetail, IssueDetail, StageSuggestion } from "./manager-types";
import type { ConversationDispatchState } from "./manager-types";
import { ConversationQueue } from "./conversation-queue";
import { MessageInterruptRegistry } from "../message-bus/message-interrupt";
import type { MessageInputEvent } from "../message-bus/message-events";
import { recoverOrphanedStreamingAssistantMessages, type StartupRecoveryResult } from "./startup-recovery";
import { buildConversationDetail, getConversationDispatchState, getBossMentions } from "./manager-detail";
import type { RepoCleanupResult } from "./repo-cleanup";
import type { CollaborationDeps } from "./manager-collaboration";

// Service imports
import * as issueService from "./issue-service";
import type { IssueServiceDeps } from "./issue-service";
import * as workspaceService from "./workspace-service";
import type { WorkspaceServiceDeps } from "./workspace-service";
import * as sopService from "./sop-service";
import * as messageService from "./message-service";
import type { MessageServiceDeps } from "./message-service";
import * as stageSuggestionService from "./stage-suggestion-service";
import type { StageSuggestionServiceDeps } from "./stage-suggestion-service";

import * as evolutionCenter from "../evolution-center/evolution-service";

const DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT = 3;

export class WorkspaceManager extends EventEmitter {
  private readonly conversationQueue = new ConversationQueue();
  private readonly messageInterrupts = new MessageInterruptRegistry();
  private readonly repoRoot: string;
  private readonly startupRecovery: Promise<StartupRecoveryResult>;
  /** shutdown 期间为 true，阻止新 send 任务进入并快速释放 HTTP 连接。 */
  private shuttingDown = false;
  private readonly collaborationDeps: CollaborationDeps;
  /** AI 提议的待确认阶段转移，keyed by issueId。 */
  private readonly pendingStageSuggestions = new Map<string, StageSuggestion>();

  // Pre-built service dependency objects
  private readonly issueDeps: IssueServiceDeps;
  private readonly workspaceDeps: WorkspaceServiceDeps;
  private readonly messageDeps: MessageServiceDeps;
  private readonly stageSuggestionDeps: StageSuggestionServiceDeps;

  constructor(
    private store: ConversationStore,
    private _agentResolver: SnailAgentResolver,
    private deps: WorkspaceManagerDeps,
    options: { repoRoot?: string } = {}
  ) {
    super();
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.collaborationDeps = { store, systemAI: deps.systemAI, snailDen: deps.snailDen };
    this.startupRecovery = recoverOrphanedStreamingAssistantMessages({ store: this.store, summaryGenerator: null });

    // Build service dependency objects
    this.issueDeps = { store: this.store, repoRoot: this.repoRoot };
    this.workspaceDeps = { store: this.store, issueDeps: this.issueDeps };
    this.messageDeps = {
      store: this.store,
      wmDeps: this.deps,
      conversationQueue: this.conversationQueue,
      messageInterrupts: this.messageInterrupts,
      collaborationDeps: this.collaborationDeps,
      getShuttingDown: () => this.shuttingDown,
      onStageTransitionDetected: (conversationId, targetStageKey, reason) => this.handleAgentStageSuggestion(conversationId, targetStageKey, reason),
      emitBadgeUpdate: (conversationId) => this.emitConversationBadgeUpdate(conversationId),
      emit: (event, ...args) => this.emit(event, ...args),
    };
    this.stageSuggestionDeps = {
      store: this.store,
      pendingStageSuggestions: this.pendingStageSuggestions,
      emit: (event, ...args) => this.emit(event, ...args),
      transitionIssueStage: (issueId, targetStageKey) => this.transitionIssueStage(issueId, targetStageKey),
    };
  }

  async waitForStartupRecovery(): Promise<StartupRecoveryResult> { return this.startupRecovery; }

  // ── Workspace CRUD (delegated to workspace-service) ──────────────

  createWorkspace(name: string, input: { summary?: string; workspaceRoot?: string; sopId: string; roleSnailMapping?: Record<string, Record<string, string>>; loadFromSnail?: boolean }) {
    return workspaceService.createWorkspace(this.workspaceDeps, name, input);
  }

  loadWorkspaceFromSnail(workspaceId: string, workspaceRoot: string): boolean {
    return workspaceService.loadWorkspaceFromSnail(this.store, workspaceId, workspaceRoot);
  }

  hasSnailConfig(workspaceRoot: string): boolean {
    return workspaceService.hasSnailConfig(workspaceRoot);
  }

  listWorkspaces(limit = 50, offset = 0): WorkspaceSummary[] {
    return workspaceService.listWorkspaces(this.store, limit, offset);
  }

  getWorkspace(workspaceId: string): WorkspaceDetail | null {
    return workspaceService.getWorkspace(this.store, workspaceId);
  }

  // ── Issue lifecycle (delegated to issue-service) ─────────────────

  createIssue(workspaceId: string, title: string, summary: string | undefined, adoptedSopId: string, roleSnailMapping: Record<string, Record<string, string>>) {
    return issueService.createIssue(this.issueDeps, workspaceId, title, summary, adoptedSopId, roleSnailMapping);
  }

  getIssue(issueId: string): IssueDetail | null { return issueService.getIssue(this.issueDeps, issueId); }
  listIssues(workspaceId: string): IssueDetail[] { return issueService.listIssues(this.issueDeps, workspaceId); }
  listStages(workspaceId: string): StageDetail[] { return issueService.listStages(this.issueDeps, workspaceId); }
  getStage(stageId: string): StageDetail | null { return issueService.getStage(this.issueDeps, stageId); }

  advanceIssue(issueId: string, targetStageKey?: string) {
    return issueService.advanceIssue(this.issueDeps, issueId, targetStageKey, this.pendingStageSuggestions);
  }

  transitionIssueStage(issueId: string, targetStageKey: string) {
    return issueService.transitionIssueStageForIssue(this.issueDeps, issueId, targetStageKey, this.pendingStageSuggestions);
  }

  setIssueTaskAnchor(issueId: string, taskAnchor: string): Issue {
    return issueService.setIssueTaskAnchor(this.issueDeps, issueId, taskAnchor);
  }

  setIssueRoleSnail(issueId: string, stageKey: string, roleKey: string, snailTemplateId: string): Issue {
    return issueService.setIssueRoleSnail(this.issueDeps, issueId, stageKey, roleKey, snailTemplateId, this.deps.snailDen);
  }

  completeIssue(issueId: string): { issue: Issue; cleanup: RepoCleanupResult } {
    return issueService.completeIssue(this.issueDeps, issueId);
  }

  archiveIssue(issueId: string): { issue: Issue; cleanup: RepoCleanupResult } {
    return issueService.archiveIssue(this.issueDeps, issueId);
  }

  updateStage(stageId: string, updates: Partial<Pick<Stage, "status" | "output_artifacts" | "gate_evidence" | "entered_at" | "left_at">>): Stage {
    return issueService.updateStage(this.issueDeps, stageId, updates);
  }

  // ── Conversation queries (delegated to manager-detail / manager-queries) ──

  listWorkspaceConversations(workspaceId: string): ConversationDetail[] { return this.store.listConversationsByWorkspace(workspaceId).map((c) => buildConversationDetail(this.store, c)); }
  getStageConversation(stageId: string): ConversationDetail | null { const c = this.store.getConversationByStage(stageId); return c ? buildConversationDetail(this.store, c) : null; }
  listIssueConversations(issueId: string): ConversationDetail[] { return this.store.listConversationsByIssue(issueId).map((c) => buildConversationDetail(this.store, c)); }
  getConversation(conversationId: string): ConversationDetail | null { const c = this.store.getConversation(conversationId); return c ? buildConversationDetail(this.store, c) : null; }

  // ── Message sending (delegated to message-service) ───────────────

  async sendMessage(conversationId: string, userContent: string): Promise<{ messageIds: number[] }> {
    return messageService.sendMessage(this.messageDeps, conversationId, userContent);
  }

  async sendStructuredMessage(
    conversationId: string,
    userParts: MessageInputEvent[],
    options: { fromRole?: RoleName; quotedMessageId?: number | null; askerRole?: RoleName | null; clientId?: string | null } = {},
  ): Promise<{ messageIds: number[] }> {
    return messageService.sendStructuredMessage(this.messageDeps, conversationId, userParts, options);
  }

  async sendConversationMessage(conversationId: string, input: { content?: string; events?: MessageInputEvent[]; fromRole?: RoleName; quotedMessageId?: number | null; clientId?: string | null }): Promise<{ messageIds: number[] } | { error: { message: string } }> {
    return messageService.sendConversationMessage(this.messageDeps, conversationId, input);
  }

  interruptMessage(conversationId: string, messageId: number): { interrupted: boolean } {
    return messageService.interruptMessage(this.messageDeps, conversationId, messageId);
  }

  interruptAllRunningMessages(): void { messageService.interruptAllRunningMessages(this.messageDeps); }
  markShuttingDown(): void { this.shuttingDown = true; messageService.interruptAllRunningMessages(this.messageDeps); }
  async waitForAllAgentProcessesStopped(): Promise<void> { await messageService.waitForAllAgentProcessesStopped(this.messageDeps); }

  // ── Conversation message queries (delegated to manager-queries) ──

  getConversationMessages(conversationId: string, limit = 100, offset = 0): MessageWithEvents[] { return managerQueries.getConversationMessages(this.store, conversationId, limit, offset); }
  getRecentConversationMessages(conversationId: string, limit = DEFAULT_AGENT_HISTORY_USER_MESSAGE_LIMIT): ConversationRecentMessagesSnapshot { return managerQueries.getRecentConversationMessages(this.store, conversationId, limit); }
  getConversationEventsAfter(conversationId: string, afterEventId: number) { return managerQueries.getConversationEventsAfter(this.store, conversationId, afterEventId); }
  getLastConversationEventId(conversationId: string): number { return managerQueries.getLastConversationEventId(this.store, conversationId); }
  getConversationEventsBetween(conversationId: string, afterEventId: number, untilEventId: number) { return managerQueries.getConversationEventsBetween(this.store, conversationId, afterEventId, untilEventId); }
  getConversationMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] { return managerQueries.getConversationMessagesByIds(this.store, conversationId, messageIds); }
  getConversationMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): ConversationHistoryWindow { return managerQueries.getConversationMessageWindow({ store: this.store, conversationId, anchorMessageId, before, after }); }
  getConversationMessagesPage(conversationId: string, options: { limit?: number; offset?: number; before?: number } = {}): ConversationMessagesPage { return managerQueries.getConversationMessagesPage(this.store, conversationId, options); }
  getConversationDispatchState(conversationId: string): ConversationDispatchState { return getConversationDispatchState(this.store, conversationId); }
  getBossMentions(conversationId: string): BossMentionItem[] { return getBossMentions(this.store, conversationId); }

  acknowledgeBossMentions(conversationId: string): BossMentionItem[] {
    const mentions = getBossMentions(this.store, conversationId);
    this.store.markConversationDispatchesSeen(conversationId, mentions.map((item) => item.dispatch_id));
    this.emitConversationBadgeUpdate(conversationId);
    return mentions;
  }

  searchConversationHistory(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchPage { return managerQueries.searchConversationHistory({ store: this.store, conversationId, query, limit, offset }); }

  // ── SOP management (delegated to sop-service) ────────────────────

  listRoles() { return sopService.listRoles(this.store); }
  listSops(source?: "platform" | "workspace") { return sopService.listSops(this.store, source); }
  getSop(sopId: string) { return sopService.getSop(this.store, sopId); }
  createPlatformSop(input: Parameters<ConversationStore["fileConfigStore"]["createPlatformSop"]>[0]) { return sopService.createPlatformSop(this.store, input); }
  updatePlatformSop(sopId: string, input: Parameters<ConversationStore["fileConfigStore"]["updatePlatformSop"]>[1]) { return sopService.updatePlatformSop(this.store, sopId, input); }
  deletePlatformSop(sopId: string): string[] { return sopService.deletePlatformSop(this.store, sopId); }
  listSopStageDefinitionsWithRoles(sopId: string) { return sopService.listSopStageDefinitionsWithRoles(this.store, sopId); }
  collectSopRoleKeys(sopId: string) { return sopService.collectSopRoleKeys(this.store, sopId); }
  listSopStageDefinitions(sopId: string) { return sopService.listSopStageDefinitions(this.store, sopId); }
  getSopTransitions(sopId: string) { return sopService.getSopTransitions(this.store, sopId); }
  getForwardTransitions(sopId: string, fromStageKey: string) { return sopService.getForwardTransitions(this.store, sopId, fromStageKey); }

  // ── Evolution center ─────────────────────────────────────────────

  createEvolutionItem(input: Omit<CreateEvolutionItemInput, "id">, roleSnailMapping: Record<string, Record<string, string>>): EvolutionItemWithConversation { return evolutionCenter.createEvolutionItem(this.store, input, roleSnailMapping); }
  getEvolutionItem(id: string): EvolutionItemWithConversation | null { return evolutionCenter.getEvolutionItem(this.store, id); }
  listEvolutionItems(filters: EvolutionItemListFilters = {}): EvolutionItemSearchResult[] { return evolutionCenter.listEvolutionItems(this.store, filters); }
  updateEvolutionItem(id: string, input: UpdateEvolutionItemInput): EvolutionItemWithConversation { return evolutionCenter.updateEvolutionItem(this.store, id, input); }

  // ── Knowledge library ────────────────────────────────────────────

  getKnowledgeLibrarySummary(): { scope: string; count: number }[] { return this.store.knowledgeLibrary.summary(); }
  getKnowledgeLibraryEntry(id: string) { return this.store.knowledgeLibrary.get(id); }
  listKnowledgeLibrary(filters: any = {}) { return this.store.knowledgeLibrary.list(filters); }
  searchKnowledgeLibrary(filters: any) { return this.store.knowledgeLibrary.search(filters); }

  // ── Stage suggestions (delegated to stage-suggestion-service) ────

  getPendingStageSuggestion(issueId: string): StageSuggestion | null {
    return stageSuggestionService.getPendingStageSuggestion(this.stageSuggestionDeps, issueId);
  }

  confirmStageSuggestion(issueId: string) {
    return stageSuggestionService.confirmStageSuggestion(this.stageSuggestionDeps, issueId);
  }

  clearStageSuggestion(issueId: string): void {
    stageSuggestionService.clearStageSuggestion(this.stageSuggestionDeps, issueId);
  }

  // ── Private helpers (kept for event emission and delegation wiring) ──

  private handleAgentStageSuggestion(conversationId: string, targetStageKey: string, reason: string | null): void {
    stageSuggestionService.handleAgentStageSuggestion(this.stageSuggestionDeps, conversationId, targetStageKey, reason);
  }

  private emitConversationBadgeUpdate(conversationId: string): void {
    const conversation = this.getConversation(conversationId);
    if (conversation) this.emit("conversation-badge", buildConversationBadgePayload(conversation));
  }
}
