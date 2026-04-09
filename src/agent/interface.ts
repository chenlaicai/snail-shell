export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentReply {
  content: string;
}

export interface ToolPermissionRequest {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "question"; payload: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "permission_required"; request: ToolPermissionRequest }
  | { type: "result"; content: string }
  | { type: "error"; error: string };

export type PermissionDecision = "allow" | "deny";

export interface Agent {
  readonly name: string;
  chat(messages: AgentMessage[], systemPrompt?: string): Promise<AgentReply>;
  chatStream?(
    messages: AgentMessage[],
    onEvent: (event: AgentEvent) => void,
    systemPrompt?: string
  ): Promise<AgentReply>;
}
