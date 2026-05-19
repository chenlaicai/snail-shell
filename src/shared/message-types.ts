// Message content block types.
type RoleName = string;

export type MessageTextBlock = { type: "text"; text: string; mentions: RoleName[] };
export type MessageRichTextBlock = { type: "rich_text"; text: string };
export type MessageMarkdownBlock = { type: "markdown"; text: string; mentions: RoleName[] };
export type MessageImageBlock = { type: "image"; url: string; alt: string | null };
export type MessageIconBlock = { type: "icon"; name: string; label: string | null };
export type MessageChartBlock = { type: "chart"; chart_type: "bar" | "line" | "pie" | "table"; title: string | null; data: Record<string, unknown> };
export type MessageTableBlock = { type: "table"; columns: string[]; rows: Array<Array<string | number | boolean | null>>; title: string | null };
export type MessageToolCallCardBlock = { type: "tool_call_card"; tool_name: string; status: "pending" | "running" | "success" | "error" | null; summary: string | null; detail: string | null };
export type MessageArtifactCardBlock = { type: "artifact_card"; artifact_id: string | null; artifact_type: string | null; title: string; summary: string | null; status: string | null };
export type MessageReferenceCardBlock = { type: "reference_card"; ref_type: "message" | "artifact" | "conversation" | "stage" | "project" | "external"; ref_id: string | null; title: string; summary: string | null; href: string | null };
export type QuestionOptionPayload = { key: string; label: string; description: string | null; allow_text_input: boolean; text_input_label: string | null; text_input_placeholder: string | null };
export type QuestionResponseSelectedOptionPayload = { key: string; label: string; extra_text: string | null };
export type MessageQuestionBlock = { type: "question"; title: string; question: string; reason: string | null; selection_mode: "single" | "multiple"; options: QuestionOptionPayload[] };
export type MessageQuestionResponseBlock = { type: "question_response"; response_to: { title: string }; selection_mode: "single" | "multiple"; selected_options: QuestionResponseSelectedOptionPayload[]; summary: string };

export type MessageContentBlock = MessageTextBlock | MessageRichTextBlock | MessageMarkdownBlock | MessageQuestionBlock | MessageQuestionResponseBlock | MessageImageBlock | MessageIconBlock | MessageChartBlock | MessageTableBlock | MessageToolCallCardBlock | MessageArtifactCardBlock | MessageReferenceCardBlock;
