import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
// 兼容旧格式 FYYYYMMDDNN（2位数字）和新格式 FYYYYMMDDxxxx（4位，字符集 2-9a-kmnp-z，排除 0/o/1/l）
const featureDocPattern = /^F(\d{8})(\d{2}|[2-9a-kmnp-z]{4})-.+\.md$/;

export interface FeatureDocNumberingIssue {
  message: string;
  files: string[];
}

interface FeatureDocRecord {
  relativePath: string;
  dateDir: string;
  prefix: string;
  dateStr: string;
}

function walkFeatureDocs(rootDir: string, currentDir: string, records: FeatureDocRecord[], issues: FeatureDocNumberingIssue[]): void {
  if (!fs.existsSync(currentDir)) return;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFeatureDocs(rootDir, fullPath, records, issues);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    consumeFeatureDoc(rootDir, fullPath, entry.name, records, issues);
  }
}

function consumeFeatureDoc(rootDir: string, fullPath: string, fileName: string, records: FeatureDocRecord[], issues: FeatureDocNumberingIssue[]): void {
  const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
  const match = fileName.match(featureDocPattern);
  if (!match) return;

  validateFrontmatter(fullPath, relativePath, issues);
  const dateStr: string = match[1];
  const suffix: string = match[2];
  records.push({
    relativePath,
    dateDir: path.relative(path.join(rootDir, "docs", "features"), path.dirname(fullPath)).split(path.sep).join(""),
    // 新旧格式均按完整 ID 分组：旧格式检测完全重复，新格式检测同日同随机码碰撞
    prefix: `F${dateStr}${suffix}`,
    dateStr,
  });
}

function validateFrontmatter(fullPath: string, relativePath: string, issues: FeatureDocNumberingIssue[]): void {
  const raw = fs.readFileSync(fullPath, "utf8");
  const fmMatch = raw.match(FRONTMATTER_RE);
  if (!fmMatch) {
    issues.push({ message: `${relativePath} 缺少 YAML frontmatter`, files: [relativePath] });
    return;
  }

  try {
    const parsed = parseYaml(fmMatch[1]);
    if (typeof parsed !== "object" || !parsed || !parsed.id) {
      issues.push({ message: `${relativePath} frontmatter 缺少 id 字段`, files: [relativePath] });
    }
  } catch (error) {
    issues.push({ message: `${relativePath} frontmatter YAML 解析失败: ${(error as Error).message}`, files: [relativePath] });
  }
}

export function checkFeatureDocNumbering(rootDir = path.resolve(__dirname, "..")): FeatureDocNumberingIssue[] {
  const docsRoot = path.join(rootDir, "docs", "features");
  const records: FeatureDocRecord[] = [];
  const issues: FeatureDocNumberingIssue[] = [];
  const byPrefix = new Map<string, FeatureDocRecord[]>();
  walkFeatureDocs(rootDir, docsRoot, records, issues);

  for (const record of records) {
    validateDateDir(record, issues);
    const current = byPrefix.get(record.prefix) ?? [];
    current.push(record);
    byPrefix.set(record.prefix, current);
  }

  for (const [prefix, duplicates] of byPrefix) {
    if (duplicates.length <= 1) continue;
    issues.push({
      message: `docs/features 中存在重复编号 ${prefix}`,
      files: duplicates.map((record) => record.relativePath),
    });
  }

  return issues;
}

function validateDateDir(record: FeatureDocRecord, issues: FeatureDocNumberingIssue[]): void {
  if (record.dateDir !== record.dateStr) {
    issues.push({
      message: `${record.relativePath} 所在日期目录与编号日期 ${record.dateStr} 不一致`,
      files: [record.relativePath],
    });
  }
}

if (require.main === module) {
  const issues = checkFeatureDocNumbering(process.cwd());
  if (issues.length) {
    console.error("Feature 文档编号校验失败：");
    for (const issue of issues) {
      console.error(`- ${issue.message}`);
      for (const file of issue.files) console.error(`  ${file}`);
    }
    process.exit(1);
  }
  console.log("Feature 文档编号校验通过");
}
