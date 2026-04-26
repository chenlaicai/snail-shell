#!/usr/bin/env node

import path from "path";
import { ConversationStore } from "../persistence/store";

type Mode = "recent" | "page" | "search" | "by-ids" | "window" | "reindex";

interface ParsedArgs {
  mode: Mode;
  conversationId: string;
  dbPath: string;
  limit: number;
  offset: number;
  query: string;
  messageIds: number[];
  anchorMessageId: number | null;
  before: number;
  after: number;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const store = new ConversationStore(args.dbPath);

  try {
    if (args.mode !== "reindex") {
      const conversation = store.getConversation(args.conversationId);
      if (!conversation) {
        fail(`Conversation not found: ${args.conversationId}`);
      }
    }

    let result: unknown;
    switch (args.mode) {
      case "recent":
        result = {
          mode: args.mode,
          conversation_id: args.conversationId,
          items: compactMessages(store.getRecentConversationMessagesWindow(args.conversationId, args.limit)),
        };
        break;
      case "page":
        result = {
          mode: args.mode,
          conversation_id: args.conversationId,
          items: compactMessages(store.getMessages(args.conversationId, args.limit, args.offset)),
          next_offset: args.offset + args.limit,
        };
        break;
      case "search":
        if (!args.query.trim()) {
          fail("--query is required for search mode");
        }
        result = {
          mode: args.mode,
          conversation_id: args.conversationId,
          query: args.query,
          items: store.searchConversationMessages(args.conversationId, args.query, args.limit, args.offset),
          next_offset: args.offset + args.limit,
        };
        break;
      case "by-ids":
        if (args.messageIds.length === 0) {
          fail("--message-ids is required for by-ids mode");
        }
        result = {
          mode: args.mode,
          conversation_id: args.conversationId,
          items: compactMessages(store.getMessagesByIds(args.conversationId, args.messageIds)),
        };
        break;
      case "window":
        if (!args.anchorMessageId) {
          fail("--anchor-message-id is required for window mode");
        }
        result = {
          mode: args.mode,
          conversation_id: args.conversationId,
          anchor_message_id: args.anchorMessageId,
          items: compactMessages(store.getMessageWindow(args.conversationId, args.anchorMessageId, args.before, args.after)),
        };
        break;
      case "reindex":
        result = {
          mode: args.mode,
          conversation_id: args.conversationId || null,
          ...store.rebuildSearchIndex(args.conversationId || undefined),
        };
        break;
      default:
        fail(`Unsupported mode: ${String(args.mode)}`);
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    store.close();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) {
      return "";
    }
    return argv[index + 1] ?? "";
  };

  const mode = getValue("--mode") as Mode;
  const conversationId = getValue("--conversation-id");
  const dbPath = getValue("--db-path") || process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  const limit = toPositiveInt(getValue("--limit"), 5);
  const offset = toPositiveInt(getValue("--offset"), 0);
  const query = getValue("--query");
  const messageIds = getValue("--message-ids")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  const anchorMessageIdRaw = getValue("--anchor-message-id");
  const anchorMessageId = anchorMessageIdRaw ? Number(anchorMessageIdRaw) : null;
  const before = toPositiveInt(getValue("--before"), 2);
  const after = toPositiveInt(getValue("--after"), 2);

  if (!mode) {
    fail("--mode is required");
  }
  if (!conversationId && mode !== "reindex") {
    fail("--conversation-id is required");
  }

  if (!["recent", "page", "search", "by-ids", "window", "reindex"].includes(mode)) {
    fail(`Invalid --mode value: ${mode}`);
  }

  return {
    mode,
    conversationId,
    dbPath,
    limit,
    offset,
    query,
    messageIds,
    anchorMessageId: anchorMessageId && Number.isInteger(anchorMessageId) ? anchorMessageId : null,
    before,
    after,
  };
}

function toPositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function fail(message: string): never {
  throw new Error(message);
}

function compactMessages(messages: Array<{
  id: number;
  role: string;
  from_snail: string | null;
  created_at: string;
  parts: Array<{ kind: string; payload: unknown }>;
}>): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    message_id: message.id,
    role: message.role,
    from_snail: message.from_snail,
    created_at: message.created_at,
    text: selectPrimaryText(message.parts),
  }));
}

function selectPrimaryText(parts: Array<{ kind: string; payload: unknown }>): string {
  const result = parts.find((part) => part.kind === "result")?.payload as { format?: string; fallback_text?: string; blocks?: Array<{ type?: string; text?: string; question?: string; summary?: string; title?: string }> } | undefined;
  if (typeof result?.fallback_text === "string" && result.fallback_text.trim()) {
    return result.fallback_text.trim();
  }

  const errorDelta = parts.find((part) => part.kind === "delta" && (part.payload as { kind?: string })?.kind === "error_observation")?.payload as { error_text?: string } | undefined;
  if (typeof errorDelta?.error_text === "string" && errorDelta.error_text.trim()) {
    return errorDelta.error_text.trim();
  }

  return parts
    .map((part) => {
      if (part.kind === "result") {
        const resultPayload = part.payload as { fallback_text?: string; blocks?: Array<{ type?: string; text?: string; question?: string; summary?: string; title?: string; columns?: string[] }> } | undefined;
        if (typeof resultPayload?.fallback_text === "string" && resultPayload.fallback_text.trim()) {
          return resultPayload.fallback_text.trim();
        }
        return Array.isArray(resultPayload?.blocks)
          ? resultPayload.blocks.map((block) => {
              if (block.type === "text" || block.type === "rich_text" || block.type === "markdown") return block.text?.trim() || "";
              if (block.type === "question") return [block.title, block.question].filter(Boolean).join("\n").trim();
              if (block.type === "question_response") return block.summary?.trim() || "";
              if (block.type === "artifact_card" || block.type === "reference_card") return [block.title, block.summary].filter(Boolean).join("\n").trim();
              if (block.type === "table") return [block.title, Array.isArray(block.columns) ? block.columns.join(" ") : ""].filter(Boolean).join("\n").trim();
              return "";
            }).filter(Boolean).join("\n\n")
          : "";
      }
      if (part.kind === "delta") {
        const deltaPayload = part.payload as { kind?: string; text?: string } | undefined;
        return deltaPayload?.kind === "text" && typeof deltaPayload.text === "string" ? deltaPayload.text.trim() : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

main();
