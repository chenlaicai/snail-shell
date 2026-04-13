import type { Conversation, MessagePartType } from "../persistence/store";
import type { MessageWithParts } from "../persistence/store";
import type { SnailDefinition } from "../snails";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentRuntime = "claude-code-cli" | "opencode-cli";

// Snail Shell provides structured conversation context to the runtime layer.
// The runtime layer then chooses the right invocation model for the concrete agent:
// 1. stateless non-interactive runtimes receive fully reconstructed context each turn
// 2. stateful non-interactive runtimes receive bootstrap context once, then only the
//    newest turn while the underlying agent maintains its own session state
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

export type AgentEvent =
  | { type: "turn_start" }
  | { type: "text"; content: string }
  | { type: "question"; payload: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; summary?: string; detail?: string }
  | { type: "permission_required"; request: ToolPermissionRequest }
  | { type: "result"; content: string }
  | { type: "error"; error: string };

export type PermissionDecision = "allow" | "deny";

export interface SnailRuntimeTurnInput {
  // This is the only runtime input shape that upper layers should construct.
  // It contains Snail Shell's structured view of the turn before any runtime-specific
  // prompt flattening happens. Keep this object domain-oriented rather than CLI-shaped.
  conversation: Conversation;
  snail: SnailDefinition;
  systemPrompts: {
    conversation: string;
  };
  history: AgentMessage[];
  latestUserParts: Array<{ part_type: MessagePartType; content: string }>;
  incrementalMessages: MessageWithParts[];
}

export interface AgentInvocationResult {
  content: string;
  sessionId?: string | null;
}

export interface StatelessInvocationInput {
  // Stateless runtimes are reconstructed every turn from Snail Shell state.
  // They should receive the full conversation window that Snail Shell wants the
  // model to reason over for this specific reply.
  systemPrompt: string;
  messages: AgentMessage[];
}

export interface StatefulInvocationInput {
  // Stateful runtimes own their internal session context after bootstrap.
  // `sessionId` is bound to the current conversation+snail slot inside Snail Shell.
  // `bootstrap` is provided only when the conversation does not yet have a runtime
  // session. After that, only `latestMessage` should be sent so the underlying agent
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
  // point should continue to think in terms of structured snail turns.
  invokeTurn(
    input: SnailRuntimeTurnInput,
    onEvent: (event: AgentEvent) => void,
  ): Promise<AgentInvocationResult>;
}
