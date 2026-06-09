export { ConversationGateway, validateMessageEvents } from "./gateway";
export type { MessageValidationError, ConversationSendInput, ConversationOutboundEvent, ConversationEventHandler, ConversationBadgeHandler } from "./gateway";

export { createServer } from "./api/server";
export { registerIssueRoutes } from "./api/issue-routes";
export { registerEvolutionRoutes } from "./api/evolution-routes";
export { isConversationKind, isStageStatus, isRoleName } from "./api/validation";

export type { FeishuTransport, FeishuInboundMessage } from "./feishu/types";
export { loadFeishuConfig } from "./feishu/config";
// FeishuConfig 类型已迁移到 config 模块，暂时内联定义
export interface FeishuConfig {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  message_push: {
    max_text_length: number;
    streaming?: { enabled: boolean; flush_interval_ms?: number };
  };
  allowed_chats: Array<{ chat_id: string; chat_name?: string }>;
}
export { FeishuSdkTransport } from "./feishu/sdk-transport";

export { loadWecomConfig } from "./wecom/config";
// WecomConfig 类型已迁移到 config 模块，暂时内联定义
export interface WecomConfig {
  enabled: boolean;
  corp_id: string;
  corp_secret: string;
  token: string;
  encoding_aes_key: string;
  message_push: {
    max_text_length: number;
    streaming?: { enabled: boolean; flush_interval_ms?: number };
  };
  allowed_chats: Array<{ chat_id: string; chat_name?: string }>;
}
export { WecomSdkTransport } from "./wecom/sdk-transport";
