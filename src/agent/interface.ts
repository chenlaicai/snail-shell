import type { Conversation, CreateMessagePartInput, DeltaPartPayload, MessagePart, MessageWithParts } from "../persistence/store";
import type { SnailDefinition } from "../snails";

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

export type AgentMessageStatus = "success" | "error" | "cancelled" | "interrupted";

export type AgentEvent =
  | { type: "message_delta"; part: CreateMessagePartInput<"delta", DeltaPartPayload> }
  | { type: "permission_required"; request: ToolPermissionRequest }
  // Runtime adapters report all observable process output through message_delta.
  // That includes text, tool calls, tool results, and recoverable error observations.
  // Some runtimes expose a definite final failure while still completing the
  // request successfully at the transport layer. We model that separately so
  // error-only messages do not have to masquerade as process failures.
  | { type: "message_failure"; error: string };

export type RealtimeConversationEvent =
  | { type: "message_start"; message_id: number; snail_name: string; role: "assistant" }
  | ({ type: "message_part"; message_id: number; snail_name: string; part: MessagePart })
  | {
      type: "message_end";
      message_id: number;
      snail_name: string;
      status: AgentMessageStatus;
      final_role?: "assistant" | "system";
    };

export type PermissionDecision = "allow" | "deny";

export interface SnailRuntimeMessageInput {
  // This is the only runtime input shape that upper layers should construct.
  // It contains Snail Shell's structured view of the pending message before any runtime-specific
  // prompt flattening happens. Keep this object domain-oriented rather than CLI-shaped.
  conversation: Conversation;
  snail: SnailDefinition;
  systemPrompts: {
    conversation: string;
  };
  history: AgentMessage[];
  latestUserParts: CreateMessagePartInput[];
  incrementalMessages: MessageWithParts[];
}

export interface AgentInvocationResult {
  content: string;
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
