import type {
  AgentEvent,
  AgentInvocationOptions,
  AgentInvocationResult,
  SnailRuntime,
  SnailRuntimeMessageInput,
  StatefulAgentInvoker,
  StatefulInvocationInput,
} from "./interface";
import { buildStatefulBootstrap, buildStatefulIncrementalMessages } from "./prompt-mapper";
import { StatefulCLIAgent, type CLIConfig, type ParseState, type StreamEvent } from "./stateful-cli-agent";
import { buildRuntimeUsageSignal, usageDetailFromClaudeResult } from "./runtime-usage";
import { logger } from "../logger";
import { formatText } from "./log-preview";

/**
 * Claude Code 有状态 Agent
 *
 * 支持会话恢复（resume）的 Claude Code CLI 封装。
 * 与无状态的 ClaudeCodeAgent 不同，此 agent 会维护会话状态，
 * 允许跨多轮对话保持上下文。
 *
 * 使用场景：
 * - 需要长时间运行的任务
 * - 需要跨多轮对话的工作
 * - 需要利用 Claude Code 自身的会话管理能力
 */
export class ClaudeCodeStatefulAgent extends StatefulCLIAgent implements SnailRuntime, StatefulAgentInvoker {
  readonly name = "claude-code-stateful";
  readonly runtime = "claude-code-stateful-cli";

  protected getAgentName(): string {
    return "ClaudeCodeStateful";
  }

  protected getCLIConfig(model?: string): CLIConfig {
    return {
      command: "claude",
      model,
      buildArgs: (input: StatefulInvocationInput, _prompt: string) => {
        const args = [
          "-p",
          "--output-format", "stream-json",
          "--input-format", "stream-json",
          "--verbose",
          "--permission-mode", "bypassPermissions",
        ];

        if (model) {
          args.push("--model", model);
        }

        // 如果有 sessionId，使用 --resume 恢复会话
        if (input.sessionId) {
          args.push("--resume", input.sessionId);
        }

        // 使用 --append-system-prompt 传递系统提示词
        if (input.bootstrap?.systemPrompt) {
          args.push("--append-system-prompt", input.bootstrap.systemPrompt);
        }

        return args;
      },
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    };
  }

  async invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions
  ): Promise<AgentInvocationResult> {
    const sessionId = input.conversation.runtime_sessions[input.snail.name]?.sessionId ?? null;
    return this.invokeStateful(
      {
        sessionId,
        bootstrap: sessionId ? null : buildStatefulBootstrap(input),
        incrementalMessages: buildStatefulIncrementalMessages(input),
      },
      onEvent,
      options
    );
  }

  /**
   * 覆盖事件映射，处理 Claude Code 特有的输出格式
   *
   * Claude Code 的输出格式：
   * - type: "assistant" - 包含 message.content 数组（text 和 tool_use）
   * - type: "result" - 最终结果
   */
  protected mapEvent(event: StreamEvent, state: ParseState): AgentEvent[] {
    // Claude Code 使用不同的事件类型
    switch (event.type) {
      case "assistant":
        return this.mapAssistantEvent(event, state);
      case "result":
        return this.mapResultEvent(event, state);
      default:
        // 其他事件类型使用父类的默认处理
        return super.mapEvent(event, state);
    }
  }

  private mapAssistantEvent(event: StreamEvent, state: ParseState): AgentEvent[] {
    const events: AgentEvent[] = [];
    const message = event.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const messageId = typeof message?.id === "string" ? message.id : null;

    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const blockObj = block as Record<string, unknown>;
      const blockEvents = this.mapContentBlock(blockObj, state, messageId);
      events.push(...blockEvents);
    }

    return events;
  }

  private mapContentBlock(block: Record<string, unknown>, state: ParseState, messageId: string | null): AgentEvent[] {
    if (block.type === "text" && typeof block.text === "string") {
      return this.mapTextBlock(block.text, state, messageId);
    }
    if (block.type === "tool_use") {
      return this.mapToolUseBlock(block, messageId);
    }
    return [];
  }

  private mapTextBlock(text: string, state: ParseState, messageId: string | null): AgentEvent[] {
    state.textChunks.push(text);
    state.finalText = state.textChunks.join("");
    return [{
      type: "message_event",
      event: {
        kind: "text",
        payload: { text, mentions: [] },
        source: { runtime_event_type: "assistant", runtime_message_id: messageId },
      },
    }];
  }

  private mapToolUseBlock(block: Record<string, unknown>, messageId: string | null): AgentEvent[] {
    const toolName = typeof block.name === "string" ? block.name : "tool";
    const callId = typeof block.id === "string" ? block.id : "tool-use";
    const input = this.isRecord(block.input) ? block.input : {};

    return [{
      type: "message_event",
      event: {
        kind: "tool_call",
        payload: { tool_name: toolName, call_id: callId, input, title: null },
        source: {
          runtime_event_type: "assistant",
          runtime_message_id: messageId,
          runtime_call_id: callId,
        },
      },
    }];
  }

  private mapResultEvent(event: StreamEvent, state: ParseState): AgentEvent[] {
    const events: AgentEvent[] = [];
    const result = typeof event.result === "string" ? event.result : JSON.stringify(event.result);

    // 记录最终结果
    if (event.result) {
      state.finalText = result;
      logger.debug("ClaudeCodeStateful result", { result: formatText(result) });
    }

    // 处理 usage 信息
    const usage = usageDetailFromClaudeResult(event);
    if (usage) {
      events.push({
        type: "message_event",
        event: buildRuntimeUsageSignal(usage, "result"),
      });
    }

    // 处理错误
    if (event.is_error) {
      events.push({ type: "message_failure", error: result });
    }

    // 处理权限拒绝
    const permissionDenialError = this.formatPermissionDenials(event.permission_denials);
    if (permissionDenialError) {
      events.push({
        type: "message_event",
        event: {
          kind: "error",
          payload: { source: "runtime", message: permissionDenialError, detail: null },
          source: { runtime_event_type: "result" },
        },
      });
      events.push({ type: "message_failure", error: permissionDenialError });
    }

    return events;
  }

  private formatPermissionDenials(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const tools = value
      .map((item) =>
        typeof item === "object" && item !== null && "tool_name" in item
          ? String((item as { tool_name?: unknown }).tool_name ?? "unknown")
          : "unknown"
      )
      .join(", ");
    return `Claude Code denied required tool approval (${tools}). The agent did not continue execution.`;
  }

  /**
   * 覆盖 session ID 提取逻辑
   *
   * Claude Code 可能在 result 事件中返回 session ID
   */
  protected extractSessionId(state: ParseState, event: StreamEvent): void {
    // 尝试从顶层 session_id 提取
    if (typeof event.session_id === "string" && event.session_id) {
      state.sessionId = event.session_id;
    }
    // 尝试从 sessionID 提取（兼容其他格式）
    if (typeof event.sessionID === "string" && event.sessionID) {
      state.sessionId = event.sessionID;
    }
  }
}

// Export parser functions for testing
export function consumeClaudeCodeStatefulOutput(
  state: ParseState,
  chunk: string,
  onEvent: (event: AgentEvent) => void
): void {
  const agent = new ClaudeCodeStatefulAgent();
  agent.consumeOutput(state, chunk, onEvent);
}

export function flushClaudeCodeStatefulOutput(
  state: ParseState,
  onEvent: (event: AgentEvent) => void
): void {
  const agent = new ClaudeCodeStatefulAgent();
  agent.flushOutput(state, onEvent);
}

export function collectClaudeCodeStatefulText(state: ParseState): string {
  const agent = new ClaudeCodeStatefulAgent();
  agent.assertOutputEvents(state);
  return state.finalText ?? state.textChunks.join("");
}

export function invokeClaudeCodeStatefulForTest(
  input: StatefulInvocationInput,
  onEvent: (event: AgentEvent) => void,
  options?: AgentInvocationOptions
): Promise<AgentInvocationResult> {
  return new ClaudeCodeStatefulAgent().invokeStateful(input, onEvent, options);
}
