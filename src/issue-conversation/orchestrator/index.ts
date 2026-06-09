/**
 * Issue Conversation 编排器
 *
 * 编排多个原子模块完成 Issue 对话场景。
 *
 * 设计原则：
 * - 依赖原子模块的公开接口
 * - 不依赖原子模块的内部实现
 * - 协调多个原子模块完成业务流程
 */

import type { ConversationRepository, Message, Conversation } from "../../conversation";
import type { WorkspaceRepository, Issue, Stage } from "../../workspace";
import type { RuntimeResolver, SnailRuntime, AgentInvocationInput, AgentEvent } from "../../agent-runtime";
import type { PromptBuilder, PromptBuildContext } from "../../prompt";
import type { SopRepository, SopTransition } from "../../sop";
import type {
  IssueConversationOrchestrator,
  SendMessageResult,
  ConversationStatus,
  StageTransition,
} from "../types";

/**
 * Issue Conversation 编排器实现
 *
 * 编排多个原子模块完成 Issue 对话场景。
 */
export class IssueConversationOrchestratorImpl implements IssueConversationOrchestrator {
  constructor(
    private workspaceRepo: WorkspaceRepository,
    private conversationRepo: ConversationRepository,
    private agentRuntime: RuntimeResolver,
    private promptBuilder: PromptBuilder,
    private sopRepo: SopRepository
  ) {}

  async sendMessage(issueId: string, content: string): Promise<SendMessageResult> {
    // 1. 获取 Issue 和当前 Stage
    const issue = await this.workspaceRepo.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    const stages = await this.workspaceRepo.getIssueStages(issueId);
    const currentStage = stages.find((s) => s.status === "in_progress");
    if (!currentStage) {
      throw new Error(`No active stage for issue: ${issueId}`);
    }

    // 2. 获取或创建 Conversation
    let conversation = await this.conversationRepo.getStageConversation(currentStage.id);
    if (!conversation) {
      conversation = await this.conversationRepo.saveConversation({
        id: this.generateId(),
        stage_id: currentStage.id,
        issue_id: issueId,
        workspace_id: issue.workspace_id,
        owner_type: "workspace_stage",
        owner_id: currentStage.id,
        title: `Issue: ${issue.title}`,
        kind: "discussion",
        default_role: "assistant",
      });
    }

    // 3. 保存用户消息
    const userMessage = await this.conversationRepo.saveMessage({
      conversation_id: conversation.id,
      role: "user",
      content,
      status: "completed",
    });

    // 4. 构建系统提示词
    // TODO: 从 Stage 的角色定义（StageRoleDefinition）中获取角色信息
    // TODO: 从历史消息中获取 latestUserEvents
    const systemPrompt = await this.promptBuilder.buildSystemPrompt({
      workspaceRoot: issue.workspace_id,
      issueId,
      stageId: currentStage.id,
      conversationId: conversation.id,
      role: {
        key: currentStage.type || "assistant",
        name: currentStage.type || "Assistant",
        description: `Stage ${currentStage.type} role`,
        rules: [],
        isPrimary: true,
      },
      history: history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content || "",
      })),
      latestUserEvents: [],
    });

    // 5. 获取历史消息（从 MessageEvent 中提取内容）
    const history = await this.conversationRepo.getRecentMessages(conversation.id, 10);
    const historyWithContent = await Promise.all(
      history.map(async (m) => {
        const events = await this.conversationRepo.getMessageEvents(m.id);
        const textEvent = events.find((e) => e.kind === "text");
        const content = textEvent ? (textEvent.payload.text as string || "") : "";
        return { role: m.role as "user" | "assistant", content };
      })
    );

    // 6. 调用 Agent
    const runtime = this.agentRuntime.resolve("claude-code");
    const agentInput: AgentInvocationInput = {
      systemPrompt,
      systemReminder: "",
      messages: historyWithContent,
    };

    let responseContent = "";
    await runtime.invokeMessage(agentInput, (event: AgentEvent) => {
      if (event.type === "message_event") {
        const data = event.data as Record<string, unknown>;
        if (data.kind === "text") {
          responseContent += (data.payload as Record<string, unknown>).text || "";
        }
      }
    });

    // 7. 保存 Assistant 消息
    const assistantMessage = await this.conversationRepo.saveMessage({
      conversation_id: conversation.id,
      role: "assistant",
      content: responseContent,
      status: "completed",
    });

    // 8. 检查 Stage 转移
    const stageTransition = await this.checkStageTransition(issue, currentStage, conversation);

    return {
      message: userMessage,
      response: assistantMessage,
      stageTransition,
    };
  }

  async getHistory(issueId: string, limit?: number): Promise<Message[]> {
    const stages = await this.workspaceRepo.getIssueStages(issueId);
    const currentStage = stages.find((s) => s.status === "in_progress");
    if (!currentStage) {
      return [];
    }

    const conversation = await this.conversationRepo.getStageConversation(currentStage.id);
    if (!conversation) {
      return [];
    }

    return this.conversationRepo.getRecentMessages(conversation.id, limit || 50);
  }

  async getConversationStatus(issueId: string): Promise<ConversationStatus> {
    const issue = await this.workspaceRepo.getIssue(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    const stages = await this.workspaceRepo.getIssueStages(issueId);
    const currentStage = stages.find((s) => s.status === "in_progress") || null;

    let currentConversation: Conversation | null = null;
    let messageCount = 0;

    if (currentStage) {
      currentConversation = await this.conversationRepo.getStageConversation(currentStage.id);
      if (currentConversation) {
        const messages = await this.conversationRepo.getMessages(currentConversation.id);
        messageCount = messages.length;
      }
    }

    // 检查是否可以转移 Stage
    let canTransition = false;
    if (issue.sop_snapshot && currentStage) {
      const sopId = (issue.sop_snapshot as Record<string, unknown>).sop_id as string;
      if (sopId) {
        const transitions = await this.sopRepo.getForwardTransitions(sopId, currentStage.type);
        canTransition = transitions.length > 0;
      }
    }

    return {
      issueId,
      currentStage,
      currentConversation,
      messageCount,
      canTransition,
    };
  }

  private async checkStageTransition(
    issue: Issue,
    currentStage: Stage,
    conversation: Conversation
  ): Promise<StageTransition | undefined> {
    if (!issue.sop_snapshot) {
      return undefined;
    }

    // 类型安全地获取 sop_id
    const sopSnapshot = issue.sop_snapshot as Record<string, unknown>;
    const sopId = sopSnapshot.sop_id as string | undefined;
    if (!sopId) {
      return undefined;
    }

    const transitions = await this.sopRepo.getForwardTransitions(sopId, currentStage.type);

    for (const transition of transitions) {
      if (!transition.guard) {
        // 无条件转移
        return {
          from: currentStage.type,
          to: transition.to_stage_key,
          reason: "No guard condition",
        };
      }

      // 检查 guard 条件
      const isSatisfied = await this.checkGuardCondition(transition, conversation);
      if (isSatisfied) {
        return {
          from: currentStage.type,
          to: transition.to_stage_key,
          reason: "Guard condition satisfied",
        };
      }
    }

    return undefined;
  }

  private async checkGuardCondition(
    transition: SopTransition,
    conversation: Conversation
  ): Promise<boolean> {
    // 简单的 guard 条件检查
    // 实际实现应该更复杂
    if (!transition.guard) {
      return true;
    }

    const guardType = transition.guard.type;
    if (guardType === "requires_artifacts") {
      // 检查是否所有必需的 artifact 都存在
      const requiredArtifacts = transition.guard.config.artifacts as string[] || [];
      // 这里简化处理，实际应该检查 stage 的 output_artifacts
      return requiredArtifacts.length === 0;
    }

    return false;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
