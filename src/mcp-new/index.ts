/**
 * MCP 模块
 *
 * 提供 MCP 服务注册和管理的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - registry: Registry 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Registry 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问 MCP
 */

// ═══ 公开类型 ═══
export type {
  McpServer,
  McpTool,
  McpServerConfig,
} from "./types";

// ═══ Registry 接口 ═══
export type { McpRegistry } from "./registry";
