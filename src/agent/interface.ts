import type { Conversation, CreateMessageEventInput, MessageEvent, MessageRole, MessageStatus, MessageWithEvents } from "../persistence/store";
import type { AgentSnailDefinition } from "../snails";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentRuntime = "claude-code-cli" | "opencode-cli" | "codex-cli" | "gemini-cli";

// Snail Shell provides structured conversation context to the runtime layer.
// The runtime layer then chooses the right invocation model for the concrete agent:
// 1. stateless non-interactive runtimes receive fully reconstructed context for each message
// 2. stateful non-interactive runtimes receive bootstrap context once, then only the
//    newest message while the underlying agent maintains its own session state
// 3. concrete agent implementations finally translate that invocation contract into
//    CLI or API specific calls and stream events back to Snail Shell
//
// This separation is intentional. Snail Shell should not collapse all runtimes into
// one lowest-common-denominator abstraction because different coding agents have
// genuinely different strengths and state models. The first layer therefore preserves
// Snail Shell's own structured context, while lower layers adapt that context to the
// invocation style that a concrete runtime actually supports.

export interface AgentReply {
  content: string;
}

export interface ToolPermissionRequest {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export type AgentMessageStatus = MessageStatus;

export type AgentEvent =
  | { type: "message_event"; event: CreateMessageEventInput }
  | { type: "permission_required"; request: ToolPermissionRequest }
  | { type: "message_failure"; error: string };

export type RealtimeConversationEvent =
  | { type: "message_started"; message_id: number; status: MessageStatus; snail_name: string; role: MessageRole; client_id?: string }
  | ({ type: "message_event_appended"; message_id: number; snail_name: string; event: MessageEvent; client_id?: string })
  | {
      type: "message_status_changed";
      message_id: number;
      snail_name: string;
      status: MessageStatus;
      final_role?: MessageRole;
      client_id?: string;
    };

export type PermissionDecision = "allow" | "deny";

export interface SnailRuntimeMessageInput {
  // This is the only runtime input shape that upper layers should construct.
  // It contains Snail Shell's structured view of the pending message before any runtime-specific
  // prompt flattening happens. Keep this object domain-oriented rather than CLI-shaped.
  conversation: Conversation;
  snail: AgentSnailDefinition;
  systemPrompts: {
    conversation: string;
  };
  history: AgentMessage[];
  latestUserEvents: CreateMessageEventInput[];
  incrementalMessages: MessageWithEvents[];
}

export interface AgentInvocationResult {
  sessionId?: string | null;
}

export interface StatelessInvocationInput {
  // Stateless runtimes are reconstructed for each message from Snail Shell state.
  // They should receive the full conversation window that Snail Shell wants the
  // model to reason over for this specific reply.
  systemPrompt: string;
  messages: AgentMessage[];
}

export interface StatefulInvocationInput {
  // Stateful runtimes own their internal session context after bootstrap.
  // `sessionId` is bound to the current conversation+snail slot inside Snail Shell.
  // `bootstrap` is provided only when the conversation does not yet have a runtime
  // session. After that, only the newest message sequence should be sent so the underlying agent
  // can manage its own context window, compaction, and continuation behavior.
  sessionId: string | null;
  bootstrap: {
    systemPrompt: string;
    messages: AgentMessage[];
  } | null;
  incrementalMessages: AgentMessage[];
}

export interface StatelessAgentInvoker {
  invokeStateless(
    input: StatelessInvocationInput,
    onEvent: (event: AgentEvent) => void
  ): Promise<AgentInvocationResult>;
}

export interface StatefulAgentInvoker {
  invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void
  ): Promise<AgentInvocationResult>;
}

export interface SnailRuntime {
  readonly name: string;
  readonly runtime: AgentRuntime;
  // This is the boundary between Snail Shell and all concrete runtimes. Everything
  // below this point can differ by runtime capability, but everything above this
  // point should continue to think in terms of structured snail messages.
  invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
  ): Promise<AgentInvocationResult>;
}
