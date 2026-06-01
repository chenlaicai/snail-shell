import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import type Database from "better-sqlite3";

/**
 * 系统启动时全量重建 issue chain 索引。
 * docs/issues/ 是唯一真相源，每次启动清空重建。
 */
export function rebuildIssueChainIndex(db: Database.Database): void {
  const docsRoot = path.join(process.cwd(), "docs", "issues");
  if (!fs.existsSync(docsRoot)) return;

  const issueFiles = findIssueFiles(docsRoot);
  const issues: IssueDoc[] = issueFiles
    .map((fp) => parseIssueDoc(fp))
    .filter((f): f is IssueDoc => f !== null);

  const tx = db.transaction(() => {
    // 清空旧索引
    db.exec("DELETE FROM issue_chain_backlink");
    db.exec("DELETE FROM issue_chain_index");

    for (const f of issues) {
      db.prepare(`
        INSERT INTO issue_chain_index (issue_id, title, summary, from_ids, tags, modules, doc_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(f.id, f.title, f.summary, JSON.stringify(f.fromIds), JSON.stringify(f.tags), JSON.stringify(f.modules), f.docPath, f.createdAt);

      // 重建 FTS5 索引（DELETE + INSERT）
      db.prepare("DELETE FROM issue_chain_search WHERE issue_id = ?").run(f.id);
      db.prepare(`
        INSERT INTO issue_chain_search (issue_id, title, summary, tags, modules, body)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(f.id, f.title, f.summary, f.tags.join(" "), f.modules.join(" "), f.body);
    }

    // 重建 backlink
    for (const f of issues) {
      for (const fromId of f.fromIds) {
        db.prepare(`
          INSERT OR IGNORE INTO issue_chain_backlink (issue_id, from_issue_id)
          VALUES (?, ?)
        `).run(fromId, f.id);
      }
    }
  });

  tx();
}

// ── 内部类型 ──────────────────────────────────────────────

interface IssueDoc {
  id: string;
  title: string;
  fromIds: string[];
  tags: string[];
  modules: string[];
  docPath: string;
  createdAt: string;
  summary: string;
  body: string;
}

// ── 文件扫描 ──────────────────────────────────────────────

function findIssueFiles(root: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...findIssueFiles(fullPath));
    } else if (entry.isFile() && /^I\d{10}-\w.*\.md$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

// ── Frontmatter 解析（不依赖 gray-matter，手动分割） ──────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseIssueDoc(filePath: string): IssueDoc | null {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;

  const frontmatterStr = match[1];
  const bodyMarkdown = match[2];

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseYaml(frontmatterStr) as Record<string, unknown>;
  } catch {
    return null;
  }

  const issueId = String(frontmatter.id ?? "");
  if (!issueId) return null;

  // 从文件名提取日期
  const basename = path.basename(filePath);
  const fileId = basename.replace(/\.md$/, "");
  // 校验 ID 一致性
  if (issueId !== fileId) {
    // 不匹配时用文件名中的 ID
    // 但 frontmatter 的 id 优先
  }

  return {
    id: issueId,
    title: String(frontmatter.title ?? ""),
    fromIds: parseStringArray(frontmatter.from_ids),
    tags: parseStringArray(frontmatter.tags),
    modules: parseStringArray(frontmatter.modules),
    docPath: filePath,
    createdAt: extractDate(filePath),
    summary: extractSummary(bodyMarkdown),
    body: bodyMarkdown,
  };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

/** 从文件名 `IYYYYMMDDNN-title.md` 提取日期 */
function extractDate(filePath: string): string {
  const basename = path.basename(filePath);
  const m = basename.match(/^I(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

/** 提取 Issue 文档的 Background / Goal 段落作为摘要（最多 200 字） */
function extractSummary(body: string): string {
  const sections = body.split(/^##\s+/m);
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.startsWith("背景") || trimmed.startsWith("Background")) {
      return trimmed.replace(/^背景[^\n]*\n?/i, "").replace(/^Background[^\n]*\n?/i, "").trim().slice(0, 200);
    }
  }
  // fallback: 前 200 字
  return body.trim().slice(0, 200);
}

// ── 同步：更新单个 Issue 的 from_ids / tags / modules ──

export interface IssueLinkUpdate {
  issueId: string;
  fromIds?: string[];
  tags?: string[];
  modules?: string[];
}

/**
 * AI 在 development 过程中确认关联后，更新 Issue 文档的 frontmatter + DB 索引。
 * 注意：已合入的 Issue 文档不可修改，此操作只能用于当前开发中的 Issue。
 */
export function updateIssueChainLink(db: Database.Database, update: IssueLinkUpdate): boolean {
  const doc = db.prepare("SELECT doc_path FROM issue_chain_index WHERE issue_id = ?").get(update.issueId) as { doc_path: string } | undefined;
  if (!doc || !fs.existsSync(doc.doc_path)) return false;

  // 更新 frontmatter
  if (!updateIssueFrontmatter(doc.doc_path, update)) return false;

  // 同步更新 DB 索引
  const issue = parseIssueDoc(doc.doc_path);
  if (!issue) return false;
  syncIssueIndex(db, issue);
  return true;
}

function updateIssueFrontmatter(filePath: string, update: IssueLinkUpdate): boolean {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return false;

  let fm: Record<string, unknown>;
  try { fm = parseYaml(m[1]) as Record<string, unknown>; } catch { return false; }

  if (update.fromIds) fm.from_ids = update.fromIds;
  if (update.tags) fm.tags = update.tags;
  if (update.modules) fm.modules = update.modules;

  const newContent = "---\n" + renderYamlFrontmatter(fm) + "\n---\n" + m[2];
  fs.writeFileSync(filePath, newContent, "utf8");
  return true;
}

function syncIssueIndex(db: Database.Database, issue: IssueDoc): void {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE issue_chain_index SET title = ?, summary = ?, from_ids = ?, tags = ?, modules = ?
      WHERE issue_id = ?
    `).run(issue.title, issue.summary, JSON.stringify(issue.fromIds), JSON.stringify(issue.tags), JSON.stringify(issue.modules), issue.id);

    db.prepare("DELETE FROM issue_chain_search WHERE issue_id = ?").run(issue.id);
    db.prepare(`
      INSERT INTO issue_chain_search (issue_id, title, summary, tags, modules, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(issue.id, issue.title, issue.summary, issue.tags.join(" "), issue.modules.join(" "), issue.body);

    db.prepare("DELETE FROM issue_chain_backlink WHERE from_issue_id = ?").run(issue.id);
    for (const fromId of issue.fromIds) {
      db.prepare("INSERT OR IGNORE INTO issue_chain_backlink (issue_id, from_issue_id) VALUES (?, ?)").run(fromId, issue.id);
    }
  });
  tx();
}

function renderYamlFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  const order = ["id", "title", "from_ids", "tags", "modules", "doc_kind"];
  for (const key of order) {
    if (key in fm) {
      const val = fm[key];
      if (Array.isArray(val)) {
        lines.push(`${key}: [${val.map((v) => String(v)).join(", ")}]`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    }
  }
  return lines.join("\n");
}
