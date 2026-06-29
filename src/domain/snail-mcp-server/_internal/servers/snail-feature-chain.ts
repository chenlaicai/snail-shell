import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { FeatureChainPort } from "@domain/feature-chain/port";

/**
 * snail-feature-chain MCP Server。
 * 替代旧 feature-chain skill，直接暴露 FeatureChainPort 能力。
 *
 * @param featureChain FeatureChainPort adapter
 */
export function createFeatureChainServer(featureChain: FeatureChainPort): MCPServerConfig {
  return {
    name: "snail-feature-chain",
    version: "1.0.0",
    tools: [
      createSearchFeatureChainTool(featureChain),
      createGetFeatureDocTool(featureChain),
      createGetFeatureChainTool(featureChain),
    ],
  };
}

/** 搜索 Feature 文档 */
function createSearchFeatureChainTool(featureChain: FeatureChainPort): MCPTool {
  return {
    name: "search_feature_chain",
    description: "全文搜索 Feature 文档。返回匹配的文档列表，包含标题、摘要和匹配片段。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回结果数量限制，默认 10" },
      },
      required: ["query"],
    },
    handler: async (params) => {
      const { query, limit = 10 } = params as { query: string; limit?: number };
      const results = featureChain.search(query, limit);
      return {
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          summary: r.summary,
          tags: r.tags,
          modules: r.modules,
          snippet: r.snippet,
        })),
      };
    },
  };
}

/** 获取单个 Feature 文档 */
function createGetFeatureDocTool(featureChain: FeatureChainPort): MCPTool {
  return {
    name: "get_feature_doc",
    description: "按 ID 获取 Feature 文档详情。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Feature 文档 ID（如 F20260627b3qx）" },
      },
      required: ["id"],
    },
    handler: async (params) => {
      const { id } = params as { id: string };
      const doc = featureChain.get(id);
      if (!doc) {
        return { error: "Feature doc not found" };
      }
      return {
        id: doc.id,
        title: doc.title,
        from_ids: doc.from_ids,
        tags: doc.tags,
        modules: doc.modules,
        doc_path: doc.doc_path,
        created_at: doc.created_at,
        summary: doc.summary,
        body: doc.body,
      };
    },
  };
}

/** 获取 Feature 引用链 */
function createGetFeatureChainTool(featureChain: FeatureChainPort): MCPTool {
  return {
    name: "get_feature_chain",
    description: "获取 Feature 文档的引用链（向前/向后/双向）。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Feature 文档 ID" },
        direction: {
          type: "string",
          enum: ["backward", "forward", "both"],
          description: "引用方向：backward（被引用）、forward（引用）、both（双向），默认 backward",
        },
      },
      required: ["id"],
    },
    handler: async (params) => {
      const { id, direction = "backward" } = params as {
        id: string;
        direction?: "backward" | "forward" | "both";
      };
      const chain = featureChain.chain(id, direction);
      return {
        feature_id: chain.feature_id,
        backward: chain.backward.map((link) => ({
          id: link.id,
          title: link.title,
          summary: link.summary,
        })),
        forward: chain.forward.map((link) => ({
          id: link.id,
          title: link.title,
          summary: link.summary,
        })),
      };
    },
  };
}
