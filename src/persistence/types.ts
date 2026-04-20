import type { SnailName, StageType, ArtifactType } from "../meta/generated-types";

export type { SnailName, StageType, ArtifactType };

/** 项目类型，区分系统自身演进项目和产品交付项目。 */
export type ProjectKind = "system_self" | "product_delivery";
/** 项目状态，描述项目在生命周期中的整体进展。 */
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
/** 阶段状态，描述单个工作流阶段的进度。 */
export type StageStatus = "in_progress" | "completed" | "cancelled";
/** 会话类型，描述当前 conversation 的协作场景。 */
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
/** 会话状态，描述当前 conversation 是否仍在活跃协作。 */
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
/** 消息角色，区分用户、agent 与系统生成的消息。 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * message_part.part_type 的常量映射。
 *
 * 用于在代码中避免直接散落字符串字面量，同时作为 MessagePartType 的唯一来源。
 */
export const PartType = {
  STREAMING_CHUNK: "streaming_chunk",
  CONTENT: "content",
  TOOL_USE: "tool_use",
  SYSTEM_EVENT: "system_event",
} as const;
/** 消息分片类型，决定 message_part 的内容语义。 */
export type MessagePartType = typeof PartType[keyof typeof PartType];
/** 消息分发状态，描述一条 dispatch 当前的消费进度。 */
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";
/** 产物状态，描述产物从草稿到归档的阶段。 */
export type ArtifactStatus = "draft" | "active" | "approved" | "superseded" | "archived";
/** 产物存储方式，描述产物正文存放在哪种介质中。 */
export type ArtifactStorageType = "markdown_file" | "inline_text" | "json_record" | "external_ref";

/**
 * 项目表。
 *
 * 表示一个完整的工作单元，是 stage、conversation、artifact 等数据的顶层归属对象。
 */
export interface Project {
  /** 项目唯一标识。 */
  id: string;
  /** 项目类型，决定项目属于系统自举还是产品交付。 */
  kind: ProjectKind;
  /** 项目名称。 */
  name: string;
  /** 项目摘要，用于概览项目目标或背景。 */
  summary: string | null;
  /** 项目当前状态。 */
  status: ProjectStatus;
  /** 项目创建时间。 */
  created_at: string;
  /** 项目最近更新时间。 */
  updated_at: string;
}

/**
 * 阶段表。
 *
 * 表示项目工作流中的一个阶段实例，每个阶段隶属于某个项目，并约束该阶段的正式产物要求。
 */
export interface Stage {
  /** 阶段唯一标识。 */
  id: string;
  /** 所属项目 ID。 */
  project_id: string;
  /** 阶段类型，对应 .meta 中定义的工作流阶段。 */
  type: StageType;
  /** 阶段在项目工作流中的顺序号。 */
  sequence: number;
  /** 阶段当前状态。 */
  status: StageStatus;
  /** 当前阶段已经确认的正式产物 ID 列表。 */
  formal_artifacts: string[];
  /** 阶段创建时间。 */
  created_at: string;
  /** 阶段最近更新时间。 */
  updated_at: string;
  /** 阶段实际进入时间。 */
  entered_at: string | null;
  /** 阶段实际离开时间。 */
  left_at: string | null;
}

/**
 * 运行时会话绑定。
 *
 * 表示某个 snail 在当前 conversation 中复用的外部 agent runtime 会话。
 */
export interface RuntimeSessionBinding {
  /** 外部 agent runtime 的 session ID。 */
  sessionId: string;
}

/**
 * 会话表。
 *
 * 表示某个 stage 下的一次具体协作会话，是 message、dispatch、artifact 的直接容器。
 */
export interface Conversation {
  /** 会话唯一标识。 */
  id: string;
  /** 所属项目 ID。 */
  project_id: string;
  /** 所属阶段 ID。 */
  stage_id: string;
  /** 会话标题。 */
  title: string;
  /** 会话类型，用于区分讨论、设计、实现等场景。 */
  kind: ConversationKind;
  /** 会话当前状态。 */
  status: ConversationStatus;
  /** 默认处理用户消息的 snail。 */
  default_snail: SnailName;
  /** 当前会话允许参与协作的 snail 列表。 */
  participating_snails: SnailName[];
  /** 会话摘要，用于压缩历史上下文。 */
  summary: string | null;
  /** 来源会话 ID 列表，用于记录跨会话承接关系。 */
  from_conversation_ids: string[];
  /** 每个 snail 当前绑定的运行时会话信息。 */
  runtime_sessions: Partial<Record<SnailName, RuntimeSessionBinding>>;
  /** 会话创建时间。 */
  created_at: string;
  /** 会话最近更新时间。 */
  updated_at: string;
}

/**
 * 消息表。
 *
 * 表示会话中的一条消息实体，只描述消息的归属、生产者、角色和回复关系。
 * 消息正文与结构化内容存放在 message_part 中，消息路由信息存放在 message_dispatch 中。
 */
export interface Message {
  /** 消息唯一标识。 */
  id: number;
  /** 所属会话 ID。 */
  conversation_id: string;
  /** 消息发送方 snail；system 消息通常为 null。 */
  from_snail: SnailName | null;
  /** 消息目标 snail 列表，是消息级别的路由结果。 */
  to_snails: SnailName[];
  /** 消息角色，用于区分用户、agent、系统消息。 */
  role: MessageRole;
  /** 当前消息引用的历史消息 ID，仅用于 UI 展示。 */
  quoted_message_id: number | null;
  /** 生成这条消息时采用的上下文截断时间。 */
  context_cutoff_at: string;
  /** 消息创建时间。 */
  created_at: string;
}

/**
 * 消息分片表。
 *
 * 表示某条消息的内容组成部分。一个 message 可以由多个 part 构成，
 * 以支持流式输出、工具调用记录和系统事件等不同内容形态。
 */
export interface MessagePart {
  /** 分片唯一标识。 */
  id: number;
  /** 所属消息 ID。 */
  message_id: number;
  /** 分片类型，决定该分片在渲染和处理时的语义。 */
  part_type: MessagePartType;
  /** 分片文本内容。 */
  text_value: string | null;
  /** 该分片中显式提及的 snail 列表。 */
  mentions?: SnailName[];
  /** 分片的结构化 JSON 内容，通常用于 tool_use 等场景。 */
  json_value: string | null;
  /** 分片创建时间。 */
  created_at: string;
}

/**
 * 带完整内容分片的消息视图。
 *
 * 用于读取消息时直接附带其所有 part，避免调用方重复查询 message_part。
 */
export interface MessageWithParts extends Message {
  /** 当前消息包含的所有内容分片。 */
  parts: MessagePart[];
}

/**
 * 消息分发表。
 *
 * 表示某条消息被投递给哪个 snail 消费，是当前消息总线的核心路由记录。
 */
export interface MessageDispatch {
  /** 分发记录唯一标识。 */
  id: number;
  /** 所属会话 ID。 */
  conversation_id: string;
  /** 被投递的消息 ID。 */
  message_id: number;
  /** 当前这条分发记录对应的目标消费者 snail。 */
  to_snail: SnailName;
  /** 当前分发状态。 */
  status: MessageDispatchStatus;
  /** 消费这条分发记录后生成的消息 ID。 */
  consumed_by_message_id: number | null;
  /** 分发创建时间。 */
  created_at: string;
  /** 分发被处理或跳过的时间。 */
  consumed_at: string | null;
}

/**
 * 消费箱分组视图。
 *
 * 用于按 to_snail 和状态聚合 dispatch，方便展示某个 snail 当前的 inbox。
 */
export interface DispatchInboxGroup {
  /** 该组 dispatch 对应的目标 snail。 */
  to_snail: SnailName;
  /** 该组 dispatch 的统一状态。 */
  status: MessageDispatchStatus;
  /** 当前组内的 dispatch ID 列表。 */
  dispatch_ids: number[];
  /** 当前组内关联的 message ID 列表。 */
  message_ids: number[];
  /** 当前组内最近一条 dispatch 的创建时间。 */
  latest_dispatch_at: string;
}

/**
 * 消费箱消息预览项。
 *
 * 用于在 inbox 展示中呈现被投递消息的简要预览信息。
 */
export interface DispatchInboxPreviewItem {
  /** 预览项对应的消息 ID。 */
  message_id: number;
  /** 消息发送方 snail。 */
  from_snail: SnailName | null;
  /** 消息角色。 */
  role: MessageRole;
  /** 预览文本。 */
  preview: string;
  /** 消息创建时间。 */
  created_at: string;
}

/**
 * 会话历史搜索结果。
 *
 * 用于返回 message_search 全文检索命中的消息摘要。
 */
export interface ConversationHistorySearchResult {
  /** 命中的消息 ID。 */
  message_id: number;
  /** 命中消息的角色。 */
  role: MessageRole;
  /** 命中消息的发送方 snail。 */
  from_snail: SnailName | null;
  /** 命中消息的创建时间。 */
  created_at: string;
  /** 检索结果摘要片段。 */
  snippet: string;
}

/**
 * 创建消息时的输入结构。
 *
 * 对应 message 表写入所需的核心字段。
 */
export interface CreateMessageInput {
  /** 所属会话 ID。 */
  conversationId: string;
  /** 消息发送方 snail；system 消息可为 null。 */
  fromSnail: SnailName | null;
  /** 消息目标 snail 列表。 */
  toSnails: SnailName[];
  /** 消息角色。 */
  role: MessageRole;
  /** 被引用的历史消息 ID，仅用于 UI 展示。 */
  quotedMessageId?: number | null;
  /** 当前消息生成时采用的上下文截断时间。 */
  contextCutoffAt?: string;
}

/**
 * 写入消息分片时的输入结构。
 *
 * 对应 message_part 表的一条待写入记录。
 */
export interface MessagePartInput {
  /** 分片类型。 */
  part_type: MessagePartType;
  /** 分片文本内容。 */
  text_value?: string | null;
  /** 分片中的显式 mention 列表。 */
  mentions?: SnailName[];
  /** 分片结构化 JSON 内容。 */
  json_value?: string | null;
}

/**
 * 创建消息分发记录时的输入结构。
 *
 * 对应 message_dispatch 表的一条待写入记录。
 */
export interface CreateMessageDispatchInput {
  /** 所属会话 ID。 */
  conversationId: string;
  /** 被投递的消息 ID。 */
  messageId: number;
  /** 目标消费者 snail。 */
  toSnail: SnailName;
}

/**
 * 产物表。
 *
 * 表示在某个会话/阶段中沉淀出的正式产物记录。
 */
export interface Artifact {
  /** 产物唯一标识。 */
  id: string;
  /** 所属项目 ID。 */
  project_id: string;
  /** 所属阶段 ID。 */
  stage_id: string;
  /** 所属会话 ID。 */
  conversation_id: string;
  /** 产物类型。 */
  artifact_type: ArtifactType;
  /** 产物标题。 */
  title: string;
  /** 产物状态。 */
  status: ArtifactStatus;
  /** 产物存储方式。 */
  storage_type: ArtifactStorageType;
  /** 文件存储路径。 */
  file_path: string | null;
  /** 内联文本内容。 */
  inline_content: string | null;
  /** 外部引用地址。 */
  external_ref: string | null;
  /** 扩展元数据。 */
  metadata: string | null;
  /** 产物创建时间。 */
  created_at: string;
  /** 产物最近更新时间。 */
  updated_at: string;
}

/**
 * 创建阶段时的输入结构。
 *
 * 对应 stage 表的一条待写入记录。
 */
export interface CreateStageInput {
  /** 阶段 ID。 */
  id: string;
  /** 所属项目 ID。 */
  projectId: string;
  /** 阶段类型。 */
  type: StageType;
  /** 阶段顺序号。 */
  sequence: number;
  /** 阶段状态。 */
  status: StageStatus;
  /** 初始正式产物 ID 列表。 */
  formalArtifacts?: string[];
  /** 阶段进入时间。 */
  enteredAt?: string | null;
}

/**
 * 创建会话时的输入结构。
 *
 * 对应 conversation 表的一条待写入记录。
 */
export interface CreateConversationInput {
  /** 会话 ID。 */
  id: string;
  /** 所属项目 ID。 */
  projectId: string;
  /** 所属阶段 ID。 */
  stageId: string;
  /** 会话标题。 */
  title: string;
  /** 会话类型。 */
  kind: ConversationKind;
  /** 默认处理用户消息的 snail。 */
  defaultSnail: SnailName;
  /** 允许参与会话协作的 snail 列表。 */
  participatingSnails: SnailName[];
  /** 初始摘要。 */
  summary?: string;
  /** 来源会话 ID 列表。 */
  fromConversationIds?: string[];
}

/**
 * 产物内容选项。
 *
 * 用于描述不同存储方式下的正文承载字段。
 */
export interface ArtifactContentOptions {
  /** 文件型产物的路径。 */
  filePath?: string;
  /** 内联型产物的文本内容。 */
  inlineContent?: string;
  /** 外部引用型产物的引用地址。 */
  externalRef?: string;
  /** 产物附加元数据。 */
  metadata?: string;
}

/**
 * 创建产物时的输入结构。
 *
 * 对应 artifact 表的一条待写入记录。
 */
export interface CreateArtifactInput {
  /** 产物 ID。 */
  id: string;
  /** 所属项目 ID。 */
  projectId: string;
  /** 所属阶段 ID。 */
  stageId: string;
  /** 所属会话 ID。 */
  conversationId: string;
  /** 产物类型。 */
  artifactType: ArtifactType;
  /** 产物标题。 */
  title: string;
  /** 产物状态。 */
  status: ArtifactStatus;
  /** 产物存储方式。 */
  storageType: ArtifactStorageType;
  /** 产物内容选项。 */
  options?: ArtifactContentOptions;
}
