import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

export interface FeatureDocNumberingIssue {
  message: string;
  files: string[];
}

interface FeatureDocRecord {
  filePath: string;
  relativePath: string;
  dateDir: string;
  prefix: string;
}

const featureDocPattern = /^F(\d{8})(\d{2})-.+\.md$/;

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
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
    const match = entry.name.match(featureDocPattern);
    if (!match) continue;

    // Validate frontmatter is parseable YAML
    const raw = fs.readFileSync(fullPath, "utf8");
    const fmMatch = raw.match(FRONTMATTER_RE);
    if (!fmMatch) {
      issues.push({ message: `${relativePath} 缺少 YAML frontmatter`, files: [relativePath] });
    } else {
      try {
        const parsed = parseYaml(fmMatch[1]);
        if (typeof parsed !== "object" || !parsed || !parsed.id) {
          issues.push({ message: `${relativePath} frontmatter 缺少 id 字段`, files: [relativePath] });
        }
      } catch (e) {
        issues.push({ message: `${relativePath} frontmatter YAML 解析失败: ${(e as Error).message}`, files: [relativePath] });
      }
    }

    records.push({
      filePath: fullPath,
      relativePath,
      dateDir: path.relative(path.join(rootDir, "docs", "features"), path.dirname(fullPath)).split(path.sep).join(""),
      prefix: `F${match[1]}${match[2]}`,
    });
  }
}

export function checkFeatureDocNumbering(rootDir = path.resolve(__dirname, "..")): FeatureDocNumberingIssue[] {
  const docsRoot = path.join(rootDir, "docs", "features");
  const records: FeatureDocRecord[] = [];
  const issues: FeatureDocNumberingIssue[] = [];
  const byPrefix = new Map<string, FeatureDocRecord[]>();
  walkFeatureDocs(rootDir, docsRoot, records, issues);

  for (const record of records) {
    const expectedDateDir = record.prefix.slice(1, 9);
    if (record.dateDir !== expectedDateDir) {
      issues.push({
        message: `${record.relativePath} 所在日期目录与编号 ${record.prefix} 不一致`,
        files: [record.relativePath],
      });
    }

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
