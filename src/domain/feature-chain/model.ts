/** Feature 文档 */
export interface FeatureDoc {
  id: string;
  title: string;
  from_ids: string[];
  tags: string[];
  modules: string[];
  doc_path: string;
  created_at: string;
  summary: string;
  body: string;
}

/** Feature 搜索结果 */
export interface FeatureSearchResult {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  modules: string[];
  snippet: string;
}

/** Feature 引用链 */
export interface FeatureChain {
  feature_id: string;
  backward: FeatureChainLink[];
  forward: FeatureChainLink[];
}

/** Feature 引用链节点 */
export interface FeatureChainLink {
  id: string;
  title: string;
  summary: string;
}
