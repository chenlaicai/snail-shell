/**
 * MCP server 启动入口。
 *
 * main.ts 调用：startMcpServer(app, store, PORT)
 * - 注册平台级 MCP server 到 registry（snail-final-response）
 * - 注册 MCP JSON-RPC endpoint 到 Express app
 */

import type { Express } from "express";
import type { ConversationStore } from "../persistence/store";
import { registerMcpServer } from "./registry";
import { registerMcpEndpoint } from "./endpoint";
import { registerRednoteEndpoint } from "./rednote-research/endpoint";

export function startMcpServer(app: Express, store: ConversationStore, port: number): void {
  /**
   * 注册平台级 MCP server（URL 由运行时 PORT 决定）。
   * 使用 localhost 而非 0.0.0.0：MCP endpoint 仅需本地访问，
   * agent CLI 与 server 在同一主机，无需暴露到外部网络。
   */
  registerMcpServer({
    name: "snail-final-response",
    url: `http://localhost:${port}/snail-final-response`,
  });

  registerMcpServer({
    name: "rednote-research",
    url: `http://localhost:${port}/rednote-research`,
  });

  // 注册 MCP JSON-RPC endpoints
  registerMcpEndpoint(app, store);
  registerRednoteEndpoint(app);
}
