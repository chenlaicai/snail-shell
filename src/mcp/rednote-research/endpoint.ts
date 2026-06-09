/**
 * Rednote Research MCP JSON-RPC endpoint。
 *
 * 注册 POST /rednote-research 到 Express app，
 * 处理 MCP 协议的 initialize、tools/list、tools/call 方法。
 */

import type { Express } from "express";
import { REDNOTE_TOOLS, handleRednoteToolCall } from "./tools";

const SERVER_INFO = { name: "rednote-research", version: "1.0.0" };

type JsonRpcError = { code: number; message: string };

function dispatch(method: string, params: unknown): { result?: unknown; error?: JsonRpcError } {
  switch (method) {
    case "initialize":
      return { result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
    case "tools/list":
      return { result: { tools: REDNOTE_TOOLS } };
    case "tools/call":
      if (!params || typeof params !== "object") {
        return { error: { code: -32602, message: "Invalid params: params must be an object" } };
      }
      return { result: handleRednoteToolCall(params) }; // caller must await
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export function registerRednoteEndpoint(app: Express): void {
  app.post("/rednote-research", async (req, res) => {
    const { body } = req;
    if (!body || typeof body !== "object") {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const { method, id } = body;
    if (typeof method !== "string") {
      res.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: method must be a string" } });
      return;
    }

    // JSON-RPC 2.0 notification：无 id 字段的请求，返回 204
    if (!("id" in body)) { res.status(204).end(); return; }

    try {
      const { result, error } = dispatch(method, body.params);
      if (error) { res.json({ jsonrpc: "2.0", id, error }); return; }
      res.json({ jsonrpc: "2.0", id, result: await result });
    } catch (err) {
      res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: `Internal error: ${err instanceof Error ? err.message : String(err)}` } });
    }
  });
}
