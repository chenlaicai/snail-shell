import fs from "fs";
import path from "path";

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

function walkFeatureDocs(rootDir: string, currentDir: string, records: FeatureDocRecord[]): void {
  if (!fs.existsSync(currentDir)) return;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFeatureDocs(rootDir, fullPath, records);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
    const match = entry.name.match(featureDocPattern);
    if (!match) continue;
    records.push({
      filePath: fullPath,
      relativePath,
      dateDir: path.basename(path.dirname(fullPath)),
      prefix: `F${match[1]}${match[2]}`,
    });
  }
}

export function checkFeatureDocNumbering(rootDir = path.resolve(__dirname, "..")): FeatureDocNumberingIssue[] {
  const docsRoot = path.join(rootDir, "docs", "features");
  const records: FeatureDocRecord[] = [];
  walkFeatureDocs(rootDir, docsRoot, records);

  const issues: FeatureDocNumberingIssue[] = [];

  for (const record of records) {
    const expectedDateDir = record.prefix.slice(1, 9);
    if (record.dateDir !== expectedDateDir) {
      issues.push({
        message: `${record.relativePath} 所在日期目录与编号 ${record.prefix} 不一致`,
        files: [record.relativePath],
      });
    }

    // 同一 Feature 可以有多个文档（BugFix、Feature Update 等），
    // 因此不检测前缀重复。
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
