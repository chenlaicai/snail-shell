/**
 * MCP JSON-RPC endpoint。
 *
 * 注册 POST /snail-final-response 到 Express app，
 * 处理 MCP 协议的 initialize、tools/list、tools/call 方法。
 */

import type { Express } from "express";
import type { ConversationStore } from "../persistence/store";
import { MCP_TOOLS, MCP_SERVER_INFO, handleMcpToolCall } from "./tools";

export function registerMcpEndpoint(app: Express, store: ConversationStore): void {
  app.post("/snail-final-response", (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const { method, params, id } = body;

    /**
     * JSON-RPC 2.0 notification：有 method 但无 id 的请求。
     * 协议规范要求 notification 不产生响应体（如 notifications/initialized），
     * 返回 204 No Content 符合规范。
     */
    if (method && id === undefined) {
      res.status(204).end();
      return;
    }

    let result: unknown;
    try {
      switch (method) {
        case "initialize":
          result = {
            /** MCP spec 2025-03-26：当前实现的协议版本，客户端据此协商能力 */
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: MCP_SERVER_INFO,
          };
          break;
        case "tools/list":
          result = { tools: MCP_TOOLS };
          break;
        case "tools/call":
          result = handleMcpToolCall(store, params);
          break;
        default:
          res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
          return;
      }
    } catch (err) {
      res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: `Internal error: ${err instanceof Error ? err.message : String(err)}` } });
      return;
    }

    res.json({ jsonrpc: "2.0", id, result });
  });
}
