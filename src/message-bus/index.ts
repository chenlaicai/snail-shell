export { drainMessageBus, MessageBusDrainError } from "./message-bus";
export type { MessageBusInvocationOptions, MessageBusBatch, MessageBusDeps } from "./message-bus";

export { sendStructuredMessage, structuredMentionsFromEvents, isCollaborationInterrupted, isCollaborationStopFailure, CollaborationInterruptedError } from "./collaboration";
export type { CollaborationInvocationOptions, ResolvedMention, MentionResolution, SendStructuredMessageResult, InterruptedSnailInvocation } from "./collaboration";

export {
  buildTextEvent,
  buildPlainTextEvent,
  buildContentBlockEvent,
  buildStructuredTextEvent,
  buildQuestionEvent,
  buildQuestionResponseEvent,
  extractTextFromBlocks,
  getInputContent,
  extractMentionsFromInputs,
  extractMessageMentions,
  buildMessagePreview,
  renderMessageEventsForDisplay,
  renderMessageEventsForPrompt,
  getInputContentFromEvents,
} from "./message-events";
export type { MessageInputEvent } from "./message-events";

export { normalizeRuntime, createStreamingContext, invokeRuntimeMessage, finalizeMessageLifecycle } from "./message-protocol";
export type { MessageProtocolDeps, MessageLifecycleFinalization, StreamingContext } from "./message-protocol";

export { buildTerminalMessageContext, buildDeterministicMessageContext, MESSAGE_CONTEXT_LLM_SUMMARY_THRESHOLD_CHARS, MESSAGE_CONTEXT_LLM_SUMMARY_TARGET_CHARS } from "./message-context";
export type { BuiltMessageContext } from "./message-context";
export { formatMessageContextForPrompt } from "./message-context";

export { extractEmbeddedMessageOutCandidate, buildMessageOutText, buildMessageOutBlocks, parseMessageOutPayload, stringifyMessageOutPart, normalizeMentionRecords } from "./message-out";

export { buildAgentMessages } from "./agent-message";

export { MessageInterruptRegistry } from "./message-interrupt";

export { dedupeMentions } from "./mentions";
