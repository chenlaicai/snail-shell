import type { FeatureDoc, FeatureSearchResult, FeatureChain } from "@domain/feature-chain/model";
import type { FileLoader } from "@infra/file-loader";

/** Feature Chain 持久层接口 */
export interface FeatureChainRepository {
  search(query: string, limit?: number): FeatureSearchResult[];
  get(id: string): FeatureDoc | undefined;
  chain(id: string, direction: "backward" | "forward" | "both"): FeatureChain;
  rebuild(): void;
}

/** Feature Chain 文件存储实现 */
export class FileFeatureChainRepository implements FeatureChainRepository {
  private static readonly DIR = "docs/features";

  private docs = new Map<string, FeatureDoc>();
  private backlinks = new Map<string, string[]>(); // feature_id -> from_feature_ids

  constructor(private loader: FileLoader) {}

  search(query: string, limit = 10): FeatureSearchResult[] {
    const lowerQuery = query.toLowerCase();
    const results: FeatureSearchResult[] = [];

    for (const doc of this.docs.values()) {
      const matchFields = [doc.title, doc.summary, ...doc.tags, ...doc.modules].join(" ").toLowerCase();
      if (matchFields.includes(lowerQuery)) {
        results.push({
          id: doc.id,
          title: doc.title,
          summary: doc.summary,
          tags: doc.tags,
          modules: doc.modules,
          snippet: this.generateSnippet(doc.body, query),
        });
      }
    }

    return results.slice(0, limit);
  }

  get(id: string): FeatureDoc | undefined {
    return this.docs.get(id);
  }

  chain(id: string, direction: "backward" | "forward" | "both"): FeatureChain {
    const result: FeatureChain = {
      feature_id: id,
      backward: [],
      forward: [],
    };

    if (direction === "backward" || direction === "both") {
      const doc = this.docs.get(id);
      if (doc) {
        result.backward = doc.from_ids
          .map(fromId => this.docs.get(fromId))
          .filter((d): d is FeatureDoc => !!d)
          .map(d => ({ id: d.id, title: d.title, summary: d.summary }));
      }
    }

    if (direction === "forward" || direction === "both") {
      const fromIds = this.backlinks.get(id) ?? [];
      result.forward = fromIds
        .map(fromId => this.docs.get(fromId))
        .filter((d): d is FeatureDoc => !!d)
        .map(d => ({ id: d.id, title: d.title, summary: d.summary }));
    }

    return result;
  }

  rebuild(): void {
    this.docs.clear();
    this.backlinks.clear();

    const featuresDir = FileFeatureChainRepository.DIR;
    if (!this.loader.exists(featuresDir)) return;

    const files = this.loader.listDir(featuresDir).filter(f => f.endsWith(".md") && f.startsWith("F"));

    for (const file of files) {
      const filePath = `${featuresDir}/${file}`;
      const raw = this.loader.readFile(filePath);
      if (!raw) continue;

      try {
        const doc = this.parseFeatureDoc(file, raw, filePath);
        this.docs.set(doc.id, doc);

        // 构建反向边
        for (const fromId of doc.from_ids) {
          const existing = this.backlinks.get(fromId) ?? [];
          if (!existing.includes(doc.id)) {
            existing.push(doc.id);
            this.backlinks.set(fromId, existing);
          }
        }
      } catch (err) {
        console.warn(`Failed to parse feature doc: ${filePath}`, err);
      }
    }
  }

  private parseFeatureDoc(fileName: string, raw: string, filePath: string): FeatureDoc {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) throw new Error("Invalid feature doc format: missing frontmatter");

    const [, frontmatter, body] = match;
    const meta = this.parseFrontmatter(frontmatter);

    if (typeof meta.id !== "string") throw new Error("Feature doc missing 'id'");
    if (typeof meta.title !== "string") throw new Error("Feature doc missing 'title'");

    // 从文件名提取日期
    const dateMatch = fileName.match(/^F(\d{4})(\d{2})(\d{2})/);
    const createdAt = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : new Date().toISOString().split("T")[0];

    // 提取摘要
    const summary = this.extractSummary(body);

    return {
      id: meta.id,
      title: meta.title,
      from_ids: Array.isArray(meta.from_ids) ? meta.from_ids : [],
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      modules: Array.isArray(meta.modules) ? meta.modules : [],
      doc_path: filePath,
      created_at: createdAt,
      summary,
      body: body.trim(),
    };
  }

  private extractSummary(body: string): string {
    // 尝试从 "Background" 段提取
    const backgroundMatch = body.match(/##\s*Background[\s\S]*?\n([\s\S]*?)(?=\n##|$)/i);
    if (backgroundMatch) {
      return backgroundMatch[1].trim().slice(0, 200);
    }

    // fallback 到全文前 200 字符
    return body.trim().slice(0, 200);
  }

  private parseFrontmatter(raw: string): Record<string, unknown> {
    const state = this.createFrontmatterParseState();

    for (const line of raw.split("\n")) {
      this.consumeFrontmatterLine(state, line);
    }

    this.flushArrayState(state);
    return state.result;
  }

  private createFrontmatterParseState() {
    const result: Record<string, unknown> = {};
    return {
      result,
      currentObj: result,
      inArray: false,
      arrayKey: "",
      arrayItems: [] as string[],
    };
  }

  private consumeFrontmatterLine(state: ReturnType<typeof this.createFrontmatterParseState>, line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    if (state.inArray && !trimmed.startsWith("-")) {
      this.flushArrayState(state);
    }
    if (state.inArray && trimmed.startsWith("-")) {
      state.arrayItems.push(this.unquote(trimmed.slice(1).trim()));
      return;
    }

    const nestedMatch = trimmed.match(/^(\w+):\s*$/);
    if (nestedMatch) {
      state.currentObj = {};
      state.result[nestedMatch[1]] = state.currentObj;
      return;
    }

    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!kvMatch) return;
    this.consumeFrontmatterKeyValue(state, kvMatch[1], kvMatch[2]);
  }

  private consumeFrontmatterKeyValue(state: ReturnType<typeof this.createFrontmatterParseState>, key: string, value: string): void {
    if (value === "") {
      state.inArray = true;
      state.arrayKey = key;
      state.arrayItems = [];
      return;
    }
    state.currentObj[key] = this.parseFrontmatterValue(value);
  }

  private parseFrontmatterValue(value: string): unknown {
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return parseInt(value);
    const inlineArrayMatch = value.match(/^\[(.*)\]$/);
    if (inlineArrayMatch) return inlineArrayMatch[1].split(",").map(s => this.unquote(s.trim()));
    return this.unquote(value);
  }

  private flushArrayState(state: ReturnType<typeof this.createFrontmatterParseState>): void {
    if (!state.inArray) return;
    state.currentObj[state.arrayKey] = state.arrayItems;
    state.inArray = false;
    state.arrayItems = [];
  }

  private unquote(value: string): string {
    return value.replace(/^["']|["']$/g, "");
  }


  private generateSnippet(content: string, query: string): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);

    if (index === -1) {
      return content.slice(0, 100) + "...";
    }

    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + query.length + 50);
    const snippet = content.slice(start, end);

    return (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : "");
  }
}
